/* Domino Sky — AI dispatcher, part 2: the auditor.

   Independently re-reads any finished text (the offline narrator's or a real LLM's), extracts every number and time, and
   checks each against ground truth recomputed straight from the engine. A mismatch is flagged, never hidden. Loaded after
   dispatcher.js; registers its functions on DS.Dispatcher. Pure functions (no DOM), unit-tested in Node. */
(function (G) {
  'use strict';
  const DS = G.DS;
  const { hhmm, snapshot, problems, crewRows } = DS.Dispatcher;

  // truth set used by the auditor
  // ids (optional): when given, numbers written inside returned TEXT (e.g. an action title “hold up to 35 min”) count as tool-provided too,
  // after flight / tail / crew identifiers are removed so an ID such as DS0101 cannot widen what is allowed.
  function collectNumbers(o, out, times, ids) {
    out = out || [];
    times = times || [];
    if (o == null) return { nums: out, times };
    if (typeof o === 'string') {
      if (ids) {
        let t = o;
        ids.forEach(id => {
          if (id) t = t.split(id).join(' ');
        });
        t.replace(/\b(\d{1,2}):(\d{2})\b/g, m => {
          times.push(m);
          return ' ';
        }).replace(/(^|[^A-Za-z0-9_.])(\d[\d,]*(?:\.\d+)?)/g, (m, p, n) => {
          out.push(parseFloat(n.replace(/,/g, '')));
          return m;
        });
      }
      return { nums: out, times };
    }
    if (typeof o === 'string') {
      (o.match(/\d[\d,]*(?:\.\d+)?/g) || []).forEach(s => out.push(parseFloat(s.replace(/,/g, ''))));
      (o.match(/\b\d{1,2}:\d{2}\b/g) || []).forEach(s => times.push(s));
    } else if (typeof o === 'number') {
      if (isFinite(o)) out.push(o);
    } else if (Array.isArray(o)) o.forEach(x => collectNumbers(x, out, times, ids));
    else if (typeof o === 'object')
      Object.keys(o).forEach(k => {
        const v = o[k];
        if (
          typeof v === 'number' &&
          /(now|time|departure|arrival|dep|arr|std|sta|start|end|finish|landedAt|cancelAt|dutyStart|legalEnd|projectedFinish|at)$/i.test(
            k
          ) &&
          v >= 0 &&
          v < 3000 &&
          !/Min$/.test(k)
        ) {
          times.push(hhmm(v).replace('⁺¹', ''));
          times.push(hhmm(v));
        }
        collectNumbers(v, out, times, ids);
      });
    return { nums: out, times };
  }
  function identifiers(net) {
    const ids = new Set();
    net.flights.forEach(f => ids.add(f.num));
    net.tails.forEach(t => {
      ids.add(t.id);
      if (t.crew) ids.add(t.crew);
    });
    return [...ids].sort((a, b) => b.length - a.length);
  }
  // Independent audit: every number and time in `text` must match the engine's output at the precision shown.
  function verifyText(text, truth, ids) {
    let t = String(text).replace(/\u200a/g, '');
    (ids || []).forEach(id => {
      if (id) t = t.split(id).join(' ');
    });
    const times = [],
      toks = [];
    t = t.replace(/\b(\d{1,2}):(\d{2})(?:⁺¹)?/g, m => {
      times.push(m.replace('⁺¹', ''));
      return ' ';
    });
    t.replace(/(^|[^A-Za-z0-9_.])(\d[\d,]*(?:\.\d+)?)(%?)/g, (m, pre, num, pct) => {
      const clean = num.replace(/,/g, '');
      toks.push({ raw: num + pct, num: parseFloat(clean), dec: (clean.split('.')[1] || '').length });
      return m;
    });
    const nums = truth.nums || [],
      okTimes = new Set(truth.times || []);
    const bad = [];
    toks.forEach(k => {
      if (!nums.some(x => Math.abs(Math.abs(x) - k.num) <= 0.5 * Math.pow(10, -k.dec) + 1e-9))
        bad.push(k.raw);
    });
    times.forEach(k => {
      if (!okTimes.has(k)) bad.push(k);
    });
    return { ok: bad.length === 0, checked: toks.length + times.length, bad };
  }

  // everything the engine knows that text may legitimately quote
  function groundTruth(ctx, extra) {
    const now = ctx.now,
      m = DS.metricsAt(ctx.res, now),
      px = ctx.res.pax,
      dg = DS.diagnose(ctx.net, ctx.res, now),
      tot = dg.direct + dg.knock || 1,
      top = dg.roots[0];
    const o = {
      now,
      m: Object.assign({}, m, { hours: m.paxDelayMin / 60, otpPct: m.otp * 100 }),
      full: snapshot(ctx.net, ctx.res),
      base: snapshot(ctx.net, ctx.base),
      plan: ctx.plan.length,
      probs: problems(ctx.net, ctx.weather, now),
      pax: {
        total: px.total,
        delayed: px.delayed,
        missed: px.missedPax,
        rebooked: px.rebooked,
        stranded: px.stranded,
        list: px.list.slice(0, 8).map(l => ({ pax: l.pax }))
      },
      diag: {
        knockPct: (dg.knock / tot) * 100,
        directPct: 100 - (dg.knock / tot) * 100,
        rootPct: top ? (top.total / tot) * 100 : 0,
        rootHours: top ? top.total / 60 : 0,
        rootFlights: top ? top.flights + top.cancels : 0
      },
      crews: crewRows(ctx.net, ctx.res, ctx.plan).slice(0, 8)
    };
    o.planActions = ctx.plan.map(a => ({
      mins: a.mins,
      cut: a.cut || 10,
      extraH: a.extra ? a.extra / 60 : 0,
      pct: a.pct
    })); // parameters of applied measures (e.g. “hold up to 35 min”)
    const crewsAll = crewRows(ctx.net, ctx.res, ctx.plan);
    o.crewsAgg = {
      total: crewsAll.length,
      flagged: crewsAll.filter(c => c.status !== 'ok').length,
      atRisk: crewsAll.filter(c => c.status === 'at risk' || c.status === 'timed out').length
    };
    if (extra && extra.evidence) {
      const ev = extra.evidence;
      o.ev = {
        tested: ev.tested,
        items: ev.items.map(it => ({
          b: it.before,
          a: it.after,
          gainPax: it.before.paxHours - it.after.paxHours,
          gainAc: it.before.aircraftHours - it.after.aircraftHours,
          gainStr: it.before.stranded - it.after.stranded,
          rescued: ctx.res.flights.filter(
            (f, i) =>
              (f.status === 'cancelled' || f.aarr - f.sta > 15) &&
              it.resAfter.flights[i].status === 'ok' &&
              it.resAfter.flights[i].aarr - it.resAfter.flights[i].sta <= 15
          ).length,
          delay: ctx.res.flights[it.action.flight]
            ? Math.max(0, ctx.res.flights[it.action.flight].adep - ctx.res.flights[it.action.flight].std)
            : 0,
          mins: it.action.mins,
          cut: it.action.cut || 10,
          extraH: it.action.extra ? it.action.extra / 60 : 0
        }))
      };
    }
    if (extra && extra.flight) o.flight = extra.flight;
    if (extra && extra.example) o.example = extra.example;
    if (extra && extra.cmp) o.cmp = extra.cmp;
    if (extra && extra.action)
      o.action = {
        mins: extra.action.mins,
        cut: extra.action.cut || 10,
        extraH: extra.action.extra ? extra.action.extra / 60 : 0,
        pct: extra.action.pct
      };
    if (extra && extra.before) {
      o.beforeSnap = extra.before;
      o.afterSnap = extra.after;
      o.delta = {};
      Object.keys(extra.before).forEach(k => {
        o.delta[k] = extra.before[k] - extra.after[k];
      });
    } // differences of two engine snapshots are engine-derived
    return collectNumbers(o);
  }

  Object.assign(DS.Dispatcher, { collectNumbers, identifiers, verifyText, groundTruth });
  if (typeof module !== 'undefined') module.exports = DS;
})(typeof window !== 'undefined' ? window : globalThis);
