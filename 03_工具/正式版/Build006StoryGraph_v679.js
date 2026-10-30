#!/usr/bin/env node
'use strict';

/**
 * E6.7c: 006 StoryGraph v11.
 *
 * Minimal re-layout of the accepted v8 board:
 *   - 30/22 teaches;
 *   - then three choices are visible at once:
 *       15/24 safe, 17/26 light debt, 34/25 heavy debt;
 *   - 31/30 releases the light debt from the left branch;
 *   - 31/31 is the heavy-debt exit and starts behind a 3-action ice gate;
 *   - all other top-row cells remain delayed together, not one by one.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v8/关卡_实验_v8.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v11');
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

function bufferState(state) {
  return state.buffer.map(item => ({
    color: item.color,
    remaining: item.need - item.progress,
    slot: item.slot
  }));
}

function main() {
  const A = loadSolver();
  const game = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const sourceLevel = A.parseLevel(A.fromGameFormat(game));
  const sourceCapacityKey = sourceLevel.board.cells
    .flat()
    .filter(cell => cell && cell.t === 'box')
    .map(cell => cell.color + '/' + cell.count)
    .sort()
    .join(',');

  // Move one 31/31 from the bottom row to the right branch exit. No capacity
  // value is rewritten; the multiset is preserved.
  let temp = game.spools[0][4];
  game.spools[0][4] = game.spools[6][1];
  game.spools[6][1] = temp;

  function setIce(r, c, value) {
    const spool = game.spools[r][c];
    if (!spool || spool.id <= 0) throw new Error('冰门不是车辆: ' + r + ',' + c);
    spool.type = value > 0 ? 7 : 0;
    spool.param = value > 0 ? value : 0;
  }

  // The three choices unlock together after the teaching car.
  setIce(0, 0, 1); // 17/26 light debt
  setIce(0, 1, 1); // 15/24 safe choice
  setIce(0, 3, 1); // 34/25 heavy debt
  // The heavy branch needs one extra action before its release becomes usable.
  setIce(0, 4, 3); // 31/31 delayed release
  // Other top-row alternatives also wait until the first decision is made.
  setIce(0, 5, 3);
  setIce(0, 6, 3);

  const level = A.parseLevel(A.fromGameFormat(game));
  const finalCapacityKey = level.board.cells
    .flat()
    .filter(cell => cell && cell.t === 'box')
    .map(cell => cell.color + '/' + cell.count)
    .sort()
    .join(',');

  function optionsAt(state) {
    return A.Simulator.listMoves(state)
      .filter(move => !move.blocked)
      .map(move => {
        const clone = A.SolverStrategy.cloneState(state);
        const before = clone.eliminatedPixels;
        clone.capOps = [];
        A.Simulator.applyPick(clone, move.r, move.c);
        return {
          r: move.r,
          c: move.c,
          color: move.antBox.color,
          count: move.antBox.count,
          canConsume: move.canConsume,
          consumed: clone.eliminatedPixels - before,
          bufferAfter: bufferState(clone)
        };
      });
  }

  const initial = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  initial.capture = true;
  const initialOptions = optionsAt(initial);

  const afterTeach = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  afterTeach.capture = true;
  afterTeach.capOps = [];
  A.Simulator.applyPick(afterTeach, 0, 2);
  const teachOptions = optionsAt(afterTeach);

  function replay(path) {
    const state = A.Simulator.createState(level, {
      useSlotStart: true,
      instantChain: true
    });
    state.capture = true;
    const evidence = [];
    for (const [r, c] of path) {
      const move = A.Simulator.listMoves(state)
        .find(item => item.r === r && item.c === c && !item.blocked);
      if (!move) throw new Error('动作不可取: ' + r + ',' + c);
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
    return { state, evidence };
  }

  const light = replay([[0, 2], [0, 0], [1, 0]]);
  const heavyBeforeRelease = replay([[0, 2], [0, 3]]);
  const heavyReleaseLocked = A.Simulator.isNumIceLocked(heavyBeforeRelease.state, 0, 4);
  const heavyWindow = optionsAt(heavyBeforeRelease.state);
  const heavyViaSafe = replay([[0, 2], [0, 3], [0, 1], [0, 4]]);
  const safe = replay([[0, 2], [0, 1]]);

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 30000 });
  const players = [];
  for (const seed of [7, 1009, 2027, 41, 99]) {
    players.push(A.PlayerSim.run(level, {
      seed,
      instantChain: true,
      reviveCap: 0
    }));
  }

  let boxes = 0;
  let black = 0;
  let ice = 0;
  let chain = 0;
  let pipe = 0;
  let question = 0;
  let sum = 0;
  for (const row of level.board.cells) {
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

  const checks = {
    capacityMultisetPreserved: sourceCapacityKey === finalCapacityKey,
    capacityContract: boxes === 47 && sum === 1225 &&
      level.board.cells.flat().filter(cell => cell && cell.t === 'box')
        .every(cell => cell.count >= 20 && cell.count <= 40),
    boardContract: boxes === 47 && black === 2,
    obstacleContract: chain === 0 && pipe === 0 && question === 0,
    initialOnlyTeach: initialOptions.length === 1 &&
      initialOptions[0].r === 0 && initialOptions[0].c === 2,
    teachShowsThreeRoutes: teachOptions.length === 3 &&
      teachOptions.some(x => x.r === 0 && x.c === 0 && x.color === 17) &&
      teachOptions.some(x => x.r === 0 && x.c === 1 && x.color === 15 && x.canConsume) &&
      teachOptions.some(x => x.r === 0 && x.c === 3 && x.color === 34),
    lightDebt: light.evidence[1].bufferAfter
      .some(x => x.color === 17 && x.remaining === 10),
    lightRelease: light.evidence[2].bufferAfter.length === 0,
    heavyDebt: heavyBeforeRelease.evidence[1].bufferAfter
      .some(x => x.color === 34 && x.remaining === 19),
    heavyReleaseDelayed: heavyReleaseLocked,
    safeChoiceNoDebt: safe.evidence[1].bufferAfter.length === 0,
    heavyReleaseAfterChoice: heavyViaSafe.evidence[3].bufferAfter.length === 0,
    solvePass: solve.completed && solve.progress === 100,
    playersPass: players.every(run =>
      run.won && run.progress === 100 && run.revivesUsed === 0)
  };
  const passed = Object.values(checks).every(Boolean);

  const report = {
    schema: '006-story-graph-v11',
    status: passed ? 'STORY_GRAPH_PASS' : 'STORY_GRAPH_FAIL',
    source: SOURCE,
    gameFormat: path.join(OUT, '关卡_实验_006_v11.json'),
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
    storyGraph: {
      teach: '30/22',
      choices: [
        { id: 'safe', move: '0,1', car: '15/24', result: '立即收满' },
        { id: 'lightDebt', move: '0,0', car: '17/26', debt: 10, release: '1,0 31/30' },
        { id: 'heavyDebt', move: '0,3', car: '34/25', debt: 19, release: '0,4 31/31', iceDelay: 3 }
      ],
      merge: '后续R59/R65区域'
    },
    initialOptions,
    teachOptions,
    heavyWindow,
    evidence: {
      safe,
      light,
      heavyBeforeRelease,
      heavyViaSafe
    },
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer,
      first12: uniquePicks(solve).slice(0, 12)
    },
    players: players.map(run => ({
      seed: run.seed,
      won: run.won,
      progress: run.progress,
      bufferPeak: run.bufferPeak,
      revivesUsed: run.revivesUsed,
      first12: uniquePicks(run).slice(0, 12)
    })),
    checks
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    report.gameFormat,
    JSON.stringify(A.toGameFormat(level), null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, '关卡_实验_006_v11.debug.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, '关卡_实验_006_v11.md'),
    [
      '# 006 · StoryGraph v11',
      '',
      '## 结论',
      '',
      passed ? '通过：教学后同时出现安全、轻债、重债三种选择。'
        : '失败：保留反例，不继续堆冰。',
      '',
      '## 三个选择',
      '',
      '- 安全：`15/24`立即收满；',
      '- 轻债：`17/26欠10`，左支路`31/30`偿还；',
      '- 重债：`34/25欠19`，右支路`31/31`偿还，且初始带3步冰门。',
      '',
      '## 冰的职责',
      '',
      '- 三个起手选择用同一个1步门解锁，完成教学后同时出现；',
      '- 冰只额外延迟重债的偿还出口，不封锁安全或轻债路径。',
      '',
      '## 验证',
      '',
      `- 7×7，${boxes}车、${black}黑、${ice}冰；`,
      `- 全知${solve.progress}%，峰值${solve.maxBuffer}；`,
      `- 5局0复活PlayerSim全部${players.every(run => run.won) ? '通关' : '未全过'}。`,
      ''
    ].join('\n') + '\n'
  );

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    board: report.board,
    initialOptions,
    teachOptions,
    heavyWindow,
    heavyReleaseLocked,
    solve: report.solve,
    players: report.players.map(player => ({
      seed: player.seed,
      won: player.won,
      progress: player.progress,
      bufferPeak: player.bufferPeak,
      revivesUsed: player.revivesUsed,
      first12: player.first12.map(pick => pick.r + ',' + pick.c).join('>')
    })),
    checks
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
