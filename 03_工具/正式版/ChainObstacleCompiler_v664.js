#!/usr/bin/env node
'use strict';

/**
 * E4.3: compile the real two-car groupDebt found on E3 layout A.
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniquePicks(run) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({
      step: pick.step,
      r: pick.r,
      c: pick.c,
      color: pick.color,
      count: pick.count,
      chain: pick.chain,
      chainSize: pick.chainSize,
      chainIndex: pick.chainIndex
    });
  }
  return out;
}

function bufferSummary(state) {
  return state.buffer.map(x => ({
    color: x.color,
    progress: x.progress,
    need: x.need,
    remaining: x.need - x.progress,
    link: x.link || 0,
    slot: x.slot
  }));
}

function playerReveals(A, level, run, atlas) {
  const byCell = {};
  for (const region of atlas.target.regions || []) {
    for (const cell of region.cells || []) byCell[cell[0] + ',' + cell[1]] = region.id;
  }
  const eliminated = A.outsideReachSeed(level.blocks, level.rows, level.cols, false);
  let pixels = 0;
  const view = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  const first = {};
  for (let i = 0; i < run.frames.length; i++) {
    for (const cell of run.frames[i].eats || []) {
      if (!eliminated[cell.r][cell.c]) {
        eliminated[cell.r][cell.c] = true;
        pixels++;
      }
    }
    view.eliminated = eliminated;
    view.eliminatedPixels = pixels;
    const preview = A.Simulator.previewNextEliminationOrder(view);
    for (let r = 0; r < preview.rank.length; r++) {
      for (let c = 0; c < preview.rank[r].length; c++) {
        if (!(preview.rank[r][c] > 0)) continue;
        const id = byCell[r + ',' + c];
        if ((id === 'R59' || id === 'R65') && !first[id]) {
          first[id] = { step: run.pickOrder[i] && run.pickOrder[i].step };
        }
      }
    }
  }
  return first;
}

function main() {
  const A = loadSolver();
  const baseFile = path.join(ROOT, '实验关/关卡6/E3_v1/E3布局A.json');
  const atlas = readJson(path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json'));
  const outDir = path.join(ROOT, '实验关/关卡6/E4_v1');
  const base = A.parseLevel(A.fromGameFormat(readJson(baseFile)));
  const cells = base.board.cells.map(row => row.map(cell => cell ? clone(cell) : null));
  const chainCells = [[0, 1], [0, 0]];
  for (const [r, c] of chainCells) {
    if (!cells[r][c] || cells[r][c].t !== 'box') throw new Error('链目标不是车');
    cells[r][c].chain = 1;
  }
  const level = A.parseLevel({
    blocks: base.blocks,
    bufferLimit: base.bufferLimit,
    board: { rows: 7, cols: 7, cells }
  });

  const state = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  A.Simulator.applyPick(state, 0, 2);
  const groupMove = A.Simulator.listMoves(state)
    .find(x => x.r === 0 && x.c === 1 && !x.blocked);
  if (!groupMove || groupMove.groupSize !== 2) throw new Error('二连锁组不可取');
  A.Simulator.applyPick(state, 0, 1);
  const groupBuffer = bufferSummary(state);
  if (groupBuffer.length !== 2) throw new Error('锁链组未整组停留');
  const completedMembers = groupBuffer.filter(x => x.remaining === 0).length;
  const debtMembers = groupBuffer.filter(x => x.remaining > 0);
  if (completedMembers !== 1 || debtMembers.length !== 1) {
    throw new Error('二连锁未形成一完成一债务');
  }
  A.Simulator.applyPick(state, 1, 0);
  const releaseAfter = bufferSummary(state);
  if (releaseAfter.length !== 0) throw new Error('31/30未释放整组');

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const expected = ['0,2', '0,1', '1,0', '0,3', '1,3'];
  const solvePrefix = uniquePicks(solve).slice(0, 5).map(x => x.r + ',' + x.c);
  const solveNoChain = A.Solver.solveInstantChain(base, { timeBudgetMs: 20000 });
  const noChainPrefix = uniquePicks(solveNoChain).slice(0, 6).map(x => x.r + ',' + x.c);

  const players = [];
  let capture = null;
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap,
        capture: reviveCap === 0 && seed === 7
      });
      const prefix = uniquePicks(run).slice(0, 5).map(x => x.r + ',' + x.c);
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
      if (reviveCap === 0 && seed === 7) capture = run;
    }
  }

  const reveals = playerReveals(A, level, capture, atlas);
  const checks = {
    solvePass: solve.completed,
    solvePrefix: solvePrefix.join('>') === expected.join('>'),
    groupSize2: groupMove.groupSize === 2,
    oneCompletedOneDebt: completedMembers === 1 && debtMembers.length === 1,
    plannedDebt10: debtMembers[0].color === 17 && debtMembers[0].remaining === 10,
    releasedNext: releaseAfter.length === 0,
    playersPass: players.every(x => x.won && x.prefixMatches && x.revivesUsed === 0),
    revealsPreserved: !!reveals.R59 && !!reveals.R65,
    removalChangesSequence:
      noChainPrefix.length === 6 &&
      noChainPrefix[1] === '0,1' &&
      noChainPrefix[2] === '0,0' &&
      solvePrefix.length === 5
  };
  const passed = Object.values(checks).every(Boolean);
  const plan = {
    schema: 'semantic-obstacle-plan-v1',
    obstacles: [
      {
        id: 'OC1',
        beatId: 'first_short_debt',
        role: 'bind',
        mechanism: 'chain',
        groupSize: 2,
        targetCars: chainCells.map(([r, c]) => ({
          cell: [r, c],
          color: cells[r][c].color,
          count: cells[r][c].count
        })),
        targetZones: ['R10', 'R225', 'R134'],
        expectedPlayerEffect: '15色完成车与17色债务车共同入场，31/30下一手释放整组。',
        removalPrediction: '移除链后15/24与17/26恢复为两个独立动作，共同承诺消失。'
      }
    ]
  };
  const game = A.toGameFormat(level);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'E4_groupDebt_二连锁.json');
  fs.writeFileSync(outFile, JSON.stringify(game, null, 2) + '\n');
  fs.writeFileSync(
    path.join(outDir, 'chain-obstacle-plan-v1.json'),
    JSON.stringify(plan, null, 2) + '\n'
  );
  const result = {
    schema: 'e4-chain-group-debt-result-v1',
    status: passed ? 'E4_GROUP_DEBT_PASS' : 'E4_GROUP_DEBT_FAIL',
    baseFile,
    outFile,
    plan,
    groupEvidence: {
      cells: chainCells,
      bufferAfterEntry: groupBuffer,
      completedMembers,
      debtMembers: debtMembers.map(x => ({
        color: x.color,
        remaining: x.remaining
      })),
      bufferAfterRelease: releaseAfter
    },
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer,
      prefix: solvePrefix
    },
    removal: {
      noChainPrefix,
      chainPrefix: solvePrefix,
      noChainPeak: solveNoChain.maxBuffer,
      chainPeak: solve.maxBuffer
    },
    players,
    reveals,
    checks
  };
  fs.writeFileSync(
    path.join(outDir, 'chain-obstacle-result-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  const md = [
    '# 006 · E4 groupDebt · 二连锁',
    '',
    '## 结论',
    '',
    passed ? '语义锁链组通过。' : '语义锁链组失败。',
    '',
    '## 绑定',
    '',
    '- `(0,1) 15/24` 与 `(0,0) 17/26` 组成2连锁；',
    '- 整组入场：15色完成、17色欠10；',
    '- 下一手31/30释放整组。',
    '',
    '## 验证',
    '',
    '- 全知通关：' + (solve.completed ? '是' : '否') + '；',
    '- 新五步主线：' + solvePrefix.join(' → ') + '；',
    '- 默认/0复活PlayerSim：' + (checks.playersPass ? '通过' : '失败') + '；',
    '- R59/R65：' + (checks.revealsPreserved ? '通过' : '失败') + '；',
    '- 无链路线：' + noChainPrefix.join(' → ') + '；',
    '- 有链路线：' + solvePrefix.join(' → ') + '。',
    '',
    '## 移除预测',
    '',
    '移除链后，15/24与17/26恢复为两个独立动作，共同承诺消失。',
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'chain-obstacle-result-v1.md'), md);

  console.log(JSON.stringify({
    ok: passed,
    outDir,
    checks,
    groupEvidence: result.groupEvidence,
    solve: result.solve,
    removal: result.removal,
    players,
    reveals
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
