// Run: node test/engine.test.js
const DS = require('../js/data.js');
require('../js/engine.js');
require('../js/import.js');
const assert = require('assert');
const net = DS.buildNetwork(2024);
const fmt = v => (v / 1e7).toFixed(2) + ' cr';
console.log(
  'airports',
  net.airports.length,
  'tails',
  net.tails.length,
  'flights',
  net.flights.length,
  'itins',
  net.itins.length,
  'pax',
  net.flights.reduce((s, f) => s + f.load, 0)
);

const none = DS.simulate(net, [], []);
const m0 = DS.metricsAt(none, 1800);
console.log(
  'clear day: OTP',
  (m0.otp * 100).toFixed(1) + '%',
  'delayMin',
  m0.delayMin,
  'cancel',
  m0.cancelled,
  'cost',
  fmt(none.costs.total)
);
assert(m0.cancelled === 0, 'clear day should have no cancellations');

for (const sc of DS.SCENARIOS.filter(s => s.events.length)) {
  const w = sc.events;
  const base = DS.simulate(net, w, []);
  const mb = DS.metricsAt(base, 1800);
  console.log(`\n== ${sc.name}`);
  console.log(
    ' no action: OTP',
    (mb.otp * 100).toFixed(1) + '%',
    'delayMin',
    mb.delayMin,
    'cancel',
    mb.cancelled,
    'div',
    mb.diverted,
    'stranded',
    base.pax.stranded,
    'missedPax',
    base.pax.missedPax,
    'cost',
    fmt(base.costs.total)
  );
  console.log(
    ' attribution',
    JSON.stringify(DS.attribution(base)),
    'gens',
    JSON.stringify(DS.generations(base))
  );
  const t0 = Date.now();
  const adv = DS.advise(net, w, [], 540);
  adv.items.forEach(i => (i.save = i.gain));
  console.log(' advisor took', Date.now() - t0, 'ms; top:');
  adv.items.slice(0, 5).forEach(i => console.log('   ', (i.gain / 60).toFixed(0), 'pax-h', i.label));
  // apply greedy
  let plan = [];
  for (let k = 0; k < 5; k++) {
    const a = DS.advise(net, w, plan, 540);
    if (!a.items.length) break;
    plan = plan.concat([Object.assign({ id: k }, a.items[0].action)]);
  }
  const r = DS.simulate(net, w, plan),
    mr = DS.metricsAt(r, 1800);
  console.log(
    ' optimized (' + plan.length + ' actions): OTP',
    (mr.otp * 100).toFixed(1) + '%',
    'cancel',
    mr.cancelled,
    'stranded',
    r.pax.stranded,
    'cost',
    fmt(r.costs.total),
    'vs',
    fmt(base.costs.total)
  );
  assert(r.costs.total <= base.costs.total, 'optimized plan must not be worse');
  // invariants
  for (const f of base.flights) {
    if (f.status === 'ok') {
      assert(f.adep >= f.std, 'no early departure ' + f.num);
      assert(f.aarr >= f.adep + f.block - 1e-6, 'arrival ≥ dep+block');
    }
  }
  // aircraft continuity: every ok flight starts where the previous ok flight on the tail ended, and not before it landed
  for (const t of net.tails) {
    let loc = t.base,
      ready = -1;
    for (const id of t.flights) {
      const f = base.flights[id];
      if (f.status !== 'ok') continue;
      assert.strictEqual(f.orig, loc, `tail ${t.id} teleported at ${f.num}`);
      assert(f.adep >= ready, `tail ${t.id} departed before landing`);
      loc = f.dest;
      ready = f.aarr;
    }
  }
}
console.log('\nOK');

// ---- free-placed problems -------------------------------------------------
{
  const mk = (type, lat, lon, start, dur, sev, radius) =>
    Object.assign({ id: 1, type, lat, lon, start, dur, severity: sev, radius });
  // 1) open-airspace storm with no airport inside: only routes crossing it are hit (detours)
  const open = [mk('Thunderstorm', 20.5, 80.5, 600, 240, 1, 150)];
  assert(DS.affected(net, open).length === 0, 'cell should contain no airport');
  const r = DS.simulate(net, open, []);
  const det = r.flights.filter(f => f.detour > 0);
  const m = DS.metricsAt(r, 1800),
    m0 = DS.metricsAt(DS.simulate(net, [], []), 1800);
  console.log(
    '\nopen-airspace storm: flights detoured',
    det.length,
    'delayMin',
    Math.round(m.delayMin),
    'vs clear',
    Math.round(m0.delayMin)
  );
  assert(det.length > 0 && m.delayMin > m0.delayMin, 'en-route storm must delay crossing flights');
  det.forEach(f => assert(f.eta - f.adep === f.block + f.detour, 'detour extends block time'));
  // 2) fog/runway closure never detour (ground-only)
  const fog = DS.simulate(net, [mk('Fog', 20.5, 80.5, 600, 240, 0.8, 150)], []);
  assert(
    fog.flights.every(f => !f.detour),
    'fog must not cause detours'
  );
  // 3) radius decides which airports are hit; edge airports are only partly throttled
  const e = mk('Thunderstorm', 19.089, 72.866, 600, 90, 1, 200);
  const hit = net.airports.map(a => [a.code, DS.effSev(e, a)]).filter(x => x[1] > 0.04);
  console.log('storm over BOM hits', JSON.stringify(hit.map(h => h[0] + ':' + h[1].toFixed(2))));
  assert(hit.some(h => h[0] === 'BOM' && h[1] === 1) && hit.length >= 2, 'BOM closed, neighbour throttled');
  // 4) several problem types at once, anywhere, still obey every invariant
  const multi = [
    mk('Cyclone', 16, 82, 700, 300, 1, 350),
    mk('Runway closure', 28.5, 77.1, 540, 180, 0.5, 40),
    mk('ATC outage', 13, 77.7, 800, 120, 0.85, 130),
    mk('Dust storm', 26.8, 75.8, 650, 180, 0.6, 260)
  ];
  const rm = DS.simulate(net, multi, []);
  for (const t of net.tails) {
    let loc = t.base,
      ready = -1;
    for (const id of t.flights) {
      const f = rm.flights[id];
      if (f.status !== 'ok') continue;
      assert.strictEqual(f.orig, loc);
      assert(f.adep >= ready);
      loc = f.dest;
      ready = f.aarr;
    }
  }
  const best = DS.advise(net, multi, [], 540);
  console.log(
    'multi-problem day: cost',
    fmt(rm.costs.total),
    'advisor found',
    best.items.length,
    'useful measures'
  );
  assert(rm.costs.total > DS.simulate(net, [], []).costs.total);
}
console.log('free-placement OK');

// ---- operational objectives + diagnostics ---------------------------------------
{
  const w = DS.SCENARIOS[0].events,
    base = DS.simulate(net, w, []);
  for (const mode of ['pax', 'flights', 'stranded']) {
    const a = DS.advise(net, w, [], 540, mode);
    a.items.forEach(i => assert(i.gain > DS.OBJ[mode].eps));
    for (let k = 1; k < a.items.length; k++)
      assert(a.items[k - 1].gain >= a.items[k].gain, 'sorted by objective');
    // applying the top measure must really improve that objective
    if (a.items.length) {
      const r = DS.simulate(net, w, [Object.assign({ id: 1 }, a.items[0].action)]);
      assert(DS.objective(r, mode) < DS.objective(base, mode), mode + ' objective improves');
    }
    console.log(
      mode.padEnd(8),
      'top:',
      a.items[0] && a.items[0].label,
      '| gain',
      a.items[0] && (a.items[0].gain / DS.OBJ[mode].div).toFixed(1),
      DS.OBJ[mode].unit
    );
  }
  const dg = DS.diagnose(net, base, 1800);
  console.log(
    'roots:',
    dg.roots
      .slice(0, 4)
      .map(r => `${r.root} ${(r.total / 60).toFixed(0)}h(${r.gen0} direct/${r.flights - r.gen0} knock-on)`)
      .join(', ')
  );
  assert(dg.roots.length && dg.roots[0].root === 'BOM', 'Mumbai storm must be the top root cause');
  const tot = dg.direct + dg.knock;
  assert(dg.knock > 0 && tot > 0);
  const dgNow = DS.diagnose(net, base, 560);
  console.log(
    'risks at 09:20:',
    dgNow.risks.length,
    dgNow.risks[0] &&
      'top ' + base.flights[dgNow.risks[0].id].num + ' knocks on ' + dgNow.risks[0].kF + ' flights'
  );
  if (dgNow.risks.length) {
    const fx = DS.fixOptions(net, w, [], 560, dgNow.risks[0].id, 'pax', base);
    console.log('fix options:', fx.map(o => o.label + ' ' + (o.gain / 60).toFixed(1) + 'h').join(' | '));
    assert(fx.length >= 1);
  }
}
console.log('objectives OK');

// ---- worldwide network -----------------------------------------------------------
{
  const wn = DS.buildNetwork('world');
  console.log(
    '\nWORLD: airports',
    wn.airports.length,
    'tails',
    wn.tails.length,
    'flights',
    wn.flights.length,
    'itins',
    wn.itins.length,
    'pax',
    wn.flights.reduce((s, f) => s + f.load, 0)
  );
  const longest = wn.flights.reduce((m, f) => Math.max(m, f.block), 0);
  console.log(
    'longest block',
    (longest / 60).toFixed(1) + 'h; flights >6h:',
    wn.flights.filter(f => f.block > 360).length
  );
  const clear = DS.simulate(wn, [], []);
  const mc = DS.metricsAt(clear, 1800);
  console.log(
    'world clear day: OTP',
    (mc.otp * 100).toFixed(1) + '%',
    'cancel',
    mc.cancelled,
    'crew-limit cancels',
    clear.flights.filter(f => f.cancel === 'crew').length
  );
  assert(mc.cancelled === 0, 'no cancellations on a clear world day');
  for (const sc of DS.SCENARIOS_WORLD.filter(x => x.events.length)) {
    const t0 = Date.now(),
      r = DS.simulate(wn, sc.events, []),
      ms = Date.now() - t0,
      m = DS.metricsAt(r, 1800);
    for (const t of wn.tails) {
      let loc = t.base,
        ready = -1;
      for (const id of t.flights) {
        const f = r.flights[id];
        if (f.status !== 'ok') continue;
        assert.strictEqual(f.orig, loc, 'teleport ' + t.id);
        assert(f.adep >= ready);
        loc = f.dest;
        ready = f.aarr;
      }
    }
    const dg = DS.diagnose(wn, r, 1800);
    const adv = DS.advise(wn, sc.events, [], 420, 'pax');
    console.log(
      ' ',
      sc.name.padEnd(40),
      'OTP',
      (m.otp * 100).toFixed(1) + '%',
      'cancel',
      m.cancelled,
      'div',
      m.diverted,
      'stranded',
      r.pax.stranded,
      '| sim',
      ms + 'ms | top root',
      dg.roots[0] && dg.roots[0].root,
      '| advisor top:',
      adv.items[0] && adv.items[0].label
    );
    assert(DS.objective(r, 'pax') > DS.objective(clear, 'pax'), sc.id + ' must hurt');
  }
}
console.log('world OK');

// ---- schedule import ---------------------------------------------------------------
{
  require('../js/import.js');
  for (const kind of ['india', 'world']) {
    const src = DS.buildNetwork(kind),
      csv = DS.scheduleToCSV(src);
    const { net, report } = DS.networkFromSchedule(DS.parseTable(csv));
    console.log(
      `\nimport round-trip (${kind}): rows ${report.rows} -> flights ${report.imported}, aircraft ${report.tails} (source ${src.tails.filter(t => !t.spare).length}), airports ${report.airports}, window ${report.window}`
    );
    assert.strictEqual(report.imported, src.flights.length, 'every flight survives the round trip');
    assert.strictEqual(report.tails, src.tails.filter(t => !t.spare).length, 'aircraft rotations preserved');
    for (const t of net.tails) {
      let loc = null;
      for (const id of t.flights) {
        const f = net.flights[id];
        if (loc) assert.strictEqual(f.orig, loc);
        loc = f.dest;
      }
    }
    const clear = DS.simulate(net, [], []),
      mc = DS.metricsAt(clear, net.meta.t1);
    const sc = net.meta.scenarios[0],
      storm = DS.simulate(net, sc.events, []);
    console.log(
      '  clear OTP',
      (mc.otp * 100).toFixed(1) + '%',
      '| auto scenario:',
      sc.name,
      '| OTP',
      (DS.metricsAt(storm, net.meta.t1).otp * 100).toFixed(1) + '%',
      '| pax-h',
      Math.round(DS.objective(storm, 'pax') / 60)
    );
    assert(DS.objective(storm, 'pax') > DS.objective(clear, 'pax'), 'imported storm hurts');
    assert(
      DS.advise(net, sc.events, [], sc.events[0].start - 30, 'pax').items.length > 0,
      'advisor works on imported data'
    );
  }
  // messy real-world style: semicolons, HHMM times, no tail column, unknown airport, no header aliases
  const messy =
    'Flt;Dep;Arr;Dep Time;Arr Time\nAI101;DEL;BOM;0630;0830\nAI102;BOM;DEL;0930;1135\nAI103;DEL;BLR;0700;0945\nXX1;DEL;ZZZ;0800;0900\nAI104;BLR;DEL;1030;1315\nAI105;BOM;BLR;1000;1130\n';
  const r = DS.networkFromSchedule(DS.parseTable(messy));
  console.log(
    '\nmessy CSV ->',
    JSON.stringify({
      imported: r.report.imported,
      aircraft: r.report.inferredAircraft,
      unknown: r.report.unknownAirports,
      cols: r.report.columns.orig + '/' + r.report.columns.std
    })
  );
  assert.strictEqual(r.report.imported, 5);
  assert(r.report.unknownAirports.ZZZ === 1);
  assert.strictEqual(r.report.columns.orig, 'Dep');
  assert.strictEqual(r.report.columns.std, 'Dep Time');
  // overnight flight (arrival earlier than departure on the clock)
  const night = DS.networkFromSchedule(
    DS.parseTable('flight,origin,destination,std,sta\nA1,DEL,BOM,23:10,01:20\n')
  );
  assert.strictEqual(night.net.flights[0].sta - night.net.flights[0].std, 130, 'overnight block time');
  // helpful errors
  assert.throws(() => DS.parseTable(''), /Nothing to import/);
  assert.throws(() => DS.networkFromSchedule(DS.parseTable('a,b\n1,2\n')), /Could not find/);
  assert.throws(
    () =>
      DS.networkFromSchedule(DS.parseTable('flight,origin,destination,std,sta\nA1,QQQ,WWW,10:00,12:00\n')),
    /Unknown airport codes|No usable/
  );
  // JSON with its own airport list
  const js = JSON.stringify({
    airports: [
      { code: 'AAA', lat: 10, lon: 20 },
      { code: 'BBB', lat: 12, lon: 25 }
    ],
    flights: [
      {
        flight: 'T1',
        origin: 'AAA',
        destination: 'BBB',
        std: '2026-05-01T08:00:00Z',
        sta: '2026-05-01T09:30:00Z'
      }
    ]
  });
  assert.strictEqual(DS.networkFromSchedule(DS.parseTable(js)).report.imported, 1);
}
console.log('import OK');

// ---- AI dispatcher: every number it states must match the engine -------------------------------------
(async () => {
  require('../js/dispatcher.js');
  const D = DS.Dispatcher;
  const net = DS.buildNetwork('dataset'),
    sc = DS.SCENARIOS_DATA[0];
  const ctxAt = (now, plan) => {
    plan = plan || [];
    return {
      net,
      weather: sc.events,
      plan,
      now,
      objective: 'pax',
      base: DS.simulate(net, sc.events, []),
      res: DS.simulate(net, sc.events, plan)
    };
  };
  let audited = 0,
    numbers = 0;
  const check = (label, out) => {
    audited++;
    numbers += out.verification.checked;
    assert(
      out.verification.ok,
      `${label}: unverified numbers ${JSON.stringify(out.verification.bad)} in: ${out.text}`
    );
    assert(
      out.verification.checked > 0 || /clear day|no disruption/i.test(out.text),
      label + ' should state numbers'
    );
  };
  for (const now of [540, 620, 700, 900, 1200, 1700]) {
    const c = ctxAt(now);
    check('brief@' + now, D.brief(c));
    check('recommend@' + now, D.recommend(c));
    check('passengers@' + now, D.passengers(c));
    check('crews@' + now, D.crews(c));
    const late = c.res.flights
      .filter(f => f.status === 'ok' && f.adep - f.std > 20)
      .slice(0, 3)
      .concat(c.res.flights.filter(f => f.status === 'cancelled').slice(0, 1));
    late.forEach(f => check('why ' + f.num + '@' + now, D.whyFlight(c, f.id)));
  }
  // with a plan applied, and for each objective
  const c0 = ctxAt(555),
    top = D.evaluateCandidates(c0, 3).items[0];
  const planned = ctxAt(555, [Object.assign({ id: 1 }, top.action)]);
  check('brief with plan', D.brief(planned));
  check('recommend with plan', D.recommend(planned));
  for (const objective of ['pax', 'flights', 'stranded'])
    check('recommend ' + objective, D.recommend(Object.assign({}, c0, { objective })));
  // the recommendation's before/after table is exactly what applying it produces
  const rec = D.recommend(c0),
    re = DS.simulate(net, sc.events, [Object.assign({ id: 1 }, rec.top.action)]);
  assert.deepStrictEqual(
    rec.top.after,
    D.snapshot(net, re),
    'after-metrics are the engine result of applying the action'
  );
  assert(rec.top.after.paxHours < rec.top.before.paxHours, 'recommended action must actually help');
  // the 'result of your decision' narration is audited too
  {
    const before = D.snapshot(net, c0.res);
    check('applied', D.applied(planned, before, top.title, top.action));
  }
  // free text routing
  const c1 = ctxAt(700);
  const lateF = c1.res.flights.find(f => f.status === 'ok' && f.adep - f.std > 30);
  assert(/why/i.test(D.answer(c1, 'why is ' + lateF.num + ' late?').title), 'flight question -> explanation');
  assert(/Recommendation/.test(D.answer(c1, 'what should I do?').title));
  assert(/Passengers/.test(D.answer(c1, 'how many passengers are stranded').title));
  assert(/Crew/.test(D.answer(c1, 'are crews ok?').title));
  // the auditor catches tampering
  const good = D.recommend(c0),
    ids = D.identifiers(net),
    truth = D.groundTruth(c0, good);
  assert(D.verifyText(good.text, truth, ids).ok);
  const tampered = good.text.replace(/\d[\d,]*/, m => String(parseInt(m.replace(/,/g, '')) + 7919));
  const tv = D.verifyText(tampered, truth, ids);
  console.log('tamper test flagged:', JSON.stringify(tv.bad));
  assert(!tv.ok && tv.bad.length >= 1, 'a changed number must be flagged');
  assert(!D.verifyText('Passenger delay is 123456 hours', truth, ids).ok);
  assert(!D.verifyText('Departure at 03:17', truth, ids).ok, 'an invented clock time is flagged');
  // Claude mode with a scripted client: tool loop, real numbers pass, an invented number is flagged
  const mkClient = finalText => {
    let n = 0;
    const seen = [];
    const handler = req => {
      seen.push(req);
      n++;
      if (n === 1)
        return {
          stop_reason: 'tool_use',
          content: [
            { type: 'thinking', thinking: '', signature: 'x' },
            { type: 'tool_use', id: 't1', name: 'get_recommendations', input: {} },
            { type: 'tool_use', id: 't2', name: 'get_situation', input: {} }
          ]
        };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: finalText(seen) }] };
    };
    return {
      seen,
      beta: { messages: { create: async r => handler(r) } },
      messages: { create: async r => handler(r) }
    };
  };
  const exact = seen => {
    const tr = JSON.parse(seen[1].messages[2].content[0].content),
      r = tr.recommendations[0];
    return `Recommended ${r.id}: ${r.title}. It cuts passenger delay from ${tr.before.passengerDelayHours} to ${r.after.passengerDelayHours} hours and strands ${r.after.strandedPeople} people.`;
  };
  const cl = mkClient(exact);
  const good2 = await DS.Dispatcher.askClaude(c0, 'what should I do?', {
    client: cl,
    model: 'claude-opus-5-5'
  });
  console.log('claude (scripted):', good2.text);
  assert(good2.verification.ok && good2.verification.checked >= 3, 'honest answer verifies');
  assert.deepStrictEqual(cl.seen[0].betas, ['server-side-fallback-2026-07-01']);
  assert.strictEqual(cl.seen[0].fallbacks, 'default');
  assert(
    cl.seen[1].messages[1].content.some(b => b.type === 'thinking'),
    'assistant content (incl. thinking) is passed back unchanged'
  );
  const lie = await DS.Dispatcher.askClaude(c0, 'what should I do?', {
    client: mkClient(seen => exact(seen) + ' That saves about 9,999 passenger-hours and 6,181 flights.'),
    model: 'claude-haiku-5-5'
  });
  console.log('claude (invented numbers) flagged:', JSON.stringify(lie.verification.bad));
  assert(
    !lie.verification.ok && lie.verification.bad.includes('9,999') && lie.verification.bad.includes('6,181'),
    'invented numbers flagged'
  );
  console.log(
    `dispatcher: ${audited} narrations audited, ${numbers} numbers/times checked against the engine`
  );
})()
  .then(() => console.log('dispatcher OK'))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });

// ---- the organisers' dataset (data/flight_network.json): every constraint in the file is honoured ---------------
{
  const net = DS.buildNetwork('dataset'),
    src = require('../js/dataset.js');
  assert.strictEqual(net.source, 'organiser');
  assert.deepStrictEqual(
    [
      net.airports.length,
      net.flights.length,
      net.tails.filter(t => !t.spare).length,
      net.tails.filter(t => t.spare).length,
      net.itins.length,
      net.crews.length
    ],
    [16, 70, 16, 2, 21, 16],
    'sizes match the brief'
  );
  assert.strictEqual(net.minTurn, 30);
  assert.deepStrictEqual([...new Set(net.itins.map(i => i.mct))].sort(), [40, 45]);
  assert(
    net.tails.filter(t => !t.spare).every(t => t.dutyMax === 600 && t.dutyStart != null),
    'crew windows come from the data'
  );
  assert.strictEqual(net.airportMap.DEL.cap, 40);
  assert.strictEqual(net.airportMap.TRV.cap, 8);
  // 1. no problem planted -> the published timetable, minute for minute
  const clear = DS.simulate(net, [], []);
  assert(
    clear.flights.every(
      (f, i) => f.status === 'ok' && f.adep === net.flights[i].std && f.aarr === net.flights[i].sta
    ),
    'clear day == timetable'
  );
  assert.strictEqual(clear.pax.missedPax, 0);
  assert.strictEqual(clear.pax.stranded, 0);
  // 2. crew windows are enforced: CR03 has 10 minutes of margin, so a late Mumbai leg costs it its last flight
  const bom = [DS.mkEvent('BOM', 'Airport closure', 870, 90, 1)],
    r = DS.simulate(net, bom, []);
  const ds0304 = r.flights.find(f => f.num === 'DS0304');
  console.log(
    '\norganiser data: Mumbai 14:30 closure -> DS0304 (CR03, 10 min margin):',
    ds0304.status,
    ds0304.cancel || ''
  );
  assert.strictEqual(ds0304.status, 'cancelled');
  assert.strictEqual(ds0304.cancel, 'crew');
  // 3. the duty limit is legal: the advisor never offers to extend it, and the dispatcher never recommends it
  const adv = DS.advise(net, bom, [], 830, 'pax');
  assert(
    adv.items.length > 0 && adv.items.every(i => i.action.type !== 'crew'),
    'no crew-extension for a hard limit'
  );
  // 4. each connection uses its own minimum connect time
  const strict = Object.assign({}, net, { itins: net.itins.map(i => Object.assign({}, i, { mct: 1000 })) });
  assert(
    DS.simulate(strict, [], []).pax.missedPax > 0,
    'raising the minimum connect time breaks connections -> mct is used'
  );
  // 5. spare aircraft are only available from their stated time
  const late = Object.assign({}, net, {
    tails: net.tails.map(t => (t.spare ? Object.assign({}, t, { availableFrom: 760 }) : t))
  });
  const f9 = net.flights.find(f => f.num === 'DS0902'),
    sw = DS.simulate(late, [], [{ id: 1, type: 'swap', flight: f9.id, spare: 'VT-DS18', from: 480 }]);
  assert(
    sw.flights[f9.id].status === 'ok' &&
      sw.flights[f9.id].adep >= 760 &&
      sw.flights[f9.id].adep > f9.std + 100,
    'a spare cannot fly before available_from (departs ' + sw.flights[f9.id].adep + ')'
  );
  const sw2 = DS.simulate(net, [], [{ id: 1, type: 'swap', flight: f9.id, spare: 'VT-DS18', from: 480 }]);
  assert.strictEqual(sw2.flights[f9.id].status, 'ok');
  assert.strictEqual(sw2.flights[f9.id].adep, f9.std, 'an available spare takes the flight on time');
  // 6. capacity_per_hour is a rolling-hour limit under weather
  const fog = [DS.mkEvent('DEL', 'Fog', 480, 360, 0.8)],
    rf = DS.simulate(net, fog, []),
    cap = Math.floor(40 * 0.2 + 1e-9);
  const mv = [];
  rf.flights.forEach((f, i) => {
    if (f.status !== 'ok') return;
    if (net.flights[i].orig === 'DEL') mv.push(f.adep);
    if (net.flights[i].dest === 'DEL') mv.push(f.aarr);
  });
  mv.filter(m => m >= 480 && m < 840).forEach(m =>
    assert(
      mv.filter(x => x >= m && x < m + 60).length <= Math.max(cap, 1) + 0,
      'DEL rolling hour exceeds capacity at ' + m
    )
  );
  // 7. the importer round-trips the organiser format and rejects a broken one with a clear message
  const again = DS.networkFromSchedule(DS.parseTable(JSON.stringify(src)));
  assert.strictEqual(again.net.flights.length, 70);
  assert.strictEqual(again.report.organiser, true);
  assert.strictEqual(again.report.warnings.length, 0, 'the dataset is internally consistent');
  const broken = JSON.parse(JSON.stringify(src));
  broken.flights[0].origin = 'XXX';
  assert.throws(() => DS.networkFromOrganiser(broken), /missing from the airports list: XXX/);
}
console.log('organiser dataset OK');
