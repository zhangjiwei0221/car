#!/usr/bin/env node
/** v527：每色容量计划单测 + 三图生产计划复核。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const P = sb.AntSolver.InstantPlayout;
function check(total, min, max) {
  const x = P.capacityPlanForColor(total, min, max);
  assert.strictEqual(x.caps.reduce((a, b) => a + b, 0), total);
  assert.ok(x.caps.every(c => c <= max && c >= 1), 'capacity must stay <= max and >0');
  assert.ok(x.caps.filter(c => c <= 2).length === 0, 'must avoid 1-2px cars when alternative exists');
  return { total, min, max, ...x };
}
const out = { schema: 'capacity-plan-v527', date: '2026-10-26', cases: {}, plans: {} };
out.cases.exact = check(103, 31, 40);
out.cases.countFirst = check(55, 31, 40);
out.cases.balancedTail = check(41, 31, 40);
out.cases.noMicroOnSingletonBand = check(33, 31, 31);
out.cases.large = check(282, 31, 31);
const files = { '006': '35x35拼接图纸_006.txt', '010': '35x35拼接图纸_010.txt', '007': '35x35拼接图纸_007.txt' };
for (const id in files) {
  const blocks = sb.AntSolver.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库', files[id]), 'utf8'));
  const band = sb.AntSolver.Generator.deriveCapacityBand(blocks), t = Date.now();
  const p = P.plan({ blocks, bufferLimit: 5 }, { boxSizeMin: band.band[0], boxSizeMax: band.band[1], bufferLimit: 5 });
  out.plans[id] = { ms: Date.now() - t, band: band.band, ok: p.ok, audit: p.audit,
    minCap: Math.min(...p.cars.map(x => x.cap)), maxCap: Math.max(...p.cars.map(x => x.cap)),
    capacityPlans: p.boxes._instantPlayout.capacityPlans };
}
fs.writeFileSync(path.join(__dirname, '容量计划_v527.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
