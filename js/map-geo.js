/* Domino Sky — map geography: Mercator maths, the world outlines (decoded from the bundled Natural Earth TopoJSON) and great-circle routes. */
(function (G) {
  'use strict';
  const DS = G.DS,
    PI = Math.PI,
    RAD = PI / 180;
  const clampLat = l => Math.max(-85, Math.min(85, l));
  const mercY = lat => Math.log(Math.tan(PI / 4 + (clampLat(lat) * RAD) / 2)) / RAD; // degree-equivalent mercator ordinate
  const invMerc = v => (2 * Math.atan(Math.exp(v * RAD)) - PI / 2) / RAD;
  const KM_DEG = 111.32;

  // ---------------------------------------------------------------- geography
  const GEO = { ready: false, countries: [], coast: [], border: [] };
  (function decode() {
    const topo = G.WORLD_TOPO;
    if (!topo) return;
    const [sx, sy] = topo.transform.scale,
      [tx, ty] = topo.transform.translate;
    const arcs = topo.arcs.map(a => {
      let x = 0,
        y = 0;
      return a.map(p => {
        x += p[0];
        y += p[1];
        return [x * sx + tx, y * sy + ty];
      });
    });
    const use = new Array(arcs.length).fill(0);
    const unwrap = pts => {
      const out = new Float32Array(pts.length * 2);
      let prev = pts[0][0],
        off = 0;
      pts.forEach((p, i) => {
        let lon = p[0] + off;
        if (i && Math.abs(lon - prev) > 180) {
          off += lon < prev ? 360 : -360;
          lon = p[0] + off;
        }
        prev = lon;
        out[i * 2] = lon;
        out[i * 2 + 1] = p[1];
      });
      return out;
    };
    const ringPts = ring => {
      const pts = [];
      ring.forEach((i, k) => {
        const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
        for (let j = k ? 1 : 0; j < a.length; j++) pts.push(a[j]);
      });
      return pts;
    };
    for (const g of topo.objects.countries.geometries) {
      const name = g.properties && g.properties.name;
      if (name === 'Antarctica') continue;
      const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
      const rings = [];
      let best = null,
        bestArea = -1;
      polys.forEach(poly =>
        poly.forEach((ring, ri) => {
          ring.forEach(i => {
            use[i < 0 ? ~i : i]++;
          });
          const pts = unwrap(ringPts(ring));
          let mnx = 1e9,
            mny = 1e9,
            mxx = -1e9,
            mxy = -1e9;
          for (let i = 0; i < pts.length; i += 2) {
            mnx = Math.min(mnx, pts[i]);
            mxx = Math.max(mxx, pts[i]);
            mny = Math.min(mny, pts[i + 1]);
            mxy = Math.max(mxy, pts[i + 1]);
          }
          const r = { pts, bb: [mnx, mny, mxx, mxy] };
          rings.push(r);
          const area = (mxx - mnx) * (mxy - mny);
          if (ri === 0 && area > bestArea) {
            bestArea = area;
            best = r.bb;
          }
        })
      );
      if (rings.length) GEO.countries.push({ name, rings, main: best });
    }
    arcs.forEach((a, i) => {
      if (use[i] < 1 || use[i] > 2) return;
      if (a.every(p => Math.abs(p[0]) > 179.9) || a.every(p => p[1] < -60)) return; // antimeridian cuts, Antarctica
      (use[i] === 1 ? GEO.coast : GEO.border).push(unwrap(a));
    });
    GEO.ready = true;
  })();

  // ---------------------------------------------------------------- great circles
  const gcCache = new Map(),
    GCN = 64;
  function gc(a, b) {
    const key = a.code + b.code;
    let r = gcCache.get(key);
    if (r) return r;
    const la1 = a.lat * RAD,
      lo1 = a.lon * RAD,
      la2 = b.lat * RAD,
      lo2 = b.lon * RAD;
    const d =
      2 *
        Math.asin(
          Math.sqrt(
            Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2
          )
        ) || 1e-9;
    r = new Float32Array((GCN + 1) * 2);
    let prev = a.lon,
      off = 0;
    for (let i = 0; i <= GCN; i++) {
      const f = i / GCN,
        A = Math.sin((1 - f) * d) / Math.sin(d),
        B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2),
        y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2),
        z = A * Math.sin(la1) + B * Math.sin(la2);
      let lon = Math.atan2(y, x) / RAD + off;
      if (i && Math.abs(lon - prev) > 180) {
        off += lon < prev ? 360 : -360;
        lon = Math.atan2(y, x) / RAD + off;
      }
      prev = lon;
      r[i * 2] = lon;
      r[i * 2 + 1] = Math.atan2(z, Math.hypot(x, y)) / RAD;
    }
    gcCache.set(key, r);
    return r;
  }
  function samplePos(arr, p) {
    p = Math.max(0, Math.min(1, p));
    const f = p * GCN,
      i = Math.min(GCN - 1, Math.floor(f)),
      t = f - i;
    return [
      arr[i * 2] + (arr[i * 2 + 2] - arr[i * 2]) * t,
      arr[i * 2 + 1] + (arr[i * 2 + 3] - arr[i * 2 + 1]) * t
    ];
  }

  Object.assign(DS, { GEO, gc, GCN, samplePos, mercY, invMerc, clampLat, KM_DEG });
})(window);
