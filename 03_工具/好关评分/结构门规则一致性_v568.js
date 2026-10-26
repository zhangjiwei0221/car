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

function curve(parsed, route, instantChain) {
  const Sim = A.Simulator;
  const original = Sim.createState;
  let forcedOpts = [];
  Sim.createState = function(level, opts) {
    const next = Object.assign({}, opts || {}, { instantChain: !!instantChain });
    forcedOpts.push(next.instantChain);
    return original(level, next);
  };
  let curveObj = null;
  try {
    curveObj = A.Generator.choiceCurve(parsed, { completed: true, pickOrder: route });
  } finally {
    Sim.createState = original;
  }
  if (!curveObj) return { completed: false, steps: 0, metrics: null, gatePass: false, gateReasons: ['choice_curve_null'] };
  const q = A.Quality.fromGeneration({
    level: parsed,
    valid: curveObj.n > 0,
    config: { boxSizeMin: 1, boxSizeMax: 999 },
    goodV3: { fillCurve: curveObj, persist: {} }
  });
  const runs = [];
  let run = null;
  for (let i = 0; i <= curveObj.steps.length; i++) {
    const s = curveObj.steps[i];
    const yes = s && s.full >= 2 && s.free >= 3;
    if (yes) {
      if (!run) run = { start: i, end: i, steps: [] };
      run.end = i;
      run.steps.push({ step: i + 1, progress: s.prog, full: s.full, free: s.free,
        color: s.pick.color, count: s.pick.count });
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return {
    completed: curveObj.n > 0,
    steps: curveObj.n,
    forcedInstantStateCalls: forcedOpts.filter(Boolean).length,
    metrics: {
      freeLowPct: curveObj.freeLowPct,
      freeRunMax: curveObj.freeRunMax,
      fullMedian2: curveObj.fullMedian2,
      selectMedian: curveObj.selectMedian,
      forcedPct: curveObj.forcedPct,
      partialStepPct: curveObj.partialStepPct,
      freeRuns: runs.sort((a, b) => b.steps.length - a.steps.length)
    },
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
