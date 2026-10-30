#!/usr/bin/env node
'use strict';

/**
 * E6.1: first replayable StoryPlan for 008.
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function main() {
  const A = loadSolver();
  const target = path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_008.txt');
  const atlasFile = path.join(ROOT, '实验关/关卡6/分析_008_supply/target-atlas.json');
  const outDir = path.join(ROOT, '实验关/关卡8');
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(target, 'utf8'));
  const atlas = JSON.parse(fs.readFileSync(atlasFile, 'utf8').toString());
  const byCell = {};
  for (const region of atlas.target.regions || []) {
    for (const [r, c] of region.cells || []) byCell[r + ',' + c] = region.id;
  }
  const sequence = [
    { role: 'teach', color: 7, count: 23 },
    { role: 'debt1', color: 33, count: 22 },
    { role: 'release1', color: 32, count: 24 },
    { role: 'teach2a', color: 7, count: 23 },
    { role: 'teach2b', color: 32, count: 24 },
    { role: 'peel1', color: 27, count: 28 },
    { role: 'peel2', color: 27, count: 28 },
    { role: 'peel3', color: 27, count: 28 },
    { role: 'peel4', color: 27, count: 28 },
    { role: 'peel5', color: 27, count: 27 },
    { role: 'peel6', color: 27, count: 27 },
    { role: 'reveal', color: 27, count: 27 },
    { role: 'debt2', color: 3, count: 29 },
    { role: 'release2', color: 5, count: 36 }
  ];
  for (const item of sequence) item.count = item.count;
  const state = A.Simulator.createState({
    blocks,
    rows: 35,
    cols: 35,
    totalPixels: 1225,
    totalBoxes: 49,
    bufferLimit: 5,
    board: { rows: 0, cols: 0, cells: [] }
  }, { useSlotStart: true, instantChain: true });
  state.capture = true;

  function reachable() {
    const preview = A.Simulator.previewNextEliminationOrder(state);
    const ids = new Set();
    for (let r = 0; r < 35; r++) {
      for (let c = 0; c < 35; c++) {
        if (preview.rank[r][c] > 0) {
          const id = byCell[r + ',' + c];
          if (id) ids.add(id);
        }
      }
    }
    return ids;
  }

  const evidence = [];
  for (const action of sequence) {
    const beforeRegions = reachable();
    const bufferBefore = state.buffer.map(x => ({
      color: x.color,
      remaining: x.need - x.progress
    }));
    state.capOps = [];
    const pixelsBefore = state.eliminatedPixels;
    A.Simulator.processAntBox(state, {
      color: action.color,
      count: action.count,
      chain: 0,
      q: false,
      numice: 0
    });
    const hits = {};
    for (const op of state.capOps || []) {
      if (op.t !== 'eat') continue;
      for (const [r, c] of op.cells || []) {
        const id = byCell[r + ',' + c];
        if (id) hits[id] = (hits[id] || 0) + 1;
      }
    }
    const afterRegions = reachable();
    const revealed = [...afterRegions].filter(id => !beforeRegions.has(id));
    evidence.push({
      role: action.role,
      color: action.color,
      count: action.count,
      consumedPixels: state.eliminatedPixels - pixelsBefore,
      regionHits: Object.keys(hits)
        .map(region => ({ region, pixels: hits[region] }))
        .sort((a, b) => b.pixels - a.pixels),
      revealedRegions: revealed,
      bufferBefore,
      bufferAfter: state.buffer.map(x => ({
        color: x.color,
        remaining: x.need - x.progress,
        slot: x.slot
      }))
    });
  }

  const debt1 = evidence[1];
  const release1 = evidence[2];
  const reveal = evidence[11];
  const debt2 = evidence[12];
  const release2 = evidence[13];
  const checks = {
    teachFull: evidence[0].bufferAfter.length === 0,
    debt1Created: debt1.bufferAfter.some(x => x.color === 33 && x.remaining === 18),
    debt1Released: release1.bufferAfter.length === 0,
    R125RevealedByPeel: reveal.revealedRegions.includes('R125'),
    debt2Created: debt2.bufferAfter.some(x => x.color === 3 && x.remaining === 15),
    debt2Released: release2.bufferAfter.length === 0,
    R125ConsumedByRelease: release2.regionHits.some(x => x.region === 'R125' && x.pixels === 28)
  };
  const plan = {
    schema: 'story-plan-008-v1',
    status: Object.values(checks).every(Boolean) ? 'replayable_first_half' : 'failed',
    target,
    capacity: {
      min: 20,
      max: 40,
      board: '7x7',
      cars: 49,
      exact: true
    },
    storyTendency: '边界剥离 R109 → R125 内部主题展开',
    sequence,
    evidence,
    checks,
    next: [
      '构造008受控棋盘',
      '验证第一债务、R125揭示和第二债务/释放进入PlayerSim',
      '再设计后半段与终局'
    ]
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, '故事计划_v1.json'),
    JSON.stringify(plan, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(outDir, '故事计划_v1.md'),
    [
      '# 008 · StoryPlan v1',
      '',
      '## 状态',
      '',
      plan.status,
      '',
      '## 容量与棋盘',
      '',
      '- `[20,40]`，7×7，49车，逐色精确。',
      '',
      '## 已回放故事',
      '',
      '| 节拍 | 车辆 | 实际结果 |',
      '|---|---|---|',
      ...evidence.map(x => '| ' + x.role + ' | ' + x.color + '/' + x.count +
        ' | ' + (x.bufferAfter.length
          ? x.bufferAfter.map(y => y.color + '欠' + y.remaining).join('、')
          : '暂存空') + ' |'),
      '',
      '## 关键依赖',
      '',
      '- 33/22消费R2654像素，欠18；',
      '- 32/24命中R384的18像素，释放33债务；',
      '- 27色剥离R109，第12动作打开R125；',
      '- 3/29欠15；',
      '- 5/36消费R125的28像素和R160的8像素，释放3债务。',
      '',
      '## 下一步',
      '',
      ...plan.next.map(x => '- ' + x),
      ''
    ].join('\n')
  );
  console.log(JSON.stringify({ ok: plan.status === 'replayable_first_half', outDir, checks, evidence: evidence.slice(0, 14) }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
