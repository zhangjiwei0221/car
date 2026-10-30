#!/usr/bin/env node
/** v570 P2b：固定006/1001，只比较shortDebt与targetBuffer两种供给计划策略。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const OUT = path.join(__dirname, '006策略对照_v570.json');
const LEVEL_DIR = path.join(__dirname, '006策略对照_v570.levels');
const IMAGE_PATH = path.join(ROOT, '蚂蚁图库', '拼接图', '拼接图图库', '35x35拼接图纸_006.txt');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const POLICIES = ['shortDebt', 'targetBuffer'];
const REPEATS = 2;
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

function configFor(blocks, policy) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  return {
    seed: 1001,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantPlanPolicy: policy,
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
    lastBlocked: player.lastBlocked || null
  };
}

function summarizePlan(plan) {
  if (!plan) return null;
  return {
    policy: plan.policy || null,
    ok: plan.ok,
    reason: plan.reason || null,
    cars: plan.cars,
    debtCars: plan.debtCars,
    maxBuffer: plan.maxBuffer,
    bufferEvents: plan.bufferEvents,
    medianEntryReach: plan.medianEntryReach,
    medianConsumed: plan.medianConsumed,
    covered: plan.covered,
    total: plan.total,
    deadlock: !!plan.audit && !!plan.audit.deadlock,
    targetCars: plan.targetCars,
    capRange: plan.capRange
  };
}

function runOne(policy, repeat) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(IMAGE_PATH, 'utf8'));
  const cfg = configFor(blocks, policy);
  const t0 = Date.now();
  let r = null;
  try {
    r = A.Generator.produceGoal(blocks, Object.assign({}, cfg));
  } catch (e) {
    r = { level: null, valid: false, error: String(e && e.message || e) };
  }
  const wallMs = Date.now() - t0;
  const raw = r && r.level || null;
  const level = raw ? A.parseLevel(raw) : null;
  const q = raw ? A.Quality.fromGeneration(r) : null;
  const cap = raw ? A.Quality.capacityEvidence(level, cfg) : null;
  const replay = raw && r.solveResult
    ? A.SolverAnalysis.replay(level, r.solveResult, OPTIONS)
    : null;
  const experience = raw && r.solveResult
    ? A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, OPTIONS, {
      solveResult: r.solveResult,
      decision: true
    }))
    : null;
  const player = raw
    ? A.PlayerSim.run(level, {
      seed: 7,
      useItems: false,
      reviveCap: 0,
      capturePreviewStats: true,
      instantChain: true,
      bottomOnly: false
    })
    : null;
  const plan = r && r.config && r.config._instantPlayoutStat || null;
  const rec = {
    id: policy + '_r' + repeat,
    policy,
    repeat,
    valid: !!(r && r.valid && raw),
    error: r && r.error || null,
    wallMs,
    levelHash: raw ? hash(raw) : null,
    board: raw ? raw.board.rows + 'x' + raw.board.cols : null,
    routeSteps: replay && replay.steps || null,
    routeCompleted: replay && replay.completed || false,
    routeReason: replay && replay.reason || null,
    routeMaxBuffer: replay && replay.maxBuffer || null,
    structure: q ? {
      pass: !!q.gatePass,
      reasons: q.gateReasons || [],
      qPass: !!q.pass,
      qReasons: q.reasons || [],
      label: q.label
    } : null,
    capacity: cap ? {
      conserved: cap.conserved,
      perColorConserved: cap.perColorConserved,
      boardFloorPass: cap.boardFloorPass,
      aboveMax: cap.aboveMax,
      belowMin: cap.belowMin,
      minCap: cap.minCap,
      maxCap: cap.maxCap,
      colorMismatches: cap.colorMismatches
    } : null,
    experience: experience ? {
      pass: !!experience.pass,
      curvePass: !!experience.curvePass,
      status: experience.status,
      reasons: experience.reasons || [],
      metrics: experience.metrics,
      releaseStatus: experience.releaseDecision && experience.releaseDecision.status || null,
      releaseEvidence: experience.releaseDecision && experience.releaseDecision.evidence || null
    } : null,
    player: player ? playerSummary(player) : null,
    plan: summarizePlan(plan),
    goalRounds: r && r.goalRounds || null,
    goalStopReason: r && r.goalStopReason || null,
    goalPass: !!(raw && A.Generator.goalResultExperiencePass(r, cfg))
  };
  if (raw) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    const stem = policy + '_r' + repeat;
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(raw, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'),
      JSON.stringify(r.solveResult && r.solveResult.pickOrder || [], null, 2) + '\n');
  }
  console.log('[policy]', rec.id,
    'valid=' + rec.valid,
    'route=' + rec.routeCompleted,
    'struct=' + !!(rec.structure && rec.structure.pass),
    'goal=' + rec.goalPass,
    'mid=' + (rec.experience && rec.experience.metrics && rec.experience.metrics.midBuffer34Pct),
    'sig=' + (rec.experience && rec.experience.metrics && rec.experience.metrics.significantReleaseCount),
    'player=' + (rec.player && rec.player.won),
    'ms=' + wallMs);
  return rec;
}

function best(rows) {
  return rows.slice().sort((a, b) =>
    (Number(b.goalPass) - Number(a.goalPass)) ||
    (Number(!!(b.structure && b.structure.pass)) - Number(!!(a.structure && a.structure.pass))) ||
    (Number(!!(b.routeCompleted)) - Number(!!(a.routeCompleted))) ||
    ((b.experience && b.experience.metrics && b.experience.metrics.midBuffer34Pct) || -1) -
      ((a.experience && a.experience.metrics && a.experience.metrics.midBuffer34Pct) || -1)
  )[0] || null;
}

function armSummary(rows) {
  return {
    runs: rows.length,
    valid: rows.filter(x => x.valid).length,
    routeCompleted: rows.filter(x => x.routeCompleted).length,
    structure: rows.filter(x => x.structure && x.structure.pass).length,
    goal: rows.filter(x => x.goalPass).length,
    qPass: rows.filter(x => x.structure && x.structure.qPass).length,
    playerWon: rows.filter(x => x.player && x.player.won).length,
    capacity: rows.filter(x => x.capacity && x.capacity.conserved &&
      x.capacity.perColorConserved === true && x.capacity.boardFloorPass &&
      x.capacity.aboveMax === 0).length,
    midValues: rows.map(x => x.experience && x.experience.metrics && x.experience.metrics.midBuffer34Pct),
    significantReleaseValues: rows.map(x =>
      x.experience && x.experience.metrics && x.experience.metrics.significantReleaseCount),
    hashes: rows.map(x => x.levelHash),
    wallMs: rows.map(x => x.wallMs),
    best: best(rows)
  };
}

let A = null;

function main() {
  A = load();
  fs.mkdirSync(LEVEL_DIR, { recursive: true });
  const rows = [];
  for (const policy of POLICIES) {
    for (let repeat = 1; repeat <= REPEATS; repeat++) rows.push(runOne(policy, repeat));
  }
  const byArm = Object.fromEntries(POLICIES.map(p => [p, armSummary(rows.filter(x => x.policy === p))]));
  const targetBest = byArm.targetBuffer.best;
  const baselineBest = byArm.shortDebt.best;
  const targetMid = targetBest && targetBest.experience && targetBest.experience.metrics
    ? targetBest.experience.metrics.midBuffer34Pct : null;
  const baseMid = baselineBest && baselineBest.experience && baselineBest.experience.metrics
    ? baselineBest.experience.metrics.midBuffer34Pct : null;
  const checks = {
    bothArmsRan: rows.length === POLICIES.length * REPEATS,
    targetPolicyEffective: !!(targetBest && targetBest.plan && targetBest.plan.policy === 'targetBuffer'),
    targetHashDiffers: !!(targetBest && targetBest.levelHash && baselineBest &&
      targetBest.levelHash !== baselineBest.levelHash),
    targetRouteCompleted: !!(targetBest && targetBest.routeCompleted),
    targetStructure: !!(targetBest && targetBest.structure && targetBest.structure.pass),
    targetCapacity: !!(targetBest && targetBest.capacity && targetBest.capacity.conserved &&
      targetBest.capacity.perColorConserved === true && targetBest.capacity.boardFloorPass &&
      targetBest.capacity.aboveMax === 0),
    targetMidAtLeast50: targetMid != null && targetMid >= 50,
    targetMidImproved10pp: targetMid != null && baseMid != null && targetMid >= baseMid + 10,
    targetSignificantRelease: !!(targetBest && targetBest.experience &&
      targetBest.experience.metrics && targetBest.experience.metrics.significantReleaseCount >= 1),
    targetReleaseReplay: !!(targetBest && targetBest.experience &&
      targetBest.experience.releaseStatus === 'found' &&
      targetBest.experience.releaseEvidence &&
      targetBest.experience.releaseEvidence.finalReplayValid),
    targetPlayerWon: !!(targetBest && targetBest.player && targetBest.player.won)
  };
  checks.pass = Object.values(checks).every(Boolean);
  const report = {
    schema: '006-plan-policy-ab-v570',
    date: '2026-10-26',
    preregistration: '006策略对照_v570.预登记.md',
    fixed: {
      image: '006',
      seed: 1001,
      recipe: 'A_base',
      repeats: REPEATS,
      goalPerRoundMs: 20000,
      goalMaxMs: 40000,
      goalMaxRounds: 2,
      instantPlanTargetBuffer: 4,
      instantPlanMaxDebt: 40,
      instantPlanDebtEvery: 4,
      instantPlanBranchPrefixDebts: 8
    },
    byArm,
    checks,
    decision: checks.pass
      ? 'targetBuffer在真实生成与原计划路线回放上通过；单seed仅算机制信号，下一步做006四seed开发集复核。'
      : 'targetBuffer未达到全部预登记门槛；本轮不采纳，不连续扫更多policy，先记录失败分类并重新归因供给时间线。',
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    byArm: Object.fromEntries(POLICIES.map(p => [p, {
      valid: byArm[p].valid,
      routeCompleted: byArm[p].routeCompleted,
      structure: byArm[p].structure,
      goal: byArm[p].goal,
      qPass: byArm[p].qPass,
      playerWon: byArm[p].playerWon,
      capacity: byArm[p].capacity,
      midValues: byArm[p].midValues,
      significantReleaseValues: byArm[p].significantReleaseValues,
      hashes: byArm[p].hashes,
      wallMs: byArm[p].wallMs
    }])),
    targetBest: targetBest && {
      id: targetBest.id,
      hash: targetBest.levelHash,
      routeCompleted: targetBest.routeCompleted,
      goalPass: targetBest.goalPass,
      structure: targetBest.structure,
      metrics: targetBest.experience && targetBest.experience.metrics,
      releaseStatus: targetBest.experience && targetBest.experience.releaseStatus,
      player: targetBest.player,
      plan: targetBest.plan,
      goalStopReason: targetBest.goalStopReason
    },
    checks,
    decision: report.decision,
    out: path.relative(ROOT, OUT)
  }, null, 2));
}

main();
