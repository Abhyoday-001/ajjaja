// Assembles the deployable site into dist/. No dependencies — only Node's standard library.
// Everything the browser needs is plain files; nothing here compiles or bundles.
// Usage: node scripts/build-static.js
const fs = require('fs'),
  path = require('path');
const root = path.resolve(__dirname, '..'),
  out = path.join(root, 'dist');
const include = ['index.html', 'css', 'js', 'vendor', 'data', 'assets']; // anything not listed (tests, serve.js, node_modules, .claude) stays out

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let files = 0,
  bytes = 0;
const copy = (from, to) => {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(n => {
      if (!n.startsWith('.')) copy(path.join(from, n), path.join(to, n));
    });
  } else {
    fs.copyFileSync(from, to);
    files++;
    bytes += st.size;
  }
};
include.forEach(n => {
  const src = path.join(root, n);
  if (fs.existsSync(src)) copy(src, path.join(out, n));
  else console.warn('skipped (missing): ' + n);
});

// sanity checks so a broken deploy is caught at build time, not by a visitor
const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const refs = [...index.matchAll(/(?:src|href)="((?:js|css|vendor|data)\/[^"]+)"/g)].map(m => m[1]);
const missing = refs.filter(r => !fs.existsSync(path.join(out, r)));
if (missing.length) {
  console.error('index.html references files that are not in dist/: ' + missing.join(', '));
  process.exit(1);
}
if (!fs.existsSync(path.join(out, 'vendor', 'globe3d.js')))
  console.warn(
    'vendor/globe3d.js is missing — the 3D view will fall back to 2D. Run: npm i && npm run build:3d'
  );
console.log(
  'dist/ ready: ' +
    files +
    ' files, ' +
    (bytes / 1048576).toFixed(2) +
    ' MB (' +
    refs.length +
    ' asset references checked)'
);
