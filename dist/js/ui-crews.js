/* Domino Sky — Crews tab: every crew's duty clock, margin to the limit, and which crews are at risk of timing out. */
(function () {
  'use strict';
  function boot() {
    const U = window.DominoSky;
    const api = U.api;
    const S = U.S;
    const H = U.HOOKS;
    const DS = window.DS;
    const D = DS.Dispatcher;
    const { R, esc, hhmm } = api;
    const net = () => api.net;

    H.bottom.crews = function () {
      const n = net(),
        rows = D.crewRows(n, R(), S.plan),
        flagged = rows.filter(r => r.status !== 'ok').length;
      const pill = s => ({ ok: 'ok', tight: 'warn', 'at risk': 'orange', 'timed out': 'bad' })[s];
      return (
        '<div class="note" style="margin:0 0 8px;color:var(--text)"><b>' +
        rows.length +
        '</b> crews · <b>' +
        flagged +
        '</b> within an hour and a half of their legal duty limit or past it. ' +
        (n.hardCrewLimit
          ? 'Each crew’s duty window comes from the dataset and its maximum is a legal limit: a crew that would exceed it cannot fly the leg and the rest of its day is cancelled. A spare aircraft with a fresh standby crew can relieve it.'
          : 'A crew’s duty runs from its start until its last arrival and may not exceed its maximum (a crew-duty extension adds hours). A crew that would run past the limit cannot fly the leg, and the rest of its day is cancelled.') +
        '</div>' +
        '<table><tr><th>Crew</th><th>Aircraft</th><th class="r">Duty starts</th><th class="r">Legal limit</th><th class="r">Projected finish</th><th class="r">Margin</th><th>Status</th><th class="r">Flights lost</th></tr>' +
        rows
          .map(
            r =>
              '<tr class="click ' +
              (S.sel.tail === r.aircraft ? 'sel' : '') +
              '" data-act="selTail" data-tail="' +
              esc(r.aircraft) +
              '"><td><b>' +
              esc(r.crew) +
              '</b></td><td>' +
              esc(r.aircraft) +
              '</td><td class="r">' +
              hhmm(r.dutyStart) +
              '</td><td class="r">' +
              hhmm(r.legalEnd) +
              '</td><td class="r">' +
              hhmm(r.projectedFinish) +
              '</td><td class="r" style="color:' +
              (r.marginMin < 30 ? 'var(--bad)' : r.marginMin < 90 ? 'var(--warn)' : 'var(--muted)') +
              '">' +
              (r.marginMin < 0 ? '−' : '') +
              Math.abs(Math.round(r.marginMin)) +
              ' min</td><td><span class="pill ' +
              pill(r.status) +
              '">' +
              r.status +
              '</span></td><td class="r">' +
              (r.timedOutFlights || '') +
              '</td></tr>'
          )
          .join('') +
        '</table>'
      );
    };
    H.flightExtra = f => {
      const r = D.crewRows(net(), R(), S.plan).find(x => x.aircraft === f.tail);
      return r
        ? '<dt>Crew</dt><dd>' +
            esc(r.crew) +
            ' · ' +
            (r.marginMin < 0 ? 'timed out' : Math.round(r.marginMin) + ' min margin') +
            '</dd>'
        : '';
    };
  }
  if (window.DominoSky && window.DominoSky.api) boot();
  else document.addEventListener('domino-sky-ready', boot, { once: true });
})();
