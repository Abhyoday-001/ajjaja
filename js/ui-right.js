/* Domino Sky — Right panel: scorecard, key figures, delay chart and standings. */
(function () {
  'use strict';
  const DS = window.DS,
    U = DS.ui;
  const { $, S, R, num, setHtml, objVal, inr, M, MB, TC, esc, dcol } = U;
  // defined by panels loaded after this one: looked up when called
  const objChips = (...args) => U.objChips(...args);
  const attributionAt = (...args) => U.attributionAt(...args);

  // =====================================================================
  //  RIGHT PANEL
  // =====================================================================
  function initRight() {
    $('#rightBody').innerHTML = `
      <div id="scoreBox"></div>
      <div id="kpiBox" class="kpis"></div>
      <h3>Delay build-up through the day</h3>
      <div class="sw" id="chartSw"><button data-m="pax" class="on">Passenger-hours</button><button data-m="delay">Aircraft-min</button><button data-m="cancelled">Cancellations</button></div>
      <canvas class="chart" id="chart" role="img" aria-label="Chart of delay building up through the day, with and without the chosen measures. The same figures are in the scorecard and tables."></canvas>
      <h3>Standings</h3>
      <div class="sw" id="standSw"><button data-s="airports" class="on">Airports</button><button data-s="carriers">Carriers</button></div>
      <div class="row" style="margin-bottom:6px" id="standSortRow"><span class="tag">Sort</span><div class="chips" id="standSort"><button data-o="worst" class="on">Most affected</button><button data-o="best">Best first</button></div></div>
      <div id="standBox"></div>`;
  }
  function scoreData() {
    const mode = S.objective,
      o = DS.OBJ[mode],
      B = S.res.base,
      P = R(),
      C = S.res.clear;
    const ob = DS.objective(B, mode),
      op = DS.objective(P, mode),
      oc = DS.objective(C, mode);
    const dmg = ob - oc,
      saved = ob - op,
      pct = dmg > 1e-6 ? Math.max(-100, Math.min(100, (saved / dmg) * 100)) : 0;
    let grade = 'none';
    if (S.plan.length && S.weather.length)
      grade = pct >= 60 ? 'S' : pct >= 40 ? 'A' : pct >= 25 ? 'B' : pct >= 10 ? 'C' : 'D';
    return {
      mode,
      o,
      ob,
      op,
      oc,
      dmg,
      saved,
      pct,
      grade,
      paxH: (B.pax.paxMin - P.pax.paxMin) / 60,
      acH: (B.costs.counts.delayMin - P.costs.counts.delayMin) / 60,
      canc: B.costs.counts.cancels - P.costs.counts.cancels,
      strand: B.pax.stranded - P.pax.stranded,
      costs: P.costs
    };
  }
  function updateScore() {
    const d = scoreData(),
      o = d.o;
    const sgn = (v, unit, dec) =>
      `<span style="color:${v > 0.5 ? 'var(--ok)' : v < -0.5 ? 'var(--bad)' : 'var(--muted)'}">${v > 0.5 ? '−' : v < -0.5 ? '+' : '±'}${num(Math.abs(v))}${unit}</span>`;
    const txt =
      d.grade === 'none'
        ? S.weather.length
          ? 'Pick measures to cut the damage'
          : 'Plant a problem to start'
        : `${Math.round(d.pct)}% of the weather damage recovered`;
    setHtml(
      $('#scoreBox'),
      `<div class="score"><div class="grade ${d.grade}">${d.grade === 'none' ? '–' : d.grade}</div><div>
      <small>${o.label} · full day</small><div class="big">${objVal(d.op)} <span style="font-size:12px;color:var(--muted)">${o.unit}</span></div>
      <small>Do nothing: <b>${objVal(d.ob)}</b> · Clear day: ${objVal(d.oc)}</small>
      <small style="color:${d.saved >= 0 ? 'var(--ok)' : 'var(--bad)'};margin-top:2px">${txt}</small></div></div>
      <div class="row" style="margin:8px 0 2px"><span class="tag">Optimise for</span>${objChips()}</div>
      <div class="subscore"><div>Passengers ${sgn(d.paxH, ' h')}</div><div>Aircraft ${sgn(d.acH, ' h')}</div><div>Cancels ${sgn(d.canc, '')}</div><div>Stranded ${sgn(d.strand, '')}</div></div>
      <div class="note" style="margin:2px 0 0">vs. doing nothing. Resources committed: ${S.plan.length ? `${S.plan.length} measure${S.plan.length > 1 ? 's' : ''} · ${inr(d.costs.recovery)}` : 'none'}</div>`
    );
    setHtml(
      $('#hdrScore'),
      `<div class="grade ${d.grade}" style="width:38px;height:38px;font-size:20px;border-radius:9px">${d.grade === 'none' ? '–' : d.grade}</div><div style="line-height:1.15"><small style="color:var(--muted)">${o.short} vs no action</small><div class="mono" style="font-weight:700">${d.grade === 'none' ? '—' : (d.saved >= 0 ? '−' : '+') + objVal(Math.abs(d.saved)) + ' ' + (S.objective === 'pax' ? 'pax-h' : S.objective === 'flights' ? 'ac-h' : 'ppl')}</div></div>`
    );
  }
  function updateKpis() {
    const m = M(),
      b = MB(),
      has = S.plan.length > 0;
    const at = attributionAt(R(), S.now),
      wx = at.weather + at.airborne,
      kn = at.reactionary,
      share = wx + kn > 0 ? kn / (wx + kn) : 0;
    const k = (label, v, base, fmt, lowerBetter) => {
      let em;
      if (base == null) em = '<em>&nbsp;</em>';
      else if (has) {
        const d = v - base;
        if (Math.abs(d) >= 0.5 || fmt === 'pct') {
          const better = lowerBetter ? d < 0 : d > 0;
          em = `<em class="${better ? 'good' : d === 0 ? '' : 'bad'}">${d > 0 ? '+' : '−'}${fmt === 'pct' ? Math.abs(d * 100).toFixed(1) + ' pts' : num(Math.abs(d))} vs none</em>`;
        } else em = '<em>= no action</em>';
      } else em = '<em>&nbsp;</em>';
      return `<div class="kpi"><small>${label}</small><b>${fmt === 'pct' ? (v * 100).toFixed(1) + '%' : num(v)}</b>${em}</div>`;
    };
    setHtml(
      $('#kpiBox'),
      k('On-time', m.otp, b.otp, 'pct', false) +
        k('Pax delay h', m.paxDelayMin / 60, b.paxDelayMin / 60, 'n', true) +
        k('Aircraft h', m.delayMin / 60, b.delayMin / 60, 'n', true) +
        k('Cancelled', m.cancelled, b.cancelled, 'n', true) +
        k('Diverted', m.diverted, b.diverted, 'n', true) +
        k('Stranded', m.stranded, b.stranded, 'n', true) +
        k('Missed conn.', m.missedPax, b.missedPax, 'n', true) +
        k('Flights late', m.delayed, b.delayed, 'n', true) +
        `<div class="kpi" title="Share of weather-driven delay that is late-aircraft knock-on, not the storm itself"><small>Knock-on</small><b>${Math.round(share * 100)}%</b><em>${share > 0.5 ? 'cascade-driven' : 'storm-driven'}</em></div>`
    );
  }
  function drawChart() {
    const cv = $('#chart');
    if (!cv || !S.ser.base) return;
    const dpr = devicePixelRatio || 1,
      W = cv.clientWidth,
      H = cv.clientHeight;
    if (!W) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const key = S.chartMetric,
      L = 34,
      Rr = 8,
      Tp = 10,
      B = 20;
    const series = { clear: S.ser.clear[key], base: S.ser.base[key], plan: S.ser.plan[key] };
    let ymax = Math.max(1, ...series.base, ...series.plan, ...series.clear) * 1.08;
    const x = t => L + ((t - S.net.meta.t0) / (S.net.meta.t1 - S.net.meta.t0)) * (W - L - Rr),
      y = v => H - B - (v / ymax) * (H - B - Tp);
    const tc = TC();
    ctx.font = '10px ui-monospace,monospace';
    ctx.fillStyle = tc.axis;
    ctx.strokeStyle = tc.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = (ymax * i) / 4,
        yy = y(v);
      ctx.beginPath();
      ctx.moveTo(L, yy);
      ctx.lineTo(W - Rr, yy);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v), L - 4, yy + 3);
    }
    ctx.textAlign = 'center';
    for (let h = Math.ceil(S.net.meta.t0 / 240) * 4; h <= 30; h += 4) {
      ctx.fillText(String(h % 24).padStart(2, '0'), x(h * 60), H - 6);
    }
    S.weather.forEach(e => {
      ctx.fillStyle = tc.band;
      ctx.fillRect(x(e.start), Tp, x(Math.min(S.net.meta.t1, e.start + e.dur)) - x(e.start), H - B - Tp);
    });
    const line = (arr, col, w, dash) => {
      ctx.beginPath();
      ctx.setLineDash(dash || []);
      S.ser.base.t.forEach((t, i) => {
        i ? ctx.lineTo(x(t), y(arr[i])) : ctx.moveTo(x(t), y(arr[i]));
      });
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(series.clear, tc.clear, 1.5, [4, 4]);
    line(series.base, '#f87171', 2);
    if (S.plan.length) {
      ctx.save();
      ctx.lineJoin = 'round';
      line(series.plan, '#d9b46a', 2.4);
      ctx.restore();
    }
    const nx = x(S.now);
    ctx.strokeStyle = tc.nowLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nx, Tp);
    ctx.lineTo(nx, H - B);
    ctx.stroke();
    const i = Math.max(0, Math.min(S.ser.base.t.length - 1, Math.round((S.now - S.net.meta.t0) / 10)));
    [
      ['base', '#f87171'],
      ['plan', '#d9b46a']
    ].forEach(([k2, c]) => {
      if (k2 === 'plan' && !S.plan.length) return;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(nx, y(series[k2][i]), 3.5, 0, 7);
      ctx.fill();
    });
    ctx.textAlign = 'left';
    ctx.font = '10.5px system-ui';
    let lx = L + 6;
    [
      ['Clear day', tc.clear],
      ['No action', '#f87171'],
      ['Your plan', '#d9b46a']
    ].forEach(([t, c]) => {
      if (t === 'Your plan' && !S.plan.length) return;
      ctx.fillStyle = c;
      ctx.fillRect(lx, Tp + 3, 10, 3);
      ctx.fillStyle = tc.legend;
      ctx.fillText(t, lx + 14, Tp + 8);
      lx += ctx.measureText(t).width + 28;
    });
  }
  function updateStandings() {
    const now = S.now,
      isAir = S.rstab === 'airports';
    $('#standSortRow').classList.toggle('hidden', !isAir);
    let html;
    if (isAir) {
      const rows = DS.airportStandings(S.net, R(), now).filter(r => r.dep > 0);
      rows.sort((a, b) =>
        S.standSort === 'worst' ? b.avg - a.avg || a.otp - b.otp : a.avg - b.avg || b.otp - a.otp
      );
      html =
        `<table><tr><th>#</th><th>Airport</th><th>On-time</th><th class="r">Avg</th><th class="r">Canc</th><th class="r">Queue</th></tr>` +
        rows
          .map(
            (
              r,
              i
            ) => `<tr class="click ${S.sel.airport === r.code ? 'sel' : ''}" data-act="selAp" data-code="${r.code}">
        <td class="r">${i + 1}</td><td><b>${r.code}</b> <span style="color:var(--muted)">${esc(r.city.slice(0, 9))}</span></td>
        <td><div class="bar"><i style="width:${r.otp * 100}%;background:${r.otp > 0.85 ? '#34d399' : r.otp > 0.65 ? '#fbbf24' : '#f87171'}"></i></div></td>
        <td class="r" style="color:${dcol(r.avg)}">${Math.round(r.avg)}m</td><td class="r">${r.cancelled || ''}</td><td class="r" style="color:${r.queue ? '#f87171' : ''}">${r.queue || ''}</td></tr>`
          )
          .join('') +
        '</table>';
    } else {
      const rows = DS.carrierStandings(S.net, R(), now).sort((a, b) => b.otp - a.otp);
      html =
        `<table><tr><th>#</th><th>Carrier</th><th>On-time</th><th class="r">Avg</th><th class="r">Canc</th></tr>` +
        rows
          .map(
            (
              r,
              i
            ) => `<tr><td class="r">${i + 1}</td><td><span style="color:${r.color}">●</span> <b>${r.code}</b> ${esc(r.name)}</td>
        <td><div class="bar"><i style="width:${r.otp * 100}%;background:${r.color}"></i></div><div class="mono" style="font-size:10.5px;color:var(--muted)">${(r.otp * 100).toFixed(0)}%</div></td><td class="r" style="color:${dcol(r.avg)}">${Math.round(r.avg)}m</td><td class="r">${r.cancelled || ''}</td></tr>`
          )
          .join('') +
        '</table>';
    }
    setHtml($('#standBox'), html);
  }

  Object.assign(U, { updateKpis, updateScore, drawChart, updateStandings, initRight, scoreData });
})();
