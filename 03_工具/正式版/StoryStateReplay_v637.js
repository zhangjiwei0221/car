#!/usr/bin/env node
'use strict';

/**
 * StoryStateReplay v0 for the first 006 story chain.
 * Target-only replay; this does not construct a board.
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

function regionLookup(atlas) {
  const byCell = {};
  const byId = {};
  for (const region of atlas.target.regions || []) {
    byId[region.id] = region;
    for (const p of region.cells || []) byCell[p[0] + ',' + p[1]] = region.id;
  }
  return { byCell, byId };
}

function hitsOfCells(cells, lookup) {
  const hits = {};
  for (const p of cells || []) {
    const id = lookup.byCell[p[0] + ',' + p[1]];
    if (id) hits[id] = (hits[id] || 0) + 1;
  }
  return Object.keys(hits).map(id => ({
    region: id,
    color: lookup.byId[id].color,
    pixels: hits[id]
  })).sort((a, b) => b.pixels - a.pixels);
}

function reachableRegions(preview, lookup) {
  const hit = {};
  for (let r = 0; r < preview.rank.length; r++) {
    for (let c = 0; c < preview.rank[r].length; c++) {
      if (preview.rank[r][c] > 0) {
        const id = lookup.byCell[r + ',' + c];
        if (id) hit[id] = true;
      }
    }
  }
  return Object.keys(hit).sort();
}

function bufferSummary(state) {
  return state.buffer.map(item => ({
    color: item.color,
    progress: item.progress,
    need: item.need,
    remaining: item.remaining,
    slot: item.slot,
    start: item.start
  }));
}

function main() {
  const target = path.resolve(arg('--target', '实验关/关卡6/35x35拼接图纸_006.txt'));
  const atlasFile = path.resolve(arg('--atlas', '实验关/关卡6/分析_v632/target-atlas.json'));
  const outDir = path.resolve(arg('--out-dir', path.dirname(atlasFile)));
  const A = loadSolver();
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(target, 'utf8'));
  const rows = blocks.length;
  const cols = blocks[0].length;
  let total = 0;
  for (const row of blocks) for (const v of row) if (v > 0) total++;
  const atlas = readJson(atlasFile);
  const lookup = regionLookup(atlas);

  // First replayable chain selected from the 20-40 / 7x7 plan and target atlas.
  // The fourth action is the first tested release action for the 17-color debt.
  const sequence = [
    { role: 'entry', color: 30, count: 22 },
    { role: 'hollow', color: 15, count: 24 },
    { role: 'debt', color: 17, count: 26 },
    { role: 'release', color: 31, count: 30 }
  ];

  const state = A.Simulator.createState({
    blocks,
    rows,
    cols,
    totalPixels: total,
    totalBoxes: 49,
    bufferLimit: 5,
    board: { rows: 0, cols: 0, cells: [] }
  }, { useSlotStart: true, instantChain: true });
  state.capture = true;

  const actions = [];
  let beforeBuffer = bufferSummary(state);
  let beforePixels = state.eliminatedPixels;
  for (const action of sequence) {
    state.capOps = [];
    A.Simulator.processAntBox(state, {
      color: action.color,
      count: action.count,
      chain: 0,
      q: false,
      numice: 0
    });
    const ops = state.capOps || [];
    const added = ops.find(x => x.t === 'add') || null;
    const eatCells = [];
    for (const op of ops) if (op.t === 'eat') eatCells.push(...(op.cells || []));
    const preview = A.Simulator.previewNextEliminationOrder(state);
    const reached = reachableRegions(preview, lookup);
    actions.push({
      role: action.role,
      color: action.color,
      count: action.count,
      slot: added ? added.slot : null,
      start: added ? added.start : null,
      pixelsBefore: beforePixels,
      pixelsAfter: state.eliminatedPixels,
      consumed: state.eliminatedPixels - beforePixels,
      regionHits: hitsOfCells(eatCells, lookup),
      bufferBefore: beforeBuffer,
      bufferAfter: bufferSummary(state),
      revealedRegions: reached.filter(id => !actions.some(a => a.revealedRegions && a.revealedRegions.includes(id))),
      reachableColors: Object.fromEntries(Object.keys(preview.byColor).map(k => [k, preview.byColor[k].reachable]))
    });
    beforeBuffer = bufferSummary(state);
    beforePixels = state.eliminatedPixels;
  }

  const result = {
    schema: 'story-state-replay-v0',
    target,
    sequence,
    totalPixels: total,
    actions,
    final: {
      eliminatedPixels: state.eliminatedPixels,
      progress: total ? +(state.eliminatedPixels / total).toFixed(4) : 0,
      buffer: bufferSummary(state),
      gameOver: state.gameOver,
      gameWon: state.gameWon
    },
    checks: {
      entryOpenedHollow: !!(actions[0].reachableColors['15'] > 0),
      hollowConsumedR10: actions[1].regionHits.some(x => x.region === 'R10'),
      debtCarLeftDebt: actions[2].bufferAfter.some(x => x.color === 17 && x.remaining > 0),
      debtReleasedByPlannedAction: !actions[3].bufferAfter.some(x => x.color === 17 && x.remaining > 0),
      revealR59ReachableAfterRelease: actions[3].revealedRegions.includes('R59'),
      revealR65ReachableAfterRelease: actions[3].revealedRegions.includes('R65')
    }
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'story-state-replay-v1.json'), JSON.stringify(result, null, 2) + '\n');
  const lines = [
    '# 006 Story State Replay v1',
    '',
    '> 目标状态只读回放；尚不含棋盘车辆阻挡。',
    '',
    '## 动作链',
    '',
    '| 节拍 | 色号 | 容量 | 槽位 | 实际消除 | 命中区域 | 消除后暂存 |',
    '|---|---:|---:|---:|---:|---|---|',
    ...actions.map(a => '| ' + a.role + ' | ' + a.color + ' | ' + a.count + ' | ' + a.slot + ' | ' + a.consumed + ' | ' + (a.regionHits.map(x => x.region + ':' + x.pixels).join(', ') || '-') + ' | ' + (a.bufferAfter.length ? a.bufferAfter.map(x => x.color + '欠' + x.remaining).join(', ') : '空') + ' |'),
    '',
    '## 判定',
    '',
    '- 入口打开 15 色内部区域：' + (result.checks.entryOpenedHollow ? '是' : '否'),
    '- 15 色车实际命中 R10：' + (result.checks.hollowConsumedR10 ? '是' : '否'),
    '- 17 色车留下债务：' + (result.checks.debtCarLeftDebt ? '是' : '否'),
    '- 下一步真实释放 17 色：' + (result.checks.debtReleasedByPlannedAction ? '是' : '否'),
    '- R59 在释放后出现：' + (result.checks.revealR59ReachableAfterRelease ? '是' : '否'),
    '- R65 在释放后出现：' + (result.checks.revealR65ReachableAfterRelease ? '是' : '否'),
    '',
    '## 解释',
    '',
    '这次回放已经纠正了静态预估：入口实际从底边 30 色缺口进入，而不是从 R2 顶部边缘进入。',
    'R10 仍然被打开，说明主要故事目标可以保留；但入口区域必须按 Manhattan 实际结果重写。'
  ];
  fs.writeFileSync(path.join(outDir, 'story-state-replay-v1.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify({ ok: true, outDir, checks: result.checks, actions: actions.map(a => ({ role: a.role, color: a.color, count: a.count, consumed: a.consumed, buffer: a.bufferAfter })) }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
