#!/usr/bin/env node
'use strict';

/**
 * E6.3: second controlled board for target 008.
 *
 * Keeps the approved 14-step opening from v1, then gives the level three
 * authored pressure beats:
 *   1. 30/25 leaves 5px, released next move;
 *   2. the same 30/25 capacity reappears deeper and leaves 17px;
 *   3. 13/31 and 14/32 accumulate together, then resolve at different times.
 *
 * The board is a controlled re-arrangement of the v1 capacity multiset.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const V1 = path.join(ROOT, '实验关/关卡8/原型_v1/关卡_实验_008_v1.json');
const OUT = path.join(ROOT, '实验关/关卡8/原型_v2');
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

function uniquePicks(run, count) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({ r: pick.r, c: pick.c, color: pick.color, count: pick.count });
    if (out.length >= count) break;
  }
  return out;
}

function bufferState(state) {
  return state.buffer.map(item => ({
    color: item.color,
    remaining: item.need - item.progress,
    slot: item.slot
  }));
}

function routeKey(items) {
  return items.map(item => item.r + ',' + item.c).join('>');
}

function main() {
  const A = loadSolver();
  const sourceGame = JSON.parse(fs.readFileSync(V1, 'utf8'));
  const level = A.parseLevel(A.fromGameFormat(sourceGame));
  const cells = level.board.cells;

  const story = [
    { role: 'teach', r: 0, c: 1 },
    { role: 'debt1', r: 0, c: 0 },
    { role: 'release1', r: 1, c: 0 },
    { role: 'teach2a', r: 2, c: 0 },
    { role: 'teach2b', r: 3, c: 0 },
    { role: 'peel1', r: 4, c: 0 },
    { role: 'peel2', r: 5, c: 0 },
    { role: 'peel3', r: 6, c: 0 },
    { role: 'peel4', r: 6, c: 1 },
    { role: 'peel5', r: 6, c: 2 },
    { role: 'peel6', r: 6, c: 3 },
    { role: 'reveal', r: 6, c: 4 },
    { role: 'debt2', r: 6, c: 5 },
    { role: 'release2', r: 6, c: 6 }
  ];

  // This is the spatial continuation produced by v1. Its order is kept because
  // every next cell is reachable from the cells already removed.
  const route = [
    [0, 2], [0, 3], [0, 4], [0, 6], [2, 1], [4, 1],
    [0, 5], [1, 5], [3, 1], [5, 2], [5, 3], [1, 6],
    [5, 1], [1, 4], [2, 4], [1, 3], [2, 3], [3, 3],
    [5, 5], [4, 3], [2, 2], [5, 6], [2, 5], [2, 6],
    [3, 2], [3, 4], [3, 6], [4, 2], [4, 6], [3, 5],
    [5, 4], [4, 4], [4, 5]
  ];

  const stepRoles = new Map([
    [15, 'second_act'],
    [27, 'mirrorDebt'],
    [28, 'mirrorRelease'],
    [30, 'deepDebt'],
    [34, 'deepNarrow'],
    [35, 'deepRelease'],
    [37, 'crossDebt13'],
    [38, 'crossDebt14'],
    [39, 'crossRelease13'],
    [45, 'crossRelease14'],
    [46, 'finaleA'],
    [47, 'finaleB']
  ]);

  // Four-position rotation. It preserves every capacity while moving the two
  // authored 30/25 beats and their 15/21 release route into place.
  const cycle = [[5, 1], [2, 2], [1, 4], [2, 3]];
  const old = cycle.map(([r, c]) => cells[r][c]);
  cells[5][1] = old[1];
  cells[2][2] = old[2];
  cells[1][4] = old[3];
  cells[2][3] = old[0];

  for (const row of cells) {
    for (const cell of row) {
      if (cell && cell.t === 'box') cell.numice = 0;
    }
  }

  // Minimal ice schedule retained after greedy removal: removing any one of
  // these gates changes the authored route. The value is the number of picked
  // boxes needed before that board cell becomes selectable.
  const gates = [
    [0, 2, 14], [0, 3, 15], [0, 4, 16], [0, 6, 17],
    [2, 1, 18], [4, 1, 19], [0, 5, 20],
    [3, 1, 22], [5, 2, 23], [5, 3, 24],
    [1, 6, 25], [5, 1, 26],
    [1, 4, 27], [1, 3, 29], [2, 3, 30],
    [5, 5, 32], [4, 3, 33], [2, 2, 34],
    [5, 6, 35], [2, 5, 36], [2, 6, 37], [3, 2, 38],
    [4, 2, 41], [5, 4, 44], [4, 4, 45]
  ];
  for (const [r, c, remaining] of gates) {
    if (!cells[r][c] || cells[r][c].t !== 'box') {
      throw new Error('冰门不在车辆格: ' + r + ',' + c);
    }
    cells[r][c].numice = remaining;
  }

  const expected = [
    ...story.map(item => ({ r: item.r, c: item.c, role: item.role })),
    ...route.map(([r, c], index) => ({
      r,
      c,
      role: stepRoles.get(index + 15) || 'bridge'
    }))
  ];

  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  const evidence = [];
  for (let index = 0; index < expected.length; index++) {
    const item = expected[index];
    const moves = A.Simulator.listMoves(state).filter(move => !move.blocked);
    const move = moves.find(x => x.r === item.r && x.c === item.c);
    if (!move) throw new Error('计划动作不可取: step ' + (index + 1) + ' ' + item.r + ',' + item.c);
    const pixelsBefore = state.eliminatedPixels;
    state.capOps = [];
    if (!A.Simulator.applyPick(state, item.r, item.c)) {
      throw new Error('计划动作执行失败: step ' + (index + 1));
    }
    evidence.push({
      step: index + 1,
      role: item.role,
      r: item.r,
      c: item.c,
      color: move.antBox.color,
      count: move.antBox.count,
      consumedPixels: state.eliminatedPixels - pixelsBefore,
      visibleOptions: moves.length,
      bufferAfter: bufferState(state)
    });
  }

  const byStep = new Map(evidence.map(item => [item.step, item]));
  const mirrorDebt = byStep.get(27);
  const mirrorRelease = byStep.get(28);
  const deepDebt = byStep.get(30);
  const deepNarrow = byStep.get(34);
  const deepRelease = byStep.get(35);
  const crossDebt13 = byStep.get(37);
  const crossDebt14 = byStep.get(38);
  const crossRelease13 = byStep.get(39);
  const crossRelease14 = byStep.get(45);

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const solvePicks = uniquePicks(solve, expected.length);
  const players = [];
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap
      });
      const picks = uniquePicks(run, expected.length);
      players.push({
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        bufferPeak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        routeMatches: routeKey(picks) === routeKey(expected)
      });
    }
  }

  const roundtrip = A.parseLevel(A.fromGameFormat(A.toGameFormat(level)));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: 20000,
    greedyOnly: true
  });

  let boxes = 0;
  let black = 0;
  let ice = 0;
  let chain = 0;
  let pipe = 0;
  let question = 0;
  let sum = 0;
  for (const row of cells) {
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

  const expectedKey = routeKey(expected);
  const checks = {
    capacityContract: boxes === 47 && sum === 1225 &&
      cells.flat().filter(x => x && x.t === 'box')
        .every(x => x.count >= 20 && x.count <= 40),
    boardContract: boxes === 47 && black === 2,
    obstacleContract: ice === gates.length && chain === 0 && pipe === 0 && question === 0,
    fullReplay: state.eliminatedPixels === state.totalPixels && !state.gameOver,
    openingPreserved: routeKey(evidence.slice(0, 14)) ===
      story.map(x => x.r + ',' + x.c).join('>'),
    mirrorDebtBeat: mirrorDebt.color === 30 && mirrorDebt.count === 25 &&
      mirrorDebt.bufferAfter.some(x => x.color === 30 && x.remaining === 5),
    mirrorReleaseBeat: mirrorRelease.bufferAfter.length === 0,
    deepDebtBeat: deepDebt.color === 30 && deepDebt.count === 25 &&
      deepDebt.bufferAfter.some(x => x.color === 30 && x.remaining === 17),
    deepNarrowBeat: deepNarrow.bufferAfter.some(x => x.color === 30 && x.remaining === 2),
    deepReleaseBeat: deepRelease.bufferAfter.length === 0,
    crossDebt13Beat: crossDebt13.color === 13 &&
      crossDebt13.bufferAfter.some(x => x.color === 13 && x.remaining === 3),
    crossDebt14Beat: crossDebt14.color === 14 &&
      crossDebt14.bufferAfter.some(x => x.color === 14 && x.remaining === 3),
    crossRelease13Beat: crossRelease13.bufferAfter.length === 1 &&
      crossRelease13.bufferAfter[0].color === 14 &&
      crossRelease13.bufferAfter[0].remaining === 3,
    crossRelease14Beat: crossRelease14.bufferAfter.length === 0,
    solvePass: solve.completed && solve.progress === 100,
    solveRouteMatches: routeKey(solvePicks) === expectedKey,
    playersPass: players.every(x => x.won && x.progress === 100),
    playersRouteMatch: players.every(x => x.routeMatches),
    noRevivePass: players.filter(x => x.reviveCap === 0)
      .every(x => x.revivesUsed === 0),
    roundtripPass: roundtripSolve.completed === true
  };
  const passed = Object.values(checks).every(Boolean);

  const report = {
    schema: '008-controlled-board-v2',
    status: passed ? 'THREE_ACT_STORY_PASS' : 'THREE_ACT_STORY_FAIL',
    source: V1,
    gameFormat: path.join(OUT, '关卡_实验_008_v2.json'),
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
      routeLength: expected.length,
      gateCount: gates.length
    },
    capacityRotation: {
      cells: cycle,
      description: '30/25 进入第27手；15/21 进入第28手；33/21 与 7/25 补齐轮换'
    },
    gates: gates.map(([r, c, remaining]) => ({ r, c, remaining })),
    storyBeats: [
      {
        act: 'opening',
        steps: '1-14',
        result: '两笔短债、R125揭示、0复活可走'
      },
      {
        act: 'mirror',
        steps: '27-28',
        result: '30/25欠5，下一手释放'
      },
      {
        act: 'deepen',
        steps: '30-35',
        result: '同一容量欠17，第34手仅余2，第35手释放'
      },
      {
        act: 'cross',
        steps: '37-45',
        result: '13/31与14/32同时欠3；先放13，14再保持六手后释放'
      },
      {
        act: 'finale',
        steps: '46-47',
        result: '两车清尾并结束'
      }
    ],
    evidence,
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer,
      routeMatches: routeKey(solvePicks) === expectedKey
    },
    players,
    roundtripSolve: {
      completed: roundtripSolve.completed,
      progress: roundtripSolve.progress,
      bufferPeak: roundtripSolve.maxBuffer
    },
    checks
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    report.gameFormat,
    JSON.stringify(A.toGameFormat(level), null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, '关卡_实验_008_v2.debug.json'),
    JSON.stringify(report, null, 2) + '\n'
  );

  const featured = evidence.filter(item => [
    'debt1', 'release1', 'reveal', 'debt2', 'release2',
    'mirrorDebt', 'mirrorRelease', 'deepDebt', 'deepNarrow',
    'deepRelease', 'crossDebt13', 'crossDebt14',
    'crossRelease13', 'crossRelease14', 'finaleA', 'finaleB'
  ].includes(item.role));
  const md = [
    '# 008 · Three Act Story Board v2',
    '',
    '## 结论',
    '',
    passed ? '通过：三段故事均有计划动作、债务和释放。' : '未通过：见 debug 检查项。',
    '',
    '## 棋盘',
    '',
    `- 7×7，${boxes}车、${black}黑块；`,
    `- ${ice}个数字冰门、0链、0管道、0问号；`,
    '- 容量合同 `[20,40]`，总和1225；',
    '- 沿用 v1 的14步开场走廊。',
    '',
    '## 故事链',
    '',
    '| 节拍 | 动作 | 车辆 | 消耗 | 暂存 |',
    '|---|---|---:|---:|---|',
    ...featured.map(item =>
      `| ${item.role} | ${item.r},${item.c} | ${item.color}/${item.count} | ` +
      `${item.consumedPixels} | ` +
      (item.bufferAfter.length
        ? item.bufferAfter.map(x => x.color + '欠' + x.remaining).join('、')
        : '空') +
      ' |'
    ),
    '',
    '## 验证',
    '',
    `- 全知${solve.progress}%，峰值${solve.maxBuffer}；`,
    `- 计划路线47/47动作可由同一棋盘连续回放；`,
    `- 默认/0复活6局PlayerSim全部${players.every(x => x.won) ? '通关' : '未全过'}；`,
    `- 路线一致${players.filter(x => x.routeMatches).length}/6；`,
    `- 0复活局复活数${players.filter(x => x.reviveCap === 0).map(x => x.revivesUsed).join('/')}；`,
    `- 客户端JSON往返${roundtripSolve.completed ? '可解' : '未解'}。`,
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, '关卡_实验_008_v2.md'), md);

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    board: report.board,
    checks,
    solve: report.solve,
    players,
    featured
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
