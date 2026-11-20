/* Domino Sky — Left panel: scenario, recovery measures and the advisor. */
(function () {
  'use strict';
  const DS = window.DS,
    U = DS.ui;
  const {
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
    O,
    objVal
  } = U;
  // defined by panels loaded after this one: looked up when called
  const importCard = (...args) => U.importCard(...args);

  // =====================================================================
  //  LEFT PANEL
  // =====================================================================
  function renderLeft() {
    $$('#leftTabs button').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === S.ltab);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', b.dataset.tab === S.ltab);
    });
    const el = $('#leftBody');
    const keep = el.scrollTop;
    el.innerHTML = HOOKS.left[S.ltab]
      ? HOOKS.left[S.ltab]()
      : S.ltab === 'scenario'
        ? weatherHtml()
        : S.ltab === 'recovery'
          ? recoveryHtml()
          : advisorHtml();
    el.scrollTop = keep;
  }
  function weatherHtml() {
    const sc = S.net.meta.scenarios.find(s => s.id === S.scenario) || S.net.meta.scenarios[0];
    const types = Object.keys(DS.WXT);
    const ev = S.weather
      .map(e => {
        const m = DS.WXT[e.type];
        return `
      <div class="card evcard ${S.selEv === e.id ? 'sel' : ''}" id="ev${e.id}" data-ev="${e.id}">
        <h5><span>${m.icon} ${esc(e.type)}</span><button class="x-btn" data-act="delEv" data-id="${e.id}" title="Remove">✕</button></h5>
        <div class="note" style="margin:-2px 0 6px">${where(e)}</div>
        <div class="row" style="margin-bottom:5px"><select data-evf="type" data-id="${e.id}">${types.map(t => `<option ${t === e.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="sl"><span>Starts</span><input type="range" min="${S.net.meta.t0}" max="1560" step="5" value="${e.start}" data-evf="start" data-id="${e.id}"><output>${hhmm(e.start)}</output></div>
        <div class="sl"><span>Duration</span><input type="range" min="15" max="480" step="15" value="${e.dur}" data-evf="dur" data-id="${e.id}"><output>${Math.floor(e.dur / 60)}h${String(e.dur % 60).padStart(2, '0')}</output></div>
        <div class="sl"><span>Severity</span><input type="range" min="10" max="100" step="5" value="${Math.round(e.severity * 100)}" data-evf="severity" data-id="${e.id}"><output>${e.severity >= 0.9 ? 'Closed' : Math.round((1 - e.severity) * 100) + '% cap'}</output></div>
        <div class="sl"><span>Radius</span><input type="range" min="20" max="500" step="10" value="${e.radius}" data-evf="radius" data-id="${e.id}"><output>${e.radius} km</output></div>
        <div style="margin-top:6px" class="row" id="hits${e.id}">${hitsHtml(e)}</div>
      </div>`;
      })
      .join('');
    return `
      <h3>Scenario</h3>
      <div class="card"><h5>${esc(sc.name)}</h5><p style="margin:0">${esc(sc.desc)}</p></div>
      ${HOOKS.weatherTop()}
      ${importCard()}
      <h3>Plant a problem — anywhere</h3>
      <div class="plantgrid">${plantBtns()}</div>
      <p class="note">Pick a type, then <b>click anywhere on the map</b>. Drag a marker to move it. Airports inside the circle are throttled or closed; storms and cyclones also force flights crossing them to detour.</p>
      <h3>Active problems (${S.weather.length})</h3>
      ${ev || '<div class="empty">Nothing planted yet. Pick a type above and click the map.</div>'}
      <h3>How a domino falls</h3>
      <div class="card"><p style="margin:0">① A problem closes or throttles airports → ② aircraft wait or divert → ③ the same aircraft's next flights start late (<b>reactionary delay</b>) → ④ connections break and crews time out → ⑤ airports far from the problem go amber and red.</p></div>`;
  }

  function lateFlights(minDelay, fromT) {
    const list = R()
      .flights.filter(f => f.status === 'ok' && f.std >= fromT && f.adep - f.std >= minDelay && !f.swapped)
      .sort((a, b) => b.adep - b.std - (a.adep - a.std))
      .slice(0, 30);
    const sf = S.sel.flight != null ? R().flights[S.sel.flight] : null;
    if (sf && sf.status === 'ok' && sf.std >= fromT && !list.includes(sf)) list.unshift(sf);
    return list;
  }
  function objChips(extraCls) {
    return `<div class="chips ${extraCls || ''}">${Object.entries(DS.OBJ)
      .map(
        ([k, o]) =>
          `<button data-act="obj" data-obj="${k}" class="${S.objective === k ? 'on' : ''}">${o.short}</button>`
      )
      .join('')}</div>`;
  }
  function pv(a) {
    const o = O(),
      r = DS.simulate(S.net, S.weather, S.plan.concat([Object.assign({ id: -1 }, a)]));
    const d = DS.objective(R(), S.objective) - DS.objective(r, S.objective),
      spend = r.costs.recovery - R().costs.recovery;
    const sp =
      spend > 20000
        ? `<span class="tag" title="Resources committed (reference only)">spend ${inr(spend)}</span>`
        : '';
    if (Math.abs(d) < o.eps) return '<span class="tag">≈ no change</span> ' + sp;
    return (
      (d > 0
        ? `<span class="tag good">−${objVal(d)} ${o.unit}</span>`
        : `<span class="tag bad">+${objVal(-d)} ${o.unit} worse</span>`) +
      ' ' +
      sp
    );
  }
  function recoveryHtml() {
    const now = S.now,
      F = S.form,
      wx = wxAp();
    const g = (k, d) => F[k] || d;
    const has = t => S.plan.some(a => a.type === t);
    const freeSp = S.net.tails.filter(
      t => t.spare && !S.plan.some(a => a.type === 'swap' && a.spare === t.id)
    );
    const late = lateFlights(20, now);
    const swapF = late.find(f => String(f.id) === String(F.swapFlight))
      ? +F.swapFlight
      : late[0]
        ? late[0].id
        : null;
    const canF = late.find(f => String(f.id) === String(F.cancelFlight))
      ? +F.cancelFlight
      : late[0]
        ? late[0].id
        : null;
    const spareFor = fid => {
      const f = R().flights[fid];
      return freeSp.slice().sort((a, b) => S.net.dist(a.base, f.orig) - S.net.dist(b.base, f.orig))[0];
    };
    const flOpts = sel =>
      late
        .map(
          f =>
            `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${f.num} ${f.orig}→${f.dest} · ${hhmm(f.std)} · +${Math.round(f.adep - f.std)}m</option>`
        )
        .join('');
    const gAp = g('gdpAp', wx),
      hAp = g('holdAp', 'ALL'),
      hMin = +g('holdMin', 20),
      fAp = g('ftAp', wx),
      sAp = g('surgeAp', wx === 'ALL' ? 'DEL' : wx);
    const sp = swapF != null ? spareFor(swapF) : null;
    const plan = S.plan
      .map(a => {
        const d = describe(a);
        return `<div class="card act"><h5><span>${d.icon} ${esc(d.title)}</span><button class="x-btn" data-act="delAct" data-id="${a.id}" title="Remove">✕</button></h5><p style="margin:0">from ${hhmm(a.from)} · ${esc(d.detail)}</p></div>`;
      })
      .join('');
    const c = R().costs;
    return `
      <div class="card" style="background:#0d2236;border-color:#22506e"><div class="row"><b>Decisions take effect at</b><span class="mono" style="font-size:16px">${hhmm(now)}</span></div>
        <p style="margin:4px 0 0">Pause the clock, choose a measure, and watch the cascade re-compute. Earlier events never change.</p></div>
      <h3>Your plan <span class="tag cost" style="float:right">spend ${inr(c.recovery)}</span></h3>
      ${plan || '<div class="empty">No measures yet.</div>'}
      ${S.plan.length ? '<button class="btn sm danger" data-act="clearPlan">Clear all measures</button>' : ''}
      <h3>Measures</h3>
      <div class="card"><h5>Ground-delay program</h5><p>Hold flights at their origin when the destination is closed or queuing — saves fuel, avoids holding and diversions.</p>
        <div class="row"><select data-f="gdpAp">${apOptions(gAp, true)}</select><button class="btn sm" data-act="addGdp">Apply</button></div><div style="margin-top:6px">${pv({ type: 'gdp', airport: gAp, from: now })}</div></div>
      <div class="card"><h5>Hold connections</h5><p>Delay a departure for airborne feeders with 10+ connecting passengers. Trades flight delay for missed connections.</p>
        <div class="row"><select data-f="holdAp">${apOptions(hAp, true)}</select><select data-f="holdMin" style="flex:0 0 78px">${[15, 20, 30, 45].map(m => `<option ${m === hMin ? 'selected' : ''} value="${m}">${m} min</option>`).join('')}</select><button class="btn sm" data-act="addHold">Apply</button></div><div style="margin-top:6px">${pv({ type: 'hold', airport: hAp, mins: hMin, from: now })}</div></div>
      <div class="card"><h5>Fast turnarounds</h5><p>Extra ground crews cut minimum turn time by 10 min, soaking up delay at that airport. ₹25k per turn used.</p>
        <div class="row"><select data-f="ftAp">${apOptions(fAp, true)}</select><button class="btn sm" data-act="addFt">Apply</button></div><div style="margin-top:6px">${pv({ type: 'fastturn', airport: fAp, from: now, cut: 10 })}</div></div>
      <div class="card"><h5>Surge operations</h5><p>+25% runway throughput after weather (extra ATC, stands, towing). ₹15 L per airport.</p>
        <div class="row"><select data-f="surgeAp">${apOptions(sAp)}</select><button class="btn sm" data-act="addSurge">Apply</button></div><div style="margin-top:6px">${pv({ type: 'surge', airport: sAp, from: now, pct: 25 })}</div></div>
      <div class="card"><h5>Swap in a spare aircraft ${sp ? `<span class="tag">${freeSp.length} spare${freeSp.length > 1 ? 's' : ''}</span>` : '<span class="tag bad">none left</span>'}</h5><p>A fresh aircraft and crew take over a late flight <b>and the rest of its rotation</b>. Spare repositioning costs extra.</p>
        ${
          late.length && sp
            ? `<div class="row"><select data-f="swapFlight">${flOpts(swapF)}</select><button class="btn sm" data-act="addSwap">Swap</button></div>
        <div class="note">Uses ${sp.id} from ${sp.base}${sp.base !== R().flights[swapF].orig ? ' (repositions)' : ''}</div><div style="margin-top:6px">${pv({ type: 'swap', flight: swapF, spare: sp.id, from: now })}</div>`
            : '<div class="empty">No late upcoming flights / spares.</div>'
        }</div>
      <div class="card"><h5>Cancel a rotation</h5><p>Cancel a doomed flight early and every flight until the aircraft is back where it started. Passengers are re-protected before they reach the airport.</p>
        ${late.length ? `<div class="row"><select data-f="cancelFlight">${flOpts(canF)}</select><button class="btn sm danger" data-act="addCancel">Cancel</button></div><div style="margin-top:6px">${pv({ type: 'cancel', flight: canF, from: now })}</div>` : '<div class="empty">No late upcoming flights.</div>'}</div>
      ${
        S.net.hardCrewLimit
          ? '<div class="card"><h5>Crew duty limits</h5><p style="margin:0">The dataset’s maximum duty (' +
            Math.round(S.net.crewDuty / 60) +
            ' h) is a legal limit, so it cannot be extended. A crew about to time out is relieved by swapping in a spare aircraft with a fresh standby crew.</p></div>'
          : `<div class="card"><h5>Extend crew duty</h5><p>+2 h flight-duty limit. Prevents the evening flights of long-delayed crews from being cancelled. ₹90k per flight that needs it.</p>
        <div class="row"><button class="btn sm" data-act="addCrew" ${has('crew') ? 'disabled' : ''}>${has('crew') ? 'Active' : 'Apply'}</button>${has('crew') ? '' : pv({ type: 'crew', from: now, extra: 120 })}</div></div>`
      }
      <div class="card"><h5>Auto-rebook & passenger care</h5><p>Re-accommodate passengers on the next seats instead of leaving them in the queue. ₹2,500 per passenger.</p>
        <div class="row"><button class="btn sm" data-act="addRebook" ${has('rebook') ? 'disabled' : ''}>${has('rebook') ? 'Active' : 'Apply'}</button>${has('rebook') ? '' : pv({ type: 'rebook', from: now })}</div></div>`;
  }

  function advisorHtml() {
    const A = S.advice,
      o = O();
    const head = `<div class="card" style="background:#0d2236;border-color:#22506e"><h5>Recovery advisor</h5><p style="margin:0">Re-simulates every measure against the live plan at <b class="mono">${hhmm(S.now)}</b> and ranks them by how much <b>real delay and disruption</b> they remove — not by money.</p></div>
      <h3>Optimise for</h3>${objChips()}
      <div class="note" style="margin:4px 0 10px">${S.objective === 'pax' ? 'Total hours passengers lose, including people left overnight.' : S.objective === 'flights' ? 'Aircraft-hours of arrival delay; a cancelled flight counts as 6 h.' : 'Number of people who cannot be re-accommodated today.'}</div>
      <div class="row" style="margin-bottom:10px"><button class="btn primary" data-act="analyse">Analyse at ${hhmm(S.now)}</button><button class="btn" data-act="autoopt" title="Greedily applies the best measure up to 6 times">Auto-optimise</button></div>`;
    if (!A || A.mode !== S.objective)
      return head + '<div class="empty">Run the analysis to get ranked recommendations.</div>';
    const stale = A.stale
      ? '<div class="note" style="color:#fbbf24">Plan changed since this analysis — re-run for fresh numbers.</div>'
      : '';
    const items = A.items
      .slice(0, 9)
      .map(
        (it, i) => `<div class="card">
      <h5><span>#${i + 1} ${esc(it.label)}</span></h5>
      <div class="row"><span class="tag good">−${objVal(it.gain)} ${o.unit}</span>
        ${S.objective !== 'pax' && it.paxMin > 600 ? `<span class="tag">−${num(it.paxMin / 60)} pax-h</span>` : ''}${S.objective !== 'flights' && it.delayMin > 10 ? `<span class="tag">−${num(it.delayMin / 60)} aircraft-h</span>` : ''}${it.cancels > 0 ? `<span class="tag">−${it.cancels} cancels</span>` : it.cancels < 0 ? `<span class="tag bad">+${-it.cancels} cancels</span>` : ''}${S.objective !== 'stranded' && it.stranded > 5 ? `<span class="tag">−${num(it.stranded)} stranded</span>` : ''}${it.spend > 20000 ? `<span class="tag" title="Resources committed (reference only)">spend ${inr(it.spend)}</span>` : ''}
        <span class="grow"></span><button class="btn sm" data-act="applyAdvice" data-i="${i}">Apply</button></div></div>`
      )
      .join('');
    return (
      head +
      `<div class="note" style="margin:0 0 8px">Analysed at ${hhmm(A.at)} · current plan: ${objVal(A.baseObj)} ${o.unit}</div>` +
      stale +
      (items || '<div class="empty">Nothing improves this objective further — nice work.</div>')
    );
  }

  Object.assign(U, { objChips, renderLeft, lateFlights });
})();
