#!/usr/bin/env node
'use strict';

/**
 * E2.6: swap each critical cell with every non-critical cell of a different
 * colour. This probes the actual board-colour constraints for the story path.
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
  const criticalKeys = new Set(critical.map(x => x.r + ',' + x.c));
  const expected = critical.map(x => x.r + ',' + x.c);
  const variants = [];

  for (const key of critical) {
    const keyCell = source.board.cells[key.r][key.c];
    if (!keyCell || keyCell.t !== 'box') throw new Error('关键格不是车');
    for (let r = 0; r < source.board.rows; r++) {
      for (let c = 0; c < source.board.cols; c++) {
        if (criticalKeys.has(r + ',' + c)) continue;
        const other = source.board.cells[r][c];
        if (!other || other.t !== 'box' || other.color === keyCell.color) continue;
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
          role: key.role,
          keyCell: [key.r, key.c],
          originalColor: keyCell.color,
          originalCount: keyCell.count,
          swapCell: [r, c],
          swapColor: other.color,
          swapCount: other.count,
          matchesPrefix: matches,
          firstMismatch,
          won: run.won,
          progress: run.progress,
          bufferPeak: run.bufferPeak,
          firstSix: prefix
        });
      }
    }
  }

  const byRole = {};
  for (const key of critical) {
    const list = variants.filter(x => x.role === key.role);
    const pass = list.filter(x => x.matchesPrefix);
    const fail = list.filter(x => !x.matchesPrefix);
    const byColor = {};
    for (const x of list) {
      byColor[x.swapColor] = byColor[x.swapColor] || { pass: 0, fail: 0 };
      byColor[x.swapColor][x.matchesPrefix ? 'pass' : 'fail']++;
    }
    byRole[key.role] = {
      keyCell: [key.r, key.c],
      originalColor: source.board.cells[key.r][key.c].color,
      total: list.length,
      pass: pass.length,
      fail: fail.length,
      colorsWithPass: Object.keys(byColor)
        .filter(color => byColor[color].pass > 0)
        .map(Number)
        .sort((a, b) => a - b),
      byColor
    };
  }

  const result = {
    schema: 'cell-color-swap-probe-v1',
    levelFile,
    seed: 7,
    reviveCap: 0,
    expectedPrefix: expected,
    summary: {
      variants: variants.length,
      preservePrefix: variants.filter(x => x.matchesPrefix).length,
      breakPrefix: variants.filter(x => !x.matchesPrefix).length
    },
    byRole,
    firstPassing: variants.filter(x => x.matchesPrefix).slice(0, 40),
    firstFailures: variants.filter(x => !x.matchesPrefix).slice(0, 40)
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'cell-color-swap-probe-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  const md = [
    '# 006 · E2 关键格异色交换探针 v1',
    '',
    '> 每个关键格与非关键异色车交换；目标图和总容量不变。',
    '',
    '## 汇总',
    '',
    '- 变体：' + result.summary.variants,
    '- 保持六步前缀：' + result.summary.preservePrefix,
    '- 破坏六步前缀：' + result.summary.breakPrefix,
    '',
    '## 分角色',
    '',
    '| 角色 | 原色 | 变体 | 保持 | 破坏 | 可替代颜色 |',
    '|---|---:|---:|---:|---:|---|',
    ...critical.map(x => {
      const s = byRole[x.role];
      return '| ' + x.role + ' | ' + s.originalColor + ' | ' + s.total +
        ' | ' + s.pass + ' | ' + s.fail + ' | ' +
        (s.colorsWithPass.join('、') || '-') + ' |';
    }),
    '',
    '## 说明',
    '',
    '若某关键格没有任何异色替代保持前缀，则该格的颜色是硬约束。',
    '若存在替代颜色，则记录的是该位置的软约束。',
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'cell-color-swap-probe-v1.md'), md);

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
