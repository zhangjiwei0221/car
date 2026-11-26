#!/usr/bin/env node
'use strict';

/**
 * E4.5: ablate the two existing structural black cells.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const MODULES = [
  'utils.js',
  'color-libs.js',
  'simulator.js',
  'solver-strategy.js',
  'solver.js',
  'playersim.js',
  'analysis.js',
  'car-sequencer.js',
  'solver-analysis.js',
  'experience-goal.js',
  'capacity-tuner.js',
  'instant-playout.js',
  'generator.js'
];

function loadSolver() {
  const sandbox = {
    console,
    WeakMap,
    Map,
    Set,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    isNaN,
    parseInt,
    parseFloat,
    isFinite,
    setTimeout,
    clearTimeout
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  for (const file of MODULES) {
    vm.runInContext(fs.readFileSync(path.join(BIN, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox.AntSolver;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function prefix(run, count) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push(pick.r + ',' + pick.c);
    if (out.length >= count) break;
  }
  return out;
}

function main() {
  const A = loadSolver();
  const baseFile = path.join(ROOT, '实验关/关卡6/E3_v1/E3布局A.json');
  const outDir = path.join(ROOT, '实验关/关卡6/E4_v1');
  const base = A.parseLevel(A.fromGameFormat(readJson(baseFile)));
  const cells = base.board.cells.map(row => row.map(cell => cell ? clone(cell) : null));
  cells[1][1] = null;
  cells[1][2] = null;
  const ablated = A.parseLevel({
    blocks: base.blocks,
    bufferLimit: 5,
    board: { rows: 7, cols: 7, cells }
  });
  const expected = ['0,2', '0,1', '0,0', '1,0', '0,3', '1,3'];
  const solveBase = A.Solver.solveInstantChain(base, { timeBudgetMs: 20000 });
  const solveAblated = A.Solver.solveInstantChain(ablated, { timeBudgetMs: 20000 });
  const basePrefix = prefix(solveBase, 6);
  const ablatedPrefix = prefix(solveAblated, 6);
  const player = A.PlayerSim.run(ablated, {
    seed: 7,
    instantChain: true,
    reviveCap: 0
  });
  const playerPrefix = prefix(player, 6);
  const checks = {
    basePrefixOk: basePrefix.join('>') === expected.join('>'),
    ablationChangesPlan: ablatedPrefix.join('>') !== expected.join('>'),
    ablationChangesPlayer: playerPrefix.join('>') !== expected.join('>'),
    ablationStillPlayable: player.won && player.progress === 100
  };
  const passed = checks.basePrefixOk && checks.ablationChangesPlan &&
    checks.ablationChangesPlayer && checks.ablationStillPlayable;
  const result = {
    schema: 'black-shape-ablation-v1',
    status: passed ? 'BLACK_SHAPE_NECESSARY_FOR_PLAN' : 'BLACK_SHAPE_ABLATION_FAIL',
    baseFile,
    removedCells: [[1, 1], [1, 2]],
    expected,
    basePrefix,
    ablatedSolverPrefix: ablatedPrefix,
    ablatedPlayerPrefix: playerPrefix,
    player: {
      won: player.won,
      progress: player.progress,
      bufferPeak: player.bufferPeak,
      revivesUsed: player.revivesUsed
    },
    checks,
    interpretation: '移除黑块后关卡仍可通关，但计划路线和玩家路线改变；' +
      '因此黑块的语义是控制路线/可见方向，不是补洞。'
  };
  fs.writeFileSync(
    path.join(outDir, 'black-shape-ablation-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  const md = [
    '# 006 · E4.5 黑块 shape 移除消融',
    '',
    '## 结论',
    '',
    passed ? '两个黑块对计划路线有真实空间约束。' : '黑块消融未通过。',
    '',
    '## 路线',
    '',
    '- 基准：' + basePrefix.join(' → ') + '；',
    '- 移除黑块-全知：' + ablatedPrefix.join(' → ') + '；',
    '- 移除黑块-玩家：' + playerPrefix.join(' → ') + '；',
    '',
    '## 结果',
    '',
    '- 移除后仍可通关：' + (checks.ablationStillPlayable ? '是' : '否') + '；',
    '- 移除后计划路线改变：' + (checks.ablationChangesPlan ? '是' : '否') + '；',
    '- 移除后玩家路线改变：' + (checks.ablationChangesPlayer ? '是' : '否') + '。',
    '',
    result.interpretation,
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'black-shape-ablation-v1.md'), md);
  console.log(JSON.stringify({ ok: passed, result }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
