#!/usr/bin/env node
'use strict';

/**
 * E2.5: full Cartesian product of one same-colour swap per critical role.
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
    out.push([pick.r, pick.c]);
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
  const expected = critical.map(x => [x.r, x.c]);
  const choices = critical.map(key => {
    const keyCell = source.board.cells[key.r][key.c];
    const list = [];
    for (let r = 0; r < source.board.rows; r++) {
      for (let c = 0; c < source.board.cols; c++) {
        if (criticalKeys.has(r + ',' + c)) continue;
        const cell = source.board.cells[r][c];
        if (cell && cell.t === 'box' && cell.color === keyCell.color) {
          list.push({ r, c, color: cell.color, count: cell.count });
        }
      }
    }
    return { key, list };
  });

  let tested = 0;
  let preserved = 0;
  const failures = [];
  function recurse(index, selected) {
    if (index === choices.length) {
      const cells = clone(source.board.cells);
      for (let i = 0; i < choices.length; i++) {
        const key = choices[i].key;
        const alt = selected[i];
        const temp = cells[key.r][key.c];
        cells[key.r][key.c] = cells[alt.r][alt.c];
        cells[alt.r][alt.c] = temp;
      }
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
      const actual = routePrefix(run, critical.length);
      const matches = actual.length === expected.length &&
        expected.every((cell, i) => cell.join(',') === actual[i].join(','));
      tested++;
      if (matches) {
        preserved++;
      } else {
        let firstMismatch = null;
        for (let i = 0; i < expected.length; i++) {
          if (expected[i].join(',') !== actual[i].join(',')) {
            firstMismatch = i + 1;
            break;
          }
        }
        if (failures.length < 40) {
          failures.push({
            swaps: choices.map((choice, i) => ({
              role: choice.key.role,
              keyCell: [choice.key.r, choice.key.c],
              swapCell: [selected[i].r, selected[i].c],
              swapCar: { color: selected[i].color, count: selected[i].count }
            })),
            firstMismatch,
            won: run.won,
            progress: run.progress,
            bufferPeak: run.bufferPeak,
            firstSix: actual
          });
        }
      }
      return;
    }
    for (const alt of choices[index].list) {
      selected.push(alt);
      recurse(index + 1, selected);
      selected.pop();
    }
  }
  recurse(0, []);

  const result = {
    schema: 'same-color-six-swap-v1',
    levelFile,
    seed: 7,
    reviveCap: 0,
    choiceCounts: Object.fromEntries(choices.map(x => [x.key.role, x.list.length])),
    summary: {
      variants: tested,
      preservePrefix: preserved,
      breakPrefix: tested - preserved
    },
    firstFailures: failures
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'same-color-six-swap-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  const md = [
    '# 006 · E2 六关键格同色全换组合',
    '',
    '## 汇总',
    '',
    '- 变体：' + tested,
    '- 保持六步前缀：' + preserved,
    '- 破坏六步前缀：' + (tested - preserved),
    '',
    '## 选择数',
    '',
    ...choices.map(x => '- ' + x.key.role + '：' + x.list.length),
    '',
    '## 首批破坏',
    '',
    ...(failures.length
      ? failures.slice(0, 20).map(x =>
          '- ' + x.swaps.map(y => y.role + '→' + y.swapCell.join(',') +
            '(' + y.swapCar.color + '/' + y.swapCar.count + ')').join('；') +
          '；第' + x.firstMismatch + '步偏离，进度' + x.progress + '%'
        )
      : ['- 无']),
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'same-color-six-swap-v1.md'), md);

  console.log(JSON.stringify({
    ok: true,
    outDir,
    choiceCounts: result.choiceCounts,
    summary: result.summary,
    firstFailures: failures.slice(0, 10)
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
