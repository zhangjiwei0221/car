#!/usr/bin/env node
/** v578：两行交错软锚点 + 实际取车时真实债务审计。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const INPUT = path.join(ROOT, '关卡', '关卡00199_原图039-056-023-038_分图3色_40x40.txt');
const OUT = path.join(__dirname, '棋盘锚点闸门_交错_v578.json');
const LEVEL_DIR = path.join(__dirname, '棋盘锚点闸门_交错_v578.levels');
const SEED = Number(process.env.SEED || 1001);
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const ARMS = [
  {
    id: 'A_row1_gate',
    gatePlan: {
      enabled: true, row: 1, anchorCars: 5, anchorMinCap: 32, minDebt: 1,
      cells: [[1,1],[1,2],[1,3],[1,4],[1,5]]
    }
  },
  {
    id: 'B_staggered_rows1_2',
    gatePlan: {
      enabled: true, row: 1, anchorCars: 6, anchorMinCap: 32, minDebt: 1,
      cells: [[1,1],[1,2],[1,3],[1,4],[1,5],[2,0]]
    }
  }
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

const A = load();
const blocks = A.Generator.blocksFromTXT(fs.readFileSync(INPUT, 'utf8'));

function configFor(gatePlan) {
  return {
    seed: SEED,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantChain: true,
    bottomOnly: false,
    elimOrder: 'instant',
    instantPlanPolicy: 'targetBuffer',
    instantPlanTargetBuffer: 3,
    instantPlanMaxDebt: 40,
    instantPlanDebtEvery: 4,
    instantPlanBranchCount: 0,
    boxSizeMin: 6,
    boxSizeMax: 40,
    capNormMin: 6,
    capNormMax: 40,
    capacityMix: {
      enabled: true, rows: 7, cols: 7, blackCells: 0,
      smallMax: 18, anchorRatio: 0.3, queueOrder: 'desc',
      gatePlan
    },
    targetCarCount: 49,
    cutMode: 'exposeCut',
    maxPipes: 0,
    minPipes: 0,
    pipeFloorCount: 0,
    pipeFloorDepth: 0,
    candidateCount: 1,
    chokeBranches: 1,
    rounds: 0,
    maxRetries: 1,
    boardRowsMin: 7, boardRowsMax: 7,
    boardColsMin: 7, boardColsMax: 7,
    boardHardRange: true,
    boardAuto: false,
    boardAllowSquare: true,
    boardExpandOnOverflow: false,
    boardFirst: true,
    boardFitGuard: 'warn',
    boardPrefer7: false,
    boardPrefer7Dims: null,
    hardBlackMaxPct: 30,
    p7BaseCount: 0,
    p7Repair: false,
    trapPost: false,
    pool: 1,
    semanticObstacles: false,
    usableSpaceTarget: 0,
    blackPercent: 0,
    blackAsCapOnly: true,
    blackPercentCapPct: 0,
    narrowPath: false,
    icePercent: 0,
    iceSchedule: false,
    chainCount: 0,
    questionPercent: 0,
    experienceGoal: false,
    acceptMode: 'time',
    timeBudgetMs: Number(process.env.BUDGET_MS || 30000),
    localSwapRepair: false,
    capacityTuneMs: 0,
    maxDecisionStates: 8,
    stateSampleMode: 'midStratified',
    minReleaseAmplitude: 2
  };
}

function leftmostFreeSlot(s) {
  const used = {};
  for (const item of s.buffer || []) if (item.slot != null) used[item.slot] = 1;
  for (let i = 0; i < s.bufferLimit; i++) if (!used[i]) return i;
  return -1;
}

function slotStartCoord(slot, rows, cols, bufferLimit) {
  return { r: rows - 1, c: Math.min(cols - 1, Math.floor(slot / bufferLimit * cols)) };
}

function reachablePixelsAt(s, color, start, rows, cols) {
  const scratch = s.eliminated.map(row => row.slice());
  try {
    return A.Simulator.instantChainEliminate(
      scratch, blocks, rows, cols, color, Infinity, null, start, null
    );
  } catch (e) { return null; }
}

function actualAnchorAudit(raw, solveResult) {
  if (!raw || !solveResult || !solveResult.pickOrder) return [];
  const gate = raw.board && raw.board.gatePlan;
  const anchorMap = {};
  for (const a of ((gate && gate.anchors) || [])) anchorMap[a.r + ',' + a.c] = a;
  if (!Object.keys(anchorMap).length) return [];
  const level = A.parseLevel(raw);
  const state = A.Simulator.createState(level, {
    useSlotStart: true, bottomOnly: false, instantChain: true, capturePreviewStats: false
  });
  const actions = A.SolverAnalysis.normalizeActions(solveResult.pickOrder);
  const audit = [], seen = {};
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i], k = a.r + ',' + a.c;
    const planned = anchorMap[k];
    if (planned && !seen[k]) {
      seen[k] = 1;
      const cell = state.cells[a.r] && state.cells[a.r][a.c];
      const slot = leftmostFreeSlot(state);
      const start = slot >= 0 ? slotStartCoord(slot, state.rows, state.cols, state.bufferLimit) : null;
      const actualReach = cell && cell.t === 'box' && start
        ? reachablePixelsAt(state, cell.color, start, state.rows, state.cols)
        : null;
      audit.push({
        step: i + 1, pickIndex: i, r: a.r, c: a.c,
        color: cell && cell.color, capacity: cell && cell.count,
        slot,
        plannedReach: planned.reach, plannedDebt: planned.debt,
        actualReach, actualDebt: (cell && actualReach != null) ? cell.count - actualReach : null,
        bufferBefore: state.buffer.length,
        eliminatedBefore: state.eliminatedPixels,
        progressBefore: state.totalPixels ? +(state.eliminatedPixels / state.totalPixels).toFixed(4) : null
      });
    }
    A.Simulator.applyPick(state, a.r, a.c);
    if (planned && audit.length && audit[audit.length - 1].step === i + 1) {
      audit[audit.length - 1].bufferAfter = state.buffer.length;
      audit[audit.length - 1].eliminatedAfter = state.eliminatedPixels;
    }
  }
  return audit;
}

function runArm(arm) {
  const cfg = configFor(arm.gatePlan);
  const t0 = Date.now();
  let result = null, error = null;
  try { result = A.Generator.produceFixed(blocks, cfg); }
  catch (e) { error = String(e && e.message || e); }
  const raw = result && result.level || null;
  const parsed = raw ? A.parseLevel(raw) : null;
  const q = raw ? A.Quality.fromGeneration(result) : null;
  const curve = result && result.goodV3 && result.goodV3.fillCurve || null;
  let exp = null;
  if (raw && result.solveResult) {
    try {
      exp = A.ExperienceGoal.evaluate(raw, {
        solveResult: result.solveResult, decision: true, instantChain: true,
        maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
      });
    } catch (e) { exp = { error: String(e && e.message || e) }; }
  }
  const anchorAudit = raw ? actualAnchorAudit(raw, result.solveResult) : [];
  const positiveDebt = anchorAudit.filter(x => x.actualDebt != null && x.actualDebt >= 2);
  const buffer3 = anchorAudit.filter(x => x.bufferAfter != null && x.bufferAfter >= 3);
  const rec = {
    id: arm.id, gatePlan: arm.gatePlan, valid: !!(result && result.valid && raw), error,
    failReason: result && result.lastFailReason || null,
    structuralReason: result && result.structural && result.structural.reason || null,
    board: raw ? raw.board.rows + 'x' + raw.board.cols : null,
    cars: parsed ? parsed.totalBoxes : null,
    gate: raw && raw.board && raw.board.gatePlan || null,
    anchorAudit, positiveDebtAnchors: positiveDebt.length, buffer3Anchors: buffer3.length,
    quality: q ? {
      gatePass: !!q.gatePass, gateReasons: q.gateReasons || [],
      pass: !!q.pass, reasons: q.reasons || [], label: q.label, blackShape: q.blackShape
    } : null,
    curve: curve ? {
      freeLowPct: curve.freeLowPct, freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2, selectMedian: curve.selectMedian,
      pressurePct3: curve.pressurePct3, pressurePeak: curve.pressurePeak
    } : null,
    experience: exp ? {
      pass: !!exp.pass, curvePass: !!exp.curvePass,
      metrics: exp.metrics || null, diagnosis: exp.diagnosis || null,
      releaseDecision: exp.releaseDecision || null
    } : null,
    elapsedMs: Date.now() - t0
  };
  if (raw) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    fs.writeFileSync(path.join(LEVEL_DIR, arm.id + '_' + SEED + '.json'), JSON.stringify(raw, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, arm.id + '_' + SEED + '.route.json'),
      JSON.stringify(result.solveResult && result.solveResult.pickOrder || [], null, 2) + '\n');
  }
  console.log('[v578]', arm.id, 'valid=' + rec.valid,
    'anchors=' + anchorAudit.length,
    'debt>=2=' + positiveDebt.length,
    'buffer>=3=' + buffer3.length,
    'freeLow=' + (curve && curve.freeLowPct),
    'freeRun=' + (curve && curve.freeRunMax),
    'maxBuffer=' + (exp && exp.metrics && exp.metrics.maxBuffer),
    'qGate=' + (q && q.gatePass),
    'ms=' + rec.elapsedMs);
  return rec;
}

const rows = ARMS.map(runArm);
const report = {
  schema: 'staggered-anchor-gate-v578', date: '2026-10-27', seed: SEED,
  input: path.relative(ROOT, INPUT),
  fixed: { board: '7x7', cars: 49, capRange: [6, 40], black: 0 },
  arms: rows,
  summary: {
    valid: rows.filter(x => x.valid).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    experience: rows.filter(x => x.experience && x.experience.pass).length,
    anchors: rows.map(x => x.anchorAudit.length),
    actualDebt2: rows.map(x => x.positiveDebtAnchors),
    buffer3: rows.map(x => x.buffer3Anchors)
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
