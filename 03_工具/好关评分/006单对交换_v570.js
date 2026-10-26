#!/usr/bin/env node
/** v570 P2：只交换006/1001两辆普通车的数据，沿原计划路线验证中段压力。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const SOURCE_DIR = path.join(__dirname, '目标分支策略矩阵_v570.levels');
const BASELINE_LEVEL_PATH = path.join(SOURCE_DIR, '006_1001_A_base_shortDebt.json');
const BASELINE_ROUTE_PATH = path.join(SOURCE_DIR, '006_1001_A_base_shortDebt.route.json');
const OUT = path.join(__dirname, '006单对交换_v570.json');
const LEVEL_DIR = path.join(__dirname, '006单对交换_v570.levels');
const CANDIDATE_LEVEL_PATH = path.join(LEVEL_DIR, '006_1001_candidate_color17_early.json');
const CANDIDATE_ROUTE_PATH = path.join(LEVEL_DIR, '006_1001_candidate_color17_early.route.json');
const IMAGE_PATH = path.join(ROOT, '蚂蚁图库', '拼接图', '拼接图图库', '35x35拼接图纸_006.txt');
const EXPECTED_BASELINE_HASH = 'f91d8cf7c70d33aea424a63c1d5c27518b7f0a3f90115d9616418c3250877205';
const SWAP_A = { r: 1, c: 4 };
const SWAP_B = { r: 3, c: 0 };
const OPTIONS = { instantChain: true, bottomOnly: false };
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];

function load() {
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}

function hash(x) {
  return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
}

function configFor(blocks, seed) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  return {
    seed,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantPlanPolicy: 'shortDebt',
    instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40,
    instantPlanDebtEvery: 4,
    instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 8,
    capScalePlan: null,
    boxSizeMin: b[0],
    boxSizeMax: b[1],
    capNormMin: b[0],
    capNormMax: b[1],
    cutMode: 'layerCut2',
    maxPipes: 2,
    chainByDemand: 4,
    iceForceSteps: 0,
    candidateCount: 14,
    boardRowsMin: 4,
    boardRowsMax: 6,
    boardColsMin: 6,
    boardColsMax: 8,
    boardHardRange: false,
    boardAuto: false,
    boardAllowSquare: true,
    boardExpandOnOverflow: true,
    boardFirst: true,
    boardFitGuard: 'warn',
    boardPrefer7: true,
    boardPrefer7Dims: null,
    p7BaseCount: 1,
    p7Repair: true,
    trapPost: false,
    pool: 1,
    semanticObstacles: true,
    usableSpaceTarget: 0.86,
    blackPercent: 10,
    narrowPath: true,
    experienceGoal: true,
    instantReleaseRoute: false,
    goalPerRoundMs: 20000,
    goalMaxMs: 40000,
    goalMaxRounds: 2,
    goalBases: 1,
    goalSharedBudget: true,
    portfolioK: 1,
    acceptMode: 'target',
    targetBand3Min: 0,
    targetBand4Min: 0,
    targetPlayerPassMin: 0,
    capacityTuneMs: 5000,
    capacityTuneCars: 8,
    capacityTuneVariants: 48,
    localSwapRepair: true,
    localSwapRepairMaxMs: 8000,
    localSwapStage1Pairs: 32,
    localSwapStage1Ms: 4000,
    localSwapStage2Pairs: 64,
    localSwapStage2Ms: 4000,
    maxDecisionStates: 8,
    stateSampleMode: 'midStratified',
    minReleaseAmplitude: 2,
    trapEvalMs: 3000
  };
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function colorSums(level) {
  const out = {};
  const board = level.board || {};
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const cell = board.cells[r] && board.cells[r][c];
      if (!cell) continue;
      if (cell.t === 'box') out[cell.color] = (out[cell.color] || 0) + (cell.count || 0);
      if (cell.t === 'pipe') {
        for (const b of cell.queue || []) out[b.color] = (out[b.color] || 0) + (b.count || 0);
      }
    }
  }
  return out;
}

function cellInfo(level, p) {
  const cell = level.board.cells[p.r] && level.board.cells[p.r][p.c];
  return cell ? {
    t: cell.t,
    color: cell.color == null ? null : cell.color,
    count: cell.count == null ? null : cell.count,
    q: !!cell.q,
    numice: cell.numice || 0,
    chain: cell.chain || 0
  } : null;
}

function makeCandidate(level) {
  const out = clone(level);
  const a = out.board.cells[SWAP_A.r][SWAP_A.c];
  const b = out.board.cells[SWAP_B.r][SWAP_B.c];
  if (!a || !b || a.t !== 'box' || b.t !== 'box') throw new Error('swap points are not ordinary boxes');
  if (a.q || b.q || a.chain || b.chain || a.numice || b.numice) throw new Error('swap points contain obstacles');
  const ac = a.color, an = a.count, bc = b.color, bn = b.count;
  a.color = bc;
  a.count = bn;
  b.color = ac;
  b.count = an;
  return out;
}

function evaluateRoute(A, rawLevel, route, cfg) {
  const level = A.parseLevel(rawLevel);
  const solveRoute = { completed: true, pickOrder: route };
  const replay = A.SolverAnalysis.replay(level, solveRoute, OPTIONS);
  const curve = A.Generator.choiceCurve(level, solveRoute, OPTIONS);
  const structure = A.Quality.fromGeneration({
    level,
    valid: true,
    config: cfg,
    goodV3: { fillCurve: curve, persist: {} }
  });
  const capacity = A.Quality.capacityEvidence(level, cfg);
  const experience = A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, OPTIONS, {
    solveResult: solveRoute,
    decision: true
  }));
  const player = A.PlayerSim.run(level, {
    seed: 7,
    useItems: false,
    reviveCap: 0,
    capturePreviewStats: true,
    instantChain: true,
    bottomOnly: false
  });
  return {
    level,
    replay,
    curve,
    structure,
    capacity,
    experience,
    player
  };
}

function qPassDiagnostic(A, rawLevel, cfg) {
  const ev = A.Generator.evaluateLevel(rawLevel, cfg);
  if (!ev || !ev.goodV3) {
    return { available: false, reason: 'evaluateLevel_no_verified_solution_or_metrics' };
  }
  const q = A.Quality.fromGeneration(ev);
  return {
    available: true,
    pass: !!q.pass,
    label: q.label,
    reasons: q.reasons || [],
    gatePass: !!q.gatePass,
    gateReasons: q.gateReasons || [],
    solverRouteSteps: ev.solveResult && ev.solveResult.pickOrder && ev.solveResult.pickOrder.length || null,
    note: '只读诊断；该路线可能不同于生成器原计划路线，不能替代原路线验收。'
  };
}

function coreResult(ev) {
  const release = ev.experience.releaseDecision || null;
  const evidence = release && release.evidence || null;
  return {
    replay: {
      completed: !!ev.replay.completed,
      steps: ev.replay.steps,
      reason: ev.replay.reason || null,
      maxBuffer: ev.replay.maxBuffer
    },
    structure: {
      pass: !!ev.structure.gatePass,
      reasons: ev.structure.gateReasons || [],
      fullMedian2: ev.curve.fullMedian2,
      freeRunMax: ev.curve.freeRunMax,
      freeLowPct: ev.curve.freeLowPct,
      partialStepPct: ev.curve.partialStepPct,
      selectMedian: ev.curve.selectMedian,
      forcedPct: ev.curve.forcedPct
    },
    capacity: {
      conserved: ev.capacity.conserved,
      perColorConserved: ev.capacity.perColorConserved,
      boardFloorPass: ev.capacity.boardFloorPass,
      aboveMax: ev.capacity.aboveMax,
      belowMin: ev.capacity.belowMin,
      minCap: ev.capacity.minCap,
      maxCap: ev.capacity.maxCap,
      colorMismatches: ev.capacity.colorMismatches
    },
    experience: {
      pass: !!ev.experience.pass,
      curvePass: !!ev.experience.curvePass,
      status: ev.experience.status,
      reasons: ev.experience.reasons || [],
      metrics: ev.experience.metrics,
      pressure: ev.experience.pressure,
      releaseStatus: release && release.status || null,
      releaseEvidence: evidence
    },
    player: {
      won: !!ev.player.won,
      progress: ev.player.progress,
      picks: ev.player.picks,
      bufferPeak: ev.player.bufferPeak,
      playerAvgBuffer: ev.player.playerAvgBuffer,
      avgResidence: ev.player.avgResidence,
      stalledAtEnd: ev.player.stalledAtEnd,
      lastRefuse: ev.player.lastRefuse || null,
      lastBlocked: ev.player.lastBlocked || null
    }
  };
}

let A = null;

function main() {
  A = load();
  fs.mkdirSync(LEVEL_DIR, { recursive: true });
  const baselineRaw = JSON.parse(fs.readFileSync(BASELINE_LEVEL_PATH, 'utf8'));
  const route = JSON.parse(fs.readFileSync(BASELINE_ROUTE_PATH, 'utf8'));
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(IMAGE_PATH, 'utf8'));
  const cfg = configFor(blocks, 1001);
  const baselineHash = hash(baselineRaw);
  const beforeSums = colorSums(baselineRaw);
  const beforeA = cellInfo(baselineRaw, SWAP_A);
  const beforeB = cellInfo(baselineRaw, SWAP_B);
  const candidateRaw = makeCandidate(baselineRaw);
  const afterSums = colorSums(candidateRaw);
  const afterA = cellInfo(candidateRaw, SWAP_A);
  const afterB = cellInfo(candidateRaw, SWAP_B);
  const candidateHash = hash(candidateRaw);
  const colorKeys = [...new Set(Object.keys(beforeSums).concat(Object.keys(afterSums)))].sort((x, y) => +x - +y);
  const colorMismatches = colorKeys.filter(k => (beforeSums[k] || 0) !== (afterSums[k] || 0))
    .map(k => ({ color: +k, before: beforeSums[k] || 0, after: afterSums[k] || 0 }));

  const baselineEval = evaluateRoute(A, baselineRaw, route, cfg);
  const candidateEval = evaluateRoute(A, candidateRaw, route, cfg);
  const qDiag = qPassDiagnostic(A, candidateRaw, cfg);
  const baseline = coreResult(baselineEval);
  const candidate = coreResult(candidateEval);
  const candidateMetrics = candidate.experience.metrics || {};
  const candidateRelease = candidate.experience.releaseEvidence || null;
  const checks = {
    baselineHashMatch: baselineHash === EXPECTED_BASELINE_HASH,
    swapPointsOrdinary: [afterA, afterB].every(x => x && x.t === 'box' && !x.q && !x.chain && !x.numice),
    perColorSumsUnchanged: colorMismatches.length === 0,
    candidateHashChanged: candidateHash !== baselineHash,
    routeCompleted: candidate.replay.completed === true,
    capacityPass: candidate.capacity.conserved === true &&
      candidate.capacity.perColorConserved === true &&
      candidate.capacity.boardFloorPass === true &&
      candidate.capacity.aboveMax === 0,
    structurePass: candidate.structure.pass === true,
    midAtLeast50: candidateMetrics.midBuffer34Pct != null && candidateMetrics.midBuffer34Pct >= 50,
    significantRelease: candidate.experience.pressure &&
      candidate.experience.pressure.significantReleaseCount >= 1,
    releaseDecisionReplay: candidate.experience.releaseStatus === 'found' &&
      !!(candidateRelease && candidateRelease.finalReplayValid),
    playerWon: candidate.player.won === true
  };
  const required = [
    'baselineHashMatch', 'swapPointsOrdinary', 'perColorSumsUnchanged', 'candidateHashChanged',
    'routeCompleted', 'capacityPass', 'structurePass', 'midAtLeast50', 'significantRelease',
    'releaseDecisionReplay', 'playerWon'
  ];
  checks.pass = required.every(k => checks[k]);
  const report = {
    schema: '006-single-pair-swap-v570',
    date: '2026-10-26',
    preregistration: '006单对交换_v570.预登记.md',
    source: {
      baselineLevel: path.relative(ROOT, BASELINE_LEVEL_PATH),
      baselineRoute: path.relative(ROOT, BASELINE_ROUTE_PATH),
      expectedBaselineHash: EXPECTED_BASELINE_HASH,
      baselineHash,
      candidateHash,
      config: cfg
    },
    swap: {
      a: { cell: SWAP_A, before: beforeA, after: afterA },
      b: { cell: SWAP_B, before: beforeB, after: afterB },
      colorMismatches
    },
    baseline,
    candidate,
    qPassDiagnostic: qDiag,
    checks,
    decision: checks.pass
      ? '单对交换在原计划路线上达到中段、结构、容量与释放门槛；单 seed 仅算机制命中，下一步做006四seed开发集复核。'
      : '单对交换未通过全部预登记门槛；本轮否决，不追加第二对或扩大搜索。'
  };
  fs.writeFileSync(CANDIDATE_LEVEL_PATH, JSON.stringify(candidateRaw, null, 2) + '\n');
  fs.writeFileSync(CANDIDATE_ROUTE_PATH, JSON.stringify(route, null, 2) + '\n');
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    baselineHashMatch: checks.baselineHashMatch,
    candidateHash,
    swap: report.swap,
    baseline: {
      routeCompleted: baseline.replay.completed,
      structurePass: baseline.structure.pass,
      goalPass: baseline.experience.pass,
      reasons: baseline.experience.reasons,
      metrics: baseline.experience.metrics,
      releaseStatus: baseline.experience.releaseStatus,
      player: baseline.player
    },
    candidate: {
      routeCompleted: candidate.replay.completed,
      routeReason: candidate.replay.reason,
      structurePass: candidate.structure.pass,
      structureReasons: candidate.structure.reasons,
      goalPass: candidate.experience.pass,
      reasons: candidate.experience.reasons,
      metrics: candidate.experience.metrics,
      releaseStatus: candidate.experience.releaseStatus,
      releaseEvidence: candidateRelease,
      pressure: candidate.experience.pressure,
      player: candidate.player
    },
    qPassDiagnostic: qDiag,
    checks,
    decision: report.decision,
    out: path.relative(ROOT, OUT)
  }, null, 2));
}

main();
