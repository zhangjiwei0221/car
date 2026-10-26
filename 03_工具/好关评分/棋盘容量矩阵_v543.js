#!/usr/bin/env node
/** v543：007棋盘×容量联合矩阵；显式[20,40]实验输入，不改默认。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const SEEDS = [1001, 1002, 32677];
const ARMS = [
  { id: 'A', rows: 7, cols: 8, capMin: 31, capMax: 31, targetCars: null },
  { id: 'B', rows: 7, cols: 7, capMin: 20, capMax: 40, targetCars: 41 },
  { id: 'C', rows: 7, cols: 8, capMin: 20, capMax: 40, targetCars: 46 },
  { id: 'D', rows: 7, cols: 9, capMin: 20, capMax: 40, targetCars: 52 }
];
const OUT = path.resolve(ROOT, '03_工具/好关评分/棋盘容量矩阵_v543.json');
function load() {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function cfgFor(G, blocks, seed, arm) {
  return {
    seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: arm.capMin, boxSizeMax: arm.capMax,
    capNormMin: arm.capMin, capNormMax: arm.capMax,
    boardRowsMin: arm.rows, boardRowsMax: arm.rows,
    boardColsMin: arm.cols, boardColsMax: arm.cols,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true, instantPlanBranchPrefixDebts: 8,
    targetCarCount: arm.targetCars || undefined,
    blackPercent: 10,
    experienceGoal: true, instantReleaseRoute: false,
    goalPerRoundMs: 20000, goalMaxMs: 30000, goalMaxRounds: 2,
    goalSharedBudget: true, candidateCount: 1, acceptMode: 'target',
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0
  };
}
function blackPct(level) {
  let n = 0, black = 0;
  for (const row of level.board.cells) for (const x of row) {
    n++;
    if (x && x.t === 'black') black++;
  }
  return n ? +(black / n * 100).toFixed(1) : null;
}
function countBoxes(level) {
  let n = 0;
  for (const row of level.board.cells) for (const x of row) if (x && x.t === 'box') n++;
  return n;
}
function run(A, seed, arm) {
  const G = A.Generator, EG = A.ExperienceGoal;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const cfg = cfgFor(G, blocks, seed, arm);
  const t0 = Date.now();
  let r = null;
  try { r = G.produceGoal(blocks, cfg); }
  catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const level = r && r.level || null;
  const q = level ? A.Quality.fromGeneration(r) : null;
  const ca = level ? A.Quality.capacityEvidence(level, r.config || cfg) : null;
  const ev = r && r._experienceFull || (level ? EG.evaluate(level, {
    solveResult: r.solveResult, decision: false, instantChain: true
  }) : null);
  const fc = r && r.goodV3 && r.goodV3.fillCurve || {};
  const rec = {
    arm: arm.id, seed, board: `${arm.rows}x${arm.cols}`,
    cap: [arm.capMin, arm.capMax], targetCars: arm.targetCars,
    wallMs: Date.now() - t0, valid: !!(r && r.valid),
    rounds: r && r.goalRounds || 0, stop: r && r.goalStopReason || null,
    boxes: level ? countBoxes(level) : null,
    black: level ? (() => { let n = 0; for (const row of level.board.cells) for (const x of row) if (x && x.t === 'black') n++; return n; })() : null,
    blackPct: level ? blackPct(level) : null,
    freeRunMax: fc.freeRunMax != null ? fc.freeRunMax : null,
    freeLowPct: fc.freeLowPct != null ? fc.freeLowPct : null,
    midBuffer34Pct: ev && ev.metrics && ev.metrics.midBuffer34Pct,
    maxBuffer: ev && ev.metrics && ev.metrics.maxBuffer,
    significantReleaseCount: ev && ev.metrics && ev.metrics.significantReleaseCount,
    solverRelease: ev && ev.releaseDecision && ev.releaseDecision.status,
    struct: !!(level && G.goalStructPass(r)),
    pass: !!(level && G.goalResultExperiencePass(r, cfg)),
    qGateReasons: q && q.gateReasons || [],
    qReasons: q && q.reasons || [],
    capacity: ca && {
      conserved: ca.conserved, aboveMax: ca.aboveMax, belowMin: ca.belowMin,
      microCars: ca.microCars, minCap: ca.minCap, maxCap: ca.maxCap,
      boardFloorPass: ca.boardFloorPass
    },
    actualBoard: level ? { rows: level.board.rows, cols: level.board.cols } : null,
    hash: level ? hash(level) : null,
    error: r && r.error || null
  };
  console.log(JSON.stringify(rec));
  return rec;
}
const A = load();
const rows = [];
for (const seed of SEEDS) for (const arm of ARMS) rows.push(run(A, seed, arm));
const byArm = {};
for (const arm of ARMS) {
  const a = rows.filter(x => x.arm === arm.id);
  byArm[arm.id] = {
    runs: a.length, valid: a.filter(x => x.valid).length,
    struct: a.filter(x => x.struct).length, pass: a.filter(x => x.pass).length,
    blackPct: a.map(x => x.blackPct), freeRun: a.map(x => x.freeRunMax),
    mid: a.map(x => x.midBuffer34Pct), boxes: a.map(x => x.boxes),
    capacityBad: a.filter(x => !x.capacity || !x.capacity.conserved || x.capacity.aboveMax > 0).map(x => x.seed)
  };
}
const summary = {
  image: '007', seeds: SEEDS, arms: ARMS.map(x => x.id), rows: rows.length,
  valid: rows.filter(x => x.valid).length,
  byArm,
  black20: rows.filter(x => x.blackPct != null && x.blackPct <= 20).map(x => x.arm + '/' + x.seed),
  targetCarsReached: rows.filter(x => x.targetCars && x.boxes != null && x.boxes >= x.targetCars).length,
  acceptablePass: rows.filter(x => x.pass && x.blackPct != null && x.blackPct <= 20).length,
  structurePass: rows.filter(x => x.struct).map(x => x.arm + '/' + x.seed),
  targetPass: rows.filter(x => x.pass).map(x => x.arm + '/' + x.seed),
  capacityBad: rows.filter(x => !x.capacity || !x.capacity.conserved || x.capacity.aboveMax > 0).map(x => x.arm + '/' + x.seed),
  decision: rows.some(x => x.pass && x.blackPct != null && x.blackPct <= 20)
    ? '出现“黑块≤20%+完整目标通过”的实验候选，可扩大样本。'
    : '[20,40]没有同时达到黑块≤20%和完整目标通过；targetCarCount 41/46/52 实际仍为36 boxes，先修目标车数落位，再测更小棋盘。'
};
const report = { schema: 'board-capacity-matrix-v1', date: '2026-10-26',
  preregistration: '棋盘容量矩阵_预登记_v543.md', summary, rows };
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary }, null, 2));
if (summary.capacityBad.length) process.exitCode = 1;
