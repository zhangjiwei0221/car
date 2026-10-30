#!/usr/bin/env node
/** v580：从真实路线选择单辆债务2~4的车，与固定闸门格交换后重解。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '棋盘供时闸门_v579.levels', 'A_row1_gate_1001.json');
const BASE_ROUTE = path.join(__dirname, '棋盘供时闸门_v579.levels', 'A_row1_gate_1001.route.json');
const OUT = path.join(__dirname, '真实债务单锚点_v580.json');
const LEVEL_DIR = path.join(__dirname, '真实债务单锚点_v580.levels');
const TARGET = { r: 1, c: 3 };
const MAX_VARIANTS = Number(process.env.MAX_VARIANTS || 5);
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
const baseRaw = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
const baseRoute = JSON.parse(fs.readFileSync(BASE_ROUTE, 'utf8'));

function configForEval() {
  return {
    seed: 1001,
    ruleMode: 'instantChain',
    instantChain: true,
    bottomOnly: false,
    elimOrder: 'instant',
    boxSizeMin: 6,
    boxSizeMax: 40,
    capNormMin: 6,
    capNormMax: 40,
    boardRowsMin: 7, boardRowsMax: 7,
    boardColsMin: 7, boardColsMax: 7,
    boardHardRange: true,
    boardAuto: false,
    p7Repair: false,
    trapPost: false,
    localSwapRepair: false,
    experienceGoal: false,
    timeBudgetMs: 30000,
    maxDecisionStates: 8,
    stateSampleMode: 'midStratified',
    minReleaseAmplitude: 2
  };
}

function leftmostFreeSlot(s) {
  const used = {};
  for (const item of s.buffer || []) if (item.slot != null) used[item.slot] = 1;
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

function scanDebtCandidates(level, route) {
  const parsed = A.parseLevel(level);
  const state = A.Simulator.createState(parsed, {
    useSlotStart: true, bottomOnly: false, instantChain: true, capturePreviewStats: false
  });
  const actions = A.SolverAnalysis.normalizeActions(route);
  const candidates = [], seen = {};
  for (let i = 0; i < actions.length; i++) {
    const moves = A.Simulator.listMoves(state).filter(m => !m.blocked);
    for (const m of moves) {
      const color = m.antBox ? m.antBox.color : m.color;
      const cap = m.antBox ? m.antBox.count : m.count;
      const reach = reachablePixels(state, color, level.blocks);
      const debt = reach == null ? null : cap - reach;
      const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
      const key = m.r + ',' + m.c + ',' + color + ',' + cap;
      if (debt >= 2 && debt <= 4 && !m.canConsume && progress >= 0.2 && progress <= 0.8 && !seen[key]) {
        seen[key] = 1;
        candidates.push({
          step: i + 1, progress: +progress.toFixed(4),
          r: m.r, c: m.c, color, capacity: cap, actualReach: reach,
          actualDebt: debt, canConsume: false, buffer: state.buffer.length
        });
      }
    }
    A.Simulator.applyPick(state, actions[i].r, actions[i].c);
  }
  const byCell = {};
  for (const c of candidates) {
    const k = c.r + ',' + c.c;
    if (!byCell[k] || c.step < byCell[k].step) byCell[k] = c;
  }
  return Object.keys(byCell).map(k => byCell[k]).sort((a, b) =>
    (b.capacity === 40 ? 1 : 0) - (a.capacity === 40 ? 1 : 0) ||
    a.progress - b.progress || a.step - b.step
  );
}

function trackedAnchorAudit(level, solveResult, target, blocks) {
  if (!solveResult || !solveResult.pickOrder) return null;
  const parsed = A.parseLevel(level);
  const state = A.Simulator.createState(parsed, {
    useSlotStart: true, bottomOnly: false, instantChain: true, capturePreviewStats: false
  });
  const actions = A.SolverAnalysis.normalizeActions(solveResult.pickOrder);
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.r === target.r && a.c === target.c) {
      const cell = state.cells[a.r] && state.cells[a.r][a.c];
      const actualReach = cell && cell.t === 'box' ? reachablePixels(state, cell.color, blocks) : null;
      const before = state.buffer.length;
      A.Simulator.applyPick(state, a.r, a.c);
      return {
        step: i + 1, pickIndex: i, r: a.r, c: a.c,
        color: cell && cell.color, capacity: cell && cell.count,
        actualReach, actualDebt: cell && actualReach != null ? cell.count - actualReach : null,
        bufferBefore: before, bufferAfter: state.buffer.length,
        progressBefore: state.totalPixels ? +(state.eliminatedPixels / state.totalPixels).toFixed(4) : null
      };
    }
    A.Simulator.applyPick(state, a.r, a.c);
  }
  return null;
}

function evaluateVariant(id, level, sourceCandidate) {
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
  const audit = ev && ev.valid ? trackedAnchorAudit(ev.level, ev.solveResult, TARGET, ev.level.blocks) : null;
  return {
    id, sourceCandidate, valid: !!(ev && ev.valid), target: TARGET, audit,
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
    level: ev && ev.level || null,
    solveResult: ev && ev.solveResult || null,
    elapsedMs: Date.now() - t0
  };
}

function swapCells(level, a, b) {
  const lv = A.deepClone(level);
  const x = lv.board.cells[a.r][a.c], y = lv.board.cells[b.r][b.c];
  if (!x || x.t !== 'box' || !y || y.t !== 'box') return null;
  lv.board.cells[a.r][a.c] = y;
  lv.board.cells[b.r][b.c] = x;
  return lv;
}

const candidates = scanDebtCandidates(baseRaw, baseRoute);
const variants = [];
for (let i = 0; i < Math.min(MAX_VARIANTS, candidates.length); i++) {
  const c = candidates[i];
  const lv = swapCells(baseRaw, { r: c.r, c: c.c }, TARGET);
  if (!lv) continue;
  const rec = evaluateVariant('v' + (i + 1) + '_' + c.color + '_' + c.capacity + '_' + c.r + '_' + c.c, lv, c);
  variants.push(rec);
  console.log('[v580]', rec.id, 'valid=' + rec.valid,
    'auditDebt=' + (rec.audit && rec.audit.actualDebt),
    'bufferAfter=' + (rec.audit && rec.audit.bufferAfter),
    'freeLow=' + (rec.curve && rec.curve.freeLowPct),
    'freeRun=' + (rec.curve && rec.curve.freeRunMax),
    'qGate=' + (rec.quality && rec.quality.gatePass),
    'ms=' + rec.elapsedMs);
  if (rec.level) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    fs.writeFileSync(path.join(LEVEL_DIR, rec.id + '.json'), JSON.stringify(rec.level, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, rec.id + '.route.json'),
      JSON.stringify(rec.solveResult && rec.solveResult.pickOrder || [], null, 2) + '\n');
  }
}

const reportVariants = variants.map(v => Object.assign({}, v, { level: undefined, solveResult: undefined }));
const report = {
  schema: 'real-debt-single-anchor-v580', date: '2026-10-27',
  target: TARGET, candidates, variants: reportVariants,
  summary: {
    candidates: candidates.length,
    variants: variants.length,
    targetDebt2to4: variants.filter(x => x.audit && x.audit.actualDebt >= 2 && x.audit.actualDebt <= 4).length,
    buffer3: variants.filter(x => x.audit && x.audit.bufferAfter >= 3).length,
    qGate: variants.filter(x => x.quality && x.quality.gatePass).length,
    experience: variants.filter(x => x.experience && x.experience.pass).length
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
