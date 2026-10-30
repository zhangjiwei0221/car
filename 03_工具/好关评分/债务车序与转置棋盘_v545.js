#!/usr/bin/env node
/** v545：固定[20,40]/52车，测试债务车序策略和7×9/9×7转置棋盘。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const SHAPES = [{ id: '7x9', rows: 7, cols: 9 }, { id: '9x7', rows: 9, cols: 7 }];
const POLICIES = [
  { id: 'targetBuffer', value: 'targetBuffer' },
  { id: 'mixedDebt', value: 'mixedDebt' },
  { id: 'shortDebt', value: 'shortDebt' }
];
const SEEDS = [1001, 1002, 32677];
const OUT = path.resolve(ROOT, '03_工具/好关评分/债务车序与转置棋盘_v545.json');
const requestedOut = process.argv.find(x => x.startsWith('--out='));
const outPath = requestedOut ? path.resolve(ROOT, requestedOut.slice(6)) : OUT;
function load() {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function cfgFor(G, seed, shape, policy) {
  return {
    seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: 20, boxSizeMax: 40, capNormMin: 20, capNormMax: 40,
    boardRowsMin: shape.rows, boardRowsMax: shape.rows,
    boardColsMin: shape.cols, boardColsMax: shape.cols,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: policy.value, instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanDebtEvery: 2,
    instantPlanBranchCount: 2, instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 8, targetCarCount: 52, blackPercent: 10,
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
function run(A, seed, shape, policy) {
  const G = A.Generator, EG = A.ExperienceGoal;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const cfg = cfgFor(G, seed, shape, policy);
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
    shape: shape.id, seed, policy: policy.id,
    actualBoard: level ? { rows: level.board.rows, cols: level.board.cols } : null,
    targetCars: 52, actualBoxes: level ? countBoxes(level) : null,
    exactTarget: !!(level && countBoxes(level) === 52),
    blackPct: level ? blackPct(level) : null,
    wallMs: Date.now() - t0, valid: !!(r && r.valid),
    rounds: r && r.goalRounds || 0, stop: r && r.goalStopReason || null,
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
    instantPlan: r && r.config && r.config._instantPlayoutStat || null,
    hash: level ? hash(level) : null,
    error: r && r.error || null
  };
  console.log(JSON.stringify(rec));
  return rec;
}
const A = load();
const rows = [];
for (const shape of SHAPES) for (const policy of POLICIES) for (const seed of SEEDS) rows.push(run(A, seed, shape, policy));
const byCell = {};
for (const shape of SHAPES) for (const policy of POLICIES) {
  const a = rows.filter(x => x.shape === shape.id && x.policy === policy.id);
  byCell[shape.id + '/' + policy.id] = {
    runs: a.length, exactTarget: a.filter(x => x.exactTarget).length,
    exactCapacity: a.filter(x => x.capacity && x.capacity.conserved && x.capacity.aboveMax === 0 && x.capacity.belowMin === 0).length,
    black20: a.filter(x => x.blackPct != null && x.blackPct <= 20).length,
    mid50: a.filter(x => x.midBuffer34Pct != null && x.midBuffer34Pct >= 50).length,
    struct: a.filter(x => x.struct).length, pass: a.filter(x => x.pass).length,
    mid: a.map(x => x.midBuffer34Pct), freeRun: a.map(x => x.freeRunMax),
    black: a.map(x => x.blackPct)
  };
}
const candidates = rows.filter(x => x.exactTarget && x.capacity && x.capacity.conserved &&
  x.capacity.aboveMax === 0 && x.capacity.belowMin === 0 && x.blackPct <= 20 && x.midBuffer34Pct >= 50);
const summary = {
  image: '007', shapes: SHAPES.map(x => x.id), policies: POLICIES.map(x => x.id), seeds: SEEDS,
  rows: rows.length, valid: rows.filter(x => x.valid).length,
  exactTarget: rows.filter(x => x.exactTarget).length,
  capacityOk: rows.filter(x => x.capacity && x.capacity.conserved && x.capacity.aboveMax === 0 && x.capacity.belowMin === 0).length,
  black20: rows.filter(x => x.blackPct != null && x.blackPct <= 20).length,
  highPressure: rows.filter(x => x.midBuffer34Pct != null && x.midBuffer34Pct >= 50).length,
  struct: rows.filter(x => x.struct).length, targetPass: rows.filter(x => x.pass).length,
  byCell,
  candidateSamples: candidates.map(x => x.shape + '/' + x.policy + '/' + x.seed),
  decision: candidates.length
    ? '出现目标车数/黑块/容量/高压同时成立的样本，可扩大样本并比较转置稳定性。'
    : '车数/黑块/容量已成立，但债务策略仍未形成中段3/4高压；继续拆解债务形成。'
};
const report = { schema: 'debt-order-transpose-v1', date: '2026-10-26',
  preregistration: '债务车序与转置棋盘_预登记_v545.md', summary, rows };
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary }, null, 2));
if (summary.capacityOk !== rows.length) process.exitCode = 1;
