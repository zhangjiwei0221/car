#!/usr/bin/env node
/** v541：007只比较7×8与7×9棋盘余量。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const SEEDS = [1001, 1002, 88001, 32677];
const OUT = path.resolve(ROOT, '03_工具/好关评分/棋盘余量7x9_v541.json');
function load() {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function cfgFor(G, blocks, seed, cols) {
  const band = G.deriveCapacityBand(blocks);
  return {
    seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1],
    capNormMin: band.band[0], capNormMax: band.band[1],
    boardRowsMin: 7, boardRowsMax: 7, boardColsMin: cols, boardColsMax: cols,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true, instantPlanBranchPrefixDebts: 8,
    experienceGoal: true, instantReleaseRoute: false,
    goalPerRoundMs: 20000, goalMaxMs: 30000, goalMaxRounds: 2,
    goalSharedBudget: true, candidateCount: 1, acceptMode: 'target',
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0,
    capacityTuneMs: 2000, capacityTuneCars: 4, capacityTuneVariants: 12
  };
}
function blackPct(level) {
  let n = 0, b = 0;
  for (const row of level.board.cells) for (const x of row) {
    n++;
    if (x && x.t === 'black') b++;
  }
  return n ? +(b / n * 100).toFixed(1) : null;
}
function run(A, seed, cols) {
  const G = A.Generator;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const cfg = cfgFor(G, blocks, seed, cols);
  const t0 = Date.now();
  let r = null;
  try { r = G.produceGoal(blocks, cfg); }
  catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const ev = r && r.level ? A.ExperienceGoal.evaluate(r.level, {
    solveResult: r.solveResult, decision: false, instantChain: true
  }) : null;
  const cap = r && r.level ? A.Quality.capacityEvidence(r.level, r.config || cfg) : null;
  const q = r && r.level ? A.Quality.fromGeneration(r) : null;
  const fc = r && r.goodV3 && r.goodV3.fillCurve || {};
  const rec = {
    seed, cols, wallMs: Date.now() - t0, valid: !!(r && r.valid),
    struct: !!(r && r.level && G.goalStructPass(r)),
    pass: !!(r && r.level && G.goalResultExperiencePass(r, cfg)),
    freeRunMax: fc.freeRunMax != null ? fc.freeRunMax : null,
    freeLowPct: fc.freeLowPct != null ? fc.freeLowPct : null,
    fullMedian2: fc.fullMedian2 != null ? fc.fullMedian2 : null,
    midBuffer34Pct: ev && ev.metrics && ev.metrics.midBuffer34Pct,
    maxBuffer: ev && ev.metrics && ev.metrics.maxBuffer,
    significantReleaseCount: ev && ev.metrics && ev.metrics.significantReleaseCount,
    solverRelease: ev && ev.releaseDecision && ev.releaseDecision.status,
    qGateReasons: q && q.gateReasons || [],
    capacity: cap && {
      conserved: cap.conserved, aboveMax: cap.aboveMax, belowMin: cap.belowMin,
      microCars: cap.microCars, minCap: cap.minCap, maxCap: cap.maxCap,
      boardFloorPass: cap.boardFloorPass
    },
    board: r && r.level ? { rows: r.level.board.rows, cols: r.level.board.cols } : null,
    blackPct: r && r.level ? blackPct(r.level) : null,
    hash: r && r.level ? hash(r.level) : null,
    error: r && r.error || null
  };
  console.log(JSON.stringify(rec));
  return rec;
}
const A = load();
const rows = [];
for (const seed of SEEDS) for (const cols of [8, 9]) rows.push(run(A, seed, cols));
const pairs = SEEDS.map(seed => {
  const a = rows.find(x => x.seed === seed && x.cols === 8);
  const b = rows.find(x => x.seed === seed && x.cols === 9);
  return {
    seed,
    freeRun: [a.freeRunMax, b.freeRunMax],
    freeRunDrop2: a.freeRunMax != null && b.freeRunMax != null && b.freeRunMax <= a.freeRunMax - 2,
    mid: [a.midBuffer34Pct, b.midBuffer34Pct],
    highPressureKept: b.midBuffer34Pct != null && b.midBuffer34Pct >= 50,
    struct: [a.struct, b.struct],
    targetPass: b.pass,
    capacityOk: !!(b.capacity && b.capacity.conserved && b.capacity.aboveMax === 0 && b.capacity.boardFloorPass &&
      (!b.capacity.microCars || b.capacity.microCars.length === 0)),
    blackOk: b.blackPct != null && a.blackPct != null && b.blackPct <= a.blackPct,
    blackPct: [a.blackPct, b.blackPct]
  };
});
const summary = {
  image: '007', seeds: SEEDS, rows: rows.length, valid: rows.filter(x => x.valid).length,
  freeRunDrop2: pairs.filter(x => x.freeRunDrop2).length,
  highPressureKept: pairs.filter(x => x.highPressureKept).length,
  structTransitions: pairs.filter(x => !x.struct[0] && x.struct[1]).length,
  targetPasses: pairs.filter(x => x.targetPass).length,
  capacityRegressions: pairs.filter(x => !x.capacityOk).map(x => x.seed),
  blackRegressions: pairs.filter(x => !x.blackOk).map(x => x.seed),
  decision: pairs.filter(x => x.freeRunDrop2 && x.highPressureKept).length >= 2 &&
    pairs.filter(x => !x.blackOk).length === 0
    ? '7×9出现可用信号，保留为候选，不直接进默认。'
    : (pairs.filter(x => x.freeRunDrop2 && x.highPressureKept).length >= 2
      ? '7×9降低免费连且高压保持，但黑块4/4恶化，不能采纳；先处理黑块/棋盘填充或回退7×8。'
      : '7×9没有达到至少2/4 seed的有价值改善，回退棋盘尺寸并转P0容量/结构合同。')
};
const report = { schema: 'board-margin-7x9-v1', date: '2026-10-26',
  preregistration: '棋盘余量7x9_预登记_v541.md', summary, pairs, rows };
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary, pairs }, null, 2));
if (summary.capacityRegressions.length || summary.blackRegressions.length) process.exitCode = 1;
