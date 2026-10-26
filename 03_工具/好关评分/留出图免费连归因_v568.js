#!/usr/bin/env node
/** v568：拆解留出图A/B最长免费连的步骤、颜色、容量和开局位置。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const LEVEL_DIR = path.join(__dirname, 'M7独立seed留出图_v568.levels');
const OUT = path.join(__dirname, '留出图免费连归因_v568.json');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const CASES = ['008', '014'].flatMap(image =>
  [41001, 41002, 41003, 41004].map(seed => ({ image, seed })));

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

function runsFromCurve(curve) {
  const runs = [];
  let cur = null;
  for (let i = 0; i <= curve.steps.length; i++) {
    const s = curve.steps[i];
    const free = s && s.full >= 2 && s.free >= 3;
    if (free) {
      if (!cur) {
        cur = {
          startIndex: i,
          endIndex: i,
          startStep: i + 1,
          endStep: i + 1,
          startProgress: s.prog,
          endProgress: s.prog,
          actions: []
        };
      }
      cur.endIndex = i;
      cur.endStep = i + 1;
      cur.endProgress = s.prog;
      cur.actions.push({
        step: i + 1,
        progress: s.prog,
        full: s.full,
        free: s.free,
        pick: s.pick,
        moves: s.moves.length
      });
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  return runs.map(r => Object.assign(r, {
    length: r.actions.length,
    avgFull: +(r.actions.reduce((n, x) => n + x.full, 0) / r.actions.length).toFixed(2),
    minFree: Math.min.apply(null, r.actions.map(x => x.free)),
    colors: r.actions.map(x => x.pick.color),
    capacities: r.actions.map(x => x.pick.count)
  })).sort((a, b) => b.length - a.length);
}

function classify(r) {
  if (!r) return 'no_free_run';
  const early = r.startProgress < 0.35;
  const highFree = r.minFree >= 4;
  const repeated = new Set(r.colors).size < r.colors.length;
  if (early && highFree) return 'early_high_free_supply';
  if (repeated) return 'repeated_color_free_run';
  return 'mid_or_mixed_free_run';
}

function main() {
  const A = load();
  const rows = [];
  for (const c of CASES) {
    const stem = c.image + '_' + c.seed;
    const level = A.parseLevel(JSON.parse(fs.readFileSync(path.join(LEVEL_DIR, stem + '.json'), 'utf8')));
    const route = JSON.parse(fs.readFileSync(path.join(LEVEL_DIR, stem + '.route.json'), 'utf8'));
    const curve = A.Generator.choiceCurve(level, { completed: true, pickOrder: route });
    const runs = runsFromCurve(curve);
    const longest = runs[0] || null;
    rows.push({
      image: c.image,
      seed: c.seed,
      steps: curve.n,
      freeLowPct: curve.freeLowPct,
      freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2,
      selectMedian: curve.selectMedian,
      partialStepPct: curve.partialStepPct,
      longestRun: longest,
      topRuns: runs.slice(0, 5),
      classification: classify(longest)
    });
    console.log('[free]', c.image, c.seed, 'run=' + curve.freeRunMax,
      'start=' + (longest && longest.startStep), 'progress=' + (longest && longest.startProgress),
      'class=' + classify(longest), 'colors=' + (longest && longest.colors.join(',')));
  }
  const byImage = {};
  for (const image of ['008', '014']) {
    const a = rows.filter(x => x.image === image);
    byImage[image] = {
      runs: a.length,
      freeRunMax: a.map(x => x.freeRunMax),
      freeLowPct: a.map(x => x.freeLowPct),
      classifications: a.map(x => x.classification),
      longestStarts: a.map(x => x.longestRun && x.longestRun.startProgress),
      longestLengths: a.map(x => x.longestRun && x.longestRun.length)
    };
  }
  fs.writeFileSync(OUT, JSON.stringify({
    schema: 'heldout-free-run-attribution-v568',
    date: '2026-10-26',
    levels: path.relative(ROOT, LEVEL_DIR),
    summary: {
      runs: rows.length,
      classifications: rows.reduce((m, x) => (m[x.classification] = (m[x.classification] || 0) + 1, m), {}),
      byImage,
      decision: '只按最长免费连的动作/颜色/进度选择下一项单变量修复；不能直接把freeRun当成障碍题。'
    },
    rows
  }, null, 2) + '\n');
  console.log(JSON.stringify(byImage, null, 2));
}

main();
