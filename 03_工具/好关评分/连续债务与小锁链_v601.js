#!/usr/bin/env node
/** v601：连续选择两笔债务，并在其任务链上加入一组小容量双锁链。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '第七步债务窗口_v599.levels', 'ice11_0_2__1_5.json');
const BASE_ROUTE = path.join(__dirname, '第七步债务窗口_v599.levels', 'ice11_0_2__1_5.route.json');
const OUT = path.join(__dirname, '连续债务与小锁链_v601.json');
const LEVEL_DIR = path.join(__dirname, '连续债务与小锁链_v601.levels');
const SEEDS = [7, 1009, 2027];
const CHAIN_ID = 901;
const CHAIN_CELLS = [{ r: 3, c: 3 }, { r: 4, c: 3 }];
const FORCED_DEBTS = {
  6: { r: 1, c: 0 },
  8: { r: 2, c: 2 }
};
const ARMS = [
  { id: 'A_safe', chain: false, force: {} },
  { id: 'B_firstDebt', chain: false, force: { 6: FORCED_DEBTS[6] } },
  { id: 'C_twoDebts', chain: false, force: FORCED_DEBTS },
  { id: 'D_chainOnly', chain: true, force: {} },
  { id: 'E_twoDebts_chain', chain: true, force: FORCED_DEBTS }
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
const S = A.Simulator;
const G = A.Generator;
const raw = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
const parsed = A.parseLevel(raw);
const baseRoute = JSON.parse(fs.readFileSync(BASE_ROUTE, 'utf8'));

function withChain(level) {
  const out = A.deepClone(level);
  for (const cell of CHAIN_CELLS) {
    const box = out.board.cells[cell.r] && out.board.cells[cell.r][cell.c];
    if (!box || box.t !== 'box' || box.numice || box.chain) {
      throw new Error('chain cell unavailable: ' + JSON.stringify(cell));
    }
    box.chain = CHAIN_ID;
  }
  return out;
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
  const lv = A.parseLevel(level);
  const state = S.enter(lv, { useSlotStart: true, instantChain: true });
  const samples = [];
  let lastDone = state.completedBoxes || 0;
  let steps = 0, earlySteps = 0, early34 = 0, r9 = 0, noGood = 0;
  let bridges = 0, hiBefore70 = 0, stepsBefore70 = 0;
  const debtWindows = [];
  for (let i = 0; i < (order || []).length; i++) {
    const action = order[i];
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
    const options = moves.filter(m => !m.blocked).map(m => {
      const cell = state.cells[m.r][m.c];
      const reach = reachAt(state, cell.color);
      return {
        r: m.r, c: m.c, color: cell.color, capacity: cell.count,
        reach, debt: cell.count - reach, canConsume: !!m.canConsume
      };
    });
    const smallDebt = options.filter(x => x.debt >= 2 && x.debt <= 4);
    if (smallDebt.length && progress < 0.30) {
      debtWindows.push({
        step: i + 1,
        progress: +progress.toFixed(4),
        buffer,
        fullCount: good,
        smallDebt
      });
    }
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
  const totalBoxes = state.totalBoxes || lv.totalBoxes || 0;
  const limit = lv.bufferLimit || state.bufferLimit || 5;
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
    midLateAt: audit.lateAt,
    peakBuf: audit.peakBuf,
    significantReleases: release.significantReleaseCount,
    maxReleaseAmplitude: release.releaseAmplitudes && release.releaseAmplitudes.length
      ? Math.max(...release.releaseAmplitudes) : 0,
    debtWindows
  };
}

function pickedEvents(ps) {
  return (ps && ps.instantEvents || []).filter(e => e && e.pick);
}

function trajectoryPoint(ps, tick) {
  const trajectory = ps && ps.tickTrajectory || [];
  for (let i = 0; i < trajectory.length; i++) {
    if (trajectory[i].tick === tick) return trajectory[i];
  }
  return null;
}

function forcedEvidence(ps, force) {
  const events = pickedEvents(ps);
  return Object.keys(force).sort((a, b) => +a - +b).map(index => {
    const event = events[+index];
    const target = force[index];
    return {
      index: +index,
      expected: target,
      observed: event && event.pick ? {
        r: event.pick.r, c: event.pick.c, color: event.pick.color,
        boxes: event.pick.boxes, chainSize: event.pick.chainSize,
        bufferBefore: event.bufferBefore,
        bufferEnter: event.pick.bufEnter,
        bufferAfter: event.bufferAfter,
        completedBoxes: event.completedBoxes
      } : null,
      applied: !!(event && event.pick && event.pick.r === target.r && event.pick.c === target.c)
    };
  });
}

function chainEvidence(ps) {
  const events = pickedEvents(ps);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const picked = e.pick.picked || [];
    const hit = picked.some(x => CHAIN_CELLS.some(c => c.r === x.r && c.c === x.c)) ||
      CHAIN_CELLS.some(c => c.r === e.pick.r && c.c === e.pick.c);
    if (!hit) continue;
    const trajectory = trajectoryPoint(ps, e.tick);
    return {
      eventIndex: i,
      tick: e.tick,
      r: e.pick.r,
      c: e.pick.c,
      color: e.pick.color,
      boxes: e.pick.boxes,
      chainSize: e.pick.chainSize,
      picked,
      bufferBefore: e.bufferBefore,
      bufferEnter: e.pick.bufEnter,
      bufferAfter: e.bufferAfter,
      completedBoxes: e.completedBoxes,
      progress: trajectory ? trajectory.progress : null
    };
  }
  return null;
}

function bufferReleases(ps, afterIndex, initialBuffer) {
  const events = pickedEvents(ps);
  for (let i = afterIndex + 1; i < events.length; i++) {
    if ((events[i].bufferAfter || 0) < initialBuffer) {
      const trajectory = trajectoryPoint(ps, events[i].tick);
      return {
        picksAfter: i - afterIndex,
        tick: events[i].tick,
        bufferAfter: events[i].bufferAfter,
        completedBoxes: events[i].completedBoxes,
        progress: trajectory ? trajectory.progress : null
      };
    }
  }
  return null;
}

const rows = [];
for (const seed of SEEDS) {
  for (const arm of ARMS) {
    const level = arm.chain ? withChain(raw) : A.deepClone(raw);
    const t0 = Date.now();
    const ps = A.PlayerSim.run(A.parseLevel(level), {
      seed, instantChain: true, forcedPicks: arm.force
    });
    const pickOrder = ps && ps.pickOrder || [];
    const line = measureLine(level, pickOrder);
    const forced = forcedEvidence(ps, arm.force);
    const chain = arm.chain ? chainEvidence(ps) : null;
    const chainRelease = chain ? bufferReleases(ps, chain.eventIndex, chain.bufferAfter) : null;
    const lastDebt = forced.length ? forced[forced.length - 1] : null;
    const debtRelease = lastDebt && lastDebt.observed
      ? bufferReleases(ps, lastDebt.index, lastDebt.observed.bufferAfter)
      : null;
    const rec = {
      seed,
      arm: arm.id,
      chain: arm.chain,
      forced: arm.force,
      forced,
      forcedApplied: forced.every(x => x.applied),
      won: !!(ps && ps.won),
      progress: ps && ps.progress,
      picks: ps && ps.picks,
      completedBoxes: ps && ps.completedBoxes,
      totalBoxes: ps && ps.totalBoxes,
      bufferPeak: ps && ps.bufferPeak,
      playerAvgBuffer: ps && ps.playerAvgBuffer,
      deathSnapshot: ps && ps.deathSnapshot,
      chain,
      chainRelease,
      debtRelease,
      line,
      elapsedMs: Date.now() - t0
    };
    rows.push(rec);
    console.log('[v601]', seed, arm.id,
      'chain=' + !!chain,
      'forced=' + rec.forcedApplied,
      'won=' + rec.won,
      'coverage=' + rec.progress,
      'peak=' + rec.bufferPeak,
      'chainBuf=' + (chain && chain.bufferAfter),
      'debtBuf=' + (lastDebt && lastDebt.observed && lastDebt.observed.bufferAfter),
      'r9=' + line.r9,
      'early=' + line.early34Pct,
      'ms=' + rec.elapsedMs);
  }
}

function rowsFor(seed, arm) {
  return rows.find(x => x.seed === seed && x.arm === arm);
}

const pairs = [];
for (const seed of SEEDS) {
  const a = rowsFor(seed, 'A_safe');
  const b = rowsFor(seed, 'B_firstDebt');
  const c = rowsFor(seed, 'C_twoDebts');
  const d = rowsFor(seed, 'D_chainOnly');
  const e = rowsFor(seed, 'E_twoDebts_chain');
  pairs.push({
    seed,
    won: { A: a && a.won, B: b && b.won, C: c && c.won, D: d && d.won, E: e && e.won },
    progress: { A: a && a.progress, B: b && b.progress, C: c && c.progress, D: d && d.progress, E: e && e.progress },
    bufferPeak: { A: a && a.bufferPeak, B: b && b.bufferPeak, C: c && c.bufferPeak, D: d && d.bufferPeak, E: e && e.bufferPeak },
    r9: { A: a && a.line.r9, B: b && b.line.r9, C: c && c.line.r9, D: d && d.line.r9, E: e && e.line.r9 },
    early34Pct: { A: a && a.line.early34Pct, B: b && b.line.early34Pct, C: c && c.line.early34Pct, D: d && d.line.early34Pct, E: e && e.line.early34Pct },
    chainBuffer: e && e.chain && e.chain.bufferAfter,
    twoDebtBuffer: c && c.forced.length ? c.forced[c.forced.length - 1].observed.bufferAfter : null
  });
}

fs.mkdirSync(LEVEL_DIR, { recursive: true });
const levelPath = path.join(LEVEL_DIR, 'ice11_smallChain901.json');
fs.writeFileSync(levelPath, JSON.stringify(withChain(raw), null, 2) + '\n');

const report = {
  schema: 'two-debt-small-chain-v601',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  baseRoute: path.relative(ROOT, BASE_ROUTE),
  chain: {
    id: CHAIN_ID,
    cells: CHAIN_CELLS.map(x => {
      const cell = raw.board.cells[x.r][x.c];
      return Object.assign({}, x, { color: cell.color, capacity: cell.count });
    }),
    levelFile: path.relative(ROOT, levelPath)
  },
  forcedDebts: FORCED_DEBTS,
  seeds: SEEDS,
  summary: {
    runs: rows.length,
    forcedApplied: rows.filter(x => x.forcedApplied).length,
    won: rows.filter(x => x.won).length,
    byArm: ARMS.map(arm => {
      const rr = rows.filter(x => x.arm === arm.id);
      return {
        arm: arm.id,
        won: rr.filter(x => x.won).length,
        bufferPeaks: rr.map(x => x.bufferPeak),
        r9: rr.map(x => x.line.r9),
        early34Pct: rr.map(x => x.line.early34Pct),
        midLatePeaks: rr.map(x => x.line.midLatePeak)
      };
    }),
    chainTriggered: rows.filter(x => x.chain).length,
    chainArmsWon: rows.filter(x => x.chain && x.won).length,
    pairs
  },
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
