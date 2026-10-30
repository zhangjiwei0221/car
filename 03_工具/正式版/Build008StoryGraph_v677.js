#!/usr/bin/env node
'use strict';

/**
 * E6.7 first StoryGraph prototype for target 008.
 *
 * The opening is a real two-debt choice:
 *   7/26 -> 33/22 (light debt) -> 32/27 release
 *   7/26 ->  3/29 (heavy debt) ->  5/36 release
 * Either debt opens the same next act. The rest is divided into timed choice
 * rooms rather than a one-action-per-ice conveyor.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const TARGET = path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_008.txt');
const OUT = path.join(ROOT, '实验关/关卡8/原型_v3');
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

function poseKey(picks) {
  return picks.map(pick => pick.r + ',' + pick.c).join('>');
}

function bufferState(state) {
  return state.buffer.map(item => ({
    color: item.color,
    remaining: item.need - item.progress,
    slot: item.slot
  }));
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
      targetCarCount: 47
    }
  );
  if (!plan.ok || plan.boxes.length !== 47) throw new Error('008 47车规划失败');

  const allCaps = plan.boxes.map(box => ({ color: box.color, count: box.count }));
  const earlyPos = [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [0, 3]];
  const earlyCaps = [
    { color: 7, count: 26 },
    { color: 33, count: 22 },
    { color: 32, count: 27 },
    { color: 3, count: 29 },
    { color: 5, count: 36 },
    { color: 7, count: 26 }
  ];

  // Shared continuation found by replaying both debt branches against the real
  // target state. It merges only after both branches have returned to buffer 0.
  const common = (
    '27/28 27/28 27/28 27/28 32/27 ' +
    '27/27 27/27 27/27 27/27 27/27 32/27 ' +
    '27/27 27/27 32/27 7/26 7/26 32/26 ' +
    '27/27 26/26 7/25 32/26 7/25 15/21 ' +
    '28/26 30/25 33/21 30/25 15/21 31/21 ' +
    '28/25 33/21'
  ).split(' ').map(text => {
    const [color, count] = text.split('/').map(Number);
    return { color, count };
  });

  const remainingCaps = allCaps.slice();
  for (const cap of earlyCaps.concat(common)) {
    const index = remainingCaps.findIndex(item =>
      item.color === cap.color && item.count === cap.count);
    if (index < 0) throw new Error('容量不存在: ' + cap.color + '/' + cap.count);
    remainingCaps.splice(index, 1);
  }
  const continuation = common.concat(remainingCaps);
  if (continuation.length !== 41) throw new Error('后续容量不是41车');

  const black = new Set(['1,1', '1,2']);
  const cells = Array.from({ length: 7 }, () => Array(7).fill(null));
  for (const key of black) {
    const [r, c] = key.split(',').map(Number);
    cells[r][c] = { t: 'black' };
  }
  earlyPos.forEach(([r, c], index) => {
    cells[r][c] = {
      t: 'box',
      color: earlyCaps[index].color,
      count: earlyCaps[index].count,
      chain: 0,
      q: false,
      numice: 0
    };
  });

  // The two release cars become available after the player has taken two
  // actions. The shared merge car follows one action later.
  cells[2][0].numice = 2;
  cells[0][2].numice = 2;
  cells[0][3].numice = 3;

  const used = new Set(earlyPos.map(item => item.join(',')));
  for (const key of black) used.add(key);
  const free = [];
  for (let r = 0; r < 7; r++) {
    const cols = r % 2 === 0
      ? Array.from({ length: 7 }, (_, i) => i)
      : Array.from({ length: 7 }, (_, i) => 6 - i);
    for (const c of cols) if (!used.has(r + ',' + c)) free.push([r, c]);
  }

  const roomSizes = [4, 5, 5, 5, 5, 5, 5, 7];
  const scheduled = [];
  let cursor = 0;
  let unlockAt = 3;
  for (const roomSize of roomSizes) {
    const room = [];
    for (let i = 0; i < roomSize; i++, cursor++) {
      const [r, c] = free[cursor];
      const cap = continuation[cursor];
      cells[r][c] = {
        t: 'box',
        color: cap.color,
        count: cap.count,
        chain: 0,
        q: false,
        numice: unlockAt
      };
      room.push({ r, c, color: cap.color, count: cap.count, unlockAt });
    }
    scheduled.push({ startStep: unlockAt + 1, size: roomSize, room });
    unlockAt += roomSize;
  }
  if (cursor !== continuation.length) throw new Error('房间容量分配不完整');

  function buildLevel() {
    return A.parseLevel({
      blocks,
      bufferLimit: 5,
      board: { rows: 7, cols: 7, cells }
    });
  }

  function evaluate(includePlayers) {
    const level = buildLevel();
    const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 30000 });
    const runs = [];
    if (includePlayers) {
      for (const seed of [7, 1009, 2027, 41, 99]) {
        runs.push(A.PlayerSim.run(level, { seed, instantChain: true, reviveCap: 0 }));
      }
    }
    return { level, solve, players: runs };
  }

  function openingDebtChoicesVisible() {
    const state = A.Simulator.createState(buildLevel(), {
      useSlotStart: true,
      instantChain: true
    });
    state.capture = true;
    state.capOps = [];
    if (!A.Simulator.applyPick(state, 0, 0)) return false;
    const moves = A.Simulator.listMoves(state).filter(move => !move.blocked);
    const hasLight = moves.some(move => move.r === 1 && move.c === 0 &&
      move.antBox.color === 33 && move.antBox.count === 22);
    const hasHeavy = moves.some(move => move.r === 0 && move.c === 1 &&
      move.antBox.color === 3 && move.antBox.count === 29);
    return moves.length === 2 && hasLight && hasHeavy;
  }

  function routeDiversity(result) {
    const keys = new Set();
    for (const run of [result.solve, ...result.players]) {
      keys.add(poseKey(uniquePicks(run).slice(0, 12)));
    }
    return keys.size;
  }

  function valid(result) {
    if (!result.solve.completed || result.solve.progress !== 100) return false;
    if (!result.players.every(run =>
      run.won && run.progress === 100 && run.revivesUsed === 0)) return false;
    if (!openingDebtChoicesVisible()) return false;
    return routeDiversity(result) >= 2;
  }

  // Greedily remove redundant future-room timers. A timer is redundant only if
  // both debt choices remain visible and all solve/player simulations still pass.
  let removedTimers = 0;
  let changed = true;
  let prunePasses = 0;
  while (changed && prunePasses < 3) {
    changed = false;
    prunePasses++;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const cell = cells[r][c];
        if (!cell || cell.t !== 'box' || !cell.numice) continue;
        if ((r === 2 && c === 0) || (r === 0 && c === 2) || (r === 0 && c === 3)) continue;
        const old = cell.numice;
        cell.numice = 0;
        const result = evaluate(true);
        if (valid(result)) {
          changed = true;
          removedTimers++;
        } else {
          cell.numice = old;
        }
      }
    }
  }

  const finalEval = evaluate(true);
  const finalLevel = finalEval.level;
  const openingState = A.Simulator.createState(finalLevel, {
    useSlotStart: true,
    instantChain: true
  });
  openingState.capture = true;
  openingState.capOps = [];
  A.Simulator.applyPick(openingState, 0, 0);
  const openingMoves = A.Simulator.listMoves(openingState)
    .filter(move => !move.blocked)
    .map(move => ({
      r: move.r,
      c: move.c,
      color: move.antBox.color,
      count: move.antBox.count,
      canConsume: move.canConsume
    }));

  const branchEvidence = [];
  for (const branch of [
    { name: 'lightDebt', picks: [[1, 0], [2, 0]] },
    { name: 'heavyDebt', picks: [[0, 1], [0, 2]] }
  ]) {
    const state = A.Simulator.createState(finalLevel, {
      useSlotStart: true,
      instantChain: true
    });
    state.capture = true;
    const actions = [[0, 0], ...branch.picks];
    const evidence = [];
    for (const [r, c] of actions) {
      const move = A.Simulator.listMoves(state)
        .find(item => item.r === r && item.c === c && !item.blocked);
      if (!move) throw new Error(branch.name + ' 动作不可取: ' + r + ',' + c);
      const before = state.eliminatedPixels;
      state.capOps = [];
      A.Simulator.applyPick(state, r, c);
      evidence.push({
        r,
        c,
        color: move.antBox.color,
        count: move.antBox.count,
        consumed: state.eliminatedPixels - before,
        bufferAfter: bufferState(state)
      });
    }
    branchEvidence.push({ name: branch.name, evidence });
  }

  const players = finalEval.players.map(run => ({
    seed: run.seed,
    won: run.won,
    progress: run.progress,
    bufferPeak: run.bufferPeak,
    revivesUsed: run.revivesUsed,
    first12: uniquePicks(run).slice(0, 12)
  }));
  const solvePicks = uniquePicks(finalEval.solve);
  const solveRoute = solvePicks.slice(0, 12);
  const distinctPlayerRoutes = new Set(players.map(player => poseKey(player.first12))).size;
  const diversity = routeDiversity(finalEval);

  let boxes = 0;
  let blacks = 0;
  let ice = 0;
  let chain = 0;
  let pipe = 0;
  let question = 0;
  let capacitySum = 0;
  for (const row of cells) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.t === 'black') blacks++;
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

  const checks = {
    capacityContract: boxes === 47 && capacitySum === 1225 &&
      cells.flat().filter(cell => cell && cell.t === 'box')
        .every(cell => cell.count >= 20 && cell.count <= 40),
    boardContract: boxes === 47 && blacks === 2,
    obstacleContract: chain === 0 && pipe === 0 && question === 0,
    openingHasTwoDebts: openingDebtChoicesVisible(),
    lightDebt: branchEvidence[0].evidence[1].bufferAfter
      .some(item => item.color === 33 && item.remaining === 18),
    lightRelease: branchEvidence[0].evidence[2].bufferAfter.length === 0,
    heavyDebt: branchEvidence[1].evidence[1].bufferAfter
      .some(item => item.color === 3 && item.remaining > 0),
    heavyRelease: branchEvidence[1].evidence[2].bufferAfter.length === 0,
    solvePass: finalEval.solve.completed && finalEval.solve.progress === 100,
    playersPass: players.every(player =>
      player.won && player.progress === 100 && player.revivesUsed === 0),
    routeDiversity: diversity >= 2,
    playerRouteDiversity: distinctPlayerRoutes >= 1
  };
  const passed = Object.values(checks).every(Boolean);

  const report = {
    schema: '008-story-graph-v1',
    status: passed ? 'STORY_GRAPH_PASS' : 'STORY_GRAPH_FAIL',
    target: TARGET,
    gameFormat: path.join(OUT, '关卡_实验_008_v3.json'),
    board: {
      rows: 7,
      cols: 7,
      boxes,
      black: blacks,
      ice,
      chain,
      pipe,
      question,
      capacitySum,
      removedTimers,
      prunePasses
    },
    storyGraph: {
      opening: {
        teach: '7/26',
        choices: [
          { id: 'lightDebt', debt: '33/22欠18', release: '32/27' },
          { id: 'heavyDebt', debt: '3/29欠22～27', release: '5/36' }
        ],
        merge: '7/26'
      },
      rooms: scheduled
    },
    openingMoves,
    branchEvidence,
    solve: {
      completed: finalEval.solve.completed,
      progress: finalEval.solve.progress,
      bufferPeak: finalEval.solve.maxBuffer,
      first12: solveRoute
    },
    players,
    diversity,
    distinctPlayerRoutes,
    checks
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    report.gameFormat,
    JSON.stringify(A.toGameFormat(finalLevel), null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, '关卡_实验_008_v3.debug.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, '关卡_实验_008_v3.md'),
    [
      '# 008 · StoryGraph v3',
      '',
      '## 结论',
      '',
      passed ? '通过：开局存在两条真实债务路线，并能汇合完成。'
        : '失败：保留反例，不回调故事目标。',
      '',
      '## 棋盘',
      '',
      `- 7×7，${boxes}车、${blacks}黑；`,
      `- ${ice}个冰门、0链/管/问号；`,
      '- 开局三个选择：`7/26`、`33/22`、`3/29`；',
      '- 轻债由`32/27`偿还，重债由`5/36`偿还；',
      '- 偿还后由第二个`7/26`汇合进入后续房间。',
      '',
      '## 验证',
      '',
      `- 全知${finalEval.solve.progress}%，峰值${finalEval.solve.maxBuffer}；`,
      `- 5局0复活PlayerSim全部${players.every(player => player.won) ? '通关' : '未全过'}；`,
      `- 路线多样性：${diversity};`,
      `- 删除冗余计时冰：${removedTimers}。`,
      ''
    ].join('\n') + '\n'
  );

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    board: report.board,
    openingMoves,
    branchEvidence,
    solve: report.solve,
    players: players.map(player => ({
      seed: player.seed,
      won: player.won,
      progress: player.progress,
      bufferPeak: player.bufferPeak,
      revivesUsed: player.revivesUsed,
      first12: player.first12.map(pick => pick.r + ',' + pick.c).join('>')
    })),
    diversity,
    distinctPlayerRoutes,
    checks
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
