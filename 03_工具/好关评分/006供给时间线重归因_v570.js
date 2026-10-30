#!/usr/bin/env node
/** v570 P2d：只读比较 shortDebt / targetBuffer4 / targetBuffer3 的供给与债务时间线。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const OUT = path.join(__dirname, '006供给时间线重归因_v570.json');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const OPTIONS = { instantChain: true, bottomOnly: false };
const CASES = [
  {
    id: 'shortDebt',
    policy: 'shortDebt',
    targetBuffer: 4,
    dir: '006策略对照_v570.levels',
    stem: 'shortDebt_r1'
  },
  {
    id: 'targetBuffer4',
    policy: 'targetBuffer',
    targetBuffer: 4,
    dir: '006策略对照_v570.levels',
    stem: 'targetBuffer_r1'
  },
  {
    id: 'targetBuffer3',
    policy: 'targetBuffer',
    targetBuffer: 3,
    dir: '006目标缓冲3_v570.levels',
    stem: 'targetBuffer3_r1'
  }
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

function median(values) {
  const a = values.filter(x => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : +((a[m - 1] + a[m]) / 2).toFixed(2);
}

function bufferSnapshot(state) {
  return state.buffer.map(x => ({
    key: x.key,
    color: x.color,
    need: x.need,
    progress: x.progress,
    remaining: Math.max(0, x.need - x.progress),
    enterStep: x.enterStep,
    waitedSteps: state.steps - (x.enterStep || 0),
    slot: x.slot
  }));
}

function cellInfo(level, r, c) {
  const cell = level.board.cells[r] && level.board.cells[r][c];
  return cell ? {
    t: cell.t,
    color: cell.color == null ? null : cell.color,
    count: cell.count == null ? null : cell.count,
    q: !!cell.q,
    numice: cell.numice || 0,
    chain: cell.chain || 0
  } : null;
}

function moveInfo(m) {
  return {
    r: m.r,
    c: m.c,
    color: m.antBox && m.antBox.color,
    count: m.antBox && m.antBox.count,
    canConsume: !!m.canConsume,
    groupSize: m.groupSize || 1,
    blocked: !!m.blocked
  };
}

function stateAt(A, level, actions, count) {
  const Sim = A.Simulator;
  const state = Sim.createState(level, { useSlotStart: true, instantChain: true, bottomOnly: false });
  for (let i = 0; i < count; i++) {
    const a = actions[i];
    if (!a || !Sim.isPickable(state, a.r, a.c)) return null;
    Sim.applyPick(state, a.r, a.c);
    if (state.eliminatedPixels >= state.totalPixels) {
      state.gameWon = true;
      state.gameOver = true;
    }
  }
  return state;
}

function traceRoute(A, level, actions) {
  const Sim = A.Simulator;
  const state = Sim.createState(level, { useSlotStart: true, instantChain: true, bottomOnly: false });
  const rows = [];
  for (let i = 0; i < actions.length; i++) {
    if (state.gameWon || state.gameOver) break;
    const a = actions[i];
    const pickable = Sim.isPickable(state, a.r, a.c);
    const moves = pickable ? Sim.listMoves(state).filter(m => !m.blocked) : [];
    const beforeProgress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    const beforeEliminated = state.eliminatedPixels;
    const before = bufferSnapshot(state);
    const row = {
      actionIndex: i,
      step: i + 1,
      r: a.r,
      c: a.c,
      cell: cellInfo(level, a.r, a.c),
      pickable,
      beforeProgress: +beforeProgress.toFixed(4),
      beforeBuffer: before,
      legalMoves: moves.map(moveInfo),
      routeMove: moves.find(m => m.r === a.r && m.c === a.c) ? moveInfo(moves.find(m => m.r === a.r && m.c === a.c)) : null
    };
    if (!pickable) {
      rows.push(row);
      break;
    }
    Sim.applyPick(state, a.r, a.c);
    if (state.eliminatedPixels >= state.totalPixels) {
      state.gameWon = true;
      state.gameOver = true;
    }
    const after = bufferSnapshot(state), last = state.lastPick || {};
    row.afterProgress = +(state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0).toFixed(4);
    row.afterBuffer = after;
    row.afterBufferCount = after.length;
    row.immediateEliminated = state.eliminatedPixels - beforeEliminated;
    row.enteredKeys = after.filter(x => !before.some(y => y.key === x.key)).map(x => x.key);
    row.releasedKeys = before.filter(x => !after.some(y => y.key === x.key)).map(x => x.key);
    row.lastPick = {
      boxes: last.boxes || 0,
      bufBefore: last.bufBefore,
      bufEnter: last.bufEnter,
      bufAfter: last.bufAfter,
      isChain: !!last.isChain,
      picked: last.picked || []
    };
    row.inMid = row.afterProgress >= 0.2 && row.afterProgress <= 0.85;
    rows.push(row);
  }
  return {
    completed: !!state.gameWon,
    steps: rows.length,
    rows
  };
}

function lowWindows(rows) {
  const low = rows.filter(x => x.inMid && x.afterBufferCount < 3);
  const out = [];
  let cur = null;
  for (const row of low) {
    if (!cur || row.actionIndex !== cur.endActionIndex + 1) {
      cur = {
        startActionIndex: row.actionIndex,
        endActionIndex: row.actionIndex,
        startStep: row.step,
        endStep: row.step,
        startProgress: row.afterProgress,
        endProgress: row.afterProgress,
        rows: []
      };
      out.push(cur);
    }
    cur.endActionIndex = row.actionIndex;
    cur.endStep = row.step;
    cur.endProgress = row.afterProgress;
    cur.rows.push(row);
  }
  for (const w of out) {
    w.length = w.rows.length;
    w.legalMoveMedian = median(w.rows.map(x => x.legalMoves.length));
    w.consumableMoveMedian = median(w.rows.map(x =>
      x.legalMoves.filter(m => m.canConsume).length));
  }
  return out;
}

function pressureSummary(rows) {
  const mid = rows.filter(x => x.inMid);
  const dist = {};
  for (const row of mid) dist[row.afterBufferCount] = (dist[row.afterBufferCount] || 0) + 1;
  const pre = rows.filter(x => x.afterProgress != null && x.afterProgress < 0.2);
  return {
    steps: rows.length,
    preMidMaxBuffer: pre.length ? Math.max(...pre.map(x => x.afterBufferCount)) : null,
    midSteps: mid.length,
    mid34: mid.filter(x => x.afterBufferCount === 3 || x.afterBufferCount === 4).length,
    midBuffer34Pct: mid.length
      ? +(mid.filter(x => x.afterBufferCount === 3 || x.afterBufferCount === 4).length / mid.length * 100).toFixed(1)
      : null,
    midDistribution: dist,
    debtEntrySteps: rows.filter(x => x.enteredKeys && x.enteredKeys.length).map(x => ({
      step: x.step,
      progress: x.afterProgress,
      buffer: x.afterBufferCount,
      enteredKeys: x.enteredKeys,
      picked: x.lastPick.picked
    })),
    sameStepCompletedSteps: rows.filter(x => x.lastPick && x.lastPick.picked &&
      x.lastPick.picked.length && (!x.enteredKeys || !x.enteredKeys.length)).map(x => ({
      step: x.step,
      progress: x.afterProgress,
      buffer: x.afterBufferCount,
      picked: x.lastPick.picked,
      immediateEliminated: x.immediateEliminated
    }))
  };
}

function debtEvents(A, level, route) {
  const debt = A.CarSequencer.debtTimeline(level, { pickOrder: route }, OPTIONS);
  if (!debt || !debt.completed) return debt;
  const cars = debt.items.filter(x => x.initialDebt > 0).map(x => ({
    key: x.key,
    color: x.color,
    need: x.need,
    initialDebt: x.initialDebt,
    startStep: x.debtStartStep,
    doneStep: x.doneStep,
    waitSteps: x.doneStep != null ? x.doneStep - x.debtStartStep : null,
    status: x.status,
    source: x.source
  })).sort((a, b) => a.startStep - b.startStep || a.key - b.key);
  return {
    completed: true,
    summary: debt.summary,
    cars,
    activeSeries: debt.series
  };
}

function probeAlternativeActions(A, level, actions, rows) {
  const Sim = A.Simulator;
  const out = [];
  for (const row of rows.filter(x => x.inMid && x.afterBufferCount < 3)) {
    const state = stateAt(A, level, actions, row.actionIndex);
    if (!state) continue;
    const legal = Sim.listMoves(state).filter(m => !m.blocked);
    const successful = [];
    for (const m of legal) {
      const after = A.SolverStrategy.cloneState(state);
      const beforePixels = after.eliminatedPixels;
      Sim.applyPick(after, m.r, m.c);
      if (after.eliminatedPixels >= after.totalPixels) {
        after.gameWon = true;
        after.gameOver = true;
      }
      if (after.gameOver && !after.gameWon) continue;
      if (after.buffer.length < 3) continue;
      const suffix = A.SolverAnalysis.replayFromState(after, actions.slice(row.actionIndex + 1));
      if (!suffix.completed) continue;
      successful.push({
        action: moveInfo(m),
        isReference: m.r === row.r && m.c === row.c,
        afterBuffer: after.buffer.length,
        immediateEliminated: after.eliminatedPixels - beforePixels,
        activeDebt: bufferSnapshot(after),
        suffixSteps: suffix.steps,
        suffixMaxBuffer: suffix.maxBuffer
      });
    }
    if (successful.length) {
      out.push({
        actionIndex: row.actionIndex,
        step: row.step,
        progress: row.beforeProgress,
        referenceBufferAfter: row.afterBufferCount,
        successfulAlternatives: successful
      });
    }
  }
  return out;
}

let A = null;

function main() {
  A = load();
  const results = [];
  for (const c of CASES) {
    const base = path.join(__dirname, c.dir);
    const raw = JSON.parse(fs.readFileSync(path.join(base, c.stem + '.json'), 'utf8'));
    const route = JSON.parse(fs.readFileSync(path.join(base, c.stem + '.route.json'), 'utf8'));
    const level = A.parseLevel(raw);
    const actions = A.SolverAnalysis.normalizeActions(route);
    const trace = traceRoute(A, level, actions);
    const pressure = pressureSummary(trace.rows);
    const debt = debtEvents(A, level, route);
    const windows = lowWindows(trace.rows);
    const probes = probeAlternativeActions(A, level, actions, trace.rows);
    results.push({
      id: c.id,
      policy: c.policy,
      targetBuffer: c.targetBuffer,
      source: {
        level: path.relative(ROOT, path.join(base, c.stem + '.json')),
        route: path.relative(ROOT, path.join(base, c.stem + '.route.json'))
      },
      board: level.board.rows + 'x' + level.board.cols,
      routeCompleted: trace.completed,
      pressure,
      lowWindows: windows.map(w => ({
        startStep: w.startStep,
        endStep: w.endStep,
        startProgress: w.startProgress,
        endProgress: w.endProgress,
        length: w.length,
        legalMoveMedian: w.legalMoveMedian,
        consumableMoveMedian: w.consumableMoveMedian,
        activeDebtByStep: w.rows.map(x => ({
          step: x.step,
          progress: x.afterProgress,
          buffer: x.afterBuffer,
          picked: x.lastPick.picked
        }))
      })),
      debt,
      pressureIncreasingAlternativeStates: probes
    });
    console.log('[timeline]', c.id,
      'route=' + trace.completed,
      'mid=' + pressure.midBuffer34Pct,
      'dist=' + JSON.stringify(pressure.midDistribution),
      'debtCars=' + (debt.summary && debt.summary.debtCars),
      'sameStepSupply=' + pressure.sameStepCompletedSteps.length,
      'pressureAlternatives=' + probes.length);
  }
  const short = results.find(x => x.id === 'shortDebt');
  const t4 = results.find(x => x.id === 'targetBuffer4');
  const t3 = results.find(x => x.id === 'targetBuffer3');
  const shortProbeStates = short.pressureIncreasingAlternativeStates;
  const step23 = short.lowWindows.find(w => w.startStep <= 23 && w.endStep >= 23);
  const report = {
    schema: '006-supply-timeline-reanalysis-v570',
    date: '2026-10-26',
    purpose: '比较三种策略的计划统计、实际债务生命周期、低压力窗口和可保留后缀的替代动作。',
    summary: {
      cases: results.length,
      shortDebt: {
        midBuffer34Pct: short.pressure.midBuffer34Pct,
        midDistribution: short.pressure.midDistribution,
        debtCars: short.debt.summary && short.debt.summary.debtCars,
        maxActiveDebtCars: short.debt.summary && short.debt.summary.maxActiveDebtCars,
        sameStepCompletedPicks: short.pressure.sameStepCompletedSteps.length,
        lowWindowCount: short.lowWindows.length,
        pressureIncreasingAlternativeStates: shortProbeStates.length
      },
      targetBuffer4: {
        midBuffer34Pct: t4.pressure.midBuffer34Pct,
        midDistribution: t4.pressure.midDistribution,
        debtCars: t4.debt.summary && t4.debt.summary.debtCars,
        preMidMaxBuffer: t4.pressure.preMidMaxBuffer,
        sameStepCompletedPicks: t4.pressure.sameStepCompletedSteps.length
      },
      targetBuffer3: {
        midBuffer34Pct: t3.pressure.midBuffer34Pct,
        midDistribution: t3.pressure.midDistribution,
        debtCars: t3.debt.summary && t3.debt.summary.debtCars,
        preMidMaxBuffer: t3.pressure.preMidMaxBuffer,
        sameStepCompletedPicks: t3.pressure.sameStepCompletedSteps.length
      },
      step23LowWindow: step23 || null,
      decision: shortProbeStates.length
        ? 'shortDebt低压力状态存在可保持后缀的替代高压动作；下一轮先预登记其中一个动作，判断是路线选择还是车单供给问题。'
        : 'shortDebt低压力状态未找到可保持完整后缀的替代高压动作；下一轮不得继续随机换车，应修改供给时间线设计。'
    },
    cases: results
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    summary: report.summary,
    pressureAlternativeStates: shortProbeStates.map(x => ({
      step: x.step,
      progress: x.progress,
      referenceBufferAfter: x.referenceBufferAfter,
      alternatives: x.successfulAlternatives.map(a => ({
        action: a.action,
        afterBuffer: a.afterBuffer,
        immediateEliminated: a.immediateEliminated,
        isReference: a.isReference,
        suffixSteps: a.suffixSteps
      }))
    })),
    out: path.relative(ROOT, OUT)
  }, null, 2));
}

main();
