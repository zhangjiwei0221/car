#!/usr/bin/env node
/** v603：封堵v602安全路线的第7步绕行点，测试自然进入债务/锁链分支。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '小锁链位置扫描_v602.levels', '4_2__4_3.json');
const OUT = path.join(__dirname, '封堵安全绕行_v603.json');
const LEVEL_DIR = path.join(__dirname, '封堵安全绕行_v603.levels');
const SEEDS = [7, 1009, 2027];
const EXISTING_CHAIN = [{ r: 4, c: 2 }, { r: 4, c: 3 }];
const ARMS = [
  { id: 'A_control', type: 'control' },
  { id: 'B_ice7_2_1', type: 'ice', cell: { r: 2, c: 1 }, value: 7 },
  { id: 'C_ice11_2_1', type: 'ice', cell: { r: 2, c: 1 }, value: 11 },
  { id: 'D_ice15_2_1', type: 'ice', cell: { r: 2, c: 1 }, value: 15 },
  { id: 'E_chain_2_1__2_0', type: 'chain', cells: [{ r: 2, c: 1 }, { r: 2, c: 0 }], chainId: 902 },
  { id: 'F_chain_2_1__2_2', type: 'chain', cells: [{ r: 2, c: 1 }, { r: 2, c: 2 }], chainId: 903 }
];
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
const CFG = {
  seed: 1001, ruleMode: 'instantChain', instantChain: true, bottomOnly: false,
  elimOrder: 'instant', boxSizeMin: 6, boxSizeMax: 40,
  capNormMin: 6, capNormMax: 40, boardRowsMin: 7, boardRowsMax: 7,
  boardColsMin: 7, boardColsMax: 7, boardHardRange: true, boardAuto: false,
  p7Repair: false, trapPost: false, localSwapRepair: false,
  experienceGoal: false, maxDecisionStates: 8, stateSampleMode: 'midStratified',
  minReleaseAmplitude: 2
};

function buildLevel(arm) {
  const level = A.deepClone(raw);
  if (arm.type === 'ice') {
    const cell = level.board.cells[arm.cell.r][arm.cell.c];
    if (!cell || cell.t !== 'box') throw new Error('ice target invalid');
    cell.numice = arm.value;
  } else if (arm.type === 'chain') {
    for (const pos of arm.cells) {
      const cell = level.board.cells[pos.r][pos.c];
      if (!cell || cell.t !== 'box') throw new Error('chain target invalid');
      cell.chain = arm.chainId;
    }
  }
  return level;
}

function leftmostFreeSlot(state) {
  for (let slot = 0; slot < state.bufferLimit; slot++) {
    if (!state.buffer.some(item => item.slot === slot)) return slot;
  }
  return 0;
}

function reachAt(state, color) {
  const slot = leftmostFreeSlot(state);
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

function measureLine(level, order) {
  const parsed = A.parseLevel(level);
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
  const audit = A.Analysis.chokepointAudit(samples, totalBoxes, parsed.bufferLimit || 5);
  const release = A.SolverAnalysis.pressureFromSeries(samples.map(s => ({
    buffer: s.buf,
    progress: totalBoxes ? s.done / totalBoxes : 0
  })), parsed.bufferLimit || 5);
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

function chainEvidence(ps, cells) {
  const events = (ps && ps.instantEvents || []).filter(e => e && e.pick);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const picked = e.pick.picked || [];
    const hit = picked.some(x => cells.some(c => c.r === x.r && c.c === x.c)) ||
      cells.some(c => c.r === e.pick.r && c.c === e.pick.c);
    if (!hit) continue;
    const trajectory = (ps.tickTrajectory || []).find(x => x.tick === e.tick) || null;
    let release = null;
    for (let j = i + 1; j < events.length; j++) {
      if ((events[j].bufferAfter || 0) < (e.bufferAfter || 0)) {
        const tr = (ps.tickTrajectory || []).find(x => x.tick === events[j].tick) || null;
        release = {
          picksAfter: j - i,
          progress: tr ? tr.progress : null,
          bufferAfter: events[j].bufferAfter
        };
        break;
      }
    }
    return {
      tick: e.tick,
      boxes: e.pick.boxes,
      bufferBefore: e.bufferBefore,
      bufferEnter: e.pick.bufEnter,
      bufferAfter: e.bufferAfter,
      progress: trajectory ? trajectory.progress : null,
      release
    };
  }
  return null;
}

function runArm(arm) {
  const level = buildLevel(arm);
  const t0 = Date.now();
  const ev = G.evaluateLevel(level, CFG);
  if (!ev || !ev.valid || !ev.level || !ev.solveResult) {
    return { id: arm.id, valid: false, reason: ev && ev.lastFailReason || 'invalid', elapsedMs: Date.now() - t0 };
  }
  const parsed = A.parseLevel(ev.level);
  const omni = measureLine(ev.level, ev.solveResult.pickOrder || []);
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
  const safeCellStep = routeStepOf(ev.solveResult.pickOrder || [], { r: 2, c: 1 });
  const firstDebtStep = routeStepOf(ev.solveResult.pickOrder || [], { r: 1, c: 0 });
  const secondDebtStep = routeStepOf(ev.solveResult.pickOrder || [], { r: 2, c: 2 });
  const players = SEEDS.map(seed => {
    const ps = A.PlayerSim.run(parsed, { seed, instantChain: true });
    return {
      seed,
      won: !!(ps && ps.won),
      progress: ps && ps.progress,
      picks: ps && ps.picks,
      bufferPeak: ps && ps.bufferPeak,
      targetChain: chainEvidence(ps, EXISTING_CHAIN),
      addedChain: arm.type === 'chain' ? chainEvidence(ps, arm.cells) : null,
      line: ps ? measureLine(ev.level, ps.pickOrder || []) : null
    };
  });
  return {
    id: arm.id,
    arm,
    valid: true,
    levelHash: (awaitImportHash(ev.level)),
    capacity: {
      conserved: capacity && capacity.conserved,
      perColorConserved: capacity && capacity.perColorConserved,
      aboveMax: capacity && capacity.aboveMax,
      belowMin: capacity && capacity.belowMin,
      boardFloorPass: capacity && capacity.boardFloorPass
    },
    solverRoute: {
      safeCellStep,
      firstDebtStep,
      secondDebtStep,
      targetChain: chainEvidenceFromRoute(ev.solveResult.pickOrder || [], EXISTING_CHAIN)
    },
    quality: quality ? { gatePass: !!quality.gatePass, gateReasons: quality.gateReasons || [] } : null,
    curve: curve ? {
      freeLowPct: curve.freeLowPct,
      freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2,
      pressurePct3: curve.pressurePct3,
      pressurePeak: curve.pressurePeak
    } : null,
    experience: exp && exp.metrics ? {
      pass: !!exp.pass,
      maxBuffer: exp.metrics.maxBuffer,
      midBuffer34Pct: exp.metrics.midBuffer34Pct,
      significantReleaseCount: exp.metrics.significantReleaseCount,
      releaseStatus: exp.releaseDecision && exp.releaseDecision.status || null
    } : null,
    omni,
    players,
    elapsedMs: Date.now() - t0,
    _level: ev.level
  };
}

function routeStepOf(order, cell) {
  for (const pick of order || []) {
    if (pick.r === cell.r && pick.c === cell.c) return pick.step != null ? pick.step : null;
  }
  return null;
}

function chainEvidenceFromRoute(order, cells) {
  const steps = {};
  for (const p of order || []) {
    for (const c of cells) if (p.r === c.r && p.c === c.c) steps[p.step] = 1;
  }
  const step = Object.keys(steps).map(Number).sort((a, b) => a - b)[0];
  return step == null ? null : { step };
}

function awaitImportHash(level) {
  return require('crypto').createHash('sha256').update(JSON.stringify(level)).digest('hex');
}

const rows = ARMS.map(runArm);
fs.mkdirSync(LEVEL_DIR, { recursive: true });
const saved = [];
for (const rec of rows) {
  if (!rec.valid) continue;
  const file = path.join(LEVEL_DIR, rec.id + '.json');
  fs.writeFileSync(file, JSON.stringify(rec._level, null, 2) + '\n');
  saved.push({ id: rec.id, levelFile: path.relative(ROOT, file) });
}
for (const rec of rows) delete rec._level;

const report = {
  schema: 'block-safe-detour-v603',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  existingChain: EXISTING_CHAIN,
  safeCell: { r: 2, c: 1 },
  seeds: SEEDS,
  summary: {
    variants: rows.length,
    valid: rows.filter(x => x.valid).length,
    solverStillSafe: rows.filter(x => x.solverRoute &&
      x.solverRoute.safeCellStep != null && x.solverRoute.safeCellStep <= 7).length,
    solverTakesFirstDebt: rows.filter(x => x.solverRoute &&
      x.solverRoute.firstDebtStep != null).length,
    solverTakesSecondDebt: rows.filter(x => x.solverRoute &&
      x.solverRoute.secondDebtStep != null).length,
    solverTriggersExistingChain: rows.filter(x => x.solverRoute && x.solverRoute.targetChain).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    experience: rows.filter(x => x.experience && x.experience.pass).length,
    playerAllWin: rows.filter(x => x.players && x.players.length === SEEDS.length &&
      x.players.every(p => p.won)).length,
    playerPeak3Plus: rows.filter(x => x.players &&
      x.players.some(p => p.bufferPeak >= 3)).length,
    best: rows.filter(x => x.valid).sort((a, b) =>
      (b.quality && b.quality.gatePass ? 1 : 0) - (a.quality && a.quality.gatePass ? 1 : 0) ||
      (b.experience && b.experience.maxBuffer || 0) - (a.experience && a.experience.maxBuffer || 0) ||
      (b.omni.midLatePeak || 0) - (a.omni.midLatePeak || 0))[0] || null
  },
  saved,
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
