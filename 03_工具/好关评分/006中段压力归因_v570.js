#!/usr/bin/env node
/** v570 P1：只读归因 006/1001 最佳结构基底的中段压力、债务与释放窗口。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const LEVEL_DIR = path.join(__dirname, '目标分支策略矩阵_v570.levels');
const LEVEL_PATH = path.join(LEVEL_DIR, '006_1001_A_base_shortDebt.json');
const ROUTE_PATH = path.join(LEVEL_DIR, '006_1001_A_base_shortDebt.route.json');
const OUT = path.join(__dirname, '006中段压力归因_v570.json');
const EXPECTED_HASH = 'f91d8cf7c70d33aea424a63c1d5c27518b7f0a3f90115d9616418c3250877205';
const IMAGE_PATH = path.join(ROOT, '蚂蚁图库', '拼接图', '拼接图图库', '35x35拼接图纸_006.txt');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const OPTIONS = { instantChain: true, bottomOnly: false };

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

function median(values) {
  if (!values.length) return null;
  const a = values.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
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
    minReleaseAmplitude: 2
  };
}

function bufferSnapshot(state) {
  return state.buffer.map(item => ({
    key: item.key,
    color: item.color,
    need: item.need,
    progress: item.progress,
    remaining: Math.max(0, item.need - item.progress),
    slot: item.slot,
    start: item.start,
    enterStep: item.enterStep,
    waitedSteps: state.steps - (item.enterStep || 0),
    link: item.link || 0
  }));
}

function moveSnapshot(moves) {
  return moves.map(m => ({
    r: m.r,
    c: m.c,
    color: m.antBox && m.antBox.color,
    count: m.antBox && m.antBox.count,
    canConsume: !!m.canConsume,
    groupSize: m.groupSize || 1,
    blocked: !!m.blocked
  }));
}

function traceRoute(level, route) {
  const Sim = A.Simulator;
  const actions = A.SolverAnalysis.normalizeActions(route);
  const state = Sim.createState(level, { useSlotStart: true, instantChain: true, bottomOnly: false });
  const rows = [];
  for (let i = 0; i < actions.length; i++) {
    if (state.gameWon || state.gameOver) break;
    const a = actions[i];
    const pickable = Sim.isPickable(state, a.r, a.c);
    const moves = pickable ? Sim.listMoves(state) : [];
    const legalMoves = moves.filter(m => !m.blocked);
    const fullMoves = legalMoves.filter(m => m.canConsume);
    const beforeProgress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    const beforeEliminated = state.eliminatedPixels;
    const beforeBuffer = bufferSnapshot(state);
    const row = {
      actionIndex: i,
      step: i + 1,
      r: a.r,
      c: a.c,
      routeColor: a.color == null ? null : a.color,
      routeCount: a.count == null ? null : a.count,
      pickable,
      beforeProgress: +beforeProgress.toFixed(4),
      beforeBuffer,
      legalMoveCount: legalMoves.length,
      consumableMoveCount: fullMoves.length,
      legalColors: [...new Set(legalMoves.map(m => m.antBox && m.antBox.color))],
      legalMoves: moveSnapshot(legalMoves),
      routeMove: moveSnapshot(legalMoves.filter(m => m.r === a.r && m.c === a.c))[0] || null
    };
    if (!pickable) {
      rows.push(row);
      break;
    }
    Sim.applyPick(state, a.r, a.c);
    if (state.eliminatedPixels >= state.totalPixels) {
      state.gameWon = true;
      state.gameOver = true;
    }
    const afterProgress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    const last = state.lastPick || {};
    const afterBuffer = bufferSnapshot(state);
    row.lastPick = {
      boxes: last.boxes || 0,
      bufBefore: last.bufBefore,
      bufEnter: last.bufEnter,
      bufAfter: last.bufAfter,
      isChain: !!last.isChain,
      picked: last.picked || []
    };
    row.afterProgress = +afterProgress.toFixed(4);
    row.afterBuffer = afterBuffer;
    row.afterBufferCount = afterBuffer.length;
    row.immediateEliminated = state.eliminatedPixels - beforeEliminated;
    row.enteredKeys = afterBuffer.filter(x => !beforeBuffer.some(y => y.key === x.key)).map(x => x.key);
    row.releasedKeys = beforeBuffer.filter(x => !afterBuffer.some(y => y.key === x.key)).map(x => x.key);
    row.inMidAfter = afterProgress >= 0.2 && afterProgress <= 0.85;
    row.midBucket = row.inMidAfter ? Math.min(3, Math.floor((afterProgress - 0.2) / 0.65 * 4)) : null;
    rows.push(row);
  }
  return {
    actions: actions.length,
    completed: !!state.gameWon,
    overflow: !!state.overflow,
    gameOver: !!state.gameOver,
    rows
  };
}

function summarizePressure(trace) {
  const mid = trace.rows.filter(x => x && x.inMidAfter);
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of mid) counts[row.afterBufferCount] = (counts[row.afterBufferCount] || 0) + 1;
  const high34 = mid.filter(x => x.afterBufferCount === 3 || x.afterBufferCount === 4).length;
  const targetSteps = Math.ceil(mid.length * 0.5);
  const bins = [0, 1, 2, 3].map(bucket => {
    const a = mid.filter(x => x.midBucket === bucket);
    return {
      bucket,
      progressStart: +(0.2 + bucket * 0.1625).toFixed(4),
      progressEnd: +(0.2 + (bucket + 1) * 0.1625).toFixed(4),
      steps: a.length,
      buffer34: a.filter(x => x.afterBufferCount === 3 || x.afterBufferCount === 4).length,
      bufferBelow3: a.filter(x => x.afterBufferCount < 3).length,
      bufferAtLeast5: a.filter(x => x.afterBufferCount >= 5).length
    };
  });
  const lowRows = mid.filter(x => x.afterBufferCount < 3);
  const lowWindows = [];
  let current = null;
  for (const row of lowRows) {
    if (!current || row.actionIndex !== current.endActionIndex + 1) {
      current = {
        startActionIndex: row.actionIndex,
        endActionIndex: row.actionIndex,
        startStep: row.step,
        endStep: row.step,
        startProgress: row.afterProgress,
        endProgress: row.afterProgress,
        steps: []
      };
      lowWindows.push(current);
    }
    current.endActionIndex = row.actionIndex;
    current.endStep = row.step;
    current.endProgress = row.afterProgress;
    current.steps.push({
      step: row.step,
      progress: row.afterProgress,
      buffer: row.afterBufferCount,
      pick: { r: row.r, c: row.c, color: row.routeColor, count: row.routeCount },
      legalMoveCount: row.legalMoveCount,
      consumableMoveCount: row.consumableMoveCount,
      activeDebt: row.afterBuffer
    });
  }
  for (const win of lowWindows) {
    win.length = win.steps.length;
    win.minBuffer = Math.min(...win.steps.map(x => x.buffer));
    win.legalMoveMedian = median(win.steps.map(x => x.legalMoveCount));
    win.consumableMoveMedian = median(win.steps.map(x => x.consumableMoveCount));
  }
  return {
    midSteps: mid.length,
    buffer34Steps: high34,
    buffer34Pct: mid.length ? +(high34 / mid.length * 100).toFixed(1) : null,
    targetStepsAt50Pct: targetSteps,
    additionalBuffer34StepsNeeded: Math.max(0, targetSteps - high34),
    bufferBelow3Steps: mid.filter(x => x.afterBufferCount < 3).length,
    bufferAtLeast5Steps: mid.filter(x => x.afterBufferCount >= 5).length,
    maxBuffer: Math.max(0, ...trace.rows.map(x => x.afterBufferCount == null ? 0 : x.afterBufferCount)),
    distribution: counts,
    bins,
    lowWindows
  };
}

function summarizeDebt(debt, trace) {
  if (!debt || !debt.completed) {
    return { completed: false, reason: debt && debt.reason || 'debt_timeline_missing' };
  }
  const traceByStep = Object.fromEntries(trace.rows.map(x => [x.step, x]));
  const items = debt.items.map(item => {
    const row = item.debtStartStep != null ? traceByStep[item.debtStartStep] : null;
    return Object.assign({}, item, {
      waitSteps: item.doneStep != null && item.debtStartStep != null
        ? item.doneStep - item.debtStartStep
        : null,
      startProgress: row && row.afterProgress,
      startBuffer: row && row.afterBufferCount
    });
  });
  const sustained = items
    .filter(x => x.initialDebt > 0)
    .sort((a, b) => (b.initialDebt - a.initialDebt) || (b.waitSteps - a.waitSteps));
  return {
    completed: true,
    summary: debt.summary,
    sustainedDebtCars: sustained,
    series: debt.series
  };
}

function playerSummary(player) {
  return {
    won: !!player.won,
    progress: player.progress,
    picks: player.picks,
    bufferPeak: player.bufferPeak,
    playerAvgBuffer: player.playerAvgBuffer,
    avgResidence: player.avgResidence,
    stalledAtEnd: player.stalledAtEnd,
    lastRefuse: player.lastRefuse || null,
    lastBlocked: player.lastBlocked || null,
    deathSnapshot: player.deathSnapshot || null,
    elimMode: player.elimMode
  };
}

let A = null;

function main() {
  A = load();
  const rawLevel = JSON.parse(fs.readFileSync(LEVEL_PATH, 'utf8'));
  const route = JSON.parse(fs.readFileSync(ROUTE_PATH, 'utf8'));
  const level = A.parseLevel(rawLevel);
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(IMAGE_PATH, 'utf8'));
  const cfg = configFor(blocks, 1001);
  const actualHash = hash(rawLevel);
  const solveRoute = { completed: true, pickOrder: route };
  const curve = A.Generator.choiceCurve(level, solveRoute, OPTIONS);
  const quality = A.Quality.fromGeneration({
    level,
    valid: true,
    config: cfg,
    goodV3: { fillCurve: curve, persist: {} }
  });
  const capacity = A.Quality.capacityEvidence(level, cfg);
  const replay = A.SolverAnalysis.replay(level, solveRoute, OPTIONS);
  const experience = A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, OPTIONS, {
    solveResult: solveRoute,
    decision: true
  }));
  const trace = traceRoute(level, route);
  const debt = A.CarSequencer.debtTimeline(level, solveRoute, OPTIONS);
  const player = A.PlayerSim.run(level, {
    seed: 7,
    useItems: false,
    reviveCap: 0,
    capturePreviewStats: true,
    instantChain: true,
    bottomOnly: false
  });
  const pressure = summarizePressure(trace);
  const releaseEvidence = experience.releaseDecision && experience.releaseDecision.evidence || null;
  const report = {
    schema: '006-mid-pressure-attribution-v570',
    date: '2026-10-26',
    purpose: '只读解释 006/1001 最佳结构基底的 39.1% 中段压力不足，并定位一个可验证的单因素候选窗口。',
    source: {
      level: path.relative(ROOT, LEVEL_PATH),
      route: path.relative(ROOT, ROUTE_PATH),
      expectedHash: EXPECTED_HASH,
      actualHash,
      hashMatch: actualHash === EXPECTED_HASH,
      config: cfg
    },
    baseline: {
      board: level.board.rows + 'x' + level.board.cols,
      validReplay: !!replay.completed,
      replayReason: replay.reason || null,
      replaySteps: replay.steps,
      capacity,
      structure: {
        pass: !!quality.gatePass,
        reasons: quality.gateReasons || [],
        fullMedian2: curve.fullMedian2,
        freeRunMax: curve.freeRunMax,
        freeLowPct: curve.freeLowPct,
        partialStepPct: curve.partialStepPct,
        selectMedian: curve.selectMedian,
        forcedPct: curve.forcedPct
      },
      experience: {
        pass: !!experience.pass,
        curvePass: !!experience.curvePass,
        status: experience.status,
        reasons: experience.reasons || [],
        metrics: experience.metrics,
        pressure: experience.pressure,
        releaseDecision: experience.releaseDecision,
        releaseEvidence
      },
      player: playerSummary(player)
    },
    pressure,
    debt: summarizeDebt(debt, trace),
    routeTrace: trace.rows,
    audit: {
      hashMatch: actualHash === EXPECTED_HASH,
      routeCompleted: !!replay.completed && !!trace.completed,
      hardCapacityPass: !!capacity.conserved && capacity.perColorConserved === true &&
        capacity.boardFloorPass && capacity.aboveMax === 0,
      midMetricMatchesReported39_1: pressure.buffer34Pct === 39.1,
      releaseFound: !!(
        experience.releaseDecision &&
        experience.releaseDecision.status === 'found' &&
        releaseEvidence &&
        releaseEvidence.finalReplayValid
      )
    }
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    sourceHashMatch: report.source.hashMatch,
    replayCompleted: report.baseline.validReplay,
    structurePass: report.baseline.structure.pass,
    goalPass: report.baseline.experience.pass,
    experienceStatus: report.baseline.experience.status,
    experienceReasons: report.baseline.experience.reasons,
    midBuffer34Pct: pressure.buffer34Pct,
    buffer34Steps: pressure.buffer34Steps,
    midSteps: pressure.midSteps,
    additionalBuffer34StepsNeeded: pressure.additionalBuffer34StepsNeeded,
    distribution: pressure.distribution,
    lowWindows: pressure.lowWindows.map(x => ({
      startStep: x.startStep,
      endStep: x.endStep,
      startProgress: x.startProgress,
      endProgress: x.endProgress,
      length: x.length,
      legalMoveMedian: x.legalMoveMedian,
      consumableMoveMedian: x.consumableMoveMedian
    })),
    releaseStatus: experience.releaseDecision && experience.releaseDecision.status,
    releaseEvidence,
    debtSummary: debt.summary,
    player: report.baseline.player,
    audit: report.audit,
    out: path.relative(ROOT, OUT)
  }, null, 2));
}

main();
