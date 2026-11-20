/* Domino Sky — "Close an airport" card: choose an airport, when it closes and for how long, then watch the delay spread. */
(function () {
  'use strict';
  function boot() {
    const U = window.DominoSky;
    const api = U.api;
    const S = U.S;
    const H = U.HOOKS;
    const DS = window.DS;
    const { hhmm, toast } = api;
    const net = () => api.net;

    function closeCard() {
      const F = S.form,
        n = net(),
        def =
          api.wxAp() !== 'ALL'
            ? api.wxAp()
            : n.airports.find(a => a.code === 'BOM')
              ? 'BOM'
              : n.airports[0].code;
      const ap = F.closeAp || def,
        start = +F.closeStart || Math.max(api.T0, Math.round((S.now + 30) / 5) * 5),
        dur = +F.closeDur || 90;
      return (
        '<div class="card hero"><h5>Close an airport</h5><p>Choose which airport closes, when, and for how long — then watch the delay spread.</p>' +
        '<div class="row"><select data-f="closeAp" aria-label="Airport to close">' +
        api.apOptions(ap) +
        '</select></div>' +
        '<div class="sl"><span>Closes at</span><input type="range" min="' +
        api.T0 +
        '" max="1560" step="5" value="' +
        start +
        '" data-f="closeStart" aria-label="Closing time"><output>' +
        hhmm(start) +
        '</output></div>' +
        '<div class="row" style="margin-top:4px"><label for="closeDur">Closed for</label><select id="closeDur" data-f="closeDur">' +
        [30, 60, 90, 120, 180, 240, 360]
          .map(
            m =>
              '<option value="' +
              m +
              '"' +
              (m === dur ? ' selected' : '') +
              '>' +
              (m < 60 ? m + ' min' : m / 60 + ' h') +
              '</option>'
          )
          .join('') +
        '</select>' +
        '<button class="btn primary sm" data-act="closeAirport">Close airport</button></div></div>'
      );
    }
    H.weatherTop = closeCard;
    function closeAirport(code, start, dur) {
      const a = net().airportMap[code],
        m = DS.WXT['Airport closure'];
      const ev = {
        id: S.nextId++,
        type: 'Airport closure',
        lat: a.lat,
        lon: a.lon,
        radius: m.radius,
        start,
        dur,
        severity: 1
      };
      S.weather.push(ev);
      S.selEv = ev.id;
      api.recompute();
      api.renderAll();
      toast('' + code + ' closes ' + hhmm(start) + '–' + hhmm(start + dur));
    }
    H.actions.closeAirport = () => {
      const F = S.form,
        d = api.wxAp();
      closeAirport(
        F.closeAp || (d !== 'ALL' ? d : net().airportMap.BOM ? 'BOM' : net().airports[0].code),
        +F.closeStart || Math.max(api.T0, Math.round((S.now + 30) / 5) * 5),
        +F.closeDur || 90
      );
    };
    H.actions.apClose = el =>
      closeAirport(el.dataset.code, Math.max(api.T0, Math.round((S.now + 15) / 5) * 5), 90);
    H.airportButtons = code =>
      '<button class="btn sm danger" data-act="apClose" data-code="' + code + '">Close</button>';
  }
  if (window.DominoSky && window.DominoSky.api) boot();
  else document.addEventListener('domino-sky-ready', boot, { once: true });
})();
