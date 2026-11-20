/* Domino Sky — AI dispatcher.

   Division of labour (this is the contract):
     • DS.simulate / DS.metricsAt / DS.advise …   deterministic engine: the ONLY source of any delay, passenger or crew number.
     • narrator (brief / explainFlight / recommend) composes plain-English text, but every number is pulled from the
       engine through a Ledger — it never calculates one itself.
     • auditor (verifyText, in dispatcher-audit.js)  independently re-reads the finished text, extracts every number and time, and checks each
       against the engine's own output. A mismatch is flagged, never hidden.
     • askClaude() (in dispatcher-claude.js) optionally lets a real LLM do the talking. It gets read-only tools backed by the engine and is told to
       copy numbers from them; its answer goes through the same auditor, so a number it invents is highlighted.

   Pure functions (no DOM) so the whole contract can be unit-tested in Node. */
(function (G) {
  'use strict';
  const DS = G.DS;
  // the auditor lives in dispatcher-audit.js (loaded next): looked up when called
  const groundTruth = (...args) => DS.Dispatcher.groundTruth(...args);
  const verifyText = (...args) => DS.Dispatcher.verifyText(...args);
  const identifiers = (...args) => DS.Dispatcher.identifiers(...args);
  const hhmm = m => {
    m = Math.round(m);
    const x = ((m % 1440) + 1440) % 1440;
    return (
      String(Math.floor(x / 60)).padStart(2, '0') +
      ':' +
      String(x % 60).padStart(2, '0') +
      (m >= 1440 ? '⁺¹' : '')
    );
  };
  const esc = s =>
    String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const group = (v, dec) =>
    Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });

  // ---------------------------------------------------------------- ledger: numbers enter text only through here
  class Ledger {
    constructor() {
      this.items = [];
    }
    n(key, value, o) {
      o = o || {};
      const dec = o.dec || 0,
        shown = group(value, dec) + (o.unit || '');
      this.items.push({ key, value, shown });
      return (
        '<b class="fact" title="' +
        esc(key) +
        ' = ' +
        Math.round(value * 1000) / 1000 +
        ' (from the simulator)">' +
        shown +
        '</b>'
      );
    }
    t(key, minutes) {
      const shown = hhmm(minutes);
      this.items.push({ key, value: minutes, shown, time: true });
      return '<b class="fact" title="' + esc(key) + ' (from the simulator)">' + shown + '</b>';
    }
  }
  const art = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');
  const plain = html =>
    html
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

  // ---------------------------------------------------------------- ground truth snapshots (all from the engine)
  function snapshot(net, res) {
    const fl = res.flights,
      t1 = (net.meta && net.meta.t1) || 1800;
    const late = fl.filter(f => f.status === 'ok' && f.aarr - f.sta > 15).length;
    return {
      paxHours: res.pax.paxMin / 60,
      aircraftHours: res.costs.counts.delayMin / 60,
      lateFlights: late,
      cancelled: res.costs.counts.cancels,
      diverted: res.costs.counts.diverts,
      stranded: res.pax.stranded,
      missedConnectionPax: res.pax.missedPax,
      onTimePct: DS.metricsAt(res, t1).otp * 100,
      crewTimeouts: fl.filter(f => f.cancel === 'crew').length,
      totalFlights: fl.length
    };
  }
  const METRICS = [
    ['paxHours', 'Passenger delay', 'pax-hours', 0],
    ['aircraftHours', 'Aircraft delay', 'aircraft-hours', 0],
    ['lateFlights', 'Flights arriving >15 min late', 'flights', 0],
    ['cancelled', 'Cancelled flights', 'flights', 0],
    ['stranded', 'Passengers stranded overnight', 'people', 0],
    ['missedConnectionPax', 'Missed-connection passengers', 'people', 0],
    ['onTimePct', 'On-time arrivals', '%', 1]
  ];

  function problems(net, weather, now) {
    return weather.map(e => {
      const hits = net.airports
        .map(a => ({ code: a.code, v: DS.effSev(e, a) }))
        .filter(x => x.v > 0.04)
        .sort((x, y) => y.v - x.v)
        .map(x => ({
          code: x.code,
          status: x.v >= 0.9 ? 'closed' : Math.round((1 - x.v) * 100) + '% capacity'
        }));
      let near = null,
        bd = 1e9;
      net.airports.forEach(a => {
        const d = DS.hav(e, a);
        if (d < bd) {
          bd = d;
          near = a;
        }
      });
      return {
        type: e.type,
        start: e.start,
        end: e.start + e.dur,
        durMin: e.dur,
        hits,
        near: near.code,
        nearKm: Math.round(bd),
        state: now < e.start ? 'forecast' : now < e.start + e.dur ? 'active' : 'cleared'
      };
    });
  }
  const placeName = (net, code) =>
    net.airportMap[code] ? net.airportMap[code].city + ' (' + code + ')' : code;

  // ---------------------------------------------------------------- crews (explicit duty clocks)
  function crewRows(net, res, plan) {
    const ext = net.hardCrewLimit
        ? 0
        : (plan || []).filter(a => a.type === 'crew').reduce((m, a) => Math.max(m, a.extra), 0),
      limit = net.crewDuty || DS.CREW_DUTY || 840;
    const rows = [];
    Object.keys(res.tails).forEach(id => {
      const T = res.tails[id];
      if (!T.chain.length) return;
      const fl = T.chain.map(i => res.flights[i]),
        info = net.tails.find(t => t.id === id) || {};
      const start = info.dutyStart != null ? info.dutyStart : net.flights[T.chain[0]].std - 60,
        legalEnd = start + (info.dutyMax || limit) + ext,
        ok = fl.filter(f => f.status === 'ok');
      const finish = ok.length ? Math.max(...ok.map(f => f.aarr)) : start;
      const timedOut = fl.filter(f => f.cancel === 'crew').length,
        margin = legalEnd - finish;
      rows.push({
        crew: info.crew || id,
        aircraft: id,
        dutyStart: start,
        legalEnd,
        projectedFinish: finish,
        marginMin: margin,
        flights: fl.length,
        timedOutFlights: timedOut,
        status: timedOut ? 'timed out' : margin < 30 ? 'at risk' : margin < 90 ? 'tight' : 'ok'
      });
    });
    return rows.sort((a, b) => a.marginMin - b.marginMin);
  }

  // ---------------------------------------------------------------- why is this flight late?
  function explainFlight(net, res, id, weather) {
    const f = res.flights[id];
    if (!f) return null;
    const T = res.tails[f.tail],
      pos = T.chain.indexOf(id),
      F = net.flights;
    const out = {
      flight: f.num,
      route: f.orig + '→' + f.dest,
      aircraft: f.tail,
      crew: (net.tails.find(t => t.id === f.tail) || {}).crew || null,
      status: f.status,
      passengersOnBoard: F[id].load,
      scheduledDeparture: f.std,
      scheduledArrival: f.sta,
      hops: []
    };
    if (f.status === 'cancelled') {
      out.cancelReason =
        {
          crew: 'crew duty limit would be exceeded',
          delay: 'departure would have slipped past four hours',
          proactive: 'cancelled in advance by the dispatcher',
          rotation: 'rotation protected after an earlier cancellation on the same aircraft'
        }[f.cancel] || 'cancelled';
      out.cancelAt = f.cancelAt;
    } else {
      out.actualDeparture = f.adep;
      out.actualArrival = f.aarr;
      out.departureDelayMin = f.adep - f.std;
      out.arrivalDelayMin = f.aarr - f.sta;
      out.components = {
        lateInboundAircraftMin: f.react,
        weatherOrRunwayQueueMin: f.slotWx ? f.slot : 0,
        congestionQueueMin: f.slotWx ? 0 : f.slot,
        groundHoldMin: f.gdp,
        connectionHoldMin: f.hold,
        stormDetourMin: f.detour,
        airborneHoldMin: f.airHold,
        minorOpsMin: f.noise
      };
      if (f.divert) out.diverted = { to: f.divert, landedAt: f.divArr };
    }
    // walk back along the same aircraft's chain to the flight the delay started on
    let k = pos;
    const trail = [];
    while (k >= 0) {
      const g = res.flights[T.chain[k]];
      trail.unshift(g);
      if (g.status !== 'ok' || g.gen === 0 || g.react < 5 || k === 0) break;
      k--;
    }
    out.root = null;
    const rootF = trail[0];
    if (rootF && rootF.status === 'ok' && rootF.gen === 0) {
      const ev = (weather || []).find(e => {
        const a = net.airportMap[rootF.slotWx || rootF.slot ? rootF.orig : rootF.dest];
        return (
          a &&
          DS.effSev(e, a) > 0.04 &&
          ((rootF.adep >= e.start - 30 && rootF.adep <= e.start + e.dur + 60) ||
            (rootF.eta >= e.start - 30 && rootF.eta <= e.start + e.dur + 60))
        );
      });
      out.root = {
        flight: rootF.num,
        route: rootF.orig + '→' + rootF.dest,
        airport: rootF.slotWx && rootF.slot >= 5 ? rootF.orig : rootF.dest,
        problem: ev ? ev.type : 'a runway restriction',
        delayedDepartureMin: rootF.adep - rootF.std,
        queueMin: rootF.slot,
        airborneHoldMin: rootF.airHold,
        detourMin: rootF.detour,
        diverted: rootF.divert || null
      };
    }
    trail.forEach((g, i) => {
      if (g.status !== 'ok') return;
      const next = trail[i + 1] || null,
        slack = next ? net.flights[next.id].std - g.sta - (net.minTurn || 35) : null;
      out.hops.push({
        flight: g.num,
        route: g.orig + '→' + g.dest,
        arrivalDelayMin: Math.max(0, g.aarr - g.sta),
        turnaroundBufferMin: slack == null ? null : Math.max(0, slack),
        carriedToNextMin: next && next.status === 'ok' ? Math.max(0, next.adep - next.std) : null
      });
    });
    out.connectingPassengersMissed = (res.pax.caused && res.pax.caused[id]) || 0;
    out.laterFlightsOnSameAircraftDelayed = T.chain.slice(pos + 1).filter(i => {
      const g = res.flights[i];
      return g.status === 'cancelled' || g.aarr - g.sta > 15;
    }).length;
    return out;
  }

  // ---------------------------------------------------------------- recommendations: engine evaluates, never the narrator
  function actionTitle(net, res, a) {
    const fl = x => {
      const f = res.flights[x];
      return f ? f.num + ' ' + f.orig + '→' + f.dest : '?';
    };
    switch (a.type) {
      case 'swap':
        return 'Swap in spare ' + a.spare + ' for ' + fl(a.flight);
      case 'cancel':
        return 'Cancel the rotation starting with ' + fl(a.flight);
      case 'gdp':
        return 'Ground-delay program ' + (a.airport === 'ALL' ? 'network-wide' : 'for ' + a.airport);
      case 'hold':
        return (
          'Hold connections up to ' +
          a.mins +
          ' min' +
          (a.airport === 'ALL' ? ' network-wide' : ' at ' + a.airport)
        );
      case 'fastturn':
        return 'Fast turnarounds ' + (a.airport === 'ALL' ? 'network-wide' : 'at ' + a.airport);
      case 'crew':
        return 'Extend crew duty limits by ' + a.extra / 60 + ' hours';
      case 'surge':
        return 'Surge operations at ' + a.airport;
      case 'rebook':
        return 'Auto-rebook and care for disrupted passengers';
    }
    return a.type;
  }
  function evaluateCandidates(ctx, limit) {
    const adv = DS.advise(ctx.net, ctx.weather, ctx.plan, ctx.now, ctx.objective || 'pax');
    const beforeSnap = snapshot(ctx.net, ctx.res);
    const items = adv.items.slice(0, limit || 5).map((it, i) => {
      const r = DS.simulate(ctx.net, ctx.weather, ctx.plan.concat([Object.assign({ id: -1 }, it.action)]));
      const after = snapshot(ctx.net, r);
      return {
        id: 'A' + (i + 1),
        title: actionTitle(ctx.net, ctx.res, it.action),
        action: it.action,
        type: it.action.type,
        before: beforeSnap,
        after,
        resAfter: r,
        spendInr: Math.round(it.spend)
      };
    });
    return { tested: adv.tested, objective: ctx.objective || 'pax', before: beforeSnap, items };
  }

  // ---------------------------------------------------------------- narrator (offline dispatcher)
  // The brief's signature case: a flight in a city with clear skies, hours after the storm, late only because its aircraft was held earlier.
  function knockOnExample(ctx) {
    if (!ctx.weather.length) return null;
    const hit = new Set(DS.affected(ctx.net, ctx.weather)),
      t0 = Math.min(...ctx.weather.map(e => e.start));
    let best = null;
    ctx.res.flights.forEach(f => {
      if (
        f.status !== 'ok' ||
        f.gen < 1 ||
        f.adep > ctx.now ||
        f.adep - f.std < 30 ||
        hit.has(f.orig) ||
        hit.has(f.dest) ||
        f.adep < t0 + 120
      )
        return;
      if (!best || f.adep - t0 > best.f.adep - t0) best = { f };
    });
    if (!best) return null;
    const e = explainFlight(ctx.net, ctx.res, best.f.id, ctx.weather);
    if (!e || !e.root || e.root.flight === best.f.num) return null;
    return { f: best.f, root: e.root, delay: best.f.adep - best.f.std, hours: (best.f.adep - t0) / 60 };
  }
  function brief(ctx) {
    const L = new Ledger(),
      net = ctx.net,
      now = ctx.now,
      m = DS.metricsAt(ctx.res, now),
      P = problems(net, ctx.weather, now),
      tz = net.meta.tzLabel,
      para = [];
    const probTxt = P.length
      ? P.map(p => {
          const where = p.hits.length
            ? p.hits
                .slice(0, 3)
                .map(h => placeName(net, h.code) + ' ' + h.status)
                .join(', ')
            : 'open airspace near ' + placeName(net, p.near);
          return (
            (p.state === 'forecast'
              ? art(p.type) + ' ' + p.type.toLowerCase() + ' is forecast from '
              : p.state === 'active'
                ? art(p.type) + ' ' + p.type.toLowerCase() + ' is in progress until '
                : art(p.type) + ' ' + p.type.toLowerCase() + ' cleared at ') +
            L.t('problem_' + p.type, p.state === 'forecast' ? p.start : p.end) +
            ' — ' +
            where
          );
        }).join('; ')
      : '';
    para.push(
      'It is ' +
        L.t('now', now) +
        ' ' +
        tz +
        '. ' +
        (probTxt ? 'Right now ' + probTxt + '.' : 'There are no problems on the map — a clear day.')
    );
    if (m.due)
      para.push(
        'Of the ' +
          L.n('due_flights', m.due) +
          ' flights scheduled so far, ' +
          L.n('late_flights', m.delayed) +
          ' are late, ' +
          L.n('cancelled_flights', m.cancelled) +
          ' cancelled and ' +
          L.n('diverted_flights', m.diverted) +
          ' diverted (' +
          L.n('on_time_pct', m.otp * 100, { unit: '%' }) +
          ' on time). Passengers have lost ' +
          L.n('pax_hours_so_far', m.paxDelayMin / 60) +
          ' hours so far; ' +
          L.n('stranded_so_far', m.stranded) +
          ' are stranded and ' +
          L.n('missed_so_far', m.missedPax) +
          ' have missed a connection.'
      );
    const dg = DS.diagnose(net, ctx.res, now),
      tot = dg.direct + dg.knock;
    if (tot > 600) {
      const top = dg.roots[0],
        knockPct = (dg.knock / tot) * 100;
      para.push(
        '<b>Why:</b> ' +
          L.n('knock_on_pct', knockPct, { unit: '%' }) +
          ' of the delay is knock-on — flights late only because their <i>aircraft</i> was late — and ' +
          L.n('direct_pct', 100 - knockPct, { unit: '%' }) +
          ' is the closure itself. The biggest single root cause is ' +
          (top.root === 'en-route' ? 'storm detours' : placeName(net, top.root)) +
          ', behind ' +
          L.n('root_pct', (top.total / tot) * 100, { unit: '%' }) +
          ' of it (' +
          L.n('root_pax_hours', top.total / 60) +
          ' passenger-hours across ' +
          L.n('root_flights', top.flights + top.cancels) +
          ' flights).'
      );
    }
    const crews = crewRows(net, ctx.res, ctx.plan),
      risk = crews.filter(c => c.status === 'at risk' || c.status === 'timed out');
    if (risk.length)
      para.push(
        '<b>Crews:</b> ' +
          L.n('crews_at_risk', risk.length) +
          ' crew' +
          (risk.length > 1 ? 's are' : ' is') +
          ' at or past the legal duty limit; the tightest is ' +
          esc(risk[0].crew) +
          ' on ' +
          esc(risk[0].aircraft) +
          ' with ' +
          L.n('crew_margin', Math.max(0, risk[0].marginMin)) +
          ' minutes of margin' +
          (risk[0].timedOutFlights
            ? ' — ' +
              L.n('crew_timeouts', risk[0].timedOutFlights) +
              ' flight' +
              (risk[0].timedOutFlights > 1 ? 's were' : ' was') +
              ' cancelled when the limit was hit.'
            : '.')
      );
    const ex = knockOnExample(ctx);
    if (ex)
      para.push(
        '<b>The domino effect, in one flight:</b> ' +
          esc(ex.f.num) +
          ' (' +
          ex.f.orig +
          '→' +
          ex.f.dest +
          ') runs ' +
          L.n('ex_delay', ex.delay) +
          ' minutes late, ' +
          L.n('ex_hours', ex.hours, { dec: 1 }) +
          ' hours after the first problem began — and neither of its airports is affected. Its aircraft ' +
          esc(ex.f.tail) +
          ' earlier flew ' +
          esc(ex.root.flight) +
          ' (' +
          ex.root.route +
          '), which was held at ' +
          esc(placeName(net, ex.root.airport)) +
          ' and left ' +
          L.n('ex_root_delay', Math.max(0, ex.root.delayedDepartureMin)) +
          ' minutes late; the delay has been handed down the chain ever since.'
      );
    para.push(
      ctx.plan.length
        ? 'Your plan currently applies ' +
            L.n('plan_actions', ctx.plan.length) +
            ' measure' +
            (ctx.plan.length > 1 ? 's' : '') +
            '.'
        : 'No recovery measures have been applied yet — ask me to recommend one.'
    );
    return finish(
      'Situation briefing',
      para,
      L,
      ctx,
      ex
        ? {
            example: { delay: ex.delay, hours: ex.hours, rootDelay: Math.max(0, ex.root.delayedDepartureMin) }
          }
        : undefined
    );
  }

  function recommend(ctx) {
    const L = new Ledger(),
      ev = evaluateCandidates(ctx, 5),
      para = [];
    if (!ctx.weather.length) {
      para.push(
        'There is no disruption to recover from. Close an airport or plant a problem and I will test every recovery measure for you.'
      );
      return finish('Recommendation', para, L, ctx);
    }
    if (!ev.items.length) {
      para.push(
        'I tested ' +
          L.n('tested', ev.tested) +
          ' recovery measures at ' +
          L.t('now', ctx.now) +
          ' and none of them improves ' +
          DS.OBJ[ev.objective].label.toLowerCase() +
          ' any further. The current plan is already the best available.'
      );
      return finish('Recommendation', para, L, ctx, { evidence: ev });
    }
    const top = ev.items[0],
      b = top.before,
      a = top.after,
      fb = ctx.res.flights,
      fa = top.resAfter.flights;
    const rescued = fb.filter(
      (f, i) =>
        (f.status === 'cancelled' || f.aarr - f.sta > 15) &&
        fa[i].status === 'ok' &&
        fa[i].aarr - fa[i].sta <= 15
    ).length;
    const o = DS.OBJ[ev.objective],
      key = ev.objective === 'pax' ? 'paxHours' : ev.objective === 'flights' ? 'aircraftHours' : 'stranded';
    para.push(
      'I tested ' +
        L.n('tested', ev.tested) +
        ' recovery measures against the whole day, scoring each on <b>' +
        o.label.toLowerCase() +
        '</b>. <b>Recommended: ' +
        esc(top.title) +
        '.</b>'
    );
    para.push(
      'It cuts ' +
        o.label.toLowerCase() +
        ' from ' +
        L.n('before_obj', b[key]) +
        ' to ' +
        L.n('after_obj', a[key]) +
        ' ' +
        o.unit +
        ' (' +
        L.n('gain_obj', b[key] - a[key]) +
        ' fewer), ' +
        (rescued
          ? 'recovers ' +
            L.n('rescued', rescued) +
            ' flight' +
            (rescued === 1 ? '' : 's') +
            ' that would otherwise be late or cancelled, and '
          : 'and ') +
        (b.stranded - a.stranded >= 1
          ? 'keeps ' + L.n('stranded_saved', b.stranded - a.stranded) + ' fewer people stranded'
          : a.stranded > b.stranded
            ? 'strands ' + L.n('stranded_more', a.stranded - b.stranded) + ' more people'
            : 'leaves stranded passengers unchanged') +
        '.'
    );
    para.push(reasonFor(ctx, top, L));
    // the brief's two headline actions side by side: what the OTHER of {swap a spare, cancel the rotation} would do for the same flight
    let cmp = null;
    if (top.action.flight != null && (top.action.type === 'swap' || top.action.type === 'cancel')) {
      const fo = DS.fixOptions(
          ctx.net,
          ctx.weather,
          ctx.plan,
          ctx.now,
          top.action.flight,
          ev.objective,
          ctx.res
        ),
        other = fo.find(
          o => o.action.type !== top.action.type && (o.action.type === 'cancel' || o.action.type === 'swap')
        );
      if (other) {
        const f = ctx.res.flights[top.action.flight],
          delta = other.gain / o.div,
          word =
            other.action.type === 'cancel'
              ? 'cancelling the rotation that starts with'
              : 'swapping in a spare for';
        cmp = { value: Math.abs(delta) };
        para.push(
          '<b>For comparison:</b> ' +
            word +
            ' ' +
            esc(f.num) +
            ' instead would ' +
            (delta >= 0 ? 'cut' : 'add') +
            ' ' +
            L.n('cmp_delta', Math.abs(delta)) +
            ' ' +
            o.unit +
            (delta >= 0
              ? ' — less than the recommendation.'
              : ' — it makes things worse, so the dispatcher does not recommend it.')
        );
      }
    }
    if (ev.items.length > 1)
      para.push(
        'Next best: ' +
          ev.items
            .slice(1, 4)
            .map(
              it =>
                esc(it.title) +
                ' (−' +
                L.n('alt_' + it.id, it.before[key] - it.after[key]) +
                ' ' +
                o.unit +
                ')'
            )
            .join('; ') +
          '.'
      );
    return finish('Recommendation', para, L, ctx, { evidence: ev, top, cmp });
  }
  function reasonFor(ctx, top, L) {
    const a = top.action,
      f = ctx.res.flights[a.flight];
    switch (a.type) {
      case 'swap':
        return (
          '<b>Why it works:</b> ' +
          esc(f.num) +
          ' is predicted ' +
          L.n('flight_delay', Math.max(0, f.adep - f.std)) +
          ' minutes late leaving ' +
          f.orig +
          '. A fresh aircraft and crew from the spare pool take over that flight and the rest of its rotation, so the later flights on that aircraft stop inheriting the delay.'
        );
      case 'cancel':
        return (
          '<b>Why it works:</b> ' +
          esc(f.num) +
          ' would leave ' +
          L.n('flight_delay', Math.max(0, f.adep - f.std)) +
          ' minutes late. Cancelling the rotation early frees the aircraft and protects passengers before they reach the airport.'
        );
      case 'gdp':
        return '<b>Why it works:</b> holding flights on the ground at their origin until the destination can accept them avoids aircraft burning fuel in holding patterns or diverting, and keeps them where crews and spares are.';
      case 'hold':
        return (
          '<b>Why it works:</b> waiting up to ' +
          L.n('hold_min', a.mins) +
          ' minutes lets late feeder aircraft deliver their connecting passengers instead of stranding them.'
        );
      case 'fastturn':
        return (
          '<b>Why it works:</b> shaving ' +
          L.n('turn_cut', a.cut || 10) +
          ' minutes off each minimum turnaround lets late aircraft absorb delay before the next departure.'
        );
      case 'crew':
        return '<b>Why it works:</b> a longer duty limit stops the evening flights of long-delayed crews from being cancelled when they would otherwise time out.';
      case 'surge':
        return '<b>Why it works:</b> more runway throughput clears the backlog faster once the airport reopens.';
      case 'rebook':
        return '<b>Why it works:</b> passengers are moved onto the next seats instead of waiting in counter queues.';
    }
    return '';
  }

  function passengers(ctx) {
    const L = new Ledger(),
      px = ctx.res.pax,
      para = [],
      now = ctx.now,
      ev = px.list.filter(l => l.tEvent <= now);
    para.push(
      'Over the whole day ' +
        L.n('pax_total', px.total) +
        ' passengers travel; ' +
        L.n('pax_delayed', px.delayed) +
        ' arrive more than a quarter-hour late, ' +
        L.n('pax_missed', px.missedPax) +
        ' miss a connection, ' +
        L.n('pax_rebooked', px.rebooked) +
        ' are rebooked on later flights and ' +
        L.n('pax_stranded', px.stranded) +
        ' are stranded overnight.'
    );
    if (ev.length)
      para.push(
        'Worst-hit journeys so far: ' +
          ev
            .slice(0, 3)
            .map(
              l =>
                esc(l.label) +
                ' — ' +
                L.n('j_' + l.label, l.pax) +
                ' passengers (' +
                (l.kind === 'missed' ? 'missed connection' : 'flight cancelled') +
                ')'
            )
            .join('; ') +
          '.'
      );
    return finish('Passengers', para, L, ctx);
  }
  function crews(ctx) {
    const L = new Ledger(),
      rows = crewRows(ctx.net, ctx.res, ctx.plan),
      para = [];
    const bad = rows.filter(r => r.status !== 'ok');
    para.push(
      L.n('crew_total', rows.length) +
        ' crews are flying today; ' +
        L.n('crew_flagged', bad.length) +
        ' are within an hour and a half of their legal duty limit or past it.'
    );
    if (bad.length)
      para.push(
        bad
          .slice(0, 4)
          .map(
            r =>
              esc(r.crew) +
              ' (' +
              esc(r.aircraft) +
              '): duty ends ' +
              L.t('c_end_' + r.crew, r.legalEnd) +
              ', projected finish ' +
              L.t('c_fin_' + r.crew, r.projectedFinish) +
              (r.timedOutFlights
                ? ', ' + L.n('c_to_' + r.crew, r.timedOutFlights) + ' flight(s) cancelled'
                : '')
          )
          .join('; ') + '.'
      );
    return finish('Crew duty', para, L, ctx);
  }
  // after the user applies something: state the before/after of the whole day, from engine snapshots
  function applied(ctx, before, title, action) {
    const L = new Ledger(),
      after = snapshot(ctx.net, ctx.res),
      para = [];
    const d = (b, a) =>
      b >= a
        ? ' (' + L.n('d_' + L.items.length, b - a, { dec: b - a < 10 && (b - a) % 1 ? 1 : 0 }) + ' fewer)'
        : ' (' + L.n('d_' + L.items.length, a - b) + ' more)';
    para.push(
      'Applied <b>' +
        esc(title) +
        '</b>, effective ' +
        L.t('applied_at', ctx.now) +
        '. Over the whole day passenger delay goes from ' +
        L.n('b_pax', before.paxHours) +
        ' to ' +
        L.n('a_pax', after.paxHours) +
        ' hours' +
        d(before.paxHours, after.paxHours) +
        '; flights arriving late go from ' +
        L.n('b_late', before.lateFlights) +
        ' to ' +
        L.n('a_late', after.lateFlights) +
        '; cancellations from ' +
        L.n('b_cx', before.cancelled) +
        ' to ' +
        L.n('a_cx', after.cancelled) +
        '; people stranded from ' +
        L.n('b_str', before.stranded) +
        ' to ' +
        L.n('a_str', after.stranded) +
        '.'
    );
    return finish('Result of your decision', para, L, ctx, { before, after, action });
  }
  function whyFlight(ctx, id) {
    const L = new Ledger(),
      e = explainFlight(ctx.net, ctx.res, id, ctx.weather),
      para = [];
    if (!e) return finish('Why?', ['I could not find that flight.'], L, ctx);
    if (e.status === 'cancelled') {
      para.push(
        esc(e.flight) +
          ' (' +
          e.route +
          ') is cancelled: ' +
          e.cancelReason +
          '. It carried ' +
          L.n('pax_board', e.passengersOnBoard) +
          ' passengers' +
          (e.connectingPassengersMissed
            ? ', ' + L.n('conn_missed', e.connectingPassengersMissed) + ' of them connecting'
            : '') +
          '.'
      );
    } else if (e.departureDelayMin < 5 && e.arrivalDelayMin < 5) {
      para.push(
        esc(e.flight) +
          ' (' +
          e.route +
          ') is running to schedule: departure ' +
          L.t('std', e.scheduledDeparture) +
          ', arrival ' +
          L.t('sta', e.scheduledArrival) +
          '.'
      );
    } else {
      const c = e.components,
        parts = [];
      if (c.lateInboundAircraftMin >= 1)
        parts.push(L.n('c_react', c.lateInboundAircraftMin) + ' min waiting for its late aircraft');
      if (c.weatherOrRunwayQueueMin >= 1)
        parts.push(L.n('c_wx', c.weatherOrRunwayQueueMin) + ' min queuing behind a closure or restriction');
      if (c.congestionQueueMin >= 1)
        parts.push(L.n('c_cong', c.congestionQueueMin) + ' min in a runway queue');
      if (c.groundHoldMin >= 1) parts.push(L.n('c_gdp', c.groundHoldMin) + ' min of ground hold');
      if (c.connectionHoldMin >= 1)
        parts.push(L.n('c_hold', c.connectionHoldMin) + ' min held for connecting passengers');
      if (c.stormDetourMin >= 1) parts.push(L.n('c_det', c.stormDetourMin) + ' min flying around a storm');
      if (c.airborneHoldMin >= 1) parts.push(L.n('c_air', c.airborneHoldMin) + ' min holding in the air');
      para.push(
        esc(e.flight) +
          ' (' +
          e.route +
          ', aircraft ' +
          esc(e.aircraft) +
          ') leaves ' +
          L.n('dep_delay', Math.max(0, e.departureDelayMin)) +
          ' min late (scheduled ' +
          L.t('std', e.scheduledDeparture) +
          ', now ' +
          L.t('adep', e.actualDeparture) +
          ') and arrives ' +
          L.n('arr_delay', Math.max(0, e.arrivalDelayMin)) +
          ' min late. ' +
          (parts.length ? 'That is ' + parts.join(' + ') + '.' : '')
      );
      if (e.root && e.root.flight !== e.flight) {
        const r = e.root;
        para.push(
          '<b>Where it started:</b> the same aircraft’s earlier flight ' +
            esc(r.flight) +
            ' (' +
            r.route +
            ') was hit by ' +
            esc(r.problem.toLowerCase()) +
            ' at ' +
            esc(placeName(ctx.net, r.airport)) +
            ' and left ' +
            L.n('root_dep', Math.max(0, r.delayedDepartureMin)) +
            ' min late' +
            (r.diverted ? ', diverting to ' + esc(r.diverted) : '') +
            '. ' +
            e.hops
              .filter(h => h.carriedToNextMin != null)
              .slice(0, 3)
              .map(
                h =>
                  esc(h.flight) +
                  ' arrived ' +
                  L.n('h_arr_' + h.flight, h.arrivalDelayMin) +
                  ' min late; only ' +
                  L.n('h_buf_' + h.flight, h.turnaroundBufferMin) +
                  ' min of turnaround buffer could absorb it, so ' +
                  L.n('h_carry_' + h.flight, h.carriedToNextMin) +
                  ' min carried on.'
              )
              .join(' ')
        );
      }
      if (e.laterFlightsOnSameAircraftDelayed)
        para.push(
          L.n('later', e.laterFlightsOnSameAircraftDelayed) +
            ' later flight' +
            (e.laterFlightsOnSameAircraftDelayed > 1 ? 's' : '') +
            ' on this aircraft are also delayed or cancelled.'
        );
      if (e.connectingPassengersMissed)
        para.push(
          L.n('conn', e.connectingPassengersMissed) +
            ' connecting passengers miss their onward flight because of it.'
        );
    }
    return finish(
      'Why is ' + e.flight + ' ' + (e.status === 'cancelled' ? 'cancelled' : 'late') + '?',
      para,
      L,
      ctx,
      { flight: e }
    );
  }

  function finish(title, para, L, ctx, extra) {
    const html = para.map(p => '<p>' + p + '</p>').join(''),
      text = plain(html);
    // audit against ground truth recomputed straight from the engine, NOT from what the narrator says it used
    const ground = groundTruth(ctx, extra);
    const v = verifyText(text, ground, identifiers(ctx.net));
    return Object.assign(
      { title, html, text, ledger: L.items, verification: v, source: 'dispatcher' },
      extra || {}
    );
  }

  // ---------------------------------------------------------------- free-text routing for the offline dispatcher
  function answer(ctx, q, selectedFlightId) {
    q = String(q || '').trim();
    const low = q.toLowerCase();
    const num = q.match(/\b([A-Za-z]{2}\s?\d{2,4})\b/);
    let fid = null;
    if (num) {
      const key = num[1].replace(/\s/g, '').toUpperCase();
      const f = ctx.res.flights.find(x => x.num.toUpperCase() === key);
      if (f) fid = f.id;
    }
    if (fid == null && /(this|selected|that)\s+flight/.test(low)) fid = selectedFlightId;
    if (
      (fid != null && /(why|late|delay|cancel|how come|reason|cause)/.test(low)) ||
      (fid != null && !/recommend|fix/.test(low))
    )
      return whyFlight(ctx, fid);
    if (/(strand|passenger|pax|connection|rebook)/.test(low)) return passengers(ctx);
    if (/(crew|duty|pilot)/.test(low)) return crews(ctx);
    if (/(recommend|should|fix|recover|best|help|action|improve|swap|cancel|what can|what do)/.test(low))
      return recommend(ctx);
    if (/(why|where|cause|root)/.test(low) && selectedFlightId != null)
      return whyFlight(ctx, selectedFlightId);
    return brief(ctx);
  }

  DS.Dispatcher = {
    snapshot,
    METRICS,
    problems,
    crewRows,
    explainFlight,
    evaluateCandidates,
    brief,
    recommend,
    passengers,
    crews,
    whyFlight,
    applied,
    answer,
    hhmm,
    actionTitle,
    Ledger
  };
  if (typeof module !== 'undefined') module.exports = DS;
})(typeof window !== 'undefined' ? window : globalThis);
