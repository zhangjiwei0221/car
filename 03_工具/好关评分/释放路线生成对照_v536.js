#!/usr/bin/env node
/** v536：同图/同seed目标模式 A/B：是否把完整释放路线证据接入候选选择。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'release-route-constructor.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'];
function opt(n, d) {
  const i = process.argv.indexOf('--' + n);
  if (i >= 0 && process.argv[i + 1] != null) return process.argv[i + 1];
  const eq = process.argv.find(x => x.startsWith('--' + n + '='));
  return eq != null ? eq.slice(('--' + n + '=').length) : d;
}
const ALL_IMAGES = ['007', '006', '010'];
const ALL_SEEDS = [1001, 1002, 88001, 32677];
const imageIds = opt('images', ALL_IMAGES.join(',')).split(',').map(x => x.trim()).filter(Boolean);
const seeds = opt('seeds', ALL_SEEDS.join(',')).split(',').map(x => +x).filter(x => Number.isFinite(x));
const budgetMs = +opt('budget', '30000');
const roundMs = +opt('round', '20000');
const maxRounds = +opt('max-rounds', '2');
const outPath = path.resolve(ROOT, opt('out', '03_工具/好关评分/释放路线生成对照_v536.json'));
const images = {
  '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
  '007': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt',
  '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt'
};
const specs = {
  '006': { rows: 6, cols: 6, prefixDebts: 6 },
  '007': { rows: 7, cols: 8, prefixDebts: 8 },
  '010': { rows: 6, cols: 6, prefixDebts: 2 }
};
function loadArm() {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
function hash(x) {
  return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
}
function blackPct(level) {
  let n = 0, black = 0;
  for (const row of level.board.cells) for (const cell of row) {
    n++;
    if (cell && cell.t === 'black') black++;
  }
  return n ? +(black / n * 100).toFixed(1) : null;
}
function cfgFor(A, blocks, spec, seed, instantReleaseRoute) {
  const band = A.Generator.deriveCapacityBand(blocks);
  return {
    seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1],
    capNormMin: band.band[0], capNormMax: band.band[1],
    boardRowsMin: spec.rows, boardRowsMax: spec.rows,
    boardColsMin: spec.cols, boardColsMax: spec.cols,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true, instantPlanBranchPrefixDebts: spec.prefixDebts,
    experienceGoal: true, instantReleaseRoute: !!instantReleaseRoute,
    goalPerRoundMs: roundMs, goalMaxMs: budgetMs, goalMaxRounds: maxRounds,
    goalSharedBudget: true, candidateCount: 1, acceptMode: 'target',
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0,
    capacityTuneMs: 2000, capacityTuneCars: 4, capacityTuneVariants: 12
  };
}
function run(A, image, seed, arm) {
  const G = A.Generator, EG = A.ExperienceGoal;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, images[image]), 'utf8'));
  const cfg = cfgFor(A, blocks, specs[image], seed, arm === 'on');
  const t0 = Date.now();
  let r = null;
  try { r = G.produceGoal(blocks, cfg); }
  catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const wallMs = Date.now() - t0;
  const ev = r && r._experienceFull || (r && r.level ? EG.evaluate(r.level, {
    solveResult: r.solveResult, decision: true, instantChain: true
  }) : null);
  const cap = r && r.level ? A.Quality.capacityEvidence(r.level, r.config || cfg) : null;
  const rr = r && r.instantReleaseRouteEvidence || null;
  const q = r && r.level ? A.Quality.fromGeneration(r) : null;
  const rec = {
    arm, image, seed, wallMs, rounds: r && r.goalRounds || 0,
    stop: r && r.goalStopReason || null, valid: !!(r && r.valid),
    struct: !!(r && r.level && G.goalStructPass(r)),
    pass: !!(r && r.level && G.goalResultExperiencePass(r, cfg)),
    acceptedByReleaseRoute: !!(r && r.acceptedByReleaseRoute),
    solver: ev && {
      pass: ev.pass, midBuffer34Pct: ev.metrics && ev.metrics.midBuffer34Pct,
      maxBuffer: ev.metrics && ev.metrics.maxBuffer,
      significantReleaseCount: ev.metrics && ev.metrics.significantReleaseCount,
      releaseStatus: ev.releaseDecision && ev.releaseDecision.status
    },
    releaseRoute: rr && {
      pass: rr.pass, status: rr.status,
      tested: rr.summary && rr.summary.tested,
      unique: rr.summary && rr.summary.unique,
      searchMs: rr.summary && rr.summary.searchMs,
      best: rr.best
    },
    capacity: cap && {
      cars: cap.cars, minCap: cap.minCap, maxCap: cap.maxCap,
      belowMin: cap.belowMin, aboveMax: cap.aboveMax,
      conserved: cap.conserved, boardFloorPass: cap.boardFloorPass,
      microCars: cap.microCars
    },
    board: r && r.level ? { rows: r.level.board.rows, cols: r.level.board.cols } : null,
    blackPct: r && r.level ? blackPct(r.level) : null,
    hash: r && r.level ? hash(r.level) : null,
    qReasons: q && q.reasons, qGateReasons: q && q.gateReasons,
    error: r && r.error || null,
    level: r && r.level || null
  };
  console.log(JSON.stringify({
    arm, image, seed, wallMs, rounds: rec.rounds, valid: rec.valid,
    struct: rec.struct, pass: rec.pass, accepted: rec.acceptedByReleaseRoute,
    solverMid: rec.solver && rec.solver.midBuffer34Pct,
    solverRelease: rec.solver && rec.solver.releaseStatus,
    routePass: rec.releaseRoute && rec.releaseRoute.pass,
    blackPct: rec.blackPct
  }));
  return rec;
}
const A = loadArm();
const rows = [];
for (const image of imageIds) {
  for (const seed of seeds) {
    for (const arm of ['off', 'on']) rows.push(run(A, image, seed, arm));
  }
}
const pairs = [];
for (const image of imageIds) for (const seed of seeds) {
  const a = rows.find(x => x.arm === 'off' && x.image === image && x.seed === seed);
  const b = rows.find(x => x.arm === 'on' && x.image === image && x.seed === seed);
  pairs.push({
    image, seed,
    pass: [!!(a && a.pass), !!(b && b.pass)],
    rescue: !!(a && !a.pass && b && b.pass),
    regression: !!(a && a.pass && b && !b.pass),
    acceptedByReleaseRoute: !!(b && b.acceptedByReleaseRoute),
    sameHash: !!(a && b && a.hash && a.hash === b.hash),
    routePass: !!(b && b.releaseRoute && b.releaseRoute.pass),
    capacityRegression: !!(b && b.capacity && (b.capacity.aboveMax > 0 || b.capacity.microCars && b.capacity.microCars.length || b.capacity.conserved === false)),
    wallMs: [a && a.wallMs, b && b.wallMs]
  });
}
const summary = {
  images: imageIds, seeds, budgetMs, roundMs, maxRounds,
  runs: rows.length,
  pass: Object.fromEntries(['off', 'on'].map(arm => [arm, rows.filter(x => x.arm === arm && x.pass).length])),
  struct: Object.fromEntries(['off', 'on'].map(arm => [arm, rows.filter(x => x.arm === arm && x.struct).length])),
  releaseRoutePass: rows.filter(x => x.arm === 'on' && x.releaseRoute && x.releaseRoute.pass).length,
  acceptedByReleaseRoute: rows.filter(x => x.arm === 'on' && x.acceptedByReleaseRoute).length,
  rescues: pairs.filter(x => x.rescue).map(x => x.image + '/' + x.seed),
  regressions: pairs.filter(x => x.regression).map(x => x.image + '/' + x.seed),
  knownSuccessRegressions: pairs.filter(x => x.seed === 1001 && x.regression).map(x => x.image),
  capacityRegressions: pairs.filter(x => x.capacityRegression).map(x => x.image + '/' + x.seed),
  totalWallMs: Object.fromEntries(['off', 'on'].map(arm => [arm, rows.filter(x => x.arm === arm).reduce((n, x) => n + x.wallMs, 0)]))
};
const report = { schema: 'instant-release-route-generation-ab-v1', date: '2026-10-26',
  preregistration: '释放路线生成接线_预登记_v536.md', summary, pairs, rows };
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary, pairs }, null, 2));
if (summary.knownSuccessRegressions.length || summary.capacityRegressions.length) process.exitCode = 1;
