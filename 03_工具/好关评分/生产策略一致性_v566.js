#!/usr/bin/env node
/** v566：同预算比较真实UI缺省supply、targetBuffer4和shortDebt三条瞬时计划策略。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const OUT = path.join(__dirname, '生产策略一致性_v566.json');
const LEVEL_DIR = path.join(__dirname, '生产策略一致性_v566.levels');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const CASES = [
  ['006', 1001],
  ['006', 1002],
  ['010', 1001],
  ['010', 1002]
].map(x => ({ image: x[0], seed: x[1] }));
const POLICIES = [
  { id: 'A_supply_ui_default', value: undefined },
  { id: 'B_target4_debt40', value: 'targetBuffer' },
  { id: 'C_short_debt', value: 'shortDebt' }
];
const IMAGE_PATHS = {
  '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
  '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt'
};

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

function median(xs) {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function cfgFor(blocks, seed, policy) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  const frontier = band.frontier && band.frontier.avg;
  return {
    seed,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantPlanPolicy: policy,
    instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40,
    instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 8,
    capScalePlan: [1.45, 1.15],
    boxSizeMin: b[0],
    boxSizeMax: b[1],
    capNormMin: b[0],
    capNormMax: b[1],
    cutMode: 'layerCut2',
    candidateCount: 14,
    boardRowsMin: 4,
    boardRowsMax: 6,
    boardColsMin: 6,
    boardColsMax: 8,
    boardHardRange: false,
    boardAuto: false,
    boardAllowSquare: true,
    boardExpandOnOverflow: false,
    boardFirst: true,
    boardFitGuard: 'warn',
    boardPrefer7: true,
    boardPrefer7Dims: null,
    p7BaseCount: 1,
    p7Repair: true,
    trapPost: false,
    pool: 1,
    maxPipes: 2,
    chainByDemand: 4,
    iceForceSteps: 0,
    semanticObstacles: true,
    usableSpaceTarget: 0.86,
    minPipes: 0,
    blackPercent: 10,
    narrowPath: true,
    experienceGoal: true,
    instantReleaseRoute: false,
    goalPerRoundMs: 20000,
    goalMaxMs: 40000,
    goalMaxRounds: 2,
    goalSharedBudget: true,
    goalBases: 1,
    portfolioK: 1,
    acceptMode: 'target',
    targetBand3Min: 0,
    targetBand4Min: 0,
    targetPlayerPassMin: 0,
    capacityTuneMs: 3000,
    capacityTuneCars: 4,
    capacityTuneVariants: 12,
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

function runOne(c, p) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE_PATHS[c.image]), 'utf8'));
  const cfg = cfgFor(blocks, c.seed, p.value);
  const t0 = Date.now();
  let r = null;
  try {
    r = A.Generator.produceGoal(blocks, cfg);
  } catch (e) {
    r = { level: null, valid: false, error: String((e && e.message) || e) };
  }
  const wallMs = Date.now() - t0;
  const level = r && r.level || null;
  const q = level ? A.Quality.fromGeneration(r) : null;
  const cap = level ? A.Quality.capacityEvidence(level, r.config || cfg) : null;
  const ev = level ? A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, {
    solveResult: r.solveResult,
    decision: false,
    instantChain: true,
    bottomOnly: false
  })) : null;
  const plan = r && r.config && r.config._instantPlayoutStat || null;
  const goalPass = !!(level && A.Generator.goalResultExperiencePass(r, cfg));
  if (level) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    const stem = c.image + '_' + c.seed + '_' + p.id;
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(level, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'),
      JSON.stringify(r.solveResult && r.solveResult.pickOrder || [], null, 2) + '\n');
  }
  const rec = {
    image: c.image,
    seed: c.seed,
    policy: p.id,
    requestedPolicy: p.value || 'supply',
    actualPlanPolicy: plan && plan.policy || null,
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
      minCap: cap.minCap,
      maxCap: cap.maxCap,
      boxSizeMin: cap.boxSizeMin,
      boxSizeMax: cap.boxSizeMax
    } : null,
    plan: plan ? {
      policy: plan.policy,
      ok: plan.ok,
      reason: plan.reason || null,
      cars: plan.cars,
      debtCars: plan.debtCars,
      maxBuffer: plan.maxBuffer,
      covered: plan.covered,
      total: plan.total,
      exactCapacityColors: plan.exactCapacityColors,
      infeasibleCapacityColors: plan.infeasibleCapacityColors
    } : null,
    goalRounds: r && r.goalRounds || null,
    goalStopReason: r && r.goalStopReason || null,
    goalElapsedMs: r && r.goalElapsedMs || null,
    wallMs,
    error: r && r.error || null
  };
  console.log('[strategy]', c.image + '/' + c.seed, p.id,
    'actual=' + rec.actualPlanPolicy,
    'valid=' + rec.valid,
    'struct=' + rec.structurePass,
    'mid=' + (rec.metrics && rec.metrics.midBuffer34Pct),
    'sig=' + (rec.metrics && rec.metrics.significantReleaseCount),
    'goal=' + rec.goalPass,
    'ms=' + rec.wallMs);
  return rec;
}

function summarize(rows) {
  const byPolicy = {};
  for (const p of POLICIES) {
    const a = rows.filter(x => x.policy === p.id);
    byPolicy[p.id] = {
      runs: a.length,
      valid: a.filter(x => x.valid).length,
      structurePass: a.filter(x => x.structurePass).length,
      goalPass: a.filter(x => x.goalPass).length,
      aboveMax: a.filter(x => x.capacity && x.capacity.aboveMax > 0).length,
      perColorFail: a.filter(x => x.capacity && x.capacity.perColorConserved !== true).length,
      midBuffer34Pct: a.map(x => x.metrics && x.metrics.midBuffer34Pct),
      maxBuffer: a.map(x => x.metrics && x.metrics.maxBuffer),
      significantReleaseCount: a.map(x => x.metrics && x.metrics.significantReleaseCount),
      releaseStatus: a.map(x => x.releaseStatus),
      actualPlanPolicies: a.map(x => x.actualPlanPolicy),
      rounds: a.map(x => x.goalRounds),
      stopReasons: a.map(x => x.goalStopReason),
      wallMsMedian: median(a.map(x => x.wallMs)),
      wallMsMax: a.length ? Math.max.apply(null, a.map(x => x.wallMs)) : null
    };
  }
  const byCase = {};
  for (const c of CASES) {
    const id = c.image + '/' + c.seed;
    byCase[id] = {};
    for (const p of POLICIES) {
      const x = rows.find(y => y.image === c.image && y.seed === c.seed && y.policy === p.id);
      byCase[id][p.id] = x ? {
        actualPlanPolicy: x.actualPlanPolicy,
        structurePass: x.structurePass,
        goalPass: x.goalPass,
        midBuffer34Pct: x.metrics && x.metrics.midBuffer34Pct,
        maxBuffer: x.metrics && x.metrics.maxBuffer,
        significantReleaseCount: x.metrics && x.metrics.significantReleaseCount,
        releaseStatus: x.releaseStatus,
        wallMs: x.wallMs
      } : null;
    }
  }
  const a = byPolicy.A_supply_ui_default;
  const b = byPolicy.B_target4_debt40;
  const c0 = byPolicy.C_short_debt;
  const systematic = !!(
    a && b && c0 &&
    median(b.midBuffer34Pct) > median(a.midBuffer34Pct) &&
    median(c0.midBuffer34Pct) > median(a.midBuffer34Pct) &&
    (b.structurePass > a.structurePass || c0.structurePass > a.structurePass)
  );
  return {
    runs: rows.length,
    actualPolicyMismatch: rows.some(x =>
      (x.requestedPolicy === 'supply' && x.actualPlanPolicy !== 'supply') ||
      (x.requestedPolicy !== 'supply' && x.actualPlanPolicy !== x.requestedPolicy)),
    byPolicy,
    byCase,
    medianMidByPolicy: {
      A: median(a && a.midBuffer34Pct),
      B: median(b && b.midBuffer34Pct),
      C: median(c0 && c0.midBuffer34Pct)
    },
    systematicDifference: systematic,
    decision: systematic
      ? 'B/C中段压力中位高于生产缺省supply，且结构通过数不低；应把目标模式UI显式绑定到胜出策略并做版本化验收。'
      : '本样本未见B/C对生产缺省supply的稳定结构优势；不得仅凭历史v529直接改生产。'
  };
}

function main() {
  A = load();
  const rows = [];
  for (const c of CASES) for (const p of POLICIES) rows.push(runOne(c, p));
  const report = {
    schema: 'production-plan-policy-consistency-v566',
    date: '2026-10-26',
    preregistration: '生产策略一致性_预登记_v566.md',
    fixed: {
      images: ['006', '010'],
      seeds: [1001, 1002],
      goalPerRoundMs: 20000,
      goalMaxMs: 40000,
      goalMaxRounds: 2,
      policies: POLICIES
    },
    summary: summarize(rows),
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
