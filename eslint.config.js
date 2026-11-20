// ESLint (flat config) with no dependencies of its own: run it on demand with  npm run lint  (it uses npx, nothing is added to package.json).
// The rule list is ESLint's own "recommended" set, written out so this file does not need any package to be installed.
const recommended = {
  'constructor-super': 'error',
  'for-direction': 'error',
  'getter-return': 'error',
  'no-async-promise-executor': 'error',
  'no-case-declarations': 'error',
  'no-class-assign': 'error',
  'no-compare-neg-zero': 'error',
  'no-cond-assign': 'error',
  'no-const-assign': 'error',
  'no-constant-binary-expression': 'error',
  'no-constant-condition': 'error',
  'no-control-regex': 'error',
  'no-debugger': 'error',
  'no-delete-var': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-empty': 'error',
  'no-empty-character-class': 'error',
  'no-empty-pattern': 'error',
  'no-empty-static-block': 'error',
  'no-ex-assign': 'error',
  'no-extra-boolean-cast': 'error',
  'no-fallthrough': 'error',
  'no-func-assign': 'error',
  'no-global-assign': 'error',
  'no-import-assign': 'error',
  'no-invalid-regexp': 'error',
  'no-irregular-whitespace': 'error',
  'no-loss-of-precision': 'error',
  'no-misleading-character-class': 'error',
  'no-new-native-nonconstructor': 'error',
  'no-nonoctal-decimal-escape': 'error',
  'no-obj-calls': 'error',
  'no-octal': 'error',
  'no-prototype-builtins': 'error',
  'no-redeclare': 'error',
  'no-regex-spaces': 'error',
  'no-self-assign': 'error',
  'no-setter-return': 'error',
  'no-shadow-restricted-names': 'error',
  'no-sparse-arrays': 'error',
  'no-this-before-super': 'error',
  'no-unassigned-vars': 'error',
  'no-undef': 'error',
  'no-unexpected-multiline': 'error',
  'no-unreachable': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-unused-labels': 'error',
  'no-unused-private-class-members': 'error',
  'no-unused-vars': 'error',
  'no-useless-assignment': 'error',
  'no-useless-backreference': 'error',
  'no-useless-catch': 'error',
  'no-useless-escape': 'error',
  'no-with': 'error',
  'preserve-caught-error': 'error',
  'require-yield': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error'
};
const rules = Object.assign({}, recommended, {
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'eqeqeq': ['warn', 'smart'],
  'no-var': 'warn'
});
const browser = { Blob: 'readonly', Event: 'readonly', Image: 'readonly', MutationObserver: 'readonly', ResizeObserver: 'readonly', URL: 'readonly', cancelAnimationFrame: 'readonly', clearTimeout: 'readonly', clearInterval: 'readonly', devicePixelRatio: 'readonly', document: 'readonly', fetch: 'readonly', innerHeight: 'readonly', innerWidth: 'readonly', localStorage: 'readonly', location: 'readonly', navigator: 'readonly', performance: 'readonly', requestAnimationFrame: 'readonly', sessionStorage: 'readonly', setInterval: 'readonly', setTimeout: 'readonly', window: 'readonly', PointerEvent: 'readonly', MouseEvent: 'readonly', KeyboardEvent: 'readonly', WheelEvent: 'readonly', HTMLElement: 'readonly', CustomEvent: 'readonly' };
const nodeG = { require: 'readonly', module: 'readonly', process: 'readonly', __dirname: 'readonly', console: 'readonly', Buffer: 'readonly', exports: 'readonly' };

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'vendor/**', 'js/world-topo.js', 'js/dataset.js', '.claude/**'] },
  // the app: plain scripts loaded by the page (they also load under Node so the tests can run them)
  { files: ['js/**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: Object.assign({ module: 'writable', require: 'readonly', DS: 'readonly' }, browser) }, rules },
  // the 3D source is an ES module bundled by esbuild
  { files: ['src3d/**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: browser }, rules },
  // tests, build and dev server run in Node
  { files: ['test/**/*.js', 'scripts/**/*.js', 'serve.js', 'eslint.config.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: nodeG }, rules }
];
