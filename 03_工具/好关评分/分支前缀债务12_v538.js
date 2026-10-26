#!/usr/bin/env node
/** v538：007上只比较 instantPlanBranchPrefixDebts 8 vs 12。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'release-route-constructor.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const SEEDS = [1001, 1002, 88001, 32677];
const outPath = path.resolve(ROOT, '03_工具/好关评分/分支前缀债务12_v538.json');
function load() {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function configFor(G, blocks, seed, prefixDebts) {
  const band = G.deriveCapacityBand(blocks);
  return {
    seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1],
    capNormMin: band.band[0], capNormMax: band.band[1],
    boardRowsMin: 7, boardRowsMax: 7, boardColsMin: 8, boardColsMax: 8,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true, instantPlanBranchPrefixDebts: prefixDebts,
    experienceGoal: true, instantReleaseRoute: false,
    goalPerRoundMs: 20000, goalMaxMs: 30000, goalMaxRounds: 2,
    goalSharedBudget: true, candidateCount: 1, acceptMode: 'target',
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0,
    capacityTuneMs: 2000, capacityTuneCars: 4, capacityTuneVariants: 12
  };
}
function run(A, seed, prefixDebts) {
  const G = A.Generator, blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const cfg = configFor(G, blocks, seed, prefixDebts);
  const t0 = Date.now();
  let r = null;
  try { r = G.produceGoal(blocks, cfg); }
  catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const q = r && r.level ? A.Quality.fromGeneration(r) : null;
  const fc = r && r.goodV3 && r.goodV3.fillCurve || {};
  const ev = r && r.level ? A.ExperienceGoal.evaluate(r.level, {
    solveResult: r.solveResult, decision: false, instantChain: true
  }) : null;
  const cap = r && r.level ? A.Quality.capacityEvidence(r.level, r.config || cfg) : null;
  const rec = {
    seed, prefixDebts, wallMs: Date.now() - t0,
    valid: !!(r && r.valid), struct: !!(r && r.level && G.goalStructPass(r)),
    pass: !!(r && r.level && G.goalResultExperiencePass(r, cfg)),
    freeRunMax: fc.freeRunMax != null ? fc.freeRunMax : null,
    freeLowPct: fc.freeLowPct != null ? fc.freeLowPct : null,
    fullMedian2: fc.fullMedian2 != null ? fc.fullMedian2 : null,
    solverMid: ev && ev.metrics && ev.metrics.midBuffer34Pct,
    solverMax: ev && ev.metrics && ev.metrics.maxBuffer,
    release: ev && ev.releaseDecision && ev.releaseDecision.status,
    qGateReasons: q && q.gateReasons || [],
    capacity: cap && {
      conserved: cap.conserved, aboveMax: cap.aboveMax, belowMin: cap.belowMin,
      microCars: cap.microCars, minCap: cap.minCap, maxCap: cap.maxCap
    },
    board: r && r.level ? { rows: r.level.board.rows, cols: r.level.board.cols } : null,
    hash: r && r.level ? hash(r.level) : null,
    error: r && r.error || null
  };
  console.log(JSON.stringify(rec));
  return rec;
}
const A = load();
const rows = [];
for (const seed of SEEDS) for (const prefixDebts of [8, 12]) rows.push(run(A, seed, prefixDebts));
const pairs = SEEDS.map(seed => {
  const a = rows.find(x => x.seed === seed && x.prefixDebts === 8);
  const b = rows.find(x => x.seed === seed && x.prefixDebts === 12);
  return {
    seed,
    freeRun: [a.freeRunMax, b.freeRunMax],
    freeRunDrop2: a.freeRunMax != null && b.freeRunMax != null && b.freeRunMax <= a.freeRunMax - 2,
    solverMid: [a.solverMid, b.solverMid],
    highPressureKept: b.solverMid != null && b.solverMid >= 50,
    struct: [a.struct, b.struct],
    sameHash: a.hash === b.hash,
    capacityOk: !!(b.capacity && b.capacity.conserved && b.capacity.aboveMax === 0 && (!b.capacity.microCars || b.capacity.microCars.length === 0))
  };
});
const summary = {
  image: '007', seeds: SEEDS, rows: rows.length,
  valid: rows.filter(x => x.valid).length,
  structA: rows.filter(x => x.prefixDebts === 8 && x.struct).length,
  structB: rows.filter(x => x.prefixDebts === 12 && x.struct).length,
  freeRunDrop2: pairs.filter(x => x.freeRunDrop2).length,
  highPressureKept: pairs.filter(x => x.highPressureKept).length,
  capacityRegressions: pairs.filter(x => !x.capacityOk).map(x => x.seed),
  strongPass: pairs.filter(x => !x.struct[0] && x.struct[1] && x.highPressureKept && x.capacityOk).length,
  decision: pairs.filter(x => x.freeRunDrop2 && x.highPressureKept && x.capacityOk).length >= 2
    ? '8→12有可用信号，保留为后续候选，不直接进默认。'
    : '8→12没有达到至少2/4 seed的有价值改善，回退到8并改用下一单因素。'
};
const report = { schema: 'instant-plan-branch-prefix-debt-v1', date: '2026-10-26',
  preregistration: '分支前缀债务12_预登记_v538.md', summary, pairs, rows };
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary, pairs }, null, 2));
if (summary.capacityRegressions.length) process.exitCode = 1;
