/* Domino Sky — UI core: shared state, helpers and the simulation model. */
(function () {
  'use strict';
  const DS = window.DS,
    $ = s => document.querySelector(s),
    $$ = s => [...document.querySelectorAll(s)];
  const U = (DS.ui = {});
  // defined by the detail module (loaded later): looked up when called
  const renderAll = (...args) => U.renderAll(...args);
  const HOOKS = {
    left: {},
    bottom: {},
    actions: {},
    onReset: [],
    weatherTop: () => '',
    flightExtra: () => '',
    airportButtons: () => ''
  };

  // colours for the canvas charts, switched with the theme
  const TC = () =>
    DS.themeName === 'light'
      ? {
          axis: '#6b665b',
          grid: '#ddd7c9',
          head: '#f3f0e8',
          headTxt: '#5b564c',
          headLine: '#cdc6b6',
          rowAlt: 'rgba(60,45,15,.03)',
          selRow: 'rgba(125,90,26,.16)',
          txt: '#5b564c',
          txtSel: '#1f1d1a',
          sliver: '#b9b2a1',
          nowLine: '#1f1d1a',
          nowBg: '#1f1d1a',
          nowTxt: '#ffffff',
          selOutline: '#1f1d1a',
          clear: '#9a968b',
          legend: '#4b5f75',
          band: 'rgba(125,90,26,.12)',
          bandHead: 'rgba(125,90,26,.5)'
        }
      : {
          axis: '#968f82',
          grid: '#272b30',
          head: '#16181b',
          headTxt: '#a8a498',
          headLine: '#383d44',
          rowAlt: 'rgba(255,255,255,.018)',
          selRow: 'rgba(201,169,110,.14)',
          txt: '#a8a498',
          txtSel: '#ffffff',
          sliver: '#4a4f57',
          nowLine: '#ffffff',
          nowBg: '#ffffff',
          nowTxt: '#05101f',
          selOutline: '#ffffff',
          clear: '#8a867d',
          legend: '#b8b4a8',
          band: 'rgba(201,169,110,.14)',
          bandHead: 'rgba(201,169,110,.5)'
        };

  const S = {
    net: DS.buildNetwork('dataset'),
    scenario: 'bom-monsoon',
    weather: [],
    plan: [],
    now: 480,
    playing: false,
    speed: 15,
    sel: { airport: null, flight: null, tail: null },
    colorMode: 'live',
    res: {},
    ser: {},
    nextId: 1,
    placing: null,
    selEv: null,
    ltab: 'scenario',
    btab: 'gantt',
    rstab: 'airports',
    chartMetric: 'pax',
    objective: 'pax',
    fixCache: {},
    fixKey: '',
    form: {},
    advice: null,
    board: { filter: 'active', q: '' },
    gantt: { mode: 'full', sort: 'base' },
    standSort: 'worst',
    worstTail: null
  };
  DS.airportMap = S.net.airportMap;

  // ---------- helpers ----------
  const esc = s =>
    String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function hhmm(m) {
    m = Math.round(m);
    const x = ((m % 1440) + 1440) % 1440;
    return (
      String(Math.floor(x / 60)).padStart(2, '0') +
      ':' +
      String(x % 60).padStart(2, '0') +
      (m >= 1440 ? '⁺¹' : '')
    );
  }
  function inr(v) {
    const a = Math.abs(v),
      s = v < 0 ? '−' : '';
    if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + ' cr';
    if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(1) + ' L';
    return s + '₹' + Math.round(a).toLocaleString('en-IN');
  }
  const num = v => Math.round(v).toLocaleString('en-IN');
  const dcol = DS.colDelay;
  const delayPill = d => (d <= 15 ? 'ok' : d <= 45 ? 'warn' : d <= 120 ? 'orange' : 'bad');
  let lastHtml = new WeakMap();
  function setHtml(el, html) {
    if (!el) return;
    if (lastHtml.get(el) !== html) {
      el.innerHTML = html;
      lastHtml.set(el, html);
    }
  }
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  const tip = $('#tip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const w = tip.offsetWidth,
      h = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - w - 8, x + 14) + 'px';
    tip.style.top = Math.min(innerHeight - h - 8, y + 14) + 'px';
  }
  const hideTip = () => tip.classList.add('hidden');
  const R = () => S.res.plan;
  const wxAirports = () => DS.affected(S.net, S.weather);
  const wxAp = () => wxAirports()[0] || 'ALL';
  function where(e) {
    let best = null,
      bd = 1e9;
    S.net.airports.forEach(a => {
      const d = DS.hav(e, a);
      if (d < bd) {
        bd = d;
        best = a;
      }
    });
    return `${Math.abs(e.lat).toFixed(1)}°N ${e.lon.toFixed(1)}°E · ${bd < 25 ? 'over' : Math.round(bd) + ' km from'} ${best.code}`;
  }
  function hits(e) {
    return S.net.airports
      .map(a => ({ a, v: DS.effSev(e, a) }))
      .filter(x => x.v > 0.04)
      .sort((x, y) => y.v - x.v)
      .map(x => ({ code: x.a.code, txt: x.v >= 0.9 ? 'closed' : Math.round((1 - x.v) * 100) + '% cap' }));
  }
  function hitsHtml(e) {
    const h = hits(e);
    return h.length
      ? h
          .map(x => `<span class="pill ${x.txt === 'closed' ? 'bad' : 'warn'}">${x.code} ${x.txt}</span>`)
          .join('')
      : '<span class="note" style="margin:0">No airport inside this area — only flights routed through it are affected.</span>';
  }
  const plantBtns = compact =>
    Object.entries(DS.WXT)
      .map(
        ([t, m]) =>
          `<button class="plantbtn ${S.placing === t ? 'on' : ''}" data-act="arm" data-type="${t}" title="${t} — ${m.kind.toLowerCase()} problem: click, then click anywhere on the map" aria-label="Plant ${t}" aria-pressed="${S.placing === t}">${m.icon}${compact ? '' : ' ' + t}</button>`
      )
      .join('');
  function renderPlant() {
    setHtml(
      $('#plant'),
      `<span class="lbl">Plant</span>${plantBtns(true)}${S.placing ? '<button class="plantbtn" data-act="disarm">✕ Cancel</button>' : ''}`
    );
  }
  const apOptions = (sel, all) =>
    (all ? `<option value="ALL" ${sel === 'ALL' ? 'selected' : ''}>All airports</option>` : '') +
    S.net.airports
      .map(
        a => `<option value="${a.code}" ${sel === a.code ? 'selected' : ''}>${a.code} · ${a.city}</option>`
      )
      .join('');

  // ---------- model ----------
  function recompute() {
    S.res.clear = S.res.clear || DS.simulate(S.net, [], []);
    S.res.base = DS.simulate(S.net, S.weather, []);
    S.res.plan = S.plan.length ? DS.simulate(S.net, S.weather, S.plan) : S.res.base;
    S.ser = {
      clear: DS.series(S.res.clear, S.net.meta.t0, S.net.meta.t1, 10),
      base: DS.series(S.res.base, S.net.meta.t0, S.net.meta.t1, 10),
      plan: DS.series(S.res.plan, S.net.meta.t0, S.net.meta.t1, 10)
    };
    // most knocked-on aircraft
    let best = null,
      bv = -1;
    for (const id in S.res.plan.tails) {
      const T = S.res.plan.tails[id];
      let v = 0;
      T.chain.forEach(fid => {
        const f = S.res.plan.flights[fid];
        if (f.status === 'ok' && f.gen >= 0) v += Math.max(0, f.aarr - f.sta);
        else if (f.status === 'cancelled' && f.cancel !== 'proactive') v += 120;
      });
      if (v > bv) {
        bv = v;
        best = id;
      }
    }
    S.worstTail = bv > 0 ? best : null;
    S.advice = S.advice && S.advice.stale === false ? Object.assign(S.advice, { stale: true }) : S.advice;
  }
  function loadScenario(id) {
    const sc = S.net.meta.scenarios.find(s => s.id === id) || S.net.meta.scenarios[0];
    S.scenario = sc.id;
    S.weather = sc.events.map(e => Object.assign({ id: S.nextId++ }, e));
    S.plan = [];
    S.advice = null;
    S.fixCache = {};
    HOOKS.onReset.forEach(f => f());
    S.sel = { airport: null, flight: null, tail: null };
    S.form = {};
    S.playing = false;
    S.now = sc.events.length
      ? Math.max(S.net.meta.t0, Math.min(...sc.events.map(e => e.start)) - 45)
      : Math.max(S.net.meta.t0, 480);
    recompute();
    renderAll();
  }
  function addAction(a, quiet) {
    a.id = S.nextId++;
    S.plan.push(a);
    S.advice = null;
    recompute();
    renderAll();
    if (!quiet) toast('Added: ' + describe(a).title + ' — effective ' + hhmm(a.from));
  }
  function removeAction(id) {
    S.plan = S.plan.filter(a => a.id !== id);
    recompute();
    renderAll();
  }
  const flName = id => {
    const f = R().flights[id];
    return f ? `${f.num} ${f.orig}→${f.dest}` : '?';
  };
  function describe(a) {
    const ap = c => (c === 'ALL' ? 'all airports' : c);
    switch (a.type) {
      case 'gdp':
        return {
          icon: '',
          title: 'Ground-delay program · ' + (a.airport === 'ALL' ? 'network' : a.airport + ' inbound'),
          detail: 'Hold departures on the ground instead of in the air'
        };
      case 'hold':
        return {
          icon: '',
          title: `Hold connections ≤${a.mins}m · ${ap(a.airport)}`,
          detail: 'Wait for airborne feeders with ≥10 connecting pax'
        };
      case 'fastturn':
        return { icon: '', title: 'Fast turnarounds · ' + ap(a.airport), detail: 'Minimum turn 35 → 25 min' };
      case 'crew':
        return {
          icon: '',
          title: `Crew duty +${a.extra / 60} h`,
          detail: 'Avoids late-evening crew time-outs'
        };
      case 'surge':
        return {
          icon: '',
          title: `Surge ops · ${a.airport} +${a.pct}%`,
          detail: 'Extra staff, relaxed spacing, extra stands'
        };
      case 'rebook':
        return { icon: '', title: 'Auto-rebook & care', detail: 'Protect disrupted pax on the next seats' };
      case 'cancel':
        return {
          icon: '',
          title: 'Cancel rotation · ' + flName(a.flight),
          detail: 'Pre-emptive cancel until the aircraft is back home'
        };
      case 'swap':
        return {
          icon: '',
          title: `Spare ${a.spare} → ${flName(a.flight)}`,
          detail: 'Spare takes over the rest of the rotation'
        };
    }
    return { icon: '?', title: a.type, detail: '' };
  }

  // ---------- metrics for current time ----------
  const M = () => DS.metricsAt(R(), S.now);
  const MB = () => DS.metricsAt(S.res.base, S.now);

  function causeOf(f) {
    if (f.status === 'cancelled')
      return (
        {
          crew: 'Crew duty limit hit',
          delay: 'Delay >4 h → cancelled',
          proactive: 'Proactive cancel',
          rotation: 'Rotation protected'
        }[f.cancel] || 'Cancelled'
      );
    const parts = [];
    if (f.react >= 5) parts.push(['Late aircraft', f.react]);
    if (f.slot >= 5) parts.push([f.slotWx ? 'Weather queue' : 'Runway queue', f.slot]);
    if (f.detour >= 5) parts.push(['Storm detour', f.detour]);
    if (f.gdp >= 5) parts.push(['Ground hold', f.gdp]);
    if (f.hold >= 5) parts.push(['Connection hold', f.hold]);
    if (f.divert) parts.push(['Diverted → ' + f.divert, f.aarr - f.eta]);
    else if (f.airHold >= 5) parts.push(['Airborne hold', f.airHold]);
    if (!parts.length) return f.noise >= 5 ? 'Minor ops delay' : '';
    parts.sort((a, b) => b[1] - a[1]);
    return parts
      .slice(0, 2)
      .map(p => `${p[0]} +${Math.round(p[1])}`)
      .join(' · ');
  }
  function statusOf(f, t) {
    if (f.status === 'cancelled') return { k: 'cancel', text: 'Cancelled' };
    const ph = DS.flightPhase(S.net, f, t);
    const dep = f.adep - f.std;
    switch (ph.ph) {
      case 'scheduled':
        return dep > 15 ? { k: delayPill(dep), text: 'Delayed' } : { k: 'info', text: 'Scheduled' };
      case 'waiting':
        return { k: 'bad', text: 'Waiting' };
      case 'air':
        return { k: 'info', text: 'Airborne' };
      case 'hold':
        return { k: 'orange', text: 'Holding' };
      case 'divert':
      case 'atalt':
      case 'ferry':
        return { k: 'violet', text: 'Diverted' };
      default: {
        const d = f.aarr - f.sta;
        return { k: delayPill(d), text: d > 15 ? 'Landed +' + Math.round(d) : 'Landed' };
      }
    }
  }

  // panels re-render by replacing innerHTML only when it changed; switching panels clears that cache
  function resetHtmlCache() {
    lastHtml = new WeakMap();
  }
  // one pending animation frame for dragging a storm or editing its fields (a newer request replaces the older one)
  let evRaf = 0;
  function evFrame(fn) {
    cancelAnimationFrame(evRaf);
    if (fn) evRaf = requestAnimationFrame(fn);
  }

  const O = () => DS.OBJ[S.objective];
  const objVal = v => num(v / O().div);
  const unitS = () => ({ pax: 'pax-h', flights: 'ac-h', stranded: 'people' })[S.objective];

  Object.assign(U, {
    $$,
    S,
    $,
    HOOKS,
    esc,
    where,
    hhmm,
    hitsHtml,
    plantBtns,
    R,
    num,
    inr,
    wxAp,
    describe,
    apOptions,
    setHtml,
    objVal,
    M,
    MB,
    TC,
    dcol,
    hideTip,
    showTip,
    statusOf,
    causeOf,
    O,
    unitS,
    wxAirports,
    hits,
    renderPlant,
    recompute,
    removeAction,
    addAction,
    toast,
    loadScenario,
    resetHtmlCache,
    evFrame,
    delayPill,
    flName
  });
})();
