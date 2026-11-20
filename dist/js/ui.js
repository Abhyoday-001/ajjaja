/* Domino Sky — UI controller: map wiring, boot, the clock, situation report, import and the public API. */
(function () {
  'use strict';
  const DS = window.DS,
    U = DS.ui;
  const {
    $,
    S,
    recompute,
    hits,
    toast,
    hhmm,
    hideTip,
    showTip,
    esc,
    loadScenario,
    M,
    num,
    R,
    addAction,
    HOOKS,
    $$,
    inr,
    apOptions,
    wxAp,
    dcol,
    evFrame
  } = U;
  // defined by panels loaded after this one: looked up when called
  const renderAll = (...args) => U.renderAll(...args);
  const renderLive = (...args) => U.renderLive(...args);
  const flightTip = (...args) => U.flightTip(...args);
  const renderLeft = (...args) => U.renderLeft(...args);
  const renderLiveSoon = (...args) => U.renderLiveSoon(...args);
  const selectAirport = (...args) => U.selectAirport(...args);
  const selectFlight = (...args) => U.selectFlight(...args);
  const updateLegend = (...args) => U.updateLegend(...args);
  const initRight = (...args) => U.initRight(...args);
  const header = (...args) => U.header(...args);
  const renderBottomShell = (...args) => U.renderBottomShell(...args);
  const scoreData = (...args) => U.scoreData(...args);

  // ---------- map wiring ----------
  // offered to the other panels before anything renders (these are hoisted function declarations)
  Object.assign(U, { importCard, updateSitrep, doAutoOpt, openImport, openHelp, closeTour });

  const map = new DS.MapView($('#map'), () => S, {
    placing: () => S.placing,
    place(lon, lat) {
      const t = S.placing,
        m = DS.WXT[t];
      const ev = {
        id: S.nextId++,
        type: t,
        lat,
        lon,
        radius: m.radius,
        start: Math.max(S.net.meta.t0, Math.round((S.now + 45) / 5) * 5),
        dur: m.dur,
        severity: m.severity
      };
      S.weather.push(ev);
      S.selEv = ev.id;
      S.placing = null;
      S.ltab = 'scenario';
      recompute();
      renderAll();
      const h = hits(ev);
      toast(
        `${m.icon} ${t} planted — starts ${hhmm(ev.start)}${h.length ? ', hits ' + h.map(x => x.code).join(', ') : ' (no airport in range; flights will detour)'} · drag to move`
      );
    },
    dragEvent(id, lon, lat, final) {
      const ev = S.weather.find(w => w.id === id);
      if (!ev) return;
      ev.lon = lon;
      ev.lat = lat;
      S.selEv = id;
      evFrame();
      if (final) {
        recompute();
        renderAll();
      } else
        evFrame(() => {
          recompute();
          renderLive();
        });
    },
    hover(h, x, y) {
      if (!h) {
        hideTip();
        return;
      }
      if (h.type === 'wx') {
        const e = S.weather.find(w => w.id === h.id),
          hh = hits(e);
        showTip(
          `<b>${DS.WXT[e.type].icon} ${e.type}</b> · ${hhmm(e.start)}–${hhmm(e.start + e.dur)}<br>${hh.length ? hh.map(q => q.code + ' ' + q.txt).join(' · ') : 'no airport in range'}<br><span style="color:var(--muted)">drag to move · click to edit</span>`,
          x,
          y
        );
        return;
      }
      if (h.type === 'airport') {
        const a = S.net.airportMap[h.code],
          st = (map.st || {})[h.code] || {},
          fac = DS.wxFactor(S.weather, h.code, S.now);
        showTip(
          `<b>${a.code}</b> ${esc(a.city)}<br>${fac === 0 ? '<span style="color:#f87171">Closed</span>' : fac < 1 ? '<span style="color:#fbbf24">Reduced capacity</span>' : 'Normal'} · ${st.wait || 0} waiting · ${st.inbound || 0} inbound<br><span style="color:var(--muted)">click for details &amp; actions</span>`,
          x,
          y
        );
      } else showTip(flightTip(h.id), x, y);
    },
    select(h) {
      if (h && h.type === 'wx') {
        S.selEv = h.id;
        S.ltab = 'scenario';
        renderLeft();
        const c = $('#ev' + h.id);
        if (c) c.scrollIntoView({ block: 'nearest' });
        renderLiveSoon();
        return;
      }
      if (!h) {
        S.sel = { airport: null, flight: null, tail: null };
        renderLiveSoon();
      } else if (h.type === 'airport') selectAirport(h.code);
      else selectFlight(h.id);
    }
  });
  U.map = map;
  map.resizeObs = new ResizeObserver(() => {
    map.resize();
  });
  map.resizeObs.observe($('#map'));

  // ---------- boot ----------
  function setNetwork(kind, custom) {
    S.net = custom || DS.buildNetwork(kind);
    DS.airportMap = S.net.airportMap;
    S.res = {};
    S.plan = [];
    S.weather = [];
    S.fixCache = {};
    S.gantt.sort = 'base';
    $('#scrub').min = S.net.meta.t0;
    $('#scrub').max = S.net.meta.t1;
    $('#networkSel').value = kind;
    $('#scenarioSel').innerHTML = S.net.meta.scenarios
      .map(s => `<option value="${s.id}">${esc(s.name)}</option>`)
      .join('');
    map.skey = '';
    map.recenter();
    loadScenario(S.net.meta.scenarios[0].id);
    $('#scenarioSel').value = S.net.meta.scenarios[0].id;
    if (kind === 'custom')
      toast(
        'Imported schedule · ' + S.net.flights.length + ' flights, ' + S.net.airports.length + ' airports'
      );
    else if (kind === 'dataset')
      toast('Compact dataset · 16 airports, 70 flights, 16 aircraft, 3 spares (times in IST)');
    else
      toast(
        kind === 'world'
          ? 'Worldwide network · ' +
              S.net.airports.length +
              ' airports, ' +
              S.net.flights.length +
              ' flights (times in UTC)'
          : 'India domestic network · ' +
              S.net.airports.length +
              ' airports, ' +
              S.net.flights.length +
              ' flights (times in IST)'
      );
  }
  function applyTheme(name) {
    document.documentElement.dataset.theme = name;
    DS.setTheme(name);
    $('#btnTheme').textContent = name === 'light' ? '☾' : '☀';
    try {
      localStorage.setItem('domino-sky-theme', name);
    } catch (e) {
      /* storage may be unavailable */
    }
    map.skey = '';
    renderLive();
    updateLegend();
  }
  $('#networkSel').addEventListener('change', e =>
    e.target.value === 'custom' && S.customNet
      ? setNetwork('custom', S.customNet)
      : setNetwork(e.target.value)
  );
  $('#btnTheme').addEventListener('click', () => applyTheme(DS.themeName === 'light' ? 'dark' : 'light'));
  $('#scenarioSel').innerHTML = S.net.meta.scenarios
    .map(s => `<option value="${s.id}">${esc(s.name)}</option>`)
    .join('');
  initRight();
  loadScenario(S.net.meta.scenarios[0].id);
  $('#networkSel').value = 'dataset';
  {
    let saved = null;
    try {
      saved = localStorage.getItem('domino-sky-theme');
    } catch (e) {
      /* ignore */
    }
    applyTheme(saved === 'light' ? 'light' : 'dark');
  }
  // The simulation clock advances by real elapsed time and is driven by BOTH the render loop and a timer, so playback
  // is correct at any frame rate and keeps running in a hidden / background tab (browsers pause requestAnimationFrame there).
  let last = performance.now(),
    acc = 0;
  function advance() {
    const ts = performance.now(),
      dt = Math.min(2000, ts - last);
    last = ts;
    if (!S.playing) return;
    S.now += (S.speed * dt) / 1000;
    if (S.now >= S.net.meta.t1) {
      S.now = S.net.meta.t1;
      S.playing = false;
      header();
      renderLeft();
      renderLive();
      return;
    }
    acc += dt;
    if (acc > 220) {
      acc = 0;
      renderLive();
    }
  }
  // Draw at most ~60 times a second (high-refresh screens ask for 120-165), and only ~20 times a second while the clock is paused
  // and nobody is touching the map: it is still animated (storm pulse, hold rings) but costs a third of the CPU/battery.
  let lastDraw = 0,
    lastTouch = 0;
  ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(
      ev,
      () => {
        lastTouch = performance.now();
      },
      { passive: true }
    )
  );
  function frame(ts) {
    advance();
    const idle = !S.playing && ts - lastTouch > 2000;
    if (ts - lastDraw >= (idle ? 48 : 14)) {
      lastDraw = ts;
      map.draw(ts);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(advance, 200);
  // ---------- situation report: the same story as the map, as plain text ----------
  function sitrepText() {
    const m = M(),
      now = S.now,
      acts = S.weather.filter(e => now >= e.start && now < e.start + e.dur);
    const where = e => {
      const h = hits(e);
      return (
        e.type +
        ' ' +
        (h.length
          ? 'affecting ' +
            h
              .slice(0, 3)
              .map(x => x.code + ' (' + x.txt + ')')
              .join(', ')
          : 'in open airspace')
      );
    };
    let t = S.net.meta.name + ' network at ' + hhmm(now) + ' ' + S.net.meta.tzLabel + '. ';
    t += S.weather.length
      ? S.weather.length +
        ' problem' +
        (S.weather.length > 1 ? 's' : '') +
        ' planted: ' +
        S.weather.map(where).join('; ') +
        '. '
      : 'No problems planted: clear skies. ';
    if (acts.length) t += acts.length + ' active now. ';
    t +=
      m.due +
      ' flights scheduled so far: ' +
      m.delayed +
      ' late, ' +
      m.cancelled +
      ' cancelled, ' +
      m.diverted +
      ' diverted, ' +
      Math.round(m.otp * 100) +
      '% on time. Passengers have lost ' +
      num(m.paxDelayMin / 60) +
      ' hours to delay and ' +
      m.stranded +
      ' are stranded. ';
    if (S.plan.length) {
      const saved = (DS.objective(S.res.base, 'pax') - DS.objective(R(), 'pax')) / 60;
      t +=
        'Recovery plan of ' +
        S.plan.length +
        ' measure' +
        (S.plan.length > 1 ? 's' : '') +
        (saved >= 0 ? ' saves ' : ' adds ') +
        num(Math.abs(saved)) +
        ' passenger-hours of delay over the day versus doing nothing.';
    } else t += 'No recovery measures applied yet.';
    return t;
  }
  function updateSitrep() {
    const t = sitrepText(),
      el = $('#sitrep');
    if (el.textContent !== t) el.textContent = t;
    el.setAttribute('aria-live', S.playing ? 'off' : 'polite');
    $('#map').setAttribute('aria-label', 'Interactive map. ' + t);
  }

  // ---------- auto-optimise (shared by the button and the demo) ----------
  function doAutoOpt(quiet) {
    let n = 0;
    for (let k = 0; k < 6; k++) {
      const A = DS.advise(S.net, S.weather, S.plan, S.now, S.objective);
      if (!A.items.length) break;
      const a = Object.assign({ id: S.nextId++ }, A.items[0].action, { from: S.now });
      S.plan.push(a);
      n++;
    }
    recompute();
    const A = DS.advise(S.net, S.weather, S.plan, S.now, S.objective);
    S.advice = { at: S.now, items: A.items, baseObj: A.baseObj, mode: S.objective, stale: false };
    renderAll();
    if (!quiet)
      toast(
        n
          ? 'Auto-optimiser applied ' + n + ' measure' + (n > 1 ? 's' : '')
          : 'Nothing further improves the plan'
      );
    return n;
  }

  // ---------- start-here bar, help, import ----------
  function closeTour() {
    $('#tour').classList.add('hidden');
    document.body.classList.remove('has-tour');
    try {
      sessionStorage.setItem('domino-sky-tour', '0');
    } catch (e) {
      /* ignore */
    }
    map.resize();
  }
  function openDialog(id) {
    const d = $(id);
    if (d.showModal) {
      if (!d.open) d.showModal();
    } else d.setAttribute('open', '');
  }
  function openHelp() {
    openDialog('#helpDlg');
  }
  function openImport() {
    $('#importMsg').textContent = '';
    $('#importMsg').className = 'note';
    openDialog('#importDlg');
  }
  function importCard() {
    if (S.net.meta.id !== 'custom' || !S.importReport) return '';
    const r = S.importReport,
      unk = Object.keys(r.unknownAirports);
    return (
      '<div class="card hero"><h5>Imported schedule</h5><p style="margin:0">' +
      num(r.imported) +
      ' flights on ' +
      num(r.tails) +
      ' aircraft' +
      (r.inferredTails ? ' (rotations inferred from the timetable)' : '') +
      ' across ' +
      r.airports +
      ' airports.' +
      (unk.length
        ? ' Skipped flights touching unknown airports: ' +
          esc(unk.slice(0, 8).join(', ')) +
          (unk.length > 8 ? '…' : '') +
          '.'
        : '') +
      (r.badTime ? ' ' + r.badTime + ' rows had unreadable times.' : '') +
      (r.tooLate ? ' ' + r.tooLate + ' flights fall outside the simulated window.' : '') +
      '<br><span style="color:var(--dim)">Columns used — ' +
      esc(
        ['orig', 'dest', 'std', 'sta', 'tail', 'num'].map(k => k + ': ' + (r.columns[k] || '—')).join(' · ')
      ) +
      '</span></p></div>'
    );
  }
  function finishImport(r) {
    S.customNet = r.net;
    S.importReport = r.report;
    if (!$('#networkSel option[value="custom"]')) {
      const o = document.createElement('option');
      o.value = 'custom';
      o.textContent = 'Imported schedule';
      $('#networkSel').appendChild(o);
    }
    closeDialog('#importDlg');
    setNetwork('custom', r.net);
    $('#scenarioSel').value = r.net.meta.scenarios[0].id;
  }
  function closeDialog(id) {
    const d = $(id);
    if (d.close) d.close();
    else d.removeAttribute('open');
  }
  function runImport(text) {
    const msg = $('#importMsg');
    try {
      if (text.length > DS.IMPORT_LIMITS.fileBytes)
        throw new Error('Import rejected: the file is larger than 5 MB.');
      const r = DS.networkFromSchedule(DS.parseTable(text));
      DS.validateNetwork(r.net);
      finishImport(r);
    } catch (err) {
      msg.textContent = '⚠ ' + err.message;
      msg.className = 'note err';
      openDialog('#importDlg');
    }
  }
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    $('#importText').value = await f.text();
    $('#importMsg').textContent =
      'Loaded ' + f.name + ' (' + Math.round(f.size / 1024) + ' KB) — press “Import & simulate”.';
    $('#importMsg').className = 'note';
  });
  $('#importGo').addEventListener('click', () => runImport($('#importText').value));
  $('#importSample').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([DS.scheduleToCSV(S.net)], { type: 'text/csv' }));
    a.download = 'domino-sky-sample-schedule.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  document
    .querySelectorAll('[data-close]')
    .forEach(b => b.addEventListener('click', () => closeDialog(b.dataset.close)));
  window.addEventListener('dragover', e => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', async e => {
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    const t = await f.text();
    $('#importText').value = t;
    runImport(t);
  });
  $('#btnImport').addEventListener('click', openImport);

  document.addEventListener('keydown', e => {
    if (e.key === '?' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) openHelp();
  });
  window.addEventListener('error', e => {
    if (e && e.message) toast('Something went wrong: ' + e.message);
  });
  window.addEventListener('unhandledrejection', e =>
    toast('Something went wrong: ' + ((e.reason && e.reason.message) || e.reason))
  );
  try {
    if (/[?&]tour=0/.test(location.search) || sessionStorage.getItem('domino-sky-tour') === '0') closeTour();
  } catch (e) {
    /* ignore */
  }
  updateSitrep();

  window.DominoSky = {
    S,
    map,
    recompute,
    addAction,
    renderAll,
    sitrepText,
    HOOKS,
    api: {
      get net() {
        return S.net;
      },
      get T0() {
        return S.net.meta.t0;
      },
      get T1() {
        return S.net.meta.t1;
      },
      R,
      $,
      $$,
      esc,
      hhmm,
      num,
      inr,
      toast,
      addAction,
      renderLeft,
      renderAll,
      renderLive,
      renderBottomShell,
      setNetwork,
      loadScenario,
      scoreData,
      closeTour,
      doAutoOpt,
      header,
      openDialog,
      closeDialog,
      apOptions,
      wxAp,
      recompute,
      selectFlight,
      hits,
      dcol,
      setSpeed: v => {
        S.speed = v;
        $('#speed').value = String(v);
      },
      renderLiveSoon
    }
  };
  document.dispatchEvent(new Event('domino-sky-ready')); // handy for debugging
})();
