#!/usr/bin/env node
/** v566：v565多图局部修复触发率与失败分类观察。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const OUT = path.join(__dirname, '多图修复观察_v566.json');
const IMAGES = {
  '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
  '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt',
  '007': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt',
  recommend: '实验关/已知不可救/推荐_35x35_碎块_20261023.txt',
  good: '实验关/已知冲突/好图_35x35_碎块_20261023.txt'
};
const SEEDS = [1001, 1002, 88001, 32677];
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
function cfgFor(blocks, seed) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  const frontier = band.frontier && band.frontier.avg;
  return {
    seed: seed, generatorFlow: 'new_fixed', ruleMode: 'instantChain',
    boxSizeMin: b[0], boxSizeMax: b[1], capNormMin: b[0], capNormMax: b[1],
    cutMode: (frontier != null && frontier >= 2 && frontier <= 4.5) ? 'exposeCut' : 'layerCut2',
    candidateCount: 3, boardRowsMin: 6, boardRowsMax: 9,
    boardColsMin: 6, boardColsMax: 9, boardHardRange: false, boardAuto: false,
    boardAllowSquare: true, boardExpandOnOverflow: false, boardFirst: true, boardFitGuard: 'warn',
    boardPrefer7: true, boardPrefer7Dims: null,
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true, instantPlanBranchPrefixDebts: 8,
    minPipes: 0, blackPercent: 10, narrowPath: true,
    experienceGoal: true, instantReleaseRoute: false,
    goalPerRoundMs: 10000, goalMaxMs: 15000, goalMaxRounds: 2,
    goalSharedBudget: true, acceptMode: 'target',
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0,
    capacityTuneMs: 3000, capacityTuneCars: 4, capacityTuneVariants: 12,
    localSwapRepair: true, localSwapRepairMaxMs: 8000,
    localSwapStage1Pairs: 32, localSwapStage1Ms: 4000,
    localSwapStage2Pairs: 64, localSwapStage2Ms: 4000
  };
}
let A = null;
function run(image, seed) {
  const G = A.Generator;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGES[image]), 'utf8'));
  const cfg = cfgFor(blocks, seed);
  const t0 = Date.now();
  let r = null;
  try { r = G.produceGoal(blocks, cfg); } catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const wallMs = Date.now() - t0;
  const level = r && r.level || null;
  const q = level ? A.Quality.fromGeneration(r) : null;
  const cap = level ? A.Quality.capacityEvidence(level, r.config || cfg) : null;
  const ev = r && r._experienceFull || (level ? A.ExperienceGoal.evaluate(level, {
    solveResult: r.solveResult, decision: false, instantChain: true
  }) : null);
  const fc = r && r.goodV3 && r.goodV3.fillCurve || {};
  return {
    image: image, seed: seed, valid: !!(r && r.valid),
    board: level ? level.board.rows + 'x' + level.board.cols : null,
    struct: !!(q && q.gatePass), gateReasons: q && q.gateReasons || [],
    experiencePass: !!(ev && ev.pass), experienceReasons: ev && ev.reasons || [],
    goalPass: !!(level && G.goalResultExperiencePass(r, cfg)),
    fullMedian2: fc.fullMedian2 != null ? fc.fullMedian2 : null,
    freeRunMax: fc.freeRunMax != null ? fc.freeRunMax : null,
    freeLowPct: fc.freeLowPct != null ? fc.freeLowPct : null,
    midBuffer34Pct: ev && ev.metrics ? ev.metrics.midBuffer34Pct : null,
    maxBuffer: ev && ev.metrics ? ev.metrics.maxBuffer : null,
    releaseStatus: ev && ev.releaseDecision && ev.releaseDecision.status || null,
    significantReleaseCount: ev && ev.metrics ? ev.metrics.significantReleaseCount : null,
    capacity: cap ? {
      conserved: cap.conserved, perColorConserved: cap.perColorConserved,
      boardFloorPass: cap.boardFloorPass, minCap: cap.minCap, maxCap: cap.maxCap,
      belowMin: cap.belowMin, aboveMax: cap.aboveMax
    } : null,
    localSwapRepair: r && r.localSwapRepair || null,
    localSwapEvidence: r && r.localSwapEvidence || null,
    wallMs: wallMs, goalStopReason: r && r.goalStopReason || null,
    hash: level ? hash(level) : null, error: r && r.error || null
  };
}
function median(a) {
  const b = a.filter(function(x) { return x != null && Number.isFinite(x); }).sort(function(x, y) { return x - y; });
  if (!b.length) return null;
  const m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function main() {
  A = load();
  const rows = [];
  for (const image of Object.keys(IMAGES)) for (const seed of SEEDS) {
    const rec = run(image, seed);
    rows.push(rec);
    console.log('[observe]', image, seed, rec.valid ? rec.board : 'FAIL',
      'struct=' + rec.struct, 'goal=' + rec.goalPass,
      'repair=' + !!(rec.localSwapRepair && rec.localSwapRepair.applied),
      'full=' + rec.fullMedian2, 'free=' + rec.freeRunMax, 'ms=' + rec.wallMs);
    fs.writeFileSync(OUT, JSON.stringify({ schema: 'v565-multi-image-repair-observe-v566',
      date: '2026-10-26', partial: true, rows: rows }, null, 2) + '\n');
  }
  const repaired = rows.filter(function(x) { return x.localSwapRepair && x.localSwapRepair.applied; });
  const repairs = repaired.map(function(x) { return x.localSwapRepair.overheadMs || 0; });
  const summary = {
    runs: rows.length,
    valid: rows.filter(function(x) { return x.valid; }).length,
    struct: rows.filter(function(x) { return x.struct; }).length,
    goal: rows.filter(function(x) { return x.goalPass; }).length,
    repairTriggered: repaired.length,
    repairGoalPass: repaired.filter(function(x) { return x.goalPass; }).length,
    aboveMax: rows.filter(function(x) { return x.capacity && x.capacity.aboveMax; }).length,
    perColorFail: rows.filter(function(x) { return x.capacity && x.capacity.perColorConserved !== true; }).length,
    repairOverheadMedianMs: median(repairs),
    repairOverheadMaxMs: repairs.length ? Math.max.apply(null, repairs) : null,
    wallMedianMs: median(rows.map(function(x) { return x.wallMs; })),
    wallMaxMs: Math.max.apply(null, rows.map(function(x) { return x.wallMs; })),
    byImage: Object.keys(IMAGES).map(function(image) {
      const a = rows.filter(function(x) { return x.image === image; });
      return { image: image, runs: a.length, struct: a.filter(function(x) { return x.struct; }).length,
        goal: a.filter(function(x) { return x.goalPass; }).length,
        repairs: a.filter(function(x) { return x.localSwapRepair && x.localSwapRepair.applied; }).length,
        gateReasons: a.map(function(x) { return x.gateReasons; }) };
    })
  };
  const report = { schema: 'v565-multi-image-repair-observe-v566', date: '2026-10-26', summary: summary, rows: rows };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary: summary }, null, 2));
}
main();
