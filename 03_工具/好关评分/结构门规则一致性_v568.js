#!/usr/bin/env node
/** v568：只读比较结构门choiceCurve当前口径与显式instantChain口径。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const LEVEL_DIR = path.join(__dirname, 'M7独立seed留出图_v568.levels');
const OUT = path.join(__dirname, '结构门规则一致性_v568.json');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const SEEDS = [41001, 41002, 41003, 41004];
const IMAGES = ['008', '014'];

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

function median(a) {
  if (!a.length) return null;
  a = a.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

function exposedBlobByColor(eliminated, blocks, rows, cols) {
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const vis = {}, out = [], q = [];
  for (let r0 = 0; r0 < rows; r0++) for (let c0 = 0; c0 < cols; c0++) {
    if (eliminated[r0][c0]) continue;
    const col = blocks[r0][c0];
    if (col <= 0) continue;
    const id0 = r0 * cols + c0;
    if (vis[id0]) continue;
    let reach = r0 === 0 || r0 === rows - 1 || c0 === 0 || c0 === cols - 1;
    if (!reach) for (const d of dirs) {
      const nr = r0 + d[0], nc = c0 + d[1];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || eliminated[nr][nc]) {
        reach = true;
        break;
      }
    }
    if (!reach) continue;
    let n = 0;
    q.length = 0;
    q.push(id0);
    vis[id0] = 1;
    while (q.length) {
      const id = q.pop();
      n++;
      const r = (id / cols) | 0, c = id % cols;
      for (const d of dirs) {
        const nr = r + d[0], nc = c + d[1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const id2 = nr * cols + nc;
        if (vis[id2] || eliminated[nr][nc] || blocks[nr][nc] !== col) continue;
        vis[id2] = 1;
        q.push(id2);
      }
    }
    out[col] = (out[col] || 0) + n;
  }
  return out;
}

function curve(parsed, route, instantChain) {
  const Sim = A.Simulator;
  const actions = A.SolverAnalysis.normalizeActions(route);
  const state = Sim.createState(parsed, { useSlotStart: true, instantChain: !!instantChain });
  const steps = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (!Sim.isPickable(state, a.r, a.c)) break;
    const moves = Sim.listMoves(state).filter(m => !m.blocked);
    const blob = exposedBlobByColor(state.eliminated, state.blocks, state.rows, state.cols);
    const full = moves.filter(m => {
      const color = m.antBox ? m.antBox.color : (m.color || (state.cells[m.r] && state.cells[m.r][m.c] || {}).color);
      const count = m.antBox ? m.antBox.count : (m.count || (state.cells[m.r] && state.cells[m.r][m.c] || {}).count);
      return (blob[color] || 0) >= count;
    }).length;
    const free = state.bufferLimit - state.buffer.length;
    steps.push({
      index: i,
      step: i + 1,
      progress: state.totalBoxes ? +(state.completedBoxes / state.totalBoxes).toFixed(4) : 0,
      full,
      free,
      pick: { r: a.r, c: a.c, color: a.color, count: a.count },
      moves: moves.map(m => ({
        r: m.r,
        c: m.c,
        color: m.antBox ? m.antBox.color : null,
        count: m.antBox ? m.antBox.count : null,
        full: !!m.full
      }))
    });
    Sim.applyPick(state, a.r, a.c);
    if (state.gameOver) break;
  }
  const n = steps.length;
  let freeRun = 0, freeRunMax = 0, freeLow = 0, fulls = [], sels = [], forced = 0, partial = 0, runs = [], run = null;
  for (let i = 0; i < n; i++) {
    const s = steps[i];
    const isFree = s.full >= 2 && s.free >= 3;
    if (s.full >= 2 && s.free >= 4) freeLow++;
    fulls.push(s.full);
    sels.push(s.moves.length);
    if (s.moves.length <= 1) forced++;
    if (s.moves.length - s.full >= 1) partial++;
    if (isFree) {
      freeRun++;
      if (freeRun > freeRunMax) freeRunMax = freeRun;
      if (!run) run = { start: i, end: i, steps: [] };
      run.end = i;
      run.steps.push({ step: s.step, progress: s.progress, full: s.full, free: s.free,
        color: s.pick.color, count: s.pick.count });
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  const curveObj = {
    steps,
    n,
    freeLowPct: n ? Math.round(freeLow / n * 100) : null,
    freeRunMax,
    fullMedian2: median(fulls),
    selectMedian: median(sels),
    forcedPct: n ? Math.round(forced / n * 100) : null,
    partialStepPct: n ? Math.round(partial / n * 100) : null,
    freeRuns: runs.sort((a, b) => b.steps.length - a.steps.length)
  };
  const q = A.Quality.fromGeneration({
    level: parsed,
    valid: n > 0,
    config: { boxSizeMin: 1, boxSizeMax: 999 },
    goodV3: { fillCurve: curveObj, persist: {} }
  });
  return {
    completed: !!state.gameWon,
    steps: n,
    maxBuffer: Math.max(0, ...steps.map(s => parsed.bufferLimit - s.free)),
    metrics: curveObj,
    gatePass: !!q.gatePass,
    gateReasons: q.gateReasons || []
  };
}

let A = null;
function main() {
  A = load();
  const rows = [];
  for (const image of IMAGES) {
    for (const seed of SEEDS) {
      const stem = image + '_' + seed;
      const raw = JSON.parse(fs.readFileSync(path.join(LEVEL_DIR, stem + '.json'), 'utf8'));
      const route = JSON.parse(fs.readFileSync(path.join(LEVEL_DIR, stem + '.route.json'), 'utf8'));
      const parsed = A.parseLevel(raw);
      const legacy = curve(parsed, route, false);
      const instant = curve(parsed, route, true);
      rows.push({
        image,
        seed,
        board: parsed.board.rows + 'x' + parsed.board.cols,
        legacy: {
          completed: legacy.completed,
          steps: legacy.steps,
          gatePass: legacy.gatePass,
          gateReasons: legacy.gateReasons,
          metrics: {
            freeLowPct: legacy.metrics.freeLowPct,
            freeRunMax: legacy.metrics.freeRunMax,
            fullMedian2: legacy.metrics.fullMedian2,
            selectMedian: legacy.metrics.selectMedian,
            forcedPct: legacy.metrics.forcedPct,
            partialStepPct: legacy.metrics.partialStepPct,
            runs: legacy.metrics.freeRuns.slice(0, 3)
          }
        },
        instant: {
          completed: instant.completed,
          steps: instant.steps,
          gatePass: instant.gatePass,
          gateReasons: instant.gateReasons,
          metrics: {
            freeLowPct: instant.metrics.freeLowPct,
            freeRunMax: instant.metrics.freeRunMax,
            fullMedian2: instant.metrics.fullMedian2,
            selectMedian: instant.metrics.selectMedian,
            forcedPct: instant.metrics.forcedPct,
            partialStepPct: instant.metrics.partialStepPct,
            runs: instant.metrics.freeRuns.slice(0, 3)
          }
        }
      });
      console.log('[rule]', image, seed,
        'legacyGate=' + legacy.gatePass,
        'instantGate=' + instant.gatePass,
        'legacyFree=' + legacy.metrics.freeRunMax,
        'instantFree=' + instant.metrics.freeRunMax);
    }
  }
  const summary = {
    runs: rows.length,
    legacyGatePass: rows.filter(x => x.legacy.gatePass).length,
    instantGatePass: rows.filter(x => x.instant.gatePass).length,
    legacyCompleted: rows.filter(x => x.legacy.completed).length,
    instantCompleted: rows.filter(x => x.instant.completed).length,
    differentGate: rows.filter(x => x.legacy.gatePass !== x.instant.gatePass).length,
    differentFreeRun: rows.filter(x => x.legacy.metrics.freeRunMax !== x.instant.metrics.freeRunMax).length,
    decision: rows.filter(x => x.legacy.gatePass !== x.instant.gatePass).length
      ? '结构门当前choiceCurve与instantChain口径存在实际差异，必须修正评测规则一致性。'
      : '当前样本未发现结构门规则差异。'
  };
  fs.writeFileSync(OUT, JSON.stringify({
    schema: 'structure-gate-rule-consistency-v568',
    date: '2026-10-26',
    note: 'legacy=Generator.choiceCurve当前口径；instant=显式instantChain只读重放口径。',
    summary,
    rows
  }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main();
