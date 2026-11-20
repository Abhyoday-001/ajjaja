// Security tests — run: node test/security.test.js
// Covers: hostile import files, size caps, where the API key can travel, and a static scan for dangerous patterns.
const assert = require('assert'), fs = require('fs'), path = require('path');
const DS = require('../js/data.js'); require('../js/engine.js'); require('../js/import.js'); require('../js/validate.js'); require('../js/dispatcher.js');
const root = path.join(__dirname, '..');
let n = 0; const ok = (cond, msg) => { assert(cond, msg); n++; };
const importCsv = csv => { const r = DS.networkFromSchedule(DS.parseTable(csv)); DS.validateNetwork(r.net); return r; };

// 1. hostile identifiers never reach the page
const head = 'flight,tail,origin,destination,std,sta\n';
const hostile = [
  ['flight number', '<img src=x onerror=alert(1)>,VT-A,DEL,BOM,06:00,08:00'],
  ['flight number', '"><script>alert(1)</script>,VT-A,DEL,BOM,06:00,08:00'],
  ['tail', 'AI1,VT-A"onmouseover="x,DEL,BOM,06:00,08:00'],
  ['flight number', "AI1';alert(1);//,VT-A,DEL,BOM,06:00,08:00"],
  ['flight number', 'javascript:alert(1)//,VT-A,DEL,BOM,06:00,08:00']
];
hostile.forEach(([what, row]) => { let err = null; try { importCsv(head + row + '\n'); } catch (e) { err = e; } assert(err, what + ' must be rejected: ' + row); assert(!/[<>]/.test(err.message), 'error text must not echo raw markup'); });
n += hostile.length;
// hostile names in a JSON airport list
const jsonEvil = JSON.stringify({ airports: [{ code: 'AAA', lat: 10, lon: 20, city: '<b>x</b>', name: 'A' }, { code: 'BBB', lat: 12, lon: 25 }], flights: [{ flight: 'T1', origin: 'AAA', destination: 'BBB', std: '08:00', sta: '09:30' }] });
assert.throws(() => importCsv(jsonEvil), /Import rejected/); n++;
// messages echo only a neutralised snippet
try { importCsv(head + '<script>x</script>,VT-A,DEL,BOM,06:00,08:00\n'); } catch (e) { ok(!/[<>]/.test(e.message), 'error text must not contain raw markup'); }
// legitimate data still passes
ok(importCsv(head + 'AI 101,VT-A,DEL,BOM,06:00,08:00\nAI-102/x,VT-A,BOM,DEL,09:00,11:00\n').report.imported === 2, 'normal identifiers accepted');
ok(DS.validateNetwork(DS.buildNetwork('dataset')) && DS.validateNetwork(DS.buildNetwork('world')) && DS.validateNetwork(DS.buildNetwork('india')), 'built-in networks validate');
// 2. size caps
let big = head; for (let i = 0; i < DS.IMPORT_LIMITS.flights + 5; i++) big += 'F' + i + ',T' + i + ',DEL,BOM,06:00,08:00\n';
assert.throws(() => importCsv(big), /more than the/); n++;

// 3. the API key travels to exactly one host, in a header, never in the body
(async () => {
  const calls = []; const realFetch = global.fetch;
  global.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }) }; };
  const c = DS.Dispatcher.fetchClient('sk-ant-TESTKEY');
  await c.beta.messages.create({ model: 'claude-opus-5-5', max_tokens: 10, messages: [], betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  const call = calls[0];
  ok(call.url === 'https://api.anthropic.com/v1/messages', 'only api.anthropic.com is contacted');
  ok(call.init.headers['x-api-key'] === 'sk-ant-TESTKEY', 'key sent as header');
  ok(!call.init.body.includes('TESTKEY'), 'key never appears in the request body');
  ok(call.init.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01' && !('betas' in JSON.parse(call.init.body)), 'betas travel as a header, not in the body');
  ok(call.init.credentials === 'omit' && call.init.referrerPolicy === 'no-referrer', 'no cookies, no referrer');
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) });
  await assert.rejects(() => c.messages.create({ model: 'm', max_tokens: 1, messages: [] }), /invalid x-api-key/); n++;
  global.fetch = realFetch;

  // 4. static scan: no eval, no document.write, no third-party scripts, no remote hosts except the API
  const files = ['js/data.js', 'js/engine.js', 'js/import.js', 'js/validate.js', 'js/dispatcher.js', 'js/map.js', 'js/ui.js', 'js/ui-extra.js', 'index.html'].map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]);
  files.forEach(([f, src]) => {
    ok(!/\beval\s*\(/.test(src) && !/new Function\s*\(/.test(src) && !/document\.write\s*\(/.test(src), f + ': no eval / new Function / document.write');
    const remote = (src.match(/https?:\/\/[^\s'"`)<>]+/g) || []).filter(u => !/^https?:\/\/(api\.anthropic\.com|www\.w3\.org|platform\.claude\.com)/.test(u));
    ok(remote.length === 0, f + ': no remote hosts other than the Anthropic API (found ' + remote.join(', ') + ')');
  });
  const html = files.find(f => f[0] === 'index.html')[1];
  ok(/Content-Security-Policy/.test(html) && !/script-src[^;]*unsafe-(eval|inline)/.test(html), 'CSP present and scripts may not be inline or eval');
  ok(/connect-src 'self' https:\/\/api\.anthropic\.com/.test(html), 'network access limited to self + the Anthropic API');
  ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'no inline <script> blocks');
  ok(!/\son\w+\s*=/.test(html), 'no inline event-handler attributes');
  console.log('security OK — ' + n + ' checks');
})().catch(e => { console.error(e); process.exit(1); });
