/* Domino Sky — engine part 2: what a finished simulation means.
   Costs, the metrics at any moment, delay build-up series, and airport / carrier standings. All read the result of
   DS.simulate; nothing here changes it. Loaded after engine.js; registers on DS. */
(function (G) {
  'use strict';
  const DS = G.DS;
  const { RATE } = DS;

  function computeCosts(net, res, plan) {
    const fl = res.flights;
    let delayMin = 0,
      cancels = 0,
      proCancels = 0,
      diverts = 0,
      crewUsed = 0,
      fastUsed = 0;
    fl.forEach(f => {
      if (f.status === 'cancelled') {
        if (f.proactive) proCancels++;
        else cancels++;
        return;
      }
      delayMin += Math.max(0, f.aarr - f.sta);
      if (f.divert) diverts++;
      if (f.crewExt) crewUsed++;
      if (f.fastTurn) fastUsed++;
    });
    const px = res.pax;
    const c = {
      delay: delayMin * RATE.delayMin,
      paxDelay: px.paxMin * RATE.paxMin,
      cancel: cancels * RATE.cancel + proCancels * RATE.cancelPro,
      divert: diverts * RATE.divert,
      stranded: px.stranded * RATE.stranded,
      spare:
        res.spareUsed.length * RATE.spare + res.spareUsed.filter(s => s.reposition).length * RATE.spareRepo,
      crew: crewUsed * RATE.crewFlight,
      fast: fastUsed * RATE.fastTurn,
      surge: res.plan.surge.length * RATE.surge,
      rebook: res.plan.rebook ? px.rebooked * RATE.rebook : 0
    };
    c.recovery = c.spare + c.crew + c.fast + c.surge + c.rebook;
    c.disruption = c.delay + c.paxDelay + c.cancel + c.divert + c.stranded;
    c.total = c.disruption + c.recovery;
    c.counts = { delayMin, cancels: cancels + proCancels, diverts, crewUsed, fastUsed };
    return c;
  }

  // ---- metrics ---------------------------------------------------------------
  function metricsAt(res, t) {
    let paxDelay = 0,
      due = 0,
      onTime = 0,
      delayMin = 0,
      cancelled = 0,
      diverted = 0,
      airborne = 0,
      waiting = 0,
      delayed = 0,
      worst = 0;
    for (const f of res.flights) {
      const cancelKnown =
        f.status === 'cancelled' && Math.min(f.cancelAt == null ? f.std : f.cancelAt, f.std) <= t;
      const isDue = f.std <= t || cancelKnown;
      if (!isDue) continue;
      due++;
      if (f.status === 'cancelled') {
        cancelled++;
        continue;
      }
      const d = f.adep != null && f.adep <= t ? f.adep - f.std : t - f.std;
      if (d <= 15) onTime++;
      else delayed++;
      if (f.adep > t) waiting++;
      delayMin += Math.max(0, d);
      paxDelay += f.load * Math.max(0, d);
      if (d > worst) worst = d;
      if (f.adep <= t && f.aarr > t) airborne++;
    }
    for (const f of res.flights) if (f.divert && f.eta <= t) diverted++;
    let missed = 0,
      stranded = 0,
      rebooked = 0;
    for (const e of res.pax.events)
      if (e.t <= t) {
        missed += e.pax;
        stranded += e.stranded;
        rebooked += e.rebooked;
      }
    return {
      paxDelayMin: paxDelay,
      due,
      onTime,
      otp: due ? onTime / due : 1,
      delayMin,
      cancelled,
      diverted,
      airborne,
      waiting,
      delayed,
      worst,
      missedPax: missed,
      stranded,
      rebooked
    };
  }
  function series(res, from, to, step) {
    const T = [],
      D = [],
      C = [],
      P = [];
    for (let t = from; t <= to; t += step) {
      const m = metricsAt(res, t);
      T.push(t);
      D.push(m.delayMin);
      C.push(m.cancelled);
      P.push(m.paxDelayMin / 60);
    }
    return { t: T, delay: D, cancelled: C, pax: P };
  }
  function airportStandings(net, res, t) {
    const rows = {};
    net.airports.forEach(
      a =>
        (rows[a.code] = {
          code: a.code,
          city: a.city,
          dep: 0,
          onTime: 0,
          delaySum: 0,
          cancelled: 0,
          queue: 0,
          gen: 0,
          status: 'ok'
        })
    );
    for (const f of res.flights) {
      const r = rows[f.orig];
      const cancelKnown =
        f.status === 'cancelled' && Math.min(f.cancelAt == null ? f.std : f.cancelAt, f.std) <= t;
      if (!(f.std <= t || cancelKnown)) continue;
      r.dep++;
      if (f.status === 'cancelled') {
        r.cancelled++;
        continue;
      }
      const d = f.adep != null && f.adep <= t ? f.adep - f.std : t - f.std;
      if (d <= 15) r.onTime++;
      r.delaySum += Math.max(0, d);
      if (f.adep > t) r.queue++;
      if (f.gen >= 1 && d > 15) r.gen++;
    }
    return Object.values(rows).map(r =>
      Object.assign(r, {
        otp: r.dep ? r.onTime / r.dep : 1,
        avg: r.dep - r.cancelled > 0 ? r.delaySum / (r.dep - r.cancelled) : 0
      })
    );
  }
  function carrierStandings(net, res, t) {
    const rows = {};
    net.airlines.forEach(
      a =>
        (rows[a.code] = {
          code: a.code,
          name: a.name,
          color: a.color,
          dep: 0,
          onTime: 0,
          delaySum: 0,
          cancelled: 0
        })
    );
    for (const f of res.flights) {
      const r = rows[f.airline];
      const cancelKnown =
        f.status === 'cancelled' && Math.min(f.cancelAt == null ? f.std : f.cancelAt, f.std) <= t;
      if (!(f.std <= t || cancelKnown)) continue;
      r.dep++;
      if (f.status === 'cancelled') {
        r.cancelled++;
        continue;
      }
      const d = f.adep != null && f.adep <= t ? f.adep - f.std : t - f.std;
      if (d <= 15) r.onTime++;
      r.delaySum += Math.max(0, d);
    }
    return Object.values(rows).map(r =>
      Object.assign(r, {
        otp: r.dep ? r.onTime / r.dep : 1,
        avg: r.dep - r.cancelled > 0 ? r.delaySum / (r.dep - r.cancelled) : 0
      })
    );
  }

  Object.assign(DS, { computeCosts, metricsAt, series, airportStandings, carrierStandings });
  if (typeof module !== 'undefined') module.exports = DS;
})(typeof window !== 'undefined' ? window : globalThis);
