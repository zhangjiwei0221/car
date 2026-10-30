#!/usr/bin/env node
'use strict';

/**
 * Build one deterministic playable prototype from a target TXT.
 *
 * This is deliberately narrow:
 *   capacity + board cells -> InstantPlayout car plan -> row-major board
 *   -> exact InstantChain solve -> PlayerSim -> round-trip game JSON.
 *
 * It is a playable mechanical prototype, not proof that the selected StoryPlan happened.
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

function valueAfter(args, flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
}

function makeRowMajorBoard(boxes, rows, cols) {
  const cells = [];
  let index = 0;
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const box = boxes[index++];
      row.push(box ? {
        t: 'box',
        color: box.color,
        count: box.count,
        chain: 0,
        q: false,
        numice: 0
      } : null);
    }
    cells.push(row);
  }
  return { rows, cols, cells };
}

function compactSolve(result) {
  return {
    completed: !!result.completed,
    progress: result.progress,
    steps: result.steps,
    completedBoxes: result.completedBoxes,
    totalBoxes: result.totalBoxes,
    eliminatedPixels: result.eliminatedPixels,
    totalPixels: result.totalPixels,
    maxBuffer: result.maxBuffer,
    avgBuffer: result.avgBuffer,
    pickCount: result.pickOrder ? result.pickOrder.length : 0
  };
}

function compactPlayer(result) {
  return {
    won: !!result.won,
    progress: result.progress,
    completedBoxes: result.completedBoxes,
    totalBoxes: result.totalBoxes,
    bufferPeak: result.bufferPeak,
    playerAvgBuffer: result.playerAvgBuffer,
    picks: result.picks,
    stalledAtEnd: result.stalledAtEnd,
    elimMode: result.elimMode
  };
}

function main() {
  const args = process.argv.slice(2);
  const target = path.resolve(valueAfter(args, '--target',
    '实验关/关卡6/35x35拼接图纸_006.txt'));
  const outDir = path.resolve(valueAfter(args, '--out-dir',
    path.join(path.dirname(target), '原型_v1')));
  const minCap = Math.max(1, parseInt(valueAfter(args, '--cap-min', '20'), 10) || 20);
  const maxCap = Math.max(minCap, parseInt(valueAfter(args, '--cap-max', '40'), 10) || 40);
  const rows = Math.max(1, parseInt(valueAfter(args, '--rows', '7'), 10) || 7);
  const cols = Math.max(1, parseInt(valueAfter(args, '--cols', '7'), 10) || 7);
  const bufferLimit = Math.max(1, parseInt(valueAfter(args, '--buffer', '5'), 10) || 5);
  const policy = valueAfter(args, '--policy', 'shortDebt');
  const solveBudgetMs = Math.max(1000, parseInt(valueAfter(args, '--solve-budget-ms', '15000'), 10) || 15000);
  const targetCars = rows * cols;

  const A = loadSolver();
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(target, 'utf8'));
  if (!blocks || !blocks.length) throw new Error('目标 TXT 为空或无法解析');

  const planConfig = {
    boxSizeMin: minCap,
    boxSizeMax: maxCap,
    bufferLimit,
    ruleMode: 'instantChain',
    instantChain: true,
    instantPlanPolicy: policy,
    targetCarCount: targetCars
  };
  const carPlan = A.InstantPlayout.plan({
    blocks,
    rows: blocks.length,
    cols: blocks[0].length,
    bufferLimit
  }, planConfig);
  if (!carPlan || !carPlan.ok || !carPlan.boxes || carPlan.boxes.length !== targetCars) {
    throw new Error('InstantPlayout 规划失败: ' + JSON.stringify({
      ok: carPlan && carPlan.ok,
      reason: carPlan && carPlan.reason,
      cars: carPlan && carPlan.boxes && carPlan.boxes.length,
      targetCars
    }));
  }

  const board = makeRowMajorBoard(carPlan.boxes, rows, cols);
  const level = A.parseLevel({ blocks, bufferLimit, board });
  const solve = A.Solver.solveInstantChain(level, {
    timeBudgetMs: solveBudgetMs,
    greedyOnly: false
  });
  if (!solve.completed) {
    throw new Error('候选关全知未通关: ' + JSON.stringify(compactSolve(solve)));
  }

  const playerSeeds = [7, 1009, 2027];
  const players = playerSeeds.map(seed => {
    const result = A.PlayerSim.run(level, { seed, instantChain: true });
    return Object.assign({ seed }, compactPlayer(result));
  });

  const game = A.toGameFormat(level);
  const roundtrip = A.parseLevel(A.fromGameFormat(game));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: solveBudgetMs,
    greedyOnly: true
  });
  if (!roundtripSolve.completed) {
    throw new Error('客户端 JSON 往返后不可解');
  }

  const capacity = A.Quality && A.Quality.capacityEvidence
    ? A.Quality.capacityEvidence(level, { boxSizeMin: minCap, boxSizeMax: maxCap })
    : null;

  fs.mkdirSync(outDir, { recursive: true });
  const gamePath = path.join(outDir, '关卡_实验_v1.json');
  const debugPath = path.join(outDir, '关卡_实验_v1.debug.json');
  const routePath = path.join(outDir, '关卡_实验_v1.route.json');
  const reportPath = path.join(outDir, '关卡_实验_v1.md');

  fs.writeFileSync(gamePath, JSON.stringify(game, null, 2) + '\n');
  fs.writeFileSync(routePath, JSON.stringify({
    schema: 'prototype-route-v1',
    plan: carPlan.boxes._instantPlayout || null,
    solve: {
      pickOrder: solve.pickOrder,
      stepStats: solve.stepStats,
      stepBufferHistory: solve.stepBufferHistory,
      pressureSamples: solve.pressureSamples
    },
    playerRuns: players
  }, null, 2) + '\n');

  const summary = {
    schema: 'playable-prototype-v1',
    status: 'mechanical_playable_story_unverified',
    target,
    inputs: {
      ruleMode: 'instantChain',
      capacity: [minCap, maxCap],
      board: { rows, cols },
      bufferLimit,
      planPolicy: policy,
      layout: 'row-major'
    },
    carPlan: {
      ok: !!carPlan.ok,
      cars: carPlan.boxes.length,
      targetCars,
      exactCapacityColors: carPlan.boxes._instantPlayout.exactCapacityColors,
      infeasibleCapacityColors: carPlan.boxes._instantPlayout.infeasibleCapacityColors
    },
    solve: compactSolve(solve),
    playerRuns: players,
    roundtripSolve: compactSolve(roundtripSolve),
    capacity,
    gameFormat: gamePath,
    storyPlan: '实验关/关卡6/故事计划_v1.json',
    storyStatus: 'StoryPlan v1 is not proven by this mechanical prototype'
  };
  fs.writeFileSync(debugPath, JSON.stringify({
    summary,
    carPlan: carPlan.boxes._instantPlayout || null,
    level
  }, null, 2) + '\n');

  const md = [
    '# 006 · 可玩原型 v1',
    '',
    '> 这是机械可玩原型，不代表 StoryPlan v1 已被验证。',
    '',
    '## 输入',
    '',
    '- 目标图：`' + target + '`',
    '- 容量：`[' + minCap + ',' + maxCap + ']`',
    '- 棋盘：' + rows + '×' + cols,
    '- 布局：row-major',
    '- 消除模式：instantChain',
    '',
    '## 验证结果',
    '',
    '- 车辆数：' + carPlan.boxes.length,
    '- 精确容量颜色：' + summary.carPlan.exactCapacityColors,
    '- 非精确容量颜色：' + summary.carPlan.infeasibleCapacityColors,
    '- 全知通关：' + (solve.completed ? '是' : '否'),
    '- 全知进度：' + solve.progress + '%',
    '- 全知最大 buffer：' + solve.maxBuffer,
    '- 客户端 JSON 往返可解：' + (roundtripSolve.completed ? '是' : '否'),
    '',
    '## PlayerSim',
    '',
    '| seed | 通关 | 进度 | 峰值 | 平均 buffer |',
    '|---|---:|---:|---:|---:|',
    ...players.map(p => '| ' + p.seed + ' | ' + (p.won ? '是' : '否') + ' | ' + p.progress + '% | ' + p.bufferPeak + ' | ' + p.playerAvgBuffer + ' |'),
    '',
    '## 文件',
    '',
    '- 客户端关卡：`' + gamePath + '`',
    '- 路线数据：`' + routePath + '`',
    '- 调试数据：`' + debugPath + '`',
    '',
    '## 当前定位',
    '',
    '该关使用真实的容量规划、真实连续消除、真实求解器和 PlayerSim。',
    '它证明“006 可以生成一个可玩关卡”，但 row-major 棋盘尚未执行 R2→R10、短债务和 reveal 的 StoryPlan 验证。'
  ].join('\n') + '\n';
  fs.writeFileSync(reportPath, md);

  console.log(JSON.stringify({
    ok: true,
    outDir,
    gamePath,
    reportPath,
    cars: carPlan.boxes.length,
    solve: compactSolve(solve),
    players
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
