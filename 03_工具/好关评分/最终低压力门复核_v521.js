#!/usr/bin/env node
/** v521：近失关最终补充验收、时间模式不变、其他结构失败不可抵消。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), assert = require('assert');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js'), CAND = path.join(__dirname, '候选最终低压力门_v521');
const CURRENT = process.argv.includes('--current'), OUT_NAME = CURRENT ? '最终低压力门近失复核_v522.json' : '最终低压力门近失复核_v521.json';
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'generator.js'];
function load(arm) {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) {
    const source = arm === 'old' ? cp.execFileSync('git', ['show', '07f7c11:02_工程/完整主bin快照_20261012/bin/js/' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }) :
      fs.readFileSync((f === 'utils.js' || f === 'generator.js') ? path.join(CURRENT ? BIN : CAND, f) : path.join(BIN, f), 'utf8');
    vm.runInContext(source, sb, { filename: f });
  }
  return sb.AntSolver;
}
const rr = require('./独立回归_32677_v516.json').rows.find(x => x.image === 'recommend'), out = { schema: 'final-low-pressure-near-verification-v1', date: '2026-10-26' };
for (const arm of ['old', 'new']) {
  const A = load(arm), G = A.Generator, lv = A.parseLevel(require('./推荐32677_近失变体_v518.json'));
  const cfg = Object.assign({}, G.DEFAULT_CONFIG, { trapEvalMs: 1500, boxSizeMin: rr.capacity.boxSizeMin, boxSizeMax: rr.capacity.boxSizeMax,
    capNormMin: rr.capacity.boxSizeMin, capNormMax: rr.capacity.boxSizeMax, experienceGoal: true });
  const ev = G.evaluateLevel(lv, cfg), c = { level: lv, valid: ev.valid, solveResult: ev.solveResult, audit: ev.audit, goodV3: ev.goodV3, config: cfg };
  G.attachExperienceRouteEvidence(c, cfg); G.markVerifiedRouteAccept(c, cfg); if (G.markFinalStructureAccept) G.markFinalStructureAccept(c, cfg);
  out[arm] = { baseStruct: G.goalStructPass(c), finalStruct: A.Quality.finalStructureFromGeneration ? A.Quality.finalStructureFromGeneration(c) : null,
    resultPass: G.goalResultExperiencePass(c, cfg), timeModeResultPass: G.goalResultExperiencePass(c, Object.assign({}, cfg, { experienceGoal: false })),
    acceptedByVerifiedRoute: !!c.acceptedByVerifiedRoute, acceptedByFinalStructure: !!c.acceptedByFinalStructure,
    experience: c._experienceFull && { pass: c._experienceFull.pass, metrics: c._experienceFull.metrics, release: c._experienceFull.releaseDecision && c._experienceFull.releaseDecision.status },
    capacity: A.Quality.capacityEvidence(lv, cfg) };
}
assert.strictEqual(out.old.baseStruct, false); assert.strictEqual(out.old.resultPass, false);
assert.strictEqual(out.new.baseStruct, false); assert.strictEqual(out.new.finalStruct.pass, true); assert.strictEqual(out.new.resultPass, true);
assert.strictEqual(out.new.timeModeResultPass, false); assert.strictEqual(out.new.acceptedByVerifiedRoute, false); assert.strictEqual(out.new.acceptedByFinalStructure, true);
const A = load('new'), raw = require('./推荐32677_近失变体_v518.json'), fc = { steps: [{ free: 3, full: 2 }, { free: 3, full: 2 }, { free: 3, full: 2 }], fullMedian2: 4,
  selectMedian: 8, forcedPct: 0, partialStepPct: 50, freeLowPct: 27, freeRunMax: 5 };
const otherFail = { level: A.parseLevel(raw), valid: true, goodV3: { persist: { deathCauses: {} }, fillCurve: Object.assign({}, fc, { freeLowPct: 45 }) } };
const evidence = A.Quality.finalStructureFromGeneration(otherFail);
assert.strictEqual(evidence.pass, false); assert.ok(evidence.remainingReasons.some(x => x.indexOf('freeLow') >= 0));
out.otherGateProtection = { pass: evidence.pass, remainingReasons: evidence.remainingReasons };
out.underTest = CURRENT ? 'working-v522' : 'candidate-v521';
fs.writeFileSync(path.join(__dirname, OUT_NAME), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ old: { base: out.old.baseStruct, pass: out.old.resultPass }, new: { base: out.new.baseStruct, final: out.new.finalStruct.pass,
  pass: out.new.resultPass, timeModePass: out.new.timeModeResultPass, source: out.new.acceptedByFinalStructure ? 'final' : null }, otherGateProtection: out.otherGateProtection }, null, 2));
