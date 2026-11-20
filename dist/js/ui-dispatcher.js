/* Domino Sky — AI dispatcher tab: chat with the deterministic dispatcher, before/after tables, audit badges and the optional Claude settings.
   Plugs into the UI through window.DominoSky.HOOKS; every number shown comes from DS.* (the engine) and is audited. */
(function () {
  'use strict';
  function boot() {
    const U = window.DominoSky;
    const api = U.api;
    const S = U.S;
    const H = U.HOOKS;
    const DS = window.DS;
    const D = DS.Dispatcher;
    const { $, esc, hhmm, num, toast, R } = api;
    const net = () => api.net;

    S.chat = [];
    S.claude = { key: '', model: 'claude-opus-5-5', consent: false, busy: false };
    H.onReset.push(() => {
      S.chat = [];
    });
    const ctx = () => ({
      net: net(),
      weather: S.weather,
      plan: S.plan,
      now: S.now,
      objective: S.objective,
      base: S.res.base,
      res: R()
    });

    // ------------------------------------------------------------------ AI dispatcher
    const f1 = (v, dec) =>
      v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    function beforeAfter(before, after) {
      const rows = D.METRICS.map(([k, label, , dec]) => {
        const b = before[k],
          a = after[k],
          d = a - b,
          up = k === 'onTimePct' ? d > 0.05 : d < -0.05,
          dn = k === 'onTimePct' ? d < -0.05 : d > 0.05;
        return (
          '<tr><td>' +
          label +
          '</td><td class="r">' +
          f1(b, dec) +
          '</td><td class="r">' +
          f1(a, dec) +
          '</td><td class="r ' +
          (up ? 'up' : dn ? 'dn' : '') +
          '">' +
          (Math.abs(d) < 0.05 ? '—' : (d > 0 ? '+' : '−') + f1(Math.abs(d), dec)) +
          '</td></tr>'
        );
      }).join('');
      return (
        '<table class="ba"><tr><th>Whole day</th><th class="r">Before</th><th class="r">After</th><th class="r">Change</th></tr>' +
        rows +
        '</table>'
      );
    }
    function markBad(text, bad) {
      let h = esc(text);
      [...new Set(bad)].forEach(b => {
        const re = new RegExp('(^|[^\\w.])(' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![\\w])', 'g');
        h = h.replace(
          re,
          (m, p, x) =>
            p +
            '<mark class="unv" title="This figure does not appear in any simulator result">' +
            x +
            '</mark>'
        );
      });
      return h.replace(/\n/g, '<br>');
    }
    function msgHtml(m, i) {
      if (m.role === 'user') return '<div class="msg me">' + esc(m.text) + '</div>';
      const v = m.verification;
      const badge = m.pending
        ? '<span class="audit wait">working…</span>'
        : v
          ? v.ok
            ? '<span class="audit ok" title="Every number and clock time in this message was re-read and checked against the simulator\'s own output.">✓ ' +
              v.checked +
              ' numbers checked — all match the simulator</span>'
            : '<span class="audit bad" title="These figures were not produced by the simulator">⚠ ' +
              v.bad.length +
              ' figure' +
              (v.bad.length > 1 ? 's' : '') +
              ' not verified: ' +
              esc(v.bad.slice(0, 6).join(', ')) +
              '</span>'
          : '';
      const src =
        m.source === 'claude' ? 'Claude · ' + esc(m.model || '') : 'Built-in dispatcher (deterministic)';
      const body =
        m.source === 'claude' && m.text ? '<p>' + markBad(m.text, v ? v.bad : []) + '</p>' : m.html || '';
      let extra = '';
      if (m.top)
        extra +=
          beforeAfter(m.top.before, m.top.after) +
          '<div class="btnrow"><button class="btn primary sm" data-act="chatApply" data-i="' +
          i +
          '" data-k="top" ' +
          (m.done ? 'disabled' : '') +
          '>' +
          (m.done ? '✓ Applied' : 'Apply this action') +
          '</button></div>';
      if (m.candidates && m.candidates.length)
        extra +=
          '<div class="cands">' +
          m.candidates
            .map(
              (c, k) =>
                '<div class="cand"><b>' +
                c.id +
                '</b> ' +
                esc(c.title) +
                '<span class="r">−' +
                num(c.before.paxHours - c.after.paxHours) +
                ' pax-h</span><button class="btn sm" data-act="chatApply" data-i="' +
                i +
                '" data-k="' +
                k +
                '" ' +
                (m.done ? 'disabled' : '') +
                '>Apply</button></div>'
            )
            .join('') +
          '</div>';
      if (m.before && m.after) extra += beforeAfter(m.before, m.after);
      return (
        '<div class="msg ai' +
        (m.error ? ' err' : '') +
        '"><div class="mh"><b>' +
        esc(m.title || '') +
        '</b><span class="src">' +
        src +
        '</span></div>' +
        body +
        extra +
        '<div class="mf">' +
        badge +
        '</div></div>'
      );
    }
    H.left.dispatcher = function () {
      const sel = S.sel.flight != null ? R().flights[S.sel.flight] : null,
        C = S.claude;
      const quick =
        [
          ['@brief', 'Brief me'],
          ['@recommend', 'What should I do?'],
          ['@passengers', 'Passengers'],
          ['@crews', 'Crews']
        ]
          .map(
            ([q, l]) =>
              '<button class="chip-btn" data-act="ask" data-q="' +
              q +
              '" data-label="' +
              esc(l.replace(/^\S+\s/, '')) +
              '">' +
              l +
              '</button>'
          )
          .join('') +
        (sel
          ? '<button class="chip-btn" data-act="ask" data-q="@why" data-label="Why is ' +
            esc(sel.num) +
            (sel.status === 'cancelled' ? ' cancelled?' : ' late?') +
            '">Why is ' +
            esc(sel.num) +
            '?</button>'
          : '');
      const msgs = S.chat.length
        ? S.chat.map(msgHtml).join('')
        : '<div class="empty">Ask the dispatcher for a briefing or a recommendation. It explains and recommends — it never calculates. Every number comes from the simulator and is re-checked before you see it.</div>';
      return (
        '<div class="card hero"><h5>AI Dispatcher</h5><p style="margin:0">Explains what is happening and recommends recovery actions. The simulator does all the maths; the dispatcher only quotes it — and an independent audit re-checks every figure.</p></div>' +
        '<div class="chips wrapchips" style="margin:8px 0">' +
        quick +
        '</div>' +
        '<div id="chatLog" class="chatlog">' +
        msgs +
        '</div>' +
        '<div class="askrow"><input id="dispQ" type="text" autocomplete="off" placeholder="Ask: why is KE273 late? how many are stranded?" value="' +
        esc(S.form.dispQ || '') +
        '" aria-label="Ask the dispatcher"><button class="btn primary sm" data-act="askText">Ask</button></div>' +
        (S.chat.length
          ? '<button class="btn sm" data-act="chatClear" style="margin-top:6px">Clear conversation</button>'
          : '') +
        '<details class="claude"' +
        (C.key || C.consent ? ' open' : '') +
        '><summary>Use Claude instead (optional)</summary>' +
        '<p class="note">Claude gets read-only tools backed by the simulator and must quote their numbers. Anything it states that the tools did not return is highlighted. <b>Privacy:</b> when you press “Ask Claude”, a summary of the situation (airports, flight numbers, delays, passenger counts) is sent to Anthropic’s API using your key. Your key stays in this tab’s memory only.</p>' +
        '<div class="row"><input id="claudeKey" type="password" autocomplete="off" placeholder="Anthropic API key (sk-ant-…)" value="' +
        esc(C.key) +
        '" aria-label="Anthropic API key" style="flex:1;min-width:0"></div>' +
        '<div class="row" style="margin-top:6px"><select id="claudeModel" aria-label="Claude model"><option value="claude-opus-5-5"' +
        (C.model === 'claude-opus-5-5' ? ' selected' : '') +
        '>Claude Opus 5.5 (default)</option><option value="claude-sonnet-5-5"' +
        (C.model === 'claude-sonnet-5-5' ? ' selected' : '') +
        '>Claude Sonnet 5.5</option><option value="claude-haiku-5-5"' +
        (C.model === 'claude-haiku-5-5' ? ' selected' : '') +
        '>Claude Haiku 5.5 (fastest)</option></select></div>' +
        '<label class="consent"><input id="claudeConsent" type="checkbox"' +
        (C.consent ? ' checked' : '') +
        '> I understand the situation summary is sent to Anthropic when I press Ask Claude.</label>' +
        '<button class="btn sm" data-act="claudeAsk" ' +
        (C.busy ? 'disabled' : '') +
        '>' +
        (C.busy ? 'Claude is working…' : 'Ask Claude') +
        '</button></details>'
      );
    };
    function refreshChat() {
      if (S.ltab !== 'dispatcher') return;
      const b = $('#leftBody'),
        keep = b.scrollTop;
      api.renderLeft();
      const log = $('#chatLog');
      if (log) {
        b.scrollTop = b.scrollHeight;
      } else b.scrollTop = keep;
    }
    function ask(q, label) {
      const c = ctx();
      S.chat.push({ role: 'user', text: label || q });
      let out;
      if (q === '@brief') out = D.brief(c);
      else if (q === '@recommend') out = D.recommend(c);
      else if (q === '@passengers') out = D.passengers(c);
      else if (q === '@crews') out = D.crews(c);
      else if (q === '@why') out = S.sel.flight != null ? D.whyFlight(c, S.sel.flight) : D.brief(c);
      else out = D.answer(c, q, S.sel.flight);
      out.role = 'ai';
      S.chat.push(out);
      refreshChat();
    }
    function chatApply(i, k) {
      const m = S.chat[i];
      if (!m || m.done) return;
      const pick = k === 'top' ? m.top : m.candidates[+k],
        a = pick.action;
      if (a.type === 'swap' && S.plan.some(p => p.type === 'swap' && p.spare === a.spare)) {
        toast('That spare aircraft is already assigned — ask again for a fresh recommendation.');
        return;
      }
      const before = D.snapshot(net(), R());
      api.addAction(Object.assign({}, a, { from: S.now }), true);
      const out = D.applied(ctx(), before, pick.title, a);
      out.role = 'ai';
      m.done = true;
      S.chat.push(out);
      S.ltab = 'dispatcher';
      refreshChat();
    }
    async function claudeAsk() {
      const C = S.claude;
      if (C.busy) return;
      if (!C.consent) {
        toast('Please tick the consent box first.');
        return;
      }
      if (!C.key.trim()) {
        toast('Enter your Anthropic API key first.');
        return;
      }
      const q =
        (S.form.dispQ || '').trim() || 'Brief me on the situation and recommend the best recovery action.';
      const pend = {
        role: 'ai',
        pending: true,
        source: 'claude',
        model: C.model,
        title: 'Claude is working…',
        html: '<p>Calling the simulator’s tools…</p>'
      };
      S.chat.push({ role: 'user', text: q }, pend);
      C.busy = true;
      S.form.dispQ = '';
      refreshChat();
      try {
        const out = await D.askClaude(ctx(), q, { apiKey: C.key.trim(), model: C.model });
        Object.assign(pend, out, { role: 'ai', pending: false, html: null });
      } catch (e) {
        Object.assign(pend, {
          pending: false,
          error: true,
          title: 'Claude request failed',
          html:
            '<p>' +
            esc(e.message || String(e)) +
            '</p><p class="note">Check the key, the model name and your connection. The built-in dispatcher still works offline.</p>'
        });
      }
      C.busy = false;
      refreshChat();
    }
    Object.assign(H.actions, {
      ask: el => ask(el.dataset.q, el.dataset.label),
      askText: () => {
        const q = (S.form.dispQ || '').trim();
        if (!q) return;
        S.form.dispQ = '';
        ask(q, q);
      },
      chatApply: el => chatApply(+el.dataset.i, el.dataset.k),
      claudeAsk,
      chatClear: () => {
        S.chat = [];
        refreshChat();
      },
      selTail: el => {
        S.sel.tail = el.dataset.tail;
        S.sel.flight = null;
        api.renderLiveSoon();
      }
    });
    document.addEventListener('input', e => {
      const t = e.target;
      if (t.id === 'dispQ') S.form.dispQ = t.value;
      else if (t.id === 'claudeKey') S.claude.key = t.value;
      else if (t.dataset && t.dataset.f === 'closeStart') {
        const o = t.parentElement.querySelector('output');
        if (o) o.textContent = hhmm(+t.value);
      }
    });
    document.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'claudeModel') S.claude.model = t.value;
      else if (t.id === 'claudeConsent') S.claude.consent = t.checked;
    });
    document.addEventListener('keydown', e => {
      if (e.target.id === 'dispQ' && e.key === 'Enter') {
        e.preventDefault();
        H.actions.askText();
      }
    });
    U.chat = { ask, chatApply }; // used by the guided demo
  }
  if (window.DominoSky && window.DominoSky.api) boot();
  else document.addEventListener('domino-sky-ready', boot, { once: true });
})();
