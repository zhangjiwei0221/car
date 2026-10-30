#!/usr/bin/env node
/** v600：比较第7步安全满解与颜色30债务3两条PlayerSim分支。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const LEVEL_ID = process.env.TASK_LEVEL_ID || 'ice7_0_2__1_5';
const BASE_LEVEL = path.join(__dirname, '第七步债务窗口_v599.levels', LEVEL_ID + '.json');
const BASE_ROUTE = path.join(__dirname, '第七步债务窗口_v599.levels', LEVEL_ID + '.route.json');
const OUT = path.join(__dirname, process.env.TASK_OUTPUT || '第7步分支对照_v600.json');
const FORCE_INDEX = 6;
const SEEDS = [7, 1009, 2027];
const BRANCHES = [
  { id: 'A_full', r: 2, c: 1, label: '安全满解' },
  { id: 'B_debt3', r: 1, c: 0, label: '温和债务3' }
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
const raw = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
const parsed = A.parseLevel(raw);
const baseRoute = JSON.parse(fs.readFileSync(BASE_ROUTE, 'utf8'));

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

function measureLine(order) {
  const state = S.enter(parsed, { useSlotStart: true, instantChain: true });
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
    midLateAt: audit.lateAt,
    peakBuf: audit.peakBuf,
    significantReleases: release.significantReleaseCount,
    maxReleaseAmplitude: release.releaseAmplitudes && release.releaseAmplitudes.length
      ? Math.max(...release.releaseAmplitudes) : 0,
    debtWindows
  };
}

function branchEvent(ps, branch) {
  const events = ps && ps.instantEvents || [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event || !event.pick) continue;
    const picks = event.pick.picked || [event.pick];
    if (picks.some(x => x.r === branch.r && x.c === branch.c)) {
      return {
        tick: event.tick,
        pickIndex: i,
        bufferBefore: event.bufferBefore,
        bufferEnter: event.pick.bufEnter,
        bufferAfter: event.bufferAfter,
        completedBoxes: event.completedBoxes
      };
    }
  }
  return null;
}

function releaseAfterBranch(ps, event) {
  if (!event) return null;
  const events = ps && ps.instantEvents || [];
  for (let i = event.pickIndex + 1; i < events.length; i++) {
    const e = events[i];
    if (!e) continue;
    if ((e.bufferAfter || 0) < (event.bufferAfter || 0)) {
      return {
        picksAfter: i - event.pickIndex,
        bufferAfter: e.bufferAfter,
        completedBoxes: e.completedBoxes,
        pick: e.pick ? { r: e.pick.r, c: e.pick.c, color: e.pick.color } : null
      };
    }
  }
  return null;
}

function sameStepConvergence(a, b) {
  let firstDifference = null;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].r !== b[i].r || a[i].c !== b[i].c) {
      firstDifference = i + 1;
      break;
    }
  }
  return {
    firstDifference,
    convergedAt: firstDifference == null ? Math.min(a.length, b.length) + 1 : null,
    sameLength: a.length === b.length
  };
}

const sourceWindow = (() => {
  const state = S.createState(parsed, {
    useSlotStart: true, bottomOnly: false, instantChain: true
  });
  const actions = A.SolverAnalysis.normalizeActions(baseRoute);
  for (let i = 0; i < FORCE_INDEX; i++) S.applyPick(state, actions[i].r, actions[i].c);
  const options = S.listMoves(state).filter(m => !m.blocked).map(m => {
    const cell = state.cells[m.r][m.c];
    const reach = reachAt(state, cell.color);
    return {
      r: m.r, c: m.c, color: cell.color, capacity: cell.count,
      reach, debt: cell.count - reach, canConsume: !!m.canConsume
    };
  });
  return {
    step: FORCE_INDEX + 1,
    progress: state.totalPixels ? +(state.eliminatedPixels / state.totalPixels).toFixed(4) : null,
    buffer: state.buffer.length,
    options
  };
})();

const rows = [];
for (const seed of SEEDS) {
  for (const branch of BRANCHES) {
    const forcedPicks = {};
    forcedPicks[FORCE_INDEX] = { r: branch.r, c: branch.c };
    const t0 = Date.now();
    const ps = A.PlayerSim.run(parsed, {
      seed, instantChain: true, forcedPicks
    });
    const pickOrder = ps && ps.pickOrder || [];
    const chosenAtBranch = pickOrder[FORCE_INDEX] || null;
    const event = branchEvent(ps, branch);
    const line = measureLine(pickOrder);
    const rec = {
      seed,
      branch: branch.id,
      branchLabel: branch.label,
      forced: { r: branch.r, c: branch.c },
      forcedApplied: !!(chosenAtBranch && chosenAtBranch.r === branch.r && chosenAtBranch.c === branch.c),
      chosenAtBranch,
      won: !!(ps && ps.won),
      progress: ps && ps.progress,
      completedBoxes: ps && ps.completedBoxes,
      totalBoxes: ps && ps.totalBoxes,
      picks: ps && ps.picks,
      bufferPeak: ps && ps.bufferPeak,
      playerAvgBuffer: ps && ps.playerAvgBuffer,
      event,
      release: releaseAfterBranch(ps, event),
      line,
      pickOrder,
      elapsedMs: Date.now() - t0
    };
    rows.push(rec);
    console.log('[v600]', seed, branch.id,
      'applied=' + rec.forcedApplied,
      'won=' + rec.won,
      'coverage=' + rec.progress,
      'branchBuf=' + (event && event.bufferAfter),
      'peak=' + rec.bufferPeak,
      'r9=' + line.r9,
      'early=' + line.early34Pct,
      'releaseAfter=' + (rec.release && rec.release.picksAfter),
      'ms=' + rec.elapsedMs);
  }
}

const pairs = [];
for (const seed of SEEDS) {
  const a = rows.find(x => x.seed === seed && x.branch === 'A_full');
  const b = rows.find(x => x.seed === seed && x.branch === 'B_debt3');
  const conv = sameStepConvergence(a ? a.pickOrder : [], b ? b.pickOrder : []);
  pairs.push({
    seed,
    aWon: a && a.won,
    bWon: b && b.won,
    aProgress: a && a.progress,
    bProgress: b && b.progress,
    aBufferPeak: a && a.bufferPeak,
    bBufferPeak: b && b.bufferPeak,
    bBranchBuffer: b && b.event && b.event.bufferAfter,
    bReleaseAfterPicks: b && b.release && b.release.picksAfter,
    aR9: a && a.line.r9,
    bR9: b && b.line.r9,
    firstDifferenceStep: conv.firstDifference,
    convergedAt: conv.convergedAt
  });
}

for (const rec of rows) delete rec.pickOrder;
const report = {
  schema: 'step7-branch-ab-v600',
  date: '2026-10-27',
  levelId: LEVEL_ID,
  base: path.relative(ROOT, BASE_LEVEL),
  forceIndex: FORCE_INDEX,
  sourceWindow,
  seeds: SEEDS,
  summary: {
    runs: rows.length,
    applied: rows.filter(x => x.forcedApplied).length,
    aWon: rows.filter(x => x.branch === 'A_full' && x.won).length,
    bWon: rows.filter(x => x.branch === 'B_debt3' && x.won).length,
    bBufferResponded: rows.filter(x => x.branch === 'B_debt3' &&
      x.event && x.event.bufferAfter > 0).length,
    bReleased: rows.filter(x => x.branch === 'B_debt3' && x.release).length,
    bHasLaterDebtWindow: rows.filter(x => x.branch === 'B_debt3' &&
      x.line.debtWindows.some(w => w.step > FORCE_INDEX + 1)).length,
    pairs
  },
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
