/* Domino Sky — 3D globe view (source). Bundled with three.js into vendor/globe3d.js by `npm run build:3d`;
   the bundle is committed, so deploying needs no build step.

   Everything shown is derived from the same state object as the 2D map (S.res.plan, S.weather, S.sel, S.now …),
   so the 3D view can never disagree with the deterministic engine. The Earth texture is generated at runtime from the
   bundled Natural Earth geometry — no image assets, no tile servers, no API keys. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

const DS = window.DS,
  RAD = Math.PI / 180,
  EARTH_KM = 6371,
  TAU = Math.PI * 2;
const DEC = -23.44 * Math.cos((2 * Math.PI * (324 + 10)) / 365) * RAD; // solar declination, 20 November
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// lon/lat (degrees) -> point on a sphere of radius r, matching three's SphereGeometry UV layout
const toVec = (lon, lat, r, out) => {
  const phi = (lon + 180) * RAD,
    cl = Math.cos(lat * RAD);
  out = out || new THREE.Vector3();
  return out.set(-Math.cos(phi) * cl * r, Math.sin(lat * RAD) * r, Math.sin(phi) * cl * r);
};
const toLonLat = v => {
  const r = v.length(),
    lat = Math.asin(clamp(v.y / r, -1, 1)) / RAD;
  let lon = Math.atan2(v.z, -v.x) / RAD - 180;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return [lon, lat];
};
const rgb = (s, a) => {
  const [r, g, b] = s.split(',').map(Number);
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
};
const hex = s => new THREE.Color(s);

// ------------------------------------------------------------------ Earth texture (equirectangular: terrain photo when the map style is Terrain, else Natural Earth fills)
const TERRAIN = {};
function terrainImage(pal) {
  if (DS.mapStyle === 'minimal' || !pal.terrain) return null;
  const u = pal.terrain.img;
  if (!TERRAIN[u]) {
    const im = new Image();
    im.onload = () => {
      const g = window.DominoSky && window.DominoSky.globe3d && window.DominoSky.globe3d();
      if (g) g.themeKey = '';
    };
    im.src = u;
    TERRAIN[u] = im;
  }
  return TERRAIN[u].complete && TERRAIN[u].naturalWidth ? TERRAIN[u] : null;
}
function buildEarthTexture(pal) {
  const W = 4096,
    H = 2048,
    cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const X = lon => ((lon + 180) / 360) * W,
    Y = lat => ((90 - lat) / 180) * H;
  const og = c.createLinearGradient(0, 0, 0, H);
  og.addColorStop(0, pal.ocean0);
  og.addColorStop(0.5, pal.ocean1);
  og.addColorStop(1, pal.ocean0);
  c.fillStyle = og;
  c.fillRect(0, 0, W, H);
  c.strokeStyle = pal.grid;
  c.lineWidth = 1;
  c.beginPath();
  for (let lon = -180; lon <= 180; lon += 15) {
    c.moveTo(X(lon), 0);
    c.lineTo(X(lon), H);
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    c.moveTo(0, Y(lat));
    c.lineTo(W, Y(lat));
  }
  c.stroke();
  const TI = terrainImage(pal);
  if (TI) {
    c.drawImage(TI, 0, 0, W, H);
    c.fillStyle = pal.terrain.veil;
    c.fillRect(0, 0, W, H);
  }
  const GEO = DS.GEO;
  if (GEO && GEO.ready) {
    const den = Y(-60) - Y(75) || 1,
      lg = c.createLinearGradient(0, Y(75), 0, Y(-60));
    pal.land.forEach(([lat, col]) => lg.addColorStop(clamp((Y(lat) - Y(75)) / den, 0, 1), col));
    const offs = [-360, 0, 360];
    const trace = (pts, off, close) => {
      let lx = 0,
        ly = 0,
        first = true;
      for (let i = 0; i < pts.length; i += 2) {
        const x = X(pts[i] + off),
          y = Y(pts[i + 1]);
        if (first) {
          c.moveTo(x, y);
          lx = x;
          ly = y;
          first = false;
        } else if (Math.abs(x - lx) + Math.abs(y - ly) >= 0.5 || i === pts.length - 2) {
          c.lineTo(x, y);
          lx = x;
          ly = y;
        }
      }
      if (close) c.closePath();
    };
    c.beginPath();
    for (const o of offs)
      for (const ct of GEO.countries)
        for (const r of ct.rings) {
          if (r.bb[2] + o < -181 || r.bb[0] + o > 181) continue;
          trace(r.pts, o, true);
        }
    if (!TI) {
      c.fillStyle = lg;
      c.fill();
    }
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.beginPath();
    for (const o of offs) for (const a of GEO.coast) trace(a, o, false);
    if (!TI) {
      c.lineWidth = 7;
      c.strokeStyle = pal.shelf;
      c.stroke();
    }
    c.beginPath();
    for (const o of offs) for (const a of GEO.border) trace(a, o, false);
    c.lineWidth = 1.1;
    c.strokeStyle = TI ? pal.terrain.border : pal.border;
    c.stroke();
    c.beginPath();
    for (const o of offs) for (const a of GEO.coast) trace(a, o, false);
    if (!TI) {
      c.lineWidth = 1.7;
      c.strokeStyle = pal.coast;
      c.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
function radialTexture(color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d'),
    g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, `rgba(${color},0.75)`);
  g.addColorStop(0.55, `rgba(${color},0.28)`);
  g.addColorStop(1, `rgba(${color},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function handleTexture(meta) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const c = cv.getContext('2d');
  c.beginPath();
  c.arc(48, 48, 42, 0, TAU);
  c.fillStyle = 'rgba(8,13,26,.92)';
  c.fill();
  c.lineWidth = 5;
  c.strokeStyle = `rgb(${meta.c})`;
  c.stroke();
  c.font = '46px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",system-ui';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#fff';
  c.fillText(meta.icon, 48, 52);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ shaders
const GLOBE_VS =
  'varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv=uv; vN=normalize(normal); vW=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
const GLOBE_FS = `uniform sampler2D map; uniform vec3 sunDir; uniform vec3 nightColor; uniform float nightAlpha; uniform vec3 camPos; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vec3 c=texture2D(map,vUv).rgb; float d=dot(normalize(vN),normalize(sunDir)); float k=smoothstep(0.10,-0.24,d);
  c=mix(c,c*0.30+nightColor*0.55,k*nightAlpha);
  float rim=pow(1.0-max(dot(normalize(vN),normalize(camPos-vW)),0.0),3.0); c+=rim*vec3(0.26,0.24,0.20)*0.55;
  gl_FragColor=vec4(c,1.0);
  #include <colorspace_fragment>
}`;
const ATMO_VS =
  'varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
const ATMO_FS =
  'uniform vec3 glow; uniform float power; varying vec3 vN; void main(){ float i=pow(clamp(0.66-dot(vN,vec3(0.,0.,1.)),0.,1.),power); gl_FragColor=vec4(glow,i);\n#include <colorspace_fragment>\n}';
const AP_VS =
  'attribute float aSize; attribute vec3 aColor; attribute vec3 aOut; varying vec3 vC; varying vec3 vO; uniform float px; void main(){ vC=aColor; vO=aOut; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*px; }';
const AP_FS =
  'varying vec3 vC; varying vec3 vO; void main(){ float d=length(gl_PointCoord-0.5); if(d>0.5) discard; vec3 col=d>0.33?vO:vC; gl_FragColor=vec4(col,1.0);\n#include <colorspace_fragment>\n}';
const TR_VS =
  'attribute float aAlpha; varying float vA; void main(){ vA=aAlpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
const TR_FS = 'varying float vA; uniform vec3 tint; void main(){ gl_FragColor=vec4(tint,vA*0.6); }';

// airliner outline (same polygon as the 2D map), nose toward +Y, lying in the XY plane (normal +Z)
const PL = [
  [0, -10.5],
  [0.9, -9.2],
  [1.2, -6],
  [1.25, -2.2],
  [9.6, 3.6],
  [9.8, 5.3],
  [1.3, 3.4],
  [1.1, 7.6],
  [4.2, 9.6],
  [4.2, 10.7],
  [0.5, 9.7],
  [0, 10.6]
];
function planeGeometry() {
  const pts = PL.map(([x, y]) => new THREE.Vector2(x, -y));
  for (let i = PL.length - 2; i >= 1; i--) pts.push(new THREE.Vector2(-PL[i][0], -PL[i][1]));
  return new THREE.ShapeGeometry(new THREE.Shape(pts));
}

const GCN = () => DS.GCN || 64;
const hMaxCache = new WeakMap();
function arcHeight(arr) {
  let h = hMaxCache.get(arr);
  if (h != null) return h;
  const n = GCN(),
    a = toVec(arr[0], arr[1], 1),
    b = toVec(arr[n * 2], arr[n * 2 + 1], 1),
    ang = Math.acos(clamp(a.dot(b), -1, 1));
  h = Math.min(0.1, 0.012 + ang * 0.045);
  hMaxCache.set(arr, h);
  return h;
}
const altAt = (h, p) => 0.004 + h * Math.pow(Math.sin(Math.PI * clamp(p, 0, 1)), 0.7);
function arcPoint(arr, p, out) {
  const q = DS.samplePos(arr, p);
  return toVec(q[0], q[1], 1 + altAt(arcHeight(arr), p), out);
}

// ------------------------------------------------------------------ the view
class Globe3D {
  constructor(canvas, getState, hooks) {
    this.c = canvas;
    this.gs = getState;
    this.hooks = hooks || {};
    this.hit = [];
    this.mouse = null;
    this.fly = null;
    this.themeKey = '';
    this.netKey = '';
    this.wxKey = '';
    this.selKey = '';
    const renderer = (this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    }));
    if (!renderer.getContext()) throw new Error('WebGL is not available');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = (this.scene = new THREE.Scene());
    const camera = (this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 120));
    const controls = (this.controls = new OrbitControls(camera, canvas));
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.minDistance = 1.12;
    controls.maxDistance = 6;
    controls.zoomSpeed = 0.7;
    // globe
    this.globeMat = new THREE.ShaderMaterial({
      vertexShader: GLOBE_VS,
      fragmentShader: GLOBE_FS,
      uniforms: {
        map: { value: null },
        sunDir: { value: new THREE.Vector3(1, 0, 0) },
        nightColor: { value: new THREE.Color('#050b18') },
        nightAlpha: { value: 0.6 },
        camPos: { value: new THREE.Vector3() }
      }
    });
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), this.globeMat);
    scene.add(this.globe);
    this.atmoMat = new THREE.ShaderMaterial({
      vertexShader: ATMO_VS,
      fragmentShader: ATMO_FS,
      uniforms: { glow: { value: new THREE.Color('#c9a96e') }, power: { value: 3.2 } },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.085, 64, 48), this.atmoMat));
    // stars
    const sp = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) {
      const u = Math.random() * 2 - 1,
        t = Math.random() * TAU,
        s = Math.sqrt(1 - u * u),
        r = 40 + Math.random() * 20;
      sp[i * 3] = r * s * Math.cos(t);
      sp[i * 3 + 1] = r * u;
      sp[i * 3 + 2] = r * s * Math.sin(t);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color: 0xcfe0ff,
        size: 1.1,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.7,
        depthWrite: false
      })
    );
    scene.add(this.stars);
    // airports
    this.apMat = new THREE.ShaderMaterial({
      vertexShader: AP_VS,
      fragmentShader: AP_FS,
      uniforms: { px: { value: renderer.getPixelRatio() } },
      transparent: true,
      depthWrite: false
    });
    this.labels = document.createElement('div');
    this.labels.id = 'globeLabels';
    canvas.parentElement.insertBefore(this.labels, canvas.nextSibling);
    this.lblPool = [];
    // aircraft (outline + body), contrails
    const pg = planeGeometry(),
      MAXAC = 700;
    this.maxAc = MAXAC;
    this.bodyMesh = new THREE.InstancedMesh(
      pg,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      MAXAC
    );
    this.outMesh = new THREE.InstancedMesh(
      pg,
      new THREE.MeshBasicMaterial({ color: 0x06101f, side: THREE.DoubleSide }),
      MAXAC
    );
    [this.bodyMesh, this.outMesh].forEach(m => {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    });
    this.bodyMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXAC * 16 * 3), 3));
    tg.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(MAXAC * 16), 1));
    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: TR_VS,
      fragmentShader: TR_FS,
      uniforms: { tint: { value: new THREE.Color(1, 1, 1) } },
      transparent: true,
      depthWrite: false
    });
    this.trails = new THREE.LineSegments(tg, this.trailMat);
    this.trails.frustumCulled = false;
    scene.add(this.trails);
    // selection ring, routes, selected-aircraft trail, weather, ghost
    this.selRing = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 26,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        map: this.ringTexture()
      })
    );
    this.selRing.frustumCulled = false;
    scene.add(this.selRing);
    this.routeGroup = new THREE.Group();
    scene.add(this.routeGroup);
    this.trailGroup = new THREE.Group();
    scene.add(this.trailGroup);
    this.wxGroup = new THREE.Group();
    scene.add(this.wxGroup);
    this.wx = [];
    this.ghost = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false
      })
    );
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.ghostLbl = document.createElement('div');
    this.ghostLbl.className = 'g3-ghost hidden';
    canvas.parentElement.appendChild(this.ghostLbl);
    this.raycast = new THREE.Raycaster();
    this.sphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.handleTex = {};
    this.bind();
    this.resize();
  }
  ringTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    c.lineWidth = 5;
    c.strokeStyle = '#fff';
    c.beginPath();
    c.arc(32, 32, 27, 0, TAU);
    c.stroke();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---- sizing / camera
  resize() {
    const r = this.c.getBoundingClientRect();
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.renderer.setSize(this.W, this.H, false);
    this.camera.aspect = this.W / this.H;
    this.camera.updateProjectionMatrix();
    this.trailGroup.children.forEach(
      l =>
        l.material.resolution &&
        l.material.resolution.set(
          this.W * this.renderer.getPixelRatio(),
          this.H * this.renderer.getPixelRatio()
        )
    );
  }
  recenter(instant) {
    const m = this.gs().net.meta,
      b = m.bounds,
      lonSpan = b.lon1 - b.lon0,
      latSpan = b.lat1 - b.lat0;
    const alpha =
      clamp(Math.max(lonSpan * 0.5 * Math.min(1, (this.H / this.W) * 1.5), latSpan * 0.5), 6, 85) * RAD;
    const dist = clamp(Math.cos(alpha) + Math.sin(alpha) / 0.27, 1.45, 3.3);
    this.flyTo(m.centre.lon, (b.lat0 + b.lat1) / 2, dist, instant);
  }
  flyTo(lon, lat, dist, instant) {
    const target = toVec(lon, lat, dist);
    if (instant) {
      this.camera.position.copy(target);
      this.controls.update();
      this.fly = null;
      return;
    }
    this.fly = { from: this.camera.position.clone(), to: target, t0: performance.now(), dur: 900 };
  }

  // ---- interaction
  bind() {
    const c = this.c;
    let down = null;
    c.addEventListener('pointerdown', e => {
      down = { x: e.clientX, y: e.clientY };
      this.fly = null;
    });
    c.addEventListener('pointerup', e => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) this.click(e);
      down = null;
    });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect();
      this.mouse = [e.clientX - r.left, e.clientY - r.top, e.clientX, e.clientY];
      if (down) return;
      const placing = this.hooks.placing && this.hooks.placing();
      const h = placing ? null : this.pick(this.mouse[0], this.mouse[1]);
      this.hover = h;
      c.style.cursor = placing ? 'crosshair' : h ? 'pointer' : 'grab';
      this.hooks.hover && this.hooks.hover(h, e.clientX, e.clientY);
    });
    c.addEventListener('pointerleave', () => {
      this.mouse = null;
      this.hover = null;
      this.hooks.hover && this.hooks.hover(null);
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(c);
  }
  pick(x, y) {
    let best = null,
      bd = 1e9;
    for (const h of this.hit) {
      const d = Math.hypot(h.x - x, h.y - y) - (h.type === 'flight' ? 3 : h.type === 'wx' ? 7 : 0);
      if (d < h.r && d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }
  lonLatAt(x, y) {
    this.raycast.setFromCamera(new THREE.Vector2((x / this.W) * 2 - 1, -(y / this.H) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    return this.raycast.ray.intersectSphere(this.sphere, p) ? toLonLat(p) : null;
  }
  click(e) {
    const r = this.c.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top;
    if (this.hooks.placing && this.hooks.placing()) {
      const ll = this.lonLatAt(x, y);
      if (ll && this.hooks.place) this.hooks.place(ll[0], ll[1]);
      return;
    }
    const h = this.pick(x, y);
    this.hooks.select && this.hooks.select(h || null);
  }
  project(v) {
    const p = v.clone().project(this.camera);
    return [(p.x * 0.5 + 0.5) * this.W, (-p.y * 0.5 + 0.5) * this.H, p.z];
  }
  facing(v) {
    return v.dot(this.camera.position) > 1.0;
  }

  // ---- theme / network / weather / selection sync
  syncTheme(S) {
    const key = DS.themeName + '|' + S.net.meta.id + '|' + DS.mapStyle;
    if (key === this.themeKey) return;
    this.themeKey = key;
    const pal = DS.pal,
      dark = DS.themeName !== 'light';
    if (this.globeMat.uniforms.map.value) this.globeMat.uniforms.map.value.dispose();
    this.globeMat.uniforms.map.value = buildEarthTexture(pal);
    this.globeMat.uniforms.nightColor.value.set(dark ? '#050b18' : '#1d2f55');
    this.globeMat.uniforms.nightAlpha.value = dark ? 0.62 : 0.4;
    this.renderer.setClearColor(dark ? 0x02060c : 0xdfeaf3, 1);
    this.stars.visible = dark;
    this.atmoMat.uniforms.glow.value.set(dark ? '#c9a96e' : '#b9a77e');
    this.atmoMat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.atmoMat.needsUpdate = true;
    this.trailMat.uniforms.tint.value.set(dark ? 0xffffff : 0xffffff);
    this.buildRoutes(S);
  }
  buildRoutes(S) {
    this.routeGroup.children.slice().forEach(o => {
      o.geometry.dispose();
      o.material.dispose();
      this.routeGroup.remove(o);
    });
    const seen = {},
      pos = [],
      n = GCN(),
      AM = S.net.airportMap;
    for (const f of S.net.flights) {
      const k = f.orig + f.dest;
      if (seen[k]) continue;
      seen[k] = 1;
      const arr = DS.gc(AM[f.orig], AM[f.dest]);
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const v = toVec(arr[i * 2], arr[i * 2 + 1], 1 + altAt(arcHeight(arr), i / n));
        if (prev) pos.push(prev.x, prev.y, prev.z, v.x, v.y, v.z);
        prev = v;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const dark = DS.themeName !== 'light',
      lines = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({
          color: dark ? 0x86b4ff : 0x1c4f96,
          transparent: true,
          opacity: dark ? 0.28 : 0.32,
          depthWrite: false
        })
      );
    lines.frustumCulled = false;
    this.routeGroup.add(lines);
  }
  syncWeather(S) {
    const key =
      JSON.stringify(
        S.weather.map(e => [
          e.id,
          e.type,
          +e.lat.toFixed(3),
          +e.lon.toFixed(3),
          e.radius,
          e.start,
          e.dur,
          e.severity
        ])
      ) +
      '|' +
      S.selEv;
    if (key === this.wxKey) return;
    this.wxKey = key;
    this.wx.forEach(w => {
      w.group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.wxGroup.remove(w.group);
    });
    this.wx = [];
    S.weather.forEach(e => {
      const meta = DS.WXT[e.type] || DS.WXT.Thunderstorm,
        rU = Math.max(0.012, e.radius / EARTH_KM),
        h =
          {
            Thunderstorm: 0.07,
            Cyclone: 0.085,
            'Dust storm': 0.04,
            Snowstorm: 0.03,
            Fog: 0.012,
            'Volcanic ash': 0.11
          }[e.type] || 0.022;
      const group = new THREE.Group(),
        n = toVec(e.lon, e.lat, 1),
        col = rgb(meta.c),
        core = rgb(meta.core);
      group.position.copy(n);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize());
      const colGeo = new THREE.CylinderGeometry(rU, rU * 1.1, h, 56, 1, true).translate(0, h / 2, 0);
      const column = new THREE.Mesh(
        colGeo,
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      group.add(column);
      const cap = new THREE.Mesh(
        new THREE.CircleGeometry(rU, 56).rotateX(-Math.PI / 2).translate(0, h, 0),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      group.add(cap);
      const disc = new THREE.Mesh(
        new THREE.PlaneGeometry(rU * 2.5, rU * 2.5).rotateX(-Math.PI / 2).translate(0, 0.0012, 0),
        new THREE.MeshBasicMaterial({ map: radialTexture(meta.c), transparent: true, depthWrite: false })
      );
      group.add(disc);
      const core3 = new THREE.Mesh(
        new THREE.CylinderGeometry(rU * 0.35, rU * 0.5, h * 0.9, 32, 1, true).translate(0, h * 0.45, 0),
        new THREE.MeshBasicMaterial({
          color: core,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      group.add(core3);
      const ringPts = [];
      for (let i = 0; i <= 96; i++)
        ringPts.push(
          new THREE.Vector3(Math.cos((i / 96) * TAU) * rU * 0.92, 0.002, Math.sin((i / 96) * TAU) * rU * 0.92)
        );
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(ringPts.slice(0, 96)),
        new THREE.LineDashedMaterial({
          color: col,
          dashSize: rU * 0.1,
          gapSize: rU * 0.07,
          transparent: true,
          opacity: 0.9,
          depthWrite: false
        })
      );
      ring.computeLineDistances();
      group.add(ring);
      let arms = null;
      if (e.type === 'Cyclone') {
        arms = new THREE.Group();
        for (let a = 0; a < 3; a++) {
          const pts = [];
          for (let k = 0; k < 48; k++) {
            const th = a * 2.094 + k * 0.17,
              r = (k / 48) * rU * 0.95;
            pts.push(new THREE.Vector3(Math.cos(th) * r, h * 0.55, Math.sin(th) * r));
          }
          arms.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(pts),
              new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false })
            )
          );
        }
        group.add(arms);
      }
      let bolt = null;
      if (e.type === 'Thunderstorm') {
        bolt = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, h, 0),
            new THREE.Vector3(rU * 0.1, h * 0.65, rU * 0.05),
            new THREE.Vector3(-rU * 0.05, h * 0.5, 0),
            new THREE.Vector3(rU * 0.08, h * 0.05, -rU * 0.03)
          ]),
          new THREE.LineBasicMaterial({ color: 0xffffe6, transparent: true, opacity: 0, depthWrite: false })
        );
        group.add(bolt);
      }
      if (!this.handleTex[e.type]) this.handleTex[e.type] = handleTexture(meta);
      const handle = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.handleTex[e.type], sizeAttenuation: false, depthWrite: false })
      );
      handle.scale.set(0.06, 0.06, 1);
      handle.position.set(0, h + 0.03, 0);
      group.add(handle);
      this.wxGroup.add(group);
      this.wx.push({
        e,
        meta,
        group,
        column,
        cap,
        disc,
        core3,
        ring,
        arms,
        bolt,
        handle,
        h,
        selected: S.selEv === e.id
      });
    });
  }
  syncTrail(S) {
    const res = S.res.plan,
      selF = S.sel.flight != null ? res.flights[S.sel.flight] : null,
      tail = S.sel.tail || (selF && selF.tail);
    const key = [tail, S.sel.flight, Math.floor(S.now / 5), S.colorMode, S.net.meta.id, DS.themeName].join(
      '|'
    );
    if (key === this.selKey) return;
    this.selKey = key;
    this.trailGroup.children.slice().forEach(o => {
      o.geometry.dispose();
      o.material.dispose();
      this.trailGroup.remove(o);
    });
    if (!tail || !res.tails[tail]) return;
    const AM = S.net.airportMap,
      n = GCN(),
      dpr = this.renderer.getPixelRatio();
    res.tails[tail].chain.forEach(id => {
      const f = res.flights[id],
        arr = DS.gc(AM[f.orig], AM[f.dest]),
        pos = [];
      for (let i = 0; i <= n; i++) {
        const v = toVec(arr[i * 2], arr[i * 2 + 1], 1.001 + altAt(arcHeight(arr), i / n));
        pos.push(v.x, v.y, v.z);
      }
      const geo = new LineGeometry();
      geo.setPositions(pos);
      const cancelled = f.status === 'cancelled',
        d = cancelled ? 0 : f.aarr - f.sta,
        color = cancelled
          ? 0x94a3b8
          : hex(S.colorMode === 'gen' ? DS.colGen(f.gen) : DS.colDelay(d)).getHex();
      const mat = new LineMaterial({
        color,
        linewidth: (id === S.sel.flight ? 3.6 : 2.4) * dpr,
        transparent: true,
        opacity: 0.95,
        dashed: cancelled || f.adep > S.now,
        dashSize: 0.025,
        gapSize: 0.018,
        depthWrite: false
      });
      mat.resolution.set(this.W * dpr, this.H * dpr);
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.frustumCulled = false;
      this.trailGroup.add(line);
    });
  }

  // ---- one frame
  draw(tReal, mapView) {
    const S = this.gs(),
      net = S.net,
      now = S.now,
      res = S.res.plan,
      AM = net.airportMap,
      cam = this.camera,
      pal = DS.pal,
      dark = DS.themeName !== 'light';
    this.syncTheme(S);
    this.syncWeather(S);
    this.syncTrail(S);
    // camera animation
    if (this.fly) {
      const k = clamp((performance.now() - this.fly.t0) / this.fly.dur, 0, 1),
        e = k * k * (3 - 2 * k),
        a = this.fly.from.clone().normalize(),
        b = this.fly.to.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(a, b);
      const cur = a
        .clone()
        .applyQuaternion(new THREE.Quaternion().slerp(q, e))
        .multiplyScalar(this.fly.from.length() + (this.fly.to.length() - this.fly.from.length()) * e);
      cam.position.copy(cur);
      if (k >= 1) this.fly = null;
    }
    const dist = cam.position.length();
    this.controls.rotateSpeed = clamp(0.12 + (dist - 1.12) * 0.28, 0.1, 0.9);
    this.controls.update();
    this.globeMat.uniforms.camPos.value.copy(cam.position);
    // sun
    const utc = now - net.meta.tz,
      lonSub = -15 * (utc / 60 - 12);
    toVec(lonSub, DEC / RAD, 1, this.globeMat.uniforms.sunDir.value);
    this.hit = [];

    // airport stats (same definition as the 2D map; the UI reads map.st for tooltips and cards)
    const st = {};
    net.airports.forEach(a => (st[a.code] = { wait: 0, n: 0, sum: 0, gen: 0, inbound: 0 }));
    for (const f of res.flights) {
      if (f.status !== 'ok') continue;
      const o = st[f.orig];
      if (f.std <= now && f.adep > now) o.wait++;
      if (f.std <= now && f.std >= now - 180) {
        const d = f.adep <= now ? f.adep - f.std : now - f.std;
        o.n++;
        o.sum += Math.max(0, d);
        if (f.gen >= 1 && d > 15) o.gen++;
      }
      if (f.eta <= now && f.aarr > now) st[f.dest].inbound++;
    }
    if (mapView) mapView.st = st;
    this.st = st;

    // airports
    if (this.apNet !== net.meta.id + net.airports.length) {
      this.apNet = net.meta.id + net.airports.length;
      if (this.apPoints) {
        this.scene.remove(this.apPoints);
        this.apPoints.geometry.dispose();
      }
      const n = net.airports.length,
        g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aOut', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
      net.airports.forEach((a, i) => {
        const v = toVec(a.lon, a.lat, 1.003);
        g.attributes.position.setXYZ(i, v.x, v.y, v.z);
        g.attributes.aSize.setX(i, a.hub ? 15 : 11);
      });
      this.apPoints = new THREE.Points(g, this.apMat);
      this.apPoints.frustumCulled = false;
      this.scene.add(this.apPoints);
      this.lblPool.forEach(d => d.remove());
      this.lblPool = net.airports.map(() => {
        const d = document.createElement('div');
        d.className = 'g3-lbl';
        this.labels.appendChild(d);
        return d;
      });
      this.apPos = net.airports.map(a => toVec(a.lon, a.lat, 1.003));
    }
    const colG = this.apPoints.geometry.attributes.aColor,
      outG = this.apPoints.geometry.attributes.aOut,
      tmp = new THREE.Color(),
      ringCol = hex(pal.apRing);
    net.airports.forEach((a, i) => {
      const s = st[a.code],
        avg = s.n ? s.sum / s.n : 0,
        fac = DS.wxFactor(S.weather, a.code, now);
      const col =
        S.colorMode === 'gen'
          ? s.gen >= 2
            ? DS.GENCOL[1]
            : s.gen
              ? DS.GENCOL[2]
              : '#34d399'
          : DS.colDelay(avg);
      tmp.set(fac === 0 ? '#3a0f14' : col);
      colG.setXYZ(i, tmp.r, tmp.g, tmp.b);
      const o = fac === 0 ? hex('#ef4444') : fac < 1 ? hex('#fbbf24') : avg > 15 ? hex(col) : ringCol;
      outG.setXYZ(i, o.r, o.g, o.b);
      const v = this.apPos[i],
        vis = this.facing(v),
        sel = S.sel.airport === a.code;
      const lbl = this.lblPool[i],
        showLbl = vis && (sel || fac < 1 || (dist < 2.35 && (a.hub || dist < 1.8)));
      if (showLbl) {
        const [x, y] = this.project(v);
        lbl.style.transform = `translate(${x.toFixed(1)}px,${(y + 9).toFixed(1)}px) translateX(-50%)`;
        lbl.textContent = dist < 1.7 ? a.code + ' · ' + a.city : a.code;
        lbl.style.display = 'block';
        lbl.classList.toggle('sel', sel);
        lbl.classList.toggle('bad', fac === 0);
      } else lbl.style.display = 'none';
      if (vis) {
        const [x, y] = this.project(v);
        this.hit.push({ type: 'airport', code: a.code, x, y, r: 12 });
      }
    });
    colG.needsUpdate = outG.needsUpdate = true;

    // aircraft
    const selF = S.sel.flight != null ? res.flights[S.sel.flight] : null,
      selTail = S.sel.tail || (selF && selF.tail);
    const k = clamp(0.00082 * dist, 0.0009, 0.004),
      m4 = new THREE.Matrix4(),
      pos = new THREE.Vector3(),
      nrm = new THREE.Vector3(),
      fwd = new THREE.Vector3(),
      rgt = new THREE.Vector3(),
      p2 = new THREE.Vector3(),
      col = new THREE.Color();
    const tp = this.trails.geometry.attributes.position,
      ta = this.trails.geometry.attributes.aAlpha;
    let ac = 0,
      tv = 0,
      selPos = null;
    const E = new THREE.Vector3(),
      N = new THREE.Vector3(),
      S3 = new THREE.Vector3(),
      prevV = new THREE.Vector3(),
      curV = new THREE.Vector3();
    for (const f of res.flights) {
      if (ac >= this.maxAc) break;
      if (f.status !== 'ok' || f.adep > now) continue;
      const ph = DS.flightPhase(net, f, now);
      if (ph.ph === 'landed' || ph.ph === 'cancelled' || ph.ph === 'waiting' || ph.ph === 'scheduled')
        continue;
      let arr = null,
        p = 0;
      if (ph.ph === 'air' || ph.ph === 'divert' || ph.ph === 'ferry') {
        arr = DS.gc(AM[ph.a], AM[ph.b]);
        p = clamp(ph.p, 0, 1);
        const q = Math.min(0.985, p);
        arcPoint(arr, p, pos);
        arcPoint(arr, q, p2);
        arcPoint(arr, q + 0.015, fwd);
        fwd.sub(p2);
      } else {
        const a = AM[ph.at];
        toVec(a.lon, a.lat, 1.012, pos);
        nrm.copy(pos).normalize();
        E.set(0, 1, 0).cross(nrm).normalize();
        N.copy(nrm).cross(E);
        if (ph.ph === 'hold') {
          const th = now * 0.09 + f.id;
          pos.addScaledVector(E, Math.cos(th) * 0.014).addScaledVector(N, Math.sin(th) * 0.014);
          fwd.copy(E).multiplyScalar(-Math.sin(th)).addScaledVector(N, Math.cos(th));
        } else {
          pos.addScaledVector(E, 0.012);
          fwd.copy(N);
        }
      }
      nrm.copy(pos).normalize();
      fwd.addScaledVector(nrm, -fwd.dot(nrm));
      if (fwd.lengthSq() < 1e-14) fwd.set(0, 1, 0).cross(nrm);
      fwd.normalize();
      rgt.copy(fwd).cross(nrm).normalize();
      const dd = Math.max(0, now >= f.aarr ? f.aarr - f.sta : Math.max(f.adep - f.std, 0)),
        isSel = S.sel.flight === f.id || (selTail && f.tail === selTail),
        sc = k * (isSel ? 1.35 : 1);
      m4.makeBasis(rgt, fwd, nrm)
        .scale(S3.set(sc, sc, sc))
        .setPosition(pos);
      this.bodyMesh.setMatrixAt(ac, m4);
      m4.scale(S3.set(1.28, 1.28, 1)).setPosition(N.copy(pos).addScaledVector(nrm, -0.0004));
      this.outMesh.setMatrixAt(ac, m4);
      col.set(S.colorMode === 'gen' ? DS.colGen(f.gen) : DS.colDelay(dd));
      this.bodyMesh.setColorAt(ac, col);
      if (arr && p > 0.02) {
        // contrail: fades over the last 7% of the route
        let have = false;
        for (let j = 0; j <= 8; j++) {
          arcPoint(arr, Math.max(0, p - (0.07 * j) / 8), curV);
          if (have) {
            tp.setXYZ(tv, prevV.x, prevV.y, prevV.z);
            ta.setX(tv, 1 - (j - 1) / 8);
            tv++;
            tp.setXYZ(tv, curV.x, curV.y, curV.z);
            ta.setX(tv, 1 - j / 8);
            tv++;
          }
          prevV.copy(curV);
          have = true;
        }
      }
      if (this.facing(pos)) {
        const [x, y] = this.project(pos);
        this.hit.push({ type: 'flight', id: f.id, x, y, r: 13 });
      }
      if (S.sel.flight === f.id) selPos = pos.clone();
      ac++;
    }
    this.bodyMesh.count = this.outMesh.count = ac;
    this.bodyMesh.instanceMatrix.needsUpdate = this.outMesh.instanceMatrix.needsUpdate = true;
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;
    this.trails.geometry.setDrawRange(0, tv);
    tp.needsUpdate = ta.needsUpdate = true;
    if (selPos) {
      const a = this.selRing.geometry.attributes.position;
      a.setXYZ(0, selPos.x, selPos.y, selPos.z);
      a.needsUpdate = true;
      this.selRing.material.opacity = 1;
      this.selRing.material.color.set(dark ? 0xffffff : 0x10263a);
    } else this.selRing.material.opacity = 0;

    // weather animation + handles
    this.wx.forEach(w => {
      const e = w.e,
        end = e.start + e.dur,
        live = now >= e.start - 180 && now <= end + 40,
        forecast = now < e.start,
        fade = now > end ? clamp(1 - (now - end) / 40, 0, 1) : 1,
        T = tReal / 1000;
      const on = live && !forecast,
        wob = 0.5 + 0.5 * Math.sin(T * 2.2 + e.id);
      w.column.visible = w.cap.visible = w.core3.visible = on;
      w.disc.visible = live;
      w.ring.visible = live;
      w.column.material.opacity = (0.14 + 0.1 * e.severity + 0.05 * wob) * fade;
      w.cap.material.opacity = 0.12 * fade;
      w.core3.material.opacity = (0.14 + 0.16 * e.severity) * fade;
      w.disc.material.opacity = (forecast ? 0.5 : 0.95) * fade;
      w.ring.material.opacity = (forecast ? 0.5 + 0.4 * wob : 0.85) * fade;
      if (w.arms) {
        w.arms.rotation.y = T * 0.9;
        w.arms.visible = on;
      }
      if (w.bolt) {
        const kk = Math.floor(T * 6);
        w.bolt.material.opacity = on && ((kk * 2654435761) >>> 0) % 7 === 0 ? 0.95 : 0;
        w.bolt.rotation.y = kk * 1.3;
      }
      w.handle.material.opacity = live ? 1 : 0.55;
      w.handle.scale.setScalar(w.selected ? 0.075 : 0.06);
      const hp = toVec(e.lon, e.lat, 1 + w.h + 0.03);
      if (this.facing(hp)) {
        const [x, y] = this.project(hp);
        this.hit.push({ type: 'wx', id: e.id, x, y, r: 15 });
      }
    });

    // placement ghost
    if (S.placing && this.mouse) {
      const ll = this.lonLatAt(this.mouse[0], this.mouse[1]),
        meta = DS.WXT[S.placing];
      if (ll) {
        const n = toVec(ll[0], ll[1], 1.004),
          rU = meta.radius / EARTH_KM;
        this.ghost.visible = true;
        this.ghost.position.copy(n);
        this.ghost.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize());
        this.ghost.scale.setScalar(rU);
        this.ghost.material.color.copy(rgb(meta.c));
        this.ghostLbl.classList.remove('hidden');
        this.ghostLbl.textContent = meta.icon + ' ' + S.placing + ' — click the globe to plant';
        this.ghostLbl.style.transform = `translate(${this.mouse[0] + 14}px,${this.mouse[1] + 16}px)`;
      } else {
        this.ghost.visible = false;
        this.ghostLbl.classList.add('hidden');
      }
    } else {
      this.ghost.visible = false;
      this.ghostLbl.classList.add('hidden');
    }

    this.renderer.render(this.scene, cam);
  }
  setVisible(v) {
    this.labels.style.display = v ? '' : 'none';
    if (!v) this.ghostLbl.classList.add('hidden');
  }
}

DS.Globe3D = Globe3D;
DS.webglAvailable = () => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) {
    return false;
  }
};
