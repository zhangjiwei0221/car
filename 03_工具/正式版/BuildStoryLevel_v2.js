#!/usr/bin/env node
'use strict';

/**
 * 006 StoryPlan v2 prototype.
 *
 * A controlled board over the same 49-car plan:
 *   - 30/22 entry at (0,3)
 *   - 15/24 hollow at (1,3)
 *   - 17/26 debt at (2,3)
 *   - 31/30 release at (3,3)
 *   - two corner black cells keep the entry focused
 *
 * It is an experimental story board, not a production strategy.
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

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function boxOf(car) {
  return { t: 'box', color: car.color, count: car.count, chain: 0, q: false, numice: 0 };
}

function takeCar(cars, color, count) {
  const i = cars.findIndex(b => b.color === color && b.count === count);
  if (i < 0) throw new Error('缺少故事车辆 ' + color + '/' + count);
  return cars.splice(i, 1)[0];
}

function compactSolve(sr) {
  return {
    completed: !!sr.completed,
    progress: sr.progress,
    steps: sr.steps,
    completedBoxes: sr.completedBoxes,
    totalBoxes: sr.totalBoxes,
    maxBuffer: sr.maxBuffer,
    avgBuffer: sr.avgBuffer,
    pickOrder: sr.pickOrder
  };
}

function compactPlayer(seed, p) {
  return {
    seed,
    won: !!p.won,
    progress: p.progress,
    completedBoxes: p.completedBoxes,
    totalBoxes: p.totalBoxes,
    bufferPeak: p.bufferPeak,
    playerAvgBuffer: p.playerAvgBuffer,
    picks: p.picks,
    stalledAtEnd: p.stalledAtEnd
  };
}

function main() {
  const target = path.resolve(arg('--target', '实验关/关卡6/35x35拼接图纸_006.txt'));
  const outDir = path.resolve(arg('--out-dir', '实验关/关卡6/原型_v2'));
  const variant = Math.max(2, parseInt(arg('--variant', '2'), 10) || 2);
  const label = variant >= 6 ? 'v6' : variant >= 5 ? 'v5' : variant >= 4 ? 'v4' : variant >= 3 ? 'v3' : 'v2';
  const A = loadSolver();
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(target, 'utf8'));
  const plan = A.InstantPlayout.plan(
    { blocks, rows: blocks.length, cols: blocks[0].length, bufferLimit: 5 },
    {
      boxSizeMin: 20,
      boxSizeMax: 40,
      bufferLimit: 5,
      ruleMode: 'instantChain',
      instantChain: true,
      instantPlanPolicy: 'shortDebt',
      targetCarCount: 49
    }
  );
  if (!plan.ok || !plan.boxes || plan.boxes.length !== 49) {
    throw new Error('49车 InstantPlayout 失败: ' + (plan.reason || ''));
  }

  const cars = plan.boxes.map((b, i) => ({
    color: b.color,
    count: b.count,
    originIndex: i
  }));
  const storyCars = [
    takeCar(cars, 30, 22),
    takeCar(cars, 15, 24),
    takeCar(cars, 17, 26),
    takeCar(cars, 31, 30)
  ];

  // Reduce 49 cars to 47 by deterministic same-color merges, keeping all sums.
  const merged = [];
  cars.sort((a, b) => a.color - b.color || a.count - b.count);
  let pairs = 0;
  for (let i = 0; i < cars.length && pairs < 2;) {
    let didMerge = false;
    for (let j = i + 1; j < cars.length; j++) {
      if (cars[i].color === cars[j].color && cars[i].count + cars[j].count <= 40) {
        merged.push({
          color: cars[i].color,
          count: cars[i].count + cars[j].count,
          originIndex: cars[i].originIndex
        });
        cars.splice(j, 1);
        cars.splice(i, 1);
        pairs++;
        didMerge = true;
        break;
      }
    }
    if (!didMerge) i++;
  }
  if (pairs !== 2) throw new Error('无法确定性地合并到47辆车');

  const rest = merged.concat(cars);
  const chainAt = new Map([
    ['0,3', storyCars[0]],
    ['1,3', storyCars[1]],
    ['2,3', storyCars[2]],
    ['3,3', storyCars[3]]
  ]);
  const cells = [];
  let restIndex = 0;
  for (let r = 0; r < 7; r++) {
    const row = [];
    for (let c = 0; c < 7; c++) {
      const key = r + ',' + c;
      if (r === 0 && (c === 0 || c === 6)) {
        row.push({ t: 'black' });
      } else if (chainAt.has(key)) {
        row.push(boxOf(chainAt.get(key)));
      } else {
        const car = rest[restIndex++];
        row.push(car ? boxOf(car) : null);
      }
    }
    cells.push(row);
  }
  const board = { rows: 7, cols: 7, cells };
  let baseLevel = A.parseLevel({ blocks, bufferLimit: 5, board });
  if (variant >= 3) {
    let topSupport = [[0, 1], [0, 2], [0, 4], [0, 5]];
    let zeroSource = 'initial';
    if (variant >= 4) {
      // Move the two corner blocks to the sides of the hollow car. The
      // displaced cars return to the top corners, preserving count and sum.
      const guardA = cells[1][2];
      const guardB = cells[1][4];
      cells[1][2] = { t: 'black' };
      cells[1][4] = { t: 'black' };
      cells[0][0] = guardA;
      cells[0][6] = guardB;
      topSupport = [[0, 0], [0, 1], [0, 2], [0, 4], [0, 5], [0, 6]];
      zeroSource = 'after-entry-hollow';
      baseLevel = A.parseLevel({ blocks, bufferLimit: 5, board });
    }
    const zeroState = zeroSource === 'after-entry-hollow'
      ? A.Simulator.createState({
        blocks,
        rows: blocks.length,
        cols: blocks[0].length,
        totalPixels: 1225,
        totalBoxes: 49,
        bufferLimit: 5,
        board: { rows: 0, cols: 0, cells: [] }
      }, { useSlotStart: true, instantChain: true })
      : A.Simulator.createState(baseLevel, {
        useSlotStart: true,
        instantChain: true
      });
    if (zeroSource === 'after-entry-hollow') {
      A.Simulator.processAntBox(zeroState, { color: 30, count: 22, chain: 0, q: false, numice: 0 });
      A.Simulator.processAntBox(zeroState, { color: 15, count: 24, chain: 0, q: false, numice: 0 });
    }
    const preview = A.Simulator.previewNextEliminationOrder(zeroState);
    const zeroColors = Object.keys(preview.byColor)
      .filter(k => (preview.byColor[k].reachable || 0) === 0)
      .map(Number);
    const reserved = new Set(['0,3', '1,3', '2,3', '3,3']);
    const supportCells = [];
    for (let r = 1; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const key = r + ',' + c;
        if (reserved.has(key)) continue;
        const cell = cells[r][c];
        if (cell && cell.t === 'box' && zeroColors.includes(cell.color)) supportCells.push([r, c]);
      }
    }
    const offset = variant >= 4 ? 0 : 2;
    for (let i = 0; i < topSupport.length && supportCells.length; i++) {
      const a = topSupport[i];
      const b = supportCells[(i + offset) % supportCells.length];
      const tmp = cells[a[0]][a[1]];
      cells[a[0]][a[1]] = cells[b[0]][b[1]];
      cells[b[0]][b[1]] = tmp;
    }
  }
  if (variant >= 5) {
    // Put a 30/22 car at (1,4), beside the hollow car, so the post-reveal
    // state has a second visible short debt. The black guard moves to its
    // previous cell, preserving the 47-car/2-black board contract.
    let source = null;
    for (let r = 1; r < 7 && !source; r++) {
      for (let c = 0; c < 7; c++) {
        const cell = cells[r][c];
        if (cell && cell.t === 'box' && cell.color === 30 && cell.count === 22 &&
            !(r === 2 && c === 3)) {
          source = [r, c];
          break;
        }
      }
    }
    if (!source) throw new Error('v5 缺少可用于第二拍的30/22车');
    const target = [1, 4];
    const tmp = cells[target[0]][target[1]];
    cells[target[0]][target[1]] = cells[source[0]][source[1]];
    cells[source[0]][source[1]] = tmp;
  }
  if (variant >= 6) {
    // One real 3-chain obstacle: the three adjacent cars at c4 are a
    // deliberately coupled commitment group, not three independent options.
    for (const p of [[1, 4], [2, 4], [3, 4]]) {
      if (!cells[p[0]] || !cells[p[0]][p[1]] || cells[p[0]][p[1]].t !== 'box') {
        throw new Error('v6 三连锁位置不是车: ' + p.join(','));
      }
      cells[p[0]][p[1]].chain = 1;
    }
  }
  const level = A.parseLevel({ blocks, bufferLimit: 5, board });

  // Explicitly replay the intended four board actions.
  const chainState = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  chainState.capture = true;
  const chainActions = [
    { role: 'entry', r: 0, c: 3 },
    { role: 'hollow', r: 1, c: 3 },
    { role: 'debt', r: 2, c: 3 },
    { role: 'release', r: 3, c: 3 }
  ];
  const chainEvidence = [];
  for (const action of chainActions) {
    const moves = A.Simulator.listMoves(chainState);
    const move = moves.find(m => m.r === action.r && m.c === action.c);
    if (!move || move.blocked) {
      throw new Error('故事动作不可取: ' + action.role);
    }
    chainState.capOps = [];
    const before = chainState.eliminatedPixels;
    A.Simulator.applyPick(chainState, action.r, action.c);
    const ops = chainState.capOps || [];
    const eat = [];
    for (const op of ops) if (op.t === 'eat') eat.push(...(op.cells || []));
    chainEvidence.push({
      role: action.role,
      cell: [action.r, action.c],
      color: move.antBox ? move.antBox.color : null,
      count: move.antBox ? move.antBox.count : null,
      consumedPixels: chainState.eliminatedPixels - before,
      bufferAfter: chainState.buffer.map(x => ({
        color: x.color,
        progress: x.progress,
        need: x.need,
        remaining: x.remaining,
        slot: x.slot
      })),
      traceCount: eat.length
    });
  }

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const players = [7, 1009, 2027].map(seed => ({
    seed,
    result: compactPlayer(seed, A.PlayerSim.run(level, { seed, instantChain: true }))
  }));
  const game = A.toGameFormat(level);
  const roundtrip = A.parseLevel(A.fromGameFormat(game));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: 20000,
    greedyOnly: true
  });
  if (!roundtripSolve.completed || !solve.completed) {
    throw new Error('v2 全知/客户端往返不可解');
  }

  const report = {
    schema: 'story-level-' + label,
    status: 'controlled_story_board_candidate',
    target,
    story: {
      chain: storyCars,
      chainActions,
      chainEvidence,
      executed: chainEvidence.length === 4,
      note: '这是显式四步链，不表示贪心/PlayerSim 一定自动选择该路径'
    },
    board: {
      rows: 7,
      cols: 7,
      cars: 47,
      black: 2,
      layout: cells.map(row => row.map(cell => cell && cell.t === 'black' ? 'B' : cell && cell.t === 'box' ? cell.color : null))
    },
    solve: compactSolve(solve),
    playerRuns: players,
    roundtripSolve: compactSolve(roundtripSolve),
    variant,
    gameFormat: path.join(outDir, '关卡_实验_' + label + '.json')
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(report.gameFormat, JSON.stringify(game, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, '关卡_实验_' + label + '.debug.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, '关卡_实验_' + label + '.route.json'), JSON.stringify({
    schema: 'story-level-v2-route',
    chainEvidence,
    solvePickOrder: solve.pickOrder,
    playerRuns: players
  }, null, 2) + '\n');

  const md = [
    '# 006 · Story Level ' + label,
    '',
    '> 受控故事棋盘候选；不是正式生产默认。',
    '',
    '## 棋盘',
    '',
    '- 7×7，47 辆车，2 个顶部角落黑块；',
    '- 入口车 `30/22` 在 `(0,3)`；',
    '- `15/24` 在 `(1,3)`，`17/26` 在 `(2,3)`，`31/30` 在 `(3,3)`。',
    '',
    '## 四步链',
    '',
    '| 节拍 | 格子 | 色/容量 | 消耗 | 暂存 |',
    '|---|---|---|---:|---|',
    ...chainEvidence.map(x => '| ' + x.role + ' | ' + x.cell.join(',') + ' | ' + x.color + '/' + x.count + ' | ' + x.consumedPixels + ' | ' + (x.bufferAfter.length ? x.bufferAfter.map(y => y.color + '欠' + y.remaining).join(',') : '空') + ' |'),
    '',
    '## 运行验证',
    '',
    '- 指定四步链可执行：是',
    '- 全知通关：' + (solve.completed ? '是' : '否') + '，进度 ' + solve.progress + '%，最大 buffer ' + solve.maxBuffer,
    '- 客户端 JSON 往返可解：' + (roundtripSolve.completed ? '是' : '否'),
    '- PlayerSim：' + players.map(p => 'seed ' + p.seed + ' ' + (p.result.won ? '通关' : '失败') + ' 峰值 ' + p.result.bufferPeak).join('；'),
    '',
    '## 文件',
    '',
    '- 客户端关卡：`' + report.gameFormat + '`',
    '- 路线：`' + path.join(outDir, '关卡_实验_' + label + '.route.json') + '`',
    '- 调试：`' + path.join(outDir, '关卡_实验_' + label + '.debug.json') + '`',
    '',
    '## 限制',
    '',
    '这是把目标状态链放进一条受控纵向入口链的验证版。',
    '顶部两个角落黑块是结构性入口约束，不是最终视觉规则；全知仍可能从其他车找到旁路。'
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, '关卡_实验_' + label + '.md'), md);
  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
