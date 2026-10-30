#!/usr/bin/env node
/** v582：统计v580 v4路线中，单冰可影响的真实债务窗口及其buffer上限。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const LEVEL = path.join(__dirname, '真实债务单锚点_v580.levels', 'v4_25_22_6_2.json');
const ROUTE = path.join(__dirname, '真实债务单锚点_v580.levels', 'v4_25_22_6_2.route.json');
const OUT = path.join(__dirname, '单冰窗口扫描_v582.json');
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

const A = load();
const raw = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
const route = JSON.parse(fs.readFileSync(ROUTE, 'utf8'));
const level = A.parseLevel(raw);
const blocks = raw.blocks;
const state = A.Simulator.createState(level, {
  useSlotStart: true, bottomOnly: false, instantChain: true, capturePreviewStats: false
});
const actions = A.SolverAnalysis.normalizeActions(route);

function leftmostFreeSlot(s) {
  const used = {};
  for (const b of s.buffer || []) if (b.slot != null) used[b.slot] = 1;
  for (let i = 0; i < s.bufferLimit; i++) if (!used[i]) return i;
  return -1;
}
function slotStartCoord(slot, rows, cols, bufferLimit) {
  return { r: rows - 1, c: Math.min(cols - 1, Math.floor(slot / bufferLimit * cols)) };
}
function reach(s, color) {
  const slot = leftmostFreeSlot(s);
  if (slot < 0) return null;
  const start = slotStartCoord(slot, s.rows, s.cols, s.bufferLimit);
  const scratch = s.eliminated.map(row => row.slice());
  try {
    return A.Simulator.instantChainEliminate(
      scratch, blocks, s.rows, s.cols, color, Infinity, null, start, null
    );
  } catch (e) { return null; }
}

const windows = [];
for (let i = 0; i < actions.length; i++) {
  const a = actions[i];
  const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
  const moves = A.Simulator.listMoves(state).filter(m => !m.blocked);
  const options = moves.map(m => {
    const color = m.antBox ? m.antBox.color : m.color;
    const cap = m.antBox ? m.antBox.count : m.count;
    const actualReach = reach(state, color);
    return { r: m.r, c: m.c, color, capacity: cap, actualReach,
      actualDebt: actualReach == null ? null : cap - actualReach, canConsume: !!m.canConsume };
  });
  const debts = options.filter(o => o.actualDebt >= 2 && o.actualDebt <= 4 &&
    !o.canConsume && progress >= 0.2 && progress <= 0.8);
  if (debts.length) {
    const full = options.filter(o => o.canConsume);
    windows.push({
      step: i + 1, progress: +progress.toFixed(4), bufferBefore: state.buffer.length,
      fullSupplyCount: full.length, debts, chosen: options.find(o => o.r === a.r && o.c === a.c), fullSupply: full,
      singleIceBufferCeiling: state.buffer.length + 1
    });
  }
  A.Simulator.applyPick(state, a.r, a.c);
}

const singleIceWindows = windows.filter(w => w.fullSupplyCount <= 1);
const report = {
  schema: 'single-ice-window-scan-v582', date: '2026-10-27',
  base: path.relative(ROOT, LEVEL),
  windows,
  summary: {
    debtWindows: windows.length,
    minFullSupplyCount: windows.length ? Math.min(...windows.map(w => w.fullSupplyCount)) : null,
    singleIceWindows: singleIceWindows.length,
    singleIceBufferCeiling: singleIceWindows.length
      ? Math.max(...singleIceWindows.map(w => w.singleIceBufferCeiling))
      : null,
    canReachBuffer3: singleIceWindows.some(w => w.singleIceBufferCeiling >= 3)
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary, singleIceWindows }, null, 2));
