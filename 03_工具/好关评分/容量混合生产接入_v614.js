#!/usr/bin/env node
/** v614：混合容量填盘接入生产的 A/B 验证。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const IMAGE = process.env.IMAGE || '关卡00199_原图039-056-023-038_分图3色_40x40.txt';
const INPUT = path.join(ROOT, '关卡', IMAGE);
const IMAGE_LABEL = (IMAGE.match(/(\d{5})/) || [null, '199'])[1];
const SEEDS = String(process.env.SEEDS || '1001,1002')
  .split(',').map(Number).filter(Number.isFinite);
const ROUND_MS = Math.max(5000, Number(process.env.ROUND_MS || 20000));
const ROUNDS = Math.max(1, Number(process.env.ROUNDS || 2));
const ARMS = process.env.ARMS === 'both' ? 'both' : (process.env.ARMS === 'control' ? 'control' : 'mix');
const THICKEN = process.env.THICKEN === '1';
const OUT = path.join(__dirname, THICKEN ? '障碍加厚_v615_' + IMAGE_LABEL + '.json' : '容量混合生产接入_v614.json');
const LEVEL_DIR = path.join(__dirname, THICKEN ? '障碍加厚_v615.levels' : '容量混合生产接入_v614.levels');
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
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  }
  return sb.AntSolver;
}

function hash(x) {
  return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
}

function boardStats(raw) {
  let black = 0;
  let cells = 0;
  const caps = [];
  if (!raw || !raw.board || !raw.board.cells) return { black: 0, cells: 0, blackPct: null, caps };
  for (let r = 0; r < raw.board.rows; r++) {
    for (let c = 0; c < raw.board.cols; c++) {
      const x = raw.board.cells[r] && raw.board.cells[r][c];
      if (!x) continue;
      cells++;
      if (x.t === 'black') black++;
      else if (x.t === 'box') caps.push(x.count);
    }
  }
  caps.sort((a, b) => a - b);
  return {
    black, cells, blackPct: cells ? +(black / cells * 100).toFixed(2) : null,
    cars: caps.length,
    capMin: caps.length ? caps[0] : null,
    capMax: caps.length ? caps[caps.length - 1] : null,
    anchors: caps.filter(x => x === 40).length,
    small6to18: caps.filter(x => x >= 6 && x <= 18).length,
    caps
  };
}

function configFor(blocks, seed, mix) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [58, 58];
  const base = {
    seed,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantChain: true,
    bottomOnly: false,
    elimOrder: 'instant',
    instantPlanPolicy: 'shortDebt',
    instantPlanTargetBuffer: 3,
    instantPlanMaxDebt: 40,
    instantPlanDebtEvery: 4,
    instantPlanBranchCount: 0,
    boxSizeMin: mix ? 6 : b[0],
    boxSizeMax: mix ? 40 : b[1],
    capNormMin: mix ? 6 : b[0],
    capNormMax: mix ? 40 : b[1],
    capScalePlan: null,
    cutMode: 'exposeCut',
    maxPipes: mix ? 0 : 1,
    minPipes: 0,
    pipeFloorCount: mix ? 0 : 2,
    pipeFallbackCount: mix ? 0 : 2,
    pipeMaxDepth: mix ? 2 : 4,
    pipeMinFill: 2,
    chainByDemand: 4,
    iceForceSteps: 4,
    candidateCount: 14,
    portfolioK: 1,
    boardRowsMin: mix ? 7 : 4,
    boardRowsMax: mix ? 7 : 7,
    boardColsMin: mix ? 7 : 6,
    boardColsMax: mix ? 7 : 9,
    boardHardRange: true,
    boardAuto: false,
    boardAllowSquare: true,
    boardExpandOnOverflow: false,
    boardFirst: true,
    boardFitGuard: 'warn',
    boardPrefer7: !mix,
    boardPrefer7Dims: null,
    hardBlackMaxPct: mix ? 0 : 30,
    p7BaseCount: mix ? 0 : 1,
    p7Repair: !mix,
    trapPost: false,
    semanticObstacles: true,
    usableSpaceTarget: mix ? 0 : 0.86,
    carFillRatio: mix ? 1 : 0.86,
    blackPercent: mix ? 0 : 5,
    blackPercentMin: mix ? 0 : 5,
    blackPercentMax: mix ? 0 : 8,
    blackAsCapOnly: true,
    blackPercentCapPct: 0,
    narrowPath: false,
    narrowPathProb: 0,
    experienceGoal: true,
    goalPerRoundMs: ROUND_MS,
    goalMaxMs: ROUND_MS * ROUNDS,
    goalMaxRounds: ROUNDS,
    goalBases: 1,
    goalSharedBudget: true,
    timeBudgetMs: ROUND_MS,
    acceptMode: 'target',
    hardOnly: true,
    requireHardPass: true,
    capacityTuneMs: mix ? 0 : 3000,
    capacityTuneCars: mix ? 0 : 8,
    capacityTuneVariants: mix ? 0 : 32,
    localSwapRepair: true,
    localSwapRepairMaxMs: 5000,
    localSwapStage1Pairs: 24,
    localSwapStage1Ms: 2500,
    localSwapStage2Pairs: 32,
    localSwapStage2Ms: 2500,
    maxDecisionStates: 8,
    stateSampleMode: 'midStratified',
    minReleaseAmplitude: 2,
    icePercent: 0,
    iceSchedule: true,
    iceScheduleCount: 4,
    iceScheduleDelay: 7,
    iceByReadyTime: true,
    iceReadyBuckets: 3,
    iceReadyPerBucket: 1
  };
  if (mix) {
    base.capacityMix = {
      enabled: true, rows: 7, cols: 7, blackCells: 0,
      smallMax: 18, anchorRatio: 0.3, queueOrder: 'desc', autoBoard: true
    };
    base.targetCarCount = 49;
    base._capacityMixBoardPlan = {
      schema: 'capacity-mix-board-select-v1', mode: 'offline-fixed',
      sourcePixels: blocks.reduce((n, row) => n + row.filter(x => x > 0).length, 0),
      capacityRange: [6, 40], rows: 7, cols: 7, cells: 49,
      blackCells: 0, targetCars: 49
    };
    if (THICKEN) {
      Object.assign(base, {
        obstacleThicken: {
          schema: 'obstacle-thicken-v1', iceTarget: 12, chainTarget: 6,
          chainSmallMax: 18, iceMinRow: 2
        },
        iceSchedule: true,
        iceByReadyTime: true,
        iceReadyBuckets: 4,
        iceReadyPerBucket: 3,
        iceScheduleCount: 12,
        iceMinRow: 2,
        chainThickenTarget: 6,
        chainPreferSmall: true,
        chainRequireSmall: true,
        chainSmallMax: 18,
        chainMinRow: 2,
        chainAllowAdjacent: true
      });
    }
  }
  return base;
}

function qSummary(q) {
  return q ? {
    gatePass: !!q.gatePass,
    gateReasons: q.gateReasons || [],
    pass: !!q.pass,
    reasons: q.reasons || [],
    label: q.label
  } : null;
}

function fillSummary(curve) {
  if (!curve) return null;
  return {
    freeLowPct: curve.freeLowPct,
    freeRunMax: curve.freeRunMax,
    selectMedian: curve.selectMedian,
    fullMedian2: curve.fullMedian2,
    partialStepPct: curve.partialStepPct,
    pressurePct3: curve.pressurePct3,
    pressurePeak: curve.pressurePeak
  };
}

let A = null;

function runOne(seed, mix) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(INPUT, 'utf8'));
  const cfg = configFor(blocks, seed, mix);
  const t0 = Date.now();
  let result = null;
  try { result = A.Generator.produceGoal(blocks, cfg); }
  catch (e) { result = { level: null, valid: false, error: String(e && e.message || e) }; }
  const raw = result && result.level || null;
  const parsed = raw ? A.parseLevel(raw) : null;
  const route = result && result.solveResult && result.solveResult.pickOrder || [];
  const curve = parsed && route.length
    ? A.Generator.choiceCurve(parsed, { completed: true, pickOrder: route }, OPTIONS)
    : null;
  const q = raw ? A.Quality.fromGeneration(result) : null;
  const exp = result && result._experienceFull || null;
  const black = raw ? boardStats(raw) : null;
  const rec = {
    arm: mix ? (THICKEN ? 'mix7-thick' : 'mix7') : 'control',
    seed,
    mix,
    valid: !!(result && result.valid && raw),
    error: result && result.error || null,
    failReason: result && result.lastFailReason || null,
    flowStats: result && result.flowStats || null,
    goalPass: !!(raw && A.Generator.goalResultExperiencePass(result, cfg)),
    goalStopReason: result && result.goalStopReason || null,
    board: raw && raw.board ? raw.board.rows + 'x' + raw.board.cols : null,
    black,
    fill: fillSummary(curve),
    quality: qSummary(q),
    experience: exp ? {
      pass: !!exp.pass,
      curvePass: !!exp.curvePass,
      metrics: exp.metrics || null,
      reasons: exp.reasons || [],
      releaseDecision: exp.releaseDecision || null
    } : null,
    capacityMixPlan: result && result.capacityMixPlan || null,
    obstacleThicken: result && result.obstacleThicken || null,
    capacityAudit: raw ? A.Quality.capacityEvidence(parsed, cfg) : null,
    levelHash: raw ? hash(raw) : null,
    wallMs: Date.now() - t0
  };
  if (raw) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    const stem = rec.arm + '_' + IMAGE_LABEL + '_' + seed;
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(raw, null, 2) + '\n');
    if (route.length) fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'), JSON.stringify(route, null, 2) + '\n');
  }
  console.log('[v614]', rec.arm, seed,
    'valid=' + rec.valid,
    'board=' + rec.board,
    'cars=' + (black && black.cars),
    'black=' + (black && black.blackPct),
    'cap=' + (black && black.capMin) + '~' + (black && black.capMax),
    'small=' + (black && black.small6to18),
    'qGate=' + (q && q.gatePass),
    'goal=' + rec.goalPass,
    'ms=' + rec.wallMs);
  return rec;
}

function main() {
  A = load();
  const rows = [];
  for (const seed of SEEDS) {
    if (ARMS !== 'mix') rows.push(runOne(seed, false));
    if (ARMS !== 'control') rows.push(runOne(seed, true));
  }
  const mixRows = rows.filter(x => x.mix && x.valid);
  const controlRows = rows.filter(x => !x.mix && x.valid);
  const summary = {
    runs: rows.length,
    valid: rows.filter(x => x.valid).length,
    controlValid: controlRows.length,
    mixValid: mixRows.length,
    mixZeroBlack: mixRows.filter(x => x.black && x.black.black === 0).length,
    mixGoals: mixRows.filter(x => x.goalPass).length,
    controlGoals: controlRows.filter(x => x.goalPass).length,
    mixedCapacityContract: mixRows.filter(x => x.capacityAudit &&
      x.capacityAudit.belowMin === 0 && x.capacityAudit.aboveMax === 0).length
  };
  fs.writeFileSync(OUT, JSON.stringify({
    schema: 'capacity-mix-production-v614',
    date: '2026-10-27',
    image: IMAGE,
    config: { roundMs: ROUND_MS, rounds: ROUNDS, arms: ARMS },
    summary,
    rows
  }, null, 2) + '\n');
  console.log(JSON.stringify({ summary, out: path.relative(ROOT, OUT) }, null, 2));
}

main();
