#!/usr/bin/env node
/** v576 实验：棋盘优先 + 少量大容量锚点 + 小容量车的精确拆分。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const INPUT = path.join(ROOT, '关卡', '关卡00199_原图039-056-023-038_分图3色_40x40.txt');
const QUEUE_ORDER = process.env.QUEUE_ORDER === 'asc' ? 'asc' : 'desc';
const OUT = path.join(__dirname, '棋盘混合容量_v576_' + QUEUE_ORDER + '.json');
const LEVEL_DIR = path.join(__dirname, '棋盘混合容量_v576_' + QUEUE_ORDER + '.levels');
const SEED = Number(process.env.SEED || 1001);
const ARMS = [
  { id: 'A', rows: 7, cols: 7 },
  { id: 'B', rows: 7, cols: 8 },
  { id: 'C', rows: 8, cols: 8 },
  { id: 'D', rows: 8, cols: 9 }
];
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

const A = load();

function capacityHistogram(caps) {
  const h = {};
  for (const n of caps) h[n] = (h[n] || 0) + 1;
  return h;
}

function configFor(arm) {
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
      enabled: true, rows: arm.rows, cols: arm.cols,
      blackCells: 0, smallMax: 18, anchorRatio: 0.3, queueOrder: QUEUE_ORDER
    },
    targetCarCount: arm.rows * arm.cols,
    cutMode: 'exposeCut',
    maxPipes: 0,
    minPipes: 0,
    pipeFloorCount: 0,
    pipeFloorDepth: 0,
    candidateCount: 1,
    chokeBranches: 1,
    rounds: 0,
    maxRetries: 1,
    boardRowsMin: arm.rows,
    boardRowsMax: arm.rows,
    boardColsMin: arm.cols,
    boardColsMax: arm.cols,
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

function planSummary(plan, targetCars) {
  const audit = plan && plan.boxes && plan.boxes._instantPlayout || null;
  const caps = plan && plan.boxes ? plan.boxes.map(x => x.count) : [];
  const plans = audit && audit.capacityPlans || [];
  return {
    ok: !!(plan && plan.ok),
    reason: plan && plan.reason || null,
    cars: caps.length,
    targetCars,
    carDelta: caps.length - targetCars,
    capMin: caps.length ? Math.min(...caps) : null,
    capMax: caps.length ? Math.max(...caps) : null,
    anchors40: caps.filter(x => x === 40).length,
    small6to18: caps.filter(x => x >= 6 && x <= 18).length,
    below6: caps.filter(x => x < 6).length,
    above40: caps.filter(x => x > 40).length,
    exactColors: plans.filter(x => x.exact).length,
    totalColors: plans.length,
    histogram: capacityHistogram(caps),
    capacityMix: audit && audit.capacityMix || null,
    colorPlans: plans
  };
}

function blackStats(level) {
  let black = 0, cells = 0;
  if (level && level.board && level.board.cells) {
    for (let r = 0; r < level.board.rows; r++) for (let c = 0; c < level.board.cols; c++) {
      cells++;
      const x = level.board.cells[r] && level.board.cells[r][c];
      if (x && x.t === 'black') black++;
    }
  }
  const shape = level ? A.boardBlackShapeAudit(level) : null;
  return { black, cells, pct: cells ? +(black / cells * 100).toFixed(2) : null, shape };
}

function runArm(arm) {
  const cfg = configFor(arm);
  const targetCars = arm.rows * arm.cols;
  const planned = A.InstantPlayout.plan({ blocks, bufferLimit: 5 }, cfg);
  const planning = planSummary(planned, targetCars);
  if (!planning.ok) return { arm, planning, generated: false, reason: planning.reason || 'capacity_plan_failed' };

  const t0 = Date.now();
  let result = null, error = null;
  try { result = A.Generator.produceFixed(blocks, cfg); }
  catch (e) { error = String(e && e.message || e); }
  const raw = result && result.level || null;
  const parsed = raw ? A.parseLevel(raw) : null;
  const q = raw ? A.Quality.fromGeneration(result) : null;
  const black = raw ? blackStats(raw) : null;
  let exp = null;
  if (raw && result.solveResult) {
    try {
      exp = A.ExperienceGoal.evaluate(raw, {
        solveResult: result.solveResult, decision: true, instantChain: true,
        maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
      });
    } catch (e) { exp = { error: String(e && e.message || e) }; }
  }
  const rec = {
    arm, planning,
    generated: !!raw,
    valid: !!(result && result.valid && raw),
    error,
    failReason: result && result.lastFailReason || null,
    structuralReason: result && result.structural && result.structural.reason || null,
    board: raw ? raw.board.rows + 'x' + raw.board.cols : null,
    cars: parsed ? parsed.totalBoxes : null,
    black,
    quality: q ? {
      gatePass: !!q.gatePass, gateReasons: q.gateReasons || [],
      pass: !!q.pass, reasons: q.reasons || [], label: q.label
    } : null,
    experience: exp ? {
      pass: !!exp.pass,
      curvePass: !!exp.curvePass,
      metrics: exp.metrics || null,
      diagnosis: exp.diagnosis || null,
      releaseDecision: exp.releaseDecision || null
    } : null,
    elapsedMs: Date.now() - t0
  };

  if (raw) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    const stem = arm.id + '_' + arm.rows + 'x' + arm.cols + '_' + SEED;
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(raw, null, 2) + '\n');
    if (result.solveResult && result.solveResult.pickOrder) {
      fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'),
        JSON.stringify(result.solveResult.pickOrder, null, 2) + '\n');
    }
  }
  console.log('[mix]', arm.id, arm.rows + 'x' + arm.cols,
    'plan=' + (planning.ok ? 'ok' : planning.reason),
    'cars=' + planning.cars + '/' + targetCars,
    'cap=' + planning.capMin + '~' + planning.capMax,
    '40=' + planning.anchors40,
    'small=' + planning.small6to18,
    'valid=' + rec.valid,
    'qGate=' + (q && q.gatePass),
    'exp=' + (exp && exp.pass),
    'ms=' + rec.elapsedMs);
  return rec;
}

const blocks = A.Generator.blocksFromTXT(fs.readFileSync(INPUT, 'utf8'));
const rows = ARMS.map(runArm);
const report = {
  schema: 'capacity-mix-board-v576', date: '2026-10-27', seed: SEED, queueOrder: QUEUE_ORDER,
  input: path.relative(ROOT, INPUT),
  capacityRange: [6, 40],
  arms: rows,
  summary: {
    feasiblePlans: rows.filter(x => x.planning && x.planning.ok).length,
    generated: rows.filter(x => x.generated).length,
    valid: rows.filter(x => x.valid).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    experience: rows.filter(x => x.experience && x.experience.pass).length,
    boards: rows.map(x => x.board),
    blackPcts: rows.map(x => x.black && x.black.pct),
    carCounts: rows.map(x => x.planning && x.planning.cars)
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
