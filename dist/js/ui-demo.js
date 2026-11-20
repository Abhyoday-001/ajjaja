/* Domino Sky — Guided demo: closes an airport, fast-forwards, asks the dispatcher, applies its advice and replays the day. */
(function () {
  'use strict';
  function boot() {
    const U = window.DominoSky;
    const api = U.api;
    const S = U.S;
    const H = U.HOOKS;
    const DS = window.DS;
    const { $, hhmm, num, R } = api;
    const net = () => api.net;
    // the chat helpers live in ui-dispatcher.js: looked up when called
    const ask = (...args) => U.chat.ask(...args);
    const chatApply = (...args) => U.chat.chatApply(...args);

    let demo = null;
    function stopDemo() {
      if (demo) demo.cancel = true;
    }
    async function runDemo() {
      if (demo) {
        stopDemo();
        return;
      }
      api.closeTour();
      api.closeDialog('#helpDlg');
      const my = (demo = { cancel: false, speed: S.speed });
      const wait = ms =>
        new Promise(res => {
          const t0 = performance.now();
          (function tick() {
            if (my.cancel || performance.now() - t0 >= ms) res();
            else setTimeout(tick, 60);
          })();
        });
      const until = (cond, max) =>
        new Promise(res => {
          const t0 = performance.now();
          (function tick() {
            if (my.cancel || cond() || performance.now() - t0 > max) res();
            else setTimeout(tick, 80);
          })();
        });
      const cap = (n, html) => {
        const el = $('#demoCap');
        el.classList.remove('hidden');
        document.body.classList.add('has-demo');
        el.innerHTML =
          '<span class="step">Step ' +
          n +
          ' of 6</span><span>' +
          html +
          '</span><button class="btn sm" data-act="stopDemo">■ Stop</button>';
      };
      try {
        if (net().meta.id !== 'dataset') api.setNetwork('dataset');
        api.loadScenario('d-bom');
        $('#scenarioSel').value = 'd-bom';
        S.btab = 'gantt';
        S.ltab = 'scenario';
        api.renderAll();
        const st = S.weather[0].start,
          n = net(),
          crewsN = new Set(n.tails.filter(t => !t.spare).map(t => t.crew)).size;
        S.now = st - 45;
        api.renderAll();
        cap(
          1,
          '<b>The brief’s scenario:</b> Mumbai airport closes for ' +
            S.weather[0].dur +
            ' minutes at ' +
            hhmm(st) +
            '. It is ' +
            hhmm(S.now) +
            '; all ' +
            n.flights.length +
            ' flights, ' +
            n.tails.filter(t => !t.spare).length +
            ' aircraft and ' +
            crewsN +
            ' crews are on schedule.'
        );
        await wait(4800);
        if (my.cancel) return;
        cap(
          2,
          '<b>The airport closes.</b> Aircraft hold, divert or wait. Fast-forwarding six hours: watch the flights it strands turn amber and red — and the delay travel to airports with clear skies.'
        );
        api.setSpeed(40);
        S.playing = true;
        api.header();
        await until(() => S.now >= st + 360, 30000);
        S.playing = false;
        api.header();
        api.renderLive();
        if (my.cancel) return;
        S.btab = 'fix';
        api.renderBottomShell();
        const dg = DS.diagnose(n, R(), S.now),
          tot = dg.direct + dg.knock,
          kn = tot ? Math.round((dg.knock / tot) * 100) : 0,
          m = DS.metricsAt(R(), S.now);
        const reach = new Set(
          R()
            .flights.filter(
              f =>
                f.status === 'ok' &&
                f.adep <= S.now &&
                f.adep - f.std > 30 &&
                !DS.affected(n, S.weather).includes(f.orig)
            )
            .map(f => f.orig)
        ).size;
        cap(
          3,
          '<b>Six hours on, far from the storm:</b> ' +
            m.delayed +
            ' flights are late, ' +
            reach +
            ' other airports are delayed and ' +
            num(m.stranded) +
            ' passengers are stranded. ' +
            kn +
            '% of the delay is knock-on — flights late only because their <i>aircraft</i> was late. “Where to fix” traces each one to its root cause.'
        );
        await wait(8500);
        if (my.cancel) return;
        S.now = st - 40;
        S.playing = false;
        S.ltab = 'dispatcher';
        api.renderAll();
        ask('@recommend', 'What should I do?');
        cap(
          4,
          '<b>Rewind, then ask the AI dispatcher.</b> It tested every recovery measure against the whole day and recommends one, with before and after. Every number it states is audited against the simulator (badge below the message).'
        );
        await wait(9000);
        if (my.cancel) return;
        const idx = S.chat
          .map((c, i) => (c.top && !c.done ? i : -1))
          .filter(i => i >= 0)
          .pop();
        if (idx != null) chatApply(idx, 'top');
        cap(
          5,
          '<b>Decision applied.</b> The dispatcher states the exact before and after. Now replaying the same closure with the plan in place…'
        );
        await wait(3500);
        if (my.cancel) return;
        api.setSpeed(40);
        S.playing = true;
        api.header();
        await until(() => S.now >= st + 360, 30000);
        S.playing = false;
        api.header();
        api.renderLive();
        if (my.cancel) return;
        const d = api.scoreData();
        cap(
          6,
          '<b>Result: grade ' +
            (d.grade === 'none' ? '–' : d.grade) +
            '</b> — ' +
            Math.round(d.pct) +
            '% of the closure’s damage recovered, ' +
            num(Math.abs(d.paxH)) +
            ' fewer passenger-hours of delay than doing nothing. <b>Your turn:</b> close any airport, for as long as you like.'
        );
        S.ltab = 'scenario';
        api.renderLeft();
        await wait(14000);
      } finally {
        if (demo === my) {
          demo = null;
          api.setSpeed(my.speed);
          $('#demoCap').classList.add('hidden');
          document.body.classList.remove('has-demo');
          S.playing = false;
          api.header();
        }
      }
    }
    H.actions.runDemo = runDemo;
    H.actions.stopDemo = stopDemo;
    document.addEventListener(
      'pointerdown',
      e => {
        if (demo && !e.target.closest('#demoCap')) stopDemo();
      },
      true
    );
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') stopDemo();
    });
    api.renderLeft(); // the first render ran before these hooks existed: draw the panel again so "Close an airport" is there on load
    window.DominoSky.runDemo = runDemo;
    if (/[?&]demo\b/.test(location.search)) setTimeout(runDemo, 700);
  }
  if (window.DominoSky && window.DominoSky.api) boot();
  else document.addEventListener('domino-sky-ready', boot, { once: true });
})();
