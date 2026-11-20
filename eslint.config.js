// ESLint (flat config). Run: npm run lint
const js = require('@eslint/js'), globals = require('globals');

const rules = {
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'eqeqeq': ['warn', 'smart'],
  'no-var': 'warn',
  'prefer-const': 'off'
};

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'vendor/**', 'js/world-topo.js', 'js/dataset.js', '.claude/**'] },
  js.configs.recommended,
  // the app: plain scripts loaded by the page (they also load under Node so the tests can run them)
  { files: ['js/**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, module: 'writable', require: 'readonly', DS: 'readonly' } }, rules },
  // the 3D source is an ES module bundled by esbuild
  { files: ['src3d/**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } }, rules },
  // tests, build and dev server run in Node
  { files: ['test/**/*.js', 'scripts/**/*.js', 'serve.js', 'eslint.config.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } }, rules }
];
