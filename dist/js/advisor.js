/* Domino Sky — engine part 3: the recovery advisor.
   Evaluates every candidate measure by re-running DS.simulate with it applied, ranks them by the chosen objective, and
   diagnoses root causes. The AI dispatcher only quotes what this module computes. Loaded after engine-metrics.js. */
(function (G) {
  'use strict';
  const DS = G.DS;
  const { simulate, MIN_TURN } = DS;

  // delay attribution over the whole day
  function attribution(res) {
    const a = { weather: 0, reactionary: 0, congestion: 0, measures: 0, minor: 0, airborne: 0 };
    res.flights.forEach(f => {
      if (f.status !== 'ok') return;
      if (f.slotWx) a.weather += f.slot;
      else a.congestion += f.slot;
      a.reactionary += f.react;
      a.measures += f.hold + f.gdp;
      a.minor += f.noise;
      if (f.airWx) a.airborne += f.airHold;
      else a.congestion += f.airHold;
      a.airborne += f.detour;
    });
    return a;
  }
  function generations(res) {
    const g = [];
    res.flights.forEach(f => {
      if (f.status !== 'ok' || f.gen < 0) return;
      const k = Math.min(f.gen, 5);
      g[k] = g[k] || { n: 0, min: 0 };
      g[k].n++;
      g[k].min += Math.max(0, f.aarr - f.sta);
    });
    for (let i = 0; i < g.length; i++) g[i] = g[i] || { n: 0, min: 0 };
    return g;
  }

  // ---- advisor ---------------------------------------------------------------
  function affected(net, weather) {
    const m = {};
    weather.forEach(e =>
      net.airports.forEach(a => {
        const v = G.DS.effSev(e, a);
        if (v > 0.3) m[a.code] = Math.max(m[a.code] || 0, v);
      })
    );
    return Object.keys(m)
      .sort((a, b) => m[b] - m[a])
      .slice(0, 4);
  }
  function candidates(net, weather, plan, now) {
    const out = [];
    const wxCodes = affected(net, weather);
    const has = (type, key) => plan.some(a => a.type === type && (!key || a.airport === key));
    const cur = simulate(net, weather, plan);
    wxCodes.forEach(c => {
      if (!has('gdp', c) && !has('gdp', 'ALL'))
        out.push({ label: `Ground-delay program for ${c}`, action: { type: 'gdp', airport: c, from: now } });
      if (!plan.some(a => a.type === 'surge' && a.airport === c))
        out.push({
          label: `Surge ops at ${c} (+25% capacity)`,
          action: { type: 'surge', airport: c, from: now, pct: 25 }
        });
      if (!has('fastturn', c))
        out.push({
          label: `Fast turnarounds at ${c}`,
          action: { type: 'fastturn', airport: c, from: now, cut: 10 }
        });
    });
    if (!has('gdp', 'ALL'))
      out.push({
        label: 'Network-wide ground-delay program',
        action: { type: 'gdp', airport: 'ALL', from: now }
      });
    if (!has('hold', 'ALL')) {
      out.push({
        label: 'Hold connections up to 20 min (all airports)',
        action: { type: 'hold', airport: 'ALL', mins: 20, from: now }
      });
      out.push({
        label: 'Hold connections up to 35 min (all airports)',
        action: { type: 'hold', airport: 'ALL', mins: 35, from: now }
      });
    }
    if (!has('fastturn', 'ALL'))
      out.push({
        label: 'Fast turnarounds network-wide',
        action: { type: 'fastturn', airport: 'ALL', from: now, cut: 10 }
      });
    if (!net.hardCrewLimit && !plan.some(a => a.type === 'crew'))
      out.push({ label: 'Extend crew duty by 2 h', action: { type: 'crew', from: now, extra: 120 } }); // never offered when the duty limit is a legal hard limit
    if (!plan.some(a => a.type === 'rebook'))
      out.push({
        label: 'Auto-rebook & care for disrupted passengers',
        action: { type: 'rebook', from: now }
      });
    // swaps: best late flights at airports that host a free spare
    const freeSpares = net.tails.filter(
      t => t.spare && !plan.some(a => a.type === 'swap' && a.spare === t.id)
    );
    const late = cur.flights
      .filter(f => f.status === 'ok' && f.std >= now && f.adep - f.std >= 30 && !f.swapped)
      .sort((a, b) => b.adep - b.std - (a.adep - a.std))
      .slice(0, 14);
    late.forEach(f => {
      const sp = freeSpares.slice().sort((a, b) => net.dist(a.base, f.orig) - net.dist(b.base, f.orig))[0];
      if (sp)
        out.push({
          label: `Swap in spare ${sp.id} for ${f.num} ${f.orig}→${f.dest}`,
          action: { type: 'swap', flight: f.id, spare: sp.id, from: now }
        });
    });
    // proactive rotation cancels for badly delayed flights
    cur.flights
      .filter(
        f =>
          f.status === 'ok' &&
          f.std >= now + 30 &&
          f.adep - f.std >= 150 &&
          !plan.some(a => a.type === 'cancel' && a.flight === f.id)
      )
      .sort((a, b) => b.adep - b.std - (a.adep - a.std))
      .slice(0, 8)
      .forEach(f =>
        out.push({
          label: `Cancel rotation from ${f.num} ${f.orig}→${f.dest}`,
          action: { type: 'cancel', flight: f.id, from: now }
        })
      );
    return { cur, list: out };
  }
  // Operational objectives — no money involved.
  const OBJ = {
    pax: { label: 'Passenger delay', short: 'Passengers', unit: 'pax-hours', eps: 300, div: 60 },
    flights: { label: 'Aircraft delay', short: 'Aircraft', unit: 'aircraft-hours', eps: 10, div: 60 },
    stranded: { label: 'People stranded', short: 'Stranded', unit: 'people', eps: 3, div: 1 }
  };
  function objective(res, mode) {
    if (mode === 'flights') {
      let m = 0;
      res.flights.forEach(f => {
        m += f.status === 'ok' ? Math.max(0, f.aarr - f.sta) : 360;
      });
      return m;
    } // a cancelled flight counts as 6 h
    if (mode === 'stranded') return res.pax.stranded + res.pax.paxMin * 1e-7;
    return res.pax.paxMin;
  }
  const detail = (cur, r) => ({
    paxMin: cur.pax.paxMin - r.pax.paxMin,
    delayMin: cur.costs.counts.delayMin - r.costs.counts.delayMin,
    cancels: cur.costs.counts.cancels - r.costs.counts.cancels,
    stranded: cur.pax.stranded - r.pax.stranded,
    spend: r.costs.recovery - cur.costs.recovery
  });
  function advise(net, weather, plan, now, mode) {
    mode = mode || 'pax';
    const { cur, list } = candidates(net, weather, plan, now);
    const base = objective(cur, mode),
      items = [];
    list.forEach(c => {
      const r = simulate(net, weather, plan.concat([Object.assign({ id: -1 }, c.action)]));
      items.push(
        Object.assign({ label: c.label, action: c.action, gain: base - objective(r, mode) }, detail(cur, r))
      );
    });
    return {
      base: cur,
      baseObj: base,
      mode,
      tested: list.length,
      items: items.filter(i => i.gain > OBJ[mode].eps).sort((a, b) => b.gain - a.gain)
    };
  }
  // What would swapping a spare in / cancelling the rotation do for ONE flight?
  function fixOptions(net, weather, plan, now, fid, mode, cur) {
    cur = cur || simulate(net, weather, plan);
    mode = mode || 'pax';
    const f = cur.flights[fid],
      out = [],
      base = objective(cur, mode);
    const used = plan.filter(a => a.type === 'swap').map(a => a.spare);
    const sp = net.tails
      .filter(t => t.spare && !used.includes(t.id))
      .sort((a, b) => net.dist(a.base, f.orig) - net.dist(b.base, f.orig))[0];
    const tryIt = (label, action) => {
      const r = simulate(net, weather, plan.concat([Object.assign({ id: -1 }, action)]));
      out.push(Object.assign({ label, action, gain: base - objective(r, mode) }, detail(cur, r)));
    };
    if (sp) tryIt('Swap in spare ' + sp.id, { type: 'swap', flight: fid, spare: sp.id, from: now });
    tryIt('Cancel rotation', { type: 'cancel', flight: fid, from: now });
    return out.sort((a, b) => b.gain - a.gain);
  }

  // Where is the damage coming from, and which flights are about to fall next?
  function diagnose(net, res, now) {
    const fl = res.flights,
      caused = res.pax.caused || {},
      roots = {};
    let direct = 0,
      knock = 0;
    fl.forEach(f => {
      if (f.std > now) return;
      const cp = (caused[f.id] || 0) * 180;
      if (f.status === 'ok') {
        if (f.gen < 0) return;
        const key = f.root || 'other',
          pm = f.load * Math.max(0, f.aarr - f.sta) + cp;
        const r = (roots[key] = roots[key] || {
          root: key,
          flights: 0,
          gen0: 0,
          direct: 0,
          knock: 0,
          cancels: 0,
          missedPax: 0
        });
        r.flights++;
        r.missedPax += caused[f.id] || 0;
        if (f.gen === 0) {
          r.direct += pm;
          r.gen0++;
          direct += pm;
        } else {
          r.knock += pm;
          knock += pm;
        }
      } else {
        const key = f.root || 'other',
          r = (roots[key] = roots[key] || {
            root: key,
            flights: 0,
            gen0: 0,
            direct: 0,
            knock: 0,
            cancels: 0,
            missedPax: 0
          });
        r.cancels++;
        r.missedPax += caused[f.id] || 0;
        r.knock += cp;
        knock += cp;
      }
    });
    const list = Object.values(roots)
      .map(r => Object.assign(r, { total: r.direct + r.knock }))
      .sort((a, b) => b.total - a.total);
    // upcoming flights that are already predicted late, with what they will drag down behind them
    const risks = [];
    fl.forEach(f => {
      if (f.status !== 'ok' || f.std < now || f.adep - f.std < 20) return;
      const T = res.tails[f.tail],
        pos = T.chain.indexOf(f.id);
      let kF = 0,
        kPax = 0,
        slack = null;
      for (let k = pos + 1; k < T.chain.length; k++) {
        const g = fl[T.chain[k]];
        if (k === pos + 1) slack = g.std - f.sta - (net.minTurn || MIN_TURN);
        if (g.status === 'cancelled') {
          kF++;
          kPax += g.load * 120;
          continue;
        }
        const d = g.aarr - g.sta;
        if (d > 15) {
          kF++;
          kPax += g.load * d;
        }
      }
      const own = f.load * Math.max(0, f.aarr - f.sta),
        cp = (caused[f.id] || 0) * 180;
      risks.push({
        id: f.id,
        delay: f.adep - f.std,
        slack,
        kF,
        kPax,
        own,
        caused: caused[f.id] || 0,
        score: own + kPax + cp,
        root: f.root
      });
    });
    risks.sort((a, b) => b.score - a.score);
    return { roots: list, direct, knock, risks: risks.slice(0, 12) };
  }

  Object.assign(DS, { OBJ, objective, fixOptions, diagnose, affected, attribution, generations, advise });
  if (typeof module !== 'undefined') module.exports = DS;
})(typeof window !== 'undefined' ? window : globalThis);
