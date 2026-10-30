#!/usr/bin/env node
'use strict';

/**
 * Find the shortest target-state continuation after the v4 four-step chain
 * that makes R59 or R65 reachable.
 *
 * Target-only search. Board placement is intentionally out of scope.
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
  for (const region of atlas.target.regions || []) {
    for (const p of region.cells || []) byCell[p[0] + ',' + p[1]] = region.id;
  }
  return byCell;
}

function reachableRegions(state, A, byCell) {
  const pv = A.Simulator.previewNextEliminationOrder(state);
  const ids = new Set();
  for (let r = 0; r < pv.rank.length; r++) {
    for (let c = 0; c < pv.rank[r].length; c++) {
      if (pv.rank[r][c] > 0) {
        const id = byCell[r + ',' + c];
        if (id) ids.add(id);
      }
    }
  }
  return { pv, ids };
}

function stateFromPath(A, blocks, pathActions) {
  const rows = blocks.length;
  const cols = blocks[0].length;
  let total = 0;
  for (const row of blocks) for (const v of row) if (v > 0) total++;
  const state = A.Simulator.createState({
    blocks,
    rows,
    cols,
    totalPixels: total,
    totalBoxes: 49,
    bufferLimit: 5,
    board: { rows: 0, cols: 0, cells: [] }
  }, { useSlotStart: true, instantChain: true });
  for (const action of pathActions) {
    A.Simulator.processAntBox(state, {
      color: action.color,
      count: action.count,
      chain: 0,
      q: false,
      numice: 0
    });
    if (state.overflow) return state;
  }
  return state;
}

function stateKey(state) {
  let h = 2166136261;
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      h ^= state.eliminated[r][c] ? 1 : 0;
      h = Math.imul(h, 16777619);
    }
  }
  for (const item of state.buffer) {
    h ^= (item.color * 101 + item.remaining * 17 + (item.slot || 0) * 7);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function main() {
  const target = path.resolve(arg('--target', '实验关/关卡6/35x35拼接图纸_006.txt'));
  const atlasFile = path.resolve(arg('--atlas', '实验关/关卡6/分析_v632/target-atlas.json'));
  const candidatesFile = path.resolve(arg('--candidates', '实验关/关卡6/分析_v632/story-candidates.json'));
  const outDir = path.resolve(arg('--out-dir', path.dirname(atlasFile)));
  const maxDepth = Math.max(1, parseInt(arg('--max-depth', '4'), 10) || 4);
  const A = loadSolver();
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(target, 'utf8'));
  const atlas = readJson(atlasFile);
  const byCell = regionLookup(atlas);
  const source = readJson(candidatesFile);
  const sourcePlan = source.storyPlans.find(x => x.label === '20-40 / 7×7') || source.storyPlans[0];
  if (!sourcePlan || !sourcePlan.plan || !sourcePlan.plan.cars) throw new Error('找不到20-40 / 7×7参考计划');

  const basePath = [
    { role: 'entry', color: 30, count: 22 },
    { role: 'hollow', color: 15, count: 24 },
    { role: 'debt', color: 17, count: 26 },
    { role: 'release', color: 31, count: 30 }
  ];
  const actionCounts = new Map();
  for (const car of sourcePlan.plan.cars) {
    const key = car.color + ':' + car.cap;
    actionCounts.set(key, (actionCounts.get(key) || 0) + 1);
  }
  for (const action of basePath) {
    const key = action.color + ':' + action.count;
    actionCounts.set(key, (actionCounts.get(key) || 0) - 1);
  }
  const actions = [];
  for (const [key, count] of actionCounts) {
    if (count <= 0) continue;
    const p = key.split(':').map(Number);
    actions.push({ color: p[0], count: p[1], available: count });
  }

  let frontier = [{ path: basePath, used: new Map(basePath.map(a => [a.color + ':' + a.count, 1])) }];
  const seen = new Set();
  const results = [];
  const baseState = stateFromPath(A, blocks, basePath);
  const baseReach = reachableRegions(baseState, A, byCell);
  const initial = {
    path: basePath,
    reachable: Array.from(baseReach.ids).sort(),
    buffer: baseState.buffer.map(x => ({ color: x.color, remaining: x.remaining }))
  };

  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next = [];
    for (const node of frontier) {
      for (const action of actions) {
        const key = action.color + ':' + action.count;
        const used = node.used.get(key) || 0;
        if (used >= action.available) continue;
        const path = node.path.concat({ role: 'search', color: action.color, count: action.count });
        const state = stateFromPath(A, blocks, path);
        if (state.overflow || state.gameOver) continue;
        const reach = reachableRegions(state, A, byCell);
        const hit = ['R59', 'R65'].filter(id => reach.ids.has(id));
        const nextUsed = new Map(node.used);
        nextUsed.set(key, used + 1);
        const keyState = stateKey(state);
        if (seen.has(keyState)) continue;
        seen.add(keyState);
        if (hit.length) {
          results.push({
            depth,
            path,
            hits: hit,
            reachable: Array.from(reach.ids).sort(),
            buffer: state.buffer.map(x => ({
              color: x.color,
              progress: x.progress,
              remaining: x.remaining
            }))
          });
        } else if (depth < maxDepth) {
          next.push({ path, used: nextUsed });
        }
      }
    }
    frontier = next;
  }

  const result = {
    schema: 'story-reveal-search-v0',
    target,
    base: initial,
    maxDepth,
    searchedActions: actions,
    results: results.sort((a, b) => a.path.length - b.path.length).slice(0, 50)
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'story-reveal-search-v1.json'), JSON.stringify(result, null, 2) + '\n');
  const lines = [
    '# 006 Story Reveal Search v1',
    '',
    '> 目标状态只读搜索；棋盘尚未参与。',
    '',
    '## 四步链后的可达状态',
    '',
    '- 可达区域数：' + initial.reachable.length,
    '- 暂存：' + (initial.buffer.length ? initial.buffer.map(x => x.color + '欠' + x.remaining).join(', ') : '空'),
    '',
    '## 命中 R59/R65 的最短续写',
    '',
    results.length
      ? results.sort((a, b) => a.path.length - b.path.length).slice(0, 10).map(x =>
        '- 深度 ' + x.depth + '：' + x.path.map(y => y.color + '/' + y.count).join(' → ') + '；打开 ' + x.hits.join('、') + '；暂存 ' + (x.buffer.length ? x.buffer.map(y => y.color + '欠' + y.remaining).join(',') : '空')
      ).join('\n')
      : '未在搜索预算内找到。',
    '',
    '## 限制',
    '',
    '- 当前搜索不验证棋盘可点性；',
    '- 当前搜索不处理锁链组；',
    '- 找到动作链后仍需构造棋盘并重新求解。'
  ];
  fs.writeFileSync(path.join(outDir, 'story-reveal-search-v1.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify({
    ok: true,
    outDir,
    baseReachable: initial.reachable.length,
    resultCount: results.length,
    shortest: results.sort((a, b) => a.path.length - b.path.length).slice(0, 5)
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
