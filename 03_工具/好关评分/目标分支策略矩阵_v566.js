#!/usr/bin/env node
/** v566：真实A/B分支 recipes × supply/shortDebt，两点目标覆盖验证。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const OUT = path.join(__dirname, '目标分支策略矩阵_v566.json');
const LEVEL_DIR = path.join(__dirname, '目标分支策略矩阵_v566.levels');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const CASES = [
  { image: '006', seed: 1001 },
  { image: '010', seed: 1002 }
];
const IMAGE_PATHS = {
  '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
  '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt'
};
const RECIPES = [
  { id: 'A_base', cutMode: 'layerCut2', maxPipes: 2, chainByDemand: 4, iceForceSteps: 0 },
  { id: 'B_expose', cutMode: 'exposeCut', maxPipes: 1, chainByDemand: 4, iceForceSteps: 4 }
];
const POLICIES = ['supply', 'shortDebt'];

let A = null;

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

function cfgFor(blocks, seed, recipe, policy) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  return {
    seed,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantPlanPolicy: policy,
    instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40,
    instantPlanDebtEvery: 4,
    instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 8,
    capScalePlan: [1.45, 1.15],
    boxSizeMin: b[0],
    boxSizeMax: b[1],
    capNormMin: b[0],
    capNormMax: b[1],
    cutMode: recipe.cutMode,
    maxPipes: recipe.maxPipes,
    chainByDemand: recipe.chainByDemand,
    iceForceSteps: recipe.iceForceSteps,
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

function runOne(c, recipe, policy) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE_PATHS[c.image]), 'utf8'));
  const cfg = cfgFor(blocks, c.seed, recipe, policy);
  const t0 = Date.now();
  let r = null;
  try { r = A.Generator.produceGoal(blocks, cfg); }
  catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const wallMs = Date.now() - t0;
  const level = r && r.level || null;
  const q = level ? A.Quality.fromGeneration(r) : null;
  const cap = level ? A.Quality.capacityEvidence(level, r.config || cfg) : null;
  const ev = level ? A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, {
    solveResult: r.solveResult, decision: false, instantChain: true, bottomOnly: false
  })) : null;
  const plan = r && r.config && r.config._instantPlayoutStat || null;
  const goalPass = !!(level && A.Generator.goalResultExperiencePass(r, cfg));
  if (level) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    const stem = c.image + '_' + c.seed + '_' + recipe.id + '_' + policy;
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(level, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'),
      JSON.stringify(r.solveResult && r.solveResult.pickOrder || [], null, 2) + '\n');
  }
  const rec = {
    image: c.image,
    seed: c.seed,
    recipe: recipe.id,
    recipeOverrides: recipe,
    policy,
    valid: !!(r && r.valid),
    levelHash: level ? hash(level) : null,
    board: level ? level.board.rows + 'x' + level.board.cols : null,
    structurePass: !!(q && q.gatePass),
    gateReasons: q && q.gateReasons || [],
    goalPass,
    metrics: ev && ev.metrics || null,
    releaseStatus: ev && ev.releaseDecision && ev.releaseDecision.status || null,
    capacity: cap ? {
      conserved: cap.conserved,
      perColorConserved: cap.perColorConserved,
      aboveMax: cap.aboveMax,
      belowMin: cap.belowMin,
      boxSizeMin: cap.boxSizeMin,
      boxSizeMax: cap.boxSizeMax
    } : null,
    actualPlanPolicy: plan && plan.policy || null,
    planOk: plan && plan.ok,
    planReason: plan && plan.reason || null,
    goalRounds: r && r.goalRounds || null,
    goalStopReason: r && r.goalStopReason || null,
    wallMs
  };
  console.log('[matrix]', c.image + '/' + c.seed, recipe.id, policy,
    'valid=' + rec.valid,
    'struct=' + rec.structurePass,
    'mid=' + (rec.metrics && rec.metrics.midBuffer34Pct),
    'sig=' + (rec.metrics && rec.metrics.significantReleaseCount),
    'goal=' + rec.goalPass,
    'ms=' + wallMs);
  return rec;
}

function main() {
  A = load();
  const rows = [];
  for (const c of CASES) {
    for (const recipe of RECIPES) {
      for (const policy of POLICIES) rows.push(runOne(c, recipe, policy));
    }
  }
  const byCase = {};
  for (const c of CASES) {
    const id = c.image + '/' + c.seed;
    const a = rows.filter(x => x.image === c.image && x.seed === c.seed);
    byCase[id] = {
      winners: a.filter(x => x.goalPass).map(x => x.recipe + '/' + x.policy),
      valid: a.filter(x => x.valid).map(x => x.recipe + '/' + x.policy),
      structure: a.filter(x => x.structurePass).map(x => x.recipe + '/' + x.policy),
      bestMid: a.filter(x => x.metrics).sort((x, y) =>
        (y.metrics.midBuffer34Pct || 0) - (x.metrics.midBuffer34Pct || 0))[0] || null
    };
  }
  const winners = rows.filter(x => x.goalPass);
  const cover006 = winners.some(x => x.image === '006');
  const cover010 = winners.some(x => x.image === '010');
  const summary = {
    runs: rows.length,
    valid: rows.filter(x => x.valid).length,
    structurePass: rows.filter(x => x.structurePass).length,
    goalPass: winners.length,
    cover006,
    cover010,
    byCase,
    aboveMax: rows.filter(x => x.capacity && x.capacity.aboveMax > 0).length,
    perColorFail: rows.filter(x => x.capacity && x.capacity.perColorConserved !== true).length,
    byRecipePolicy: Object.fromEntries(RECIPES.flatMap(r => POLICIES.map(p => {
      const a = rows.filter(x => x.recipe === r.id && x.policy === p);
      return [r.id + '/' + p, {
        runs: a.length,
        valid: a.filter(x => x.valid).length,
        structurePass: a.filter(x => x.structurePass).length,
        goalPass: a.filter(x => x.goalPass).length
      }];
    }))),
    decision: cover006 && cover010
      ? 'A/B两分支内存在supply+shortDebt组合可覆盖两个代表样本；可进入生产分支配比修改。'
      : 'A/B两分支与supply/shortDebt组合仍不能同时覆盖两个样本；不修改生产。'
  };
  const report = {
    schema: 'goal-branch-policy-matrix-v566',
    date: '2026-10-26',
    preregistration: '目标分支策略矩阵_预登记_v566.md',
    recipes: RECIPES,
    policies: POLICIES,
    summary,
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main();
