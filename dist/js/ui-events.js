/* Domino Sky — User input: clicks, sliders, keyboard and drag handlers. */
(function () {
  'use strict';
  const DS = window.DS,
    U = DS.ui;
  const {
    S,
    wxAp,
    renderPlant,
    recompute,
    removeAction,
    addAction,
    toast,
    HOOKS,
    R,
    hhmm,
    $,
    hitsHtml,
    $$,
    loadScenario,
    evFrame
  } = U;
  // defined by panels loaded after this one: looked up when called
  const renderLeft = (...args) => U.renderLeft(...args);
  const renderLiveSoon = (...args) => U.renderLiveSoon(...args);
  const renderAll = (...args) => U.renderAll(...args);
  const lateFlights = (...args) => U.lateFlights(...args);
  const selectAirport = (...args) => U.selectAirport(...args);
  const selectFlight = (...args) => U.selectFlight(...args);
  const renderBottomShell = (...args) => U.renderBottomShell(...args);
  const renderLive = (...args) => U.renderLive(...args);
  const doAutoOpt = (...args) => U.doAutoOpt(...args);
  const openImport = (...args) => U.openImport(...args);
  const openHelp = (...args) => U.openHelp(...args);
  const closeTour = (...args) => U.closeTour(...args);
  const updateBottom = (...args) => U.updateBottom(...args);
  const drawGantt = (...args) => U.drawGantt(...args);
  const drawChart = (...args) => U.drawChart(...args);
  const updateStandings = (...args) => U.updateStandings(...args);
  const updateLegend = (...args) => U.updateLegend(...args);
  const header = (...args) => U.header(...args);

  // ---------- events ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act,
      id = +el.dataset.id,
      code = el.dataset.code,
      now = S.now,
      F = S.form;
    const wx = wxAp();
    switch (act) {
      case 'arm':
        S.placing = S.placing === el.dataset.type ? null : el.dataset.type;
        renderPlant();
        renderLeft();
        renderLiveSoon();
        break;
      case 'disarm':
        S.placing = null;
        renderPlant();
        renderLeft();
        renderLiveSoon();
        break;
      case 'addEvOLD': {
        const used = new Set(S.weather.map(w => w.airport));
        const ap = ['BOM', 'DEL', 'BLR', 'MAA', 'CCU', 'HYD'].find(c => !used.has(c)) || 'BOM';
        S.weather.push({
          id: S.nextId++,
          airport: ap,
          type: 'Thunderstorm',
          start: Math.max(S.net.meta.t0, Math.round((now + 60) / 5) * 5),
          dur: 90,
          severity: 1
        });
        recompute();
        renderAll();
        break;
      }
      case 'delEv':
        S.weather = S.weather.filter(w => w.id !== id);
        if (S.selEv === id) S.selEv = null;
        recompute();
        renderAll();
        break;
      case 'delAct':
        removeAction(id);
        break;
      case 'clearPlan':
        S.plan = [];
        S.advice = null;
        recompute();
        renderAll();
        break;
      case 'addGdp':
        addAction({ type: 'gdp', airport: F.gdpAp || wx, from: now });
        break;
      case 'addHold':
        addAction({ type: 'hold', airport: F.holdAp || 'ALL', mins: +(F.holdMin || 20), from: now });
        break;
      case 'addFt':
        addAction({ type: 'fastturn', airport: F.ftAp || wx, from: now, cut: 10 });
        break;
      case 'addSurge':
        addAction({ type: 'surge', airport: F.surgeAp || (wx === 'ALL' ? 'DEL' : wx), from: now, pct: 25 });
        break;
      case 'addCrew':
        addAction({ type: 'crew', from: now, extra: 120 });
        break;
      case 'addRebook':
        addAction({ type: 'rebook', from: now });
        break;
      case 'addSwap': {
        const f = +(F.swapFlight || lateFlights(20, now)[0].id);
        const sp = freeSpareFor(f);
        if (sp) addAction({ type: 'swap', flight: f, spare: sp.id, from: now });
        break;
      }
      case 'addCancel':
        addAction({ type: 'cancel', flight: +(F.cancelFlight || lateFlights(20, now)[0].id), from: now });
        break;
      case 'flSwap': {
        const sp = freeSpareFor(id);
        if (sp) addAction({ type: 'swap', flight: id, spare: sp.id, from: now });
        else toast('No spare aircraft left');
        break;
      }
      case 'flCancel':
        addAction({ type: 'cancel', flight: id, from: now });
        break;
      case 'apGdp':
        addAction({ type: 'gdp', airport: code, from: now });
        break;
      case 'apSurge':
        addAction({ type: 'surge', airport: code, from: now, pct: 25 });
        break;
      case 'apFt':
        addAction({ type: 'fastturn', airport: code, from: now, cut: 10 });
        break;
      case 'apHold':
        addAction({ type: 'hold', airport: code, mins: 20, from: now });
        break;
      case 'apStorm': {
        const a = S.net.airportMap[code],
          m = DS.WXT.Thunderstorm;
        const ev = {
          id: S.nextId++,
          type: 'Thunderstorm',
          lat: a.lat,
          lon: a.lon,
          radius: m.radius,
          start: Math.max(S.net.meta.t0, Math.round((now + 45) / 5) * 5),
          dur: m.dur,
          severity: m.severity
        };
        S.weather.push(ev);
        S.selEv = ev.id;
        recompute();
        renderAll();
        toast('Thunderstorm planted over ' + code);
        break;
      }
      case 'applyFix': {
        const o = (S.fixCache.opts[id] || [])[+el.dataset.k];
        if (o) addAction(Object.assign({}, o.action, { from: S.now }));
        break;
      }
      case 'fixSwap': {
        const sp = freeSpareFor(id);
        if (sp) addAction({ type: 'swap', flight: id, spare: sp.id, from: S.now });
        else toast('No spare aircraft left');
        break;
      }
      case 'fixCancel':
        addAction({ type: 'cancel', flight: id, from: S.now });
        break;
      case 'selAp':
        selectAirport(code);
        break;
      case 'selFl':
        selectFlight(id);
        break;
      case 'closeDetail':
        S.sel = { airport: null, flight: null, tail: null };
        renderLiveSoon();
        break;
      case 'viewCascade':
        S.btab = 'cascade';
        renderBottomShell();
        break;
      case 'obj':
        S.objective = el.dataset.obj;
        S.advice = null;
        renderLeft();
        renderLive();
        if (S.btab === 'fix') renderBottomShell();
        break;
      case 'analyse': {
        const A = DS.advise(S.net, S.weather, S.plan, S.now, S.objective);
        S.advice = { at: S.now, items: A.items, baseObj: A.baseObj, mode: S.objective, stale: false };
        renderLeft();
        break;
      }
      case 'applyAdvice': {
        const it = S.advice.items[+el.dataset.i];
        addAction(Object.assign({}, it.action, { from: S.now }));
        S.ltab = 'advisor';
        {
          const A = DS.advise(S.net, S.weather, S.plan, S.now, S.objective);
          S.advice = { at: S.now, items: A.items, baseObj: A.baseObj, mode: S.objective, stale: false };
        }
        renderLeft();
        break;
      }
      case 'autoopt':
        doAutoOpt();
        break;
      case 'openImport':
        openImport();
        break;
      case 'openHelp':
        openHelp();
        break;
      case 'closeTour':
        closeTour();
        break;
      default:
        if (HOOKS.actions[act]) HOOKS.actions[act](el, e);
    }
  });
  function freeSpareFor(fid) {
    const f = R().flights[fid],
      free = S.net.tails.filter(t => t.spare && !S.plan.some(a => a.type === 'swap' && a.spare === t.id));
    return free.sort((a, b) => S.net.dist(a.base, f.orig) - S.net.dist(b.base, f.orig))[0];
  }
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.f) {
      S.form[t.dataset.f] = t.value;
      renderLeft();
    } else if (t.dataset.evf) {
      evEdit(t);
      renderLeft();
    }
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.evf && t.type === 'range') {
      evEdit(t);
      const out = t.parentElement.querySelector('output');
      const ev = S.weather.find(w => w.id === +t.dataset.id);
      out.textContent =
        t.dataset.evf === 'radius'
          ? ev.radius + ' km'
          : t.dataset.evf === 'start'
            ? hhmm(ev.start)
            : t.dataset.evf === 'dur'
              ? Math.floor(ev.dur / 60) + 'h' + String(ev.dur % 60).padStart(2, '0')
              : ev.severity >= 0.9
                ? 'Closed'
                : Math.round((1 - ev.severity) * 100) + '% cap';
    } else if (t.id === 'bQ') {
      S.board.q = t.value;
      updateBottom();
    }
  });
  function evEdit(t) {
    const ev = S.weather.find(w => w.id === +t.dataset.id);
    if (!ev) return;
    const f = t.dataset.evf;
    if (f === 'type') {
      const m = DS.WXT[t.value];
      Object.assign(ev, { type: t.value, severity: m.severity, radius: m.radius });
    } else ev[f] = f === 'severity' ? +t.value / 100 : +t.value;
    S.selEv = ev.id;
    evFrame(() => {
      recompute();
      renderLive();
      const h = $('#hits' + ev.id);
      if (h) h.innerHTML = hitsHtml(ev);
    });
  }
  $('#leftTabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) {
      S.ltab = b.dataset.tab;
      renderLeft();
    }
  });
  $('#botTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) {
      S.btab = b.dataset.tab;
      renderBottomShell();
      return;
    }
    const g = e.target.closest('[data-g]');
    if (g) {
      S.gantt.mode = g.dataset.g;
      $$('#gMode button').forEach(x => x.classList.toggle('on', x === g));
      drawGantt();
      return;
    }
    const s = e.target.closest('#gSort button');
    if (s) {
      S.gantt.sort = s.dataset.s;
      $$('#gSort button').forEach(x => x.classList.toggle('on', x === s));
      drawGantt();
    }
  });
  $('#botBody').addEventListener('click', e => {
    const b = e.target.closest('#bFilter button');
    if (b) {
      S.board.filter = b.dataset.b;
      $$('#bFilter button').forEach(x => x.classList.toggle('on', x === b));
      updateBottom();
    }
  });
  $('#rightBody').addEventListener('click', e => {
    const m = e.target.closest('#chartSw button');
    if (m) {
      S.chartMetric = m.dataset.m;
      $$('#chartSw button').forEach(x => x.classList.toggle('on', x === m));
      drawChart();
      return;
    }
    const s = e.target.closest('#standSw button');
    if (s) {
      S.rstab = s.dataset.s;
      $$('#standSw button').forEach(x => x.classList.toggle('on', x === s));
      updateStandings();
      return;
    }
    const o = e.target.closest('#standSort button');
    if (o) {
      S.standSort = o.dataset.o;
      $$('#standSort button').forEach(x => x.classList.toggle('on', x === o));
      updateStandings();
    }
  });
  $('#colorMode').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    S.colorMode = b.dataset.m;
    $$('#colorMode button').forEach(x => x.classList.toggle('on', x === b));
    updateLegend();
    renderLiveSoon();
  });
  $('#btnRecenter').addEventListener('click', () => {
    U.map.recenter();
  });
  $('#btnPlay').addEventListener('click', () => {
    if (S.now >= S.net.meta.t1) S.now = S.net.meta.t0;
    S.playing = !S.playing;
    header();
    if (!S.playing) renderLeft();
  });
  $('#btnStepF').addEventListener('click', () => step(30));
  $('#btnStepB').addEventListener('click', () => step(-30));
  function step(d) {
    S.playing = false;
    S.now = Math.max(S.net.meta.t0, Math.min(S.net.meta.t1, S.now + d));
    renderLive();
    renderLeft();
  }
  $('#btnRestart').addEventListener('click', () => {
    S.playing = false;
    S.now = S.net.meta.t0;
    renderLive();
    renderLeft();
  });
  $('#speed').addEventListener('change', e => (S.speed = +e.target.value));
  $('#scrub').addEventListener('input', e => {
    S.now = +e.target.value;
    renderLiveSoon();
  });
  $('#scrub').addEventListener('change', () => renderLeft());
  $('#scenarioSel').addEventListener('change', e => loadScenario(e.target.value));
  document.addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (e.target.type === 'range' && e.code.startsWith('Arrow')) return; // sliders keep their native arrow keys
    if (
      e.target.closest &&
      e.target.closest('button, [role=tab], [role=button], [tabindex], dialog, a') &&
      /^(Space|Enter|ArrowLeft|ArrowRight)$/.test(e.code)
    )
      return; // focused controls keep their own keys
    if (e.code === 'Escape' && S.placing) {
      S.placing = null;
      renderPlant();
      renderLeft();
      renderLiveSoon();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      $('#btnPlay').click();
    } else if (e.code === 'ArrowRight') step(30);
    else if (e.code === 'ArrowLeft') step(-30);
  });
  window.addEventListener('resize', () => {
    U.map.resize();
    drawChart();
    updateBottom();
  });
})();
