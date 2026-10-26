#!/usr/bin/env node
/** v568 M7b：留出图008/014 × 独立seed41001~41004，目标模式B配方验证。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
function arg(name, def) {
  const prefix = '--' + name + '=';
  const hit = process.argv.find(x => x.indexOf(prefix) === 0);
  return hit ? hit.slice(prefix.length) : def;
}
const ARM = arg('arm', 'B');
const CAP_SCALE = arg('cap-scale', 'off');
const OUT = path.join(__dirname, arg('out', 'M7独立seed留出图_v568.json'));
const LEVEL_DIR = path.join(__dirname, arg('levels-dir', 'M7独立seed留出图_v568.levels'));
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const IMAGES = {
  '008': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_008.txt',
  '014': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_014.txt'
};
const SEEDS = [41001, 41002, 41003, 41004];

let A = null;

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

function cfgFor(blocks, seed) {
  const b = A.Generator.deriveCapacityBand(blocks).band;
  return {
    seed,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantPlanPolicy: ARM === 'A' ? 'supply' : 'shortDebt',
    instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40,
    instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 8,
    capScalePlan: CAP_SCALE === 'off' ? null : [1.45, 1.15],
    boxSizeMin: b[0], boxSizeMax: b[1], capNormMin: b[0], capNormMax: b[1],
    cutMode: ARM === 'A' ? 'layerCut2' : 'exposeCut',
    maxPipes: ARM === 'A' ? 2 : 1,
    iceForceSteps: ARM === 'A' ? 0 : 4,
    chainByDemand: 4,
    candidateCount: 14,
    portfolioK: 1,
    goalBases: 1,
    boardRowsMin: 4, boardRowsMax: 6, boardColsMin: 6, boardColsMax: 8,
    boardHardRange: false, boardAuto: false, boardAllowSquare: true,
    boardExpandOnOverflow: true, boardFirst: true, boardFitGuard: 'warn',
    boardPrefer7: true, boardPrefer7Dims: null,
    p7BaseCount: 1, p7Repair: true, trapPost: true, pool: 1,
    targetCarCount: 0, semanticObstacles: true,
    usableSpaceTarget: 0.86, blackPercent: 10, narrowPath: true,
    experienceGoal: true, instantReleaseRoute: false,
    goalPerRoundMs: 20000, goalMaxMs: 40000, goalMaxRounds: 2,
    goalSharedBudget: true,
    acceptMode: 'target', targetBand3Min: 0, targetBand4Min: 0,
    targetPlayerPassMin: 0.25,
    capacityTuneMs: 5000, capacityTuneCars: 8, capacityTuneVariants: 48,
    localSwapRepair: true, localSwapRepairMaxMs: 8000,
    localSwapStage1Pairs: 32, localSwapStage1Ms: 4000,
    localSwapStage2Pairs: 64, localSwapStage2Ms: 4000,
    maxDecisionStates: 8, stateSampleMode: 'midStratified',
    minReleaseAmplitude: 2
  };
}

function runOne(image, seed) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGES[image]), 'utf8'));
  const cfg = cfgFor(blocks, seed);
  const preflight = A.SourcePreflight ? A.SourcePreflight.analyze(blocks) : null;
  const t0 = Date.now();
  let r = null;
  try { r = A.Generator.produceGoal(blocks, cfg); }
  catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const wallMs = Date.now() - t0;
  const level = r && r.level || null;
  const q = level ? A.Quality.fromGeneration(r) : null;
  // 容量合同只能按调用前的原始 cfg 审计；生成器完成后的 config 可能含派生/改写值。
  const cap = level ? A.Quality.capacityEvidence(level, cfg) : null;
  const ev = level ? A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, {
    solveResult: r.solveResult, decision: false, instantChain: true, bottomOnly: false
  })) : null;
  const persist = r && r.goodV3 && r.goodV3.persist || {};
  const goalPass = !!(level && A.Generator.goalResultExperiencePass(r, cfg));
  if (level) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    const stem = image + '_' + seed;
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(level, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'),
      JSON.stringify(r.solveResult && r.solveResult.pickOrder || [], null, 2) + '\n');
  }
  const rec = {
    image,
    seed,
    preflight: preflight ? {
      status: preflight.status,
      warnings: preflight.warnings || [],
      capacity: preflight.capacity,
      estimate: preflight.estimate
    } : null,
    valid: !!(r && r.valid),
    levelHash: level ? hash(level) : null,
    board: level ? level.board.rows + 'x' + level.board.cols : null,
    structurePass: !!(q && q.gatePass),
    gateReasons: q && q.gateReasons || [],
    qPass: !!(q && q.pass),
    qReasons: q && q.reasons || [],
    experienceGoalPass: goalPass,
    metrics: ev && ev.metrics || null,
    experienceReasons: ev && ev.reasons || [],
    releaseStatus: ev && ev.releaseDecision && ev.releaseDecision.status || null,
    capacity: cap ? {
      conserved: cap.conserved,
      perColorConserved: cap.perColorConserved,
      aboveMax: cap.aboveMax,
      belowMin: cap.belowMin,
      minCap: cap.minCap,
      maxCap: cap.maxCap,
      boxSizeMin: cap.boxSizeMin,
      boxSizeMax: cap.boxSizeMax,
      boardFloorPass: cap.boardFloorPass
    } : null,
    player: {
      first: persist.playerPassPct,
      learned: persist.learnedPassPct,
      lookahead: persist.lookaheadPassPct
    },
    goalRounds: r && r.goalRounds || null,
    goalStopReason: r && r.goalStopReason || null,
    wallMs,
    error: r && r.error || null
  };
  console.log('[m7b]', image, seed,
    'valid=' + rec.valid,
    'struct=' + rec.structurePass,
    'goal=' + rec.experienceGoalPass,
    'q=' + rec.qPass,
    'mid=' + (rec.metrics && rec.metrics.midBuffer34Pct),
    'sig=' + (rec.metrics && rec.metrics.significantReleaseCount),
    'ms=' + wallMs);
  return rec;
}

function main() {
  A = load();
  const rows = [];
  for (const image of Object.keys(IMAGES)) for (const seed of SEEDS) rows.push(runOne(image, seed));
  const byImage = {};
  for (const image of Object.keys(IMAGES)) {
    const a = rows.filter(x => x.image === image);
    byImage[image] = {
      runs: a.length,
      valid: a.filter(x => x.valid).length,
      structurePass: a.filter(x => x.structurePass).length,
      experienceGoalPass: a.filter(x => x.experienceGoalPass).length,
      qPass: a.filter(x => x.qPass).length,
      aboveMax: a.filter(x => x.capacity && x.capacity.aboveMax > 0).length,
      perColorFail: a.filter(x => x.capacity && x.capacity.perColorConserved !== true).length,
      midValues: a.map(x => x.metrics && x.metrics.midBuffer34Pct),
      release: a.map(x => x.releaseStatus),
      wallMedianMs: (function () {
        const v = a.map(x => x.wallMs).sort((x, y) => x - y);
        const m = Math.floor(v.length / 2);
        return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
      })()
    };
  }
  const summary = {
    runs: rows.length,
    valid: rows.filter(x => x.valid).length,
    structurePass: rows.filter(x => x.structurePass).length,
    experienceGoalPass: rows.filter(x => x.experienceGoalPass).length,
    qPass: rows.filter(x => x.qPass).length,
    aboveMax: rows.filter(x => x.capacity && x.capacity.aboveMax > 0).length,
    perColorFail: rows.filter(x => x.capacity && x.capacity.perColorConserved !== true).length,
    noCandidate: rows.filter(x => !x.valid).length,
    byImage,
    decision: rows.filter(x => x.experienceGoalPass).length
      ? '留出样本出现目标pass，v568具备初步跨图信号；范围仍需扩大。'
      : (rows.filter(x => x.structurePass).length
        ? '留出样本全部/部分结构有效但目标0通过；可用性修复成立、质量泛化未成立。'
        : '留出样本没有结构有效关卡；v568需回退检查。')
  };
  fs.writeFileSync(OUT, JSON.stringify({
    schema: 'm7-independent-seeds-heldout-v568',
    date: '2026-10-26',
    preregistration: 'M7独立seed留出图_预登记_v568.md',
    arm: ARM,
    capScale: CAP_SCALE,
    images: IMAGES,
    seeds: SEEDS,
    summary,
    rows
  }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main();
