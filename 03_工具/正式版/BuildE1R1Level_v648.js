#!/usr/bin/env node
'use strict';

/**
 * E1-R1 first controlled-choice-board candidate.
 *
 * This is a read-only experiment over the v5 capacity set. It keeps the same
 * 47 cars and the same two structural black cells, but moves them so the first
 * story is carried by board order and target-state changes rather than by a
 * newly-added mechanism.
 *
 * It does not modify the production generator or the client bin.
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

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function takeCar(cars, color, count) {
  const i = cars.findIndex(car => car.color === color && car.count === count);
  if (i < 0) throw new Error('缺少车辆 ' + color + '/' + count);
  return cars.splice(i, 1)[0];
}

function bufferSummary(state) {
  return state.buffer.map(item => ({
    color: item.color,
    progress: item.progress,
    need: item.need,
    remaining: item.need - item.progress,
    slot: item.slot
  }));
}

function compactSolve(solve) {
  return {
    completed: !!solve.completed,
    progress: solve.progress,
    steps: solve.steps,
    maxBuffer: solve.maxBuffer,
    avgBuffer: solve.avgBuffer,
    pickOrder: solve.pickOrder
  };
}

function compactPlayer(seed, reviveCap, run) {
  return {
    seed,
    reviveCap,
    won: !!run.won,
    progress: run.progress,
    completedBoxes: run.completedBoxes,
    totalBoxes: run.totalBoxes,
    bufferPeak: run.bufferPeak,
    playerAvgBuffer: run.playerAvgBuffer,
    revivesUsed: run.revivesUsed,
    stalledAtEnd: run.stalledAtEnd,
    pickOrder: run.pickOrder,
    instantEvents: run.instantEvents,
    reviveEvents: run.reviveEvents
  };
}

function routePrefix(run, count) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({ step: pick.step, tick: pick.tick, r: pick.r, c: pick.c, color: pick.color, count: pick.count });
    if (out.length >= count) break;
  }
  return out;
}

function replayStory(A, level, actions) {
  const state = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  state.capture = true;
  const rows = [];
  for (const action of actions) {
    const moves = A.Simulator.listMoves(state);
    const move = moves.find(x => x.r === action.r && x.c === action.c && !x.blocked);
    if (!move) throw new Error('故事动作不可取: ' + action.role + ' (' + action.r + ',' + action.c + ')');
    state.capOps = [];
    const before = state.eliminatedPixels;
    if (!A.Simulator.applyPick(state, action.r, action.c)) {
      throw new Error('故事动作执行失败: ' + action.role);
    }
    rows.push({
      role: action.role,
      cell: [action.r, action.c],
      color: move.antBox.color,
      count: move.antBox.count,
      consumedPixels: state.eliminatedPixels - before,
      bufferAfter: bufferSummary(state),
      completedBoxesAfter: state.completedBoxes
    });
  }
  return rows;
}

function main() {
  const variant = arg('--variant', '7');
  if (variant !== '7' && variant !== '8' && variant !== '9') {
    throw new Error('只支持 --variant 7 / 8 / 9');
  }
  const label = 'v' + variant;
  const sourceFile = path.resolve(arg(
    '--source',
    '实验关/关卡6/原型_v5/关卡_实验_v5.json'
  ));
  const outDir = path.resolve(arg(
    '--out-dir',
    variant === '9'
      ? '实验关/关卡6/原型_v9'
      : variant === '8'
      ? '实验关/关卡6/原型_v8'
      : '实验关/关卡6/原型_v7'
  ));
  const seeds = arg('--seeds', '7,1009,2027').split(',').map(Number);
  const A = loadSolver();
  const sourceLevel = A.parseLevel(A.fromGameFormat(readJson(sourceFile)));

  const cars = [];
  for (let r = 0; r < sourceLevel.board.rows; r++) {
    for (let c = 0; c < sourceLevel.board.cols; c++) {
      const cell = sourceLevel.board.cells[r][c];
      if (cell && cell.t === 'box') cars.push(clone(cell));
    }
  }
  if (cars.length !== 47) throw new Error('源关卡不是47辆车');

  const spec = variant === '8' || variant === '9'
    ? [
        [0, 2, 30, 22, 'entry'],
        [0, 1, 15, 24, 'hollow'],
        [0, 0, 17, 26, 'debt1'],
        [1, 0, 31, 30, 'release1'],
        [0, 3, 34, 25, 'debt2'],
        [1, 3, 5, 40, 'release2'],
        [0, 4, 34, 25, 'supportA'],
        [0, 5, 17, 25, 'supportB'],
        [0, 6, 17, 25, 'supportC'],
        [1, 4, 21, 36, 'supportD'],
        [2, 0, 13, 27, 'supportE']
      ]
    : [
        [0, 0, 30, 22, 'entry'],
        [0, 1, 15, 24, 'hollow'],
        [0, 2, 17, 26, 'debt1'],
        [1, 2, 31, 30, 'release1'],
        [0, 3, 34, 25, 'debt2'],
        [0, 6, 5, 40, 'release2'],
        [0, 4, 21, 36, 'supportA'],
        [1, 0, 17, 25, 'supportB'],
        [1, 4, 34, 25, 'supportC'],
        [0, 5, 17, 25, 'supportD'],
        [2, 2, 13, 27, 'supportE']
      ];

  const board = Array.from({ length: 7 }, () => Array(7).fill(null));
  if (variant === '8' || variant === '9') {
    board[1][1] = { t: 'black' };
    board[1][2] = { t: 'black' };
  } else {
    board[1][1] = { t: 'black' };
    board[1][3] = { t: 'black' };
  }

  const fixed = spec.map(([r, c, color, count, role]) => ({
    r,
    c,
    color,
    count,
    role,
    cell: takeCar(cars, color, count)
  }));
  for (const item of fixed) board[item.r][item.c] = item.cell;
  if (variant === '9') {
    board[0][3].numice = 4;
    board[0][4].numice = 6;
    board[0][5].numice = 6;
    board[0][6].numice = 6;
  }

  const free = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      if (!board[r][c]) free.push([r, c]);
    }
  }
  if (free.length !== cars.length) throw new Error('车位和剩余车辆数量不一致');
  cars.forEach((car, i) => {
    board[free[i][0]][free[i][1]] = car;
  });

  const level = A.parseLevel({
    blocks: sourceLevel.blocks,
    bufferLimit: 5,
    board: { rows: 7, cols: 7, cells: board }
  });

  const actions = variant === '8' || variant === '9'
    ? [
        { role: 'entry', r: 0, c: 2 },
        { role: 'hollow', r: 0, c: 1 },
        { role: 'debt1', r: 0, c: 0 },
        { role: 'release1', r: 1, c: 0 },
        { role: 'debt2', r: 0, c: 3 },
        { role: 'release2', r: 1, c: 3 }
      ]
    : [
        { role: 'entry', r: 0, c: 0 },
        { role: 'hollow', r: 0, c: 1 },
        { role: 'debt1', r: 0, c: 2 },
        { role: 'release1', r: 1, c: 2 },
        { role: 'debt2', r: 0, c: 3 },
        { role: 'release2', r: 0, c: 6 }
      ];
  const story = replayStory(A, level, actions);

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  if (!solve.completed) throw new Error(label + ' 全知不可解');

  const players = [];
  for (const reviveCap of [0, 2]) {
    for (const seed of seeds) {
      players.push(compactPlayer(
        seed,
        reviveCap,
        A.PlayerSim.run(level, { seed, instantChain: true, reviveCap })
      ));
    }
  }

  const expectedCells = actions.map(x => x.r + ',' + x.c);
  for (const player of players) {
    const prefix = routePrefix(player, actions.length).map(x => x.r + ',' + x.c);
    player.storyPrefixMatches = prefix.length === expectedCells.length &&
      prefix.every((cell, i) => cell === expectedCells[i]);
    if (!player.storyPrefixMatches) {
      throw new Error('PlayerSim 未按计划走完前六步: seed=' + player.seed +
        ' reviveCap=' + player.reviveCap + ' prefix=' + prefix.join('>'));
    }
  }

  const roundtrip = A.parseLevel(A.fromGameFormat(A.toGameFormat(level)));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: 20000,
    greedyOnly: true
  });
  if (!roundtripSolve.completed) throw new Error(label + ' 客户端 JSON 往返不可解');

  let boxes = 0;
  let black = 0;
  let ice = 0;
  let chain = 0;
  let pipe = 0;
  let question = 0;
  let sum = 0;
  for (const row of board) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.t === 'black') black++;
      if (cell.t === 'box') {
        boxes++;
        sum += cell.count;
        if (cell.numice > 0) ice++;
        if (cell.chain > 0) chain++;
        if (cell.q) question++;
      }
      if (cell.t === 'pipe') pipe++;
    }
  }
  if (boxes !== 47 || black !== 2 || sum !== 1225) {
    throw new Error('棋盘合同失败: boxes=' + boxes + ' black=' + black + ' sum=' + sum);
  }
  const expectedIce = variant === '9' ? 4 : 0;
  if (ice !== expectedIce || chain || pipe || question) {
    throw new Error(label + ' 障碍数量不符: ice=' + ice + ' chain=' + chain +
      ' pipe=' + pipe + ' question=' + question);
  }

  const debt1 = story.find(x => x.role === 'debt1');
  const release1 = story.find(x => x.role === 'release1');
  const debt2 = story.find(x => x.role === 'debt2');
  const release2 = story.find(x => x.role === 'release2');
  if (!debt1.bufferAfter.some(x => x.color === 17 && x.remaining > 0)) {
    throw new Error('第一拍没有形成17色债务');
  }
  if (release1.bufferAfter.some(x => x.color === 17 && x.remaining > 0)) {
    throw new Error('第一释放没有清掉17色债务');
  }
  if (!debt2.bufferAfter.some(x => x.color === 34 && x.remaining > 0)) {
    throw new Error('第二拍没有形成34色债务');
  }
  if (release2.bufferAfter.some(x => x.color === 34 && x.remaining > 0)) {
    throw new Error('第二释放没有清掉34色债务');
  }

  const game = A.toGameFormat(level);
  const baseName = '关卡_实验_' + label;
  const report = {
    schema: variant === '9'
      ? 'e1-r3-story-level-v1'
      : variant === '8'
      ? 'e1-r2-story-level-v1'
      : 'e1-r1-story-level-v1',
    status: 'controlled_choice_board_candidate',
    sourceFile,
    gameFormat: path.join(outDir, baseName + '.json'),
    board: {
      rows: 7,
      cols: 7,
      boxes,
      black,
      ice,
      chain,
      pipe,
      question,
      capacitySum: sum
    },
    story: {
      actions,
      evidence: story,
      debt1Released: true,
      debt2Released: true
    },
    allKnowing: compactSolve(solve),
    players,
    roundtripSolve: compactSolve(roundtripSolve)
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(report.gameFormat, JSON.stringify(game, null, 2) + '\n');
  fs.writeFileSync(
    path.join(outDir, baseName + '.debug.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(outDir, baseName + '.route.json'),
    JSON.stringify({
      schema: variant === '9'
        ? 'e1-r3-story-level-v1-route'
        : variant === '8'
        ? 'e1-r2-story-level-v1-route'
        : 'e1-r1-story-level-v1-route',
      story: report.story,
      allKnowingPickOrder: solve.pickOrder,
      playerRuns: players.map(p => ({
        seed: p.seed,
        reviveCap: p.reviveCap,
        won: p.won,
        progress: p.progress,
        revivesUsed: p.revivesUsed,
        bufferPeak: p.bufferPeak,
        storyPrefixMatches: p.storyPrefixMatches,
        pickOrder: p.pickOrder
      }))
    }, null, 2) + '\n'
  );

  const md = [
    '# 006 · ' + (variant === '9' ? 'E1-R3' : variant === '8' ? 'E1-R2' : 'E1-R1') + ' Story Level ' + label,
    '',
    variant === '9'
      ? '> 使用4格数字冰做顺序约束的E1-R3候选；不是正式生产默认。'
      : '> 无新增语义障碍的受控选项池候选；不是正式生产默认。',
    '',
    '## 棋盘合同',
    '',
    '- 7×7，47 车，2 个结构黑块；',
    '- 冰 ' + ice + '、锁链 ' + chain + '、管道 ' + pipe + '、问号 ' + question + '；',
    '- 容量总和 1225，对应目标图像素 1225。',
    '',
    '## 计划节拍',
    '',
    '| 节拍 | 格子 | 色/容量 | 实际消除 | 消除后暂存 |',
    '|---|---|---|---:|---|',
    ...story.map(x => '| ' + x.role + ' | ' + x.cell.join(',') + ' | ' +
      x.color + '/' + x.count + ' | ' + x.consumedPixels + ' | ' +
      (x.bufferAfter.length ? x.bufferAfter.map(y => y.color + '欠' + y.remaining).join('、') : '空') + ' |'),
    '',
    '## 验证',
    '',
    '- 全知通关：' + (solve.completed ? '是' : '否') + '，进度 ' + solve.progress +
      '%，最大 buffer ' + solve.maxBuffer + '；',
    '- 第一债务由 17/26 实际欠 10，并由 31/30 释放；',
    '- 第二拍由 34/25 实际欠 6，并由 5/40 释放；',
    '- 默认 PlayerSim 与 0 复活 PlayerSim 的各 seed 均按前六步计划执行。',
    '',
    '## PlayerSim',
    '',
    '| seed | 复活上限 | 通关 | 进度 | 复活次数 | 峰值 | 前六步符合 |',
    '|---:|---:|---|---:|---:|---:|---|',
    ...players.map(p => '| ' + p.seed + ' | ' + p.reviveCap + ' | ' +
      (p.won ? '是' : '否') + ' | ' + p.progress + '% | ' + p.revivesUsed + ' | ' +
      p.bufferPeak + ' | ' + (p.storyPrefixMatches ? '是' : '否') + ' |'),
    '',
    '## 限制',
    '',
    '本文件证明“前四步基础故事 + 第二笔债务/释放”可以由车辆可见性控制。',
    'PlayerSim 的 R59/R65 揭示、末段债务释放和全知旁路见',
    '`story-audit-v2.md`。当前仍不能进入 E2。'
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, baseName + '.md'), md);

  console.log(JSON.stringify({
    ok: true,
    outDir,
    board: report.board,
    story: story.map(x => ({
      role: x.role,
      cell: x.cell,
      color: x.color,
      count: x.count,
      consumedPixels: x.consumedPixels,
      bufferAfter: x.bufferAfter
    })),
    allKnowing: {
      completed: solve.completed,
      progress: solve.progress,
      maxBuffer: solve.maxBuffer,
      first8: routePrefix(solve, 8)
    },
    players: players.map(p => ({
      seed: p.seed,
      reviveCap: p.reviveCap,
      won: p.won,
      progress: p.progress,
      revivesUsed: p.revivesUsed,
      bufferPeak: p.bufferPeak,
      storyPrefixMatches: p.storyPrefixMatches,
      first8: routePrefix(p, 8)
    }))
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
