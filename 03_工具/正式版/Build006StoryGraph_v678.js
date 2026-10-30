#!/usr/bin/env node
'use strict';

/**
 * E6.7b: first StoryGraph prototype for target 006.
 *
 * Opening:
 *   30/22 teach
 *   -> 17/26 debt 10 OR 34/25 debt 19
 *   -> either debt is released by 31/30
 *   -> continue into spatial choice rooms
 *
 * Unlike v8, the opening forbids five simultaneous debt cards. Unlike 008 v3,
 * this level is built on 006's clearer quadrant structure and retains the
 * accepted R59/R65 target dependencies in the capacity plan.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v8/关卡_实验_v8.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v10');
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
  const source = A.parseLevel(A.fromGameFormat(JSON.parse(fs.readFileSync(SOURCE, 'utf8'))));
  const blocks = source.blocks;
  const capacityMultiset = [];
  for (const row of source.board.cells) {
    for (const cell of row) {
      if (cell && cell.t === 'box') {
        capacityMultiset.push({ color: cell.color, count: cell.count });
      }
    }
  }
  if (capacityMultiset.length !== 47) throw new Error('006容量集合不是47车');

  const common = (
    '31/31 31/31 31/31 5/40 31/31 17/25 31/30 13/28 ' +
    '31/30 15/25 15/25 15/25 14/23 30/23 30/23 30/23 ' +
    '14/22 33/21 28/23 15/24 15/24 21/36 31/30 17/25 ' +
    '28/23 30/22 31/30 14/22 5/21'
  ).split(' ').map(text => {
    const [color, count] = text.split('/').map(Number);
    return { color, count };
  });

  const remaining = (
    '34/25 22/35 13/27 28/23 33/20 5/21 14/22 ' +
    '15/24 15/24 4/40 4/21 30/22 31/30 5/21'
  ).split(' ').map(text => {
    const [color, count] = text.split('/').map(Number);
    return { color, count };
  });

  const start = { color: 30, count: 22 };
  const lightDebt = { color: 17, count: 26 };
  const heavyDebt = { color: 34, count: 25 };
  const sharedRelease = { color: 31, count: 30 };

  const available = capacityMultiset.slice();
  function take(cap, count) {
    for (let n = 0; n < (count || 1); n++) {
      const index = available.findIndex(item =>
        item.color === cap.color && item.count === cap.count);
      if (index < 0) throw new Error('容量不存在: ' + cap.color + '/' + cap.count);
      available.splice(index, 1);
    }
  }
  take(start);
  take(lightDebt);
  take(heavyDebt);
  take(sharedRelease);

  const continuation = common.concat(remaining);
  for (const cap of continuation) take(cap);
  if (available.length !== 0) {
    throw new Error('006容量未完全分配，剩余 ' + available.length);
  }

  const black = new Set(['1,1', '1,2']);
  const cells = Array.from({ length: 7 }, () => Array(7).fill(null));
  for (const key of black) {
    const [r, c] = key.split(',').map(Number);
    cells[r][c] = { t: 'black' };
  }

  function put(r, c, cap, ice) {
    cells[r][c] = {
      t: 'box',
      color: cap.color,
      count: cap.count,
      chain: 0,
      q: false,
      numice: ice || 0
    };
  }

  // The teaching car is the only selectable cell at tick 0. Both debts open
  // after it; the shared release opens after the debt pick.
  put(0, 2, start, 0);
  put(0, 1, lightDebt, 1);
  put(0, 3, heavyDebt, 1);
  put(0, 0, sharedRelease, 2);

  const used = new Set(['0,2', '0,1', '0,3', '0,0']);
  for (const key of black) used.add(key);
  const free = [];
  for (let r = 0; r < 7; r++) {
    const cols = r % 2 === 0
      ? Array.from({ length: 7 }, (_, i) => i)
      : Array.from({ length: 7 }, (_, i) => 6 - i);
    for (const c of cols) if (!used.has(r + ',' + c)) free.push([r, c]);
  }
  if (free.length !== continuation.length) {
    throw new Error('006后续格数不一致: ' + free.length + '/' + continuation.length);
  }

  const roomSizes = [3, 5, 5, 5, 5, 5, 5, 5, 5];
  const rooms = [];
  let cursor = 0;
  let unlockAt = 3;
  for (const size of roomSizes) {
    const room = [];
    for (let i = 0; i < size; i++, cursor++) {
      const [r, c] = free[cursor];
      const cap = continuation[cursor];
      put(r, c, cap, unlockAt);
      room.push({ r, c, color: cap.color, count: cap.count, unlockAt });
    }
    rooms.push({ startStep: unlockAt + 1, size, room });
    unlockAt += size;
  }
  if (cursor !== continuation.length) throw new Error('006房间分配不完整');

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
    const players = [];
    if (includePlayers) {
      for (const seed of [7, 1009, 2027, 41, 99]) {
        players.push(A.PlayerSim.run(level, {
          seed,
          instantChain: true,
          reviveCap: 0
        }));
      }
    }
    return { level, solve, players };
  }

  function openingChoices() {
    const state = A.Simulator.createState(buildLevel(), {
      useSlotStart: true,
      instantChain: true
    });
    state.capture = true;
    state.capOps = [];
    if (!A.Simulator.applyPick(state, 0, 2)) return [];
    return A.Simulator.listMoves(state)
      .filter(move => !move.blocked)
      .map(move => ({
        r: move.r,
        c: move.c,
        color: move.antBox.color,
        count: move.antBox.count,
        canConsume: move.canConsume
      }));
  }

  function openingIsAuthored() {
    const moves = openingChoices();
    return moves.length === 2 &&
      moves.some(move => move.r === 0 && move.c === 1 &&
        move.color === 17 && move.count === 26) &&
      moves.some(move => move.r === 0 && move.c === 3 &&
        move.color === 34 && move.count === 25);
  }

  function diversityOf(result) {
    const keys = new Set();
    for (const run of [result.solve, ...result.players]) {
      keys.add(poseKey(uniquePicks(run).slice(0, 10)));
    }
    return keys.size;
  }

  function valid(result) {
    if (!result.solve.completed || result.solve.progress !== 100) return false;
    if (!result.players.every(run =>
      run.won && run.progress === 100 && run.revivesUsed === 0)) return false;
    if (!openingIsAuthored()) return false;
    return diversityOf(result) >= 2;
  }

  let removedTimers = 0;
  let prunePasses = 0;
  let changed = true;
  while (changed && prunePasses < 3) {
    changed = false;
    prunePasses++;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const cell = cells[r][c];
        if (!cell || cell.t !== 'box' || !cell.numice) continue;
        if (r === 0 && (c === 0 || c === 1 || c === 3)) continue;
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
  const openingMoves = openingChoices();

  const branchEvidence = [];
  for (const branch of [
    { name: 'lightDebt', debt: [0, 1], expected: 10 },
    { name: 'heavyDebt', debt: [0, 3], expected: 19 }
  ]) {
    const state = A.Simulator.createState(finalLevel, {
      useSlotStart: true,
      instantChain: true
    });
    state.capture = true;
    const actions = [[0, 2], branch.debt, [0, 0]];
    const evidence = [];
    for (const [r, c] of actions) {
      const move = A.Simulator.listMoves(state)
        .find(item => item.r === r && item.c === c && !item.blocked);
      if (!move) throw new Error(branch.name + '动作不可取: ' + r + ',' + c);
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
    branchEvidence.push({ name: branch.name, expectedDebt: branch.expected, evidence });
  }

  const solvePicks = uniquePicks(finalEval.solve);
  const players = finalEval.players.map(run => ({
    seed: run.seed,
    won: run.won,
    progress: run.progress,
    bufferPeak: run.bufferPeak,
    revivesUsed: run.revivesUsed,
    first10: uniquePicks(run).slice(0, 10)
  }));
  const playerRoutes = new Set(players.map(player => poseKey(player.first10))).size;
  const diversity = diversityOf(finalEval);

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
    openingHasTwoChoices: openingIsAuthored(),
    lightDebt: branchEvidence[0].evidence[1].bufferAfter
      .some(item => item.color === 17 && item.remaining === 10),
    lightRelease: branchEvidence[0].evidence[2].bufferAfter.length === 0,
    heavyDebt: branchEvidence[1].evidence[1].bufferAfter
      .some(item => item.color === 34 && item.remaining === 19),
    heavyRelease: branchEvidence[1].evidence[2].bufferAfter.length === 0,
    solvePass: finalEval.solve.completed && finalEval.solve.progress === 100,
    playersPass: players.every(player =>
      player.won && player.progress === 100 && player.revivesUsed === 0),
    routeDiversity: diversity >= 2,
    playerRouteDiversity: playerRoutes >= 1
  };
  const passed = Object.values(checks).every(Boolean);

  const report = {
    schema: '006-story-graph-v1',
    status: passed ? 'STORY_GRAPH_PASS' : 'STORY_GRAPH_FAIL',
    source: SOURCE,
    gameFormat: path.join(OUT, '关卡_实验_006_v10.json'),
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
        teach: '30/22',
        choices: [
          { id: 'lightDebt', debt: '17/26欠10' },
          { id: 'heavyDebt', debt: '34/25欠19' }
        ],
        sharedRelease: '31/30'
      },
      rooms
    },
    openingMoves,
    branchEvidence,
    solve: {
      completed: finalEval.solve.completed,
      progress: finalEval.solve.progress,
      bufferPeak: finalEval.solve.maxBuffer,
      first10: solvePicks.slice(0, 10)
    },
    players,
    diversity,
    playerRoutes,
    checks
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    report.gameFormat,
    JSON.stringify(A.toGameFormat(finalLevel), null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, '关卡_实验_006_v10.debug.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, '关卡_实验_006_v10.md'),
    [
      '# 006 · StoryGraph v10',
      '',
      '## 结论',
      '',
      passed ? '通过：教学后出现轻/重两笔真实债务，共用偿还车。'
        : '失败：保留反例，不继续堆障碍。',
      '',
      '## 开局',
      '',
      '- 教学：`30/22`；',
      '- 轻债：`17/26欠10`；',
      '- 重债：`34/25欠19`；',
      '- 共用偿还：`31/30`。',
      '',
      '## 棋盘',
      '',
      `- 7×7，${boxes}车、${blacks}黑、${ice}冰；`,
      '- 0链、0管道、0问号；',
      `- 删除逐步计时冰：${removedTimers}。`,
      '',
      '## 验证',
      '',
      `- 全知${finalEval.solve.progress}%，峰值${finalEval.solve.maxBuffer}；`,
      `- 5局0复活PlayerSim全部${players.every(player => player.won) ? '通关' : '未全过'}；`,
      `- 路线多样性：${diversity}；`,
      `- 玩家内部路线多样性：${playerRoutes}。`,
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
      first10: player.first10.map(pick => pick.r + ',' + pick.c).join('>')
    })),
    diversity,
    playerRoutes,
    checks
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
