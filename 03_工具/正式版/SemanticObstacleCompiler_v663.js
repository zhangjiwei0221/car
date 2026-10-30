#!/usr/bin/env node
'use strict';

/**
 * E4.1/E4.2: semantic obstacle schema and the first delayedGate.
 *
 * The gate is compiled onto the schema-generated E3 layout A. It must reduce
 * the visible second-group options without changing the core story.
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

function optionWindow(A, level, actions) {
  const state = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  for (const [r, c] of actions) A.Simulator.applyPick(state, r, c);
  const moves = A.Simulator.listMoves(state).filter(x => !x.blocked);
  return {
    moves: moves.length,
    cells: moves.map(x => [x.r, x.c, x.antBox.color, x.antBox.count]),
    ice: Object.fromEntries(Object.entries(state.numice || {}).map(([k, v]) => [k, v.remaining]))
  };
}

function playerReveals(A, level, run, atlas) {
  const byCell = {};
  for (const region of atlas.target.regions || []) {
    for (const cell of region.cells || []) byCell[cell[0] + ',' + cell[1]] = region.id;
  }
  const eliminated = A.outsideReachSeed(level.blocks, level.rows, level.cols, false);
  let pixels = 0;
  const view = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  const first = {};
  for (let i = 0; i < run.frames.length; i++) {
    for (const cell of run.frames[i].eats || []) {
      if (!eliminated[cell.r][cell.c]) {
        eliminated[cell.r][cell.c] = true;
        pixels++;
      }
    }
    view.eliminated = eliminated;
    view.eliminatedPixels = pixels;
    const preview = A.Simulator.previewNextEliminationOrder(view);
    for (let r = 0; r < preview.rank.length; r++) {
      for (let c = 0; c < preview.rank[r].length; c++) {
        if (!(preview.rank[r][c] > 0)) continue;
        const id = byCell[r + ',' + c];
        if ((id === 'R59' || id === 'R65') && !first[id]) {
          first[id] = {
            step: run.pickOrder[i] && run.pickOrder[i].step,
            progressPct: +(pixels / level.totalPixels * 100).toFixed(1)
          };
        }
      }
    }
  }
  return first;
}

function finalDebt(run) {
  const events = run.instantEvents || [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.pick && (e.bufferAfter > e.bufferBefore ||
        (e.stalled && e.stalled.length))) {
      return {
        debt: {
          tick: e.tick,
          color: e.pick.color,
          bufferBefore: e.bufferBefore,
          bufferAfter: e.bufferAfter,
          stalled: e.stalled
        },
        next: events[i + 1] ? {
          tick: events[i + 1].tick,
          bufferBefore: events[i + 1].bufferBefore,
          bufferAfter: events[i + 1].bufferAfter
        } : null
      };
    }
  }
  return null;
}

function main() {
  const A = loadSolver();
  const baseFile = path.join(ROOT, '实验关/关卡6/E3_v1/E3布局A.json');
  const atlasFile = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');
  const outDir = path.join(ROOT, '实验关/关卡6/E4_v1');
  const atlas = readJson(atlasFile);
  const base = A.parseLevel(A.fromGameFormat(readJson(baseFile)));
  const cells = base.board.cells.map(row => row.map(cell => cell ? clone(cell) : null));
  const iceSpec = [
    { r: 0, c: 3, numice: 4 },
    { r: 0, c: 4, numice: 6 },
    { r: 0, c: 5, numice: 6 },
    { r: 0, c: 6, numice: 6 }
  ];
  for (const item of iceSpec) {
    const cell = cells[item.r][item.c];
    if (!cell || cell.t !== 'box') throw new Error('冰目标不是车: ' + item.r + ',' + item.c);
    cell.numice = item.numice;
  }
  const gated = A.parseLevel({
    blocks: base.blocks,
    bufferLimit: base.bufferLimit,
    board: { rows: 7, cols: 7, cells }
  });

  const storyCells = [[0, 2], [0, 1], [0, 0], [1, 0], [0, 3], [1, 3]];
  const expected = storyCells.map(x => x.join(','));
  const solveBase = A.Solver.solveInstantChain(base, { timeBudgetMs: 20000 });
  const solveGated = A.Solver.solveInstantChain(gated, { timeBudgetMs: 20000 });
  const prefix = run => routePrefix(run, 6).map(x => x.r + ',' + x.c);

  const playersBase = [];
  const playersGated = [];
  let capture = null;
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const rb = A.PlayerSim.run(base, { seed, instantChain: true, reviveCap });
      const rg = A.PlayerSim.run(gated, {
        seed,
        instantChain: true,
        reviveCap,
        capture: reviveCap === 0 && seed === 7
      });
      playersBase.push({
        seed,
        reviveCap,
        won: rb.won,
        progress: rb.progress,
        bufferPeak: rb.bufferPeak,
        revivesUsed: rb.revivesUsed,
        prefixMatches: prefix(rb).join('>') === expected.join('>')
      });
      playersGated.push({
        seed,
        reviveCap,
        won: rg.won,
        progress: rg.progress,
        bufferPeak: rg.bufferPeak,
        revivesUsed: rg.revivesUsed,
        prefixMatches: prefix(rg).join('>') === expected.join('>')
      });
      if (reviveCap === 0 && seed === 7) capture = rg;
    }
  }

  const reveals = playerReveals(A, gated, capture, atlas);
  const finale = finalDebt(capture);
  const baseWindow1 = optionWindow(A, base, storyCells.slice(0, 2));
  const baseWindow2 = optionWindow(A, base, storyCells.slice(0, 4));
  const gatedWindow1 = optionWindow(A, gated, storyCells.slice(0, 2));
  const gatedWindow2 = optionWindow(A, gated, storyCells.slice(0, 4));

  const plan = {
    schema: 'semantic-obstacle-plan-v1',
    obstacles: [
      {
        id: 'OG1',
        beatId: 'second_group_gate',
        role: 'delay',
        mechanism: 'numice',
        targetCars: iceSpec.map(x => ({
          cell: [x.r, x.c],
          color: cells[x.r][x.c].color,
          count: cells[x.r][x.c].count,
          numice: x.numice
        })),
        targetZones: ['R223', 'R227', 'R176', 'R184'],
        expectedPlayerEffect: '第一组完成前，第二债务与支持车辆不可用；4/6倒计时提示解锁成本。',
        removalPrediction: '移除后第二组立即并入可见选项，顺序约束消失。'
      }
    ]
  };

  const checks = {
    baseAndGatedSolve: solveBase.completed && solveGated.completed,
    baseAndGatedPrefix: prefix(solveBase).join('>') === expected.join('>') &&
      prefix(solveGated).join('>') === expected.join('>'),
    basePlayersPass: playersBase.every(x => x.won && x.prefixMatches && x.revivesUsed === 0),
    gatedPlayersPass: playersGated.every(x => x.won && x.prefixMatches && x.revivesUsed === 0),
    revealPreserved: !!reveals.R59 && !!reveals.R65,
    finalePreserved: !!(finale && finale.next &&
      finale.next.bufferAfter < finale.debt.bufferAfter),
    visibleChoiceReduced:
      gatedWindow1.moves < baseWindow1.moves &&
      gatedWindow2.moves < baseWindow2.moves
  };
  const passed = Object.values(checks).every(Boolean);

  const game = A.toGameFormat(gated);
  const outFile = path.join(outDir, 'E4_delayedGate_数字冰.json');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(game, null, 2) + '\n');
  fs.writeFileSync(
    path.join(outDir, 'obstacle-plan-v1.json'),
    JSON.stringify(plan, null, 2) + '\n'
  );

  const result = {
    schema: 'e4-delayed-gate-result-v1',
    status: passed ? 'E4_DELAY_GATE_PASS' : 'E4_DELAY_GATE_FAIL',
    baseFile,
    outFile,
    plan,
    windows: {
      base: { after2: baseWindow1, after4: baseWindow2 },
      gated: { after2: gatedWindow1, after4: gatedWindow2 }
    },
    solve: {
      base: { completed: solveBase.completed, progress: solveBase.progress, peak: solveBase.maxBuffer },
      gated: { completed: solveGated.completed, progress: solveGated.progress, peak: solveGated.maxBuffer }
    },
    players: { base: playersBase, gated: playersGated },
    reveals,
    finale,
    checks
  };
  fs.writeFileSync(
    path.join(outDir, 'delayed-gate-result-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );

  const md = [
    '# 006 · E4 delayedGate · 数字冰',
    '',
    '## 结论',
    '',
    passed ? '语义数字冰门通过。' : '语义数字冰门失败。',
    '',
    '## 障碍绑定',
    '',
    '- beatId：`second_group_gate`；',
    '- role：`delay`；',
    '- mechanism：`numice`；',
    '- 4格：`(0,3)=4`，`(0,4/5/6)=6`；',
    '- 预期：第一组前锁住第二组，4/6提示解锁成本。',
    '',
    '## 可见选项',
    '',
    '| 时点 | 无冰 | 有冰 |',
    '|---|---:|---:|',
    '| 第一组两拿后 | ' + baseWindow1.moves + ' | ' + gatedWindow1.moves + ' |',
    '| 第一组四拿后 | ' + baseWindow2.moves + ' | ' + gatedWindow2.moves + ' |',
    '',
    '## 验证',
    '',
    '- 全知：' + (checks.baseAndGatedSolve ? '通过' : '失败') + '；',
    '- 六步前缀：' + (checks.baseAndGatedPrefix ? '通过' : '失败') + '；',
    '- 默认/0复活PlayerSim：' + (checks.gatedPlayersPass ? '通过' : '失败') + '；',
    '- R59/R65：' + (checks.revealPreserved ? '通过' : '失败') + '；',
    '- 终局释放：' + (checks.finalePreserved ? '通过' : '失败') + '；',
    '- 移除消融改变可见选项：' + (checks.visibleChoiceReduced ? '是' : '否') + '。',
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'delayed-gate-result-v1.md'), md);

  console.log(JSON.stringify({
    ok: passed,
    outDir,
    checks,
    windows: result.windows,
    solve: result.solve,
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
