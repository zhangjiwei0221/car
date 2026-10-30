#!/usr/bin/env node
/** v566 P2/P3只读归因：复现三关，比较每色容量、首行供给和中段车序。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const OUT = path.join(__dirname, 'P2P3归因_v566.json');
const LEVEL_DIR = path.join(__dirname, 'P2P3归因_v566.levels');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const CASES = [
  ['006', 1002, '1ed22c11f389dcf496d6710b2449488eb1316fc119b5e5c6e6aa2b1c60384530'],
  ['006', 88001, 'c7e87dda9b678f02aec28519e015274be79aeb1d6da17f2873ac8b295e607e7e'],
  ['010', 1002, '12c62fab4c850d0063d2b9d7c81499e623eef848efb454b8a4a750f8a3c907b1']
].map(x => ({ image: x[0], seed: x[1], expectedHash: x[2] }));
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

function generateMatched(c) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE_PATHS[c.image]), 'utf8'));
  const cfg = cfgFor(blocks, c.seed);
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    let r = null;
    try {
      r = A.Generator.produceGoal(blocks, Object.assign({}, cfg));
    } catch (e) {
      attempts.push({ attempt, error: String((e && e.message) || e), wallMs: Date.now() - t0 });
      continue;
    }
    const actualHash = r && r.level ? hash(r.level) : null;
    const q = r && r.level ? A.Quality.fromGeneration(r) : null;
    attempts.push({
      attempt,
      hash: actualHash,
      hashMatch: actualHash === c.expectedHash,
      board: r && r.level ? r.level.board.rows + 'x' + r.level.board.cols : null,
      structurePass: !!(q && q.gatePass),
      gateReasons: q && q.gateReasons || [],
      goalPass: !!(r && r.level && A.Generator.goalResultExperiencePass(r, cfg)),
      stopReason: r && r.goalStopReason || null,
      wallMs: Date.now() - t0
    });
    console.log('[generate]', c.image + '/' + c.seed, 'attempt=' + attempt,
      'hashMatch=' + (actualHash === c.expectedHash),
      'board=' + (r && r.level ? r.level.board.rows + 'x' + r.level.board.cols : '-'),
      'ms=' + (Date.now() - t0));
    if (r && r.level && actualHash === c.expectedHash) {
      return { r, parsed: A.parseLevel(r.level), cfg, blocks, attempts, attempt };
    }
  }
  return { attempts, parsed: null };
}

function colorTotals(blocks) {
  const out = {};
  for (const row of blocks) {
    for (const x of row) {
      if (!(x > 0)) continue;
      out[x] = (out[x] || 0) + 1;
    }
  }
  return out;
}

function boardBoxes(level) {
  const out = [];
  for (let r = 0; r < level.board.rows; r++) {
    for (let c = 0; c < level.board.cols; c++) {
      const cell = level.board.cells[r] && level.board.cells[r][c];
      if (cell && cell.t === 'box') {
        out.push({
          r,
          c,
          color: cell.color,
          count: cell.count,
          numice: cell.numice || 0,
          chain: cell.chain || 0,
          q: !!cell.q
        });
      }
    }
  }
  return out;
}

function groupByColor(boxes) {
  const out = {};
  for (const b of boxes) {
    (out[b.color] = out[b.color] || []).push(b);
  }
  for (const color in out) {
    out[color].sort((a, b) => b.count - a.count || a.r - b.r || a.c - b.c);
  }
  return out;
}

function capacityPlan(blocks, cfg, boxes) {
  const totals = colorTotals(blocks);
  const groups = groupByColor(boxes);
  const capMin = cfg.boxSizeMin;
  const capMax = cfg.boxSizeMax;
  const out = [];
  for (const color of Object.keys(totals).map(Number).sort((a, b) => a - b)) {
    const total = totals[color];
    const minCars = Math.ceil(total / capMax);
    const maxCars = Math.floor(total / capMin);
    const exactBand = minCars <= maxCars;
    const list = (groups[color] || []).map(x => x.count);
    const observedCars = list.length;
    out.push({
      color,
      pixels: total,
      legalCarRange: exactBand ? [minCars, maxCars] : null,
      exactBandFeasible: exactBand,
      observedCars,
      capacities: list,
      capacitySpread: list.length ? Math.max.apply(null, list) - Math.min.apply(null, list) : null,
      atCapMax: list.filter(x => x === capMax).length,
      atCapMin: list.filter(x => x === capMin).length,
      belowMin: list.filter(x => x < capMin).length,
      aboveMax: list.filter(x => x > capMax).length,
      sum: list.reduce((n, x) => n + x, 0),
      conserved: list.reduce((n, x) => n + x, 0) === total
    });
  }
  return {
    capMin,
    capMax,
    colors: out,
    infeasibleColors: out.filter(x => !x.exactBandFeasible).map(x => x.color),
    belowMinCars: out.reduce((n, x) => n + x.belowMin, 0),
    aboveMaxCars: out.reduce((n, x) => n + x.aboveMax, 0)
  };
}

function row0Audit(level) {
  const row = level.board.cells[0] || [];
  const boxes = [];
  for (let c = 0; c < row.length; c++) {
    const cell = row[c];
    if (cell && cell.t === 'box') boxes.push({ c, color: cell.color, count: cell.count });
  }
  const byColor = {};
  for (const b of boxes) (byColor[b.color] = (byColor[b.color] || 0) + 1);
  let longest = 0, run = 0, prev = null;
  for (const b of boxes) {
    if (b.color === prev) run++;
    else { run = 1; prev = b.color; }
    longest = Math.max(longest, run);
  }
  return {
    boxes,
    boxCount: boxes.length,
    colorCount: Object.keys(byColor).length,
    maxSameColorTotal: Object.keys(byColor).length ? Math.max.apply(null, Object.keys(byColor).map(x => byColor[x])) : 0,
    longestSameColorRun: longest,
    byColor
  };
}

function routeAudit(level, route) {
  const Sim = A.Simulator;
  const actions = A.SolverAnalysis.normalizeActions(route);
  const state = Sim.createState(level, { useSlotStart: true, instantChain: true });
  const rows = [];
  for (let i = 0; i < actions.length; i++) {
    if (state.gameWon || state.gameOver) break;
    const a = actions[i];
    if (!Sim.isPickable(state, a.r, a.c)) break;
    const moves = Sim.listMoves(state).filter(m => !m.blocked);
    const move = moves.find(m => m.r === a.r && m.c === a.c) || null;
    const cell = level.board.cells[a.r] && level.board.cells[a.r][a.c];
    const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    const beforeBuffer = state.buffer.length;
    const beforeEliminated = state.eliminatedPixels;
    Sim.applyPick(state, a.r, a.c);
    if (state.eliminatedPixels >= state.totalPixels) {
      state.gameWon = true;
      state.gameOver = true;
    }
    rows.push({
      actionIndex: i,
      step: i + 1,
      r: a.r,
      c: a.c,
      color: cell && cell.color,
      count: cell && cell.count,
      beforeProgress: +progress.toFixed(4),
      afterProgress: +(state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0).toFixed(4),
      beforeBuffer,
      afterBuffer: state.buffer.length,
      full: !!(move && move.full),
      canConsume: !!(move && move.canConsume),
      legalMoves: moves.length,
      immediateEliminated: state.eliminatedPixels - beforeEliminated
    });
  }
  return {
    completed: !!state.gameWon,
    steps: rows.length,
    rows
  };
}

function pressureWindows(trace) {
  const out = [];
  let current = null;
  for (const x of trace.rows) {
    const high = x.beforeProgress >= 0.2 && x.beforeProgress <= 0.85 && x.beforeBuffer >= 3;
    if (high) {
      if (!current) {
        current = {
          startActionIndex: x.actionIndex,
          endActionIndex: x.actionIndex,
          startStep: x.step,
          endStep: x.step,
          minBuffer: x.beforeBuffer,
          maxBuffer: x.beforeBuffer,
          actions: []
        };
      }
      current.endActionIndex = x.actionIndex;
      current.endStep = x.step;
      current.minBuffer = Math.min(current.minBuffer, x.beforeBuffer);
      current.maxBuffer = Math.max(current.maxBuffer, x.beforeBuffer);
      current.actions.push({
        step: x.step,
        progress: x.beforeProgress,
        buffer: x.beforeBuffer,
        r: x.r,
        c: x.c,
        color: x.color,
        count: x.count
      });
    } else if (current) {
      out.push(current);
      current = null;
    }
  }
  if (current) out.push(current);
  return out;
}

function classification(capPlan, row0, route, exp, curve) {
  const mid = exp && exp.metrics && exp.metrics.midBuffer34Pct || 0;
  const earlyHigh = route.rows.filter(x => x.beforeProgress < 0.2 && x.beforeBuffer >= 3).length;
  const earlyRelease = route.rows.some((x, i) => {
    const prev = route.rows[i - 1];
    return prev && prev.beforeProgress < 0.2 && prev.beforeBuffer >= 3 &&
      x.beforeProgress >= 0.2 && x.beforeBuffer < 3;
  });
  const flags = {
    capacityBandInfeasible: capPlan.infeasibleColors.length > 0,
    manyBelowMin: capPlan.belowMinCars >= 3,
    row0SameColor: row0.longestSameColorRun >= 3 || row0.maxSameColorTotal >= 3,
    startFullCars: route.rows.length ? route.rows[0].full : false,
    earlyHigh,
    earlyRelease,
    farPressureDeficit: mid < 30,
    nearPressureDeficit: mid >= 30 && mid < 50
  };
  const p2Score = (flags.capacityBandInfeasible ? 2 : 0) +
    (flags.manyBelowMin ? 2 : 0);
  const p3Score = (flags.row0SameColor ? 1 : 0) +
    (flags.earlyHigh >= 2 ? 2 : 0) +
    (flags.earlyRelease ? 2 : 0) +
    (flags.startFullCars ? 1 : 0);
  return {
    flags,
    p2Score,
    p3Score,
    priority: p2Score > p3Score ? 'P2' : (p3Score > p2Score ? 'P3' : 'inspect'),
    note: '启发式只用于排序，不能替代下一轮单因素重解。'
  };
}

function runCase(c) {
  const gen = generateMatched(c);
  if (!gen.parsed) {
    return {
      image: c.image,
      seed: c.seed,
      expectedHash: c.expectedHash,
      hashMatch: false,
      generationAttempts: gen.attempts,
      status: 'rejected_hash_mismatch'
    };
  }
  const level = gen.parsed, sr = gen.r.solveResult;
  const curve = gen.r.goodV3 && gen.r.goodV3.fillCurve ||
    A.Generator.choiceCurve(level, sr);
  const q = A.Quality.fromGeneration(gen.r);
  const cap = A.Quality.capacityEvidence(level, gen.cfg);
  const boxes = boardBoxes(level);
  const capPlan = capacityPlan(gen.blocks, gen.cfg, boxes);
  const row0 = row0Audit(level);
  const route = routeAudit(level, sr);
  const exp = A.ExperienceGoal.evaluate(level, Object.assign({}, gen.cfg, {
    solveResult: sr,
    decision: false,
    instantChain: true,
    bottomOnly: false
  }));
  const decision = classification(capPlan, row0, route, exp, curve);
  fs.mkdirSync(LEVEL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LEVEL_DIR, c.image + '_' + c.seed + '.json'),
    JSON.stringify(level, null, 2) + '\n');
  fs.writeFileSync(path.join(LEVEL_DIR, c.image + '_' + c.seed + '.route.json'),
    JSON.stringify(sr.pickOrder || [], null, 2) + '\n');
  const rec = {
    image: c.image,
    seed: c.seed,
    expectedHash: c.expectedHash,
    actualHash: hash(gen.r.level),
    hashMatch: true,
    reproductionAttempt: gen.attempt,
    generationAttempts: gen.attempts,
    board: { rows: level.board.rows, cols: level.board.cols },
    structure: {
      pass: !!(q && q.gatePass),
      reasons: q && q.gateReasons || [],
      fullMedian2: curve && curve.fullMedian2,
      freeRunMax: curve && curve.freeRunMax,
      freeLowPct: curve && curve.freeLowPct,
      partialStepPct: curve && curve.partialStepPct
    },
    capacityAudit: cap,
    capacityPlan: capPlan,
    row0,
    route,
    pressureWindows: pressureWindows(route),
    experience: {
      pass: !!exp.pass,
      reasons: exp.reasons || [],
      metrics: exp.metrics,
      releaseStatus: exp.releaseDecision && exp.releaseDecision.status || null,
      releaseEvidence: exp.releaseDecision && exp.releaseDecision.evidence || null
    },
    diagnosis: A.ExperienceGoal.diagnose(exp, !!(q && q.gatePass)),
    classification: decision,
    status: 'audited'
  };
  console.log('[audit]', c.image + '/' + c.seed,
    'mid=' + (exp.metrics && exp.metrics.midBuffer34Pct),
    'sig=' + (exp.metrics && exp.metrics.significantReleaseCount),
    'infeasibleColors=' + capPlan.infeasibleColors.length,
    'belowMin=' + capPlan.belowMinCars,
    'row0Run=' + row0.longestSameColorRun,
    'earlyHigh=' + decision.flags.earlyHigh,
    'priority=' + decision.priority);
  return rec;
}

function main() {
  A = load();
  const rows = CASES.map(runCase);
  const audited = rows.filter(x => x.status === 'audited');
  const priorities = {};
  for (const r of audited) priorities[r.classification.priority] = (priorities[r.classification.priority] || 0) + 1;
  const report = {
    schema: 'p2-p3-attribution-v566',
    date: '2026-10-26',
    preregistration: 'P2P3归因_预登记_v566.md',
    summary: {
      cases: rows.length,
      audited: audited.length,
      hashMatches: audited.length,
      priorities,
      dominantPriority: Object.keys(priorities).sort((a, b) => priorities[b] - priorities[a])[0] || null,
      decision: audited.length === rows.length
        ? '三关hash全部复现；按容量可行性/首行/早期释放信号选择下一轮单因素，不直接改生产。'
        : '存在hash复现失败，不能据此选择P2/P3。',
      rows: audited.map(x => ({
        id: x.image + '/' + x.seed,
        midBuffer34Pct: x.experience.metrics && x.experience.metrics.midBuffer34Pct,
        maxBuffer: x.experience.metrics && x.experience.metrics.maxBuffer,
        significantReleaseCount: x.experience.metrics && x.experience.metrics.significantReleaseCount,
        infeasibleColors: x.capacityPlan.infeasibleColors,
        belowMinCars: x.capacityPlan.belowMinCars,
        row0LongestSame: x.row0.longestSameColorRun,
        priority: x.classification.priority,
        p2Score: x.classification.p2Score,
        p3Score: x.classification.p3Score
      }))
    },
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
