#!/usr/bin/env node
/** v571：验证瞬时/四边模式的计划障碍与最终棋盘实际障碍是否一致。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const INPUT_ROOT = path.join(ROOT, '关卡');
const OUT = path.join(__dirname, arg('out', '障碍落地修复验证_v571.json'));
const LEVEL_DIR = path.join(__dirname, arg('levels-dir', '障碍落地修复验证_v571.levels'));
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];

function arg(name, def) {
  const p = '--' + name + '=';
  const hit = process.argv.find(x => x.indexOf(p) === 0);
  return hit ? hit.slice(p.length) : def;
}

const MODE_ARG = arg('mode', 'instant');
const IMAGE_ARG = arg('images', '152');
const SEED_ARG = arg('seeds', '1001');
const QUALITY_ARG = arg('quality', 'compact');
const ICE_COUNT = +arg('ice-count', '4');
const ICE_FORCE = +arg('ice-force', '4');
const ICE_BUCKETS = +arg('ice-buckets', '3');
const ICE_CAP_RATIO = +arg('ice-cap', '0.25');
const MODES = MODE_ARG === 'both' ? ['instant', 'fourSide'] : [MODE_ARG];
const IMAGE_IDS = IMAGE_ARG.split(',').map(x => x.trim()).filter(Boolean);
const SEEDS = SEED_ARG.split(',').map(x => +x).filter(x => x > 0);

const IMAGES = {
  '006': path.join(ROOT, '蚂蚁图库', '拼接图', '拼接图图库', '35x35拼接图纸_006.txt'),
  '007': path.join(ROOT, '蚂蚁图库', '拼接图', '拼接图图库', '35x35拼接图纸_007.txt'),
  '010': path.join(ROOT, '蚂蚁图库', '拼接图', '拼接图图库', '35x35拼接图纸_010.txt'),
  '152': path.join(INPUT_ROOT, '关卡00152_原图050-051-060-017_整体双色_38x38.txt')
};

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

function modeConfig(mode) {
  const instant = mode === 'instant';
  return {
    ruleMode: instant ? 'instantChain' : 'fourSide',
    instantChain: instant,
    bottomOnly: false,
    elimOrder: instant ? 'instant' : 'sequential'
  };
}

function configFor(blocks, seed, mode) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  return Object.assign({
    seed,
    generatorFlow: 'new_fixed',
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
    iceForceSteps: ICE_FORCE,
    candidateCount: 1,
    boardRowsMin: 6,
    boardRowsMax: 9,
    boardColsMin: 6,
    boardColsMax: 9,
    boardHardRange: false,
    boardAuto: true,
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
    semanticObstacles: false,
    usableSpaceTarget: 0.86,
    blackPercent: 6,
    narrowPath: false,
    experienceGoal: true,
    instantReleaseRoute: false,
    goalPerRoundMs: QUALITY_ARG === 'full' ? 20000 : 10000,
    goalMaxMs: QUALITY_ARG === 'full' ? 40000 : 20000,
    goalMaxRounds: 2,
    goalBases: 1,
    goalSharedBudget: true,
    portfolioK: 1,
    acceptMode: 'target',
    targetBand3Min: 0,
    targetBand4Min: 0,
    targetPlayerPassMin: 0,
    hardOnly: true,
    requireHardPass: true,
    capacityTuneMs: 2500,
    capacityTuneCars: 8,
    capacityTuneVariants: 32,
    localSwapRepair: true,
    localSwapRepairMaxMs: 4000,
    localSwapStage1Pairs: 24,
    localSwapStage1Ms: 2000,
    localSwapStage2Pairs: 32,
    localSwapStage2Ms: 2000,
    maxDecisionStates: 8,
    stateSampleMode: 'midStratified',
    minReleaseAmplitude: 2,
    icePercent: 0,
    iceSchedule: true,
    iceScheduleCount: ICE_COUNT,
    iceScheduleDelay: 7,
    iceSync: false,
    iceByReadyTime: true,
    iceReadyBuckets: ICE_BUCKETS,
    iceReadyPerBucket: 1,
    iceBandMode: true,
    iceBandLo: 0.35,
    iceBandHi: 0.70,
    iceBandPoints: [0.25, 0.35, 0.45, 0.55, 0.65],
    icePerPoint: 2,
    iceMultiPoint: true,
    iceScaleCoef: 0.6,
    iceCapRatio: ICE_CAP_RATIO,
    questionPercent: 0,
    chainCount: 0
  }, modeConfig(mode));
}

function scanActual(level) {
  const cells = level.board.cells;
  const ice = [], q = [], chain = {}, pipes = [], black = [];
  for (let r = 0; r < level.board.rows; r++) for (let c = 0; c < level.board.cols; c++) {
    const x = cells[r] && cells[r][c];
    if (!x) continue;
    if (x.t === 'black') black.push({ r, c });
    else if (x.t === 'pipe') pipes.push({ r, c, queueLen: (x.queue || []).length });
    else if (x.t === 'box') {
      if (x.numice > 0) ice.push({ r, c, numice: x.numice, color: x.color, count: x.count });
      if (x.q) q.push({ r, c, color: x.color, count: x.count });
      if (x.chain > 0) (chain[x.chain] = chain[x.chain] || []).push({ r, c, color: x.color, count: x.count });
    }
  }
  return {
    iceCount: ice.length, questionCount: q.length, chainGroupCount: Object.keys(chain).length,
    chainMemberCount: Object.values(chain).reduce((n, a) => n + a.length, 0),
    pipeCount: pipes.length, blackCount: black.length,
    functionalCount: ice.length + q.length + Object.keys(chain).length + pipes.length,
    ice, q, chain, pipes
  };
}

function emptyPlan(plan) {
  return !plan || plan.functional == null || plan.functional === 0;
}

let A = null;

function runOne(imageId, seed, mode) {
  const input = IMAGES[imageId];
  if (!input || !fs.existsSync(input)) throw new Error('missing image ' + imageId);
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(input, 'utf8'));
  const cfg = configFor(blocks, seed, mode);
  const t0 = Date.now();
  let r = null;
  try { r = A.Generator.produceGoal(blocks, cfg); }
  catch (e) { r = { level: null, valid: false, error: String(e && e.message || e) }; }
  const wallMs = Date.now() - t0;
  const raw = r && r.level || null;
  const level = raw ? A.parseLevel(raw) : null;
  const actual = level ? scanActual(level) : null;
  const plan = r && r.obstaclePlanStat || null;
  const landing = r && r.obstacleLanding || null;
  const q = raw ? A.Quality.fromGeneration(r) : null;
  const cap = level ? A.Quality.capacityEvidence(level, cfg) : null;
  const experience = raw
    ? A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, {
      solveResult: r.solveResult, decision: true,
      bottomOnly: false, instantChain: mode === 'instant'
    }))
    : null;
  const player = level
    ? A.PlayerSim.run(level, {
      seed: 7, useItems: false, reviveCap: 0, capturePreviewStats: true,
      bottomOnly: false, instantChain: mode === 'instant'
    })
    : null;
  const rec = {
    id: imageId + '_' + seed + '_' + mode,
    image: imageId, seed, mode,
    valid: !!(r && r.valid && raw),
    error: r && r.error || null,
    failReason: r && r.lastFailReason || null,
    wallMs,
    levelHash: raw ? hash(raw) : null,
    board: raw ? raw.board.rows + 'x' + raw.board.cols : null,
    plan,
    actual,
    landing,
    chokeTypes: r && r.actualChokeTypes || [],
    chokeMarks: r && r.chokeMarks || [],
    goalPass: !!(raw && A.Generator.goalResultExperiencePass(r, cfg)),
    goalStopReason: r && r.goalStopReason || null,
    goalRounds: r && r.goalRounds || null,
    structure: q ? { pass: !!q.gatePass, reasons: q.gateReasons || [], qPass: !!q.pass, qReasons: q.reasons || [] } : null,
    capacity: cap ? {
      conserved: cap.conserved, perColorConserved: cap.perColorConserved,
      boardFloorPass: cap.boardFloorPass, aboveMax: cap.aboveMax, belowMin: cap.belowMin,
      minCap: cap.minCap, maxCap: cap.maxCap
    } : null,
    experience: experience ? {
      pass: !!experience.pass, reasons: experience.reasons || [], metrics: experience.metrics,
      releaseStatus: experience.releaseDecision && experience.releaseDecision.status || null
    } : null,
    player: player ? {
      won: !!player.won, progress: player.progress, bufferPeak: player.bufferPeak,
      playerAvgBuffer: player.playerAvgBuffer, lastRefuse: player.lastRefuse || null
    } : null,
    actualMatchesScan: !!(actual && r && r.actualObstacleStat &&
      actual.iceCount === r.actualObstacleStat.iceCount &&
      actual.chainGroupCount === r.actualObstacleStat.chainGroupCount &&
      actual.questionCount === r.actualObstacleStat.questionCount &&
      actual.pipeCount === r.actualObstacleStat.pipeCount),
    planLandingOk: !!(landing ? landing.ok : emptyPlan(plan)),
    hasAnyFunctionalObstacle: !!(actual && actual.functionalCount > 0)
  };
  if (raw) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    fs.writeFileSync(path.join(LEVEL_DIR, rec.id + '.json'), JSON.stringify(raw, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, rec.id + '.route.json'),
      JSON.stringify(r.solveResult && r.solveResult.pickOrder || [], null, 2) + '\n');
  }
  console.log('[obstacle]', rec.id,
    'valid=' + rec.valid,
    'goal=' + rec.goalPass,
    'board=' + rec.board,
    'plan=' + (plan ? JSON.stringify({ ice: plan.ice, q: plan.question, chain: plan.chainGroups, pipe: plan.pipe }) : '-'),
    'actual=' + (actual ? JSON.stringify({ ice: actual.iceCount, q: actual.questionCount, chain: actual.chainGroupCount, pipe: actual.pipeCount }) : '-'),
    'landing=' + rec.planLandingOk,
    'player=' + (player && player.won),
    'ms=' + wallMs);
  return rec;
}

function main() {
  A = load();
  const rows = [];
  for (const mode of MODES) for (const image of IMAGE_IDS) for (const seed of SEEDS) {
    try { rows.push(runOne(image, seed, mode)); }
    catch (e) { rows.push({ image, seed, mode, error: String(e && e.message || e) }); }
  }
  const valid = rows.filter(x => x.valid);
  const summary = {
    runs: rows.length,
    valid: valid.length,
    errors: rows.filter(x => x.error).length,
    goals: rows.filter(x => x.goalPass).length,
    planLandingOk: rows.filter(x => x.planLandingOk).length,
    actualMatchesScan: rows.filter(x => x.actualMatchesScan).length,
    withFunctionalObstacles: rows.filter(x => x.hasAnyFunctionalObstacle).length,
    withIce: valid.filter(x => x.actual && x.actual.iceCount > 0).length,
    withChains: valid.filter(x => x.actual && x.actual.chainGroupCount > 0).length,
    withQuestions: valid.filter(x => x.actual && x.actual.questionCount > 0).length,
    withPipes: valid.filter(x => x.actual && x.actual.pipeCount > 0).length,
    byMode: Object.fromEntries([...new Set(rows.map(x => x.mode))].map(mode => {
      const a = rows.filter(x => x.mode === mode);
      return [mode, {
        runs: a.length, valid: a.filter(x => x.valid).length,
        goals: a.filter(x => x.goalPass).length,
        landingOk: a.filter(x => x.planLandingOk).length,
        withIce: a.filter(x => x.actual && x.actual.iceCount > 0).length,
        withFunctional: a.filter(x => x.hasAnyFunctionalObstacle).length
      }];
    }))
  };
  const report = {
    schema: 'obstacle-landing-v571',
    date: '2026-10-26',
    modes: MODES, images: IMAGE_IDS, seeds: SEEDS,
    summary, rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary, out: path.relative(ROOT, OUT) }, null, 2));
}

main();
