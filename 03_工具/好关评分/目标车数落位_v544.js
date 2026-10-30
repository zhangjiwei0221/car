#!/usr/bin/env node
/** v544：验证InstantPlayout按targetCarCount落车，保持[20,40]容量合同。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const ARMS = [
  { id: 'B', rows: 7, cols: 7, targetCars: 41 },
  { id: 'C', rows: 7, cols: 8, targetCars: 46 },
  { id: 'D', rows: 7, cols: 9, targetCars: 52 }
];
const args = process.argv.slice(2);
function opt(name, fallback) {
  const eq = args.find(x => x.startsWith('--' + name + '='));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
}
const seeds = opt('seeds', '1001,1002,32677').split(',').map(Number).filter(Number.isFinite);
const armIds = opt('arms', 'B,C,D').split(',').filter(Boolean);
const selectedArms = ARMS.filter(x => armIds.indexOf(x.id) >= 0);
const OUT = path.resolve(ROOT, opt('out', '03_工具/好关评分/目标车数落位_v544.json'));
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
    boxSizeMin: 20, boxSizeMax: 40, capNormMin: 20, capNormMax: 40,
    boardRowsMin: arm.rows, boardRowsMax: arm.rows,
    boardColsMin: arm.cols, boardColsMax: arm.cols,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true, instantPlanBranchPrefixDebts: 8,
    targetCarCount: arm.targetCars, blackPercent: 10,
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
  const ip = level && level.board && level.board.instantPlanCells
    ? { cells: level.board.instantPlanCells.length } : null;
  const rec = {
    arm: arm.id, seed, board: `${arm.rows}x${arm.cols}`,
    targetCars: arm.targetCars, actualBoxes: level ? countBoxes(level) : null,
    exactTarget: !!(level && countBoxes(level) === arm.targetCars),
    wallMs: Date.now() - t0, valid: !!(r && r.valid), rounds: r && r.goalRounds || 0,
    stop: r && r.goalStopReason || null,
    blackPct: level ? blackPct(level) : null,
    freeRunMax: fc.freeRunMax != null ? fc.freeRunMax : null,
    midBuffer34Pct: ev && ev.metrics && ev.metrics.midBuffer34Pct,
    maxBuffer: ev && ev.metrics && ev.metrics.maxBuffer,
    significantReleaseCount: ev && ev.metrics && ev.metrics.significantReleaseCount,
    solverRelease: ev && ev.releaseDecision && ev.releaseDecision.status,
    struct: !!(level && G.goalStructPass(r)),
    pass: !!(level && G.goalResultExperiencePass(r, cfg)),
    qGateReasons: q && q.gateReasons || [],
    capacity: ca && {
      conserved: ca.conserved, aboveMax: ca.aboveMax, belowMin: ca.belowMin,
      microCars: ca.microCars, minCap: ca.minCap, maxCap: ca.maxCap,
      boardFloorPass: ca.boardFloorPass
    },
    instantPlan: ip, actualBoard: level ? { rows: level.board.rows, cols: level.board.cols } : null,
    hash: level ? hash(level) : null, error: r && r.error || null
  };
  console.log(JSON.stringify(rec));
  return rec;
}
const A = load();
const rows = [];
for (const seed of seeds) for (const arm of selectedArms) rows.push(run(A, seed, arm));
const summary = {
  image: '007', seeds, arms: selectedArms.map(x => x.id), rows: rows.length,
  valid: rows.filter(x => x.valid).length,
  exactTarget: rows.filter(x => x.exactTarget).length,
  capacityOk: rows.filter(x => x.capacity && x.capacity.conserved && x.capacity.aboveMax === 0 &&
    x.capacity.belowMin === 0 && (!x.capacity.microCars || x.capacity.microCars.length === 0)).length,
  black20: rows.filter(x => x.blackPct != null && x.blackPct <= 20).length,
  highPressure: rows.filter(x => x.midBuffer34Pct != null && x.midBuffer34Pct >= 50).length,
  struct: rows.filter(x => x.struct).length,
  targetPass: rows.filter(x => x.pass).length,
  decision: rows.some(x => x.exactTarget && x.capacity && x.capacity.belowMin === 0 && x.blackPct <= 20 && x.midBuffer34Pct >= 50)
    ? '目标车数落位且黑块/高压同时出现正信号，可扩大样本。'
    : (rows.some(x => !x.exactTarget)
      ? '目标车数仍未全部落地，先修规格/落位链，不进入质量结论。'
      : '目标车数已落地但质量尚未同时通过。')
};
const report = { schema: 'target-car-count-placement-v1', date: '2026-10-26',
  preregistration: '目标车数落位_预登记_v544.md', summary, rows };
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary }, null, 2));
if (!rows.every(x => x.exactTarget && x.capacity && x.capacity.conserved && x.capacity.aboveMax === 0 && x.capacity.belowMin === 0)) process.exitCode = 1;
