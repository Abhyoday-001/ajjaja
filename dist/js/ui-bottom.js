/* Domino Sky — Bottom panel: rotation schedule (Gantt), flight board, where-to-fix, cascade and passengers. */
(function () {
  'use strict';
  const DS = window.DS,
    U = DS.ui;
  const {
    $$,
    S,
    $,
    hideTip,
    showTip,
    R,
    TC,
    dcol,
    hhmm,
    statusOf,
    esc,
    causeOf,
    O,
    num,
    objVal,
    unitS,
    setHtml,
    HOOKS,
    wxAirports,
    M,
    resetHtmlCache
  } = U;
  // defined by panels loaded after this one: looked up when called
  const selectFlight = (...args) => U.selectFlight(...args);
  const renderLiveSoon = (...args) => U.renderLiveSoon(...args);

  // =====================================================================
  //  BOTTOM PANEL
  // =====================================================================
  function renderBottomShell() {
    $$('#botTabs button[data-tab]').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === S.btab);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', b.dataset.tab === S.btab);
    });
    const el = $('#botBody');
    resetHtmlCache();
    ganttHits = [];
    if (S.btab === 'gantt') {
      el.style.padding = '0';
      el.innerHTML = `<div class="ganttwrap" id="ganttWrap"><canvas id="ganttHead" role="presentation" aria-hidden="true" style="position:sticky;top:0;z-index:2"></canvas><canvas id="ganttCv" role="img" aria-label="Rotation schedule: one row per aircraft showing each flight as a bar, coloured by delay. The Flight board tab lists the same flights as a table."></canvas></div>`;
      $('#botExtra').innerHTML =
        `<div class="chips" id="gMode"><button data-g="full" class="${S.gantt.mode === 'full' ? 'on' : ''}">Full day</button><button data-g="focus" class="${S.gantt.mode === 'focus' ? 'on' : ''}">Follow clock</button></div>
        <div class="chips" id="gSort"><button data-s="base" class="${S.gantt.sort === 'base' ? 'on' : ''}">By base</button><button data-s="worst" class="${S.gantt.sort === 'worst' ? 'on' : ''}">Most delayed</button></div>`;
      bindGantt();
    } else {
      el.style.padding = '';
      $('#botExtra').innerHTML = '';
      el.innerHTML = '<div id="botInner"></div>';
    }
    updateBottom(true);
  }
  let ganttHits = [];
  function bindGantt() {
    const cv = $('#ganttCv');
    cv.addEventListener('mousemove', e => {
      const r = cv.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top;
      const h = ganttHits.find(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
      if (!h) {
        hideTip();
        cv.style.cursor = 'default';
        return;
      }
      cv.style.cursor = 'pointer';
      showTip(flightTip(h.id), e.clientX, e.clientY);
    });
    cv.addEventListener('mouseleave', hideTip);
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top;
      const h = ganttHits.find(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
      if (h) selectFlight(h.id);
      else {
        const row = ganttRows[Math.floor((y - 2) / 17)];
        if (row) {
          S.sel.tail = row.id;
          S.sel.flight = null;
          renderLiveSoon();
        }
      }
    });
  }
  let ganttRows = [];
  function drawGantt() {
    const wrap = $('#ganttWrap'),
      cv = $('#ganttCv'),
      hd = $('#ganttHead');
    if (!wrap || !cv) return;
    const res = R(),
      dpr = devicePixelRatio || 1;
    let rows = Object.values(res.tails)
      .filter(t => t.chain.length)
      .map(t => {
        const L = t.chain.map(i => res.flights[i]);
        const mx = Math.max(0, ...L.map(f => (f.status === 'ok' ? f.aarr - f.sta : 150)));
        return {
          id: t.id,
          chain: L,
          base: S.net.tails.find(x => x.id === t.id).base,
          worst: mx,
          airline: L[0].airline
        };
      });
    rows.sort(
      S.gantt.sort === 'worst'
        ? (a, b) => b.worst - a.worst
        : (a, b) => a.base.localeCompare(b.base) || a.id.localeCompare(b.id)
    );
    ganttRows = rows;
    const W = wrap.clientWidth - 1,
      rowH = 17,
      left = 76,
      HH = 22,
      H = rows.length * rowH + 4;
    if (W < 50) return;
    const [t0, t1] =
      S.gantt.mode === 'full'
        ? [S.net.meta.t0, S.net.meta.t1]
        : [Math.max(S.net.meta.t0, S.now - 120), Math.min(S.net.meta.t1, S.now + 480)];
    const x = t => left + ((t - t0) / (t1 - t0)) * (W - left - 6);
    [
      [cv, H],
      [hd, HH]
    ].forEach(([c, h]) => {
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = W + 'px';
        c.style.height = h + 'px';
      }
    });
    const ctx = cv.getContext('2d'),
      hx = hd.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    hx.clearRect(0, 0, W, HH);
    const tc = TC();
    hx.fillStyle = tc.head;
    hx.fillRect(0, 0, W, HH);
    hx.font = '10.5px ui-monospace,monospace';
    hx.textAlign = 'center';
    hx.fillStyle = tc.headTxt;
    const stepH = t1 - t0 > 900 ? 2 : 1;
    ctx.strokeStyle = tc.grid;
    ctx.lineWidth = 1;
    for (let h = Math.ceil(t0 / 60); h * 60 <= t1; h += 1) {
      const xx = x(h * 60);
      if (h % stepH === 0) {
        hx.fillText(String(h % 24).padStart(2, '0') + ':00', xx, 15);
      }
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, H);
      ctx.stroke();
    }
    hx.strokeStyle = tc.headLine;
    hx.beginPath();
    hx.moveTo(0, HH - 0.5);
    hx.lineTo(W, HH - 0.5);
    hx.stroke();
    S.weather.forEach(e => {
      const a = x(Math.max(t0, e.start)),
        b = x(Math.min(t1, e.start + e.dur));
      if (b > a) {
        ctx.fillStyle = tc.band;
        ctx.fillRect(a, 0, b - a, H);
        hx.fillStyle = tc.bandHead;
        hx.fillRect(a, HH - 4, b - a, 3);
      }
    });
    ganttHits = [];
    const selTail = S.sel.tail || (S.sel.flight != null ? res.flights[S.sel.flight].tail : null);
    ctx.font = '10px ui-monospace,monospace';
    rows.forEach((row, r) => {
      const y = 2 + r * rowH;
      if (row.id === selTail) {
        ctx.fillStyle = tc.selRow;
        ctx.fillRect(0, y - 1, W, rowH);
      } else if (r % 2) {
        ctx.fillStyle = tc.rowAlt;
        ctx.fillRect(0, y - 1, W, rowH);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = row.id === selTail ? tc.txtSel : tc.txt;
      ctx.fillText(row.id.slice(row.id.indexOf('-') + 1) + ' ' + row.base, 4, y + 11);
      ctx.fillStyle = (S.net.airlines.find(a => a.code === row.airline) || {}).color || '#888';
      ctx.fillRect(left - 8, y + 3, 3, 9);
      row.chain.forEach(f => {
        const sx0 = x(f.std),
          sx1 = x(f.sta);
        if (sx1 < left || sx0 > W) return;
        if (f.status === 'cancelled') {
          ctx.fillStyle = 'rgba(248,113,113,.08)';
          ctx.fillRect(sx0, y + 3, sx1 - sx0, 10);
          ctx.strokeStyle = 'rgba(248,113,113,.7)';
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(sx0 + 0.5, y + 3.5, sx1 - sx0 - 1, 9);
          ctx.setLineDash([]);
          if (sx1 - sx0 > 18) {
            ctx.fillStyle = '#f87171';
            ctx.textAlign = 'center';
            ctx.fillText('✕', (sx0 + sx1) / 2, y + 11.5);
          }
          ganttHits.push({ id: f.id, x0: sx0, x1: sx1, y0: y + 2, y1: y + 14 });
          return;
        }
        ctx.fillStyle = tc.sliver;
        ctx.fillRect(sx0, y + 1, sx1 - sx0, 2); // scheduled sliver
        const a0 = x(f.adep),
          a1 = x(f.aarr),
          fut = f.adep > S.now,
          d = f.aarr - f.sta;
        const col = S.colorMode === 'gen' ? DS.colGen(f.gen) : dcol(d);
        ctx.globalAlpha = fut ? 0.5 : 1;
        ctx.fillStyle = col;
        ctx.fillRect(a0, y + 4, Math.max(2, (f.eta != null ? x(f.eta) : a1) - a0), 9);
        if (f.aarr > f.eta + 1) {
          ctx.fillStyle = '#fb923c';
          ctx.globalAlpha = (fut ? 0.5 : 1) * 0.65;
          ctx.fillRect(x(f.eta), y + 6, Math.max(1, a1 - x(f.eta)), 5);
        }
        ctx.globalAlpha = 1;
        if (f.divert) {
          ctx.fillStyle = '#b9c3d1';
          ctx.beginPath();
          const dx = x(f.divArr);
          ctx.moveTo(dx, y + 2);
          ctx.lineTo(dx + 4, y + 8);
          ctx.lineTo(dx, y + 14);
          ctx.lineTo(dx - 4, y + 8);
          ctx.fill();
        }
        if (f.adep - f.std > 2) {
          ctx.strokeStyle = 'rgba(255,255,255,.5)';
          ctx.beginPath();
          ctx.moveTo(sx0, y + 8.5);
          ctx.lineTo(a0, y + 8.5);
          ctx.stroke();
        }
        if (S.sel.flight === f.id) {
          ctx.strokeStyle = tc.selOutline;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(a0 - 0.5, y + 3.5, Math.max(3, a1 - a0), 10);
          ctx.lineWidth = 1;
        }
        if (a1 - a0 > 30) {
          ctx.fillStyle = '#06101f';
          ctx.textAlign = 'center';
          ctx.fillText(f.dest, (a0 + Math.min(a1, x(f.eta))) / 2, y + 12);
        }
        ganttHits.push({ id: f.id, x0: Math.min(sx0, a0), x1: Math.max(a1, sx1), y0: y + 1, y1: y + 14 });
      });
    });
    if (S.now >= t0 && S.now <= t1) {
      const nx = x(S.now);
      ctx.strokeStyle = tc.nowLine;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(nx, 0);
      ctx.lineTo(nx, H);
      ctx.stroke();
      hx.fillStyle = tc.nowBg;
      hx.fillRect(nx - 19, 1, 38, 13);
      hx.fillStyle = tc.nowTxt;
      hx.font = '600 10px ui-monospace,monospace';
      hx.fillText(hhmm(S.now), nx, 11);
    }
  }
  function flightTip(id) {
    const f = R().flights[id],
      st = statusOf(f, S.now);
    if (f.status === 'cancelled')
      return `<b>${f.num}</b> ${f.orig}→${f.dest} <span class="pill cancel">Cancelled</span><br><span style="color:var(--muted)">${esc(causeOf(f))}</span><br>Tail ${f.tail}`;
    const d = f.aarr - f.sta;
    return `<b>${f.num}</b> ${f.orig}→${f.dest} <span class="pill ${st.k}">${st.text}</span><br>
      STD ${hhmm(f.std)} → <b>${hhmm(f.adep)}</b> (${f.adep - f.std >= 0.5 ? '+' + Math.round(f.adep - f.std) : 'on time'})<br>STA ${hhmm(f.sta)} → <b>${hhmm(f.aarr)}</b> (${d > 0.5 ? '+' + Math.round(d) : 'on time'})<br>
      Tail ${f.tail}${f.gen >= 0 ? ` · domino gen <b>${f.gen}</b>` : ''}<br><span style="color:var(--muted)">${esc(causeOf(f))}</span>`;
  }

  let lastFixT = 0;
  const rootName = r =>
    r === 'en-route'
      ? 'En-route detours'
      : r === 'other'
        ? 'Other / unattributed'
        : S.net.airportMap[r]
          ? r + ' · ' + S.net.airportMap[r].city
          : r;
  function fixEval(risks) {
    const key = [
      Math.round(S.now / 5),
      S.plan.map(a => a.id).join(','),
      S.objective,
      JSON.stringify(
        S.weather.map(e => [e.id, +e.lat.toFixed(2), +e.lon.toFixed(2), e.start, e.dur, e.severity, e.radius])
      )
    ].join('|');
    if (S.fixCache.key !== key) {
      if (S.playing && S.fixCache.opts) return S.fixCache.opts; // keep the last evaluation while the clock runs
      const opts = {};
      risks.slice(0, 6).forEach(r => {
        opts[r.id] = DS.fixOptions(S.net, S.weather, S.plan, S.now, r.id, S.objective, R());
      });
      S.fixCache = { key, opts };
    }
    return S.fixCache.opts;
  }
  function fixHtml() {
    const res = R(),
      now = S.now,
      dg = DS.diagnose(S.net, res, now),
      o = O();
    if (!S.weather.length)
      return '<div class="empty">Plant a problem to see where the damage comes from.</div>';
    const tot = dg.direct + dg.knock;
    if (tot < 600)
      return '<div class="empty">No disruption yet — press play, or move the clock past the first problem.</div>';
    const knockShare = Math.round((dg.knock / tot) * 100);
    const rootRows = dg.roots
      .slice(0, 6)
      .map(
        r => `<tr class="click" ${S.net.airportMap[r.root] ? `data-act="selAp" data-code="${r.root}"` : ''}>
      <td><b>${esc(rootName(r.root))}</b></td>
      <td style="width:38%"><div class="bar" style="height:10px;display:flex"><i style="width:${(r.direct / tot) * 100 * 2.2}%;background:#9eabbc" title="direct"></i><i style="width:${(r.knock / tot) * 100 * 2.2}%;background:#ef4444" title="knock-on"></i></div></td>
      <td class="r">${num(r.total / 60)} h</td><td class="r">${Math.round((r.total / tot) * 100)}%</td><td class="r" style="color:var(--muted)">${r.flights + r.cancels} flt${r.cancels ? ' · ' + r.cancels + '✕' : ''}</td></tr>`
      )
      .join('');
    const top = dg.roots[0];
    // bottlenecks right now
    const bn = S.net.airports
      .map(a => {
        let wait = 0,
          hold = 0;
        res.flights.forEach(f => {
          if (f.status !== 'ok') return;
          if (f.orig === a.code && f.std <= now && f.adep > now) wait++;
          if (f.dest === a.code && !f.divert && f.eta <= now && f.aarr > now) hold++;
        });
        const fac = DS.wxFactor(S.weather, a.code, now);
        return { a, wait, hold, fac };
      })
      .filter(x => x.wait + x.hold > 0 || x.fac < 1)
      .sort((x, y) => y.wait + y.hold - (x.wait + x.hold))
      .slice(0, 6);
    const bnRows = bn
      .map(
        x =>
          `<tr class="click" data-act="selAp" data-code="${x.a.code}"><td><b>${x.a.code}</b> ${esc(x.a.city)}</td><td>${x.fac === 0 ? '<span class="pill bad">closed</span>' : x.fac < 1 ? `<span class="pill warn">${Math.round(x.fac * 100)}% cap</span>` : '<span class="pill ok">open</span>'}</td><td class="r" style="color:${x.wait ? '#f87171' : ''}">${x.wait || ''}</td><td class="r" style="color:${x.hold ? '#fb923c' : ''}">${x.hold || ''}</td></tr>`
      )
      .join('');
    // next dominoes
    const opts = fixEval(dg.risks);
    const riskRows = dg.risks
      .slice(0, 8)
      .map(r => {
        const f = res.flights[r.id],
          ops = opts[r.id],
          best = ops && ops[0] && ops[0].gain > o.eps ? ops[0] : null;
        const fix = !ops
          ? `<button class="btn sm" data-act="fixSwap" data-id="${r.id}">Swap</button> <button class="btn sm danger" data-act="fixCancel" data-id="${r.id}">Cancel</button>`
          : best
            ? `<span class="tag good">${esc(best.label.replace('Swap in spare ', 'Spare ').replace('Cancel rotation', 'Cancel rotation'))} · −${objVal(best.gain)} ${unitS()}</span> <button class="btn sm" data-act="applyFix" data-id="${r.id}" data-k="0">Apply</button>`
            : '<span class="tag">no measure helps — let it ride</span>';
        return `<tr><td class="click" data-act="selFl" data-id="${r.id}"><b>${f.num}</b> ${f.orig}→${f.dest}</td><td class="r">${hhmm(f.std)}</td><td class="r" style="color:${dcol(r.delay)}">+${Math.round(r.delay)}m</td>
        <td class="r" style="color:${r.slack != null && r.slack < 5 ? '#f87171' : 'var(--muted)'}">${r.slack == null ? '—' : r.slack < 5 ? 'none' : Math.round(r.slack) + 'm'}</td><td class="r">${r.kF ? r.kF + ' flt · ' + num(r.kPax / 60) + ' h' : '—'}</td><td>${fix}</td></tr>`;
      })
      .join('');
    return `<div class="two" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr)">
      <div><h3 style="margin-top:0">Where the damage comes from <span class="tag">${num(tot / 60)} pax-hours of delay traced</span></h3>
        <table style="table-layout:auto"><tr><th>Root cause</th><th title="brass = hit directly by the problem, red = late only because the aircraft was late"><span style="color:#9eabbc">■</span> direct · <span style="color:#ef4444">■</span> knock-on</th><th class="r">Pax-h</th><th class="r">Share</th><th class="r">Flights</th></tr>${rootRows}</table>
        <div class="note" style="color:var(--text);margin-top:6px"><b>${knockShare}%</b> of this delay is knock-on — flights late only because their <i>aircraft</i> was late. ${top ? `<b>${esc(rootName(top.root))}</b> alone is the origin of ${Math.round((top.total / tot) * 100)}%. ` : ''}Breaking aircraft chains (spare swap, ground hold) attacks the knock-on part; runway and queue measures attack the direct part.</div>
        ${bnRows ? `<h3>Bottlenecks right now</h3><table><tr><th>Airport</th><th>Status</th><th class="r">Waiting to depart</th><th class="r">Holding to land</th></tr>${bnRows}</table>` : ''}</div>
      <div><h3 style="margin-top:0">Next dominoes to fall <span class="tag">from ${hhmm(now)}</span></h3>
        ${
          riskRows
            ? `<div style="overflow-x:auto"><table><tr><th>Flight</th><th class="r">STD</th><th class="r">Late</th><th class="r" title="Scheduled turnaround buffer left after this flight, before the next one is affected">Buffer</th><th class="r" title="Later flights on this aircraft dragged down">Drags down</th><th>Best fix (measured)</th></tr>${riskRows}</table></div>
        <div class="note">${S.playing ? 'Pause the clock to re-measure each fix.' : 'Each fix is simulated against the whole day and scored on <b>' + o.label.toLowerCase() + '</b>.'}</div>`
            : '<div class="empty">No upcoming flight is predicted more than 20 min late.</div>'
        }</div></div>`;
  }

  function updateBottom(force) {
    if (S.btab === 'gantt') {
      drawGantt();
      return;
    }
    const el = $('#botInner');
    if (!el) return;
    if (S.btab === 'board') boardView(el, force);
    else if (S.btab === 'fix') {
      if (!S.playing || performance.now() - lastFixT > 1000 || force) {
        lastFixT = performance.now();
        setHtml(el, fixHtml());
      }
    } else if (HOOKS.bottom[S.btab]) setHtml(el, HOOKS.bottom[S.btab]());
    else if (S.btab === 'cascade') setHtml(el, cascadeHtml());
    else if (S.btab === 'pax') setHtml(el, paxHtml());
  }
  function boardView(el, force) {
    if (!el.querySelector('#boardTbl')) {
      el.innerHTML = `<div class="tools"><div class="chips" id="bFilter">${[
        ['active', 'Around now'],
        ['delayed', 'Delayed'],
        ['cancelled', 'Cancelled'],
        ['diverted', 'Diverted'],
        ['all', 'All']
      ]
        .map(([k, l]) => `<button data-b="${k}" class="${S.board.filter === k ? 'on' : ''}">${l}</button>`)
        .join('')}</div>
        <input type="search" id="bQ" placeholder="Search flight / airport / tail" value="${esc(S.board.q)}"><span id="bCount" style="color:var(--muted)"></span></div><div id="boardTbl"></div>`;
      resetHtmlCache();
    }
    const now = S.now,
      q = S.board.q.trim().toUpperCase(),
      res = R();
    let L = res.flights
      .filter(f => {
        if (q && !(f.num + f.orig + f.dest + f.tail).toUpperCase().includes(q)) return false;
        if (
          S.sel.airport &&
          S.board.filter === 'active' &&
          f.orig !== S.sel.airport &&
          f.dest !== S.sel.airport
        )
          return false;
        switch (S.board.filter) {
          case 'delayed':
            return (
              f.status === 'ok' &&
              (now >= f.std || f.adep <= now) &&
              (f.adep <= now ? f.adep - f.std : now - f.std) > 15
            );
          case 'cancelled':
            return (
              f.status === 'cancelled' && Math.min(f.cancelAt == null ? f.std : f.cancelAt, f.std) <= now
            );
          case 'diverted':
            return f.divert && f.eta <= now;
          case 'active':
            return (
              (f.std >= now - 60 && f.std <= now + 150) ||
              (f.status === 'ok' && f.adep <= now && f.aarr > now)
            );
          default:
            return true;
        }
      })
      .sort((a, b) => a.std - b.std);
    const total = L.length;
    L = L.slice(0, 220);
    $('#bCount').textContent = total + ' flights';
    const rows = L.map(f => {
      const st = statusOf(f, now),
        dly = f.status === 'ok' ? f.adep - f.std : 0;
      return `<tr class="click ${S.sel.flight === f.id ? 'sel' : ''}" data-act="selFl" data-id="${f.id}"><td><b>${f.num}</b></td><td>${f.orig}→${f.dest}</td><td style="color:var(--muted)">${f.tail.slice(3)}</td>
        <td class="r">${hhmm(f.std)}</td><td class="r" style="color:${f.status === 'ok' ? dcol(dly) : 'var(--cancel)'}">${f.status === 'ok' ? hhmm(f.adep) : '—'}</td><td class="r">${f.status === 'ok' && dly >= 1 ? '+' + Math.round(dly) : ''}</td>
        <td><span class="pill ${st.k}">${st.text}</span></td><td style="color:var(--muted);font-size:11.5px">${esc(causeOf(f))}</td></tr>`;
    }).join('');
    setHtml(
      $('#boardTbl'),
      `<table><tr><th>Flight</th><th>Route</th><th>Tail</th><th class="r">STD</th><th class="r">ETD</th><th class="r">Delay</th><th>Status</th><th>Cause</th></tr>${rows}</table>`
    );
  }

  function attributionAt(res, t) {
    const a = { weather: 0, airborne: 0, reactionary: 0, congestion: 0, measures: 0, minor: 0 };
    res.flights.forEach(f => {
      if (f.status !== 'ok' || f.adep > t) return;
      if (f.slotWx) a.weather += f.slot;
      else a.congestion += f.slot;
      a.reactionary += f.react;
      a.measures += f.hold + f.gdp;
      a.minor += f.noise;
      if (f.eta <= t) {
        if (f.airWx) a.airborne += f.airHold;
        else a.congestion += f.airHold;
        a.airborne += f.detour;
      }
    });
    return a;
  }
  function cascadeHtml() {
    const res = R(),
      now = S.now;
    const tail = S.sel.tail || (S.sel.flight != null ? res.flights[S.sel.flight].tail : S.worstTail);
    let dom = '<div class="empty">Add weather to see dominoes fall.</div>',
      title = '';
    if (tail && res.tails[tail]) {
      const T = res.tails[tail],
        tinfo = S.net.tails.find(x => x.id === tail);
      title =
        `<b>${tail}</b> · ${tinfo.type} · ${(S.net.airlines.find(a => a.code === tinfo.airline) || {}).name} · base ${tinfo.base}` +
        (tail === S.worstTail && !S.sel.tail && S.sel.flight == null
          ? ' <span class="tag">most knocked-on aircraft</span>'
          : '');
      dom =
        '<div class="dominoes">' +
        T.chain
          .map(id => {
            const f = res.flights[id];
            if (f.status === 'cancelled')
              return `<div class="dom cx" data-act="selFl" data-id="${id}"><span class="n">${f.num}</span><span class="r">${f.orig}→${f.dest}<br>${hhmm(f.std)}</span><span class="d">✕ cancel</span></div>`;
            const d = Math.max(0, f.aarr - f.sta),
              fallen = f.adep <= now,
              rot = fallen ? Math.min(32, d / 5) : 0;
            const gcol = f.gen >= 0 ? DS.GENCOL[Math.min(f.gen, 4)] : '#34d399';
            return `<div class="dom ${fallen ? '' : 'future'}" data-act="selFl" data-id="${id}" style="transform:rotate(${rot}deg);border-color:${fallen ? dcol(d) : ''}">
          ${f.gen >= 0 ? `<span class="g" style="background:${gcol}">G${f.gen}</span>` : ''}<span class="n">${f.num}</span><span class="r">${f.orig}→${f.dest}<br>${hhmm(f.std)} → ${hhmm(f.adep)}</span><span class="d" style="color:${fallen || d > 0 ? dcol(d) : 'var(--muted)'}">${d >= 1 ? '+' + Math.round(d) + 'm' : 'on time'}</span></div>`;
          })
          .join('') +
        '</div>';
    }
    // generations at now
    const gens = [];
    res.flights.forEach(f => {
      if (f.status !== 'ok' || f.gen < 0 || f.adep > now) return;
      const k = Math.min(f.gen, 5);
      gens[k] = gens[k] || { n: 0, min: 0 };
      gens[k].n++;
      gens[k].min += Math.max(0, (f.aarr <= now ? f.aarr : f.adep + f.block) - f.sta);
    });
    const gmax = Math.max(1, ...gens.filter(Boolean).map(g => g.min));
    const gh = [0, 1, 2, 3, 4, 5]
      .map(i => {
        const g = gens[i];
        if (!g && i > 1) return '';
        g && 0;
        const v = g ? g.min : 0,
          n = g ? g.n : 0;
        return `<tr><td style="width:84px"><span class="pill" style="background:${DS.GENCOL[Math.min(i, 4)]};color:#08101f">${i === 0 ? 'G0 · storm' : 'G' + i + (i === 5 ? '+' : '') + ' · knock-on'}</span></td><td><div class="bar" style="height:10px"><i style="width:${(v / gmax) * 100}%;background:${DS.GENCOL[Math.min(i, 4)]}"></i></div></td><td class="r">${n} flt</td><td class="r">${num(v)} m</td></tr>`;
      })
      .join('');
    const at = attributionAt(res, now);
    const tot = Object.values(at).reduce((a, b) => a + b, 0) || 1;
    const wx = at.weather + at.airborne,
      kn = at.reactionary;
    const cols = [
      ['Weather (direct)', wx, '#9eabbc'],
      ['Knock-on (late aircraft)', kn, '#ef4444'],
      ['Congestion', at.congestion, '#f59e0b'],
      ['Your measures', at.measures, '#d9b46a'],
      ['Minor ops', at.minor, '#475569']
    ];
    const stack = cols
      .map(c => `<i style="width:${(c[1] / tot) * 100}%;background:${c[2]}" title="${c[0]}"></i>`)
      .join('');
    const legend = cols
      .map(c => `<span><i style="background:${c[2]}"></i>${c[0]} <b>${num(c[1])}</b></span>`)
      .join('');
    // reach
    const stormAp = new Set(wxAirports());
    const reach = new Set();
    let far = 0;
    res.flights.forEach(f => {
      if (f.status === 'ok' && f.adep <= now && f.adep - f.std > 30 && !stormAp.has(f.orig)) {
        reach.add(f.orig);
        S.weather.forEach(e => {
          far = Math.max(far, DS.hav(e, S.net.airportMap[f.orig]));
        });
      }
    });
    const share = tot > 1 ? Math.round((kn / (wx + kn || 1)) * 100) : 0;
    return `<div class="two"><div><div style="margin-bottom:2px;color:var(--muted)">${title}</div>${dom}<div class="note">Cards lean further the later the flight lands. <b>G0</b> = hit directly by weather; <b>G1, G2…</b> = each later link in the same aircraft's chain. Click a card or a bar to inspect.</div></div>
      <div><div class="row" style="justify-content:space-between"><div><div class="big2" style="color:${share > 50 ? '#f87171' : 'var(--text)'}">${share}%</div><small style="color:var(--muted)">of weather-driven delay is knock-on</small></div>
        <div style="text-align:right"><div class="big2">${reach.size}</div><small style="color:var(--muted)">airports delayed beyond the storm${far ? ' · up to ' + num(far) + ' km away' : ''}</small></div></div>
        <div class="stack">${stack}</div><div class="leg">${legend}</div>
        <h3 style="margin-top:12px">Delay by domino generation</h3><table>${gh || '<tr><td class="empty">No weather impact yet.</td></tr>'}</table></div></div>`;
  }
  function paxHtml() {
    const res = R(),
      now = S.now,
      px = res.pax,
      m = M();
    const ev = px.list.filter(l => l.tEvent <= now);
    const byHub = {};
    ev.forEach(l => {
      if (l.hub) byHub[l.hub] = (byHub[l.hub] || 0) + l.pax;
    });
    const hubs = Object.entries(byHub)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7),
      hm = Math.max(1, ...hubs.map(h => h[1]));
    const rows = ev
      .slice(0, 10)
      .map(
        l => `<tr><td>${esc(l.label)}</td><td class="r">${l.pax}</td><td><span class="pill ${l.kind === 'missed' ? 'orange' : 'bad'}">${l.kind === 'missed' ? 'Missed connection' : 'Flight cancelled'}</span></td>
      <td>${l.stranded > 0 ? `<span class="pill bad">${Math.round(l.stranded)} stranded</span> ` : ''}${l.rebooked > 0 ? `<span class="pill ok">${Math.round(l.rebooked)} rebooked</span>` : ''}</td></tr>`
      )
      .join('');
    const rebook = S.plan.some(a => a.type === 'rebook');
    const tiles = [
      ['Passengers today', px.total, ''],
      ['Missed connections', m.missedPax, 'var(--orange)'],
      ['Rebooked', m.rebooked, 'var(--ok)'],
      ['Stranded overnight', m.stranded, 'var(--bad)'],
      ['Total delay (pax-hours)', Math.round(px.paxMin / 60), '']
    ];
    return `<div class="row" style="gap:10px;margin-bottom:10px">${tiles.map(t => `<div class="kpi" style="flex:1;min-width:110px"><small>${t[0]}</small><b style="color:${t[2]}">${num(t[1])}</b></div>`).join('')}
      <div class="kpi" style="flex:1;min-width:150px"><small>Rebooking policy</small><b style="font-size:13px;color:${rebook ? 'var(--ok)' : 'var(--orange)'}">${rebook ? 'Auto-rebook ON' : 'Counter queues'}</b><div style="margin-top:4px">${rebook ? '' : '<button class="btn sm" data-act="addRebook">Enable now</button>'}</div></div></div>
      <div class="two"><div><h3>Worst-hit itineraries so far</h3>${rows ? `<table><tr><th>Journey</th><th class="r">Pax</th><th>Cause</th><th>Outcome</th></tr>${rows}</table>` : '<div class="empty">No broken connections yet.</div>'}</div>
      <div><h3>Passengers disrupted by airport</h3>${hubs.map(([c, v]) => `<div class="row" style="margin:3px 0"><b style="width:36px">${c}</b><div class="bar" style="flex:1;height:10px"><i style="width:${(v / hm) * 100}%;background:#fb923c"></i></div><span class="mono" style="width:42px;text-align:right">${num(v)}</span></div>`).join('') || '<div class="empty">—</div>'}
      <div class="note">Connections need ${DS.MCT} min. Missed pax are rebooked only if later seats exist; the rest wait overnight (≈14 h).</div></div></div>`;
  }

  Object.assign(U, { attributionAt, updateBottom, renderBottomShell, drawGantt, flightTip });
})();
