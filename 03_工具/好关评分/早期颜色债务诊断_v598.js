#!/usr/bin/env node
/** v598：诊断v594基底为何无法仅靠早期车序形成2～4档真实债务。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '短债单车交换_第五轮_v594.levels', '3_0__3_3.json');
const BASE_ROUTE = path.join(__dirname, '短债单车交换_第五轮_v594.levels', '3_0__3_3.route.json');
const OUT = path.join(__dirname, '早期颜色债务诊断_v598.json');
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
const route = JSON.parse(fs.readFileSync(BASE_ROUTE, 'utf8'));
const parsed = A.parseLevel(raw);
const cells = [];
for (let r = 0; r < parsed.board.rows; r++) {
  for (let c = 0; c < parsed.board.cols; c++) {
    const cell = parsed.board.cells[r][c];
    if (cell && cell.t === 'box') cells.push({ r, c, color: cell.color, count: cell.count });
  }
}

function reachAt(eliminated, color, slot) {
  const start = {
    r: parsed.rows - 1,
    c: Math.min(parsed.cols - 1, Math.floor(slot / parsed.bufferLimit * parsed.cols))
  };
  return S.instantChainEliminate(
    eliminated.map(row => row.slice()),
    parsed.blocks,
    parsed.rows,
    parsed.cols,
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

const colors = {};
for (const cell of cells) {
  const entry = colors[cell.color] || (colors[cell.color] = {
    color: cell.color,
    cars: [],
    total: 0
  });
  entry.cars.push(cell);
  entry.total += cell.count;
}

const initial = S.createState(parsed, {
  useSlotStart: true, bottomOnly: false, instantChain: true
});
const colorRows = Object.values(colors).map(entry => {
  const capMin = Math.min(...entry.cars.map(x => x.count));
  const capMax = Math.max(...entry.cars.map(x => x.count));
  const initialReach = reachAt(initial.eliminated, entry.color, 0);
  const debts = entry.cars.map(x => x.count - initialReach);
  const feasibleSmallDebtCaps = [];
  for (let cap = 6; cap <= 40; cap++) {
    const debt = cap - initialReach;
    if (debt >= 2 && debt <= 4) {
      const left = entry.total - cap;
      const otherCars = entry.cars.length - 1;
      if (otherCars === 0 ? left === 0 : left >= otherCars * 6 && left <= otherCars * 40) {
        feasibleSmallDebtCaps.push(cap);
      }
    }
  }
  return {
    color: entry.color,
    cars: entry.cars.length,
    total: entry.total,
    capMin,
    capMax,
    initialReach,
    currentDebts: debts,
    currentDebtMin: Math.min(...debts),
    currentDebtMax: Math.max(...debts),
    feasibleSmallDebtCaps
  };
});
colorRows.sort((a, b) => a.color - b.color);

const state = S.createState(parsed, {
  useSlotStart: true, bottomOnly: false, instantChain: true
});
const actions = A.SolverAnalysis.normalizeActions(route);
const earlySteps = [];
let step = 0;
while (step < actions.length) {
  const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
  if (progress >= 0.30) break;
  const moves = S.listMoves(state).filter(m => !m.blocked);
  const slot = leftmostFreeSlot(state);
  const options = moves.map(m => {
    const cell = state.cells[m.r][m.c];
    const reach = reachAt(state.eliminated, cell.color, slot);
    return {
      r: m.r, c: m.c, color: cell.color, capacity: cell.count,
      reach, debt: cell.count - reach, canConsume: !!m.canConsume
    };
  });
  const full = options.filter(x => x.canConsume);
  const smallDebt = options.filter(x => x.debt >= 2 && x.debt <= 4);
  earlySteps.push({
    step: step + 1,
    progress: +progress.toFixed(4),
    buffer: state.buffer.length,
    optionCount: options.length,
    fullCount: full.length,
    full,
    smallDebt
  });
  S.applyPick(state, actions[step].r, actions[step].c);
  step++;
}

const initialSmallDebt = colorRows.filter(x => x.feasibleSmallDebtCaps.length > 0);
const report = {
  schema: 'early-color-debt-diagnosis-v598',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  baseRoute: path.relative(ROOT, BASE_ROUTE),
  summary: {
    colors: colorRows.length,
    initialSmallDebtColors: initialSmallDebt.map(x => x.color),
    initialSmallDebtColorCount: initialSmallDebt.length,
    earlySteps: earlySteps.length,
    stepsWithSmallDebt: earlySteps.filter(x => x.smallDebt.length > 0).length,
    stepsWithSingleFullAndSmallDebt: earlySteps.filter(x =>
      x.fullCount === 1 && x.smallDebt.length > 0).length,
    stepsWithMultipleFull: earlySteps.filter(x => x.fullCount >= 2).length,
    maxFullCount: Math.max(...earlySteps.map(x => x.fullCount)),
    conclusion: initialSmallDebt.length === 0
      ? '开局不存在可通过现有颜色与容量组合形成的2～4档债务；只换车序不能制造温和前期债务。'
      : '存在开局2～4档债务颜色，可继续做车序实验。'
  },
  colors: colorRows,
  earlySteps
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  out: path.relative(ROOT, OUT),
  summary: report.summary,
  colors: colorRows.map(x => ({
    color: x.color,
    initialReach: x.initialReach,
    cap: x.capMin + '~' + x.capMax,
    debt: x.currentDebtMin + '~' + x.currentDebtMax,
    smallDebtCaps: x.feasibleSmallDebtCaps
  })),
  early: earlySteps.map(x => ({
    step: x.step,
    progress: x.progress,
    full: x.full.length,
    smallDebt: x.smallDebt.map(y => ({
      color: y.color, r: y.r, c: y.c, debt: y.debt
    }))
  }))
}, null, 2));
