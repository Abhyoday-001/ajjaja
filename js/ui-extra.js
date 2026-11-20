/* Domino Sky — UI extensions: AI dispatcher chat, crews view, "Close an airport", guided demo.
   Plugs into ui.js through window.DominoSky.HOOKS; all numbers shown here come from DS.* (the engine). */
(function () {
  'use strict';
  function boot() {
    const U = window.DominoSky, api = U.api, S = U.S, H = U.HOOKS, DS = window.DS, D = DS.Dispatcher;
    const { $, $$, esc, hhmm, num, toast, R } = api;
    const net = () => api.net;
    S.chat = []; S.claude = { key: '', model: 'claude-opus-5-5', consent: false, busy: false };
    H.onReset.push(() => { S.chat = []; });
    const ctx = () => ({ net: net(), weather: S.weather, plan: S.plan, now: S.now, objective: S.objective, base: S.res.base, res: R() });

    // ------------------------------------------------------------------ AI dispatcher
    const f1 = (v, dec) => v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    function beforeAfter(before, after) {
      const rows = D.METRICS.map(([k, label, , dec]) => {
        const b = before[k], a = after[k], d = a - b, up = k === 'onTimePct' ? d > 0.05 : d < -0.05, dn = k === 'onTimePct' ? d < -0.05 : d > 0.05;
        return '<tr><td>' + label + '</td><td class="r">' + f1(b, dec) + '</td><td class="r">' + f1(a, dec) + '</td><td class="r ' + (up ? 'up' : dn ? 'dn' : '') + '">' + (Math.abs(d) < 0.05 ? '—' : (d > 0 ? '+' : '−') + f1(Math.abs(d), dec)) + '</td></tr>';
      }).join('');
      return '<table class="ba"><tr><th>Whole day</th><th class="r">Before</th><th class="r">After</th><th class="r">Change</th></tr>' + rows + '</table>';
    }
    function markBad(text, bad) {
      let h = esc(text);
      [...new Set(bad)].forEach(b => { const re = new RegExp('(^|[^\\w.])(' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![\\w])', 'g'); h = h.replace(re, (m, p, x) => p + '<mark class="unv" title="This figure does not appear in any simulator result">' + x + '</mark>'); });
      return h.replace(/\n/g, '<br>');
    }
    function msgHtml(m, i) {
      if (m.role === 'user') return '<div class="msg me">' + esc(m.text) + '</div>';
      const v = m.verification;
      const badge = m.pending ? '<span class="audit wait">working…</span>' : v ? (v.ok
        ? '<span class="audit ok" title="Every number and clock time in this message was re-read and checked against the simulator\'s own output.">✓ ' + v.checked + ' numbers checked — all match the simulator</span>'
        : '<span class="audit bad" title="These figures were not produced by the simulator">⚠ ' + v.bad.length + ' figure' + (v.bad.length > 1 ? 's' : '') + ' not verified: ' + esc(v.bad.slice(0, 6).join(', ')) + '</span>') : '';
      const src = m.source === 'claude' ? 'Claude · ' + esc(m.model || '') : 'Built-in dispatcher (deterministic)';
      const body = m.source === 'claude' && m.text ? '<p>' + markBad(m.text, v ? v.bad : []) + '</p>' : (m.html || '');
      let extra = '';
      if (m.top) extra += beforeAfter(m.top.before, m.top.after) + '<div class="btnrow"><button class="btn primary sm" data-act="chatApply" data-i="' + i + '" data-k="top" ' + (m.done ? 'disabled' : '') + '>' + (m.done ? '✓ Applied' : 'Apply this action') + '</button></div>';
      if (m.candidates && m.candidates.length) extra += '<div class="cands">' + m.candidates.map((c, k) => '<div class="cand"><b>' + c.id + '</b> ' + esc(c.title) + '<span class="r">−' + num(c.before.paxHours - c.after.paxHours) + ' pax-h</span><button class="btn sm" data-act="chatApply" data-i="' + i + '" data-k="' + k + '" ' + (m.done ? 'disabled' : '') + '>Apply</button></div>').join('') + '</div>';
      if (m.before && m.after) extra += beforeAfter(m.before, m.after);
      return '<div class="msg ai' + (m.error ? ' err' : '') + '"><div class="mh"><b>' + esc(m.title || '') + '</b><span class="src">' + src + '</span></div>' + body + extra + '<div class="mf">' + badge + '</div></div>';
    }
    H.left.dispatcher = function () {
      const sel = S.sel.flight != null ? R().flights[S.sel.flight] : null, C = S.claude;
      const quick = [['@brief', 'Brief me'], ['@recommend', 'What should I do?'], ['@passengers', 'Passengers'], ['@crews', 'Crews']].map(([q, l]) => '<button class="chip-btn" data-act="ask" data-q="' + q + '" data-label="' + esc(l.replace(/^\S+\s/, '')) + '">' + l + '</button>').join('')
        + (sel ? '<button class="chip-btn" data-act="ask" data-q="@why" data-label="Why is ' + esc(sel.num) + (sel.status === 'cancelled' ? ' cancelled?' : ' late?') + '">Why is ' + esc(sel.num) + '?</button>' : '');
      const msgs = S.chat.length ? S.chat.map(msgHtml).join('') : '<div class="empty">Ask the dispatcher for a briefing or a recommendation. It explains and recommends — it never calculates. Every number comes from the simulator and is re-checked before you see it.</div>';
      return '<div class="card hero"><h5>AI Dispatcher</h5><p style="margin:0">Explains what is happening and recommends recovery actions. The simulator does all the maths; the dispatcher only quotes it — and an independent audit re-checks every figure.</p></div>'
        + '<div class="chips wrapchips" style="margin:8px 0">' + quick + '</div>'
        + '<div id="chatLog" class="chatlog">' + msgs + '</div>'
        + '<div class="askrow"><input id="dispQ" type="text" autocomplete="off" placeholder="Ask: why is KE273 late? how many are stranded?" value="' + esc(S.form.dispQ || '') + '" aria-label="Ask the dispatcher"><button class="btn primary sm" data-act="askText">Ask</button></div>'
        + (S.chat.length ? '<button class="btn sm" data-act="chatClear" style="margin-top:6px">Clear conversation</button>' : '')
        + '<details class="claude"' + (C.key || C.consent ? ' open' : '') + '><summary>Use Claude instead (optional)</summary>'
        + '<p class="note">Claude gets read-only tools backed by the simulator and must quote their numbers. Anything it states that the tools did not return is highlighted. <b>Privacy:</b> when you press “Ask Claude”, a summary of the situation (airports, flight numbers, delays, passenger counts) is sent to Anthropic’s API using your key. Your key stays in this tab’s memory only.</p>'
        + '<div class="row"><input id="claudeKey" type="password" autocomplete="off" placeholder="Anthropic API key (sk-ant-…)" value="' + esc(C.key) + '" aria-label="Anthropic API key" style="flex:1;min-width:0"></div>'
        + '<div class="row" style="margin-top:6px"><select id="claudeModel" aria-label="Claude model"><option value="claude-opus-5-5"' + (C.model === 'claude-opus-5-5' ? ' selected' : '') + '>Claude Opus 5.5 (default)</option><option value="claude-sonnet-5-5"' + (C.model === 'claude-sonnet-5-5' ? ' selected' : '') + '>Claude Sonnet 5.5</option><option value="claude-haiku-5-5"' + (C.model === 'claude-haiku-5-5' ? ' selected' : '') + '>Claude Haiku 5.5 (fastest)</option></select></div>'
        + '<label class="consent"><input id="claudeConsent" type="checkbox"' + (C.consent ? ' checked' : '') + '> I understand the situation summary is sent to Anthropic when I press Ask Claude.</label>'
        + '<button class="btn sm" data-act="claudeAsk" ' + (C.busy ? 'disabled' : '') + '>' + (C.busy ? 'Claude is working…' : 'Ask Claude') + '</button></details>';
    };
    function refreshChat() {
      if (S.ltab !== 'dispatcher') return;
      const b = $('#leftBody'), keep = b.scrollTop; api.renderLeft(); const log = $('#chatLog'); if (log) { b.scrollTop = b.scrollHeight; } else b.scrollTop = keep;
    }
    function ask(q, label) {
      const c = ctx();
      S.chat.push({ role: 'user', text: label || q });
      let out;
      if (q === '@brief') out = D.brief(c); else if (q === '@recommend') out = D.recommend(c); else if (q === '@passengers') out = D.passengers(c); else if (q === '@crews') out = D.crews(c);
      else if (q === '@why') out = S.sel.flight != null ? D.whyFlight(c, S.sel.flight) : D.brief(c);
      else out = D.answer(c, q, S.sel.flight);
      out.role = 'ai'; S.chat.push(out); refreshChat();
    }
    function chatApply(i, k) {
      const m = S.chat[i]; if (!m || m.done) return;
      const pick = k === 'top' ? m.top : m.candidates[+k], a = pick.action;
      if (a.type === 'swap' && S.plan.some(p => p.type === 'swap' && p.spare === a.spare)) { toast('That spare aircraft is already assigned — ask again for a fresh recommendation.'); return; }
      const before = D.snapshot(net(), R());
      api.addAction(Object.assign({}, a, { from: S.now }), true);
      const out = D.applied(ctx(), before, pick.title, a); out.role = 'ai'; m.done = true; S.chat.push(out); S.ltab = 'dispatcher'; refreshChat();
    }
    async function claudeAsk() {
      const C = S.claude; if (C.busy) return;
      if (!C.consent) { toast('Please tick the consent box first.'); return; }
      if (!C.key.trim()) { toast('Enter your Anthropic API key first.'); return; }
      const q = (S.form.dispQ || '').trim() || 'Brief me on the situation and recommend the best recovery action.';
      const pend = { role: 'ai', pending: true, source: 'claude', model: C.model, title: 'Claude is working…', html: '<p>Calling the simulator’s tools…</p>' };
      S.chat.push({ role: 'user', text: q }, pend); C.busy = true; S.form.dispQ = ''; refreshChat();
      try { const out = await D.askClaude(ctx(), q, { apiKey: C.key.trim(), model: C.model }); Object.assign(pend, out, { role: 'ai', pending: false, html: null }); }
      catch (e) { Object.assign(pend, { pending: false, error: true, title: 'Claude request failed', html: '<p>' + esc(e.message || String(e)) + '</p><p class="note">Check the key, the model name and your connection. The built-in dispatcher still works offline.</p>' }); }
      C.busy = false; refreshChat();
    }
    Object.assign(H.actions, {
      ask: el => ask(el.dataset.q, el.dataset.label), askText: () => { const q = (S.form.dispQ || '').trim(); if (!q) return; S.form.dispQ = ''; ask(q, q); },
      chatApply: el => chatApply(+el.dataset.i, el.dataset.k), claudeAsk, chatClear: () => { S.chat = []; refreshChat(); },
      selTail: el => { S.sel.tail = el.dataset.tail; S.sel.flight = null; api.renderLiveSoon(); }
    });
    document.addEventListener('input', e => {
      const t = e.target;
      if (t.id === 'dispQ') S.form.dispQ = t.value; else if (t.id === 'claudeKey') S.claude.key = t.value;
      else if (t.dataset && t.dataset.f === 'closeStart') { const o = t.parentElement.querySelector('output'); if (o) o.textContent = hhmm(+t.value); }
    });
    document.addEventListener('change', e => { const t = e.target; if (t.id === 'claudeModel') S.claude.model = t.value; else if (t.id === 'claudeConsent') S.claude.consent = t.checked; });
    document.addEventListener('keydown', e => { if (e.target.id === 'dispQ' && e.key === 'Enter') { e.preventDefault(); H.actions.askText(); } });

    // ------------------------------------------------------------------ crews
    H.bottom.crews = function () {
      const n = net(), rows = D.crewRows(n, R(), S.plan), flagged = rows.filter(r => r.status !== 'ok').length;
      const pill = s => ({ ok: 'ok', tight: 'warn', 'at risk': 'orange', 'timed out': 'bad' }[s]);
      return '<div class="note" style="margin:0 0 8px;color:var(--text)"><b>' + rows.length + '</b> crews · <b>' + flagged + '</b> within an hour and a half of their legal duty limit or past it. ' + (n.hardCrewLimit ? 'Each crew’s duty window comes from the dataset and its maximum is a legal limit: a crew that would exceed it cannot fly the leg and the rest of its day is cancelled. A spare aircraft with a fresh standby crew can relieve it.' : 'A crew’s duty runs from its start until its last arrival and may not exceed its maximum (a crew-duty extension adds hours). A crew that would run past the limit cannot fly the leg, and the rest of its day is cancelled.') + '</div>'
        + '<table><tr><th>Crew</th><th>Aircraft</th><th class="r">Duty starts</th><th class="r">Legal limit</th><th class="r">Projected finish</th><th class="r">Margin</th><th>Status</th><th class="r">Flights lost</th></tr>'
        + rows.map(r => '<tr class="click ' + (S.sel.tail === r.aircraft ? 'sel' : '') + '" data-act="selTail" data-tail="' + esc(r.aircraft) + '"><td><b>' + esc(r.crew) + '</b></td><td>' + esc(r.aircraft) + '</td><td class="r">' + hhmm(r.dutyStart) + '</td><td class="r">' + hhmm(r.legalEnd) + '</td><td class="r">' + hhmm(r.projectedFinish) + '</td><td class="r" style="color:' + (r.marginMin < 30 ? 'var(--bad)' : r.marginMin < 90 ? 'var(--warn)' : 'var(--muted)') + '">' + (r.marginMin < 0 ? '−' : '') + Math.abs(Math.round(r.marginMin)) + ' min</td><td><span class="pill ' + pill(r.status) + '">' + r.status + '</span></td><td class="r">' + (r.timedOutFlights || '') + '</td></tr>').join('') + '</table>';
    };
    H.flightExtra = f => { const r = D.crewRows(net(), R(), S.plan).find(x => x.aircraft === f.tail); return r ? '<dt>Crew</dt><dd>' + esc(r.crew) + ' · ' + (r.marginMin < 0 ? 'timed out' : Math.round(r.marginMin) + ' min margin') + '</dd>' : ''; };

    // ------------------------------------------------------------------ close an airport
    function closeCard() {
      const F = S.form, n = net(), def = api.wxAp() !== 'ALL' ? api.wxAp() : (n.airports.find(a => a.code === 'BOM') ? 'BOM' : n.airports[0].code);
      const ap = F.closeAp || def, start = +F.closeStart || Math.max(api.T0, Math.round((S.now + 30) / 5) * 5), dur = +F.closeDur || 90;
      return '<div class="card hero"><h5>Close an airport</h5><p>Choose which airport closes, when, and for how long — then watch the delay spread.</p>'
        + '<div class="row"><select data-f="closeAp" aria-label="Airport to close">' + api.apOptions(ap) + '</select></div>'
        + '<div class="sl"><span>Closes at</span><input type="range" min="' + api.T0 + '" max="1560" step="5" value="' + start + '" data-f="closeStart" aria-label="Closing time"><output>' + hhmm(start) + '</output></div>'
        + '<div class="row" style="margin-top:4px"><label for="closeDur">Closed for</label><select id="closeDur" data-f="closeDur">' + [30, 60, 90, 120, 180, 240, 360].map(m => '<option value="' + m + '"' + (m === dur ? ' selected' : '') + '>' + (m < 60 ? m + ' min' : (m / 60) + ' h') + '</option>').join('') + '</select>'
        + '<button class="btn primary sm" data-act="closeAirport">Close airport</button></div></div>';
    }
    H.weatherTop = closeCard;
    function closeAirport(code, start, dur) {
      const a = net().airportMap[code], m = DS.WXT['Airport closure'];
      const ev = { id: S.nextId++, type: 'Airport closure', lat: a.lat, lon: a.lon, radius: m.radius, start, dur, severity: 1 };
      S.weather.push(ev); S.selEv = ev.id; api.recompute(); api.renderAll();
      toast('' + code + ' closes ' + hhmm(start) + '–' + hhmm(start + dur));
    }
    H.actions.closeAirport = () => { const F = S.form, d = api.wxAp(); closeAirport(F.closeAp || (d !== 'ALL' ? d : (net().airportMap.BOM ? 'BOM' : net().airports[0].code)), +F.closeStart || Math.max(api.T0, Math.round((S.now + 30) / 5) * 5), +F.closeDur || 90); };
    H.actions.apClose = el => closeAirport(el.dataset.code, Math.max(api.T0, Math.round((S.now + 15) / 5) * 5), 90);
    H.airportButtons = code => '<button class="btn sm danger" data-act="apClose" data-code="' + code + '">Close</button>';

    // ------------------------------------------------------------------ guided demo
    let demo = null;
    function stopDemo() { if (demo) demo.cancel = true; }
    async function runDemo() {
      if (demo) { stopDemo(); return; }
      api.closeTour(); api.closeDialog('#helpDlg');
      const my = demo = { cancel: false, speed: S.speed };
      const wait = ms => new Promise(res => { const t0 = performance.now(); (function tick() { if (my.cancel || performance.now() - t0 >= ms) res(); else setTimeout(tick, 60); })(); });
      const until = (cond, max) => new Promise(res => { const t0 = performance.now(); (function tick() { if (my.cancel || cond() || performance.now() - t0 > max) res(); else setTimeout(tick, 80); })(); });
      const cap = (n, html) => { const el = $('#demoCap'); el.classList.remove('hidden'); document.body.classList.add('has-demo'); el.innerHTML = '<span class="step">Step ' + n + ' of 6</span><span>' + html + '</span><button class="btn sm" data-act="stopDemo">■ Stop</button>'; };
      try {
        if (net().meta.id !== 'dataset') api.setNetwork('dataset');
        api.loadScenario('d-bom'); $('#scenarioSel').value = 'd-bom'; S.btab = 'gantt'; S.ltab = 'scenario'; api.renderAll();
        const st = S.weather[0].start, n = net(), crewsN = new Set(n.tails.filter(t => !t.spare).map(t => t.crew)).size; S.now = st - 45; api.renderAll();
        cap(1, '<b>The brief’s scenario:</b> Mumbai airport closes for ' + S.weather[0].dur + ' minutes at ' + hhmm(st) + '. It is ' + hhmm(S.now) + '; all ' + n.flights.length + ' flights, ' + n.tails.filter(t => !t.spare).length + ' aircraft and ' + crewsN + ' crews are on schedule.');
        await wait(4800); if (my.cancel) return;
        cap(2, '<b>The airport closes.</b> Aircraft hold, divert or wait. Fast-forwarding six hours: watch the flights it strands turn amber and red — and the delay travel to airports with clear skies.');
        api.setSpeed(40); S.playing = true; api.header();
        await until(() => S.now >= st + 360, 30000); S.playing = false; api.header(); api.renderLive(); if (my.cancel) return;
        S.btab = 'fix'; api.renderBottomShell();
        const dg = DS.diagnose(n, R(), S.now), tot = dg.direct + dg.knock, kn = tot ? Math.round(dg.knock / tot * 100) : 0, m = DS.metricsAt(R(), S.now);
        const reach = new Set(R().flights.filter(f => f.status === 'ok' && f.adep <= S.now && f.adep - f.std > 30 && !DS.affected(n, S.weather).includes(f.orig)).map(f => f.orig)).size;
        cap(3, '<b>Six hours on, far from the storm:</b> ' + m.delayed + ' flights are late, ' + reach + ' other airports are delayed and ' + num(m.stranded) + ' passengers are stranded. ' + kn + '% of the delay is knock-on — flights late only because their <i>aircraft</i> was late. “Where to fix” traces each one to its root cause.');
        await wait(8500); if (my.cancel) return;
        S.now = st - 40; S.playing = false; S.ltab = 'dispatcher'; api.renderAll();
        ask('@recommend', 'What should I do?');
        cap(4, '<b>Rewind, then ask the AI dispatcher.</b> It tested every recovery measure against the whole day and recommends one, with before and after. Every number it states is audited against the simulator (badge below the message).');
        await wait(9000); if (my.cancel) return;
        const idx = S.chat.map((c, i) => c.top && !c.done ? i : -1).filter(i => i >= 0).pop();
        if (idx != null) chatApply(idx, 'top');
        cap(5, '<b>Decision applied.</b> The dispatcher states the exact before and after. Now replaying the same closure with the plan in place…');
        await wait(3500); if (my.cancel) return;
        api.setSpeed(40); S.playing = true; api.header();
        await until(() => S.now >= st + 360, 30000); S.playing = false; api.header(); api.renderLive(); if (my.cancel) return;
        const d = api.scoreData();
        cap(6, '<b>Result: grade ' + (d.grade === 'none' ? '–' : d.grade) + '</b> — ' + Math.round(d.pct) + '% of the closure’s damage recovered, ' + num(Math.abs(d.paxH)) + ' fewer passenger-hours of delay than doing nothing. <b>Your turn:</b> close any airport, for as long as you like.');
        S.ltab = 'scenario'; api.renderLeft(); await wait(14000);
      } finally { if (demo === my) { demo = null; api.setSpeed(my.speed); $('#demoCap').classList.add('hidden'); document.body.classList.remove('has-demo'); S.playing = false; api.header(); } }
    }
    H.actions.runDemo = runDemo; H.actions.stopDemo = stopDemo;
    document.addEventListener('pointerdown', e => { if (demo && !e.target.closest('#demoCap')) stopDemo(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') stopDemo(); });
    // ------------------------------------------------------------------ accessibility enhancer
    // Everything the app draws with innerHTML is passed through here: clickable rows/cards become keyboard-operable,
    // sliders and selects get names, table headers get scope, and the two tab bars follow the WAI-ARIA tabs pattern.
    const CLICKABLE = 'tr.click, .dom[data-act], td[data-act], [data-act]:not(button):not(a):not(input):not(select):not(tr)';
    // Scoped to the nodes that were just added, so the 4-per-second live refresh does not re-scan the whole document.
    const within = (roots, sel) => { const out = []; roots.forEach(r => { if (r.matches && r.matches(sel)) out.push(r); if (r.querySelectorAll) r.querySelectorAll(sel).forEach(x => out.push(x)); }); return out; };
    function enhance(roots) {
      roots = roots && roots.length ? roots : [document.body];
      within(roots, CLICKABLE).forEach(el => { if (!el.hasAttribute('tabindex')) { el.tabIndex = 0; if (el.tagName !== 'TR') el.setAttribute('role', 'button'); } });
      const rows = within(roots, '.sl'); roots.forEach(r => { const p = r.closest && r.closest('.sl'); if (p) rows.push(p); });
      rows.forEach(row => { const label = row.querySelector('span'); row.querySelectorAll('input,select').forEach(c => { if (!c.hasAttribute('aria-label') && label) c.setAttribute('aria-label', label.textContent.trim()); }); });
      within(roots, 'th:not([scope])').forEach(th => th.setAttribute('scope', 'col'));
      [['#leftTabs', '#leftBody'], ['#botTabs', '#botBody']].forEach(([tabs, panel]) => {
        const tl = $(tabs), p = $(panel); if (!tl || !p) return;
        tl.querySelectorAll('[role=tab]').forEach(t => { t.id = t.id || tabs.slice(1) + '-' + t.dataset.tab; t.setAttribute('aria-controls', panel.slice(1)); t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1; });
        const sel = tl.querySelector('[aria-selected=true]'); if (sel) p.setAttribute('aria-labelledby', sel.id);
      });
    }
    // Runs inside the observer callback itself (a batched microtask): no rAF or timer, both of which browsers throttle in background/headless tabs.
    new MutationObserver(recs => { const roots = []; recs.forEach(r => r.addedNodes.forEach(n => { if (n.nodeType === 1) roots.push(n); })); enhance(roots.length ? roots : [document.body]); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
    document.addEventListener('keydown', e => {
      const t = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && t.matches && t.matches(CLICKABLE)) { e.preventDefault(); t.click(); return; }
      if (t.getAttribute && t.getAttribute('role') === 'tab' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        const tabs = [...t.parentElement.querySelectorAll('[role=tab]')]; let i = tabs.indexOf(t);
        i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        e.preventDefault(); tabs[i].focus(); tabs[i].click(); setTimeout(() => { const nt = $('#' + tabs[i].id); if (nt) nt.focus(); }, 0);
      }
    });
    api.renderLeft();      // the first render ran before these hooks existed: draw the panel again so "Close an airport" is there on load
    enhance();
    window.DominoSky.runDemo = runDemo;
    if (/[?&]demo\b/.test(location.search)) setTimeout(runDemo, 700);
  }
  if (window.DominoSky && window.DominoSky.api) boot(); else document.addEventListener('domino-sky-ready', boot, { once: true });
})();
