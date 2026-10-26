#!/usr/bin/env node
/** v574：复现 32 盒/9×9/四行黑块，并验证合规回退优先更大棋盘。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const INPUT = path.join(ROOT, '关卡', '关卡00199_原图039-056-023-038_分图3色_40x40.txt');
const OLD_DIR = path.join(ROOT, '02_工程', '完整主bin快照_20261012', '输出文件', 'unnamed-10-27-3', '生产文档', '关卡数据');
const OLD_LEVEL = path.join(OLD_DIR, '关卡00199_原图039-056-023-038_分图3色_40x40.json');
const OUT = path.join(__dirname, '黑块棋盘回退_v574.json');
const LEVEL_DIR = path.join(__dirname, '黑块棋盘回退_v574.levels');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const OPTIONS = { instantChain: true, bottomOnly: false };
const SEEDS = [1001, 1002];

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

function boardBlackStat(raw) {
  let black = 0, total = 0;
  for (let r = 0; r < raw.board.rows; r++) for (let c = 0; c < raw.board.cols; c++) {
    total++;
    const x = raw.board.cells[r] && raw.board.cells[r][c];
    if (x && x.t === 'black') black++;
  }
  return { black, total, pct: total ? +(black / total * 100).toFixed(2) : null };
}

function configFor(blocks, seed) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  return {
    seed,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantChain: true,
    bottomOnly: false,
    elimOrder: 'instant',
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
    cutMode: 'exposeCut',
    maxPipes: 1,
    chainByDemand: 4,
    iceForceSteps: 4,
    candidateCount: 1,
    boardRowsMin: 9,
    boardRowsMax: 9,
    boardColsMin: 9,
    boardColsMax: 19,
    boardHardRange: true,
    boardAuto: true,
    boardAllowSquare: true,
    boardExpandOnOverflow: false,
    boardFirst: true,
    boardFitGuard: 'warn',
    boardPrefer7: true,
    boardPrefer7Dims: null,
    hardBlackMaxPct: 30,
    p7BaseCount: 1,
    p7Repair: true,
    trapPost: false,
    pool: 1,
    semanticObstacles: false,
    usableSpaceTarget: 0,
    blackPercent: 0,
    narrowPath: false,
    minPipes: 0,
    pipeFloorCount: 2,
    pipeFloorDepth: 2,
    experienceGoal: true,
    instantReleaseRoute: false,
    goalPerRoundMs: 20000,
    goalMaxMs: 40000,
    goalMaxRounds: 2,
    goalBases: 1,
    goalSharedBudget: true,
    portfolioK: 1,
    acceptMode: 'target',
    hardOnly: true,
    requireHardPass: true,
    capacityTuneMs: 3000,
    capacityTuneCars: 8,
    capacityTuneVariants: 32,
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
}

function qSummary(q) {
  return q ? {
    gatePass: !!q.gatePass, gateReasons: q.gateReasons || [],
    pass: !!q.pass, reasons: q.reasons || [], label: q.label,
    gateDistance: q.gateDistance
  } : null;
}

let A = null;

function auditOld() {
  const raw = JSON.parse(fs.readFileSync(OLD_LEVEL, 'utf8'));
  const route = raw.solve && raw.solve.pickOrder || [];
  const parsed = A.parseLevel(raw);
  const curve = A.Generator.choiceCurve(parsed, { completed: true, pickOrder: route }, OPTIONS);
  const q = A.Quality.fromGeneration({
    level: parsed, valid: true, config: {}, goodV3: { fillCurve: curve, persist: {} }
  });
  const b = boardBlackStat(raw);
  return {
    id: 'old_unnamed-10-27-3',
    hash: hash(raw),
    board: raw.board.rows + 'x' + raw.board.cols,
    boxes: curve && curve.n,
    black: b,
    quality: qSummary(q)
  };
}

function runOne(seed) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(INPUT, 'utf8'));
  const cfg = configFor(blocks, seed);
  const t0 = Date.now();
  let r = null;
  try { r = A.Generator.produceGoal(blocks, cfg); }
  catch (e) { r = { level: null, valid: false, error: String(e && e.message || e) }; }
  const raw = r && r.level || null;
  const parsed = raw ? A.parseLevel(raw) : null;
  const route = r && r.solveResult && r.solveResult.pickOrder || [];
  const curve = parsed ? A.Generator.choiceCurve(parsed, { completed: true, pickOrder: route }, OPTIONS) : null;
  const q = raw ? A.Quality.fromGeneration(r) : null;
  const b = raw ? boardBlackStat(raw) : null;
  const rec = {
    seed,
    valid: !!(r && r.valid && raw),
    error: r && r.error || null,
    failReason: r && r.lastFailReason || null,
    goalPass: !!(raw && A.Generator.goalResultExperiencePass(r, cfg)),
    goalStopReason: r && r.goalStopReason || null,
    board: raw ? raw.board.rows + 'x' + raw.board.cols : null,
    boxes: curve && curve.n,
    black: b,
    boardFit: r && r.boardFit || null,
    capacity: raw ? A.Quality.capacityEvidence(parsed, cfg) : null,
    quality: qSummary(q),
    levelHash: raw ? hash(raw) : null,
    wallMs: Date.now() - t0
  };
  if (raw) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    const stem = '199_' + seed;
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(raw, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'), JSON.stringify(route, null, 2) + '\n');
  }
  console.log('[black]', seed, 'valid=' + rec.valid, 'board=' + rec.board, 'boxes=' + rec.boxes,
    'black=' + (b && b.pct), 'qGate=' + (q && q.gatePass), 'goal=' + rec.goalPass, 'ms=' + rec.wallMs);
  return rec;
}

function main() {
  A = load();
  const old = auditOld();
  const rows = SEEDS.map(runOne);
  const valid = rows.filter(x => x.valid);
  const summary = {
    oldBoard: old.board,
    oldBlackPct: old.black.pct,
    oldGatePass: old.quality.gatePass,
    newRuns: rows.length,
    valid: valid.length,
    goals: rows.filter(x => x.goalPass).length,
    blackAtMost30: valid.filter(x => x.black && x.black.pct <= 30).length,
    boards: rows.map(x => x.board),
    blackPcts: rows.map(x => x.black && x.black.pct),
    gatePasses: rows.filter(x => x.quality && x.quality.gatePass).length
  };
  fs.writeFileSync(OUT, JSON.stringify({
    schema: 'black-board-fallback-v574', date: '2026-10-27',
    old, summary, rows
  }, null, 2) + '\n');
  console.log(JSON.stringify({ summary, old, out: path.relative(ROOT, OUT) }, null, 2));
}

main();
