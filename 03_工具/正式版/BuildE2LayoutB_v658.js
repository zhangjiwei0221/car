#!/usr/bin/env node
'use strict';

/**
 * E2.6: build a second layout under the critical-colour constraints.
 *
 * Layout B fixes the six critical cells and two black cells, then rotates the
 * flattened non-critical cells of rows 3..6 by three positions.
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

function playerReveals(A, level, run, atlas) {
  const byCell = {};
  for (const region of atlas.target.regions || []) {
    for (const cell of region.cells || []) byCell[cell[0] + ',' + cell[1]] = region.id;
  }
  const eliminated = A.outsideReachSeed(level.blocks, level.rows, level.cols, false);
  let eliminatedPixels = 0;
  const view = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  const firstReach = {};
  for (let i = 0; i < run.frames.length; i++) {
    for (const cell of run.frames[i].eats || []) {
      if (!eliminated[cell.r][cell.c]) {
        eliminated[cell.r][cell.c] = true;
        eliminatedPixels++;
      }
    }
    view.eliminated = eliminated;
    view.eliminatedPixels = eliminatedPixels;
    const preview = A.Simulator.previewNextEliminationOrder(view);
    for (let r = 0; r < preview.rank.length; r++) {
      for (let c = 0; c < preview.rank[r].length; c++) {
        if (!(preview.rank[r][c] > 0)) continue;
        const id = byCell[r + ',' + c];
        if ((id === 'R59' || id === 'R65') && !firstReach[id]) {
          const pick = run.pickOrder[i];
          firstReach[id] = {
            step: pick && pick.step,
            tick: pick && pick.tick,
            progressPct: +(eliminatedPixels / level.totalPixels * 100).toFixed(1),
            pick: pick ? { r: pick.r, c: pick.c, color: pick.color, count: pick.count } : null
          };
        }
      }
    }
  }
  return firstReach;
}

function finalDebtAndRelease(run) {
  const events = run.instantEvents || [];
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.pick && (event.bufferAfter > event.bufferBefore ||
        (event.stalled && event.stalled.length))) {
      return {
        debt: {
          tick: event.tick,
          r: event.pick.r,
          c: event.pick.c,
          color: event.pick.color,
          need: event.pick.need,
          bufferBefore: event.bufferBefore,
          bufferAfter: event.bufferAfter,
          stalled: event.stalled
        },
        next: events[i + 1] ? {
          tick: events[i + 1].tick,
          pick: events[i + 1].pick,
          bufferBefore: events[i + 1].bufferBefore,
          bufferAfter: events[i + 1].bufferAfter
        } : null
      };
    }
  }
  return null;
}

function carMultiset(level) {
  const list = [];
  for (let r = 0; r < level.board.rows; r++) {
    for (let c = 0; c < level.board.cols; c++) {
      const cell = level.board.cells[r][c];
      if (cell && cell.t === 'box') list.push(cell.color + '/' + cell.count);
    }
  }
  return list.sort();
}

function main() {
  const sourceFile = path.resolve(arg(
    '--source',
    '实验关/关卡6/原型_v8/关卡_实验_v8.json'
  ));
  const atlasFile = path.resolve(arg(
    '--atlas',
    '实验关/关卡6/分析_v632/target-atlas.json'
  ));
  const outDir = path.resolve(arg('--out-dir', '实验关/关卡6/E2_v1/layoutB'));
  const A = loadSolver();
  const source = A.parseLevel(A.fromGameFormat(readJson(sourceFile)));
  const atlas = readJson(atlasFile);
  const cells = source.board.cells.map(row => row.map(cell => cell ? clone(cell) : null));
  const flat = [];
  for (let r = 3; r < 7; r++) {
    for (let c = 0; c < 7; c++) flat.push([r, c]);
  }
  const cars = flat.map(([r, c]) => clone(cells[r][c]));
  const shift = 3;
  for (let i = 0; i < cars.length; i++) {
    const [r, c] = flat[(i + shift) % cars.length];
    cells[r][c] = cars[i];
  }

  let moved = 0;
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const a = source.board.cells[r][c];
      const b = cells[r][c];
      if ((a && a.color) !== (b && b.color) ||
          (a && a.count) !== (b && b.count)) moved++;
    }
  }
  const level = A.parseLevel({
    blocks: source.blocks,
    bufferLimit: source.bufferLimit,
    board: { rows: 7, cols: 7, cells }
  });
  const multisetA = carMultiset(source);
  const multisetB = carMultiset(level);
  const multisetSame = multisetA.join('|') === multisetB.join('|');
  if (!multisetSame) throw new Error('布局B改变了车辆容量多重集合');
  if (moved < 8) throw new Error('布局B移动格数不足8');

  const expected = ['0,2', '0,1', '0,0', '1,0', '0,3', '1,3'];
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  if (!solve.completed) throw new Error('布局B全知不可解');
  const solvePrefix = routePrefix(solve, 6).map(x => x.r + ',' + x.c);
  if (solvePrefix.join('>') !== expected.join('>')) {
    throw new Error('布局B全知前六步偏离');
  }

  const players = [];
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap,
        capture: reviveCap === 0 && seed === 7
      });
      const prefix = routePrefix(run, 6);
      const prefixMatches = prefix.map(x => x.r + ',' + x.c).join('>') === expected.join('>');
      if (!run.won || !prefixMatches) {
        throw new Error('布局B PlayerSim失败: seed=' + seed + ' cap=' + reviveCap);
      }
      players.push({
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        bufferPeak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        prefixMatches,
        firstSix: prefix,
        pickOrder: run.pickOrder,
        instantEvents: run.instantEvents,
        captureRun: reviveCap === 0 && seed === 7 ? run : null
      });
    }
  }

  const capturePlayer = players.find(x => x.captureRun).captureRun;
  const reveals = playerReveals(A, level, capturePlayer, atlas);
  if (!reveals.R59 || !reveals.R65) throw new Error('布局B缺少R59/R65揭示');
  const finale = finalDebtAndRelease(capturePlayer);
  if (!finale || !finale.next || finale.next.bufferAfter >= finale.debt.bufferAfter) {
    throw new Error('布局B缺少终局债务释放');
  }

  const game = A.toGameFormat(level);
  const cleanPlayers = players.map(({ captureRun, ...rest }) => rest);
  const report = {
    schema: 'e2-layout-b-v1',
    sourceFile,
    atlasFile,
    gameFormat: path.join(outDir, '关卡_E2布局B.json'),
    layout: {
      movedCells: moved,
      shiftRows: [3, 6],
      shift,
      multisetSame,
      criticalCells: {
        '0,2': { color: cells[0][2].color, count: cells[0][2].count },
        '0,1': { color: cells[0][1].color, count: cells[0][1].count },
        '0,0': { color: cells[0][0].color, count: cells[0][0].count },
        '1,0': { color: cells[1][0].color, count: cells[1][0].count },
        '0,3': { color: cells[0][3].color, count: cells[0][3].count },
        '1,3': { color: cells[1][3].color, count: cells[1][3].count }
      }
    },
    allKnowing: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer,
      firstSix: solvePrefix
    },
    players: cleanPlayers,
    reveals,
    finale
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(report.gameFormat, JSON.stringify(game, null, 2) + '\n');
  fs.writeFileSync(
    path.join(outDir, '关卡_E2布局B.debug.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(outDir, '关卡_E2布局B.route.json'),
    JSON.stringify({
      schema: 'e2-layout-b-route-v1',
      allKnowingPickOrder: solve.pickOrder,
      playerRuns: cleanPlayers
    }, null, 2) + '\n'
  );
  const md = [
    '# 006 · E2.6 第二布局 B',
    '',
    '## 约束',
    '',
    '- 固定六个关键格：30/15/17/31/34/5；',
    '- 固定两个黑块；',
    '- 只将第4～7行循环移动3格；',
    '- 移动格数：' + moved + '；',
    '- 容量多重集合不变：' + (multisetSame ? '是' : '否') + '。',
    '',
    '## 验证',
    '',
    '- 全知前六步与计划一致，47/47通关，峰值' + solve.maxBuffer + '；',
    '- PlayerSim默认/0复活共6局全部通关且前六步一致；',
    '- R59：第' + reveals.R59.step + '步/' + reveals.R59.progressPct + '%；',
    '- R65：第' + reveals.R65.step + '步/' + reveals.R65.progressPct + '%；',
    '- 终局债务：' + finale.debt.color + '/' + finale.debt.need +
      '，buffer ' + finale.debt.bufferBefore + '→' + finale.debt.bufferAfter + '；',
    '- 下一手释放：buffer ' + finale.next.bufferBefore + '→' + finale.next.bufferAfter + '。',
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, '关卡_E2布局B.md'), md);

  console.log(JSON.stringify({
    ok: true,
    outDir,
    moved,
    multisetSame,
    allKnowing: report.allKnowing,
    players: cleanPlayers,
    reveals,
    finale
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
