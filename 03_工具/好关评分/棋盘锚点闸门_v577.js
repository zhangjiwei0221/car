#!/usr/bin/env node
/** v577：固定7×7混合容量，只比较普通落位与第1行软锚点闸门。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const INPUT = path.join(ROOT, '关卡', '关卡00199_原图039-056-023-038_分图3色_40x40.txt');
const OUT = path.join(__dirname, '棋盘锚点闸门_v577.json');
const LEVEL_DIR = path.join(__dirname, '棋盘锚点闸门_v577.levels');
const SEED = Number(process.env.SEED || 1001);
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
      gatePlan: gatePlan || null
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

function runArm(id, gatePlan) {
  const cfg = configFor(gatePlan);
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
  const gate = raw && raw.board && raw.board.gatePlan || null;
  const anchorSet = {};
  for (const a of ((gate && gate.anchors) || [])) anchorSet[a.r + ',' + a.c] = a;
  const seen = {}, anchorPicks = [];
  const picks = result && result.solveResult && result.solveResult.pickOrder || [];
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i], k = p.r + ',' + p.c;
    if (anchorSet[k] && !seen[k]) {
      seen[k] = 1;
      const cs = curve && curve.steps && curve.steps[i] || null;
      anchorPicks.push(Object.assign({
        step: i + 1, pickIndex: i,
        curve: cs ? {
          buf: cs.buf, full: cs.full, free: cs.free,
          progress: cs.prog, pickedCount: cs.count
        } : null
      }, anchorSet[k]));
    }
  }
  const rec = {
    id, gatePlan, valid: !!(result && result.valid && raw), error,
    failReason: result && result.lastFailReason || null,
    structuralReason: result && result.structural && result.structural.reason || null,
    board: raw ? raw.board.rows + 'x' + raw.board.cols : null,
    cars: parsed ? parsed.totalBoxes : null,
    gate,
    anchorPicks,
    anchorPickCount: anchorPicks.length,
    quality: q ? {
      gatePass: !!q.gatePass, gateReasons: q.gateReasons || [],
      pass: !!q.pass, reasons: q.reasons || [], label: q.label,
      blackShape: q.blackShape
    } : null,
    curve: curve ? {
      freeLowPct: curve.freeLowPct,
      freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2,
      selectMedian: curve.selectMedian,
      pressurePct3: curve.pressurePct3,
      pressurePeak: curve.pressurePeak
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
    fs.writeFileSync(path.join(LEVEL_DIR, id + '_7x7_' + SEED + '.json'), JSON.stringify(raw, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, id + '_7x7_' + SEED + '.route.json'), JSON.stringify(picks, null, 2) + '\n');
  }
  console.log('[gate]', id,
    'valid=' + rec.valid,
    'anchors=' + (gate ? gate.anchorsPlaced : 0),
    'picked=' + rec.anchorPickCount,
    'qGate=' + (q && q.gatePass),
    'exp=' + (exp && exp.pass),
    'freeLow=' + (curve && curve.freeLowPct),
    'freeRun=' + (curve && curve.freeRunMax),
    'ms=' + rec.elapsedMs);
  return rec;
}

const rows = [
  runArm('A_control', null),
  runArm('B_gate_row1', {
    enabled: true, row: 1, anchorCars: 5,
    anchorMinCap: 32, minDebt: 1, gapCols: [0, 6]
  }),
  runArm('C_gate_row0', {
    enabled: true, row: 0, anchorCars: 4,
    anchorMinCap: 32, minDebt: 1, gapCols: [0, 3, 6]
  })
];
const report = {
  schema: 'instant-gate-anchor-v577', date: '2026-10-27', seed: SEED,
  input: path.relative(ROOT, INPUT),
  fixed: { board: '7x7', cars: 49, capRange: [6, 40], black: 0 },
  arms: rows,
  summary: {
    valid: rows.filter(x => x.valid).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    experience: rows.filter(x => x.experience && x.experience.pass).length,
    anchorPicks: rows.map(x => x.anchorPickCount)
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
