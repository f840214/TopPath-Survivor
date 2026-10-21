const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// Antitrampas: las teclas inventadas por un script (isTrusted = false) no cuentan.
test('only real key presses count, not ones made up by a script', () => {
  const on = {};
  const ctx = { G: {}, addEventListener: (k, fn) => { on[k] = fn; } };
  vm.createContext(ctx);
  vm.runInContext(source('js/core/input.js'), ctx);
  const key = (isTrusted, code) => ({ isTrusted, code, key: code, preventDefault() {} });
  on.keydown(key(false, 'KeyQ'));
  assert.equal(ctx.G.Input.tap('keyq'), false);
  on.keydown(key(true, 'KeyE'));
  assert.equal(ctx.G.Input.tap('keye'), true);
});
