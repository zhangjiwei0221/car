#!/usr/bin/env node
/** v520：近失救援、旧字段回退、低压力证据不足三项门语义。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const BIN = path.join(__dirname, '候选低压力门_v520');
const sb = { console, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(BIN, 'utils.js'), 'utf8'), sb, { filename: 'utils.js' });
const Q = sb.AntSolver.Quality;
const level = { board: { rows: 6, cols: 6, cells: [] } };
function input(extra) { return Object.assign({ valid: true, level, learned: 60, look: 60, wMed: 2, selectMed: 4, forcedPct: 0,
  fullMed2: 1, t: 30, r: 30, hidden: 0, freePct: 20, freeRunMax: 2, freeLowPct: 10, partialStepPct: 50 }, extra || {}); }
const rescued = Q.verdict(input({ fullMed2: 4, lowPressureSteps: 33, lowPressureFullMedian: 2 }));
assert.strictEqual(rescued.gatePass, true);
const legacy = Q.verdict(input({ fullMed2: 4 }));
assert.strictEqual(legacy.gatePass, false);
assert.ok(legacy.gateReasons.some(x => x.indexOf('吃满中位') >= 0));
const unknown = Q.verdict(input({ fullMed2: 0, lowPressureSteps: 2, lowPressureFullMedian: 0 }));
assert.strictEqual(unknown.gatePass, false);
assert.ok(unknown.gateReasons.some(x => x.indexOf('证据不足') >= 0));
const lowWhite = Q.verdict(input({ fullMed2: 2, lowPressureSteps: 20, lowPressureFullMedian: 4 }));
assert.strictEqual(lowWhite.gatePass, false);
assert.ok(lowWhite.gateReasons.some(x => x.indexOf('低压力吃满中位') >= 0));
const out = { schema: 'low-pressure-gate-unit-v1', date: '2026-10-26', pass: true,
  cases: { highPressureReleaseRescued: rescued.gatePass, legacyMissingFieldsStillFails: !legacy.gatePass,
    insufficientLowPressureRejected: !unknown.gatePass, lowPressureWhiteRejected: !lowWhite.gatePass } };
fs.writeFileSync(path.join(__dirname, '低压力门单元回归_v520.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
