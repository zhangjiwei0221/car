#!/usr/bin/env node
/** v599：冻结第7步的三个免费满解中的2～3个，验证能否逼出早期r9。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '短债单车交换_第五轮_v594.levels', '3_0__3_3.json');
const BASE_ROUTE = path.join(__dirname, '短债单车交换_第五轮_v594.levels', '3_0__3_3.route.json');
const OUT = path.join(__dirname, '第七步债务窗口_v599.json');
const LEVEL_DIR = path.join(__dirname, '第七步债务窗口_v599.levels');
const TARGET_STEP_INDEX = 6;
const DOSES = [7, 9, 11];
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
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  }
  return sb.AntSolver;
}

const A = load();
const G = A.Generator;
const S = A.Simulator;
const raw = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
const route = JSON.parse(fs.readFileSync(BASE_ROUTE, 'utf8'));
const CFG = {
  seed: 1001, ruleMode: 'instantChain', instantChain: true, bottomOnly: false,
  elimOrder: 'instant', boxSizeMin: 6, boxSizeMax: 40,
  capNormMin: 6, capNormMax: 40, boardRowsMin: 7, boardRowsMax: 7,
  boardColsMin: 7, boardColsMax: 7, boardHardRange: true, boardAuto: false,
  p7Repair: false, trapPost: false, localSwapRepair: false,
  experienceGoal: false, maxDecisionStates: 8, stateSampleMode: 'midStratified',
  minReleaseAmplitude: 2
};

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function reachAt(state, color, slot) {
  const start = {
    r: state.rows - 1,
    c: Math.min(state.cols - 1, Math.floor(slot / state.bufferLimit * state.cols))
  };
  return S.instantChainEliminate(
    state.eliminated.map(row => row.slice()),
    state.blocks,
    state.rows,
    state.cols,
    color,
    Infinity,
    null,
    start,
    null
  );
}

function leftmostFreeSlot(state) {
  for (let slot = 0; slot < state.bufferLimit; slot++) {
    if (!state.buffer.some(item => item.slot === slot)) return slot;
  }
  return 0;
}

function stateOptions(state) {
  const slot = leftmostFreeSlot(state);
  return S.listMoves(state).filter(m => !m.blocked).map(m => {
    const cell = state.cells[m.r][m.c];
    const reach = reachAt(state, cell.color, slot);
    return {
      r: m.r, c: m.c, color: cell.color, capacity: cell.count,
      reach, debt: cell.count - reach, canConsume: !!m.canConsume
    };
  });
}

function earlyDecisionWindows(parsed, order) {
  const state = S.createState(parsed, {
    useSlotStart: true, bottomOnly: false, instantChain: true
  });
  const windows = [];
  for (let i = 0; i < order.length; i++) {
    const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    if (progress >= 0.30) break;
    const options = stateOptions(state);
    const full = options.filter(x => x.canConsume);
    const smallDebt = options.filter(x => x.debt >= 2 && x.debt <= 4);
    if (full.length === 1 && smallDebt.length >= 1) {
      windows.push({
        step: i + 1,
        progress: +progress.toFixed(4),
        buffer: state.buffer.length,
        full: full[0],
        smallDebt
      });
    }
    S.applyPick(state, order[i].r, order[i].c);
  }
  return windows;
}

function measureLine(parsed, order) {
  const state = S.enter(parsed, { useSlotStart: true, instantChain: true });
  const samples = [];
  let lastDone = state.completedBoxes || 0;
  let steps = 0, earlySteps = 0, early34 = 0, r9 = 0, noGood = 0;
  let bridges = 0, hiBefore70 = 0, stepsBefore70 = 0;
  for (const action of order || []) {
    if (!action || action.r == null) continue;
    const moves = S.listMoves(state);
    let good = 0, traps = 0;
    for (const move of moves) {
      if (move.blocked) continue;
      if (move.canConsume) good++;
      else traps++;
    }
    const progress = state.totalBoxes ? state.completedBoxes / state.totalBoxes : 0;
    const buffer = state.buffer.length;
    steps++;
    if (progress < 0.30) {
      earlySteps++;
      if (buffer >= 3 && buffer <= 4) early34++;
    }
    if (progress < 0.70) {
      stepsBefore70++;
      if (buffer >= 4) hiBefore70++;
    }
    if (moves.length === 1 && progress < 0.90) bridges++;
    if (moves.length >= 2 && good === 1 && traps >= 1) r9++;
    if (good === 0) noGood++;
    S.applyPick(state, action.r, action.c);
    if (state.completedBoxes !== lastDone) {
      lastDone = state.completedBoxes;
      samples.push({ done: lastDone, buf: state.buffer.length });
    }
    if (state.gameOver) break;
  }
  const totalBoxes = state.totalBoxes || parsed.totalBoxes || 0;
  const limit = parsed.bufferLimit || state.bufferLimit || 5;
  const audit = A.Analysis.chokepointAudit(samples, totalBoxes, limit);
  const release = A.SolverAnalysis.pressureFromSeries(samples.map(s => ({
    buffer: s.buf,
    progress: totalBoxes ? s.done / totalBoxes : 0
  })), limit);
  return {
    steps,
    won: !!(state.eliminatedPixels >= state.totalPixels || state.gameWon),
    bridges,
    r9,
    noGood,
    early34Pct: earlySteps ? Math.round(early34 / earlySteps * 100) : 0,
    early34Steps: early34,
    hiBefore70Pct: stepsBefore70 ? Math.round(hiBefore70 / stepsBefore70 * 100) : 0,
    midLatePeak: audit.lateMax,
    peakBuf: audit.peakBuf,
    significantReleases: release.significantReleaseCount,
    maxReleaseAmplitude: release.releaseAmplitudes && release.releaseAmplitudes.length
      ? Math.max(...release.releaseAmplitudes) : 0
  };
}

function gateFailures(worst) {
  const gates = G.CHOKE_V2_GATES;
  const out = [];
  if (worst.bridges > gates.bridgeMax) out.push('独木桥');
  if (worst.r9 < gates.r9Min) out.push('预算判断点');
  if (worst.noGood > gates.noGoodMax) out.push('无满解');
  if (worst.hiBefore70Pct > gates.hiBefore70PctMax) out.push('70%前高压');
  if (worst.early34Pct < gates.early34MinPct) out.push('前期限压');
  if (worst.midLatePeak != null && worst.midLatePeak < gates.midLatePeakMin) out.push('中后期峰窗');
  return out;
}

function worstOf(omni, player) {
  return {
    bridges: Math.max(omni.bridges, player.bridges),
    r9: Math.min(omni.r9, player.r9),
    noGood: Math.max(omni.noGood, player.noGood),
    hiBefore70Pct: Math.max(omni.hiBefore70Pct, player.hiBefore70Pct),
    early34Pct: Math.min(omni.early34Pct, player.early34Pct),
    midLatePeak: Math.min(omni.midLatePeak, player.midLatePeak)
  };
}

function evaluate(id, level, iceCells) {
  const t0 = Date.now();
  const ev = G.evaluateLevel(level, CFG);
  if (!ev || !ev.valid || !ev.level || !ev.solveResult) {
    return { id, iceCells, valid: false, error: ev && ev.lastFailReason || 'invalid', elapsedMs: Date.now() - t0 };
  }
  const parsed = A.parseLevel(ev.level);
  const omniWindows = earlyDecisionWindows(parsed, ev.solveResult.pickOrder || []);
  const omni = measureLine(parsed, ev.solveResult.pickOrder || []);
  const ps = A.PlayerSim.run(parsed, { seed: 7, instantChain: true });
  const playerWindows = ps ? earlyDecisionWindows(parsed, ps.pickOrder || []) : [];
  const player = ps ? measureLine(parsed, ps.pickOrder || []) : omni;
  const worst = worstOf(omni, player);
  const failures = gateFailures(worst);
  const quality = A.Quality.fromGeneration(ev);
  const curve = ev.goodV3 && ev.goodV3.fillCurve || null;
  const capacity = A.Quality.capacityEvidence(ev.level, CFG);
  let exp = null;
  try {
    exp = A.ExperienceGoal.evaluate(ev.level, {
      solveResult: ev.solveResult, decision: true, instantChain: true,
      maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
    });
  } catch (e) {
    exp = { error: String(e && e.message || e) };
  }
  const rec = {
    id,
    iceCells,
    valid: true,
    levelHash: hash(ev.level),
    capacity: {
      conserved: capacity && capacity.conserved,
      perColorConserved: capacity && capacity.perColorConserved,
      aboveMax: capacity && capacity.aboveMax,
      belowMin: capacity && capacity.belowMin,
      boardFloorPass: capacity && capacity.boardFloorPass
    },
    obstacles: A.Analysis.obstacleStats(parsed),
    quality: quality ? {
      gatePass: !!quality.gatePass,
      gateReasons: quality.gateReasons || []
    } : null,
    curve: curve ? {
      freeLowPct: curve.freeLowPct,
      freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2,
      selectMedian: curve.selectMedian,
      pressurePct3: curve.pressurePct3,
      pressurePeak: curve.pressurePeak
    } : null,
    experience: exp && exp.metrics ? {
      maxBuffer: exp.metrics.maxBuffer,
      midBuffer34Pct: exp.metrics.midBuffer34Pct,
      significantReleaseCount: exp.metrics.significantReleaseCount,
      releaseStatus: exp.releaseDecision && exp.releaseDecision.status || null,
      pass: !!exp.pass
    } : null,
    player: {
      won: !!(ps && ps.won),
      coveragePct: ps && ps.coveragePct,
      pads: ps && ps.pads
    },
    omni,
    playerLine: player,
    worst,
    omniEarlyWindows: omniWindows,
    playerEarlyWindows: playerWindows,
    cardGate: {
      pass: failures.length === 0,
      failures,
      gates: G.CHOKE_V2_GATES
    },
    elapsedMs: Date.now() - t0
  };
  rec.score = (6 - failures.length) * 1000 +
    Math.min(5, rec.experience && rec.experience.maxBuffer || 0) * 30 +
    Math.max(0, worst.midLatePeak || 0) * 20 +
    Math.max(0, worst.early34Pct || 0) * 2 +
    (omniWindows.length ? 50 : 0) + (playerWindows.length ? 100 : 0);
  return Object.assign(rec, { _level: ev.level, _route: ev.solveResult.pickOrder || [] });
}

const targetState = S.createState(A.parseLevel(raw), {
  useSlotStart: true, bottomOnly: false, instantChain: true
});
const actions = A.SolverAnalysis.normalizeActions(route);
for (let i = 0; i < TARGET_STEP_INDEX; i++) {
  S.applyPick(targetState, actions[i].r, actions[i].c);
}
const targetOptions = stateOptions(targetState);
const full = targetOptions.filter(x => x.canConsume);
const smallDebt = targetOptions.filter(x => x.debt >= 2 && x.debt <= 4);
if (full.length !== 3 || !smallDebt.some(x => x.r === 1 && x.c === 0 && x.color === 30)) {
  throw new Error('target window changed: ' + JSON.stringify({ full, smallDebt }));
}

const selections = [
  [0, 1], [0, 2], [1, 2], [0, 1, 2]
];
const variants = [];
for (const dose of DOSES) {
  for (const indices of selections) {
    const picked = indices.map(i => full[i]);
    const level = A.deepClone(raw);
    for (const cell of picked) level.board.cells[cell.r][cell.c].numice = dose;
    const id = 'ice' + dose + '_' + picked.map(x => x.r + '_' + x.c).join('__');
    variants.push({
      id,
      level,
      iceCells: picked.map(x => ({
        r: x.r, c: x.c, color: x.color, capacity: x.capacity, numice: dose
      }))
    });
  }
}

const rows = [];
for (let i = 0; i < variants.length; i++) {
  const variant = variants[i];
  const rec = evaluate(variant.id, variant.level, variant.iceCells);
  rows.push(rec);
  console.log('[v599]', (i + 1) + '/' + variants.length, variant.id,
    'valid=' + rec.valid,
    'omniWindows=' + (rec.omniEarlyWindows && rec.omniEarlyWindows.length),
    'playerWindows=' + (rec.playerEarlyWindows && rec.playerEarlyWindows.length),
    'early=' + (rec.playerLine && rec.playerLine.early34Pct),
    'r9=' + (rec.worst && rec.worst.r9),
    'peak=' + (rec.worst && rec.worst.midLatePeak),
    'max=' + (rec.experience && rec.experience.maxBuffer),
    'ms=' + rec.elapsedMs);
}

const valid = rows.filter(x => x.valid);
valid.sort((a, b) => b.score - a.score);
fs.mkdirSync(LEVEL_DIR, { recursive: true });
const saved = [];
for (const rec of valid) {
  const file = path.join(LEVEL_DIR, rec.id + '.json');
  const routeFile = path.join(LEVEL_DIR, rec.id + '.route.json');
  fs.writeFileSync(file, JSON.stringify(rec._level, null, 2) + '\n');
  fs.writeFileSync(routeFile, JSON.stringify(rec._route, null, 2) + '\n');
  saved.push({
    id: rec.id,
    levelFile: path.relative(ROOT, file),
    routeFile: path.relative(ROOT, routeFile)
  });
}
for (const rec of rows) {
  delete rec._level;
  delete rec._route;
}

const report = {
  schema: 'step7-debt-window-v599',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  baseRoute: path.relative(ROOT, BASE_ROUTE),
  target: {
    step: 7,
    progress: 0.1462,
    full,
    smallDebt
  },
  doses: DOSES,
  summary: {
    variants: rows.length,
    valid: valid.length,
    omniEarlyWindow: valid.filter(x => x.omniEarlyWindows && x.omniEarlyWindows.length > 0).length,
    playerEarlyWindow: valid.filter(x => x.playerEarlyWindows && x.playerEarlyWindows.length > 0).length,
    playerEarlyPressure: valid.filter(x => x.playerLine && x.playerLine.early34Pct > 0).length,
    maxBuffer3: valid.filter(x => x.experience && x.experience.maxBuffer >= 3).length,
    cardGate: valid.filter(x => x.cardGate && x.cardGate.pass).length,
    best: valid.length ? {
      id: valid[0].id,
      iceCells: valid[0].iceCells,
      earlyWindows: {
        omni: valid[0].omniEarlyWindows,
        player: valid[0].playerEarlyWindows
      },
      worst: valid[0].worst,
      maxBuffer: valid[0].experience && valid[0].experience.maxBuffer,
      curve: valid[0].curve,
      failures: valid[0].cardGate.failures
    } : null
  },
  saved,
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
