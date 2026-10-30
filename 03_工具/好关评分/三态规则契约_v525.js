#!/usr/bin/env node
/** v525：三态规则契约单测；确保UI模式不会与生成侧elimOrder分裂。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const G = sb.AntSolver.Generator, norm = G.normalizeRuleConfig;
assert.strictEqual(typeof norm, 'function');
function check(input, expected) {
  const out = norm(input);
  assert.strictEqual(out.ruleMode, expected.mode);
  assert.strictEqual(out.bottomOnly, expected.bottomOnly);
  assert.strictEqual(out.instantChain, expected.instantChain);
  assert.strictEqual(out.elimOrder, expected.elimOrder);
  return { input, output: { ruleMode: out.ruleMode, bottomOnly: out.bottomOnly, instantChain: out.instantChain, elimOrder: out.elimOrder } };
}
const cases = {
  defaultFourSide: check({}, { mode: 'fourSide', bottomOnly: false, instantChain: false, elimOrder: 'ring' }),
  oldBottomOnlyFlag: check({ bottomOnly: true }, { mode: 'bottomOnly', bottomOnly: true, instantChain: false, elimOrder: 'ring' }),
  oldInstantFlag: check({ instantChain: true, bottomOnly: true, elimOrder: 'ring' }, { mode: 'instantChain', bottomOnly: false, instantChain: true, elimOrder: 'instant' }),
  uiFourSide: check({ ruleMode: 'fourSide' }, { mode: 'fourSide', bottomOnly: false, instantChain: false, elimOrder: 'ring' }),
  uiBottomOnly: check({ ruleMode: 'bottomOnly' }, { mode: 'bottomOnly', bottomOnly: true, instantChain: false, elimOrder: 'ring' }),
  uiInstantChain: check({ ruleMode: 'instantChain' }, { mode: 'instantChain', bottomOnly: false, instantChain: true, elimOrder: 'instant' }),
  aliasInstantChain: check({ ruleMode: 'fourSideInstantChain' }, { mode: 'instantChain', bottomOnly: false, instantChain: true, elimOrder: 'instant' })
};
const app = fs.readFileSync(path.join(BIN, 'app.js'), 'utf8');
assert.ok(app.includes("ruleMode: _ruleMode"), 'UI getGenConfig must emit ruleMode');
assert.ok(app.includes("elimOrder: _ruleMode === 'instantChain' ? 'instant' : 'ring'"), 'UI elimOrder must derive from ruleMode');
const out = { schema: 'rule-contract-v525', date: '2026-10-26', pass: true, cases,
  uiWiring: { emitsRuleMode: true, derivesElimOrder: true } };
fs.writeFileSync(path.join(__dirname, '三态规则契约_v525.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
