#!/usr/bin/env node
'use strict';

/**
 * E6.7d: zero-ice open-start prototype for 006.
 *
 * This deliberately fixes only the opening defect:
 *   - no ice anywhere;
 *   - all seven top-row cars are visible and immediately consumable;
 *   - the accepted v8 capacity multiset and black blocks are preserved.
 *
 * This is not yet the final StoryGraph. It is the baseline needed before
 * assigning branch roles.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v8/关卡_实验_v8.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v12');
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

function main() {
  const A = loadSolver();
  const game = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const sourceLevel = A.parseLevel(A.fromGameFormat(game));
  const originalKey = sourceLevel.board.cells
    .flat()
    .filter(cell => cell && cell.t === 'box')
    .map(cell => cell.color + '/' + cell.count)
    .sort()
    .join(',');

  // Seven full cars form the visible opening frontier.
  const topTypes = [
    [31, 31],
    [31, 31],
    [31, 30],
    [5, 21],
    [31, 30],
    [30, 22],
    [30, 23]
  ];
  const pool = [];
  for (let r = 1; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const spool = game.spools[r][c];
      if (spool.id > 0) pool.push({ r, c, spool, claimed: false });
    }
  }

  for (let c = 0; c < 7; c++) {
    const [id, count] = topTypes[c];
    const source = pool.find(item =>
      !item.claimed && item.spool.id === id && item.spool.count === count);
    if (!source) throw new Error('缺少顶层容量: ' + id + '/' + count);
    source.claimed = true;
    const displaced = game.spools[0][c];
    game.spools[0][c] = source.spool;
    game.spools[source.r][source.c] = displaced;
  }

  // No ice, chain, pipe or question mark is introduced.
  for (const row of game.spools) {
    for (const spool of row) {
      if (spool.id > 0 && (spool.type === 7 || (Array.isArray(spool.type) && spool.type.includes(7)))) {
        spool.type = Array.isArray(spool.type)
          ? spool.type.filter(type => type !== 7)
          : 0;
        if (Array.isArray(spool.type) && spool.type.length === 1) spool.type = spool.type[0];
        spool.param = 0;
      }
    }
  }

  const level = A.parseLevel(A.fromGameFormat(game));
  const finalKey = level.board.cells
    .flat()
    .filter(cell => cell && cell.t === 'box')
    .map(cell => cell.color + '/' + cell.count)
    .sort()
    .join(',');

  const opening = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  opening.capture = true;
  const openingMoves = A.Simulator.listMoves(opening)
    .filter(move => !move.blocked)
    .map(move => {
      const clone = A.SolverStrategy.cloneState(opening);
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
        bufferAfter: clone.buffer.length
      };
    });

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 30000 });
  const players = [];
  for (const seed of [7, 1009, 2027, 41, 99]) {
    players.push(A.PlayerSim.run(level, {
      seed,
      instantChain: true,
      reviveCap: 0
    }));
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

  const solvePicks = uniquePicks(solve);
  const routeKeys = new Set([poseKey(solvePicks.slice(0, 12))]);
  for (const run of players) routeKeys.add(poseKey(uniquePicks(run).slice(0, 12)));
  const checks = {
    capacityMultisetPreserved: originalKey === finalKey,
    capacityContract: boxes === 47 && sum === 1225 &&
      level.board.cells.flat().filter(cell => cell && cell.t === 'box')
        .every(cell => cell.count >= 20 && cell.count <= 40),
    boardContract: boxes === 47 && black === 2,
    noObstacles: ice === 0 && chain === 0 && pipe === 0 && question === 0,
    openingHasSevenFullChoices: openingMoves.length === 7 &&
      openingMoves.every(move => move.canConsume && move.bufferAfter === 0),
    solvePass: solve.completed && solve.progress === 100,
    playersPass: players.every(run =>
      run.won && run.progress === 100 && run.revivesUsed === 0),
    routeDiversity: routeKeys.size >= 2,
    roundtripPass: roundtripSolve.completed === true
  };
  const passed = Object.values(checks).every(Boolean);

  const report = {
    schema: '006-open-start-v1',
    status: passed ? 'OPEN_START_PASS' : 'OPEN_START_FAIL',
    source: SOURCE,
    gameFormat: path.join(OUT, '关卡_实验_006_v12.json'),
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
    openingMoves,
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer,
      first12: solvePicks.slice(0, 12)
    },
    players: players.map(run => ({
      seed: run.seed,
      won: run.won,
      progress: run.progress,
      bufferPeak: run.bufferPeak,
      revivesUsed: run.revivesUsed,
      first12: uniquePicks(run).slice(0, 12)
    })),
    routeDiversity: routeKeys.size,
    checks
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    report.gameFormat,
    JSON.stringify(A.toGameFormat(level), null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, '关卡_实验_006_v12.debug.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, '关卡_实验_006_v12.md'),
    [
      '# 006 · Open Start v12',
      '',
      '## 结论',
      '',
      passed ? '通过：零冰开局，顶层七个动作全部可立即收满。'
        : '失败：保留反例。',
      '',
      '## 开局',
      '',
      '- 7×7、47车、2黑；',
      '- 0冰、0链、0管道、0问号；',
      '- 顶层7个动作全部可见、可操作且立即收满。',
      '',
      '## 验证',
      '',
      `- 全知${solve.progress}%，峰值${solve.maxBuffer}；`,
      `- 5局0复活PlayerSim全部${players.every(run => run.won) ? '通关' : '未全过'}；`,
      `- 路线多样性：${routeKeys.size}。`,
      ''
    ].join('\n') + '\n'
  );

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    board: report.board,
    openingMoves,
    solve: report.solve,
    players: report.players.map(player => ({
      seed: player.seed,
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
