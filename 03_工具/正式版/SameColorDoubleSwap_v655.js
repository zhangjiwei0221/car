#!/usr/bin/env node
'use strict';

/**
 * E2.4: two simultaneous same-colour swaps.
 *
 * Each variant swaps cars at two distinct critical cells with other same-colour
 * cars. It preserves the target image and the complete capacity multiset.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
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
  const alternatives = {};

  for (const key of critical) {
    const keyCell = source.board.cells[key.r][key.c];
    const list = [];
    for (let r = 0; r < source.board.rows; r++) {
      for (let c = 0; c < source.board.cols; c++) {
        if (r === key.r && c === key.c) continue;
        if (criticalKeys.has(r + ',' + c)) continue;
        const cell = source.board.cells[r][c];
        if (cell && cell.t === 'box' && cell.color === keyCell.color) {
          list.push({ r, c, color: cell.color, count: cell.count });
        }
      }
    }
    alternatives[key.role] = list;
  }

  const variants = [];
  for (let i = 0; i < critical.length; i++) {
    for (let j = i + 1; j < critical.length; j++) {
      const keyA = critical[i];
      const keyB = critical[j];
      for (const altA of alternatives[keyA.role]) {
        for (const altB of alternatives[keyB.role]) {
          if (altA.r === altB.r && altA.c === altB.c) continue;
          const cells = clone(source.board.cells);
          const tempA = cells[keyA.r][keyA.c];
          cells[keyA.r][keyA.c] = cells[altA.r][altA.c];
          cells[altA.r][altA.c] = tempA;
          const tempB = cells[keyB.r][keyB.c];
          cells[keyB.r][keyB.c] = cells[altB.r][altB.c];
          cells[altB.r][altB.c] = tempB;
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
            expected.every((cell, k) => cell === actual[k]);
          let firstMismatch = null;
          for (let k = 0; k < expected.length; k++) {
            if (actual[k] !== expected[k]) {
              firstMismatch = k + 1;
              break;
            }
          }
          variants.push({
            keyA: {
              role: keyA.role,
              cell: [keyA.r, keyA.c],
              swapCell: [altA.r, altA.c],
              swapCar: { color: altA.color, count: altA.count }
            },
            keyB: {
              role: keyB.role,
              cell: [keyB.r, keyB.c],
              swapCell: [altB.r, altB.c],
              swapCar: { color: altB.color, count: altB.count }
            },
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
  }

  const pairSummary = {};
  for (let i = 0; i < critical.length; i++) {
    for (let j = i + 1; j < critical.length; j++) {
      const key = critical[i].role + '+' + critical[j].role;
      const list = variants.filter(x =>
        x.keyA.role === critical[i].role && x.keyB.role === critical[j].role
      );
      pairSummary[key] = {
        total: list.length,
        pass: list.filter(x => x.matchesPrefix).length,
        fail: list.filter(x => !x.matchesPrefix).length
      };
    }
  }

  const failures = variants.filter(x => !x.matchesPrefix);
  const result = {
    schema: 'same-color-double-swap-v1',
    levelFile,
    seed: 7,
    reviveCap: 0,
    expectedPrefix: expected,
    alternatives,
    summary: {
      variants: variants.length,
      preservePrefix: variants.length - failures.length,
      breakPrefix: failures.length
    },
    pairSummary,
    firstFailures: failures.slice(0, 40),
    variants
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'same-color-double-swap-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  const md = [
    '# 006 · E2 同色车双交换 v1',
    '',
    '> 同时交换两组同色车；目标图和完整容量集合保持不变。',
    '',
    '## 汇总',
    '',
    '- 变体：' + result.summary.variants,
    '- 保持六步前缀：' + result.summary.preservePrefix,
    '- 破坏六步前缀：' + result.summary.breakPrefix,
    '',
    '## 角色对',
    '',
    '| 角色对 | 变体 | 保持 | 破坏 |',
    '|---|---:|---:|---:|',
    ...Object.entries(pairSummary).map(([key, x]) =>
      '| ' + key + ' | ' + x.total + ' | ' + x.pass + ' | ' + x.fail + ' |'
    ),
    '',
    '## 首批破坏',
    '',
    ...(failures.length
      ? failures.slice(0, 20).map(x =>
          '- ' + x.keyA.role + ' ↔ ' + x.keyA.swapCell.join(',') + ' ' +
          x.keyA.swapCar.color + '/' + x.keyA.swapCar.count + '；' +
          x.keyB.role + ' ↔ ' + x.keyB.swapCell.join(',') + ' ' +
          x.keyB.swapCar.color + '/' + x.keyB.swapCar.count +
          '；第' + x.firstMismatch + '步偏离，进度' + x.progress + '%'
        )
      : ['- 无']),
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'same-color-double-swap-v1.md'), md);

  console.log(JSON.stringify({
    ok: true,
    outDir,
    summary: result.summary,
    pairSummary,
    firstFailures: failures.slice(0, 10)
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
