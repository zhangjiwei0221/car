#!/usr/bin/env node
'use strict';

/** Read-only reveal audit for a playable story level. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js'
];

function loadSolver() {
  const sb = {
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
  sb.global = sb;
  vm.createContext(sb);
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(BIN, file), 'utf8'), sb, { filename: file });
  }
  return sb.AntSolver;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  const levelFile = path.resolve(arg('--level', '实验关/关卡6/原型_v4/关卡_实验_v4.json'));
  const atlasFile = path.resolve(arg('--atlas', '实验关/关卡6/分析_v632/target-atlas.json'));
  const outFile = path.resolve(arg('--out', '实验关/关卡6/原型_v4/story-reveal-evidence-v1.json'));
  const A = loadSolver();
  const raw = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
  const level = A.parseLevel(A.fromGameFormat(raw));
  const atlas = JSON.parse(fs.readFileSync(atlasFile, 'utf8'));
  const byCell = {};
  for (const region of atlas.target.regions || []) {
    for (const p of region.cells || []) byCell[p[0] + ',' + p[1]] = region.id;
  }
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  if (!solve.completed) throw new Error('关卡未能全知通关');
  const state = A.Simulator.enter(level, { useSlotStart: true, instantChain: true });
  const firstReach = {};
  const traces = [];
  for (let i = 0; i < solve.pickOrder.length; i++) {
    const pv = A.Simulator.previewNextEliminationOrder(state);
    const reachable = {};
    for (let r = 0; r < pv.rank.length; r++) {
      for (let c = 0; c < pv.rank[r].length; c++) {
        if (pv.rank[r][c] > 0) {
          const id = byCell[r + ',' + c];
          if (id) reachable[id] = true;
        }
      }
    }
    for (const id of ['R59', 'R65']) {
      if (reachable[id] && !firstReach[id]) {
        firstReach[id] = {
          step: i + 1,
          progress: +(state.eliminatedPixels / level.totalPixels).toFixed(4),
          nextPick: solve.pickOrder[i],
          source: 'solver_route'
        };
      }
    }
    const pick = solve.pickOrder[i];
    traces.push({
      step: i + 1,
      pick,
      r59Reachable: !!reachable.R59,
      r65Reachable: !!reachable.R65
    });
    A.Simulator.applyPick(state, pick.r, pick.c);
  }
  const result = {
    schema: 'story-reveal-evidence-v1',
    levelFile,
    atlasFile,
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      steps: solve.steps,
      maxBuffer: solve.maxBuffer
    },
    firstReach,
    traces: traces.slice(Math.max(0, traces.findIndex(x => x.r59Reachable || x.r65Reachable) - 3))
  };
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
  const md = [
    '# 006 Story Reveal Evidence v1',
    '',
    '- 关卡：`' + levelFile + '`',
    '- 全知通关：' + (solve.completed ? '是' : '否'),
    '- 全知最大 buffer：' + solve.maxBuffer,
    '',
    '## 首次 reach',
    '',
    '- R59：' + (firstReach.R59 ? '第 ' + firstReach.R59.step + ' 步 / ' + (firstReach.R59.progress * 100).toFixed(1) + '%' : '未出现'),
    '- R65：' + (firstReach.R65 ? '第 ' + firstReach.R65.step + ' 步 / ' + (firstReach.R65.progress * 100).toFixed(1) + '%' : '未出现'),
    '',
    '## 限制',
    '',
    '这条 reveal 证据来自当前全知路线；棋盘仍需继续检查替代路线和真实可读性。'
  ].join('\n') + '\n';
  fs.writeFileSync(outFile.replace(/\.json$/, '.md'), md);
  console.log(JSON.stringify({ ok: true, outFile, firstReach, solve: result.solve }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
