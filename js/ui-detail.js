/* Domino Sky — Map detail card, banner and legend; selection and the refresh entry points. */
(function () {
  'use strict';
  const DS = window.DS,
    U = DS.ui;
  const { $, R, S, esc, dcol, hhmm, HOOKS, setHtml, statusOf, causeOf, hits, renderPlant } = U;
  // defined by panels loaded after this one: looked up when called
  const updateKpis = (...args) => U.updateKpis(...args);
  const updateScore = (...args) => U.updateScore(...args);
  const drawChart = (...args) => U.drawChart(...args);
  const updateStandings = (...args) => U.updateStandings(...args);
  const updateBottom = (...args) => U.updateBottom(...args);
  const updateSitrep = (...args) => U.updateSitrep(...args);
  const renderLeft = (...args) => U.renderLeft(...args);
  const renderBottomShell = (...args) => U.renderBottomShell(...args);

  // =====================================================================
  //  MAP DETAIL CARD
  // =====================================================================
  function updateDetail() {
    const el = $('#detail');
    const res = R(),
      now = S.now;
    if (S.sel.airport) {
      const a = S.net.airportMap[S.sel.airport],
        st = (U.map.st || {})[a.code] || {},
        fac = DS.wxFactor(S.weather, a.code, now);
      const next = res.flights
        .filter(f => f.orig === a.code && f.status === 'ok' && f.std >= now - 20 && f.std <= now + 240)
        .sort((x, y) => x.std - y.std)
        .slice(0, 6);
      const status =
        fac === 0
          ? '<span class="pill bad">CLOSED</span>'
          : fac < 1
            ? `<span class="pill warn">${Math.round(fac * 100)}% capacity</span>`
            : '<span class="pill ok">Normal ops</span>';
      const html = `<button class="x" data-act="closeDetail">✕</button><h4>${a.code} ${status}</h4><div class="sub">${esc(a.name)}, ${esc(a.city)}</div>
        <dl class="kv"><dt>Runway rate</dt><dd>${Math.round(a.cap * fac)} / ${a.cap} mov/h</dd><dt>Departures waiting</dt><dd style="color:${st.wait ? '#f87171' : ''}">${st.wait || 0}</dd><dt>Inbound airborne</dt><dd>${st.inbound || 0}</dd><dt>Avg dep delay (3h)</dt><dd style="color:${dcol(st.n ? st.sum / st.n : 0)}">${st.n ? Math.round(st.sum / st.n) : 0} min</dd></dl>
        <div style="font-size:11px;color:var(--muted);margin:6px 0 2px">NEXT DEPARTURES</div>
        <table>${next.map(f => `<tr class="click" data-act="selFl" data-id="${f.id}"><td><b>${f.num}</b></td><td>→${f.dest}</td><td class="r">${hhmm(f.std)}</td><td class="r" style="color:${dcol(f.adep - f.std)}">${f.adep - f.std >= 1 ? '+' + Math.round(f.adep - f.std) : '·'}</td></tr>`).join('') || '<tr><td class="empty">No departures soon</td></tr>'}</table>
        <div class="btnrow"><button class="btn sm" data-act="apGdp" data-code="${a.code}">Ground-delay</button><button class="btn sm" data-act="apSurge" data-code="${a.code}">Surge ops</button><button class="btn sm" data-act="apFt" data-code="${a.code}">Fast turns</button><button class="btn sm" data-act="apHold" data-code="${a.code}">Hold conn.</button>${HOOKS.airportButtons(a.code)}<button class="btn sm" data-act="apStorm" data-code="${a.code}">Storm here</button></div>`;
      el.classList.remove('hidden');
      setHtml(el, html);
    } else if (S.sel.flight != null) {
      const f = res.flights[S.sel.flight],
        st = statusOf(f, now),
        T = res.tails[f.tail];
      const chain = T.chain.map(i => res.flights[i]),
        pos = chain.indexOf(f);
      const later = chain.slice(pos + 1).filter(x => x.status === 'cancelled' || x.aarr - x.sta > 15).length;
      const future = f.status === 'ok' ? f.adep > now : f.std > now;
      const html =
        (HOOKS.flightCard ? HOOKS.flightCard(f, st) : '') +
        `
        <div class="note" style="margin:0 0 4px">${esc(causeOf(f)) || 'Running to schedule'}</div>
        ${later ? `<div class="note" style="color:#fbbf24;margin:0">Knock-on: ${later} later flight${later > 1 ? 's' : ''} on this aircraft ${later > 1 ? 'are' : 'is'} delayed or cancelled.</div>` : ''}
        <div class="btnrow"><button class="btn sm" data-act="viewCascade">See dominoes</button>${future ? `<button class="btn sm" data-act="flSwap" data-id="${f.id}">Swap spare</button><button class="btn sm danger" data-act="flCancel" data-id="${f.id}">Cancel rotation</button>` : ''}</div>`;
      el.classList.remove('hidden');
      setHtml(el, html);
    } else el.classList.add('hidden');
  }
  function updateBanner() {
    const now = S.now;
    const chips = [];
    if (S.placing)
      chips.push(
        `<div class="chip" style="border-color:#d9b46a"><span class="dot" style="background:#d9b46a"></span>${DS.WXT[S.placing].icon} Click anywhere on the map to plant <b>${S.placing}</b> · Esc to cancel</div>`
      );
    S.weather.forEach(e => {
      const end = e.start + e.dur,
        m = DS.WXT[e.type],
        h = hits(e),
        loc = h.length
          ? h
              .slice(0, 3)
              .map(x => x.code)
              .join('/')
          : 'open airspace';
      if (now < e.start - 240)
        chips.push(
          `<div class="chip"><span class="dot" style="background:#64748b"></span>${m.icon} ${e.type} forecast near ${loc} · ${hhmm(e.start)}–${hhmm(end)}</div>`
        );
      else if (now < e.start)
        chips.push(
          `<div class="chip" style="border-color:#9eabbc"><span class="dot" style="background:#fbbf24"></span>${m.icon} <b>${e.type}</b> reaches ${loc} in ${Math.round(e.start - now)} min — act now</div>`
        );
      else if (now < end)
        chips.push(
          `<div class="chip" style="border-color:#ef4444"><span class="dot" style="background:#ef4444"></span>${m.icon} <b>${e.type}</b> · ${
            h.length
              ? h
                  .slice(0, 3)
                  .map(x => x.code + ' ' + x.txt)
                  .join(', ')
              : 'en-route only'
          } until ${hhmm(end)}</div>`
        );
      else if (now < end + 240)
        chips.push(
          `<div class="chip"><span class="dot" style="background:#34d399"></span>${e.type} cleared ${hhmm(end)} — backlog clearing</div>`
        );
    });
    if (chips.length > 4) {
      const n = chips.length - 3;
      chips.length = 3;
      chips.push(`<div class="chip">+${n} more problems — see the Weather tab</div>`);
    }
    setHtml($('#banner'), chips.join(''));
  }
  function updateLegend() {
    setHtml(
      $('#legend'),
      S.colorMode === 'live'
        ? '<span><i style="background:#ffc107"></i>in the air</span><span><i style="background:transparent;border:2px solid #f87171"></i>ring = running late</span><span><i style="background:#ef4444"></i>closed</span><span style="color:var(--dim)">drag · scroll to zoom</span>'
        : S.colorMode === 'gen'
          ? `<span><i style="background:#34d399"></i>unaffected</span>${DS.GENCOL.map((c, i) => `<span><i style="background:${c}"></i>G${i}${i === 4 ? '+' : ''}</span>`).join('')}<span style="color:var(--dim)">drag · scroll to zoom</span>`
          : `<span><i style="background:#34d399"></i>≤15</span><span><i style="background:#fbbf24"></i>≤45</span><span><i style="background:#fb923c"></i>≤120</span><span><i style="background:#f87171"></i>&gt;2h</span><span style="color:var(--dim)">min late · drag · scroll to zoom</span>`
    );
  }

  // =====================================================================
  //  selection / actions
  // =====================================================================
  function selectFlight(id) {
    S.sel.flight = id;
    S.sel.tail = R().flights[id].tail;
    S.sel.airport = null;
    renderLiveSoon();
  }
  function selectAirport(code) {
    S.sel.airport = code;
    S.sel.flight = null;
    S.sel.tail = null;
    renderLiveSoon();
  }

  function header() {
    $('#clock').textContent = hhmm(S.now).replace('⁺¹', '');
    $('#clockDay').textContent = S.net.meta.tzLabel + (S.now >= 1440 ? ' · day 2' : '');
    $('#scrub').value = S.now;
    $('#btnPlay').textContent = S.playing ? '❚❚ Pause' : S.now >= S.net.meta.t1 ? '↺ Replay' : '▶ Play';
    $('#btnPlay').classList.toggle('primary', true);
  }
  function renderLive() {
    header();
    updateBanner();
    updateKpis();
    updateScore();
    drawChart();
    updateStandings();
    updateBottom();
    updateDetail();
    updateSitrep();
  }
  let liveSoon = false;
  function renderLiveSoon() {
    if (!liveSoon) {
      liveSoon = true;
      requestAnimationFrame(() => {
        liveSoon = false;
        renderLive();
      });
    }
  }
  function renderAll() {
    renderLeft();
    renderBottomShell();
    renderLive();
    updateLegend();
    renderPlant();
  }

  Object.assign(U, {
    renderAll,
    selectFlight,
    renderLiveSoon,
    selectAirport,
    renderLive,
    updateLegend,
    header
  });
})();
