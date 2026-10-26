#!/usr/bin/env node
/** v570 P2e：固定shortDebt，只比较分支前缀债务8与6。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const IMAGE_PATH = path.join(ROOT, '蚂蚁图库', '拼接图', '拼接图图库', '35x35拼接图纸_006.txt');
const PREVIOUS_REPORT_PATH = path.join(__dirname, '006策略对照_v570.json');
const PREVIOUS_LEVEL_DIR = path.join(__dirname, '006策略对照_v570.levels');
const OUT = path.join(__dirname, '006分支前缀6_v570.json');
const LEVEL_DIR = path.join(__dirname, '006分支前缀6_v570.levels');
const PREFIX_DEBTS = 6;
const REPEATS = 2;
const OPTIONS = { instantChain: true, bottomOnly: false };
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

function hash(x) {
  return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
}

function configFor(blocks, prefixDebts) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  return {
    seed: 1001,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantPlanPolicy: 'shortDebt',
    instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40,
    instantPlanDebtEvery: 4,
    instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: prefixDebts,
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

function replayStats(A, raw, route) {
  const level = A.parseLevel(raw);
  const rr = A.SolverAnalysis.replay(level, { pickOrder: route }, OPTIONS);
  const pre = (rr.trace || []).filter(x => x.eliminated / rr.totalPixels < 0.2);
  const mid = (rr.trace || []).filter(x => {
    const p = x.eliminated / rr.totalPixels;
    return p >= 0.2 && p <= 0.85;
  });
  const dist = {};
  let curLow = 0, maxLowRun = 0;
  for (const x of mid) {
    dist[x.buffer] = (dist[x.buffer] || 0) + 1;
    if (x.buffer < 3) {
      curLow++;
      maxLowRun = Math.max(maxLowRun, curLow);
    } else {
      curLow = 0;
    }
  }
  return {
    completed: !!rr.completed,
    steps: rr.steps,
    reason: rr.reason || null,
    maxBuffer: rr.maxBuffer,
    preMidMaxBuffer: pre.length ? Math.max(...pre.map(x => x.buffer)) : null,
    midSteps: mid.length,
    midDistribution: dist,
    maxLowRun,
    mid34: mid.filter(x => x.buffer === 3 || x.buffer === 4).length
  };
}

function previousBaseline() {
  const report = JSON.parse(fs.readFileSync(PREVIOUS_REPORT_PATH, 'utf8'));
  const row = report.rows.find(x => x.policy === 'shortDebt' && x.repeat === 1);
  const raw = JSON.parse(fs.readFileSync(path.join(PREVIOUS_LEVEL_DIR, 'shortDebt_r1.json'), 'utf8'));
  const route = JSON.parse(fs.readFileSync(path.join(PREVIOUS_LEVEL_DIR, 'shortDebt_r1.route.json'), 'utf8'));
  return {
    targetBuffer: row.experience && row.experience.metrics && row.experience.metrics.maxBuffer,
    hash: row.levelHash,
    structure: row.structure,
    capacity: row.capacity,
    metrics: row.experience && row.experience.metrics,
    releaseStatus: row.experience && row.experience.releaseStatus,
    player: row.player,
    plan: row.plan,
    replay: replayStats(A, raw, route)
  };
}

function runOne(repeat) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(IMAGE_PATH, 'utf8'));
  const cfg = configFor(blocks, PREFIX_DEBTS);
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
  const route = r && r.solveResult && r.solveResult.pickOrder || [];
  const q = raw ? A.Quality.fromGeneration(r) : null;
  const cap = raw ? A.Quality.capacityEvidence(level, cfg) : null;
  const replay = raw ? replayStats(A, raw, route) : null;
  const experience = raw
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
  const rec = {
    id: 'prefix6_r' + repeat,
    repeat,
    valid: !!(r && r.valid && raw),
    error: r && r.error || null,
    wallMs,
    levelHash: raw ? hash(raw) : null,
    board: raw ? raw.board.rows + 'x' + raw.board.cols : null,
    route: replay,
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
    player: player ? {
      won: !!player.won,
      progress: player.progress,
      picks: player.picks,
      bufferPeak: player.bufferPeak,
      playerAvgBuffer: player.playerAvgBuffer,
      avgResidence: player.avgResidence,
      stalledAtEnd: player.stalledAtEnd,
      lastRefuse: player.lastRefuse || null
    } : null,
    plan: r && r.config && r.config._instantPlayoutStat ? {
      policy: r.config._instantPlayoutStat.policy,
      ok: r.config._instantPlayoutStat.ok,
      cars: r.config._instantPlayoutStat.cars,
      debtCars: r.config._instantPlayoutStat.debtCars,
      maxBuffer: r.config._instantPlayoutStat.maxBuffer,
      bufferEvents: r.config._instantPlayoutStat.bufferEvents,
      medianEntryReach: r.config._instantPlayoutStat.medianEntryReach
    } : null,
    goalRounds: r && r.goalRounds || null,
    goalStopReason: r && r.goalStopReason || null,
    goalPass: !!(raw && A.Generator.goalResultExperiencePass(r, cfg))
  };
  if (raw) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    const stem = 'prefix6_r' + repeat;
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(raw, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'), JSON.stringify(route, null, 2) + '\n');
  }
  console.log('[prefix6]', rec.id,
    'valid=' + rec.valid,
    'route=' + (rec.route && rec.route.completed),
    'struct=' + !!(rec.structure && rec.structure.pass),
    'goal=' + rec.goalPass,
    'mid=' + (rec.experience && rec.experience.metrics && rec.experience.metrics.midBuffer34Pct),
    'sig=' + (rec.experience && rec.experience.metrics && rec.experience.metrics.significantReleaseCount),
    'player=' + (rec.player && rec.player.won),
    'earlyMax=' + (rec.route && rec.route.preMidMaxBuffer),
    'ms=' + wallMs);
  return rec;
}

let A = null;

function main() {
  A = load();
  fs.mkdirSync(LEVEL_DIR, { recursive: true });
  const baseline = previousBaseline();
  const rows = [];
  for (let i = 1; i <= REPEATS; i++) rows.push(runOne(i));
  const metrics = rows.map(x => x.experience && x.experience.metrics);
  const checks = {
    bothValid: rows.every(x => x.valid),
    bothRoutesCompleted: rows.every(x => x.route && x.route.completed),
    bothStructuresPass: rows.every(x => x.structure && x.structure.pass),
    bothCapacitiesPass: rows.every(x => x.capacity && x.capacity.conserved &&
      x.capacity.perColorConserved === true && x.capacity.boardFloorPass &&
      x.capacity.aboveMax === 0),
    bothGoalsPass: rows.every(x => x.goalPass),
    bothMidAtLeast50: rows.every(x => x.experience && x.experience.metrics &&
      x.experience.metrics.midBuffer34Pct >= 50),
    bothSignificantRelease: rows.every(x => x.experience && x.experience.metrics &&
      x.experience.metrics.significantReleaseCount >= 1),
    bothReleaseReplay: rows.every(x => x.experience && x.experience.releaseStatus === 'found' &&
      x.experience.releaseEvidence && x.experience.releaseEvidence.finalReplayValid),
    bothPlayersWin: rows.every(x => x.player && x.player.won),
    earlyPressureNotWorse: rows.every(x => x.route && x.route.preMidMaxBuffer <= 3),
    noNewLatePressure: rows.every(x => x.experience && x.experience.metrics &&
      x.experience.metrics.lateHighPressurePct === 0),
    noLongLowRun: rows.every(x => x.route && x.route.maxLowRun <= 3),
    policyEffective: rows.every(x => x.plan && x.plan.policy === 'shortDebt')
  };
  checks.pass = Object.values(checks).every(Boolean);
  const hashesStable = rows.length > 1 && rows.every(x => x.levelHash === rows[0].levelHash);
  const report = {
    schema: '006-branch-prefix-6-v570',
    date: '2026-10-26',
    preregistration: '006分支前缀6_v570.预登记.md',
    fixed: {
      image: '006',
      seed: 1001,
      recipe: 'A_base',
      instantPlanPolicy: 'shortDebt',
      prefixDebts: PREFIX_DEBTS,
      repeats: REPEATS
    },
    baselinePrefix8: baseline,
    rows,
    summary: {
      runs: rows.length,
      valid: rows.filter(x => x.valid).length,
      routes: rows.filter(x => x.route && x.route.completed).length,
      structures: rows.filter(x => x.structure && x.structure.pass).length,
      capacities: rows.filter(x => x.capacity && x.capacity.conserved &&
        x.capacity.perColorConserved === true && x.capacity.aboveMax === 0).length,
      goals: rows.filter(x => x.goalPass).length,
      players: rows.filter(x => x.player && x.player.won).length,
      midValues: metrics.map(x => x && x.midBuffer34Pct),
      releaseValues: metrics.map(x => x && x.significantReleaseCount),
      earlyMaxValues: rows.map(x => x.route && x.route.preMidMaxBuffer),
      latePressureValues: metrics.map(x => x && x.lateHighPressurePct),
      maxLowRuns: rows.map(x => x.route && x.route.maxLowRun),
      hashes: rows.map(x => x.levelHash),
      hashesStable
    },
    checks,
    decision: checks.pass
      ? 'prefix6两次均通过供给、路线、结构、容量、目标、释放、PlayerSim和时序保护；可进入006四seed开发集复核。'
      : 'prefix6未达到全部预登记门槛；停止该参数，不再试4/10，转入新的供给时间线机制。'
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    baselinePrefix8: {
      hash: baseline.hash,
      metrics: baseline.metrics,
      player: baseline.player,
      replay: baseline.replay,
      plan: baseline.plan
    },
    rows: rows.map(x => ({
      id: x.id,
      hash: x.levelHash,
      board: x.board,
      route: x.route,
      structure: x.structure,
      capacity: x.capacity,
      experience: x.experience && {
        pass: x.experience.pass,
        reasons: x.experience.reasons,
        metrics: x.experience.metrics,
        releaseStatus: x.experience.releaseStatus,
        releaseEvidence: x.experience.releaseEvidence
      },
      player: x.player,
      plan: x.plan
    })),
    summary: report.summary,
    checks,
    decision: report.decision,
    out: path.relative(ROOT, OUT)
  }, null, 2));
}

main();
