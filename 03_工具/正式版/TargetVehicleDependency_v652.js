#!/usr/bin/env node
'use strict';

/**
 * E2 first prototype: target-region <-> vehicle-action dependency graph.
 *
 * Input:
 *   - a client-ready level JSON;
 *   - its route JSON (player pickOrder);
 *   - target-atlas.json.
 *
 * Output:
 *   - every pick action;
 *   - target regions consumed by that action;
 *   - target regions newly reachable after it;
 *   - sequence, consume and reveal edges.
 *
 * Read-only. It does not generate a level or modify obstacles.
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

function regionLookup(atlas) {
  const byCell = {};
  const byId = {};
  for (const region of atlas.target.regions || []) {
    byId[region.id] = region;
    for (const cell of region.cells || []) byCell[cell[0] + ',' + cell[1]] = region.id;
  }
  return { byCell, byId };
}

function reachableRegions(preview, lookup) {
  const ids = new Set();
  for (let r = 0; r < preview.rank.length; r++) {
    for (let c = 0; c < preview.rank[r].length; c++) {
      if (preview.rank[r][c] > 0) {
        const id = lookup.byCell[r + ',' + c];
        if (id) ids.add(id);
      }
    }
  }
  return [...ids].sort();
}

function regionHits(cells, lookup) {
  const counts = {};
  for (const cell of cells || []) {
    const r = Array.isArray(cell) ? cell[0] : cell.r;
    const c = Array.isArray(cell) ? cell[1] : cell.c;
    const id = lookup.byCell[r + ',' + c];
    if (id) counts[id] = (counts[id] || 0) + 1;
  }
  return Object.keys(counts).map(id => ({
    region: id,
    color: lookup.byId[id].color,
    pixels: counts[id]
  })).sort((a, b) => b.pixels - a.pixels || a.region.localeCompare(b.region));
}

function bufferSummary(state) {
  return state.buffer.map(item => ({
    color: item.color,
    progress: item.progress,
    need: item.need,
    remaining: item.need - item.progress,
    slot: item.slot
  }));
}

function plannedRoles() {
  return [
    { step: 1, role: 'teach.entry' },
    { step: 2, role: 'teach.hollow' },
    { step: 3, role: 'debt.short' },
    { step: 4, role: 'release.short' },
    { step: 5, role: 'debt.second' },
    { step: 6, role: 'release.second' },
    { step: 7, role: 'debt.long.start' },
    { step: 8, role: 'debt.long.second' },
    { step: 30, role: 'reveal.R59' },
    { step: 31, role: 'reveal.R65' },
    { step: 35, role: 'debt.long.release' },
    { step: 43, role: 'finale.debt' },
    { step: 44, role: 'finale.release' }
  ];
}

function main() {
  const levelFile = path.resolve(arg(
    '--level',
    '实验关/关卡6/原型_v8/关卡_实验_v8.json'
  ));
  const routeFile = path.resolve(arg(
    '--route',
    '实验关/关卡6/原型_v8/关卡_实验_v8.route.json'
  ));
  const atlasFile = path.resolve(arg(
    '--atlas',
    '实验关/关卡6/分析_v632/target-atlas.json'
  ));
  const outDir = path.resolve(arg('--out-dir', '实验关/关卡6/E2_v1'));
  const A = loadSolver();
  const level = A.parseLevel(A.fromGameFormat(readJson(levelFile)));
  const route = readJson(routeFile);
  const atlas = readJson(atlasFile);
  const lookup = regionLookup(atlas);
  const player = (route.playerRuns || []).find(x =>
    x.seed === 7 && x.reviveCap === 0
  );
  if (!player) throw new Error('route 中缺少 seed7 / reviveCap0');

  const state = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  state.capture = true;
  const roleByStep = Object.fromEntries(plannedRoles().map(x => [x.step, x.role]));
  const actions = [];
  const sequenceEdges = [];
  const consumeEdges = [];
  const revealEdges = [];
  const seen = new Set();

  for (const pick of player.pickOrder) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    const beforePreview = A.Simulator.previewNextEliminationOrder(state);
    const beforeRegions = new Set(reachableRegions(beforePreview, lookup));
    const bufferBefore = bufferSummary(state);
    const pixelsBefore = state.eliminatedPixels;
    state.capOps = [];
    if (!A.Simulator.applyPick(state, pick.r, pick.c)) {
      throw new Error('无法回放动作 ' + pick.step + ' (' + pick.r + ',' + pick.c + ')');
    }
    const eatCells = [];
    for (const op of state.capOps || []) {
      if (op.t === 'eat') eatCells.push(...(op.cells || []));
    }
    const hits = regionHits(eatCells, lookup);
    const afterPreview = A.Simulator.previewNextEliminationOrder(state);
    const afterRegions = reachableRegions(afterPreview, lookup);
    const revealed = afterRegions.filter(id => !beforeRegions.has(id));
    const add = (state.capOps || []).find(op => op.t === 'add');
    const id = 'A' + String(pick.step).padStart(2, '0');
    actions.push({
      id,
      step: pick.step,
      role: roleByStep[pick.step] || 'route',
      cell: [pick.r, pick.c],
      color: pick.color,
      count: pick.count,
      slot: add ? add.slot : null,
      start: add ? add.start : null,
      pixelsBefore,
      pixelsAfter: state.eliminatedPixels,
      consumedPixels: state.eliminatedPixels - pixelsBefore,
      bufferBefore,
      bufferAfter: bufferSummary(state),
      regionsConsumed: hits,
      regionsRevealed: revealed
    });
    for (const hit of hits) {
      consumeEdges.push({
        from: id,
        to: hit.region,
        pixels: hit.pixels,
        color: hit.color
      });
    }
    for (const region of revealed) {
      revealEdges.push({
        from: id,
        to: region,
        color: lookup.byId[region].color
      });
    }
    if (actions.length > 1) {
      sequenceEdges.push({
        from: actions[actions.length - 2].id,
        to: id,
        stepFrom: pick.step - 1,
        stepTo: pick.step
      });
    }
  }

  const regionIds = [...new Set([
    ...consumeEdges.map(x => x.to),
    ...revealEdges.map(x => x.to)
  ])].sort();
  const graph = {
    schema: 'target-vehicle-dependency-v1',
    levelFile,
    routeFile,
    atlasFile,
    routeIdentity: {
      seed: player.seed,
      reviveCap: player.reviveCap,
      won: player.won,
      progress: player.progress,
      bufferPeak: player.bufferPeak
    },
    nodes: {
      actions: actions.map(x => ({
        id: x.id,
        type: 'vehicleAction',
        step: x.step,
        role: x.role,
        cell: x.cell,
        color: x.color,
        count: x.count
      })),
      regions: regionIds.map(id => ({
        id,
        type: 'targetRegion',
        color: lookup.byId[id].color,
        pixels: (lookup.byId[id].cells || []).length
      }))
    },
    edges: {
      sequence: sequenceEdges,
      consumes: consumeEdges,
      reveals: revealEdges
    },
    actions
  };

  const firstSix = actions.slice(0, 6);
  const checks = {
    actionCount: actions.length === 47,
    firstSixCells: firstSix.map(x => x.cell.join(',')).join('>') ===
      '0,2>0,1>0,0>1,0>0,3>1,3',
    firstDebtConsumed: firstSix[2].bufferAfter.some(x => x.color === 17 && x.remaining === 10),
    firstReleaseCleared: !firstSix[3].bufferAfter.some(x => x.color === 17),
    secondDebtConsumed: firstSix[4].bufferAfter.some(x => x.color === 34 && x.remaining === 6),
    secondReleaseCleared: !firstSix[5].bufferAfter.some(x => x.color === 34),
    R59Owned: actions.some(x => x.regionsRevealed.includes('R59')),
    R65Owned: actions.some(x => x.regionsRevealed.includes('R65'))
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error('E2依赖图检查失败: ' + JSON.stringify(checks));
  }

  graph.checks = checks;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'dependency-graph-v1.json'),
    JSON.stringify(graph, null, 2) + '\n'
  );

  const md = [
    '# 006 · E2 车辆—目标区域依赖图 v1',
    '',
    '> 只读依赖原型；不是生成器接入，不新增障碍。',
    '',
    '## 输入',
    '',
    '- 关卡：`' + levelFile + '`',
    '- 玩家路线：seed ' + player.seed + ' / 0 复活',
    '- 动作：' + actions.length + '；区域节点：' + regionIds.length,
    '',
    '## 六步主线依赖',
    '',
    '| 动作 | 节拍 | 车辆 | 格子 | 实际消除 | 消费区域 | 新暴露区域 | 暂存 |',
    '|---|---|---|---|---:|---|---|---|',
    ...firstSix.map(x => '| ' + x.id + ' | ' + x.role + ' | ' +
      x.color + '/' + x.count + ' | ' + x.cell.join(',') + ' | ' +
      x.consumedPixels + ' | ' +
      (x.regionsConsumed.map(y => y.region + ':' + y.pixels).join('、') || '-') + ' | ' +
      (x.regionsRevealed.join('、') || '-') + ' | ' +
      (x.bufferAfter.length ? x.bufferAfter.map(y => y.color + '欠' + y.remaining).join('、') : '空') + ' |'),
    '',
    '## 关键揭示',
    '',
    ...actions
      .filter(x => x.regionsRevealed.includes('R59') || x.regionsRevealed.includes('R65'))
      .map(x => '- ' + x.id + '（第' + x.step + '步，' + x.color + '/' + x.count +
        '）揭示 ' + x.regionsRevealed.join('、')),
    '',
    '## 边',
    '',
    '- 顺序边：' + sequenceEdges.length,
    '- 消费边：' + consumeEdges.length,
    '- 揭示边：' + revealEdges.length,
    '',
    '## 检查',
    '',
    ...Object.entries(checks).map(([key, value]) => '- ' + key + '：' + (value ? '通过' : '失败')),
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'dependency-graph-v1.md'), md);

  console.log(JSON.stringify({
    ok: true,
    outDir,
    nodes: {
      actions: actions.length,
      regions: regionIds.length
    },
    edges: {
      sequence: sequenceEdges.length,
      consumes: consumeEdges.length,
      reveals: revealEdges.length
    },
    checks,
    firstSix: firstSix.map(x => ({
      id: x.id,
      role: x.role,
      cell: x.cell,
      color: x.color,
      count: x.count,
      consumedPixels: x.consumedPixels,
      regionsConsumed: x.regionsConsumed,
      regionsRevealed: x.regionsRevealed,
      bufferAfter: x.bufferAfter
    }))
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
