#!/usr/bin/env node
/** v570 P2f：用内存源码补丁验证 midBandDebt3，不修改生产文件。 */
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
const OUT = path.join(__dirname, '006中段三债实验_v570.json');
const LEVEL_DIR = path.join(__dirname, '006中段三债实验_v570.levels');
const POLICY = 'midBandDebt3';
const REPEATS = 2;
const OPTIONS = { instantChain: true, bottomOnly: false };
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const NEEDLE = "      if (bestColor == null || bestReach <= 0) { deadlock = true; deadlockReason = 'no_reachable_color'; break; }";
const INJECTION = [
  "      if (policy === 'midBandDebt3') {",
  "        var mbProg = total ? done / total : 0;",
  "        var mbLo = opts.midLo != null ? +opts.midLo : (config && config.instantPlanMidDebtLo != null ? +config.instantPlanMidDebtLo : 0.20);",
  "        var mbHi = opts.midHi != null ? +opts.midHi : (config && config.instantPlanMidDebtHi != null ? +config.instantPlanMidDebtHi : 0.85);",
  "        var mbTarget = Math.max(1, parseInt(opts.midTarget || config && config.instantPlanMidDebtTarget, 10) || 3);",
  "        var mbPositive = candidates.filter(function (x) { return x.debt > 0 && x.reach > 0; }).sort(function (a, b) {",
  "          return a.debt - b.debt || b.reach - a.reach || a.color - b.color;",
  "        });",
  "        var mbSupply = candidates.filter(function (x) { return x.debt <= 0 && x.reach > 0; }).sort(function (a, b) {",
  "          return b.reach - a.reach || a.debt - b.debt || a.color - b.color;",
  "        });",
  "        var mbReason = 'outside_mid';",
  "        if (mbProg >= mbLo && mbProg < mbHi && active.length >= mbTarget) mbReason = 'active_target_met';",
  "        if (mbProg >= mbLo && mbProg < mbHi && active.length < mbTarget && mbPositive.length) {",
  "          bestColor = mbPositive[0].color; bestReach = mbPositive[0].reach; mbReason = 'debt_target';",
  "        } else if (mbProg >= mbLo && mbProg < mbHi && active.length < mbTarget) {",
  "          mbReason = 'target_unmet_no_positive_candidate';",
  "        }",
  "        if (mbReason !== 'debt_target') {",
  "          if (mbSupply.length) {",
  "            bestColor = mbSupply[0].color; bestReach = mbSupply[0].reach; mbReason += ';supply_priority';",
  "          } else if (mbPositive.length) {",
  "            bestColor = mbPositive[0].color; bestReach = mbPositive[0].reach; mbReason += ';positive_fallback';",
  "          }",
  "        }",
  "        if (config) {",
  "          if (!config._midBandTrace) config._midBandTrace = [];",
  "          var mbChosen = null;",
  "          for (var mbCi = 0; mbCi < candidates.length; mbCi++) if (candidates[mbCi].color === bestColor) { mbChosen = candidates[mbCi]; break; }",
  "          config._midBandTrace.push({ done: done, total: total, progress: +mbProg.toFixed(4), active: active.length, target: mbTarget,",
  "            positive: mbPositive.map(function (x) { return { color: x.color, reach: x.reach, cap: x.cap, debt: x.debt }; }),",
  "            supply: mbSupply.map(function (x) { return { color: x.color, reach: x.reach, cap: x.cap, debt: x.debt }; }),",
  "            chosen: mbChosen ? { color: mbChosen.color, reach: mbChosen.reach, cap: mbChosen.cap, debt: mbChosen.debt } : null,",
  "            reason: mbReason });",
  "        }",
  "      }",
  NEEDLE
].join('\n');

function load() {
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  let patch = null;
  for (const f of FILES) {
    let source = fs.readFileSync(path.join(BIN, f), 'utf8');
    if (f === 'instant-playout.js') {
      const first = source.indexOf(NEEDLE);
      const last = source.lastIndexOf(NEEDLE);
      if (first < 0 || first !== last) throw new Error('midBandDebt3 injection point not unique');
      const originalHash = crypto.createHash('sha256').update(source).digest('hex');
      source = source.slice(0, first) + INJECTION + source.slice(first + NEEDLE.length);
      patch = {
        applied: source.indexOf("policy === 'midBandDebt3'") >= 0,
        file: f,
        originalHash,
        patchedHash: crypto.createHash('sha256').update(source).digest('hex')
      };
    }
    vm.runInContext(source, sb, { filename: f });
  }
  return { A: sb.AntSolver, patch };
}

function hash(x) {
  return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
}

function configFor(blocks) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  return {
    seed: 1001,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantPlanPolicy: POLICY,
    instantPlanMidDebtLo: 0.20,
    instantPlanMidDebtHi: 0.85,
    instantPlanMidDebtTarget: 3,
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

function replayStats(A, raw, route) {
  const level = A.parseLevel(raw);
  const rr = A.SolverAnalysis.replay(level, { pickOrder: route }, OPTIONS);
  const pre = (rr.trace || []).filter(x => x.eliminated / rr.totalPixels < 0.2);
  const mid = (rr.trace || []).filter(x => {
    const p = x.eliminated / rr.totalPixels;
    return p >= 0.2 && p <= 0.85;
  });
  const dist = {};
  let lowRun = 0, maxLowRun = 0;
  for (const x of mid) {
    dist[x.buffer] = (dist[x.buffer] || 0) + 1;
    if (x.buffer < 3) maxLowRun = Math.max(maxLowRun, ++lowRun);
    else lowRun = 0;
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

function runOne(patch, repeat) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(IMAGE_PATH, 'utf8'));
  const cfg = configFor(blocks);
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
  const decisionTrace = r && r.config && r.config._midBandTrace || [];
  const rec = {
    id: POLICY + '_r' + repeat,
    repeat,
    patch,
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
    fullPlan: r && r.config && r.config._instantPlayoutStat || null,
    instantPlanCells: raw && raw.board && raw.board.instantPlanCells || null,
    baselineSolution: r && r.baselineSolution || null,
    solveResult: r && r.solveResult || null,
    decisionTrace,
    goalRounds: r && r.goalRounds || null,
    goalStopReason: r && r.goalStopReason || null,
    goalPass: !!(raw && A.Generator.goalResultExperiencePass(r, cfg))
  };
  if (raw) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    const stem = POLICY + '_r' + repeat;
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(raw, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'), JSON.stringify(route, null, 2) + '\n');
  }
  console.log('[mid3]', rec.id,
    'patch=' + patch.applied,
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

function summarizeDecisionTrace(rows) {
  const trace = rows[0] && rows[0].decisionTrace || [];
  const mid = trace.filter(x => x.progress >= 0.2 && x.progress < 0.85);
  const deficit = mid.filter(x => x.active < x.target);
  const reasons = {};
  for (const x of mid) reasons[x.reason] = (reasons[x.reason] || 0) + 1;
  return {
    totalChoices: trace.length,
    midChoices: mid.length,
    deficitChoices: deficit.length,
    deficitWithPositive: deficit.filter(x => x.positive.length > 0).length,
    deficitWithoutPositive: deficit.filter(x => !x.positive.length).length,
    deficitSelectedDebt: deficit.filter(x => x.reason.indexOf('debt_target') >= 0).length,
    reasonCounts: reasons,
    sampleDeficits: deficit.map(x => ({
      progress: x.progress,
      active: x.active,
      positiveCount: x.positive.length,
      positiveMinDebt: x.positive.length ? Math.min(...x.positive.map(y => y.debt)) : null,
      positiveMaxDebt: x.positive.length ? Math.max(...x.positive.map(y => y.debt)) : null,
      supplyCount: x.supply.length,
      chosen: x.chosen,
      reason: x.reason
    }))
  };
}

function main() {
  const loaded = load();
  A = loaded.A;
  fs.mkdirSync(LEVEL_DIR, { recursive: true });
  const baseline = previousBaseline();
  const rows = [];
  for (let i = 1; i <= REPEATS; i++) rows.push(runOne(loaded.patch, i));
  const metrics = rows.map(x => x.experience && x.experience.metrics);
  const checks = {
    patchApplied: !!loaded.patch && loaded.patch.applied,
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
    earlyPressureSafe: rows.every(x => x.route && x.route.preMidMaxBuffer <= 3),
    latePressureSafe: rows.every(x => x.experience && x.experience.metrics &&
      x.experience.metrics.lateHighPressurePct <= 3),
    noLongLowRun: rows.every(x => x.route && x.route.maxLowRun <= 3),
    policyEffective: rows.every(x => x.plan && x.plan.policy === POLICY)
  };
  checks.pass = Object.values(checks).every(Boolean);
  const hashesStable = rows.length > 1 && rows.every(x => x.levelHash === rows[0].levelHash);
  const report = {
    schema: '006-mid-band-debt-3-experiment-v570',
    date: '2026-10-26',
    preregistration: '006中段三债实验_v570.预登记.md',
    experiment: {
      policy: POLICY,
      sourcePatch: loaded.patch,
      memoryOnly: true,
      productionFilesModified: false,
      repeats: REPEATS
    },
    baseline: { shortDebt: baseline },
    rows,
    decisionTraceSummary: summarizeDecisionTrace(rows),
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
      ? 'midBandDebt3内存实验两次通过；下一步把相同逻辑落到生产InstantPlayout并按v571流程验证。'
      : 'midBandDebt3未通过全部预登记门槛；不接生产，下一轮只改一个策略细节。'
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    baseline: {
      metrics: baseline.metrics,
      player: baseline.player,
      replay: baseline.replay
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
    decisionTraceSummary: report.decisionTraceSummary,
    checks,
    decision: report.decision,
    out: path.relative(ROOT, OUT)
  }, null, 2));
}

main();
