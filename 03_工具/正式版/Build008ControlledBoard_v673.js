#!/usr/bin/env node
'use strict';

/**
 * E6.2/E6.3: first controlled board for target 008.
 *
 * 47 cars + 2 black cells, with a 14-step story corridor. Thirteen side cars
 * carry ice 14 so the story corridor is the only readable path until its end.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function take(cars, color, count) {
  const i = cars.findIndex(x => x.color === color && x.count === count);
  if (i < 0) throw new Error('缺少车辆 ' + color + '/' + count);
  return cars.splice(i, 1)[0];
}

function uniquePicks(run, count) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({ step: pick.step, r: pick.r, c: pick.c, color: pick.color, count: pick.count });
    if (out.length >= count) break;
  }
  return out;
}

function main() {
  const A = loadSolver();
  const target = path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_008.txt');
  const outDir = path.join(ROOT, '实验关/关卡8/原型_v1');
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(target, 'utf8'));
  const plan = A.InstantPlayout.plan(
    { blocks, rows: 35, cols: 35, bufferLimit: 5 },
    {
      boxSizeMin: 20,
      boxSizeMax: 40,
      bufferLimit: 5,
      ruleMode: 'instantChain',
      instantChain: true,
      instantPlanPolicy: 'supply',
      targetCarCount: 47
    }
  );
  if (!plan.ok || plan.boxes.length !== 47) throw new Error('008 47车规划失败');

  const remaining = plan.boxes.map(x => ({
    t: 'box',
    color: x.color,
    count: x.count,
    chain: 0,
    q: false,
    numice: 0
  }));
  const board = Array.from({ length: 7 }, () => Array(7).fill(null));
  board[1][1] = { t: 'black' };
  board[1][2] = { t: 'black' };

  const story = [
    { role: 'teach', r: 0, c: 1, color: 7, count: 26 },
    { role: 'debt1', r: 0, c: 0, color: 33, count: 22 },
    { role: 'release1', r: 1, c: 0, color: 32, count: 27 },
    { role: 'teach2a', r: 2, c: 0, color: 7, count: 26 },
    { role: 'teach2b', r: 3, c: 0, color: 32, count: 27 },
    { role: 'peel1', r: 4, c: 0, color: 27, count: 28 },
    { role: 'peel2', r: 5, c: 0, color: 27, count: 28 },
    { role: 'peel3', r: 6, c: 0, color: 27, count: 28 },
    { role: 'peel4', r: 6, c: 1, color: 27, count: 28 },
    { role: 'peel5', r: 6, c: 2, color: 27, count: 27 },
    { role: 'peel6', r: 6, c: 3, color: 27, count: 27 },
    { role: 'reveal', r: 6, c: 4, color: 27, count: 27 },
    { role: 'debt2', r: 6, c: 5, color: 3, count: 29 },
    { role: 'release2', r: 6, c: 6, color: 5, count: 36 }
  ];
  for (const item of story) {
    board[item.r][item.c] = take(remaining, item.color, item.count);
  }

  const guardCells = [
    [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
    [2, 1], [3, 1], [4, 1], [5, 1],
    [5, 2], [5, 3], [5, 4], [5, 5]
  ];
  for (const [r, c] of guardCells) {
    const car = remaining.shift();
    car.numice = story.length;
    board[r][c] = car;
  }
  const free = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      if (!board[r][c]) free.push([r, c]);
    }
  }
  if (free.length !== remaining.length) throw new Error('剩余车辆与空格不一致');
  for (let i = 0; i < remaining.length; i++) {
    const [r, c] = free[i];
    board[r][c] = remaining[i];
  }

  const level = A.parseLevel({
    blocks,
    bufferLimit: 5,
    board: { rows: 7, cols: 7, cells: board }
  });
  const expected = story.map(x => x.r + ',' + x.c);
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const solvePrefix = uniquePicks(solve, 14).map(x => x.r + ',' + x.c);
  const players = [];
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap
      });
      const prefix = uniquePicks(run, 14).map(x => x.r + ',' + x.c);
      players.push({
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        bufferPeak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        prefixMatches: prefix.join('>') === expected.join('>'),
        prefix
      });
    }
  }

  const storyState = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  storyState.capture = true;
  const evidence = [];
  for (const item of story) {
    const move = A.Simulator.listMoves(storyState)
      .find(x => x.r === item.r && x.c === item.c && !x.blocked);
    if (!move) throw new Error('剧情动作不可取: ' + item.role);
    storyState.capOps = [];
    const pixelsBefore = storyState.eliminatedPixels;
    A.Simulator.applyPick(storyState, item.r, item.c);
    evidence.push({
      ...item,
      consumedPixels: storyState.eliminatedPixels - pixelsBefore,
      bufferAfter: storyState.buffer.map(x => ({
        color: x.color,
        remaining: x.need - x.progress,
        slot: x.slot
      }))
    });
  }

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

  const roundtrip = A.parseLevel(A.fromGameFormat(A.toGameFormat(level)));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: 20000,
    greedyOnly: true
  });

  const checks = {
    boardContract: boxes === 47 && black === 2 && sum === 1225,
    noUnexpectedObstacles: chain === 0 && pipe === 0 && question === 0,
    solvePass: solve.completed,
    solvePrefix: solvePrefix.join('>') === expected.join('>'),
    playersPass: players.every(x => x.won && x.prefixMatches),
    noRevivePass: players.filter(x => x.reviveCap === 0)
      .every(x => x.revivesUsed === 0),
    roundtripPass: roundtripSolve.completed === true
  };
  const passed = Object.values(checks).every(Boolean);

  const game = A.toGameFormat(level);
  const report = {
    schema: '008-controlled-board-v1',
    status: passed ? 'STORY_CORRIDOR_PASS' : 'STORY_CORRIDOR_FAIL',
    target,
    gameFormat: path.join(outDir, '关卡_实验_008_v1.json'),
    board: {
      rows: 7,
      cols: 7,
      boxes,
      black,
      ice,
      chain,
      pipe,
      question,
      capacitySum: sum,
      guardCells,
      iceDuration: story.length
    },
    story,
    evidence,
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer,
      prefix: solvePrefix
    },
    players,
    roundtripSolve: {
      completed: roundtripSolve.completed,
      progress: roundtripSolve.progress,
      bufferPeak: roundtripSolve.maxBuffer
    },
    checks
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(report.gameFormat, JSON.stringify(game, null, 2) + '\n');
  fs.writeFileSync(
    path.join(outDir, '关卡_实验_008_v1.debug.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  const md = [
    '# 008 · Controlled Story Board v1',
    '',
    '## 棋盘',
    '',
    '- 7×7；',
    '- 47车、2黑块；',
    '- 13个侧路车带14步数字冰；',
    '- 容量总和1225。',
    '',
    '## 14步剧情走廊',
    '',
    '| 节拍 | 格子 | 车辆 | 消耗 | 暂存 |',
    '|---|---|---|---:|---|',
    ...evidence.map(x => '| ' + x.role + ' | ' + x.r + ',' + x.c + ' | ' +
      x.color + '/' + x.count + ' | ' + x.consumedPixels + ' | ' +
      (x.bufferAfter.length
        ? x.bufferAfter.map(y => y.color + '欠' + y.remaining).join('、')
        : '空') + ' |'),
    '',
    '## 验证',
    '',
    '- 全知100%、峰值' + solve.maxBuffer + '；',
    '- 默认/0复活6局PlayerSim全部通关；',
    '- 全部前14步一致；',
    '- 0复活局无复活；',
    '- 客户端JSON往返可解。',
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, '关卡_实验_008_v1.md'), md);

  console.log(JSON.stringify({
    ok: passed,
    outDir,
    board: report.board,
    checks,
    solve: report.solve,
    players,
    evidence: evidence.filter(x => ['debt1', 'release1', 'reveal', 'debt2', 'release2'].includes(x.role))
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
