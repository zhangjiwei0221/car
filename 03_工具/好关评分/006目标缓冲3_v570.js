#!/usr/bin/env node
/** v570 P2c：006/1001 targetBuffer 4→3 单参数实验，只读生成与验收。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const IMAGE_PATH = path.join(ROOT, '蚂蚁图库', '拼接图', '拼接图图库', '35x35拼接图纸_006.txt');
const PREVIOUS_REPORT_PATH = path.join(__dirname, '006策略对照_v570.json');
const PREVIOUS_LEVEL_DIR = path.join(__dirname, '006策略对照_v570.levels');
const OUT = path.join(__dirname, '006目标缓冲3_v570.json');
const LEVEL_DIR = path.join(__dirname, '006目标缓冲3_v570.levels');
const TARGET_BUFFER = 3;
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

function configFor(blocks, targetBuffer) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  return {
    seed: 1001,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantPlanPolicy: 'targetBuffer',
    instantPlanTargetBuffer: targetBuffer,
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

function replayStats(A, raw, route) {
  const level = A.parseLevel(raw);
  const rr = A.SolverAnalysis.replay(level, { pickOrder: route }, OPTIONS);
  const pre = (rr.trace || []).filter(x => x.eliminated / rr.totalPixels < 0.2);
  const mid = (rr.trace || []).filter(x => {
    const p = x.eliminated / rr.totalPixels;
    return p >= 0.2 && p <= 0.85;
  });
  const dist = {};
  for (const x of mid) dist[x.buffer] = (dist[x.buffer] || 0) + 1;
  return {
    completed: !!rr.completed,
    steps: rr.steps,
    reason: rr.reason || null,
    maxBuffer: rr.maxBuffer,
    preMidMaxBuffer: pre.length ? Math.max(...pre.map(x => x.buffer)) : null,
    midSteps: mid.length,
    midDistribution: dist,
    mid34: mid.filter(x => x.buffer === 3 || x.buffer === 4).length
  };
}

function loadPreviousArm(policy) {
  const report = JSON.parse(fs.readFileSync(PREVIOUS_REPORT_PATH, 'utf8'));
  const row = report.rows.find(x => x.policy === policy && x.repeat === 1) || null;
  if (!row) return null;
  const raw = JSON.parse(fs.readFileSync(path.join(PREVIOUS_LEVEL_DIR, policy + '_r1.json'), 'utf8'));
  const route = JSON.parse(fs.readFileSync(path.join(PREVIOUS_LEVEL_DIR, policy + '_r1.route.json'), 'utf8'));
  return {
    policy,
    targetBuffer: 4,
    hash: row.levelHash,
    valid: row.valid,
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
  const cfg = configFor(blocks, TARGET_BUFFER);
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
    id: 'targetBuffer3_r' + repeat,
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
      medianEntryReach: r.config._instantPlayoutStat.medianEntryReach,
      maxDebt: r.config._instantPlayoutStat.maxDebt
    } : null,
    goalRounds: r && r.goalRounds || null,
    goalStopReason: r && r.goalStopReason || null,
    goalPass: !!(raw && A.Generator.goalResultExperiencePass(r, cfg))
  };
  if (raw) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    const stem = 'targetBuffer3_r' + repeat;
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(raw, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'), JSON.stringify(route, null, 2) + '\n');
  }
  console.log('[target3]', rec.id,
    'valid=' + rec.valid,
    'route=' + (rec.route && rec.route.completed),
    'struct=' + !!(rec.structure && rec.structure.pass),
    'goal=' + rec.goalPass,
    'mid=' + (rec.experience && rec.experience.metrics && rec.experience.metrics.midBuffer34Pct),
    'player=' + (rec.player && rec.player.won),
    'preMidMax=' + (rec.route && rec.route.preMidMaxBuffer),
    'ms=' + wallMs);
  return rec;
}

function runChecks(rows) {
  return {
    bothRunsValid: rows.every(x => x.valid),
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
    noPreMidBuffer4: rows.every(x => x.route && x.route.preMidMaxBuffer != null &&
      x.route.preMidMaxBuffer < 4),
    allTargetPolicyEffective: rows.every(x => x.plan && x.plan.policy === 'targetBuffer')
  };
}

let A = null;

function main() {
  A = load();
  fs.mkdirSync(LEVEL_DIR, { recursive: true });
  const target4 = loadPreviousArm('targetBuffer');
  const shortDebt = loadPreviousArm('shortDebt');
  const rows = [];
  for (let i = 1; i <= REPEATS; i++) rows.push(runOne(i));
  const checks = runChecks(rows);
  checks.pass = Object.values(checks).every(Boolean);
  const hashesStable = rows.length > 1 && rows.every(x => x.levelHash === rows[0].levelHash);
  const summary = {
    runs: rows.length,
    valid: rows.filter(x => x.valid).length,
    routes: rows.filter(x => x.route && x.route.completed).length,
    structures: rows.filter(x => x.structure && x.structure.pass).length,
    capacities: rows.filter(x => x.capacity && x.capacity.conserved &&
      x.capacity.perColorConserved === true && x.capacity.boardFloorPass &&
      x.capacity.aboveMax === 0).length,
    goals: rows.filter(x => x.goalPass).length,
    players: rows.filter(x => x.player && x.player.won).length,
    midValues: rows.map(x => x.experience && x.experience.metrics && x.experience.metrics.midBuffer34Pct),
    releaseValues: rows.map(x => x.experience && x.experience.metrics &&
      x.experience.metrics.significantReleaseCount),
    preMidMaxBuffers: rows.map(x => x.route && x.route.preMidMaxBuffer),
    hashes: rows.map(x => x.levelHash),
    hashesStable
  };
  const report = {
    schema: '006-target-buffer-3-v570',
    date: '2026-10-26',
    preregistration: '006目标缓冲3_v570.预登记.md',
    fixed: { image: '006', seed: 1001, recipe: 'A_base', targetBuffer: TARGET_BUFFER, repeats: REPEATS },
    previous: { shortDebt, targetBuffer4: target4 },
    rows,
    summary,
    checks,
    decision: checks.pass
      ? 'targetBuffer3两次均通过路线、结构、容量、目标、释放与PlayerSim；可进入006四seed开发集复核。'
      : 'targetBuffer3未达到全部预登记门槛；停止targetBuffer族参数，不试2/5，下一轮重新归因供给时间线。'
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary, rows: rows.map(x => ({
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
      releaseStatus: x.experience.releaseStatus
    },
    player: x.player,
    plan: x.plan
  })), previous: {
    shortDebt: { metrics: shortDebt && shortDebt.metrics, player: shortDebt && shortDebt.player },
    targetBuffer4: { metrics: target4 && target4.metrics, player: target4 && target4.player,
      replay: target4 && target4.replay }
  }, checks, decision: report.decision, out: path.relative(ROOT, OUT) }, null, 2));
}

main();
