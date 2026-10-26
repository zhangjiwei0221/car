#!/usr/bin/env node
/** v535：用通用释放路线构造模块复跑007/006/010，记录完整路线与耗时。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'release-route-constructor.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
  WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator, RRC = A.ReleaseRouteConstructor;
const ALL = [
  { id: '007', rows: 7, cols: 8, prefixDebts: 8 },
  { id: '006', rows: 6, cols: 6, prefixDebts: 6 },
  { id: '010', rows: 6, cols: 6, prefixDebts: 2 }
];
const argImages = (process.argv.find(x => x.startsWith('--images=')) || '').split('=')[1];
const wanted = argImages ? new Set(argImages.split(',').map(x => x.trim()).filter(Boolean)) : null;
const specs = ALL.filter(s => !wanted || wanted.has(s.id));
function planRoute(level) {
  return (level.board.instantPlanCells || []).map((p, i) => ({
    r: p.r, c: p.c, color: p.color, count: p.count, step: i, chainIndex: 0
  }));
}
function blackPct(level) {
  let cells = 0, black = 0;
  for (const row of level.board.cells) for (const cell of row) {
    cells++;
    if (cell && cell.t === 'black') black++;
  }
  return cells ? +(black / cells * 100).toFixed(1) : null;
}
function baseline(level, route, label) {
  const metrics = RRC.metricsOf(level, route, {});
  return Object.assign({ source: label, steps: (route || []).length }, metrics);
}
const out = {
  schema: 'release-route-constructor-multi-v1', date: '2026-10-26',
  preregistration: '释放路线构造模块_预登记_v535.md',
  config: { seed: 1001, ruleMode: 'instantChain', targetBuffer: 4, maxDebt: 40,
    branchCount: 2, p7BaseCount: 0, trapPost: false,
    constructor: RRC.DEFAULTS }, images: [], summary: null
};
const allT0 = Date.now();
for (const spec of specs) {
  const imageT0 = Date.now();
  const blocks = G.blocksFromTXT(fs.readFileSync(
    path.join(ROOT, '蚂蚁图库', '拼接图', '拼接图图库', `35x35拼接图纸_${spec.id}.txt`), 'utf8'));
  const band = G.deriveCapacityBand(blocks);
  const cfg = {
    seed: 1001, candidateCount: 1, rounds: 0, timeBudgetMs: 12000,
    ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1],
    capNormMin: band.band[0], capNormMax: band.band[1],
    boardRowsMin: spec.rows, boardRowsMax: spec.rows,
    boardColsMin: spec.cols, boardColsMax: spec.cols,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true, instantPlanBranchPrefixDebts: spec.prefixDebts
  };
  const genT0 = Date.now();
  const generated = G.produceFixed(blocks, cfg);
  const generationMs = Date.now() - genT0;
  if (!generated || !generated.level) {
    out.images.push({ image: spec.id, prefixDebts: spec.prefixDebts, generationMs,
      generated: false, reason: generated && generated.lastFailReason || 'no_level' });
    console.log(JSON.stringify({ image: spec.id, generated: false, generationMs }));
    continue;
  }
  const level = generated.level;
  const solverRoute = generated.solveResult && generated.solveResult.pickOrder || [];
  const plan = planRoute(level);
  const sources = [
    { name: 'solver', pickOrder: solverRoute },
    { name: 'plan', pickOrder: plan }
  ];
  const constructed = RRC.construct(level, sources, {});
  const cap = A.Quality.capacityEvidence(level, generated.config || cfg);
  const row = {
    image: spec.id, prefixDebts: spec.prefixDebts, generationMs,
    totalMs: Date.now() - imageT0, searchMs: constructed.summary.wallMs,
    generated: true, structural: generated.structural || null,
    board: { rows: level.board.rows, cols: level.board.cols },
    blackPct: blackPct(level),
    capacity: {
      conserved: cap.conserved, aboveMax: cap.aboveMax, belowMin: cap.belowMin,
      microCars: cap.microCars, minCap: cap.minCap, maxCap: cap.maxCap
    },
    baselines: [baseline(level, solverRoute, 'solver'), baseline(level, plan, 'plan')],
    constructor: constructed.summary,
    best: constructed.summary.best,
    level
  };
  out.images.push(row);
  console.log(JSON.stringify({
    image: spec.id, generationMs, searchMs: row.searchMs, blackPct: row.blackPct,
    tested: row.constructor.tested, unique: row.constructor.unique,
    duplicates: row.constructor.duplicates, pass: row.constructor.pass,
    best: row.best && {
      source: row.best.source, fullSteps: row.best.fullSteps,
      midBuffer34Pct: row.best.midBuffer34Pct, maxBuffer: row.best.maxBuffer,
      significantReleaseCount: row.best.significantReleaseCount,
      changedAction: row.best.changedAction
    }
  }));
}
const passing = out.images.filter(x => x.generated && x.constructor && x.constructor.pass > 0);
out.summary = {
  images: out.images.length, generated: out.images.filter(x => x.generated).length,
  passingImages: passing.length,
  passingIds: passing.map(x => x.image),
  totalWallMs: Date.now() - allT0,
  allPass: passing.length === out.images.length,
  decision: passing.length === out.images.length
    ? '三图均构造出完整高压释放路线；下一步做生成候选接线与多seed成本验证。'
    : '未达三图全通过；保留成功图证据，失败图不得用单步释放或未知结果代替。'
};
const outPath = path.join(__dirname, '释放路线构造多图_v535.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.summary, null, 2));
