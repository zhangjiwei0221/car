#!/usr/bin/env node
/** v547：固定shortDebt/7x9/9x7/52车/[20,40]，只比较分支前缀债务8与12。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const SHAPES = [{ id: '7x9', rows: 7, cols: 9 }, { id: '9x7', rows: 9, cols: 7 }];
const SEEDS = [1001, 1002, 32677];
const PREFIX_ARMS = [8, 12];
const OUT = path.resolve(ROOT, '03_工具/好关评分/短债前缀8与12_v547.json');
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
function median(a) {
  const s = a.filter(x => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(2);
}

function cfgFor(seed, shape, prefixDebts) {
  return {
    seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: 20, boxSizeMax: 40, capNormMin: 20, capNormMax: 40,
    boardRowsMin: shape.rows, boardRowsMax: shape.rows,
    boardColsMin: shape.cols, boardColsMax: shape.cols,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'shortDebt', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanDebtEvery: 2,
    instantPlanBranchCount: 2, instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: prefixDebts,
    targetCarCount: 52, blackPercent: 10,
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

function run(A, seed, shape, prefixDebts) {
  const G = A.Generator, EG = A.ExperienceGoal;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const cfg = cfgFor(seed, shape, prefixDebts);
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
  const capacityOk = !!(ca && ca.conserved && ca.aboveMax === 0 && ca.belowMin === 0 &&
    ca.boardFloorPass !== false && ca.minCap >= 20 && ca.maxCap <= 40);
  const rec = {
    shape: shape.id, seed, prefixDebts,
    actualBoard: level ? { rows: level.board.rows, cols: level.board.cols } : null,
    targetCars: 52, actualBoxes: level ? countBoxes(level) : null,
    exactTarget: !!(level && countBoxes(level) === 52),
    blackPct: level ? blackPct(level) : null,
    capacityOk,
    wallMs: Date.now() - t0, valid: !!(r && r.valid),
    rounds: r && r.goalRounds || 0, stop: r && r.goalStopReason || null,
    freeRunMax: fc.freeRunMax != null ? fc.freeRunMax : null,
    freeLowPct: fc.freeLowPct != null ? fc.freeLowPct : null,
    fullMedian2: fc.fullMedian2 != null ? fc.fullMedian2 : null,
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
for (const shape of SHAPES) for (const seed of SEEDS) for (const prefixDebts of PREFIX_ARMS) {
  rows.push(run(A, seed, shape, prefixDebts));
}

const pairs = [];
for (const shape of SHAPES) for (const seed of SEEDS) {
  const a = rows.find(x => x.shape === shape.id && x.seed === seed && x.prefixDebts === 8);
  const b = rows.find(x => x.shape === shape.id && x.seed === seed && x.prefixDebts === 12);
  const p0Ok = !!(b && b.valid && b.exactTarget && b.capacityOk && b.blackPct != null && b.blackPct <= 20 &&
    b.actualBoard && b.actualBoard.rows === shape.rows && b.actualBoard.cols === shape.cols);
  const freeRunDrop2 = !!(a && b && a.freeRunMax != null && b.freeRunMax != null && b.freeRunMax <= a.freeRunMax - 2);
  const fullMedian3 = !!(b && b.fullMedian2 != null && b.fullMedian2 <= 3);
  const mid50 = !!(b && b.midBuffer34Pct != null && b.midBuffer34Pct >= 50);
  pairs.push({
    shape: shape.id, seed,
    freeRun: [a && a.freeRunMax, b && b.freeRunMax],
    fullMedian2: [a && a.fullMedian2, b && b.fullMedian2],
    midBuffer34Pct: [a && a.midBuffer34Pct, b && b.midBuffer34Pct],
    blackPct: [a && a.blackPct, b && b.blackPct],
    freeRunDrop2, fullMedian3, mid50, p0Ok,
    valuableSignal: !!(freeRunDrop2 && fullMedian3 && mid50 && p0Ok),
    struct: [!!(a && a.struct), !!(b && b.struct)],
    pass: [!!(a && a.pass), !!(b && b.pass)],
    capacityOk: [!!(a && a.capacityOk), !!(b && b.capacityOk)],
    sameHash: !!(a && b && a.hash === b.hash)
  });
}

function armSummary(prefixDebts) {
  const a = rows.filter(x => x.prefixDebts === prefixDebts);
  return {
    runs: a.length,
    valid: a.filter(x => x.valid).length,
    exactTarget: a.filter(x => x.exactTarget).length,
    capacityOk: a.filter(x => x.capacityOk).length,
    black20: a.filter(x => x.blackPct != null && x.blackPct <= 20).length,
    mid50: a.filter(x => x.midBuffer34Pct != null && x.midBuffer34Pct >= 50).length,
    fullMedian3: a.filter(x => x.fullMedian2 != null && x.fullMedian2 <= 3).length,
    struct: a.filter(x => x.struct).length,
    pass: a.filter(x => x.pass).length,
    freeRunMedian: median(a.map(x => x.freeRunMax)),
    fullMedian2Median: median(a.map(x => x.fullMedian2)),
    midBuffer34Median: median(a.map(x => x.midBuffer34Pct)),
    wallMs: a.map(x => x.wallMs)
  };
}

const byArm = { 8: armSummary(8), 12: armSummary(12) };
function boardShapeOk(x) {
  const shape = SHAPES.find(s => s.id === x.shape);
  return !!(shape && x.actualBoard && x.actualBoard.rows === shape.rows && x.actualBoard.cols === shape.cols);
}
const boardShapeOkCount = rows.filter(boardShapeOk).length;
const p0Failures = rows.filter(x => !(x.valid && x.exactTarget && x.capacityOk &&
  x.blackPct != null && x.blackPct <= 20 && boardShapeOk(x)));
const valuableSignal = pairs.filter(x => x.valuableSignal).length;
const structureNotWorse = byArm[12].struct >= byArm[8].struct;
const passNotWorse = byArm[12].pass >= byArm[8].pass;
const accepted = p0Failures.length === 0 && valuableSignal >= 2 && structureNotWorse && passNotWorse;
const summary = {
  image: '007', shapes: SHAPES.map(x => x.id), seeds: SEEDS,
  prefixArms: PREFIX_ARMS, policy: 'shortDebt', rows: rows.length,
  valid: rows.filter(x => x.valid).length,
  exactTarget: rows.filter(x => x.exactTarget).length,
  capacityOk: rows.filter(x => x.capacityOk).length,
  black20: rows.filter(x => x.blackPct != null && x.blackPct <= 20).length,
  boardShapeOk: boardShapeOkCount,
  p0Failures: p0Failures.map(x => x.shape + '/seed' + x.seed + '/prefix' + x.prefixDebts),
  byArm,
  valuableSignal,
  structureNotWorse, passNotWorse,
  decision: accepted
    ? '≥2/6配对同时改善免费连、吃满中位并保持高压，结构/目标未退化；保留为下一轮局部车序实验候选，不直接进默认。'
    : '未达到2/6配对的有价值信号，或P0/结构/目标退化；保留prefix=8，停止继续加码该参数。'
};
const report = {
  schema: 'short-debt-prefix-8-12-v547',
  date: '2026-10-26',
  preregistration: '短债前缀8与12_预登记_v547.md',
  summary, pairs, rows
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary, pairs }, null, 2));
if (p0Failures.length || !structureNotWorse || !passNotWorse) process.exitCode = 1;
