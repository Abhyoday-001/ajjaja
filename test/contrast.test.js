// Accessibility: WCAG 2.x AA contrast audit of every colour token pair in css/style.css, both themes. Run: node test/contrast.test.js
const fs = require('fs');
const css = fs.readFileSync(require('path').join(__dirname, '../css/style.css'), 'utf8');
function block(open) {                      // text between `open {` and its closing brace
  const i = css.indexOf(open + '{'); if (i < 0) return {};
  const j = css.indexOf('}', i), o = {};
  css.slice(i + open.length + 1, j).split(';').forEach(p => { const k = p.indexOf(':'); if (k > 0) { const key = p.slice(0, k).trim(); if (key.startsWith('--')) o[key] = p.slice(k + 1).trim(); } });
  return o;
}
const dark = block(':root'), light = Object.assign({}, dark, block(':root[data-theme=light]'));
const lum = h => { const c = h.replace('#', ''), f = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [['--text', '--panel'], ['--text', '--panel2'], ['--muted', '--panel'], ['--muted', '--panel2'], ['--dim', '--panel'], ['--dim', '--panel2'], ['--info', '--panel'], ['--ok', '--panel'], ['--warn', '--panel'], ['--orange', '--panel'], ['--bad', '--panel'], ['--violet', '--panel'], ['--tag-fg', '--tag-bg'], ['--ok-fg', '--ok-bg'], ['--warn-fg', '--warn-bg'], ['--orange-fg', '--orange-bg'], ['--bad-fg', '--bad-bg'], ['--cancel-fg', '--cancel-bg'], ['--info-fg', '--info-bg'], ['--violet-fg', '--violet-bg'], ['--cost-fg', '--cost-bg']];
let fails = 0;
for (const [name, t] of [['DARK', dark], ['LIGHT', light]]) {
  console.log('== ' + name);
  pairs.forEach(([a, b]) => { if (!/^#/.test(t[a] || '') || !/^#/.test(t[b] || '')) return; const r = ratio(t[a], t[b]); if (r < 4.5) fails++; console.log((r < 4.5 ? 'FAIL ' : 'ok   ') + r.toFixed(2).padStart(5) + '  ' + a + ' on ' + b + '  (' + t[a] + ' / ' + t[b] + ')'); });
}
console.log('\nfailures: ' + fails);
process.exit(fails ? 1 : 0);
