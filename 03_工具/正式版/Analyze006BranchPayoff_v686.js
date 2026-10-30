#!/usr/bin/env node
'use strict';

/**
 * Compare the three v15 entry paths with one deterministic greedy continuation.
 * The purpose is to measure time-to-R59/R65, not to find another solver route.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const LEVEL = path.join(ROOT, '实验关/关卡6/原型_v17/关卡_实验_006_v17.json');
const ATLAS = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v17');
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

const PATHS = {
  safe: [[0, 3], [1, 3]],
  lightDebt: [[0, 0], [1, 0], [2, 0]],
  heavyDebt: [[0, 6], [1, 6], [2, 6]]
};

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
    vm.runInContext(
      fs.readFileSync(path.join(BIN, file), 'utf8'),
      sandbox,
      { filename: file }
    );
  }
  return sandbox.AntSolver;
}

function regionMap(atlas) {
  const byCell = {};
  for (const region of atlas.target.regions || []) {
    for (const cell of region.cells || []) {
      byCell[cell[0] + ',' + cell[1]] = region.id;
    }
  }
  return byCell;
}

function reachableRegions(A, state, byCell) {
  const preview = A.Simulator.previewNextEliminationOrder(state);
  const ids = new Set();
  for (let r = 0; r < preview.rank.length; r++) {
    for (let c = 0; c < preview.rank[r].length; c++) {
      if (preview.rank[r][c] <= 0) continue;
      const id = byCell[r + ',' + c];
      if (id) ids.add(id);
    }
  }
  return ids;
}

function trace(A, level, byCell, id, prefix) {
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  const prefixEvidence = [];
  for (const [r, c] of prefix) {
    const move = A.Simulator.listMoves(state)
      .find(item => item.r === r && item.c === c && !item.blocked);
    if (!move) throw new Error(id + ' 入口路径不可执行');
    state.capOps = [];
    if (!A.Simulator.applyPick(state, r, c)) {
      throw new Error(id + ' 入口路径执行失败');
    }
    prefixEvidence.push({
      step: prefixEvidence.length + 1,
      r,
      c,
      color: move.antBox.color,
      count: move.antBox.count,
      buffer: state.buffer.map(item => ({
        color: item.color,
        remaining: item.need - item.progress
      }))
    });
  }

  const firstReach = { R59: null, R65: null };
  const continuation = [];
  for (let step = prefix.length; step <= 47; step++) {
    const reachable = reachableRegions(A, state, byCell);
    for (const region of ['R59', 'R65']) {
      if (!firstReach[region] && reachable.has(region)) firstReach[region] = step;
    }
    if (firstReach.R59 && firstReach.R65) break;
    if (state.gameOver) break;
    const moves = A.Simulator.listMoves(state).filter(move => !move.blocked);
    if (!moves.length) break;
    const pick = A.SolverStrategy.greedyPick(state, moves, {});
    if (!pick) break;
    continuation.push({
      step: step + 1,
      r: pick.r,
      c: pick.c,
      color: pick.antBox.color,
      count: pick.antBox.count,
      buffer: state.buffer.length
    });
    state.capOps = [];
    if (!A.Simulator.applyPick(state, pick.r, pick.c)) break;
  }
  return {
    id,
    prefix,
    prefixEvidence,
    continuation,
    firstReach,
    stoppedAtProgress: +(state.eliminatedPixels / state.totalPixels).toFixed(4),
    stoppedBuffer: state.buffer.length
  };
}

function main() {
  const A = loadSolver();
  const level = A.parseLevel(A.fromGameFormat(
    JSON.parse(fs.readFileSync(LEVEL, 'utf8'))
  ));
  const byCell = regionMap(JSON.parse(fs.readFileSync(ATLAS, 'utf8')));
  const branches = Object.keys(PATHS).map(id =>
    trace(A, level, byCell, id, PATHS[id]));
  const safe = branches.find(branch => branch.id === 'safe');
  for (const branch of branches) {
    branch.leadVsSafe = {
      R59: safe.firstReach.R59 == null || branch.firstReach.R59 == null
        ? null : safe.firstReach.R59 - branch.firstReach.R59,
      R65: safe.firstReach.R65 == null || branch.firstReach.R65 == null
        ? null : safe.firstReach.R65 - branch.firstReach.R65
    };
  }

  const result = {
    schema: '006-branch-payoff-v1',
    levelFile: LEVEL,
    atlasFile: ATLAS,
    policy: 'same greedy continuation after each entry prefix',
    branches,
    conclusion: {
      earliestR59: branches.slice().sort((a, b) =>
        a.firstReach.R59 - b.firstReach.R59)[0].id,
      earliestR65: branches.slice().sort((a, b) =>
        a.firstReach.R65 - b.firstReach.R65)[0].id,
      note: 'This is measured evidence; it does not replace human readability review.'
    }
  };
  fs.writeFileSync(
    path.join(OUT, 'branch-payoff-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, 'branch-payoff-v1.md'),
    [
      '# 006 · Branch Payoff v1',
      '',
      '统一策略：执行入口前缀后，三路都使用同一个贪心延续策略。',
      '',
      '| 路径 | R59 | R65 | 相对安全提前 R59 | 相对安全提前 R65 |',
      '|---|---:|---:|---:|---:|',
      ...branches.map(branch =>
        '| ' + branch.id + ' | ' + branch.firstReach.R59 + ' | ' +
        branch.firstReach.R65 + ' | ' + branch.leadVsSafe.R59 + ' | ' +
        branch.leadVsSafe.R65 + ' |'
      ),
      '',
      '- 最早R59：`' + result.conclusion.earliestR59 + '`；',
      '- 最早R65：`' + result.conclusion.earliestR65 + '`；',
      '- 该证据只比较统一策略下的揭示步数，不替代真人可读性判断。',
      ''
    ].join('\n') + '\n'
  );

  console.log(JSON.stringify({
    ok: true,
    output: path.join(OUT, 'branch-payoff-v1.json'),
    branches: branches.map(branch => ({
      id: branch.id,
      firstReach: branch.firstReach,
      leadVsSafe: branch.leadVsSafe,
      stoppedAtProgress: branch.stoppedAtProgress
    })),
    conclusion: result.conclusion
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
