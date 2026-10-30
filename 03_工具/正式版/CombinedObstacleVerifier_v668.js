#!/usr/bin/env node
'use strict';

/**
 * E4.7: combine the accepted semantic obstacles on E3 layout A.
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
    out.push({ step: pick.step, r: pick.r, c: pick.c, color: pick.color, count: pick.count });
  }
  return out;
}

function main() {
  const A = loadSolver();
  const baseFile = path.join(ROOT, '实验关/关卡6/E3_v1/E3布局A.json');
  const base = A.parseLevel(A.fromGameFormat(readJson(baseFile)));
  const cells = base.board.cells.map(row => row.map(cell => cell ? clone(cell) : null));
  cells[0][0].chain = 1;
  cells[0][1].chain = 1;
  cells[0][3].numice = 4;
  cells[0][4].numice = 6;
  cells[0][5].numice = 6;
  cells[0][6].numice = 6;
  const level = A.parseLevel({
    blocks: base.blocks,
    bufferLimit: 5,
    board: { rows: 7, cols: 7, cells }
  });
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const expected = ['0,2', '0,1', '1,0', '0,3', '1,3'];
  const solvePrefix = uniquePicks(solve).slice(0, 5).map(x => x.r + ',' + x.c);
  const players = [];
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap
      });
      const prefix = uniquePicks(run).slice(0, 5).map(x => x.r + ',' + x.c);
      players.push({
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        bufferPeak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        prefixMatches: prefix.join('>') === expected.join('>')
      });
    }
  }
  const checks = {
    solveCompleted: solve.completed,
    solvePrefix: solvePrefix.join('>') === expected.join('>'),
    allPlayersWon: players.every(x => x.won && x.progress === 100),
    allPlayersPrefix: players.every(x => x.prefixMatches),
    noReviveSeed7: players.filter(x => x.reviveCap === 0)
      .every(x => x.revivesUsed === 0)
  };
  const passed = Object.values(checks).every(Boolean);
  const outDir = path.join(ROOT, '实验关/关卡6/E4_v1');
  const game = A.toGameFormat(level);
  const outFile = path.join(outDir, 'E4_combined_冰链黑.json');
  fs.writeFileSync(outFile, JSON.stringify(game, null, 2) + '\n');
  const result = {
    schema: 'e4-combined-verification-v1',
    status: passed ? 'E4_COMBINED_PASS' : 'E4_COMBINED_FAIL',
    baseFile,
    outFile,
    obstacles: {
      black: [[1, 1], [1, 2]],
      chain: [[0, 1], [0, 0]],
      ice: [[0, 3, 4], [0, 4, 6], [0, 5, 6], [0, 6, 6]],
      pipe: [],
      question: []
    },
    expected,
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer,
      prefix: solvePrefix
    },
    players,
    checks
  };
  fs.writeFileSync(
    path.join(outDir, 'combined-obstacle-result-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(outDir, 'combined-obstacle-result-v1.md'),
    [
      '# 006 · E4.7 综合障碍验证',
      '',
      '## 结论',
      '',
      passed ? '冰+二连锁+黑块组合通过。' : '组合未通过。',
      '',
      '## 组合',
      '',
      '- 2黑块：(1,1)/(1,2)；',
      '- 二连锁：(0,1)/(0,0)；',
      '- 4数字冰：0,3为4；0,4/5/6为6；',
      '- 管道/问号：0。',
      '',
      '## 路线',
      '',
      solvePrefix.join(' → '),
      '',
      '## 玩家',
      '',
      '- 默认/0复活共6局全部通关：' + (checks.allPlayersWon ? '是' : '否') + '；',
      '- 所有前五步符合：' + (checks.allPlayersPrefix ? '是' : '否') + '；',
      '- 0复活局无复活：' + (checks.noReviveSeed7 ? '是' : '否') + '。',
      ''
    ].join('\n')
  );
  console.log(JSON.stringify({ ok: passed, outDir, checks, solve: result.solve, players }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
