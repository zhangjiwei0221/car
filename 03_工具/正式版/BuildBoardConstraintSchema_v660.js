#!/usr/bin/env node
'use strict';

/**
 * E3.1: create a machine-readable board constraint schema from E2 evidence.
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

function main() {
  const A = loadSolver();
  const sourceFile = path.join(ROOT, '实验关/关卡6/原型_v8/关卡_实验_v8.json');
  const e2File = path.join(ROOT, '实验关/关卡6/E2_v1/placement-constraints-v1.json');
  const source = A.parseLevel(A.fromGameFormat(readJson(sourceFile)));
  const e2 = readJson(e2File);
  const fixed = [
    { role: 'entry', r: 0, c: 2, color: 30, count: 22 },
    { role: 'hollow', r: 0, c: 1, color: 15, count: 24 },
    { role: 'debt1', r: 0, c: 0, color: 17, count: 26 },
    { role: 'release1', r: 1, c: 0, color: 31, count: 30 },
    { role: 'debt2', r: 0, c: 3, color: 34, count: 25 },
    { role: 'support1', r: 0, c: 4, color: 34, count: 25 },
    { role: 'support2', r: 0, c: 5, color: 17, count: 25 },
    { role: 'support3', r: 0, c: 6, color: 17, count: 25 },
    { role: 'support4', r: 1, c: 4, color: 21, count: 36 },
    { role: 'support5', r: 2, c: 0, color: 13, count: 27 }
  ];
  const multiset = [];
  for (let r = 0; r < source.board.rows; r++) {
    for (let c = 0; c < source.board.cols; c++) {
      const cell = source.board.cells[r][c];
      if (cell && cell.t === 'box') multiset.push(cell.color + '/' + cell.count);
    }
  }
  multiset.sort();

  const regionNames = ['R10', 'R225', 'R134', 'R223', 'R227', 'R59', 'R65'];
  const regionWindows = {
    R10: [1, 2],
    R225: [1, 3],
    R134: [4, 5],
    R223: [4, 5],
    R227: [4, 6],
    R59: [28, 31],
    R65: [29, 32]
  };
  const regionRules = regionNames.map(name => {
    const rule = e2.regionConstraints.find(x => x.region === name);
    return {
      region: name,
      color: rule.color,
      firstRevealAction: rule.firstReveal.action,
      firstRevealStep: rule.firstReveal.step,
      stepWindow: regionWindows[name],
      consumerActions: [...new Set(rule.consumes.map(x => x.action))],
      consumePixels: rule.pixelsConsumed,
      crossColorOwners: rule.crossColorOwners
    };
  });

  const schema = {
    schema: 'board-constraint-schema-v1',
    board: {
      rows: 7,
      cols: 7,
      bufferLimit: 5,
      eliminationMode: 'instantChain',
      blackCount: 2,
      blackCells: [[1, 1], [1, 2]]
    },
    capacity: {
      carCount: 47,
      sum: 1225,
      multiset
    },
    storyOrder: [
      { step: 1, cell: [0, 2], color: 30, count: 22, remainingAfter: 0 },
      { step: 2, cell: [0, 1], color: 15, count: 24, remainingAfter: 0 },
      { step: 3, cell: [0, 0], color: 17, count: 26, remainingAfter: 10 },
      { step: 4, cell: [1, 0], color: 31, count: 30, remainingAfter: 0 },
      { step: 5, cell: [0, 3], color: 34, count: 25, remainingAfter: 6 },
      { step: 6, cell: [1, 3], color: 5, count: 40, remainingAfter: 0 }
    ],
    fixedCells: fixed,
    hardColorCells: [
      { cell: [0, 2], requiredColor: 30 },
      { cell: [0, 1], requiredColor: 15 },
      { cell: [0, 0], requiredColor: 17 },
      { cell: [1, 0], requiredColor: 31 },
      { cell: [0, 3], requiredColor: 34 }
    ],
    softColorCells: [
      {
        cell: [1, 3],
        allowedColors: [5, 14, 15, 30, 31],
        preferredColor: 5,
        preferredCount: 40
      }
    ],
    regionRules,
    invariants: {
      noPrematureConsume: true,
      requireR59: true,
      requireR65: true,
      requireFinalDebtRelease: true,
      requireDefaultAndNoRevivePlayerPass: true
    }
  };

  const outDir = path.join(ROOT, '实验关/关卡6/E3_v1');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'board-constraint-schema-v1.json'),
    JSON.stringify(schema, null, 2) + '\n'
  );
  const md = [
    '# 006 · E3.1 棋盘约束 Schema v1',
    '',
    '## 棋盘',
    '',
    '- 7×7，buffer 5，instantChain；',
    '- 2个结构黑块：(1,1)/(1,2)；',
    '- 47车，容量总和1225。',
    '',
    '## 硬/软颜色格',
    '',
    '| 格 | 约束 |',
    '|---|---|',
    ...schema.hardColorCells.map(x => '| ' + x.cell.join(',') + ' | 必须' + x.requiredColor + ' |'),
    ...schema.softColorCells.map(x => '| ' + x.cell.join(',') + ' | 允许' + x.allowedColors.join('/') + ' |'),
    '',
    '## 六步债权指纹',
    '',
    '| 步 | 格 | 车 | 消后剩余 |',
    '|---:|---|---|---:|',
    ...schema.storyOrder.map(x => '| ' + x.step + ' | ' + x.cell.join(',') +
      ' | ' + x.color + '/' + x.count + ' | ' + x.remainingAfter + ' |'),
    '',
    '## 区域规则',
    '',
    ...regionRules.map(x => '- ' + x.region + '：A' +
      String(x.firstRevealStep).padStart(2, '0') + '揭示；' +
      x.consumerActions.join('/') + '消费；共' + x.consumePixels + '像素。'),
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'board-constraint-schema-v1.md'), md);

  console.log(JSON.stringify({
    ok: true,
    outDir,
    fixedCells: fixed.length,
    capacity: schema.capacity,
    storyOrder: schema.storyOrder,
    regionRules
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
