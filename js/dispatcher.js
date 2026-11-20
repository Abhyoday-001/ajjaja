/* Domino Sky — AI dispatcher.

   Division of labour (this is the contract):
     • DS.simulate / DS.metricsAt / DS.advise …   deterministic engine: the ONLY source of any delay, passenger or crew number.
     • narrator (brief / explainFlight / recommend) composes plain-English text, but every number is pulled from the
       engine through a Ledger — it never calculates one itself.
     • auditor (verifyText)  independently re-reads the finished text, extracts every number and time, and checks each
       against the engine's own output. A mismatch is flagged, never hidden.
     • askClaude() optionally lets a real LLM do the talking. It gets read-only tools backed by the engine and is told to
       copy numbers from them; its answer goes through the same auditor, so a number it invents is highlighted.

   Pure functions (no DOM) so the whole contract can be unit-tested in Node. */
(function (G) {
  'use strict';
  const DS = G.DS;
  const hhmm = m => { m = Math.round(m); const x = ((m % 1440) + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0') + (m >= 1440 ? '⁺¹' : ''); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const group = (v, dec) => Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });

  // ---------------------------------------------------------------- ledger: numbers enter text only through here
  class Ledger {
    constructor() { this.items = []; }
    n(key, value, o) {
      o = o || {}; const dec = o.dec || 0, shown = group(value, dec) + (o.unit || '');
      this.items.push({ key, value, shown });
      return '<b class="fact" title="' + esc(key) + ' = ' + (Math.round(value * 1000) / 1000) + ' (from the simulator)">' + shown + '</b>';
    }
    t(key, minutes) { const shown = hhmm(minutes); this.items.push({ key, value: minutes, shown, time: true }); return '<b class="fact" title="' + esc(key) + ' (from the simulator)">' + shown + '</b>'; }
  }
  const art = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');
  const plain = html => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

  // ---------------------------------------------------------------- ground truth snapshots (all from the engine)
  function snapshot(net, res) {
    const fl = res.flights, t1 = (net.meta && net.meta.t1) || 1800;
    const late = fl.filter(f => f.status === 'ok' && f.aarr - f.sta > 15).length;
    return {
      paxHours: res.pax.paxMin / 60, aircraftHours: res.costs.counts.delayMin / 60, lateFlights: late, cancelled: res.costs.counts.cancels,
      diverted: res.costs.counts.diverts, stranded: res.pax.stranded, missedConnectionPax: res.pax.missedPax,
      onTimePct: DS.metricsAt(res, t1).otp * 100, crewTimeouts: fl.filter(f => f.cancel === 'crew').length, totalFlights: fl.length
    };
  }
  const METRICS = [['paxHours', 'Passenger delay', 'pax-hours', 0], ['aircraftHours', 'Aircraft delay', 'aircraft-hours', 0], ['lateFlights', 'Flights arriving >15 min late', 'flights', 0],
    ['cancelled', 'Cancelled flights', 'flights', 0], ['stranded', 'Passengers stranded overnight', 'people', 0], ['missedConnectionPax', 'Missed-connection passengers', 'people', 0], ['onTimePct', 'On-time arrivals', '%', 1]];

  function problems(net, weather, now) {
    return weather.map(e => {
      const hits = net.airports.map(a => ({ code: a.code, v: DS.effSev(e, a) })).filter(x => x.v > 0.04).sort((x, y) => y.v - x.v).map(x => ({ code: x.code, status: x.v >= 0.9 ? 'closed' : Math.round((1 - x.v) * 100) + '% capacity' }));
      let near = null, bd = 1e9; net.airports.forEach(a => { const d = DS.hav(e, a); if (d < bd) { bd = d; near = a; } });
      return { type: e.type, start: e.start, end: e.start + e.dur, durMin: e.dur, hits, near: near.code, nearKm: Math.round(bd), state: now < e.start ? 'forecast' : now < e.start + e.dur ? 'active' : 'cleared' };
    });
  }
  const placeName = (net, code) => (net.airportMap[code] ? net.airportMap[code].city + ' (' + code + ')' : code);

  // ---------------------------------------------------------------- crews (explicit duty clocks)
  function crewRows(net, res, plan) {
    const ext = net.hardCrewLimit ? 0 : (plan || []).filter(a => a.type === 'crew').reduce((m, a) => Math.max(m, a.extra), 0), limit = net.crewDuty || DS.CREW_DUTY || 840;
    const rows = [];
    Object.keys(res.tails).forEach(id => {
      const T = res.tails[id]; if (!T.chain.length) return;
      const fl = T.chain.map(i => res.flights[i]), info = net.tails.find(t => t.id === id) || {};
      const start = info.dutyStart != null ? info.dutyStart : net.flights[T.chain[0]].std - 60, legalEnd = start + (info.dutyMax || limit) + ext, ok = fl.filter(f => f.status === 'ok');
      const finish = ok.length ? Math.max(...ok.map(f => f.aarr)) : start;
      const timedOut = fl.filter(f => f.cancel === 'crew').length, margin = legalEnd - finish;
      rows.push({ crew: info.crew || id, aircraft: id, dutyStart: start, legalEnd, projectedFinish: finish, marginMin: margin, flights: fl.length, timedOutFlights: timedOut,
        status: timedOut ? 'timed out' : margin < 30 ? 'at risk' : margin < 90 ? 'tight' : 'ok' });
    });
    return rows.sort((a, b) => a.marginMin - b.marginMin);
  }

  // ---------------------------------------------------------------- why is this flight late?
  function explainFlight(net, res, id, weather) {
    const f = res.flights[id]; if (!f) return null;
    const T = res.tails[f.tail], pos = T.chain.indexOf(id), F = net.flights;
    const out = { flight: f.num, route: f.orig + '→' + f.dest, aircraft: f.tail, crew: ((net.tails.find(t => t.id === f.tail) || {}).crew) || null, status: f.status, passengersOnBoard: F[id].load, scheduledDeparture: f.std, scheduledArrival: f.sta, hops: [] };
    if (f.status === 'cancelled') {
      out.cancelReason = { crew: 'crew duty limit would be exceeded', delay: 'departure would have slipped past four hours', proactive: 'cancelled in advance by the dispatcher', rotation: 'rotation protected after an earlier cancellation on the same aircraft' }[f.cancel] || 'cancelled';
      out.cancelAt = f.cancelAt;
    } else {
      out.actualDeparture = f.adep; out.actualArrival = f.aarr; out.departureDelayMin = f.adep - f.std; out.arrivalDelayMin = f.aarr - f.sta;
      out.components = { lateInboundAircraftMin: f.react, weatherOrRunwayQueueMin: f.slotWx ? f.slot : 0, congestionQueueMin: f.slotWx ? 0 : f.slot, groundHoldMin: f.gdp, connectionHoldMin: f.hold, stormDetourMin: f.detour, airborneHoldMin: f.airHold, minorOpsMin: f.noise };
      if (f.divert) out.diverted = { to: f.divert, landedAt: f.divArr };
    }
    // walk back along the same aircraft's chain to the flight the delay started on
    let k = pos; const trail = [];
    while (k >= 0) {
      const g = res.flights[T.chain[k]]; trail.unshift(g);
      if (g.status !== 'ok' || g.gen === 0 || g.react < 5 || k === 0) break; k--;
    }
    out.root = null;
    const rootF = trail[0];
    if (rootF && rootF.status === 'ok' && rootF.gen === 0) {
      const ev = (weather || []).find(e => { const a = net.airportMap[rootF.slotWx || rootF.slot ? rootF.orig : rootF.dest]; return a && DS.effSev(e, a) > 0.04 && ((rootF.adep >= e.start - 30 && rootF.adep <= e.start + e.dur + 60) || (rootF.eta >= e.start - 30 && rootF.eta <= e.start + e.dur + 60)); });
      out.root = { flight: rootF.num, route: rootF.orig + '→' + rootF.dest, airport: rootF.slotWx && rootF.slot >= 5 ? rootF.orig : rootF.dest, problem: ev ? ev.type : 'a runway restriction', delayedDepartureMin: rootF.adep - rootF.std, queueMin: rootF.slot, airborneHoldMin: rootF.airHold, detourMin: rootF.detour, diverted: rootF.divert || null };
    }
    trail.forEach((g, i) => {
      if (g.status !== 'ok') return;
      const next = trail[i + 1] || null, slack = next ? net.flights[next.id].std - g.sta - (net.minTurn || 35) : null;
      out.hops.push({ flight: g.num, route: g.orig + '→' + g.dest, arrivalDelayMin: Math.max(0, g.aarr - g.sta), turnaroundBufferMin: slack == null ? null : Math.max(0, slack), carriedToNextMin: next && next.status === 'ok' ? Math.max(0, next.adep - next.std) : null });
    });
    out.connectingPassengersMissed = (res.pax.caused && res.pax.caused[id]) || 0;
    out.laterFlightsOnSameAircraftDelayed = T.chain.slice(pos + 1).filter(i => { const g = res.flights[i]; return g.status === 'cancelled' || g.aarr - g.sta > 15; }).length;
    return out;
  }

  // ---------------------------------------------------------------- recommendations: engine evaluates, never the narrator
  function actionTitle(net, res, a) {
    const fl = x => { const f = res.flights[x]; return f ? f.num + ' ' + f.orig + '→' + f.dest : '?'; };
    switch (a.type) {
      case 'swap': return 'Swap in spare ' + a.spare + ' for ' + fl(a.flight);
      case 'cancel': return 'Cancel the rotation starting with ' + fl(a.flight);
      case 'gdp': return 'Ground-delay program ' + (a.airport === 'ALL' ? 'network-wide' : 'for ' + a.airport);
      case 'hold': return 'Hold connections up to ' + a.mins + ' min' + (a.airport === 'ALL' ? ' network-wide' : ' at ' + a.airport);
      case 'fastturn': return 'Fast turnarounds ' + (a.airport === 'ALL' ? 'network-wide' : 'at ' + a.airport);
      case 'crew': return 'Extend crew duty limits by ' + (a.extra / 60) + ' hours';
      case 'surge': return 'Surge operations at ' + a.airport;
      case 'rebook': return 'Auto-rebook and care for disrupted passengers';
    }
    return a.type;
  }
  function evaluateCandidates(ctx, limit) {
    const adv = DS.advise(ctx.net, ctx.weather, ctx.plan, ctx.now, ctx.objective || 'pax');
    const beforeSnap = snapshot(ctx.net, ctx.res);
    const items = adv.items.slice(0, limit || 5).map((it, i) => {
      const r = DS.simulate(ctx.net, ctx.weather, ctx.plan.concat([Object.assign({ id: -1 }, it.action)]));
      const after = snapshot(ctx.net, r);
      return { id: 'A' + (i + 1), title: actionTitle(ctx.net, ctx.res, it.action), action: it.action, type: it.action.type, before: beforeSnap, after, resAfter: r, spendInr: Math.round(it.spend) };
    });
    return { tested: adv.tested, objective: ctx.objective || 'pax', before: beforeSnap, items };
  }

  // ---------------------------------------------------------------- narrator (offline dispatcher)
  // The brief's signature case: a flight in a city with clear skies, hours after the storm, late only because its aircraft was held earlier.
  function knockOnExample(ctx) {
    if (!ctx.weather.length) return null;
    const hit = new Set(DS.affected(ctx.net, ctx.weather)), t0 = Math.min(...ctx.weather.map(e => e.start)); let best = null;
    ctx.res.flights.forEach(f => {
      if (f.status !== 'ok' || f.gen < 1 || f.adep > ctx.now || f.adep - f.std < 30 || hit.has(f.orig) || hit.has(f.dest) || f.adep < t0 + 120) return;
      if (!best || f.adep - t0 > best.f.adep - t0) best = { f };
    });
    if (!best) return null;
    const e = explainFlight(ctx.net, ctx.res, best.f.id, ctx.weather); if (!e || !e.root || e.root.flight === best.f.num) return null;
    return { f: best.f, root: e.root, delay: best.f.adep - best.f.std, hours: (best.f.adep - t0) / 60 };
  }
  function brief(ctx) {
    const L = new Ledger(), net = ctx.net, now = ctx.now, m = DS.metricsAt(ctx.res, now), P = problems(net, ctx.weather, now), tz = net.meta.tzLabel, para = [];
    const probTxt = P.length ? P.map(p => {
      const where = p.hits.length ? p.hits.slice(0, 3).map(h => placeName(net, h.code) + ' ' + h.status).join(', ') : 'open airspace near ' + placeName(net, p.near);
      return (p.state === 'forecast' ? art(p.type) + ' ' + p.type.toLowerCase() + ' is forecast from ' : p.state === 'active' ? art(p.type) + ' ' + p.type.toLowerCase() + ' is in progress until ' : art(p.type) + ' ' + p.type.toLowerCase() + ' cleared at ')
        + L.t('problem_' + p.type, p.state === 'forecast' ? p.start : p.end) + ' — ' + where;
    }).join('; ') : '';
    para.push('It is ' + L.t('now', now) + ' ' + tz + '. ' + (probTxt ? 'Right now ' + probTxt + '.' : 'There are no problems on the map — a clear day.'));
    if (m.due) para.push('Of the ' + L.n('due_flights', m.due) + ' flights scheduled so far, ' + L.n('late_flights', m.delayed) + ' are late, ' + L.n('cancelled_flights', m.cancelled) + ' cancelled and ' + L.n('diverted_flights', m.diverted)
      + ' diverted (' + L.n('on_time_pct', m.otp * 100, { unit: '%' }) + ' on time). Passengers have lost ' + L.n('pax_hours_so_far', m.paxDelayMin / 60) + ' hours so far; ' + L.n('stranded_so_far', m.stranded) + ' are stranded and ' + L.n('missed_so_far', m.missedPax) + ' have missed a connection.');
    const dg = DS.diagnose(net, ctx.res, now), tot = dg.direct + dg.knock;
    if (tot > 600) {
      const top = dg.roots[0], knockPct = dg.knock / tot * 100;
      para.push('<b>Why:</b> ' + L.n('knock_on_pct', knockPct, { unit: '%' }) + ' of the delay is knock-on — flights late only because their <i>aircraft</i> was late — and ' + L.n('direct_pct', 100 - knockPct, { unit: '%' }) + ' is the closure itself. The biggest single root cause is '
        + (top.root === 'en-route' ? 'storm detours' : placeName(net, top.root)) + ', behind ' + L.n('root_pct', top.total / tot * 100, { unit: '%' }) + ' of it (' + L.n('root_pax_hours', top.total / 60) + ' passenger-hours across ' + L.n('root_flights', top.flights + top.cancels) + ' flights).');
    }
    const crews = crewRows(net, ctx.res, ctx.plan), risk = crews.filter(c => c.status === 'at risk' || c.status === 'timed out');
    if (risk.length) para.push('<b>Crews:</b> ' + L.n('crews_at_risk', risk.length) + ' crew' + (risk.length > 1 ? 's are' : ' is') + ' at or past the legal duty limit; the tightest is ' + esc(risk[0].crew) + ' on ' + esc(risk[0].aircraft) + ' with ' + L.n('crew_margin', Math.max(0, risk[0].marginMin)) + ' minutes of margin'
      + (risk[0].timedOutFlights ? ' — ' + L.n('crew_timeouts', risk[0].timedOutFlights) + ' flight' + (risk[0].timedOutFlights > 1 ? 's were' : ' was') + ' cancelled when the limit was hit.' : '.'));
    const ex = knockOnExample(ctx);
    if (ex) para.push('<b>The domino effect, in one flight:</b> ' + esc(ex.f.num) + ' (' + ex.f.orig + '→' + ex.f.dest + ') runs ' + L.n('ex_delay', ex.delay) + ' minutes late, ' + L.n('ex_hours', ex.hours, { dec: 1 }) + ' hours after the first problem began — and neither of its airports is affected. Its aircraft ' + esc(ex.f.tail) + ' earlier flew ' + esc(ex.root.flight) + ' (' + ex.root.route + '), which was held at ' + esc(placeName(net, ex.root.airport)) + ' and left ' + L.n('ex_root_delay', Math.max(0, ex.root.delayedDepartureMin)) + ' minutes late; the delay has been handed down the chain ever since.');
    para.push(ctx.plan.length ? 'Your plan currently applies ' + L.n('plan_actions', ctx.plan.length) + ' measure' + (ctx.plan.length > 1 ? 's' : '') + '.' : 'No recovery measures have been applied yet — ask me to recommend one.');
    return finish('Situation briefing', para, L, ctx, ex ? { example: { delay: ex.delay, hours: ex.hours, rootDelay: Math.max(0, ex.root.delayedDepartureMin) } } : undefined);
  }

  function recommend(ctx) {
    const L = new Ledger(), net = ctx.net, ev = evaluateCandidates(ctx, 5), para = [];
    if (!ctx.weather.length) { para.push('There is no disruption to recover from. Close an airport or plant a problem and I will test every recovery measure for you.'); return finish('Recommendation', para, L, ctx); }
    if (!ev.items.length) { para.push('I tested ' + L.n('tested', ev.tested) + ' recovery measures at ' + L.t('now', ctx.now) + ' and none of them improves ' + DS.OBJ[ev.objective].label.toLowerCase() + ' any further. The current plan is already the best available.'); return finish('Recommendation', para, L, ctx, { evidence: ev }); }
    const top = ev.items[0], b = top.before, a = top.after, fb = ctx.res.flights, fa = top.resAfter.flights;
    const rescued = fb.filter((f, i) => (f.status === 'cancelled' || f.aarr - f.sta > 15) && fa[i].status === 'ok' && fa[i].aarr - fa[i].sta <= 15).length;
    const o = DS.OBJ[ev.objective], key = ev.objective === 'pax' ? 'paxHours' : ev.objective === 'flights' ? 'aircraftHours' : 'stranded';
    para.push('I tested ' + L.n('tested', ev.tested) + ' recovery measures against the whole day, scoring each on <b>' + o.label.toLowerCase() + '</b>. <b>Recommended: ' + esc(top.title) + '.</b>');
    para.push('It cuts ' + o.label.toLowerCase() + ' from ' + L.n('before_obj', b[key]) + ' to ' + L.n('after_obj', a[key]) + ' ' + o.unit + ' (' + L.n('gain_obj', b[key] - a[key]) + ' fewer), ' + (rescued ? 'recovers ' + L.n('rescued', rescued) + ' flight' + (rescued === 1 ? '' : 's') + ' that would otherwise be late or cancelled, and ' : 'and ')
      + (b.stranded - a.stranded >= 1 ? 'keeps ' + L.n('stranded_saved', b.stranded - a.stranded) + ' fewer people stranded' : a.stranded > b.stranded ? 'strands ' + L.n('stranded_more', a.stranded - b.stranded) + ' more people' : 'leaves stranded passengers unchanged') + '.');
    para.push(reasonFor(ctx, top, L));
    // the brief's two headline actions side by side: what the OTHER of {swap a spare, cancel the rotation} would do for the same flight
    let cmp = null;
    if (top.action.flight != null && (top.action.type === 'swap' || top.action.type === 'cancel')) {
      const fo = DS.fixOptions(ctx.net, ctx.weather, ctx.plan, ctx.now, top.action.flight, ev.objective, ctx.res), other = fo.find(o => o.action.type !== top.action.type && (o.action.type === 'cancel' || o.action.type === 'swap'));
      if (other) {
        const f = ctx.res.flights[top.action.flight], delta = other.gain / o.div, word = other.action.type === 'cancel' ? 'cancelling the rotation that starts with' : 'swapping in a spare for';
        cmp = { value: Math.abs(delta) };
        para.push('<b>For comparison:</b> ' + word + ' ' + esc(f.num) + ' instead would ' + (delta >= 0 ? 'cut' : 'add') + ' ' + L.n('cmp_delta', Math.abs(delta)) + ' ' + o.unit + (delta >= 0 ? ' — less than the recommendation.' : ' — it makes things worse, so the dispatcher does not recommend it.'));
      }
    }
    if (ev.items.length > 1) para.push('Next best: ' + ev.items.slice(1, 4).map(it => esc(it.title) + ' (−' + L.n('alt_' + it.id, it.before[key] - it.after[key]) + ' ' + o.unit + ')').join('; ') + '.');
    return finish('Recommendation', para, L, ctx, { evidence: ev, top, cmp });
  }
  function reasonFor(ctx, top, L) {
    const net = ctx.net, a = top.action, f = ctx.res.flights[a.flight];
    switch (a.type) {
      case 'swap': return '<b>Why it works:</b> ' + esc(f.num) + ' is predicted ' + L.n('flight_delay', Math.max(0, f.adep - f.std)) + ' minutes late leaving ' + f.orig + '. A fresh aircraft and crew from the spare pool take over that flight and the rest of its rotation, so the later flights on that aircraft stop inheriting the delay.';
      case 'cancel': return '<b>Why it works:</b> ' + esc(f.num) + ' would leave ' + L.n('flight_delay', Math.max(0, f.adep - f.std)) + ' minutes late. Cancelling the rotation early frees the aircraft and protects passengers before they reach the airport.';
      case 'gdp': return '<b>Why it works:</b> holding flights on the ground at their origin until the destination can accept them avoids aircraft burning fuel in holding patterns or diverting, and keeps them where crews and spares are.';
      case 'hold': return '<b>Why it works:</b> waiting up to ' + L.n('hold_min', a.mins) + ' minutes lets late feeder aircraft deliver their connecting passengers instead of stranding them.';
      case 'fastturn': return '<b>Why it works:</b> shaving ' + L.n('turn_cut', a.cut || 10) + ' minutes off each minimum turnaround lets late aircraft absorb delay before the next departure.';
      case 'crew': return '<b>Why it works:</b> a longer duty limit stops the evening flights of long-delayed crews from being cancelled when they would otherwise time out.';
      case 'surge': return '<b>Why it works:</b> more runway throughput clears the backlog faster once the airport reopens.';
      case 'rebook': return '<b>Why it works:</b> passengers are moved onto the next seats instead of waiting in counter queues.';
    }
    return '';
  }

  function passengers(ctx) {
    const L = new Ledger(), px = ctx.res.pax, para = [], now = ctx.now, ev = px.list.filter(l => l.tEvent <= now);
    para.push('Over the whole day ' + L.n('pax_total', px.total) + ' passengers travel; ' + L.n('pax_delayed', px.delayed) + ' arrive more than a quarter-hour late, ' + L.n('pax_missed', px.missedPax) + ' miss a connection, ' + L.n('pax_rebooked', px.rebooked) + ' are rebooked on later flights and ' + L.n('pax_stranded', px.stranded) + ' are stranded overnight.');
    if (ev.length) para.push('Worst-hit journeys so far: ' + ev.slice(0, 3).map(l => esc(l.label) + ' — ' + L.n('j_' + l.label, l.pax) + ' passengers (' + (l.kind === 'missed' ? 'missed connection' : 'flight cancelled') + ')').join('; ') + '.');
    return finish('Passengers', para, L, ctx);
  }
  function crews(ctx) {
    const L = new Ledger(), rows = crewRows(ctx.net, ctx.res, ctx.plan), para = [];
    const bad = rows.filter(r => r.status !== 'ok');
    para.push(L.n('crew_total', rows.length) + ' crews are flying today; ' + L.n('crew_flagged', bad.length) + ' are within an hour and a half of their legal duty limit or past it.');
    if (bad.length) para.push(bad.slice(0, 4).map(r => esc(r.crew) + ' (' + esc(r.aircraft) + '): duty ends ' + L.t('c_end_' + r.crew, r.legalEnd) + ', projected finish ' + L.t('c_fin_' + r.crew, r.projectedFinish) + (r.timedOutFlights ? ', ' + L.n('c_to_' + r.crew, r.timedOutFlights) + ' flight(s) cancelled' : '')).join('; ') + '.');
    return finish('Crew duty', para, L, ctx);
  }
  // after the user applies something: state the before/after of the whole day, from engine snapshots
  function applied(ctx, before, title, action) {
    const L = new Ledger(), after = snapshot(ctx.net, ctx.res), para = [];
    const d = (b, a) => b >= a ? ' (' + L.n('d_' + (L.items.length), b - a, { dec: b - a < 10 && (b - a) % 1 ? 1 : 0 }) + ' fewer)' : ' (' + L.n('d_' + (L.items.length), a - b) + ' more)';
    para.push('Applied <b>' + esc(title) + '</b>, effective ' + L.t('applied_at', ctx.now) + '. Over the whole day passenger delay goes from ' + L.n('b_pax', before.paxHours) + ' to ' + L.n('a_pax', after.paxHours) + ' hours' + d(before.paxHours, after.paxHours)
      + '; flights arriving late go from ' + L.n('b_late', before.lateFlights) + ' to ' + L.n('a_late', after.lateFlights) + '; cancellations from ' + L.n('b_cx', before.cancelled) + ' to ' + L.n('a_cx', after.cancelled) + '; people stranded from ' + L.n('b_str', before.stranded) + ' to ' + L.n('a_str', after.stranded) + '.');
    return finish('Result of your decision', para, L, ctx, { before, after, action });
  }
  function whyFlight(ctx, id) {
    const L = new Ledger(), e = explainFlight(ctx.net, ctx.res, id, ctx.weather), para = [];
    if (!e) return finish('Why?', ['I could not find that flight.'], L, ctx);
    if (e.status === 'cancelled') {
      para.push(esc(e.flight) + ' (' + e.route + ') is cancelled: ' + e.cancelReason + '. It carried ' + L.n('pax_board', e.passengersOnBoard) + ' passengers' + (e.connectingPassengersMissed ? ', ' + L.n('conn_missed', e.connectingPassengersMissed) + ' of them connecting' : '') + '.');
    } else if (e.departureDelayMin < 5 && e.arrivalDelayMin < 5) {
      para.push(esc(e.flight) + ' (' + e.route + ') is running to schedule: departure ' + L.t('std', e.scheduledDeparture) + ', arrival ' + L.t('sta', e.scheduledArrival) + '.');
    } else {
      const c = e.components, parts = [];
      if (c.lateInboundAircraftMin >= 1) parts.push(L.n('c_react', c.lateInboundAircraftMin) + ' min waiting for its late aircraft');
      if (c.weatherOrRunwayQueueMin >= 1) parts.push(L.n('c_wx', c.weatherOrRunwayQueueMin) + ' min queuing behind a closure or restriction');
      if (c.congestionQueueMin >= 1) parts.push(L.n('c_cong', c.congestionQueueMin) + ' min in a runway queue');
      if (c.groundHoldMin >= 1) parts.push(L.n('c_gdp', c.groundHoldMin) + ' min of ground hold');
      if (c.connectionHoldMin >= 1) parts.push(L.n('c_hold', c.connectionHoldMin) + ' min held for connecting passengers');
      if (c.stormDetourMin >= 1) parts.push(L.n('c_det', c.stormDetourMin) + ' min flying around a storm');
      if (c.airborneHoldMin >= 1) parts.push(L.n('c_air', c.airborneHoldMin) + ' min holding in the air');
      para.push(esc(e.flight) + ' (' + e.route + ', aircraft ' + esc(e.aircraft) + ') leaves ' + L.n('dep_delay', Math.max(0, e.departureDelayMin)) + ' min late (scheduled ' + L.t('std', e.scheduledDeparture) + ', now ' + L.t('adep', e.actualDeparture) + ') and arrives ' + L.n('arr_delay', Math.max(0, e.arrivalDelayMin)) + ' min late. '
        + (parts.length ? 'That is ' + parts.join(' + ') + '.' : ''));
      if (e.root && e.root.flight !== e.flight) {
        const r = e.root;
        para.push('<b>Where it started:</b> the same aircraft’s earlier flight ' + esc(r.flight) + ' (' + r.route + ') was hit by ' + esc(r.problem.toLowerCase()) + ' at ' + esc(placeName(ctx.net, r.airport)) + ' and left ' + L.n('root_dep', Math.max(0, r.delayedDepartureMin)) + ' min late'
          + (r.diverted ? ', diverting to ' + esc(r.diverted) : '') + '. ' + e.hops.filter(h => h.carriedToNextMin != null).slice(0, 3).map(h => esc(h.flight) + ' arrived ' + L.n('h_arr_' + h.flight, h.arrivalDelayMin) + ' min late; only ' + L.n('h_buf_' + h.flight, h.turnaroundBufferMin) + ' min of turnaround buffer could absorb it, so ' + L.n('h_carry_' + h.flight, h.carriedToNextMin) + ' min carried on.').join(' '));
      }
      if (e.laterFlightsOnSameAircraftDelayed) para.push(L.n('later', e.laterFlightsOnSameAircraftDelayed) + ' later flight' + (e.laterFlightsOnSameAircraftDelayed > 1 ? 's' : '') + ' on this aircraft are also delayed or cancelled.');
      if (e.connectingPassengersMissed) para.push(L.n('conn', e.connectingPassengersMissed) + ' connecting passengers miss their onward flight because of it.');
    }
    return finish('Why is ' + e.flight + ' ' + (e.status === 'cancelled' ? 'cancelled' : 'late') + '?', para, L, ctx, { flight: e });
  }

  // truth set used by the auditor
  // ids (optional): when given, numbers written inside returned TEXT (e.g. an action title “hold up to 35 min”) count as tool-provided too,
  // after flight / tail / crew identifiers are removed so an ID such as DS0101 cannot widen what is allowed.
  function collectNumbers(o, out, times, ids) {
    out = out || []; times = times || [];
    if (o == null) return { nums: out, times };
    if (typeof o === 'string') {
      if (ids) { let t = o; ids.forEach(id => { if (id) t = t.split(id).join(' '); }); t.replace(/\b(\d{1,2}):(\d{2})\b/g, m => { times.push(m); return ' '; }).replace(/(^|[^A-Za-z0-9_.])(\d[\d,]*(?:\.\d+)?)/g, (m, p, n) => { out.push(parseFloat(n.replace(/,/g, ''))); return m; }); }
      return { nums: out, times };
    }
    if (typeof o === 'string') { (o.match(/d[d,]*(?:.d+)?/g) || []).forEach(s => out.push(parseFloat(s.replace(/,/g, '')))); (o.match(/d{1,2}:d{2}/g) || []).forEach(s => times.push(s)); }
    else if (typeof o === 'number') { if (isFinite(o)) out.push(o); }
    else if (Array.isArray(o)) o.forEach(x => collectNumbers(x, out, times, ids));
    else if (typeof o === 'object') Object.keys(o).forEach(k => {
      const v = o[k];
      if (typeof v === 'number' && /(now|time|departure|arrival|dep|arr|std|sta|start|end|finish|landedAt|cancelAt|dutyStart|legalEnd|projectedFinish|at)$/i.test(k) && v >= 0 && v < 3000 && !/Min$/.test(k)) { times.push(hhmm(v).replace('⁺¹', '')); times.push(hhmm(v)); }
      collectNumbers(v, out, times, ids);
    });
    return { nums: out, times };
  }
  function identifiers(net) {
    const ids = new Set(); net.flights.forEach(f => ids.add(f.num)); net.tails.forEach(t => { ids.add(t.id); if (t.crew) ids.add(t.crew); });
    return [...ids].sort((a, b) => b.length - a.length);
  }
  // Independent audit: every number and time in `text` must match the engine's output at the precision shown.
  function verifyText(text, truth, ids) {
    let t = String(text).replace(/ /g, ''); (ids || []).forEach(id => { if (id) t = t.split(id).join(' '); });
    const times = [], toks = [];
    t = t.replace(/\b(\d{1,2}):(\d{2})(?:⁺¹)?/g, m => { times.push(m.replace('⁺¹', '')); return ' '; });
    t.replace(/(^|[^A-Za-z0-9_.])(\d[\d,]*(?:\.\d+)?)(%?)/g, (m, pre, num, pct) => { const clean = num.replace(/,/g, ''); toks.push({ raw: num + pct, num: parseFloat(clean), dec: (clean.split('.')[1] || '').length }); return m; });
    const nums = truth.nums || [], okTimes = new Set(truth.times || []);
    const bad = [];
    toks.forEach(k => { if (!nums.some(x => Math.abs(Math.abs(x) - k.num) <= 0.5 * Math.pow(10, -k.dec) + 1e-9)) bad.push(k.raw); });
    times.forEach(k => { if (!okTimes.has(k)) bad.push(k); });
    return { ok: bad.length === 0, checked: toks.length + times.length, bad };
  }

  function finish(title, para, L, ctx, extra) {
    const html = para.map(p => '<p>' + p + '</p>').join(''), text = plain(html);
    // audit against ground truth recomputed straight from the engine, NOT from what the narrator says it used
    const ground = groundTruth(ctx, extra);
    const v = verifyText(text, ground, identifiers(ctx.net));
    return Object.assign({ title, html, text, ledger: L.items, verification: v, source: 'dispatcher' }, extra || {});
  }
  // everything the engine knows that text may legitimately quote
  function groundTruth(ctx, extra) {
    const now = ctx.now, m = DS.metricsAt(ctx.res, now), px = ctx.res.pax, dg = DS.diagnose(ctx.net, ctx.res, now), tot = dg.direct + dg.knock || 1, top = dg.roots[0];
    const o = { now, m: Object.assign({}, m, { hours: m.paxDelayMin / 60, otpPct: m.otp * 100 }), full: snapshot(ctx.net, ctx.res), base: snapshot(ctx.net, ctx.base), plan: ctx.plan.length, probs: problems(ctx.net, ctx.weather, now),
      pax: { total: px.total, delayed: px.delayed, missed: px.missedPax, rebooked: px.rebooked, stranded: px.stranded, list: px.list.slice(0, 8).map(l => ({ pax: l.pax })) },
      diag: { knockPct: dg.knock / tot * 100, directPct: 100 - dg.knock / tot * 100, rootPct: top ? top.total / tot * 100 : 0, rootHours: top ? top.total / 60 : 0, rootFlights: top ? top.flights + top.cancels : 0 },
      crews: crewRows(ctx.net, ctx.res, ctx.plan).slice(0, 8) };
    o.planActions = ctx.plan.map(a => ({ mins: a.mins, cut: a.cut || 10, extraH: a.extra ? a.extra / 60 : 0, pct: a.pct }));   // parameters of applied measures (e.g. “hold up to 35 min”)
    const crewsAll = crewRows(ctx.net, ctx.res, ctx.plan); o.crewsAgg = { total: crewsAll.length, flagged: crewsAll.filter(c => c.status !== 'ok').length, atRisk: crewsAll.filter(c => c.status === 'at risk' || c.status === 'timed out').length };
    if (extra && extra.evidence) { const ev = extra.evidence; o.ev = { tested: ev.tested, items: ev.items.map(it => ({ b: it.before, a: it.after, gainPax: it.before.paxHours - it.after.paxHours, gainAc: it.before.aircraftHours - it.after.aircraftHours, gainStr: it.before.stranded - it.after.stranded, rescued: ctx.res.flights.filter((f, i) => (f.status === 'cancelled' || f.aarr - f.sta > 15) && it.resAfter.flights[i].status === 'ok' && it.resAfter.flights[i].aarr - it.resAfter.flights[i].sta <= 15).length, delay: ctx.res.flights[it.action.flight] ? Math.max(0, ctx.res.flights[it.action.flight].adep - ctx.res.flights[it.action.flight].std) : 0, mins: it.action.mins, cut: it.action.cut || 10, extraH: it.action.extra ? it.action.extra / 60 : 0 })) }; }
    if (extra && extra.flight) o.flight = extra.flight;
    if (extra && extra.example) o.example = extra.example;
    if (extra && extra.cmp) o.cmp = extra.cmp;
    if (extra && extra.action) o.action = { mins: extra.action.mins, cut: extra.action.cut || 10, extraH: extra.action.extra ? extra.action.extra / 60 : 0, pct: extra.action.pct };
    if (extra && extra.before) { o.beforeSnap = extra.before; o.afterSnap = extra.after; o.delta = {}; Object.keys(extra.before).forEach(k => { o.delta[k] = extra.before[k] - extra.after[k]; }); }   // differences of two engine snapshots are engine-derived
    return collectNumbers(o);
  }

  // ---------------------------------------------------------------- free-text routing for the offline dispatcher
  function answer(ctx, q, selectedFlightId) {
    q = String(q || '').trim(); const low = q.toLowerCase();
    const num = q.match(/\b([A-Za-z]{2}\s?\d{2,4})\b/);
    let fid = null;
    if (num) { const key = num[1].replace(/\s/g, '').toUpperCase(); const f = ctx.res.flights.find(x => x.num.toUpperCase() === key); if (f) fid = f.id; }
    if (fid == null && /(this|selected|that)\s+flight/.test(low)) fid = selectedFlightId;
    if (fid != null && /(why|late|delay|cancel|how come|reason|cause)/.test(low) || (fid != null && !/recommend|fix/.test(low))) return whyFlight(ctx, fid);
    if (/(strand|passenger|pax|connection|rebook)/.test(low)) return passengers(ctx);
    if (/(crew|duty|pilot)/.test(low)) return crews(ctx);
    if (/(recommend|should|fix|recover|best|help|action|improve|swap|cancel|what can|what do)/.test(low)) return recommend(ctx);
    if (/(why|where|cause|root)/.test(low) && selectedFlightId != null) return whyFlight(ctx, selectedFlightId);
    return brief(ctx);
  }

  // ---------------------------------------------------------------- Claude (optional): tools are read-only views of the engine
  const TOOLS = [
    { name: 'get_situation', description: 'Current state of the network at the simulation clock: problems, flights late/cancelled/diverted so far, passengers stranded, root causes, crew status, and full-day totals for the current plan and for doing nothing. Every number you state must come from this or the other tools.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'get_recommendations', description: 'The simulator tests every recovery measure against the whole day and returns the best ones, each with exact before and after metrics. Use these ids (A1, A2, …) when you recommend something; you cannot invent other actions.', input_schema: { type: 'object', properties: { objective: { type: 'string', enum: ['pax', 'flights', 'stranded'], description: 'What to optimise: passenger delay, aircraft delay or people stranded.' } }, additionalProperties: false } },
    { name: 'explain_flight', description: 'Why a specific flight is late or cancelled: delay components, the chain of earlier flights on the same aircraft, buffers, connecting passengers affected.', input_schema: { type: 'object', properties: { flight_number: { type: 'string', description: 'e.g. SK123' } }, required: ['flight_number'], additionalProperties: false } },
    { name: 'get_crews', description: 'Crew duty clocks: legal limit, projected finish and margin for the crews closest to their limit.', input_schema: { type: 'object', properties: {}, additionalProperties: false } }
  ];
  const r1 = x => Math.round(x * 10) / 10;
  function toolImpl(ctx, name, input, state) {
    switch (name) {
      case 'get_situation': {
        const m = DS.metricsAt(ctx.res, ctx.now), dg = DS.diagnose(ctx.net, ctx.res, ctx.now), tot = dg.direct + dg.knock || 1;
        return { clock: { time: ctx.now, timeZone: ctx.net.meta.tzLabel }, network: { name: ctx.net.meta.name, airports: ctx.net.airports.length, flights: ctx.net.flights.length, aircraft: ctx.net.tails.filter(t => !t.spare).length, spareAircraftAvailable: ctx.net.tails.filter(t => t.spare && !ctx.plan.some(a => a.type === 'swap' && a.spare === t.id)).length },
          problems: problems(ctx.net, ctx.weather, ctx.now), soFar: { flightsDue: m.due, late: m.delayed, cancelled: m.cancelled, diverted: m.diverted, onTimePercent: r1(m.otp * 100), passengerDelayHours: Math.round(m.paxDelayMin / 60), stranded: m.stranded, missedConnectionPassengers: m.missedPax },
          rootCauses: dg.roots.slice(0, 4).map(r => ({ cause: r.root, sharePercent: Math.round(r.total / tot * 100), passengerHours: Math.round(r.total / 60), flights: r.flights + r.cancels })), knockOnPercent: Math.round(dg.knock / tot * 100),
          planMeasures: ctx.plan.length, fullDayWithCurrentPlan: roundSnap(snapshot(ctx.net, ctx.res)), fullDayDoingNothing: roundSnap(snapshot(ctx.net, ctx.base)), crewsAtRisk: crewRows(ctx.net, ctx.res, ctx.plan).filter(c => c.status === 'at risk' || c.status === 'timed out').length };
      }
      case 'get_recommendations': {
        const ev = evaluateCandidates(Object.assign({}, ctx, { objective: input && input.objective || ctx.objective || 'pax' }), 5); state.candidates = ev.items;
        return { measuresTested: ev.tested, objective: ev.objective, before: roundSnap(ev.before), recommendations: ev.items.map(it => ({ id: it.id, title: it.title, after: roundSnap(it.after), improvement: { passengerHours: Math.round(it.before.paxHours - it.after.paxHours), aircraftHours: Math.round(it.before.aircraftHours - it.after.aircraftHours), strandedPeople: it.before.stranded - it.after.stranded, cancelledFlights: it.before.cancelled - it.after.cancelled, lateFlights: it.before.lateFlights - it.after.lateFlights } })) };
      }
      case 'explain_flight': {
        const key = String(input && input.flight_number || '').replace(/\s/g, '').toUpperCase(), f = ctx.res.flights.find(x => x.num.toUpperCase() === key);
        if (!f) return { error: 'No flight with that number. Examples: ' + ctx.res.flights.slice(0, 5).map(x => x.num).join(', ') };
        return explainFlight(ctx.net, ctx.res, f.id, ctx.weather);
      }
      case 'get_crews': { const rows = crewRows(ctx.net, ctx.res, ctx.plan); return { crews: rows.length, flagged: rows.filter(r => r.status !== 'ok').length, tightest: rows.slice(0, 5) }; }
    }
    return { error: 'unknown tool' };
  }
  const roundSnap = s => ({ passengerDelayHours: Math.round(s.paxHours), aircraftDelayHours: Math.round(s.aircraftHours), lateFlights: s.lateFlights, cancelledFlights: s.cancelled, divertedFlights: s.diverted, strandedPeople: s.stranded, missedConnectionPassengers: s.missedConnectionPax, onTimePercent: r1(s.onTimePct), crewTimeouts: s.crewTimeouts, totalFlights: s.totalFlights });

  const SYSTEM = 'You are the AI dispatcher inside Domino Sky, an airline disruption simulator. A deterministic simulation engine is the only source of numbers. You cannot calculate delays, passengers or crew limits yourself. ' +
    'Call the tools to get facts, then explain and recommend in plain English for a duty controller: 120 words or fewer, no markdown tables. ' +
    'Rules: (1) every number and clock time you write must be copied exactly from a tool result — never round differently, convert units, sum, subtract or estimate; if you need a figure the tools did not return, say you do not have it; ' +
    '(2) recommend only actions returned by get_recommendations, naming them by id and title; (3) never mention dates or years; (4) state units (minutes, hours, passengers). Your numbers are audited automatically against the engine and any mismatch is shown to the user.';
  const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2'];

  // A tiny first-party client for POST /v1/messages. Deliberately NOT a CDN-loaded SDK: no third-party code ever sees the API key,
  // and the only host the key is sent to is api.anthropic.com. Same request shape as the official SDKs (betas go in the anthropic-beta header).
  const API_URL = 'https://api.anthropic.com/v1/messages';
  function fetchClient(apiKey) {
    const call = async req => {
      const body = Object.assign({}, req); const betas = body.betas; delete body.betas;
      const headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
      if (betas && betas.length) headers['anthropic-beta'] = betas.join(',');
      const r = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body), referrerPolicy: 'no-referrer', credentials: 'omit' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || ('Anthropic API returned HTTP ' + r.status));
      return j;
    };
    return { messages: { create: call }, beta: { messages: { create: call } } };
  }

  async function askClaude(ctx, question, opts) {
    opts = opts || {}; const state = { candidates: null }, truthParts = [], model = opts.model || 'claude-opus-5-5';
    let client = opts.client;
    if (!client) {
      if (!opts.apiKey) throw new Error('Enter an Anthropic API key to use Claude.');
      client = fetchClient(opts.apiKey);
    }
    const useFallback = FALLBACK_MODELS.includes(model);
    const messages = [{ role: 'user', content: question }], used = [];
    for (let turn = 0; turn < 6; turn++) {
      const req = { model, max_tokens: 16000, system: SYSTEM, tools: TOOLS, messages };
      let resp;
      if (useFallback) resp = await client.beta.messages.create(Object.assign(req, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }));
      else resp = await client.messages.create(req);
      if (resp.stop_reason === 'refusal') throw new Error('Claude declined this request' + (resp.stop_details && resp.stop_details.category ? ' (' + resp.stop_details.category + ')' : '') + '.');
      messages.push({ role: 'assistant', content: resp.content });                       // thinking blocks and tool_use go back unchanged
      const uses = resp.content.filter(b => b.type === 'tool_use');
      if (resp.stop_reason === 'max_tokens' && uses.length) throw new Error('Claude ran out of output tokens mid tool call; try again.');
      if (!uses.length) {
        const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        const idsAll = identifiers(ctx.net).concat(['A1', 'A2', 'A3', 'A4', 'A5']), truth = collectNumbers(truthParts, null, null, idsAll), v = verifyText(text, truth, idsAll);
        return { title: 'Claude’s answer', text, html: null, verification: v, source: 'claude', model, toolsUsed: used, candidates: state.candidates };
      }
      const results = uses.map(u => { let out; try { out = toolImpl(ctx, u.name, u.input || {}, state); } catch (e) { out = { error: String(e.message || e) }; } truthParts.push(out); used.push(u.name); return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) }; });
      messages.push({ role: 'user', content: results });
    }
    throw new Error('Claude did not finish within the tool-call limit.');
  }

  DS.Dispatcher = { snapshot, METRICS, problems, crewRows, explainFlight, evaluateCandidates, brief, recommend, passengers, crews, whyFlight, applied, answer, verifyText, collectNumbers, identifiers, groundTruth, askClaude, fetchClient, API_URL, TOOLS, toolImpl, SYSTEM, hhmm, actionTitle, Ledger };
  if (typeof module !== 'undefined') module.exports = DS;
})(typeof window !== 'undefined' ? window : globalThis);
