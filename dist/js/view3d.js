/* Domino Sky — 2D | 3D toggle. Additive: injects its own toggle, canvas and styles at runtime, patches the 2D map's
   draw/recenter, and reuses the 2D map's hooks, so selection, tooltips, detail cards and "plant a problem" behave
   identically in 3D. The three.js bundle (vendor/globe3d.js, ~0.6 MB) is loaded lazily on the first click on "3D". */
(function () {
  'use strict';
  const D = window.DominoSky, DS = window.DS;
  if (!D || !D.map || !DS) return;
  const wrap = document.getElementById('mapWrap'), mapCv = document.getElementById('map'), tools = wrap && wrap.querySelector('.maptools');
  if (!wrap || !mapCv || !tools) return;

  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'css/view3d.css'; document.head.appendChild(link);
  const cv = document.createElement('canvas'); cv.id = 'globe'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Interactive 3D globe of the airline network. Drag to rotate, scroll to zoom.');
  mapCv.insertAdjacentElement('afterend', cv);
  const seg = document.createElement('div'); seg.className = 'seg'; seg.id = 'viewMode'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Map view');
  seg.innerHTML = '<button data-v="2d" class="on" aria-pressed="true">2D</button><button data-v="3d" aria-pressed="false" title="3D globe (G)">3D</button>';
  tools.insertBefore(seg, tools.firstChild);
  const btn3 = seg.querySelector('[data-v="3d"]'), btn2 = seg.querySelector('[data-v="2d"]');

  const say = msg => { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.remove('hidden'); clearTimeout(say.t); say.t = setTimeout(() => t.classList.add('hidden'), 3600); };
  const webgl = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } };
  let mode = '2d', globe = null, loading = null, broken = false;

  // patch the 2D map: while in 3D, its draw() hands over to the globe (the UI frame loop keeps calling map.draw)
  const map = D.map, draw2d = map.draw.bind(map), recenter2d = map.recenter.bind(map);
  map.draw = function (ts) { if (mode === '3d' && globe) globe.draw(ts, map); else draw2d(ts); };
  map.recenter = function () { recenter2d(); if (globe) globe.recenter(); };

  function loadBundle() {
    if (DS.Globe3D) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = 'vendor/globe3d.js?v=2'; s.onload = resolve;
      s.onerror = () => { loading = null; reject(new Error('could not load vendor/globe3d.js')); }; document.head.appendChild(s);
    });
    return loading;
  }
  // Keyboard control for the globe (mouse drag / wheel still work): arrows rotate, + / - zoom, Home re-centres. The canvas is focusable.
  const GLOBE_LABEL = cv.getAttribute('aria-label');
  function bindKeys() {
    cv.tabIndex = 0; cv.setAttribute('aria-label', GLOBE_LABEL + ' Keyboard: arrow keys rotate, plus and minus zoom, Home re-centres.');
    cv.addEventListener('keydown', e => {
      if (!globe || e.ctrlKey || e.metaKey || e.altKey) return;
      const p = globe.camera.position, d = p.length(), Vec = p.constructor, step = Math.max(0.03, Math.min(0.3, (0.12 + (d - 1.12) * 0.28) * 0.5));   // radians: finer when zoomed in
      let used = true;
      if (e.key === 'ArrowLeft') p.applyAxisAngle(new Vec(0, 1, 0), -step);
      else if (e.key === 'ArrowRight') p.applyAxisAngle(new Vec(0, 1, 0), step);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') p.applyAxisAngle(new Vec(0, 1, 0).cross(p).normalize(), e.key === 'ArrowUp' ? -step : step);
      else if (e.key === '+' || e.key === '=') p.setLength(Math.max(1.12, d * 0.8));
      else if (e.key === '-' || e.key === '_') p.setLength(Math.min(6, d / 0.8));
      else if (e.key === 'Home') globe.recenter();
      else used = false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    });
  }
  function disable(msg) { broken = true; btn3.disabled = true; btn3.title = msg; btn3.classList.remove('on'); say(msg); }
  async function set(next) {
    if (next === mode) return;
    if (next === '3d') {
      if (broken) return say('3D is unavailable in this browser — staying on the 2D map.');
      if (!webgl()) return disable('This browser has no WebGL, so the 3D globe cannot run. The 2D map has everything.');
      btn3.textContent = '3D …'; btn3.disabled = true;
      try {
        await loadBundle();
        if (!globe) {
          const h = map.hooks;
          globe = new DS.Globe3D(cv, () => D.S, { placing: () => h.placing(), place: (a, b) => h.place(a, b), hover: (x, px, py) => h.hover(x, px, py), select: x => h.select(x) });
          globe.recenter(true); bindKeys();
        }
      } catch (e) { btn3.textContent = '3D'; btn3.disabled = false; return disable('3D could not start (' + (e.message || e) + '). Staying on the 2D map.'); }
      btn3.textContent = '3D'; btn3.disabled = false; globe.resize(); globe.setVisible(true);
    } else if (globe) globe.setVisible(false);
    mode = next; wrap.classList.toggle('is3d', mode === '3d');
    btn2.classList.toggle('on', mode === '2d'); btn3.classList.toggle('on', mode === '3d'); btn2.setAttribute('aria-pressed', String(mode === '2d')); btn3.setAttribute('aria-pressed', String(mode === '3d'));
    const rc = document.getElementById('btnRecenter'); if (rc) rc.title = mode === '3d' ? 'Re-centre the globe' : 'Re-centre the map';
  }

  seg.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) set(b.dataset.v); });
  document.addEventListener('keydown', e => { if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) set(mode === '3d' ? '2d' : '3d'); });
  if (/[?&]view=3d\b/.test(location.search)) set('3d');
  D.setView = set;           // handy for demos and tests
  D.view = () => mode;
  D.globe3d = () => globe;
})();
