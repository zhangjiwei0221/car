#!/usr/bin/env node
'use strict';

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const A = loadSolver();
  const levelFile = path.join(ROOT, '实验关/关卡6/E3_v1/E3布局A.json');
  const level = A.parseLevel(A.fromGameFormat(readJson(levelFile)));
  const state = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  const moves = A.Simulator.listMoves(state);
  const topMoves = moves.filter(x => x.r === 0);
  const result = {
    schema: 'question-relevance-probe-v1',
    levelFile,
    decision: 'reject_no_inference_clue',
    evidence: {
      topRowImmediatelyActive: topMoves.map(x => ({
        cell: [x.r, x.c],
        color: x.antBox.color,
        count: x.antBox.count
      })),
      knownStoryCells: [
        [0, 2], [0, 1], [0, 0], [1, 0], [0, 3], [1, 3]
      ]
    },
    reasoning: [
      '首行车辆开局即可见，问号放在首行会立即揭示，不能形成未知。',
      '关键路径颜色和容量已经由Schema/目标图明确，没有可供推理的灰线索。',
      '把关键格改成问号只会隐藏答案，增加背板成本。',
      '把非关键格改成问号不会改变故事，属于装饰性信息遮蔽。'
    ],
    futureUseCondition: [
      '前后线索能唯一或高概率推断隐藏颜色。',
      '问号不承担唯一恢复路线。',
      '移除问号会明显降低推理体验，而不是只降低可解释性。'
    ]
  };
  const outDir = path.join(ROOT, '实验关/关卡6/E4_v1');
  fs.writeFileSync(
    path.join(outDir, 'question-relevance-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(outDir, 'question-relevance-v1.md'),
    [
      '# 006 · E4.6 问号相关性探针',
      '',
      '## 结论',
      '',
      '本轮不生成问号：没有可推断线索。',
      '',
      '## 理由',
      '',
      ...result.reasoning.map(x => '- ' + x),
      '',
      '## 重新启用条件',
      '',
      ...result.futureUseCondition.map(x => '- ' + x),
      ''
    ].join('\n')
  );
  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
