#!/usr/bin/env node
'use strict';

/**
 * E6.7e: assign three readable roles to the v12 open frontier.
 *
 * Only six box-position swaps are applied. Capacity values, the black cells,
 * and the absence of obstacles stay unchanged.
 *
 * Roles:
 *   safe:  (0,3) 30/22 -> (1,3) 15/24
 *   light: (0,0) 31/31 -> (1,0) 17/26(debt 10) -> (2,0) 31/31
 *   heavy: (0,6) 30/23 -> (1,6) 34/25(debt 19) -> (2,6) 31/31
 *
 * The merge and the second checkpoint are deliberately not claimed by this
 * milestone.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v12/关卡_实验_006_v12.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v13');
const LEVEL_FILE = path.join(OUT, '关卡_实验_006_v13.json');
const DEBUG_FILE = path.join(OUT, '关卡_实验_006_v13.debug.json');
const REPORT_FILE = path.join(OUT, '关卡_实验_006_v13.md');
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

const ROLE_PATHS = {
  safe: [
    { r: 0, c: 3, car: '30/22', role: '选择安全入口' },
    { r: 1, c: 3, car: '15/24', role: '立即收满，不产生债务' }
  ],
  lightDebt: [
    { r: 0, c: 0, car: '31/31', role: '选择轻债入口' },
    { r: 1, c: 0, car: '17/26', role: '产生10像素债务' },
    { r: 2, c: 0, car: '31/31', role: '偿还并回到空暂存' }
  ],
  heavyDebt: [
    { r: 0, c: 6, car: '30/23', role: '选择长债入口' },
    { r: 1, c: 6, car: '34/25', role: '产生19像素债务' },
    { r: 2, c: 6, car: '31/31', role: '偿还并回到空暂存' }
  ]
};

const SWAPS = [
  [[0, 3], [0, 5]],
  [[1, 0], [6, 1]],
  [[1, 3], [3, 5]],
  [[1, 6], [5, 3]],
  [[2, 0], [6, 3]],
  [[2, 6], [6, 4]]
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
    vm.runInContext(
      fs.readFileSync(path.join(BIN, file), 'utf8'),
      sandbox,
      { filename: file }
    );
  }
  return sandbox.AntSolver;
}

function uniquePicks(run) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({
      r: pick.r,
      c: pick.c,
      color: pick.color,
      count: pick.count
    });
  }
  return out;
}

function poseKey(picks) {
  return picks
    .map(pick => pick.r + ',' + pick.c)
    .join('>');
}

function bufferState(state) {
  return state.buffer.map(item => ({
    color: item.color,
    remaining: item.need - item.progress,
    need: item.need,
    progress: item.progress,
    slot: item.slot
  }));
}

function capacityKey(level) {
  return level.board.cells
    .flat()
    .filter(cell => cell && cell.t === 'box')
    .map(cell => cell.color + '/' + cell.count)
    .sort()
    .join(',');
}

function spoolLabel(spool) {
  if (!spool || spool.id <= 0) return 'black-or-empty';
  return spool.id + '/' + spool.count;
}

function optionsAt(A, state) {
  return A.Simulator.listMoves(state)
    .filter(move => !move.blocked)
    .map(move => {
      const clone = A.SolverStrategy.cloneState(state);
      const before = clone.eliminatedPixels;
      clone.capOps = [];
      const applied = A.Simulator.applyPick(clone, move.r, move.c);
      return {
        r: move.r,
        c: move.c,
        color: move.antBox.color,
        count: move.antBox.count,
        canConsume: move.canConsume,
        consumed: clone.eliminatedPixels - before,
        bufferAfter: bufferState(clone),
        applied
      };
    });
}

function tracePath(A, level, id, path) {
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  state.capOps = [];
  const evidence = [];

  for (let index = 0; index < path.length; index++) {
    const step = path[index];
    const move = A.Simulator.listMoves(state)
      .find(item => item.r === step.r && item.c === step.c && !item.blocked);
    if (!move) {
      throw new Error(
        id + ' 第' + (index + 1) + '步不可取: ' + step.r + ',' + step.c
      );
    }
    const before = state.eliminatedPixels;
    state.capOps = [];
    const applied = A.Simulator.applyPick(state, step.r, step.c);
    if (!applied) {
      throw new Error(
        id + ' 第' + (index + 1) + '步 applyPick 失败: ' + step.r + ',' + step.c
      );
    }
    evidence.push({
      index: index + 1,
      r: step.r,
      c: step.c,
      expectedCar: step.car,
      role: step.role,
      color: move.antBox.color,
      count: move.antBox.count,
      canConsume: move.canConsume,
      consumed: state.eliminatedPixels - before,
      bufferAfter: bufferState(state),
      gameOver: !!state.gameOver,
      nextMoves: A.Simulator.listMoves(state)
        .filter(next => !next.blocked)
        .map(next => ({
          r: next.r,
          c: next.c,
          color: next.antBox.color,
          count: next.antBox.count,
          canConsume: next.canConsume
        }))
    });
  }

  return { id, path, evidence };
}

function hasDebt(trace, index, color, remaining) {
  return trace.evidence[index].bufferAfter.some(item =>
    item.color === color && item.remaining === remaining
  );
}

function hasMove(trace, index, r, c) {
  return trace.evidence[index].nextMoves.some(move =>
    move.r === r && move.c === c
  );
}

function main() {
  const A = loadSolver();
  const game = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const sourceLevel = A.parseLevel(A.fromGameFormat(game));
  const sourceCapacityKey = capacityKey(sourceLevel);

  const swapEvidence = SWAPS.map(([left, right]) => {
    const beforeLeft = spoolLabel(game.spools[left[0]][left[1]]);
    const beforeRight = spoolLabel(game.spools[right[0]][right[1]]);
    const temp = game.spools[left[0]][left[1]];
    game.spools[left[0]][left[1]] = game.spools[right[0]][right[1]];
    game.spools[right[0]][right[1]] = temp;
    return {
      left: left.join(','),
      right: right.join(','),
      beforeLeft,
      beforeRight,
      afterLeft: spoolLabel(game.spools[left[0]][left[1]]),
      afterRight: spoolLabel(game.spools[right[0]][right[1]])
    };
  });

  const level = A.parseLevel(A.fromGameFormat(game));
  const finalCapacityKey = capacityKey(level);

  const initial = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  initial.capture = true;
  const openingMoves = optionsAt(A, initial);

  const safe = tracePath(A, level, 'safe', ROLE_PATHS.safe);
  const light = tracePath(A, level, 'lightDebt', ROLE_PATHS.lightDebt);
  const heavy = tracePath(A, level, 'heavyDebt', ROLE_PATHS.heavyDebt);

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 30000 });
  const players = [];
  const playerPickLists = [];
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap
      });
      const picks = uniquePicks(run);
      playerPickLists.push(picks);
      players.push({
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        bufferPeak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        first12: picks.slice(0, 12)
      });
    }
  }

  const roundtrip = A.parseLevel(
    A.fromGameFormat(A.toGameFormat(level))
  );
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
  let minCapacity = Infinity;
  let maxCapacity = -Infinity;
  for (const row of level.board.cells) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.t === 'black') black++;
      if (cell.t === 'box') {
        boxes++;
        sum += cell.count;
        minCapacity = Math.min(minCapacity, cell.count);
        maxCapacity = Math.max(maxCapacity, cell.count);
        if (cell.numice > 0) ice++;
        if (cell.chain > 0) chain++;
        if (cell.q) question++;
      }
      if (cell.t === 'pipe') pipe++;
    }
  }

  const solvePicks = uniquePicks(solve);
  const routeKeys = new Set([poseKey(solvePicks.slice(0, 12))]);
  for (const picks of playerPickLists) {
    routeKeys.add(poseKey(picks.slice(0, 12)));
  }

  const lightDebtIndex = 1;
  const heavyDebtIndex = 1;
  const checks = {
    capacityMultisetPreserved: sourceCapacityKey === finalCapacityKey,
    capacityContract: boxes === 47 && sum === 1225 &&
      minCapacity >= 20 && maxCapacity <= 40,
    boardContract: boxes === 47 && black === 2,
    noObstacles: ice === 0 && chain === 0 && pipe === 0 && question === 0,
    openingHasSevenFullChoices: openingMoves.length === 7 &&
      openingMoves.every(move =>
        move.canConsume && move.bufferAfter.length === 0),
    openingContainsThreeRoles:
      openingMoves.some(move => move.r === 0 && move.c === 3 && move.color === 30 && move.count === 22) &&
      openingMoves.some(move => move.r === 0 && move.c === 0 && move.color === 31 && move.count === 31) &&
      openingMoves.some(move => move.r === 0 && move.c === 6 && move.color === 30 && move.count === 23),
    safeHasNoDebt:
      safe.evidence.every(step => step.bufferAfter.length === 0),
    lightDebtAppearsAfterChoice:
      light.evidence[0].bufferAfter.length === 0 &&
      hasDebt(light, lightDebtIndex, 17, 10),
    lightReleaseVisible:
      hasMove(light, lightDebtIndex, 2, 0) &&
      light.evidence[2].bufferAfter.length === 0,
    heavyDebtAppearsAfterChoice:
      heavy.evidence[0].bufferAfter.length === 0 &&
      hasDebt(heavy, heavyDebtIndex, 34, 19),
    heavyReleaseVisible:
      hasMove(heavy, heavyDebtIndex, 2, 6) &&
      heavy.evidence[2].bufferAfter.length === 0,
    solvePass: solve.completed && solve.progress === 100,
    playersPass: players.every(run =>
      run.won && run.progress === 100),
    noRevivePass: players
      .filter(run => run.reviveCap === 0)
      .every(run => run.revivesUsed === 0),
    routeDiversity: routeKeys.size >= 2,
    roundtripPass: roundtripSolve.completed === true
  };
  const passed = Object.values(checks).every(Boolean);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    LEVEL_FILE,
    JSON.stringify(A.toGameFormat(level), null, 2) + '\n'
  );
  const sha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(LEVEL_FILE))
    .digest('hex');

  const report = {
    schema: '006-role-entries-v1',
    status: passed ? 'ROLE_ENTRY_PASS' : 'ROLE_ENTRY_FAIL',
    source: SOURCE,
    gameFormat: LEVEL_FILE,
    sha256,
    board: {
      rows: 7,
      cols: 7,
      boxes,
      black,
      ice,
      chain,
      pipe,
      question,
      capacityMin: minCapacity,
      capacityMax: maxCapacity,
      capacitySum: sum
    },
    swaps: swapEvidence,
    roleGraph: {
      opening: '7个无冰、立即收满的入口',
      roles: ROLE_PATHS,
      mergePending: true,
      secondCheckpointPending: true
    },
    openingMoves,
    evidence: {
      safe,
      lightDebt: light,
      heavyDebt: heavy
    },
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer,
      first12: solvePicks.slice(0, 12)
    },
    players: players.map(player => ({
      seed: player.seed,
      reviveCap: player.reviveCap,
      won: player.won,
      progress: player.progress,
      bufferPeak: player.bufferPeak,
      revivesUsed: player.revivesUsed,
      first12: player.first12
    })),
    routeDiversity: routeKeys.size,
    checks
  };
  fs.writeFileSync(DEBUG_FILE, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(
    REPORT_FILE,
    [
      '# 006 · Role Entries v13',
      '',
      '## 结论',
      '',
      passed
        ? '通过：开放入口已分配安全、轻债、长债三种可回放职责。'
        : '失败：保留证据，不继续加冰。',
      '',
      '## 三条职责',
      '',
      '- 安全：`(0,3) 30/22 → (1,3) 15/24`，全程不产生债务；',
      '- 轻债：`(0,0) 31/31 → (1,0) 17/26欠10 → (2,0) 31/31`；',
      '- 长债：`(0,6) 30/23 → (1,6) 34/25欠19 → (2,6) 31/31`。',
      '',
      '## 未完成',
      '',
      '- 三组路线尚未汇合；',
      '- 第二处真实卡点尚未设计；',
      '- 本轮不通过新增障碍补故事，不改变容量合同。',
      '',
      '## 验证',
      '',
      `- 7×7、${boxes}车、${black}黑；`,
      `- ${ice}冰、${chain}链、${pipe}管道、${question}问号；`,
      `- 开局${openingMoves.length}个无冰入口，全部立即收满；`,
      `- 全知${solve.progress}%，峰值${solve.maxBuffer}；`,
      `- 默认/0复活共${players.filter(run => run.won).length}/${players.length}局通关，0复活局无复活；`,
      `- 路线多样性：${routeKeys.size}；`,
      `- SHA-256：\`${sha256}\`。`,
      ''
    ].join('\n') + '\n'
  );

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    sha256,
    board: report.board,
    openingMoves: openingMoves.map(move => ({
      r: move.r,
      c: move.c,
      car: move.color + '/' + move.count,
      canConsume: move.canConsume,
      bufferAfter: move.bufferAfter
    })),
    roles: {
      safe: safe.evidence.map(step => ({
        r: step.r,
        c: step.c,
        car: step.color + '/' + step.count,
        bufferAfter: step.bufferAfter
      })),
      lightDebt: light.evidence.map(step => ({
        r: step.r,
        c: step.c,
        car: step.color + '/' + step.count,
        bufferAfter: step.bufferAfter
      })),
      heavyDebt: heavy.evidence.map(step => ({
        r: step.r,
        c: step.c,
        car: step.color + '/' + step.count,
        bufferAfter: step.bufferAfter
      }))
    },
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer
    },
    players: players.map(player => ({
      seed: player.seed,
      reviveCap: player.reviveCap,
      won: player.won,
      progress: player.progress,
      bufferPeak: player.bufferPeak,
      revivesUsed: player.revivesUsed
    })),
    routeDiversity: routeKeys.size,
    checks
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
