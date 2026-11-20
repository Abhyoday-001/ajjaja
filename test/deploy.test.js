// Deploy, 3D and wiring tests — run: node test/deploy.test.js
// These catch the problems the simulation tests cannot see: a page that points at a file that is not there, a stale dist/,
// a 3D globe that lost its terrain, a cache rule that keeps an old bundle alive after a redeploy, and a button with no handler.
const assert = require('assert'),
  fs = require('fs'),
  path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8'),
  exists = f => fs.existsSync(path.join(root, f));
let n = 0;
const ok = (cond, msg) => {
  assert(cond, msg);
  n++;
};

// 1. every file the page loads is really there
const html = read('index.html');
const refs = [...html.matchAll(/(?:src|href)="([^"#?]+)(?:\?[^"]*)?"/g)]
  .map(m => m[1])
  .filter(r => !/^(https?:|data:|mailto:)/.test(r));
refs.forEach(r => ok(exists(r), 'index.html points at a missing file: ' + r));
// ...and nothing in js/ is dead weight: every script is loaded by the page (or is the lazy 3D loader's partner)
fs.readdirSync(path.join(root, 'js'))
  .filter(f => f.endsWith('.js'))
  .forEach(f => ok(html.includes('js/' + f), 'js/' + f + ' is not loaded by index.html (orphan file)'));

// 2. the committed dist/ is exactly what a build of the source would produce
['index.html', 'css', 'js', 'vendor', 'data', 'assets'].forEach(item => {
  const walk = rel => {
    const abs = path.join(root, rel),
      st = fs.statSync(abs);
    if (st.isDirectory()) {
      fs.readdirSync(abs)
        .filter(x => !x.startsWith('.'))
        .forEach(x => walk(rel + '/' + x));
      return;
    }
    ok(exists('dist/' + rel), 'dist/ is missing ' + rel + ' — run: npm run build');
    ok(
      fs.readFileSync(abs).equals(fs.readFileSync(path.join(root, 'dist', rel))),
      'dist/' + rel + ' is out of date — run: npm run build'
    );
  };
  walk(item);
});

// 3. the 3D globe paints the terrain, in the shipped bundle and in its source
const bundle = read('vendor/globe3d.js'),
  src = read('src3d/globe3d.js');
ok(
  /gx\.terr/.test(bundle) && /drawImage\(TI/.test(bundle),
  'vendor/globe3d.js no longer draws the terrain image'
);
ok(
  /terrainImage/.test(src) && /drawImage\(TI/.test(src),
  'src3d/globe3d.js no longer draws the terrain image (a rebuild would lose the terrain)'
);
ok(
  /\.mapStyle/.test(bundle) && /DS\.mapStyle/.test(src),
  'the globe must follow the Terrain / Minimal switch'
);
ok(!/#4cc9f0/.test(bundle) && !/#4cc9f0/.test(src), 'the old cyan glow came back');
const map = read('js/map.js');
const terrainImgs = [...map.matchAll(/img:\s*'([^']+)'/g)].map(m => m[1]);
ok(terrainImgs.length >= 2, 'both themes need a terrain image');
terrainImgs.forEach(img => {
  ok(exists(img), 'terrain image missing: ' + img);
  const head = fs.readFileSync(path.join(root, img)).subarray(0, 3);
  ok(head[0] === 0xff && head[1] === 0xd8, img + ' is not a JPEG');
  ok(fs.statSync(path.join(root, img)).size > 100000, img + ' looks truncated');
});
// the loader asks for a versioned URL, so a new bundle is never hidden behind an old cached one
ok(
  /vendor\/globe3d\.js\?v=\d+/.test(read('js/view3d.js')),
  'view3d.js must load vendor/globe3d.js with a ?v=N version'
);

// the globe can be driven without a mouse: focusable canvas, arrow keys rotate, +/- zoom, Home re-centres, visible focus ring
const v3 = read('js/view3d.js');
ok(
  /cv\.tabIndex\s*=\s*0/.test(v3) &&
    /ArrowLeft/.test(v3) &&
    /ArrowUp/.test(v3) &&
    /'Home'/.test(v3) &&
    /key === '\+'/.test(v3),
  'view3d.js lost its keyboard controls for the globe'
);
ok(/#globe:focus-visible/.test(read('css/view3d.css')), 'the focused globe needs a visible focus ring');

// 4. hosting config: the bundle is revalidated, the site is published from dist/, security headers are on
const netlify = read('netlify.toml'),
  vercel = JSON.parse(read('vercel.json'));
ok(
  /publish\s*=\s*"dist"/.test(netlify) && vercel.outputDirectory === 'dist',
  'both hosts must publish dist/'
);
const nVendor = netlify.split('[[headers]]').find(b => /for\s*=\s*"\/vendor\/\*"/.test(b)) || '';
ok(
  /must-revalidate/.test(nVendor) && /max-age=0/.test(nVendor),
  'netlify.toml: /vendor/* must be revalidated, or a redeploy keeps serving the old globe'
);
const vVendor = (vercel.headers.find(h => h.source === '/vendor/(.*)') || { headers: [{ value: '' }] })
  .headers[0].value;
ok(/must-revalidate/.test(vVendor) && /max-age=0/.test(vVendor), 'vercel.json: /vendor must be revalidated');
ok(
  /X-Content-Type-Options/.test(netlify) && JSON.stringify(vercel).includes('nosniff'),
  'security headers must stay on'
);

// 5. no dead buttons: every data-act the app can render has a handler
const uiFiles = fs.readdirSync(path.join(root, 'js')).filter(f => /^(ui|tracker)(-[a-z]+)?\.js$/.test(f));
const code = uiFiles.map(f => read('js/' + f)).join('\n');
const acts = new Set([...(html + '\n' + code).matchAll(/data-act="([A-Za-z0-9_]+)"/g)].map(m => m[1]));
ok(acts.size >= 25, "expected to find the app's actions, found " + acts.size);
acts.forEach(a =>
  ok(
    new RegExp("case '" + a + "'|actions\\." + a + '\\b|\\b' + a + '\\s*[:,(]').test(code),
    'data-act="' + a + '" has no handler'
  )
);

// 6. the only network endpoint is the optional Claude API call
const hosts = new Set();
fs.readdirSync(path.join(root, 'js'))
  .filter(f => f.endsWith('.js') && !/^(world-topo|dataset)\.js$/.test(f))
  .forEach(f => {
    [...read('js/' + f).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].forEach(m => hosts.add(m[1]));
  });
[...hosts]
  .filter(h => !/^(www\.w3\.org|api\.anthropic\.com|claude\.ai|console\.anthropic\.com|localhost)$/.test(h))
  .forEach(h => ok(false, 'unexpected external host in the code: ' + h));
n++;

console.log(
  'deploy & wiring OK — ' + n + ' checks (' + refs.length + ' page references, ' + acts.size + ' actions)'
);
