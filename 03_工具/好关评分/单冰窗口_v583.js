#!/usr/bin/env node
/** v583：只冻结v4路线第28步唯一的完全供给，测试两笔债务是否同时保留。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '真实债务单锚点_v580.levels', 'v4_25_22_6_2.json');
const ICE_VALUE = Number(process.env.ICE_VALUE || 29);
const EXTRA_ICE_CELLS = process.env.EXTRA_ICE_CELLS
  ? process.env.EXTRA_ICE_CELLS.split(';').map(x => x.split(',').map(Number))
  : (process.env.EXTRA_ICE_CELL ? [process.env.EXTRA_ICE_CELL.split(',').map(Number)] : []);
const EXTRA_ICE = EXTRA_ICE_CELLS[0] || null;
const EXTRA_VALUE = Number(process.env.EXTRA_ICE_VALUE || 0);
const OUT = path.join(__dirname, EXTRA_ICE_CELLS.length
  ? (EXTRA_ICE_CELLS.length > 1 ? '双供给双冰_v586.json'
    : '双定时冰_v585_' + EXTRA_ICE[0] + '_' + EXTRA_ICE[1] + '.json')
  : (ICE_VALUE === 29 ? '单冰窗口_v583.json' : '单冰时长_v584_' + ICE_VALUE + '.json'));
const LEVEL_DIR = path.join(__dirname, EXTRA_ICE_CELLS.length ? (EXTRA_ICE_CELLS.length > 1 ? '双供给双冰_v586.levels' : '双定时冰_v585.levels')
  : (ICE_VALUE === 29 ? '单冰窗口_v583.levels' : '单冰时长_v584.levels'));
const ICE_CELL = { r: 4, c: 3 };
const TARGETS = [{ r: 3, c: 6 }, { r: 5, c: 2 }];
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
const base = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
const level = A.deepClone(base);
const iceBox = level.board.cells[ICE_CELL.r] && level.board.cells[ICE_CELL.r][ICE_CELL.c];
if (!iceBox || iceBox.t !== 'box') throw new Error('v583 ice target is not a box');
iceBox.numice = ICE_VALUE;
for (const c of EXTRA_ICE_CELLS) {
  const extra = level.board.cells[c[0]] && level.board.cells[c[0]][c[1]];
  if (!extra || extra.t !== 'box') throw new Error('extra ice target is not a box');
  extra.numice = EXTRA_VALUE;
}

function leftmostFreeSlot(s) {
  const used = {};
  for (const b of s.buffer || []) if (b.slot != null) used[b.slot] = 1;
  return -1;
}
function slotStartCoord(slot, rows, cols, bufferLimit) {
  return { r: rows - 1, c: Math.min(cols - 1, Math.floor(slot / bufferLimit * cols)) };
}
function reachablePixels(state, color) {
  const slot = leftmostFreeSlot(state);
  if (slot < 0) return null;
  const start = slotStartCoord(slot, state.rows, state.cols, state.bufferLimit);
  const scratch = state.eliminated.map(row => row.slice());
  try {
    return A.Simulator.instantChainEliminate(
      scratch, level.blocks, state.rows, state.cols, color, Infinity, null, start, null
    );
  } catch (e) { return null; }
}
function auditCells(solveResult) {
  const parsed = A.parseLevel(level);
  const state = A.Simulator.createState(parsed, {
    useSlotStart: true, bottomOnly: false, instantChain: true, capturePreviewStats: false
  });
  const actions = A.SolverAnalysis.normalizeActions(solveResult && solveResult.pickOrder);
  const watch = {};
  for (const t of TARGETS) watch[t.r + ',' + t.c] = 'debt';
  watch[ICE_CELL.r + ',' + ICE_CELL.c] = 'ice';
  for (const c of EXTRA_ICE_CELLS) watch[c[0] + ',' + c[1]] = 'extraIce';
  const seen = {}, out = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i], k = a.r + ',' + a.c;
    if (watch[k] && !seen[k]) {
      seen[k] = 1;
      const cell = state.cells[a.r] && state.cells[a.r][a.c];
      const reach = cell && cell.t === 'box' ? reachablePixels(state, cell.color) : null;
      const before = state.buffer.length;
      A.Simulator.applyPick(state, a.r, a.c);
      out.push({
        role: watch[k], step: i + 1, r: a.r, c: a.c, color: cell && cell.color,
        capacity: cell && cell.count, actualReach: reach,
        actualDebt: cell && reach != null ? cell.count - reach : null,
        bufferBefore: before, bufferAfter: state.buffer.length,
        progressBefore: state.totalPixels ? +(state.eliminatedPixels / state.totalPixels).toFixed(4) : null
      });
    } else {
      A.Simulator.applyPick(state, a.r, a.c);
    }
  }
  return out;
}

const cfg = {
  seed: 1001, ruleMode: 'instantChain', instantChain: true, bottomOnly: false, elimOrder: 'instant',
  boxSizeMin: 6, boxSizeMax: 40, capNormMin: 6, capNormMax: 40,
  boardRowsMin: 7, boardRowsMax: 7, boardColsMin: 7, boardColsMax: 7,
  boardHardRange: true, boardAuto: false, p7Repair: false, trapPost: false,
  localSwapRepair: false, experienceGoal: false, maxDecisionStates: 8,
  stateSampleMode: 'midStratified', minReleaseAmplitude: 2
};
const t0 = Date.now();
const ev = A.Generator.evaluateLevel(level, cfg);
const q = ev && ev.valid ? A.Quality.fromGeneration(ev) : null;
const curve = ev && ev.goodV3 && ev.goodV3.fillCurve || null;
let exp = null;
if (ev && ev.valid && ev.solveResult) {
  try {
    exp = A.ExperienceGoal.evaluate(ev.level, {
      solveResult: ev.solveResult, decision: true, instantChain: true,
      maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
    });
  } catch (e) { exp = { error: String(e && e.message || e) }; }
}
const watches = ev && ev.valid ? auditCells(ev.solveResult) : [];
const record = {
  schema: 'single-ice-window-v583', date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL), iceCell: ICE_CELL, iceValue: ICE_VALUE,
  extraIce: EXTRA_ICE ? { r: EXTRA_ICE[0], c: EXTRA_ICE[1], value: EXTRA_VALUE } : null,
  extraIces: EXTRA_ICE_CELLS.map(c => ({ r: c[0], c: c[1], value: EXTRA_VALUE })),
  targets: TARGETS, valid: !!(ev && ev.valid), watches,
  quality: q ? { gatePass: !!q.gatePass, gateReasons: q.gateReasons || [], pass: !!q.pass, label: q.label } : null,
  curve: curve ? {
    freeLowPct: curve.freeLowPct, freeRunMax: curve.freeRunMax,
    fullMedian2: curve.fullMedian2, selectMedian: curve.selectMedian,
    pressurePct3: curve.pressurePct3, pressurePeak: curve.pressurePeak
  } : null,
  experience: exp ? {
    pass: !!exp.pass, curvePass: !!exp.curvePass,
    metrics: exp.metrics || null, releaseDecision: exp.releaseDecision || null
  } : null,
  elapsedMs: Date.now() - t0
};
if (ev && ev.level) {
  fs.mkdirSync(LEVEL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LEVEL_DIR, 'ice_4_3.json'), JSON.stringify(ev.level, null, 2) + '\n');
  fs.writeFileSync(path.join(LEVEL_DIR, 'ice_4_3.route.json'),
    JSON.stringify(ev.solveResult && ev.solveResult.pickOrder || [], null, 2) + '\n');
}
fs.writeFileSync(OUT, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({
  out: path.relative(ROOT, OUT), valid: record.valid, watches,
  quality: record.quality, curve: record.curve,
  maxBuffer: record.experience && record.experience.metrics && record.experience.metrics.maxBuffer
}, null, 2));
