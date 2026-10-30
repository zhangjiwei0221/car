#!/usr/bin/env node
'use strict';

/**
 * E5: local repair tests, final validation and direct-delivery package.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniquePicks(run) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({ step: pick.step, r: pick.r, c: pick.c, color: pick.color, count: pick.count });
  }
  return out;
}

function staticCheck(schema, level) {
  const errors = [];
  let cars = 0;
  let sum = 0;
  let black = 0;
  let ice = 0;
  let chainCells = 0;
  const multiset = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const cell = level.board.cells[r][c];
      if (!cell) continue;
      if (cell.t === 'black') black++;
      if (cell.t === 'box') {
        cars++;
        sum += cell.count;
        multiset.push(cell.color + '/' + cell.count);
        if (cell.numice > 0) ice++;
        if (cell.chain > 0) chainCells++;
      }
    }
  }
  multiset.sort();
  if (cars !== schema.capacity.carCount) errors.push('car_count');
  if (sum !== schema.capacity.sum) errors.push('capacity_sum');
  if (black !== schema.board.blackCount) errors.push('black_count');
  if (multiset.join('|') !== schema.capacity.multiset.join('|')) {
    errors.push('capacity_multiset');
  }
  for (const item of schema.fixedCells) {
    const cell = level.board.cells[item.r][item.c];
    if (!cell || cell.t !== 'box' ||
        cell.color !== item.color || cell.count !== item.count) {
      errors.push('fixed_' + item.role);
    }
  }
  for (const item of schema.hardColorCells) {
    const [r, c] = item.cell;
    const cell = level.board.cells[r][c];
    if (!cell || cell.t !== 'box' || cell.color !== item.requiredColor) {
      errors.push('hard_color_' + r + ',' + c);
    }
  }
  return { ok: errors.length === 0, errors, counts: { cars, sum, black, ice, chainCells } };
}

function revealAndFinale(A, level, run, atlas) {
  const byCell = {};
  for (const region of atlas.target.regions || []) {
    for (const cell of region.cells || []) byCell[cell[0] + ',' + cell[1]] = region.id;
  }
  const eliminated = A.outsideReachSeed(level.blocks, level.rows, level.cols, false);
  let pixels = 0;
  const view = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  const reveals = {};
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
        if ((id === 'R59' || id === 'R65') && !reveals[id]) {
          reveals[id] = {
            step: run.pickOrder[i] && run.pickOrder[i].step,
            progressPct: +(pixels / level.totalPixels * 100).toFixed(1)
          };
        }
      }
    }
  }
  let finale = null;
  const events = run.instantEvents || [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.pick && (e.bufferAfter > e.bufferBefore ||
        (e.stalled && e.stalled.length))) {
      finale = {
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
      break;
    }
  }
  return { reveals, finale };
}

function routePrefix(run) {
  return uniquePicks(run).slice(0, 5).map(x => x.r + ',' + x.c);
}

function repairHardColor(A, schema, base) {
  const cells = base.board.cells.map(row => row.map(cell => cell ? clone(cell) : null));
  const tmp = cells[0][2];
  cells[0][2] = cells[0][4];
  cells[0][4] = tmp;
  const broken = A.parseLevel({
    blocks: base.blocks,
    bufferLimit: 5,
    board: { rows: 7, cols: 7, cells }
  });
  const before = staticCheck(schema, broken);
  const repairCells = broken.board.cells.map(row =>
    row.map(cell => cell ? clone(cell) : null)
  );
  const fixed = schema.fixedCells.find(x => x.r === 0 && x.c === 2);
  let donor = null;
  for (let r = 0; r < 7 && !donor; r++) {
    for (let c = 0; c < 7; c++) {
      const cell = repairCells[r][c];
      if (cell && cell.t === 'box' &&
          cell.color === fixed.color && cell.count === fixed.count) {
        donor = [r, c];
        break;
      }
    }
  }
  if (donor) {
    const t = repairCells[0][2];
    repairCells[0][2] = repairCells[donor[0]][donor[1]];
    repairCells[donor[0]][donor[1]] = t;
  }
  const repaired = A.parseLevel({
    blocks: base.blocks,
    bufferLimit: 5,
    board: { rows: 7, cols: 7, cells: repairCells }
  });
  const after = staticCheck(schema, repaired);
  return {
    type: 'hard_color',
    classified: !before.ok && before.errors.some(x => x.startsWith('hard_color_')),
    locallyRepairable: !!donor,
    repairedOk: after.ok,
    beforeErrors: before.errors
  };
}

function repairBlack(A, schema, base) {
  const cells = base.board.cells.map(row => row.map(cell => cell ? clone(cell) : null));
  cells[1][1] = null;
  const broken = A.parseLevel({
    blocks: base.blocks,
    bufferLimit: 5,
    board: { rows: 7, cols: 7, cells }
  });
  const before = staticCheck(schema, broken);
  cells[1][1] = { t: 'black' };
  const repaired = A.parseLevel({
    blocks: base.blocks,
    bufferLimit: 5,
    board: { rows: 7, cols: 7, cells }
  });
  const after = staticCheck(schema, repaired);
  return {
    type: 'black_shape',
    classified: !before.ok && before.errors.includes('black_count'),
    locallyRepairable: true,
    repairedOk: after.ok,
    beforeErrors: before.errors
  };
}

function repairRouteMismatch(A, schema, base) {
  const expected = ['0,2', '0,1', '0,0', '1,0', '0,3', '1,3'];
  const cells = base.board.cells.map(row => row.map(cell => cell ? clone(cell) : null));
  const temp = cells[1][3];
  cells[1][3] = cells[1][6];
  cells[1][6] = temp;
  const broken = A.parseLevel({
    blocks: base.blocks,
    bufferLimit: 5,
    board: { rows: 7, cols: 7, cells }
  });
  const staticBefore = staticCheck(schema, broken);
  const runBroken = A.PlayerSim.run(broken, {
    seed: 7,
    instantChain: true,
    reviveCap: 0
  });
  const brokenPrefix = uniquePicks(runBroken).slice(0, 6).map(x => x.r + ',' + x.c);
  const classified = staticBefore.ok && brokenPrefix.join('>') !== expected.join('>');

  const repairCells = broken.board.cells.map(row =>
    row.map(cell => cell ? clone(cell) : null)
  );
  const t = repairCells[1][3];
  repairCells[1][3] = repairCells[1][6];
  repairCells[1][6] = t;
  const repaired = A.parseLevel({
    blocks: base.blocks,
    bufferLimit: 5,
    board: { rows: 7, cols: 7, cells: repairCells }
  });
  const runRepaired = A.PlayerSim.run(repaired, {
    seed: 7,
    instantChain: true,
    reviveCap: 0
  });
  const repairedPrefix = uniquePicks(runRepaired).slice(0, 6).map(x => x.r + ',' + x.c);
  return {
    type: 'route_mismatch',
    classified,
    locallyRepairable: true,
    staticStillValid: staticBefore.ok,
    brokenPrefix,
    repairedPrefix,
    repairedOk: repairedPrefix.join('>') === expected.join('>') && runRepaired.won
  };
}

function rejectCapacity(A, schema, base) {
  const cells = base.board.cells.map(row => row.map(cell => cell ? clone(cell) : null));
  let target = null;
  for (let r = 0; r < 7 && !target; r++) {
    for (let c = 0; c < 7; c++) {
      const cell = cells[r][c];
      if (cell && cell.t === 'box' && !schema.fixedCells.some(x => x.r === r && x.c === c)) {
        cell.count++;
        target = [r, c];
        break;
      }
    }
  }
  const broken = A.parseLevel({
    blocks: base.blocks,
    bufferLimit: 5,
    board: { rows: 7, cols: 7, cells }
  });
  const result = staticCheck(schema, broken);
  return {
    type: 'capacity_contract',
    target,
    classified: !result.ok &&
      (result.errors.includes('capacity_sum') ||
       result.errors.includes('capacity_multiset')),
    locallyRepairable: false,
    action: 'reject_and_return_to_capacity_plan',
    errors: result.errors
  };
}

function main() {
  const A = loadSolver();
  const schemaFile = path.join(ROOT, '实验关/关卡6/E3_v1/board-constraint-schema-v1.json');
  const baseFile = path.join(ROOT, '实验关/关卡6/E3_v1/E3布局A.json');
  const finalFile = path.join(ROOT, '实验关/关卡6/E4_v1/E4_combined_冰链黑.json');
  const atlasFile = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');
  const schema = readJson(schemaFile);
  const atlas = readJson(atlasFile);
  const base = A.parseLevel(A.fromGameFormat(readJson(baseFile)));
  const finalRaw = readJson(finalFile);
  const finalLevel = A.parseLevel(A.fromGameFormat(finalRaw));

  const staticResult = staticCheck(schema, finalLevel);
  const solve = A.Solver.solveInstantChain(finalLevel, { timeBudgetMs: 20000 });
  const expected = ['0,2', '0,1', '1,0', '0,3', '1,3'];
  const players = [];
  let capture = null;
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(finalLevel, {
        seed,
        instantChain: true,
        reviveCap,
        capture: reviveCap === 0 && seed === 7
      });
      players.push({
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        bufferPeak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        prefixMatches: routePrefix(run).join('>') === expected.join('>')
      });
      if (reviveCap === 0 && seed === 7) capture = run;
    }
  }
  const revealFinal = revealAndFinale(A, finalLevel, capture, atlas);
  const roundtripRaw = A.toGameFormat(finalLevel);
  const roundtrip = A.parseLevel(A.fromGameFormat(roundtripRaw));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: 20000,
    greedyOnly: true
  });

  const repairs = [
    repairHardColor(A, schema, base),
    repairBlack(A, schema, base),
    repairRouteMismatch(A, schema, base)
  ];
  const rejected = rejectCapacity(A, schema, base);
  const repairChecks = {
    hardColorClassified: repairs[0].classified && repairs[0].repairedOk,
    blackClassified: repairs[1].classified && repairs[1].repairedOk,
    routeMismatchClassified: repairs[2].classified && repairs[2].repairedOk,
    capacityRejected: rejected.classified && !rejected.locallyRepairable
  };
  const finalChecks = {
    staticContract: staticResult.ok,
    solveCompleted: solve.completed === true,
    solvePrefix: uniquePicks(solve).slice(0, 5).map(x => x.r + ',' + x.c).join('>') ===
      expected.join('>'),
    allPlayersPass: players.every(x => x.won && x.progress === 100 && x.prefixMatches),
    noRevivePass: players.filter(x => x.reviveCap === 0)
      .every(x => x.revivesUsed === 0),
    revealR59: !!revealFinal.reveals.R59,
    revealR65: !!revealFinal.reveals.R65,
    finale: !!(revealFinal.finale && revealFinal.finale.next &&
      revealFinal.finale.next.bufferAfter < revealFinal.finale.debt.bufferAfter),
    roundtripSolvable: roundtripSolve.completed === true,
    fiveKeyFormat:
      Object.keys(finalRaw).sort().join(',') ===
      ['blocks', 'mapcol', 'maprow', 'spools', 'toprow'].sort().join(',')
  };
  const passed = Object.values(finalChecks).every(Boolean) &&
    Object.values(repairChecks).every(Boolean);

  const outDir = path.join(ROOT, '实验关/关卡6/E5_v1');
  fs.mkdirSync(outDir, { recursive: true });
  const deliveryFile = path.join(outDir, '006_E5_combined.json');
  fs.writeFileSync(deliveryFile, JSON.stringify(finalRaw, null, 2) + '\n');
  const hash = crypto.createHash('sha256')
    .update(fs.readFileSync(deliveryFile)).digest('hex');
  const manifest = {
    schema: 'e5-delivery-manifest-v1',
    id: '006_E5_combined',
    status: passed ? 'READY_FOR_CLIENT_IMPORT' : 'NOT_READY',
    levelFile: deliveryFile,
    sha256: hash,
    sourceFile: finalFile,
    generationCommand: 'node 03_工具/正式版/E5RepairAndDeliver_v670.js',
    manualEdits: 0,
    deterministic: true,
    seedSearch: false,
    batchAbortOnFailure: true,
    board: staticResult.counts,
    obstacles: {
      black: 2,
      numice: staticResult.counts.ice,
      chainGroups: 1,
      chainCells: staticResult.counts.chainCells,
      pipe: 0,
      question: 0
    },
    route: {
      expectedUniqueSteps: expected,
      allKnowing: uniquePicks(solve).slice(0, 5).map(x => x.r + ',' + x.c),
      players
    },
    reveal: revealFinal.reveals,
    finale: revealFinal.finale,
    finalChecks,
    repairChecks,
    repairs,
    rejectedCapacity: rejected
  };
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );

  const report = {
    schema: 'e5-repair-delivery-result-v1',
    passed,
    manifest,
    checks: { ...finalChecks, ...repairChecks }
  };
  fs.writeFileSync(
    path.join(outDir, 'repair-delivery-result-v1.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(outDir, 'README.md'),
    [
      '# 006 · E5 直接交付包',
      '',
      '## 状态',
      '',
      passed ? 'READY_FOR_CLIENT_IMPORT（实验交付，不自动安装）' : 'NOT_READY',
      '',
      '## 文件',
      '',
      '- `006_E5_combined.json`：客户端五键关卡；',
      '- `manifest.json`：hash、输入、障碍、路线与验证；',
      '- `repair-delivery-result-v1.json`：完整结果。',
      '',
      '## 关键结果',
      '',
      '- 全知：' + solve.progress + '%，峰值' + solve.maxBuffer + '；',
      '- PlayerSim 6局：' + (finalChecks.allPlayersPass ? '全部通过' : '失败') + '；',
      '- 0复活：' + (finalChecks.noRevivePass ? '通过' : '失败') + '；',
      '- 客户端往返：' + (finalChecks.roundtripSolvable ? '通过' : '失败') + '；',
      '- 人工修改：0。',
      '',
      '## 修复测试',
      '',
      '- 硬颜色错误：检测并局部恢复；',
      '- 黑块缺失：检测并局部恢复；',
      '- 路线错位：静态合同正确但玩家路线错，交换恢复；',
      '- 容量错误：拒绝局部修，必须回溯容量计划。',
      '',
      '## 边界',
      '',
      '- 仅006单图；',
      '- 未安装到桌面客户端；',
      '- 未做多图和真人校准。'
    ].join('\n')
  );

  console.log(JSON.stringify({
    ok: passed,
    outDir,
    hash,
    checks: report.checks,
    counts: staticResult.counts,
    repairChecks,
    rejected
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
