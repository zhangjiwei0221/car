#!/usr/bin/env node
/** v581：在v580 v4基底上，逐个冻结一辆干扰供给，观察真实债务。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '真实债务单锚点_v580.levels', 'v4_25_22_6_2.json');
const BASE_ROUTE = path.join(__dirname, '真实债务单锚点_v580.levels', 'v4_25_22_6_2.route.json');
const OUT = path.join(__dirname, '单供给数字冰_v581.json');
const LEVEL_DIR = path.join(__dirname, '单供给数字冰_v581.levels');
const DEBT_TARGET = { r: 5, c: 0 };
const ICE_STEP = 23;
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
const baseRoute = JSON.parse(fs.readFileSync(BASE_ROUTE, 'utf8'));

function configForEval() {
  return {
    seed: 1001, ruleMode: 'instantChain', instantChain: true, bottomOnly: false,
    elimOrder: 'instant', boxSizeMin: 6, boxSizeMax: 40,
    capNormMin: 6, capNormMax: 40, boardRowsMin: 7, boardRowsMax: 7,
    boardColsMin: 7, boardColsMax: 7, boardHardRange: true, boardAuto: false,
    p7Repair: false, trapPost: false, localSwapRepair: false,
    experienceGoal: false, maxDecisionStates: 8, stateSampleMode: 'midStratified',
    minReleaseAmplitude: 2
  };
}

function leftmostFreeSlot(s) {
  const used = {};
  for (const b of s.buffer || []) if (b.slot != null) used[b.slot] = 1;
  for (let i = 0; i < s.bufferLimit; i++) if (!used[i]) return i;
  return -1;
}
function slotStartCoord(slot, rows, cols, bufferLimit) {
  return { r: rows - 1, c: Math.min(cols - 1, Math.floor(slot / bufferLimit * cols)) };
}
function reachablePixels(state, color, blocks) {
  const slot = leftmostFreeSlot(state);
  if (slot < 0) return null;
  const start = slotStartCoord(slot, state.rows, state.cols, state.bufferLimit);
  const scratch = state.eliminated.map(row => row.slice());
  try {
    return A.Simulator.instantChainEliminate(
      scratch, blocks, state.rows, state.cols, color, Infinity, null, start, null
    );
  } catch (e) { return null; }
}

function diagnoseDebtOpportunity(level, route) {
  const parsed = A.parseLevel(level);
  const state = A.Simulator.createState(parsed, {
    useSlotStart: true, bottomOnly: false, instantChain: true, capturePreviewStats: false
  });
  const actions = A.SolverAnalysis.normalizeActions(route);
  for (let i = 0; i < actions.length; i++) {
    const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    const moves = A.Simulator.listMoves(state).filter(m => !m.blocked);
    const options = moves.map(m => {
      const color = m.antBox ? m.antBox.color : m.color;
      const cap = m.antBox ? m.antBox.count : m.count;
      const reach = reachablePixels(state, color, level.blocks);
      return { r: m.r, c: m.c, color, cap, reach, debt: reach == null ? null : cap - reach, canConsume: !!m.canConsume };
    });
    const debts = options.filter(o => o.debt >= 2 && o.debt <= 4 && !o.canConsume && progress >= 0.2 && progress <= 0.8);
    if (!debts.length) { A.Simulator.applyPick(state, actions[i].r, actions[i].c); continue; }
    const chosen = options.find(o => o.r === actions[i].r && o.c === actions[i].c);
    const full = options.filter(o => o.canConsume).sort((a, b) => b.cap - a.cap || a.r - b.r || a.c - b.c);
    return { step: i + 1, progress: +progress.toFixed(4), buffer: state.buffer.length, debts, chosen, full };
  }
  return null;
}

function trackedCellAudit(level, solveResult, coord, blocks) {
  const state = A.Simulator.createState(A.parseLevel(level), {
    useSlotStart: true, bottomOnly: false, instantChain: true, capturePreviewStats: false
  });
  const actions = A.SolverAnalysis.normalizeActions(solveResult && solveResult.pickOrder);
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.r === coord.r && a.c === coord.c) {
      const cell = state.cells[a.r] && state.cells[a.r][a.c];
      const reach = cell && cell.t === 'box' ? reachablePixels(state, cell.color, blocks) : null;
      const before = state.buffer.length;
      A.Simulator.applyPick(state, a.r, a.c);
      return {
        step: i + 1, r: a.r, c: a.c, color: cell && cell.color, capacity: cell && cell.count,
        actualReach: reach, actualDebt: cell && reach != null ? cell.count - reach : null,
        bufferBefore: before, bufferAfter: state.buffer.length,
        progressBefore: state.totalPixels ? +(state.eliminatedPixels / state.totalPixels).toFixed(4) : null
      };
    }
    A.Simulator.applyPick(state, a.r, a.c);
  }
  return null;
}

function evaluate(id, level, iceCell, diagnostic) {
  const cfg = configForEval();
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
  const debtAudit = ev && ev.valid ? trackedCellAudit(ev.level, ev.solveResult, DEBT_TARGET, ev.level.blocks) : null;
  const iceAudit = ev && ev.valid ? trackedCellAudit(ev.level, ev.solveResult, iceCell, ev.level.blocks) : null;
  const rec = {
    id, iceCell, valid: !!(ev && ev.valid), diagnostic, debtAudit, iceAudit,
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
    elapsedMs: Date.now() - t0, level: ev && ev.level || null, solveResult: ev && ev.solveResult || null
  };
  console.log('[v581]', id, 'valid=' + rec.valid,
    'debtPicked=' + !!debtAudit,
    'debt=' + (debtAudit && debtAudit.actualDebt),
    'bufferAfter=' + (debtAudit && debtAudit.bufferAfter),
    'freeLow=' + (curve && curve.freeLowPct),
    'freeRun=' + (curve && curve.freeRunMax),
    'qGate=' + (q && q.gatePass),
    'ms=' + rec.elapsedMs);
  if (rec.level) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    fs.writeFileSync(path.join(LEVEL_DIR, id + '.json'), JSON.stringify(rec.level, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, id + '.route.json'),
      JSON.stringify(rec.solveResult && rec.solveResult.pickOrder || [], null, 2) + '\n');
  }
  return rec;
}

function withIce(source, cell, value) {
  const lv = A.deepClone(source);
  const x = lv.board.cells[cell.r] && lv.board.cells[cell.r][cell.c];
  if (!x || x.t !== 'box') return null;
  x.numice = value;
  return lv;
}

const diagnostic = diagnoseDebtOpportunity(base, baseRoute);
if (!diagnostic || !diagnostic.debts.some(x => x.r === DEBT_TARGET.r && x.c === DEBT_TARGET.c)) {
  throw new Error('v581 debt target is not reproducible');
}
const freezeCells = [];
if (diagnostic.chosen) freezeCells.push({ id: 'chosen', r: diagnostic.chosen.r, c: diagnostic.chosen.c });
for (let i = 0; i < Math.min(3, diagnostic.full.length); i++) {
  freezeCells.push({ id: 'full' + (i + 1), r: diagnostic.full[i].r, c: diagnostic.full[i].c });
}
const variants = [];
for (const fc of freezeCells) {
  const lv = withIce(base, fc, ICE_STEP);
  if (!lv) continue;
  variants.push(evaluate(fc.id, lv, fc, diagnostic));
}
const reportRows = variants.map(v => Object.assign({}, v, { level: undefined, solveResult: undefined }));
const report = {
  schema: 'single-supply-ice-v581', date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL), iceStep: ICE_STEP,
  debtTarget: DEBT_TARGET, diagnostic, variants: reportRows,
  summary: {
    variants: variants.length,
    debtPicked: variants.filter(x => !!x.debtAudit).length,
    debt2to4: variants.filter(x => x.debtAudit && x.debtAudit.actualDebt >= 2 && x.debtAudit.actualDebt <= 4).length,
    buffer3: variants.filter(x => x.debtAudit && x.debtAudit.bufferAfter >= 3).length,
    qGate: variants.filter(x => x.quality && x.quality.gatePass).length,
    experience: variants.filter(x => x.experience && x.experience.pass).length
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
