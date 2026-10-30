#!/usr/bin/env node
/** v565：有界局部交换修复 A/B（7×9、9×7；同图同seed同基础预算）。 */
'use strict';

const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const OUT = path.join(__dirname, '有界局部交换AB_v565.json');
const SHAPES = [{ id: '7x9', rows: 7, cols: 9 }, { id: '9x7', rows: 9, cols: 7 }];
const SEEDS = [1001, 1002, 32677];
const ONLY_SHAPE = (process.argv.find(function(x) { return x.indexOf('--shape=') === 0; }) || '').slice('--shape='.length);
const ONLY_SEED = parseInt((process.argv.find(function(x) { return x.indexOf('--seed=') === 0; }) || '').slice('--seed='.length), 10);
const ONLY_ARM = (process.argv.find(function(x) { return x.indexOf('--arm=') === 0; }) || '').slice('--arm='.length);
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];

function load() {
  const sb = { console: { log() { }, warn() { }, error() { } }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function cfgFor(seed, shape, repair) {
  return {
    seed: seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: 20, boxSizeMax: 40, capNormMin: 20, capNormMax: 40,
    boardRowsMin: shape.rows, boardRowsMax: shape.rows,
    boardColsMin: shape.cols, boardColsMax: shape.cols,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'shortDebt', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanDebtEvery: 2,
    instantPlanBranchCount: 2, instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 12,
    targetCarCount: 52, blackPercent: 10,
    experienceGoal: true, instantReleaseRoute: false,
    goalPerRoundMs: 20000, goalMaxMs: 30000, goalMaxRounds: 2,
    goalSharedBudget: true, candidateCount: 1, acceptMode: 'target',
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0,
    capacityTuneMs: 2000, capacityTuneCars: 4, capacityTuneVariants: 12,
    localSwapRepair: !!repair,
    localSwapStage1Pairs: 32, localSwapStage1Ms: 4000,
    localSwapStage2Pairs: 64, localSwapStage2Ms: 4000
  };
}
function run(A, shape, seed, repair) {
  const G = A.Generator, cfg = cfgFor(seed, shape, repair);
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const t0 = Date.now();
  let r = null;
  try { r = G.produceGoal(blocks, cfg); } catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const cap = r && r.level ? A.Quality.capacityEvidence(r.level, r.config || cfg) : null;
  const ev = r && r._experienceFull || (r && r.level ? A.ExperienceGoal.evaluate(r.level, {
    solveResult: r.solveResult, decision: false, instantChain: true
  }) : null);
  const q = r && r.level ? A.Quality.fromGeneration(r) : null;
  const fc = r && r.goodV3 && r.goodV3.fillCurve || {};
  return {
    arm: repair ? 'B' : 'A', shape: shape.id, seed: seed,
    valid: !!(r && r.valid), struct: !!(q && q.gatePass), gateReasons: q && q.gateReasons || [],
    goalPass: !!(r && r.level && G.goalResultExperiencePass(r, cfg)),
    experiencePass: !!(ev && ev.pass), experienceReasons: ev && ev.reasons || [],
    fullMedian2: fc.fullMedian2 != null ? fc.fullMedian2 : null,
    freeRunMax: fc.freeRunMax != null ? fc.freeRunMax : null,
    freeLowPct: fc.freeLowPct != null ? fc.freeLowPct : null,
    midBuffer34Pct: ev && ev.metrics ? ev.metrics.midBuffer34Pct : null,
    maxBuffer: ev && ev.metrics ? ev.metrics.maxBuffer : null,
    releaseStatus: ev && ev.releaseDecision && ev.releaseDecision.status || null,
    releaseAmplitude: ev && ev.releaseDecision && ev.releaseDecision.evidence
      ? ev.releaseDecision.evidence.releaseAmplitude : null,
    finalReplayValid: !!(ev && ev.releaseDecision && ev.releaseDecision.evidence &&
      ev.releaseDecision.evidence.finalReplayValid),
    capacity: cap ? {
      conserved: cap.conserved, perColorConserved: cap.perColorConserved,
      boardFloorPass: cap.boardFloorPass, minCap: cap.minCap, maxCap: cap.maxCap,
      belowMin: cap.belowMin, aboveMax: cap.aboveMax
    } : null,
    localSwapRepair: r && r.localSwapRepair || null,
    localSwapEvidence: r && r.localSwapEvidence || null,
    wallMs: Date.now() - t0,
    goalStopReason: r && r.goalStopReason || null,
    hash: r && r.level ? hash(r.level) : null,
    error: r && r.error || null
  };
}
function median(a) {
  const b = a.filter(function(x) { return x != null && Number.isFinite(x); }).sort(function(x, y) { return x - y; });
  if (!b.length) return null;
  const m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function main() {
  const A = load(), rows = [];
  const shapes = ONLY_SHAPE ? SHAPES.filter(function(x) { return x.id === ONLY_SHAPE; }) : SHAPES;
  const seeds = ONLY_SEED ? [ONLY_SEED] : SEEDS;
  const arms = ONLY_ARM === 'A' ? [false] : ONLY_ARM === 'B' ? [true] : [false, true];
  for (const shape of shapes) for (const seed of seeds) for (const repair of arms) {
    const rec = run(A, shape, seed, repair);
    rows.push(rec);
    console.log('[ab]', rec.arm, rec.shape, rec.seed, 'struct=' + rec.struct,
      'goal=' + rec.goalPass, 'full=' + rec.fullMedian2, 'free=' + rec.freeRunMax,
      'repair=' + !!(rec.localSwapRepair && rec.localSwapRepair.applied),
      'ms=' + rec.wallMs);
    fs.writeFileSync(OUT, JSON.stringify({
      schema: 'bounded-local-swap-ab-v565', date: '2026-10-26', partial: true,
      config: { shapes: shapes.map(function(x) { return x.id; }), seeds: seeds,
        stage1Pairs: 32, stage1Ms: 4000, stage2Pairs: 64, stage2Ms: 4000 },
      rows: rows
    }, null, 2) + '\n');
  }
  const summary = arms.map(function(r) { return r ? 'B' : 'A'; }).map(function(arm) {
    const a = rows.filter(function(x) { return x.arm === arm; });
    return {
      arm: arm, runs: a.length, struct: a.filter(function(x) { return x.struct; }).length,
      goal: a.filter(function(x) { return x.goalPass; }).length,
      repairs: a.filter(function(x) { return x.localSwapRepair && x.localSwapRepair.applied; }).length,
      aboveMax: a.filter(function(x) { return x.capacity && x.capacity.aboveMax; }).length,
      perColorFail: a.filter(function(x) { return x.capacity && x.capacity.perColorConserved !== true; }).length,
      wallMedianMs: median(a.map(function(x) { return x.wallMs; })),
      wallMaxMs: Math.max.apply(null, a.map(function(x) { return x.wallMs; }))
    };
  });
  const pairs = [];
  for (const shape of shapes) for (const seed of seeds) {
    const a = rows.find(function(x) { return x.shape === shape.id && x.seed === seed && x.arm === 'A'; });
    const b = rows.find(function(x) { return x.shape === shape.id && x.seed === seed && x.arm === 'B'; });
    if (!a || !b) continue;
    pairs.push({
      shape: shape.id, seed: seed,
      struct: [a.struct, b.struct], goal: [a.goalPass, b.goalPass],
      full: [a.fullMedian2, b.fullMedian2], free: [a.freeRunMax, b.freeRunMax],
      repaired: !!(b.localSwapRepair && b.localSwapRepair.applied),
      extraMs: b.wallMs - a.wallMs,
      noRegression: !(a.goalPass && !b.goalPass)
    });
  }
  const A0 = summary.find(function(x) { return x.arm === 'A'; });
  const B0 = summary.find(function(x) { return x.arm === 'B'; });
  const report = {
    schema: 'bounded-local-swap-ab-v565',
    date: '2026-10-26',
    config: { shapes: SHAPES.map(function(x) { return x.id; }), seeds: SEEDS,
      stage1Pairs: 32, stage1Ms: 4000, stage2Pairs: 64, stage2Ms: 4000 },
    summary: summary, pairs: pairs, rows: rows
  };
  report.pass = !!A0 && !!B0 && B0.struct >= A0.struct && B0.goal >= A0.goal &&
    pairs.every(function(x) { return x.noRegression; }) &&
    B0.aboveMax === 0 && B0.perColorFail === 0;
  report.decision = report.pass
    ? '有界修复未回退且至少保持目标/结构；可进入真实UI和更多留出seed。'
    : '有界修复存在回退或硬合同失败；不得接生产默认。';
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary: summary, pairs: pairs, pass: report.pass, decision: report.decision }, null, 2));
  if (!report.pass) process.exitCode = 1;
}
main();
