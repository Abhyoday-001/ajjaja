/* Domino Sky — live-tracker chrome for the 2D map: search box, live counters, zoom buttons and a flight card with route progress.
   Everything shown is read from the simulation (DS.simulate results); nothing here calculates delays. */
(function () {
  'use strict';
  function boot() {
    const U = window.DominoSky, api = U.api, S = U.S, H = U.HOOKS, DS = window.DS, map = U.map;
    const { $, esc, hhmm, num } = api;
    const wrap = $('#mapWrap');

    wrap.insertAdjacentHTML('beforeend',
      '<div class="fr-top"><div class="fr-search" role="search"><span class="ico" aria-hidden="true">⌕</span>' +
      '<input id="frSearch" type="search" autocomplete="off" placeholder="Search flight, airport or aircraft" aria-label="Search flights, airports and aircraft" aria-controls="frResults" aria-expanded="false">' +
      '<div id="frResults" class="fr-results hidden" role="listbox" aria-label="Search results"></div></div>' +
      '<div class="fr-count" id="frCount" aria-live="off"></div></div>' +
      '<div class="fr-zoom" role="group" aria-label="Zoom"><button type="button" id="frIn" aria-label="Zoom in">+</button><button type="button" id="frOut" aria-label="Zoom out">−</button></div>');

    // ------------------------------------------------------------ live counters
    function counts() {
      const R = api.R().flights, now = S.now; let air = 0, late = 0, cx = 0;
      R.forEach(f => {
        if (f.status === 'cancelled') { if (Math.min(f.cancelAt == null ? f.std : f.cancelAt, f.std) <= now) cx++; return; }
        if (f.adep <= now && f.aarr > now) { air++; if (f.adep - f.std > 15) late++; }
      });
      return { air, late, cx, total: R.length };
    }
    function updateCount() {
      const c = counts(), el = $('#frCount');
      const t = '<span class="live"></span><b>' + c.air + '</b> in the air' + (c.late ? ' · <b class="lt">' + c.late + '</b> late' : '') + (c.cx ? ' · <b class="cx">' + c.cx + '</b> cancelled' : '') + ' · ' + c.total + ' flights today';
      if (el.innerHTML !== t) el.innerHTML = t;
    }
    setInterval(updateCount, 500); updateCount();

    // ------------------------------------------------------------ map style: terrain (relief) or minimal (flat, tracker-like)
    let saved = 'terrain'; try { saved = localStorage.getItem('domino-sky-mapstyle') || 'terrain'; } catch (e) { /* storage may be blocked */ }
    DS.setMapStyle(saved);
    const tools = document.querySelector('.maptools');
    tools.insertAdjacentHTML('afterbegin', '<div class="seg" id="mapStyle" role="group" aria-label="Map style"><button type="button" data-s="terrain">Terrain</button><button type="button" data-s="minimal">Minimal</button></div>');
    const syncStyle = () => document.querySelectorAll('#mapStyle button').forEach(b => { b.classList.toggle('on', b.dataset.s === DS.mapStyle); b.setAttribute('aria-pressed', b.dataset.s === DS.mapStyle); });
    syncStyle();
    document.getElementById('mapStyle').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; DS.setMapStyle(b.dataset.s); try { localStorage.setItem('domino-sky-mapstyle', DS.mapStyle); } catch (er) { /* ignore */ } map.skey = ''; syncStyle(); });

    // ------------------------------------------------------------ zoom buttons
    const zoomBy = f => { const fit = map.fitScale(); const ns = Math.max(fit * 0.85, Math.min(fit * 90, map.v.s * f)), k = ns / map.v.s; map.v.s = ns; map.v.ox *= k; map.v.oy *= k; map.userMoved = true; map.clampPan && map.clampPan(); };
    $('#frIn').addEventListener('click', () => zoomBy(1.6)); $('#frOut').addEventListener('click', () => zoomBy(1 / 1.6));

    // ------------------------------------------------------------ search
    const statusWord = f => { if (f.status === 'cancelled') return 'cancelled'; const ph = DS.flightPhase(api.net, f, S.now).ph; return ph === 'air' || ph === 'hold' || ph === 'divert' || ph === 'ferry' ? 'in the air' : ph === 'landed' ? 'landed' : 'scheduled'; };
    function focusOn(lon, lat) {
      map.v.lon0 = lon; map.v.m0 = DS.mercY(lat); map.v.ox = 0; map.v.oy = 0; map.v.s = Math.max(map.v.s, map.fitScale() * 3); map.userMoved = true; map.skey = '';
    }
    function flightPos(f) {
      const n = api.net, A = n.airportMap, ph = DS.flightPhase(n, f, S.now);
      if ((ph.ph === 'air' || ph.ph === 'divert' || ph.ph === 'ferry') && DS.gc && DS.samplePos) return DS.samplePos(DS.gc(A[ph.a], A[ph.b]), Math.max(0, Math.min(1, ph.p)));
      const a = A[ph.at || f.orig]; return [a.lon, a.lat];
    }
    let hits = [];
    function search(q) {
      q = q.trim().toLowerCase(); const box = $('#frResults'), inp = $('#frSearch');
      if (!q) { box.classList.add('hidden'); inp.setAttribute('aria-expanded', 'false'); hits = []; return; }
      const n = api.net, A = n.airportMap, out = [];
      n.airports.forEach(a => { if (out.length < 3 && (a.code + ' ' + a.city + ' ' + a.name).toLowerCase().includes(q)) out.push({ t: 'airport', code: a.code, title: a.code + ' · ' + a.city, sub: a.name }); });
      api.R().flights.forEach(f => { if (out.length < 9 && (f.num + ' ' + f.tail + ' ' + f.orig + ' ' + f.dest + ' ' + A[f.orig].city + ' ' + A[f.dest].city).toLowerCase().includes(q)) out.push({ t: 'flight', id: f.id, title: f.num + '  ' + f.orig + ' → ' + f.dest, sub: f.tail + ' · ' + statusWord(f) }); });
      hits = out;
      box.innerHTML = out.length ? out.map((h, i) => '<button type="button" role="option" class="fr-hit" data-i="' + i + '"><span class="ic">' + (h.t === 'airport' ? '🛬' : '✈') + '</span><span><b>' + esc(h.title) + '</b><small>' + esc(h.sub) + '</small></span></button>').join('') : '<div class="fr-none">No match for “' + esc(q) + '”</div>';
      box.classList.remove('hidden'); inp.setAttribute('aria-expanded', 'true');
    }
    function pick(i) {
      const h = hits[i]; if (!h) return;
      if (h.t === 'airport') { const a = api.net.airportMap[h.code]; S.sel.airport = h.code; S.sel.flight = null; S.sel.tail = null; focusOn(a.lon, a.lat); api.renderLiveSoon(); }
      else { const f = api.R().flights[h.id], p = flightPos(f); api.selectFlight(h.id); focusOn(p[0], p[1]); }
      $('#frResults').classList.add('hidden'); $('#frSearch').setAttribute('aria-expanded', 'false'); $('#frSearch').value = '';
    }
    $('#frSearch').addEventListener('input', e => search(e.target.value));
    $('#frSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pick(0); } else if (e.key === 'Escape') { e.target.value = ''; search(''); } });
    $('#frResults').addEventListener('click', e => { const b = e.target.closest('.fr-hit'); if (b) pick(+b.dataset.i); });
    document.addEventListener('click', e => { if (!e.target.closest('.fr-search')) { $('#frResults').classList.add('hidden'); $('#frSearch').setAttribute('aria-expanded', 'false'); } });

    // ------------------------------------------------------------ flight card (top of the detail panel)
    H.flightCard = function (f, st) {
      const n = api.net, A = n.airportMap, o = A[f.orig], d = A[f.dest], F = n.flights[f.id];
      const al = (n.airlines.find(a => a.code === f.airline) || {}).name || f.airline, tail = n.tails.find(t => t.id === f.tail) || {};
      const km = Math.round(DS.hav(o, d)), ok = f.status === 'ok';
      const pct = !ok ? 0 : S.now <= f.adep ? 0 : S.now >= f.eta ? 100 : Math.round((S.now - f.adep) / Math.max(1, f.eta - f.adep) * 100);
      const late = ok ? Math.max(0, f.aarr - f.sta) : 0, dep = ok ? f.adep - f.std : 0;
      const t = (label, sched, actual, delay) => '<div><small>' + label + '</small><b>' + hhmm(actual != null ? actual : sched) + '</b><span class="' + (delay > 15 ? 'lt' : '') + '">' + (actual != null && delay >= 1 ? 'scheduled ' + hhmm(sched) + ' · +' + Math.round(delay) + ' min' : 'on schedule') + '</span></div>';
      return '<button class="x" data-act="closeDetail" aria-label="Close flight card">✕</button>' +
        '<div class="frc"><div class="frc-h"><span class="frc-num">' + esc(f.num) + '</span><span class="pill ' + st.k + '">' + esc(st.text) + '</span></div>' +
        '<div class="frc-al">' + esc(al) + ' · ' + esc(f.tail) + (tail.type ? ' · ' + esc(tail.type) : '') + '</div>' +
        '<div class="frc-route"><div class="ap"><b>' + esc(f.orig) + '</b><span>' + esc(o.city) + '</span></div><div class="mid"><div class="bar"><i style="width:' + pct + '%"></i><em style="left:' + pct + '%" aria-hidden="true">✈</em></div><small>' + num(km) + ' km · ' + pct + '% flown</small></div><div class="ap r"><b>' + esc(f.dest) + '</b><span>' + esc(d.city) + '</span></div></div>' +
        (ok ? '<div class="frc-times">' + t('Departure', f.std, f.adep, dep) + t(S.now >= f.aarr ? 'Arrived' : 'Arrival', f.sta, f.aarr, late) + '</div>'
            : '<div class="frc-times"><div><small>Scheduled</small><b>' + hhmm(f.std) + ' → ' + hhmm(f.sta) + '</b><span class="lt">cancelled</span></div></div>') +
        '<dl class="kv"><dt>Flight time</dt><dd>' + (ok ? Math.round(f.eta - f.adep) : f.sta - f.std) + ' min</dd><dt>Passengers</dt><dd>' + F.load + ' / ' + F.seats + '</dd>' +
        (ok ? '<dt>Delay at arrival</dt><dd style="color:' + api.dcol(late) + '">' + Math.round(late) + ' min</dd><dt>Domino generation</dt><dd>' + (f.gen >= 0 ? 'G' + f.gen : 'unaffected') + '</dd>' : '') + H.flightExtra(f) + '</dl></div>';
    };
    document.getElementById('detail').classList.add('frcard');
  }
  if (window.DominoSky && window.DominoSky.api) boot(); else document.addEventListener('domino-sky-ready', boot, { once: true });
})();
