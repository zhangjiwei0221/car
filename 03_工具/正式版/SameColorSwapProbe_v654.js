#!/usr/bin/env node
'use strict';

/**
 * E2.3: same-color counterfactual swaps.
 *
 * For each of the six critical cells, swap that car with another car of the
 * same color elsewhere on the board. The target image, capacity multiset and
 * all-colour totals stay unchanged. Record whether the six-step story prefix
 * survives.
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function routePrefix(run, count) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({ step: pick.step, r: pick.r, c: pick.c, color: pick.color, count: pick.count });
    if (out.length >= count) break;
  }
  return out;
}

function main() {
  const levelFile = path.resolve(arg(
    '--level',
    '实验关/关卡6/原型_v8/关卡_实验_v8.json'
  ));
  const outDir = path.resolve(arg('--out-dir', '实验关/关卡6/E2_v1'));
  const A = loadSolver();
  const source = A.parseLevel(A.fromGameFormat(readJson(levelFile)));
  const critical = [
    { role: 'entry', r: 0, c: 2 },
    { role: 'hollow', r: 0, c: 1 },
    { role: 'debt1', r: 0, c: 0 },
    { role: 'release1', r: 1, c: 0 },
    { role: 'debt2', r: 0, c: 3 },
    { role: 'release2', r: 1, c: 3 }
  ];
  const expected = critical.map(x => x.r + ',' + x.c);
  const variants = [];

  for (const key of critical) {
    const keyCell = source.board.cells[key.r][key.c];
    if (!keyCell || keyCell.t !== 'box') {
      throw new Error('关键格不是车: ' + key.r + ',' + key.c);
    }
    for (let r = 0; r < source.board.rows; r++) {
      for (let c = 0; c < source.board.cols; c++) {
        if (r === key.r && c === key.c) continue;
        const other = source.board.cells[r][c];
        if (!other || other.t !== 'box' || other.color !== keyCell.color) continue;

        const cells = clone(source.board.cells);
        const temp = cells[key.r][key.c];
        cells[key.r][key.c] = cells[r][c];
        cells[r][c] = temp;
        const level = A.parseLevel({
          blocks: source.blocks,
          bufferLimit: source.bufferLimit,
          board: { rows: source.board.rows, cols: source.board.cols, cells }
        });
        const run = A.PlayerSim.run(level, {
          seed: 7,
          instantChain: true,
          reviveCap: 0
        });
        const prefix = routePrefix(run, critical.length);
        const actual = prefix.map(x => x.r + ',' + x.c);
        const matches = actual.length === expected.length &&
          expected.every((cell, i) => cell === actual[i]);
        let firstMismatch = null;
        for (let i = 0; i < expected.length; i++) {
          if (actual[i] !== expected[i]) {
            firstMismatch = i + 1;
            break;
          }
        }
        variants.push({
          keyRole: key.role,
          keyCell: [key.r, key.c],
          keyCar: { color: keyCell.color, count: keyCell.count },
          swapCell: [r, c],
          swapCar: { color: other.color, count: other.count },
          matchesPrefix: matches,
          firstMismatch,
          won: run.won,
          progress: run.progress,
          bufferPeak: run.bufferPeak,
          revivesUsed: run.revivesUsed,
          firstSix: prefix
        });
      }
    }
  }

  const byRole = {};
  for (const key of critical) {
    const list = variants.filter(x => x.keyRole === key.role);
    const pass = list.filter(x => x.matchesPrefix);
    const fail = list.filter(x => !x.matchesPrefix);
    byRole[key.role] = {
      total: list.length,
      pass: pass.length,
      fail: fail.length,
      passingAlternatives: pass.map(x => ({
        swapCell: x.swapCell,
        swapCar: x.swapCar
      })),
      breakingAlternatives: fail.map(x => ({
        swapCell: x.swapCell,
        swapCar: x.swapCar,
        firstMismatch: x.firstMismatch,
        progress: x.progress
      }))
    };
  }

  const result = {
    schema: 'same-color-swap-probe-v1',
    levelFile,
    seeds: [7],
    reviveCap: 0,
    expectedPrefix: expected,
    summary: {
      variants: variants.length,
      preservePrefix: variants.filter(x => x.matchesPrefix).length,
      breakPrefix: variants.filter(x => !x.matchesPrefix).length
    },
    byRole,
    variants
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'same-color-swap-probe-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  const md = [
    '# 006 · E2 同色车交换反事实 v1',
    '',
    '> 只交换同色车位置；目标图、颜色总量和容量集合不变。',
    '',
    '## 汇总',
    '',
    '- 变体：' + result.summary.variants,
    '- 保持六步前缀：' + result.summary.preservePrefix,
    '- 破坏六步前缀：' + result.summary.breakPrefix,
    '',
    '## 分角色',
    '',
    '| 角色 | 变体 | 保持 | 破坏 |',
    '|---|---:|---:|---:|',
    ...critical.map(x => '| ' + x.role + ' | ' + byRole[x.role].total +
      ' | ' + byRole[x.role].pass + ' | ' + byRole[x.role].fail + ' |'),
    '',
    '## 首个破坏点',
    '',
    ...variants
      .filter(x => !x.matchesPrefix)
      .slice(0, 20)
      .map(x => '- ' + x.keyRole + '：' +
        x.keyCell.join(',') + ' ' + x.keyCar.color + '/' + x.keyCar.count +
        ' ↔ ' + x.swapCell.join(',') + ' ' + x.swapCar.color + '/' + x.swapCar.count +
        '，第' + x.firstMismatch + '步偏离，进度' + x.progress + '%'),
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'same-color-swap-probe-v1.md'), md);

  console.log(JSON.stringify({
    ok: true,
    outDir,
    summary: result.summary,
    byRole
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
