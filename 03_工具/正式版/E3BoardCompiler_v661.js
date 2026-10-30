#!/usr/bin/env node
'use strict';

/**
 * E3.2-E3.5: schema-driven board construction, verification, repair and
 * automatic two-layout generation.
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

function keyOf(color, count) {
  return color + '/' + count;
}

function carFromKey(key) {
  const [color, count] = key.split('/').map(Number);
  return { t: 'box', color, count, chain: 0, q: false, numice: 0 };
}

function multisetOfBoard(level) {
  const list = [];
  for (let r = 0; r < level.board.rows; r++) {
    for (let c = 0; c < level.board.cols; c++) {
      const cell = level.board.cells[r][c];
      if (cell && cell.t === 'box') list.push(keyOf(cell.color, cell.count));
    }
  }
  return list.sort();
}

function staticValidate(schema, level) {
  const errors = [];
  const board = level.board;
  if (board.rows !== schema.board.rows || board.cols !== schema.board.cols) {
    errors.push('board_size');
  }
  let black = 0;
  let cars = 0;
  let sum = 0;
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const cell = board.cells[r][c];
      if (cell && cell.t === 'black') black++;
      if (cell && cell.t === 'box') {
        cars++;
        sum += cell.count;
      }
    }
  }
  if (black !== schema.board.blackCount) errors.push('black_count');
  if (cars !== schema.capacity.carCount) errors.push('car_count');
  if (sum !== schema.capacity.sum) errors.push('capacity_sum');
  if (multisetOfBoard(level).join('|') !== schema.capacity.multiset.join('|')) {
    errors.push('capacity_multiset');
  }
  for (const [r, c] of schema.board.blackCells) {
    const cell = board.cells[r][c];
    if (!cell || cell.t !== 'black') errors.push('black_cell_' + r + ',' + c);
  }
  for (const item of schema.fixedCells) {
    const cell = board.cells[item.r][item.c];
    if (!cell || cell.t !== 'box' ||
        cell.color !== item.color || cell.count !== item.count) {
      errors.push('fixed_' + item.role);
    }
  }
  for (const item of schema.hardColorCells) {
    const [r, c] = item.cell;
    const cell = board.cells[r][c];
    if (!cell || cell.t !== 'box' || cell.color !== item.requiredColor) {
      errors.push('hard_color_' + r + ',' + c);
    }
  }
  for (const item of schema.softColorCells) {
    const [r, c] = item.cell;
    const cell = board.cells[r][c];
    if (!cell || cell.t !== 'box' || !item.allowedColors.includes(cell.color)) {
      errors.push('soft_color_' + r + ',' + c);
    }
  }
  return { ok: errors.length === 0, errors };
}

function buildFromSchema(A, schema, blocks, shift) {
  const cells = Array.from({ length: schema.board.rows }, () =>
    Array(schema.board.cols).fill(null)
  );
  for (const [r, c] of schema.board.blackCells) cells[r][c] = { t: 'black' };
  const pool = schema.capacity.multiset.map(carFromKey);
  const placementCells = schema.fixedCells.concat(
    schema.softColorCells.map(x => ({
      role: 'soft_release',
      r: x.cell[0],
      c: x.cell[1],
      color: x.preferredColor,
      count: x.preferredCount
    }))
  );
  const fixedKeys = new Set(placementCells.map(x => x.r + ',' + x.c));
  for (const item of placementCells) {
    const key = keyOf(item.color, item.count);
    const i = pool.findIndex(car => keyOf(car.color, car.count) === key);
    if (i < 0) throw new Error('Schema固定车缺少容量: ' + key);
    cells[item.r][item.c] = pool.splice(i, 1)[0];
  }
  const free = [];
  for (let r = 0; r < schema.board.rows; r++) {
    for (let c = 0; c < schema.board.cols; c++) {
      if (!cells[r][c] && !fixedKeys.has(r + ',' + c)) free.push([r, c]);
    }
  }
  if (free.length !== pool.length) throw new Error('Schema空格与剩余车辆不一致');
  for (let i = 0; i < pool.length; i++) {
    const [r, c] = free[(i + shift) % free.length];
    cells[r][c] = pool[i];
  }
  return A.parseLevel({
    blocks,
    bufferLimit: schema.board.bufferLimit,
    board: { rows: schema.board.rows, cols: schema.board.cols, cells }
  });
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

function regionAudit(A, level, run, atlas, schema) {
  const byCell = {};
  for (const region of atlas.target.regions || []) {
    for (const cell of region.cells || []) byCell[cell[0] + ',' + cell[1]] = region.id;
  }
  const wanted = new Set(schema.regionRules.map(x => x.region));
  const eliminated = A.outsideReachSeed(level.blocks, level.rows, level.cols, false);
  let pixels = 0;
  const view = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  const firstReveal = {};
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
        if (wanted.has(id) && !firstReveal[id]) {
          firstReveal[id] = {
            step: run.pickOrder[i] && run.pickOrder[i].step,
            progressPct: +(pixels / level.totalPixels * 100).toFixed(1)
          };
        }
      }
    }
  }
  const mismatches = [];
  for (const rule of schema.regionRules) {
    const actual = firstReveal[rule.region];
    const minStep = rule.stepWindow ? rule.stepWindow[0] : rule.firstRevealStep;
    const maxStep = rule.stepWindow ? rule.stepWindow[1] : rule.firstRevealStep;
    if (!actual || actual.step < minStep || actual.step > maxStep) {
      mismatches.push({
        region: rule.region,
        expectedWindow: [minStep, maxStep],
        actualStep: actual ? actual.step : null
      });
    }
  }
  return { firstReveal, mismatches, ok: mismatches.length === 0 };
}

function finalDebtAndRelease(run) {
  const events = run.instantEvents || [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.pick && (e.bufferAfter > e.bufferBefore ||
        (e.stalled && e.stalled.length))) {
      return {
        debt: {
          tick: e.tick,
          color: e.pick.color,
          need: e.pick.need,
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

function runtimeValidate(A, schema, level, atlas) {
  const staticResult = staticValidate(schema, level);
  if (!staticResult.ok) return { ok: false, staticResult };
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const expected = schema.storyOrder.map(x => x.cell.join(','));
  const solvePrefix = routePrefix(solve, 6).map(x => x.r + ',' + x.c);
  const players = [];
  let capture = null;
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap,
        capture: reviveCap === 0 && seed === 7
      });
      const prefix = routePrefix(run, 6).map(x => x.r + ',' + x.c);
      players.push({
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        bufferPeak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        prefixMatches: prefix.join('>') === expected.join('>'),
        firstSix: prefix,
        pickOrder: run.pickOrder
      });
      if (reviveCap === 0 && seed === 7) capture = run;
    }
  }
  const regions = regionAudit(A, level, capture, atlas, schema);
  const finale = finalDebtAndRelease(capture);
  const storyState = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  const storyFingerprint = [];
  for (const step of schema.storyOrder) {
    if (!A.Simulator.applyPick(storyState, step.cell[0], step.cell[1])) {
      throw new Error('Schema故事动作不可执行: ' + step.step);
    }
    const remaining = storyState.buffer.reduce((n, x) => n + (x.need - x.progress), 0);
    storyFingerprint.push({ step: step.step, remaining });
  }
  const checks = {
    staticContract: staticResult.ok,
    solveCompleted: solve.completed === true,
    solvePrefix: solvePrefix.join('>') === expected.join('>'),
    playerPrefix: players.every(x => x.prefixMatches),
    noRevivePass: players.filter(x => x.reviveCap === 0)
      .every(x => x.won && x.progress === 100 && x.revivesUsed === 0),
    defaultPass: players.filter(x => x.reviveCap === 2)
      .every(x => x.won && x.progress === 100),
    regionOrder: regions.ok,
    finale: !!(finale && finale.next &&
      finale.next.bufferAfter < finale.debt.bufferAfter)
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    staticResult,
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer,
      firstSix: solvePrefix
    },
    players,
    regions,
    finale,
    storyFingerprint
  };
}

function movedCells(levelA, levelB) {
  let moved = 0;
  for (let r = 0; r < levelA.board.rows; r++) {
    for (let c = 0; c < levelA.board.cols; c++) {
      const a = levelA.board.cells[r][c];
      const b = levelB.board.cells[r][c];
      if ((a && a.color) !== (b && b.color) ||
          (a && a.count) !== (b && b.count)) moved++;
    }
  }
  return moved;
}

function wrongCriticalTest(A, schema, blocks, levelA) {
  const cells = levelA.board.cells.map(row => row.map(cell => cell ? clone(cell) : null));
  const temp = cells[0][2];
  cells[0][2] = cells[0][4];
  cells[0][4] = temp;
  const broken = A.parseLevel({
    blocks,
    bufferLimit: schema.board.bufferLimit,
    board: { rows: 7, cols: 7, cells }
  });
  const detected = staticValidate(schema, broken);
  const repairCells = broken.board.cells.map(row => row.map(cell => cell ? clone(cell) : null));
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
    const temp2 = repairCells[0][2];
    repairCells[0][2] = repairCells[donor[0]][donor[1]];
    repairCells[donor[0]][donor[1]] = temp2;
  }
  const repaired = A.parseLevel({
    blocks,
    bufferLimit: schema.board.bufferLimit,
    board: { rows: 7, cols: 7, cells: repairCells }
  });
  return {
    brokenErrors: detected.errors,
    detected: !detected.ok,
    repairedOk: staticValidate(schema, repaired).ok
  };
}

function mutationTests(A, schema, blocks, levelA, runtimeA, atlas) {
  const capacityCells = levelA.board.cells.map(row =>
    row.map(cell => cell ? clone(cell) : null)
  );
  let capacityTarget = null;
  for (let r = 0; r < 7 && !capacityTarget; r++) {
    for (let c = 0; c < 7; c++) {
      const cell = capacityCells[r][c];
      if (cell && cell.t === 'box' &&
          !schema.fixedCells.some(x => x.r === r && x.c === c)) {
        cell.count++;
        capacityTarget = [r, c];
        break;
      }
    }
  }
  const capacityLevel = A.parseLevel({
    blocks,
    bufferLimit: schema.board.bufferLimit,
    board: { rows: 7, cols: 7, cells: capacityCells }
  });
  const capacityResult = staticValidate(schema, capacityLevel);

  const blackCells = levelA.board.cells.map(row =>
    row.map(cell => cell ? clone(cell) : null)
  );
  blackCells[1][1] = null;
  const blackLevel = A.parseLevel({
    blocks,
    bufferLimit: schema.board.bufferLimit,
    board: { rows: 7, cols: 7, cells: blackCells }
  });
  const blackResult = staticValidate(schema, blackLevel);

  const softCell = schema.softColorCells[0];
  const softCells = levelA.board.cells.map(row =>
    row.map(cell => cell ? clone(cell) : null)
  );
  let donor = null;
  for (let r = 0; r < 7 && !donor; r++) {
    for (let c = 0; c < 7; c++) {
      const cell = softCells[r][c];
      if (cell && cell.t === 'box' &&
          cell.color !== softCell.preferredColor &&
          softCell.allowedColors.includes(cell.color) &&
          !schema.fixedCells.some(x => x.r === r && x.c === c) &&
          !schema.hardColorCells.some(x => x.cell[0] === r && x.cell[1] === c)) {
        donor = [r, c];
        break;
      }
    }
  }
  let softLevel = null;
  let softRuntime = null;
  if (donor) {
    const temp = softCells[softCell.cell[0]][softCell.cell[1]];
    softCells[softCell.cell[0]][softCell.cell[1]] = softCells[donor[0]][donor[1]];
    softCells[donor[0]][donor[1]] = temp;
    softLevel = A.parseLevel({
      blocks,
      bufferLimit: schema.board.bufferLimit,
      board: { rows: 7, cols: 7, cells: softCells }
    });
    if (staticValidate(schema, softLevel).ok) {
      softRuntime = runtimeValidate(A, schema, softLevel, atlas);
    }
  }

  const actualR59 = runtimeA.regions.firstReveal.R59;
  return {
    capacityDetected: !capacityResult.ok &&
      capacityResult.errors.includes('capacity_multiset'),
    capacityTarget,
    capacityErrors: capacityResult.errors,
    blackDetected: !blackResult.ok &&
      blackResult.errors.includes('black_count'),
    blackErrors: blackResult.errors,
    softDonor: donor,
    softStaticAllowed: !!(softLevel && staticValidate(schema, softLevel).ok),
    softRuntimeAllowed: !!(softRuntime && softRuntime.ok),
    softRuntimeChecks: softRuntime ? softRuntime.checks : null,
    softRuntimeRegions: softRuntime ? softRuntime.regions : null,
    wrongRegionDetected: !actualR59 || actualR59.step !== 1
  };
}

function main() {
  const A = loadSolver();
  const schemaFile = path.join(ROOT, '实验关/关卡6/E3_v1/board-constraint-schema-v1.json');
  const atlasFile = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');
  const targetFile = path.join(ROOT, '实验关/关卡6/35x35拼接图纸_006.txt');
  const outDir = path.join(ROOT, '实验关/关卡6/E3_v1');
  const schema = readJson(schemaFile);
  const atlas = readJson(atlasFile);
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(targetFile, 'utf8'));

  const layouts = [];
  for (let shift = 0; shift < schema.capacity.multiset.length; shift++) {
    const candidate = buildFromSchema(A, schema, blocks, shift);
    const result = runtimeValidate(A, schema, candidate, atlas);
    if (result.ok) {
      if (!layouts.length || movedCells(layouts[0].level, candidate) >= 8) {
        layouts.push({ level: candidate, runtime: result, shift });
      }
      if (layouts.length === 2) break;
    }
  }
  if (layouts.length < 2) {
    throw new Error('没有找到两个通过Schema的不同布局');
  }
  const levelA = layouts[0].level;
  const runtimeA = layouts[0].runtime;
  const levelB = layouts[1].level;
  const runtimeB = layouts[1].runtime;
  const chosenShift = layouts[1].shift;

  const wrong = wrongCriticalTest(A, schema, blocks, levelA);
  if (!wrong.detected || !wrong.repairedOk) {
    throw new Error('E3.4错误注入/修复失败');
  }
  const mutation = mutationTests(A, schema, blocks, levelA, runtimeA, atlas);

  const gameA = A.toGameFormat(levelA);
  const gameB = A.toGameFormat(levelB);
  const fileA = path.join(outDir, 'E3布局A.json');
  const fileB = path.join(outDir, 'E3布局B.json');
  const routeA = path.join(outDir, 'E3布局A.route.json');
  const routeB = path.join(outDir, 'E3布局B.route.json');
  fs.writeFileSync(fileA, JSON.stringify(gameA, null, 2) + '\n');
  fs.writeFileSync(fileB, JSON.stringify(gameB, null, 2) + '\n');
  fs.writeFileSync(routeA, JSON.stringify({
    schema: 'e3-layout-route-v1',
    playerRuns: runtimeA.players
  }, null, 2) + '\n');
  fs.writeFileSync(routeB, JSON.stringify({
    schema: 'e3-layout-route-v1',
    playerRuns: runtimeB.players
  }, null, 2) + '\n');

  const moved = movedCells(levelA, levelB);
  const result = {
    schema: 'e3-board-compiler-result-v1',
    schemaFile,
    layoutA: { file: fileA, routeFile: routeA, fillShift: layouts[0].shift, runtime: runtimeA },
    layoutB: {
      file: fileB,
      routeFile: routeB,
      fillShift: chosenShift,
      movedCells: moved,
      runtime: runtimeB
    },
    repair: wrong,
    mutations: mutation,
    checks: {
      schemaValidatedA: runtimeA.ok,
      schemaValidatedB: runtimeB.ok,
      layoutsDifferAtLeast8: moved >= 8,
      bothNoRevivePass: runtimeA.checks.noRevivePass && runtimeB.checks.noRevivePass,
      bothRegionOrder: runtimeA.checks.regionOrder && runtimeB.checks.regionOrder,
      repairDetectedAndFixed: wrong.detected && wrong.repairedOk,
      capacityMutationDetected: mutation.capacityDetected,
      blackMutationDetected: mutation.blackDetected,
      softColorAccepted: mutation.softRuntimeAllowed,
      regionRuleMutationDetected: mutation.wrongRegionDetected
    }
  };
  result.passed = Object.values(result.checks).every(Boolean);
  fs.writeFileSync(
    path.join(outDir, 'e3-board-compiler-result-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );

  const md = [
    '# 006 · E3 棋盘编译器结果',
    '',
    '## 结论',
    '',
    result.passed ? 'E3.1～E3.5通过，E3完成。' : 'E3仍有检查未通过。',
    '',
    '## 输入',
    '',
    '- Schema：`board-constraint-schema-v1.json`；',
    '- 目标图：`35x35拼接图纸_006.txt`；',
    '- 构造器不读取v8最终布局。',
    '',
    '## 两个布局',
    '',
    '- 布局A：schema顺序填充；',
    '- 布局B：schema剩余车辆循环移动' + chosenShift + '位；',
    '- A/B不同格数：' + moved + '。',
    '',
    '## 验证',
    '',
    '| 检查 | A | B |',
    '|---|---:|---:|',
    '| 静态合同 | ' + (runtimeA.checks.staticContract ? '通过' : '失败') +
      ' | ' + (runtimeB.checks.staticContract ? '通过' : '失败') + ' |',
    '| 全知通关 | ' + (runtimeA.checks.solveCompleted ? '通过' : '失败') +
      ' | ' + (runtimeB.checks.solveCompleted ? '通过' : '失败') + ' |',
    '| 六步前缀 | ' + (runtimeA.checks.solvePrefix ? '通过' : '失败') +
      ' | ' + (runtimeB.checks.solvePrefix ? '通过' : '失败') + ' |',
    '| 0复活PlayerSim | ' + (runtimeA.checks.noRevivePass ? '通过' : '失败') +
      ' | ' + (runtimeB.checks.noRevivePass ? '通过' : '失败') + ' |',
    '| 区域揭示顺序 | ' + (runtimeA.checks.regionOrder ? '通过' : '失败') +
      ' | ' + (runtimeB.checks.regionOrder ? '通过' : '失败') + ' |',
    '| 终局债务释放 | ' + (runtimeA.checks.finale ? '通过' : '失败') +
      ' | ' + (runtimeB.checks.finale ? '通过' : '失败') + ' |',
    '',
    '## E3.4修复',
    '',
    '- 错误注入：交换entry为错误颜色；',
    '- 检测错误：' + wrong.brokenErrors.join('、') + '；',
    '- 从Schema恢复正确车辆后静态合同：' + (wrong.repairedOk ? '通过' : '失败') + '。',
    '- 容量篡改检测：' + (mutation.capacityDetected ? '通过' : '失败') + '；',
    '- 黑块数量篡改检测：' + (mutation.blackDetected ? '通过' : '失败') + '；',
    '- 第二释放软颜色替代：' + (mutation.softRuntimeAllowed ? '通过' : '失败') + '；',
    '- 区域首次揭示规则篡改：' + (mutation.wrongRegionDetected ? '通过' : '失败') + '。',
    '',
    '## 遗留',
    '',
    '- 当前只验证006一张图；',
    '- E3输出仍是实验JSON，尚未接入生产bin；',
    '- 下一步可进入E4前，先做第二张目标图烟测或E3多图泛化。',
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'e3-board-compiler-result-v1.md'), md);

  console.log(JSON.stringify({
    ok: result.passed,
    outDir,
    checks: result.checks,
    layoutA: {
      checks: runtimeA.checks,
      solve: runtimeA.solve,
      players: runtimeA.players
    },
    layoutB: {
      shift: chosenShift,
      moved,
      checks: runtimeB.checks,
      solve: runtimeB.solve,
      players: runtimeB.players
    },
    repair: wrong,
    mutations: mutation
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
