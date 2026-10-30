#!/usr/bin/env node
'use strict';

/**
 * E6.4: one-shot final holdout for target 014.
 *
 * The story is fixed before board construction:
 *   border teach -> narrow 18px bridge debt -> 29px hollow entry and release
 *   -> 33px corn gate debt -> incomplete 24px corn -> hill cut and escalation.
 *
 * The compiler assigns the approved [20,40] capacity multiset to a
 * Hamiltonian snake, then removes only redundant timed ice gates. No random
 * seed search and no post-result story edits are involved.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const TARGET = path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_014.txt');
const OUT = path.join(ROOT, '实验关/关卡14/原型_v1');
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

function uniquePicks(run) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({ r: pick.r, c: pick.c, color: pick.color, count: pick.count });
  }
  return out;
}

function routeKey(picks) {
  return picks.map(pick => pick.r + ',' + pick.c).join('>');
}

function bufferState(state) {
  return state.buffer.map(item => ({
    color: item.color,
    remaining: item.need - item.progress,
    slot: item.slot
  }));
}

function takeCapacity(boxes, color, count) {
  const index = boxes.findIndex(box => box.color === color && box.count === count);
  if (index < 0) throw new Error('容量不存在: ' + color + '/' + count);
  return boxes.splice(index, 1)[0];
}

function main() {
  const A = loadSolver();
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(TARGET, 'utf8'));
  const plan = A.InstantPlayout.plan(
    { blocks, rows: 35, cols: 35, bufferLimit: 5 },
    {
      boxSizeMin: 20,
      boxSizeMax: 40,
      bufferLimit: 5,
      ruleMode: 'instantChain',
      instantChain: true,
      instantPlanPolicy: 'supply',
      targetCarCount: 48
    }
  );
  if (!plan.ok || plan.boxes.length !== 48) throw new Error('014 48车规划失败');

  const remaining = plan.boxes.map(box => ({
    color: box.color,
    count: box.count
  }));
  const storyPrefix = [
    { color: 19, count: 25 },
    { color: 18, count: 27 },
    { color: 29, count: 24 },
    { color: 33, count: 25 },
    { color: 24, count: 30 },
    { color: 15, count: 24 },
    { color: 30, count: 25 }
  ];
  for (const wanted of storyPrefix) takeCapacity(remaining, wanted.color, wanted.count);
  const sequence = [...storyPrefix, ...remaining];
  if (sequence.length !== 48) throw new Error('014故事序列不是48车');

  const rowMajorSnake = [];
  for (let r = 0; r < 7; r++) {
    for (let i = 0; i < 7; i++) {
      const c = r % 2 === 0 ? i : 6 - i;
      if (r === 6 && c === 6) continue;
      rowMajorSnake.push([r, c]);
    }
  }
  if (rowMajorSnake.length !== 48) throw new Error('014棋盘路径不是48格');

  const boardCells = Array.from({ length: 7 }, () => Array(7).fill(null));
  boardCells[6][6] = { t: 'black' };
  for (let i = 0; i < sequence.length; i++) {
    const [r, c] = rowMajorSnake[i];
    boardCells[r][c] = {
      t: 'box',
      color: sequence[i].color,
      count: sequence[i].count,
      chain: 0,
      q: false,
      numice: i === 0 ? 0 : i
    };
  }

  function buildLevel() {
    return A.parseLevel({
      blocks,
      bufferLimit: 5,
      board: { rows: 7, cols: 7, cells: boardCells }
    });
  }

  const expected = rowMajorSnake.map(([r, c]) => ({ r, c }));
  const expectedKey = routeKey(expected);

  function exactRun(level, includePlayers) {
    const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
    const solvePicks = uniquePicks(solve);
    const solveMatches = solve.completed && solve.progress === 100 &&
      routeKey(solvePicks) === expectedKey;
    if (!solveMatches) return { ok: false, solve, solvePicks, players: [] };
    if (!includePlayers) return { ok: true, solve, solvePicks, players: [] };
    const players = [];
    for (const reviveCap of [0, 2]) {
      for (const seed of [7, 1009, 2027]) {
        const run = A.PlayerSim.run(level, {
          seed,
          instantChain: true,
          reviveCap
        });
        players.push({
          seed,
          reviveCap,
          won: run.won,
          progress: run.progress,
          bufferPeak: run.bufferPeak,
          revivesUsed: run.revivesUsed,
          routeMatches: routeKey(uniquePicks(run)) === expectedKey
        });
      }
    }
    return {
      ok: players.every(player => player.won && player.progress === 100 && player.routeMatches),
      solve,
      solvePicks,
      players
    };
  }

  // Start with a complete timeline gate, then remove only gates whose removal
  // leaves the full route unchanged for deterministic solve and all players.
  let prunePasses = 0;
  let removedGates = 0;
  let changed = true;
  while (changed && prunePasses < 4) {
    changed = false;
    prunePasses++;
    for (let step = 48; step >= 2; step--) {
      const [r, c] = rowMajorSnake[step - 1];
      const cell = boardCells[r][c];
      if (!(cell.numice > 0)) continue;
      const oldGate = cell.numice;
      cell.numice = 0;
      const result = exactRun(buildLevel(), true);
      if (result.ok) {
        changed = true;
        removedGates++;
      } else {
        cell.numice = oldGate;
      }
    }
  }

  const level = buildLevel();
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  const evidence = [];
  for (let i = 0; i < expected.length; i++) {
    const action = expected[i];
    const move = A.Simulator.listMoves(state)
      .find(item => item.r === action.r && item.c === action.c && !item.blocked);
    if (!move) throw new Error('014计划动作不可取: step ' + (i + 1));
    const beforePixels = state.eliminatedPixels;
    state.capOps = [];
    if (!A.Simulator.applyPick(state, action.r, action.c)) {
      throw new Error('014计划动作执行失败: step ' + (i + 1));
    }
    evidence.push({
      step: i + 1,
      r: action.r,
      c: action.c,
      color: move.antBox.color,
      count: move.antBox.count,
      consumedPixels: state.eliminatedPixels - beforePixels,
      visibleOptions: A.Simulator.listMoves(state).filter(item => !item.blocked).length,
      bufferAfter: bufferState(state)
    });
  }

  const finalRun = exactRun(level, true);
  const roundtrip = A.parseLevel(A.fromGameFormat(A.toGameFormat(level)));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: 20000,
    greedyOnly: true
  });

  const at = step => evidence[step - 1];
  const checks = {
    capacityContract: plan.boxes.length === 48 &&
      plan.boxes.reduce((sum, box) => sum + box.count, 0) === 1225 &&
      plan.boxes.every(box => box.count >= 20 && box.count <= 40),
    boardContract: boardCells.flat().filter(cell => cell && cell.t === 'box').length === 48 &&
      boardCells.flat().filter(cell => cell && cell.t === 'black').length === 1,
    fullReplay: state.eliminatedPixels === state.totalPixels && !state.gameOver,
    bridgeDebt: at(2).color === 18 &&
      at(2).bufferAfter.some(x => x.color === 18 && x.remaining === 23),
    bridgeReleasedByHollow: at(3).bufferAfter.length === 0 &&
      at(3).consumedPixels >= 47,
    cornGateDebt: at(4).color === 33 &&
      at(4).bufferAfter.some(x => x.color === 33 && x.remaining === 16),
    cornDebt: at(5).color === 24 &&
      at(5).bufferAfter.some(x => x.color === 24 && x.remaining === 10),
    hillNarrow: at(6).bufferAfter.some(x => x.color === 24 && x.remaining === 4),
    deep30Debt: at(7).bufferAfter.some(x => x.color === 30 && x.remaining === 5),
    deep30Release: at(27).bufferAfter.length === 1 &&
      at(27).bufferAfter[0].color === 24 && at(27).bufferAfter[0].remaining === 4,
    cornRelease: at(36).bufferAfter.length === 0,
    terminalDebt: at(40).bufferAfter.some(x => x.color === 31 && x.remaining === 3),
    terminalRelease: at(48).bufferAfter.length === 0,
    solvePass: finalRun.solve.completed && finalRun.solve.progress === 100,
    solveRouteMatches: routeKey(finalRun.solvePicks) === expectedKey,
    playersPass: finalRun.players.every(player =>
      player.won && player.progress === 100 && player.routeMatches),
    noRevivePass: finalRun.players.filter(player => player.reviveCap === 0)
      .every(player => player.revivesUsed === 0),
    roundtripPass: roundtripSolve.completed === true
  };
  const passed = Object.values(checks).every(Boolean);

  let boxes = 0;
  let black = 0;
  let ice = 0;
  let chain = 0;
  let pipe = 0;
  let question = 0;
  let capacitySum = 0;
  for (const row of boardCells) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.t === 'black') black++;
      if (cell.t === 'box') {
        boxes++;
        capacitySum += cell.count;
        if (cell.numice > 0) ice++;
        if (cell.chain > 0) chain++;
        if (cell.q) question++;
      }
      if (cell.t === 'pipe') pipe++;
    }
  }

  const report = {
    schema: '014-final-holdout-v1',
    status: passed ? 'FINAL_HOLDOUT_PASS' : 'FINAL_HOLDOUT_FAIL',
    target: TARGET,
    storyPlan: {
      grammar: '边界缺口 → 内主题 → 第二象限债务 → 错峰收束',
      anchorRegions: ['R107', 'R69', 'R199', 'R206', 'R126'],
      prefix: storyPrefix
    },
    construction: {
      rows: 7,
      cols: 7,
      boxes,
      black,
      ice,
      chain,
      pipe,
      question,
      capacitySum,
      path: 'row-major Hamiltonian snake with (6,6) blocked',
      initialTimelineGates: 47,
      prunePasses,
      removedGates
    },
    storyBeats: [
      { steps: '1', role: 'teach', result: '19/25 收满并打开左下边界' },
      { steps: '2-3', role: 'bridgeRelease', result: '18/27欠23；29/24切进R69并偿还' },
      { steps: '4-6', role: 'corn', result: '33/25欠16；24/30留下玉米欠10；15/24缩到4' },
      { steps: '7-27', role: 'deep30', result: '30/25欠5，后段由15/24释放' },
      { steps: '28-36', role: 'cornResolve', result: '左/上背景耗尽后，15/24完成玉米债务' },
      { steps: '38-48', role: 'terminal', result: '20/26/31收束，31欠3并在末手释放' }
    ],
    evidence,
    solve: {
      completed: finalRun.solve.completed,
      progress: finalRun.solve.progress,
      bufferPeak: finalRun.solve.maxBuffer,
      routeMatches: routeKey(finalRun.solvePicks) === expectedKey
    },
    players: finalRun.players,
    roundtripSolve: {
      completed: roundtripSolve.completed,
      progress: roundtripSolve.progress,
      bufferPeak: roundtripSolve.maxBuffer
    },
    checks
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, '关卡_实验_014_v1.json'),
    JSON.stringify(A.toGameFormat(level), null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, '关卡_实验_014_v1.debug.json'),
    JSON.stringify(report, null, 2) + '\n'
  );

  const featuredSteps = new Set([1, 2, 3, 4, 5, 6, 7, 27, 36, 38, 39, 40, 41, 47, 48]);
  const featured = evidence.filter(item => featuredSteps.has(item.step));
  const md = [
    '# 014 · Final Holdout v1',
    '',
    '## 结论',
    '',
    passed ? '通过：最终留出图按冻结剧本完成。' : '失败：保留失败证据，不回调剧本。',
    '',
    '## 棋盘',
    '',
    `- 7×7，${boxes}车、${black}黑块；`,
    `- ${ice}个数字冰门、0链、0管道、0问号；`,
    `- 容量合同 \`[20,40]\`，总和${capacitySum}；`,
    `- 初始47个时间门，删除${removedGates}个冗余门，经历${prunePasses}轮。`,
    '',
    '## 故事链',
    '',
    '| 步 | 格子 | 车辆 | 消耗 | 暂存 |',
    '|---:|---|---:|---:|---|',
    ...featured.map(item =>
      `| ${item.step} | ${item.r},${item.c} | ${item.color}/${item.count} | ` +
      `${item.consumedPixels} | ` +
      (item.bufferAfter.length
        ? item.bufferAfter.map(x => x.color + '欠' + x.remaining).join('、')
        : '空') +
      ' |'
    ),
    '',
    '## 验证',
    '',
    `- 全知${finalRun.solve.progress}%，峰值${finalRun.solve.maxBuffer}；`,
    `- 全知路线${report.solve.routeMatches ? '与48步计划完全一致' : '偏离计划'}；`,
    `- 默认/0复活6局PlayerSim${finalRun.players.every(x => x.won) ? '全部通关' : '未全过'}；`,
    `- 路线一致${finalRun.players.filter(x => x.routeMatches).length}/6；`,
    `- 0复活局复活数${finalRun.players.filter(x => x.reviveCap === 0).map(x => x.revivesUsed).join('/')}；`,
    `- 客户端JSON往返${roundtripSolve.completed ? '可解' : '未解'}。`,
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, '关卡_实验_014_v1.md'), md);

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    construction: report.construction,
    checks,
    solve: report.solve,
    players: report.players,
    featured
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
