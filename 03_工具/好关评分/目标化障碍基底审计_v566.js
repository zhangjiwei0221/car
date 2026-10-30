#!/usr/bin/env node
/** v566 M6b：复现006/1001与010/1002，审计计划路线和单障碍候选决策窗口。只读生产逻辑。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const OUT = path.join(__dirname, '目标化障碍基底审计_v566.json');
const LEVEL_DIR = path.join(__dirname, '目标化障碍基底审计_v566.levels');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const CASES = [
  {
    image: '006',
    seed: 1001,
    imagePath: '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
    expectedHash: 'a364e7f2b5c515c70a28d5ee196175bd51bda2132439bf220ee9fd2963bc5083'
  },
  {
    image: '010',
    seed: 1002,
    imagePath: '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt',
    expectedHash: '12c62fab4c850d0063d2b9d7c81499e623eef848efb454b8a4a750f8a3c907b1'
  }
];

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

function cfgFor(blocks, seed) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  const frontier = band.frontier && band.frontier.avg;
  return {
    seed,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    boxSizeMin: b[0],
    boxSizeMax: b[1],
    capNormMin: b[0],
    capNormMax: b[1],
    cutMode: (frontier != null && frontier >= 2 && frontier <= 4.5) ? 'exposeCut' : 'layerCut2',
    candidateCount: 3,
    boardRowsMin: 6,
    boardRowsMax: 9,
    boardColsMin: 6,
    boardColsMax: 9,
    boardHardRange: false,
    boardAuto: false,
    boardAllowSquare: true,
    boardExpandOnOverflow: false,
    boardFirst: true,
    boardFitGuard: 'warn',
    boardPrefer7: true,
    boardPrefer7Dims: null,
    p7BaseCount: 0,
    p7Repair: false,
    trapPost: false,
    pool: 1,
    instantPlanPolicy: 'targetBuffer',
    instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40,
    instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 8,
    minPipes: 0,
    blackPercent: 10,
    narrowPath: true,
    experienceGoal: true,
    instantReleaseRoute: false,
    goalPerRoundMs: 10000,
    goalMaxMs: 15000,
    goalMaxRounds: 2,
    goalSharedBudget: true,
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

function generateUntilHash(c) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, c.imagePath), 'utf8'));
  const cfg = cfgFor(blocks, c.seed);
  const attempts = [];
  let matched = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const t0 = Date.now();
    let r = null;
    try {
      r = A.Generator.produceGoal(blocks, Object.assign({}, cfg));
    } catch (e) {
      attempts.push({ attempt, error: String((e && e.message) || e), wallMs: Date.now() - t0 });
      continue;
    }
    const level = r && r.level || null;
    const actualHash = level ? hash(level) : null;
    const q = level ? A.Quality.fromGeneration(r) : null;
    const cap = level ? A.Quality.capacityEvidence(level, r.config || cfg) : null;
    attempts.push({
      attempt,
      valid: !!(r && r.valid),
      hash: actualHash,
      hashMatch: actualHash === c.expectedHash,
      board: level ? level.board.rows + 'x' + level.board.cols : null,
      structurePass: !!(q && q.gatePass),
      gateReasons: q && q.gateReasons || [],
      goalPass: !!(level && A.Generator.goalResultExperiencePass(r, cfg)),
      aboveMax: cap && cap.aboveMax,
      perColorConserved: cap && cap.perColorConserved,
      stopReason: r && r.goalStopReason || null,
      wallMs: Date.now() - t0
    });
    console.log('[generate]', c.image + '/' + c.seed, 'attempt=' + attempt,
      level ? level.board.rows + 'x' + level.board.cols : 'FAIL',
      'hashMatch=' + (actualHash === c.expectedHash), 'struct=' + !!(q && q.gatePass),
      'goal=' + !!(level && A.Generator.goalResultExperiencePass(r, cfg)), 'ms=' + (Date.now() - t0));
    if (level && actualHash === c.expectedHash) {
      matched = { r, blocks, cfg, attempt };
      break;
    }
  }
  return { blocks, cfg, attempts, matched };
}

function stateAt(A, level, actions, count) {
  const s = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  for (let i = 0; i < count; i++) {
    const a = actions[i];
    if (!a || !A.Simulator.isPickable(s, a.r, a.c)) return null;
    A.Simulator.applyPick(s, a.r, a.c);
    if (s.eliminatedPixels >= s.totalPixels) {
      s.gameWon = true;
      s.gameOver = true;
    }
  }
  return s;
}

function cellInfo(level, r, c) {
  const cell = level.board && level.board.cells &&
    level.board.cells[r] && level.board.cells[r][c];
  if (!cell) return null;
  return {
    t: cell.t,
    color: cell.color,
    count: cell.count,
    q: !!cell.q,
    numice: cell.numice || 0,
    chain: cell.chain || 0,
    chainId: cell.chainId == null ? null : cell.chainId,
    dir: cell.dir == null ? null : cell.dir
  };
}

function tracePlannedRoute(A, level, route) {
  const Sim = A.Simulator;
  const actions = A.SolverAnalysis.normalizeActions(route);
  const state = Sim.createState(level, { useSlotStart: true, instantChain: true });
  const rows = [];
  for (let i = 0; i < actions.length; i++) {
    if (state.gameWon || state.gameOver) break;
    const a = actions[i];
    const pickable = Sim.isPickable(state, a.r, a.c);
    const beforeBuffer = state.buffer.length;
    const beforeProgress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    const beforeEliminated = state.eliminatedPixels;
    const legalMoves = pickable ? Sim.listMoves(state).filter(m => !m.blocked).length : 0;
    rows.push({
      actionIndex: i,
      step: i + 1,
      r: a.r,
      c: a.c,
      routeColor: a.color == null ? null : a.color,
      routeCount: a.count == null ? null : a.count,
      cell: cellInfo(level, a.r, a.c),
      pickable,
      legalMoves,
      beforeBuffer,
      beforeProgress: +beforeProgress.toFixed(4),
      inMid: beforeProgress >= 0.2 && beforeProgress <= 0.85
    });
    if (!pickable) break;
    Sim.applyPick(state, a.r, a.c);
    if (state.eliminatedPixels >= state.totalPixels) {
      state.gameWon = true;
      state.gameOver = true;
    }
    rows[rows.length - 1].afterBuffer = state.buffer.length;
    rows[rows.length - 1].afterProgress =
      +(state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0).toFixed(4);
    rows[rows.length - 1].immediateEliminated =
      state.eliminatedPixels - beforeEliminated;
    rows[rows.length - 1].beforeEliminated = beforeEliminated;
  }
  return {
    completed: !!state.gameWon,
    overflow: !!state.overflow,
    gameOver: !!state.gameOver,
    steps: rows.length,
    maxBeforeBuffer: rows.reduce((m, x) => Math.max(m, x.beforeBuffer), 0),
    rows
  };
}

function releaseEvidenceFromAfter(A, after, futureActions, beforeBuffer) {
  const replayed = A.SolverAnalysis.replayFromState(after, futureActions || []);
  if (!replayed.completed) {
    return { completed: false, reason: replayed.reason || null };
  }
  const buffers = [after.buffer.length].concat(
    (replayed.trace || []).slice(0, 4).map(x => x.buffer)
  );
  const minBuffer = Math.min.apply(null, buffers);
  return {
    completed: true,
    beforeBuffer,
    minBufferWithinWindow: minBuffer,
    releaseAmplitude: beforeBuffer - minBuffer,
    routeActions: (futureActions || []).length
  };
}

function auditDecisionStates(A, level, route, experience) {
  const Sim = A.Simulator;
  const actions = A.SolverAnalysis.normalizeActions(route);
  const selected = experience && experience.releaseDecision &&
    experience.releaseDecision.sampling && experience.releaseDecision.sampling.selected || [];
  const out = [];
  for (const s0 of selected) {
    const state = stateAt(A, level, actions, s0.actionIndex);
    if (!state) {
      out.push({ actionIndex: s0.actionIndex, error: 'prefix_replay_failed' });
      continue;
    }
    const ref = actions[s0.actionIndex];
    const moves = Sim.listMoves(state).filter(m => !m.blocked);
    moves.sort((x, y) => {
      const xr = x.r === ref.r && x.c === ref.c ? 0 : 1;
      const yr = y.r === ref.r && y.c === ref.c ? 0 : 1;
      return xr - yr;
    });
    const alternatives = [];
    for (const m of moves.slice(0, 3)) {
      const before = state.buffer.length;
      const after = A.SolverStrategy.cloneState(state);
      Sim.applyPick(after, m.r, m.c);
      if (after.eliminatedPixels >= after.totalPixels) {
        after.gameWon = true;
        after.gameOver = true;
      }
      const isReference = m.r === ref.r && m.c === ref.c;
      const direct = isReference
        ? releaseEvidenceFromAfter(A, after, actions.slice(s0.actionIndex + 1), before)
        : null;
      const searched = A.SolverAnalysis.searchFromState(after, {
        timeBudgetMs: 350,
        maxNodes: 1200,
        beamWidth: 16,
        branchWidth: 8,
        maxRoutes: 1
      });
      const searchedEvidence = searched.routes.length
        ? releaseEvidenceFromAfter(A, after, searched.routes[0].actions, before)
        : null;
      let classification = 'no_route_not_exhausted';
      if (direct && direct.completed && direct.releaseAmplitude >= 2) {
        classification = 'reference_significant_release';
      } else if (direct && direct.completed && direct.releaseAmplitude < 2) {
        classification = 'reference_below_threshold';
      } else if (searchedEvidence && searchedEvidence.completed &&
          searchedEvidence.releaseAmplitude >= 2) {
        classification = 'search_significant_release';
      } else if (searchedEvidence && searchedEvidence.completed &&
          searchedEvidence.releaseAmplitude < 2) {
        classification = 'search_below_threshold';
      } else if (!searched.routes.length && searched.budgetExhausted) {
        classification = 'budget_unknown';
      } else if (searched.routes.length && (!searchedEvidence || !searchedEvidence.completed)) {
        classification = 'search_route_replay_failed';
      }
      alternatives.push({
        isReference,
        action: {
          r: m.r,
          c: m.c,
          color: m.antBox ? m.antBox.color : null,
          count: m.antBox ? m.antBox.count : null
        },
        beforeBuffer: before,
        afterBuffer: after.buffer.length,
        immediateEliminated: after.eliminatedPixels - state.eliminatedPixels,
        direct,
        searched: {
          routeCount: searched.routes.length,
          status: searched.status,
          nodes: searched.nodes,
          budgetExhausted: !!searched.budgetExhausted,
          elapsedMs: searched.elapsedMs,
          evidence: searchedEvidence
        },
        classification
      });
    }
    out.push({
      actionIndex: s0.actionIndex,
      step: s0.step,
      progress: s0.progress,
      beforeBuffer: state.buffer.length,
      legalMoves: moves.length,
      referenceAction: {
        r: ref.r,
        c: ref.c,
        color: ref.color == null ? null : ref.color,
        count: ref.count == null ? null : ref.count,
        cell: cellInfo(level, ref.r, ref.c)
      },
      alternatives
    });
  }
  return out;
}

function midWindows(traceRows) {
  const rows = traceRows.filter(x =>
    x.pickable && x.inMid && (x.beforeBuffer === 3 || x.beforeBuffer === 4));
  const runs = [];
  let cur = null;
  for (const x of rows) {
    if (!cur || x.actionIndex !== cur.endActionIndex + 1) {
      cur = {
        startActionIndex: x.actionIndex,
        endActionIndex: x.actionIndex,
        startStep: x.step,
        endStep: x.step,
        maxBuffer: x.beforeBuffer,
        actions: []
      };
      runs.push(cur);
    }
    cur.endActionIndex = x.actionIndex;
    cur.endStep = x.step;
    cur.maxBuffer = Math.max(cur.maxBuffer, x.beforeBuffer);
    cur.actions.push({
      actionIndex: x.actionIndex,
      step: x.step,
      progress: x.beforeProgress,
      buffer: x.beforeBuffer,
      r: x.r,
      c: x.c,
      color: x.cell && x.cell.color,
      count: x.cell && x.cell.count
    });
  }
  return runs.sort((a, b) => b.actions.length - a.actions.length);
}

function auditCase(A, c) {
  const gen = generateUntilHash(c);
  if (!gen.matched) {
    return {
      image: c.image,
      seed: c.seed,
      expectedHash: c.expectedHash,
      hashMatch: false,
      generationAttempts: gen.attempts,
      m6bStatus: 'rejected_hash_mismatch'
    };
  }
  const r = gen.matched.r;
  const level = r.level;
  const parsed = A.parseLevel(level);
  const q = A.Quality.fromGeneration(r);
  const cap = A.Quality.capacityEvidence(level, r.config || gen.cfg);
  const replay = A.SolverAnalysis.replay(level, r.solveResult, {
    instantChain: true,
    bottomOnly: false
  });
  const expOpts = Object.assign({}, gen.cfg, {
    solveResult: r.solveResult,
    decision: true,
    instantChain: true
  });
  const full = A.ExperienceGoal.evaluate(level, expOpts);
  const trace = tracePlannedRoute(A, parsed, r.solveResult);
  const decisions = auditDecisionStates(A, parsed, r.solveResult, full);
  const windows = midWindows(trace.rows);
  const release = full.releaseDecision || null;
  const releaseEvidence = release && release.evidence || null;
  const executableWindows = decisions.filter(s =>
    s.alternatives && s.alternatives.some(x =>
      x.classification === 'reference_significant_release' ||
      x.classification === 'search_significant_release'));
  const hardContract = !!(cap && cap.conserved && cap.perColorConserved === true &&
    cap.boardFloorPass && cap.aboveMax === 0);
  const m6bPass = !!(
    gen.attempts[gen.attempts.length - 1].hashMatch &&
    r.valid &&
    q && q.gatePass &&
    hardContract &&
    replay.completed &&
    release &&
    release.status === 'found' &&
    releaseEvidence &&
    releaseEvidence.finalReplayValid === true &&
    releaseEvidence.releaseAmplitude >= 2 &&
    executableWindows.length > 0
  );
  const rec = {
    image: c.image,
    seed: c.seed,
    expectedHash: c.expectedHash,
    actualHash: hash(level),
    hashMatch: true,
    reproductionAttempt: gen.matched.attempt,
    generationAttempts: gen.attempts,
    board: level.board.rows + 'x' + level.board.cols,
    valid: !!r.valid,
    structure: {
      pass: !!(q && q.gatePass),
      reasons: q && q.gateReasons || [],
      fullMedian2: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.fullMedian2,
      freeRunMax: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.freeRunMax,
      freeLowPct: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.freeLowPct
    },
    capacity: {
      hardContract,
      conserved: cap && cap.conserved,
      perColorConserved: cap && cap.perColorConserved,
      boardFloorPass: cap && cap.boardFloorPass,
      minCap: cap && cap.minCap,
      maxCap: cap && cap.maxCap,
      belowMin: cap && cap.belowMin,
      aboveMax: cap && cap.aboveMax
    },
    plannedRoute: {
      completed: !!replay.completed,
      steps: replay.steps,
      maxBuffer: replay.maxBuffer,
      reason: replay.reason || null
    },
    experience: {
      pass: !!full.pass,
      reasons: full.reasons || [],
      metrics: full.metrics,
      pressure: full.pressure,
      releaseDecision: release,
      decisionStates: decisions,
      executableWindowCount: executableWindows.length
    },
    midWindows: windows.slice(0, 20),
    planTrace: trace.rows,
    m6bStatus: m6bPass ? 'eligible_for_single_obstacle_experiment' : 'rejected_no_executable_window',
    selection: {
      releaseStep: releaseEvidence && releaseEvidence.referenceStep,
      releaseSource: releaseEvidence && releaseEvidence.source,
      releaseAction: releaseEvidence && releaseEvidence.action,
      releaseAmplitude: releaseEvidence && releaseEvidence.releaseAmplitude,
      finalReplayValid: !!(releaseEvidence && releaseEvidence.finalReplayValid)
    }
  };
  fs.writeFileSync(path.join(LEVEL_DIR, c.image + '_' + c.seed + '.json'),
    JSON.stringify(level, null, 2) + '\n');
  fs.writeFileSync(path.join(LEVEL_DIR, c.image + '_' + c.seed + '.route.json'),
    JSON.stringify(r.solveResult.pickOrder || [], null, 2) + '\n');
  console.log('[audit]', c.image + '/' + c.seed,
    'mid=' + full.metrics.midBuffer34Pct,
    'max=' + full.metrics.maxBuffer,
    'release=' + (release && release.status),
    'amp=' + (releaseEvidence && releaseEvidence.releaseAmplitude),
    'execWindows=' + executableWindows.length,
    'status=' + rec.m6bStatus);
  return rec;
}

let A = null;
function main() {
  A = load();
  fs.mkdirSync(LEVEL_DIR, { recursive: true });
  const rows = CASES.map(c => auditCase(A, c));
  const eligible = rows.filter(x => x.m6bStatus === 'eligible_for_single_obstacle_experiment');
  const ranked = eligible.slice().sort((a, b) => {
    const ar = a.experience.releaseDecision && a.experience.releaseDecision.evidence || {};
    const br = b.experience.releaseDecision && b.experience.releaseDecision.evidence || {};
    const aScore = (a.experience.metrics.midBuffer34Pct || 0) - (a.experience.metrics.maxBuffer || 0) * 2 +
      (ar.releaseAmplitude || 0) * 10;
    const bScore = (b.experience.metrics.midBuffer34Pct || 0) - (b.experience.metrics.maxBuffer || 0) * 2 +
      (br.releaseAmplitude || 0) * 10;
    return bScore - aScore;
  });
  const report = {
    schema: 'targeted-obstacle-base-audit-v566',
    date: '2026-10-26',
    preregistration: '目标化障碍基底审计_预登记_v566.md',
    summary: {
      candidates: rows.length,
      hashMatches: rows.filter(x => x.hashMatch).length,
      eligible: eligible.length,
      rejected: rows.filter(x => x.m6bStatus.indexOf('rejected_') === 0).length,
      selectedImage: ranked[0] && ranked[0].image || null,
      selectedSeed: ranked[0] && ranked[0].seed || null,
      decision: eligible.length
        ? '存在可执行的中段显著释放窗口；只允许对排名第一的基底做单一最小障碍 A/B 与移除消融。'
        : '两个候选均无可执行的单障碍窗口；M6c 保持关闭，转回 P2/P3。'
    },
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
