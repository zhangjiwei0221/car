#!/usr/bin/env node
/** v520只读：全程吃满中位 vs 低压力吃满中位；不修改Quality或生产门。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator;
function opt(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; }
const out = opt('out', '');
function median(a) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; }
function curveMetrics(fc) {
  const steps = fc && fc.steps || [], low = steps.filter(s => s.free >= 3), high = steps.filter(s => s.free <= 2);
  const mid = steps.filter(s => s.prog >= .3 && s.prog <= .8);
  return { steps: steps.length, fullMedian2: fc && fc.fullMedian2,
    lowPressureSteps: low.length, lowPressureFullMedian: median(low.map(s => s.full)),
    highPressureSteps: high.length, highPressureFullMedian: median(high.map(s => s.full)),
    midSteps: mid.length, midFullMedian: median(mid.map(s => s.full)),
    freeLowPct: fc && fc.freeLowPct, freeRunMax: fc && fc.freeRunMax, pressurePct3: fc && fc.pressurePct3 };
}
const samples = [];
for (const seed of ['1002', '32677']) {
  const report = JSON.parse(fs.readFileSync(path.join(__dirname, '独立回归_' + seed + '_v516.json'), 'utf8'));
  for (const rr of report.rows) samples.push({ id: rr.image + '_' + seed, level: '独立回归关卡_v516/' + rr.image + '_' + seed + '.json', rr });
}
const nearReport = JSON.parse(fs.readFileSync(path.join(__dirname, '独立回归_32677_v516.json'), 'utf8'));
samples.push({ id: 'recommend_32677_near', level: '推荐32677_近失变体_v518.json', rr: nearReport.rows.find(x => x.image === 'recommend'), near: true });
const rows = [];
for (const s of samples) {
  const rr = s.rr, level = A.parseLevel(JSON.parse(fs.readFileSync(path.join(__dirname, s.level), 'utf8')));
  const cfg = Object.assign({}, G.DEFAULT_CONFIG, { trapEvalMs: 1500, boxSizeMin: rr.capacity.boxSizeMin, boxSizeMax: rr.capacity.boxSizeMax,
    capNormMin: rr.capacity.boxSizeMin, capNormMax: rr.capacity.boxSizeMax });
  const t = Date.now(), ev = G.evaluateLevel(level, cfg), c = { level, valid: !!(ev && ev.valid), solveResult: ev && ev.solveResult, audit: ev && ev.audit, goodV3: ev && ev.goodV3, config: cfg };
  const q = A.Quality.fromGeneration(c), curve = curveMetrics(c.goodV3 && c.goodV3.fillCurve);
  const otherReasons = (q.gateReasons || []).filter(x => x.indexOf('吃满中位') !== 0);
  const lowKnown = curve.lowPressureSteps >= 3 && curve.lowPressureFullMedian != null;
  const candidateStruct = otherReasons.length === 0 && lowKnown && curve.lowPressureFullMedian <= 3;
  const experiencePass = s.near ? true : rr.pass === true; // v518近失复核：74.5%+3释放+finalReplayValid
  rows.push({ id: s.id, near: !!s.near, currentStruct: G.goalStructPass(c), candidateStruct, converted: !G.goalStructPass(c) && candidateStruct,
    experiencePass, currentReasons: q.gateReasons || [], otherReasons,
    candidateReason: otherReasons.length ? 'other_gate_failed' : (!lowKnown ? 'insufficient_low_pressure_steps' : (curve.lowPressureFullMedian > 3 ? 'low_pressure_full_median>3' : null)),
    curve, capacity: A.Quality.capacityEvidence(level, cfg), evalMs: Date.now() - t });
  console.log(JSON.stringify({ id: s.id, current: rows[rows.length - 1].currentStruct, candidate: candidateStruct, experiencePass, curve }));
}
const conversions = rows.filter(r => r.converted), summary = { samples: rows.length,
  currentStructPasses: rows.filter(r => r.currentStruct).length, candidateStructPasses: rows.filter(r => r.candidateStruct).length,
  conversions: conversions.length, rescuedExperiencePass: conversions.filter(r => r.experiencePass).length,
  rescuedExperienceFail: conversions.filter(r => !r.experiencePass).length,
  insufficientLowPressure: rows.filter(r => r.candidateReason === 'insufficient_low_pressure_steps').length,
  currentStructChangedToFail: rows.filter(r => r.currentStruct && !r.candidateStruct).map(r => r.id),
  necessaryConditionPass: conversions.some(r => r.experiencePass) && !conversions.some(r => !r.experiencePass) && !rows.some(r => r.currentStruct && !r.candidateStruct) };
const result = { schema: 'full-gate-pressure-calibration-v1', date: '2026-10-26', productionVersion: 'v518',
  definition: { lowPressure: 'free>=3 (buffer<=2)', highPressure: 'free<=2 (buffer>=3)', minLowPressureSteps: 3, candidate: 'replace only fullMedian2<=3 with lowPressureFullMedian<=3; all other gates unchanged' }, summary, rows };
if (out) fs.writeFileSync(path.resolve(ROOT, out), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
