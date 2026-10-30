#!/usr/bin/env node
/** v520：Git旧门 vs 工作区低压力门，同图同seed同预算真实生成。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..'), REL = '02_工程/游戏主bin/bin/js', BIN = path.join(ROOT, REL);
const CANDIDATE = path.join(__dirname, '候选低压力门_v520');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'generator.js', 'source-preflight.js'];
function opt(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; }
const seed = +opt('seed', '77003'), budgetMs = +opt('budget', '45000'), roundMs = +opt('round', '20000'), out = opt('out', ''), only = opt('images', '006,007,recommend').split(','), reviewMix = opt('review-mix', '1') === '1';
function load(arm) {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) {
    const source = arm === 'old' ? cp.execFileSync('git', ['show', '0425122:' + REL + '/' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }) :
      fs.readFileSync((f === 'utils.js' || f === 'generator.js') ? path.join(CANDIDATE, f) : path.join(BIN, f), 'utf8');
    vm.runInContext(source, sb, { filename: arm + '/' + f });
  }
  return sb.AntSolver;
}
const arms = { old: load('old'), new: load('new') };
const images = { '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt', '007': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt', '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt', recommend: '实验关/已知不可救/推荐_35x35_碎块_20261023.txt' };
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function run(arm, id) {
  const A = arms[arm], G = A.Generator, file = images[id], blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, file), 'utf8')), band = G.deriveCapacityBand(blocks), t0 = Date.now();
  const cfg = { seed, goalPerRoundMs: roundMs, goalMaxMs: budgetMs, goalMaxRounds: 0, goalSharedBudget: true, experienceGoal: true, reviewMix,
    generatorFlow: 'new_fixed', boxSizeMin: band.band[0], boxSizeMax: band.band[1], capNormMin: band.band[0], capNormMax: band.band[1], capScalePlan: [1.45, 1.15], cutMode: 'layerCut2', candidateCount: 3, fullTime: true, portfolioK: 1,
    acceptMode: 'target', targetPeakMin: 3.2, targetPeakMax: 4.8, targetSteadyMin: 0, targetSteadyMax: 100, targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: .25,
    boardAllowSquare: true, boardRowsMin: 6, boardRowsMax: 9, boardColsMin: 6, boardColsMax: 11, boardHardRange: true, boardAuto: false, capacityTuneMs: 5000, capacityTuneCars: 8, capacityTuneVariants: 48 };
  let r; try { r = G.produceGoal(blocks, cfg); } catch (e) { r = { level: null, valid: false, error: String(e && e.message || e) }; }
  const wallMs = Date.now() - t0, ev = r && r._experienceFull || null, q = r && r.level ? A.Quality.fromGeneration(r) : null, fc = r && r.goodV3 && r.goodV3.fillCurve || {};
  const rec = { arm, image: id, seed, wallMs, overrunMs: Math.max(0, wallMs - budgetMs), rounds: r && r.goalRounds || 0, stop: r && r.goalStopReason || null,
    valid: !!(r && r.valid), struct: !!(r && r.level && G.goalStructPass(r)), pass: !!(r && r.level && G.goalResultExperiencePass(r, cfg)),
    distance: ev && ev.metrics && ev.metrics.distance, midBuffer34Pct: ev && ev.metrics && ev.metrics.midBuffer34Pct, release: ev && ev.releaseDecision && ev.releaseDecision.status,
    gateReasons: q && q.gateReasons, fullMedian2: fc.fullMedian2, lowPressureFullMedian: fc.lowPressureFullMedian, lowPressureSteps: fc.lowPressureSteps,
    capacity: r && r.level ? A.Quality.capacityEvidence(r.level, r.config || cfg) : null, hash: r && r.level ? hash(r.level) : null, error: r && r.error || null };
  console.log(JSON.stringify(rec)); return rec;
}
const rows = [];
for (const id of only) for (const arm of ['old', 'new']) rows.push(run(arm, id));
const pairs = only.map(id => { const a = rows.find(x => x.image === id && x.arm === 'old'), b = rows.find(x => x.image === id && x.arm === 'new'); return { image: id,
  pass: [a.pass, b.pass], struct: [a.struct, b.struct], wallMs: [a.wallMs, b.wallMs], rounds: [a.rounds, b.rounds], distance: [a.distance, b.distance],
  midBuffer34Pct: [a.midBuffer34Pct, b.midBuffer34Pct], passRegression: a.pass && !b.pass, sameHash: a.hash === b.hash }; });
const summary = { seed, budgetMs, roundMs, runs: rows.length, pass: Object.fromEntries(['old', 'new'].map(a => [a, rows.filter(x => x.arm === a && x.pass).length])),
  struct: Object.fromEntries(['old', 'new'].map(a => [a, rows.filter(x => x.arm === a && x.struct).length])), passRegressions: pairs.filter(x => x.passRegression).map(x => x.image),
  totalWallMs: Object.fromEntries(['old', 'new'].map(a => [a, rows.filter(x => x.arm === a).reduce((n, x) => n + x.wallMs, 0)])) };
const report = { schema: 'low-pressure-gate-generation-ab-v1', date: '2026-10-26', oldCommit: '0425122', reviewMix, summary, pairs, rows };
if (out) fs.writeFileSync(path.resolve(ROOT, out), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary, pairs }, null, 2));
if (summary.passRegressions.length) process.exitCode = 1;
