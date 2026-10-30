#!/usr/bin/env node
'use strict';

/**
 * E6.7f A: build 006 v14 from the pressure-search winner.
 *
 * The layout keeps the v13 role anchors, applies only seven car-position
 * swaps, and introduces no new semantic obstacles. It records two actual
 * buffer 3/4 windows for every zero-revive PlayerSim seed.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v13/关卡_实验_006_v13.json');
const SELECTED = path.join(ROOT, '实验关/关卡6/搜索_v14_pressure/best-candidate-v1.json');
const ATLAS = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v14');
const LEVEL_FILE = path.join(OUT, '关卡_实验_006_v14.json');
const ROUTE_FILE = path.join(OUT, '关卡_实验_006_v14.route.json');
const DEBUG_FILE = path.join(OUT, '关卡_实验_006_v14.debug.json');
const PLAN_JSON = path.join(OUT, 'story-plan-v2.json');
const PLAN_MD = path.join(OUT, 'story-plan-v2.md');
const REPORT_MD = path.join(OUT, '关卡_实验_006_v14.md');
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

const ROLE_PATHS = {
  safe: [[0, 3], [1, 3]],
  lightDebt: [[0, 0], [1, 0], [2, 0]],
  heavyDebt: [[0, 6], [1, 6], [2, 6]]
};

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
    vm.runInContext(
      fs.readFileSync(path.join(BIN, file), 'utf8'),
      sandbox,
      { filename: file }
    );
  }
  return sandbox.AntSolver;
}

function uniquePicks(run) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({
      r: pick.r,
      c: pick.c,
      color: pick.color,
      count: pick.count
    });
  }
  return out;
}

function poseKey(picks) {
  return picks.map(pick => pick.r + ',' + pick.c).join('>');
}

function bufferState(state) {
  return state.buffer.map(item => ({
    color: item.color,
    remaining: item.need - item.progress,
    need: item.need,
    progress: item.progress,
    slot: item.slot
  }));
}

function windowsAtLeast(timeline, threshold) {
  const windows = [];
  let start = null;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i] >= threshold && start == null) start = i;
    if (timeline[i] < threshold && start != null) {
      windows.push({
        start: start + 1,
        end: i,
        length: i - start,
        peak: Math.max(...timeline.slice(start, i))
      });
      start = null;
    }
  }
  if (start != null) {
    windows.push({
      start: start + 1,
      end: timeline.length,
      length: timeline.length - start,
      peak: Math.max(...timeline.slice(start))
    });
  }
  return windows;
}

function regionLookup(atlas) {
  const byCell = {};
  const byId = {};
  for (const region of atlas.target.regions || []) {
    byId[region.id] = region;
    for (const cell of region.cells || []) {
      byCell[cell[0] + ',' + cell[1]] = region.id;
    }
  }
  return { byCell, byId };
}

function regionHits(cells, lookup) {
  const counts = {};
  for (const cell of cells || []) {
    const r = Array.isArray(cell) ? cell[0] : cell.r;
    const c = Array.isArray(cell) ? cell[1] : cell.c;
    const id = lookup.byCell[r + ',' + c];
    if (!id) continue;
    counts[id] = (counts[id] || 0) + 1;
  }
  return Object.keys(counts)
    .map(id => ({
      region: id,
      color: lookup.byId[id].color,
      pixels: counts[id]
    }))
    .sort((a, b) => b.pixels - a.pixels || a.region.localeCompare(b.region));
}

function optionsAt(A, state) {
  return A.Simulator.listMoves(state)
    .filter(move => !move.blocked)
    .map(move => {
      const clone = A.SolverStrategy.cloneState(state);
      const before = clone.eliminatedPixels;
      clone.capOps = [];
      const applied = A.Simulator.applyPick(clone, move.r, move.c);
      return {
        r: move.r,
        c: move.c,
        color: move.antBox.color,
        count: move.antBox.count,
        canConsume: move.canConsume,
        consumed: clone.eliminatedPixels - before,
        bufferAfter: bufferState(clone),
        applied
      };
    });
}

function traceRole(A, level, id, path) {
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  state.capOps = [];
  const evidence = [];
  for (const [r, c] of path) {
    const move = A.Simulator.listMoves(state)
      .find(item => item.r === r && item.c === c && !item.blocked);
    if (!move) return { id, ok: false, evidence, reason: 'not-available' };
    state.capOps = [];
    if (!A.Simulator.applyPick(state, r, c)) {
      return { id, ok: false, evidence, reason: 'apply-failed' };
    }
    evidence.push({
      r,
      c,
      color: move.antBox.color,
      count: move.antBox.count,
      bufferAfter: bufferState(state)
    });
  }
  return { id, ok: true, evidence };
}

function pressurePlan(A, level, run, atlasLookup) {
  const picks = uniquePicks(run);
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  const steps = [];

  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    state.capOps = [];
    const applied = A.Simulator.applyPick(state, pick.r, pick.c);
    if (!applied) throw new Error('压力回放失败: step=' + (i + 1));
    const eaten = [];
    for (const op of state.capOps || []) {
      if (op.t === 'eat') for (const cell of op.cells || []) eaten.push(cell);
    }
    steps.push({
      step: i + 1,
      r: pick.r,
      c: pick.c,
      color: pick.color,
      count: pick.count,
      buffer: bufferState(state),
      bufferLevel: state.buffer.length,
      regions: regionHits(eaten, atlasLookup)
    });
  }

  const windows = windowsAtLeast(steps.map(step => step.bufferLevel), 3);
  const detailed = windows.map((window, index) => {
    const peakStep = steps
      .slice(window.start - 1, window.end)
      .reduce((best, step) =>
        best == null || step.bufferLevel > best.bufferLevel ? step : best, null);
    const release = steps
      .slice(window.end)
      .find(step => step.bufferLevel < peakStep.bufferLevel);
    return {
      id: index === 0 ? 'pressure-1' : 'pressure-2',
      startStep: window.start,
      endStep: window.end,
      length: window.length,
      peak: window.peak,
      peakStep,
      steps: steps.slice(window.start - 1, window.end),
      release: release ? {
        step: release.step,
        r: release.r,
        c: release.c,
        color: release.color,
        count: release.count,
        bufferBefore: peakStep.buffer,
        bufferAfter: release.buffer,
        reduction: peakStep.bufferLevel - release.bufferLevel
      } : null
    };
  });

  return { steps, windows: detailed };
}

function main() {
  const A = loadSolver();
  const game = JSON.parse(fs.readFileSync(SELECTED, 'utf8'));
  const level = A.parseLevel(A.fromGameFormat(game));
  const atlas = JSON.parse(fs.readFileSync(ATLAS, 'utf8'));
  const atlasLookup = regionLookup(atlas);

  const initial = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  initial.capture = true;
  const openingMoves = optionsAt(A, initial);

  const roles = {
    safe: traceRole(A, level, 'safe', ROLE_PATHS.safe),
    lightDebt: traceRole(A, level, 'lightDebt', ROLE_PATHS.lightDebt),
    heavyDebt: traceRole(A, level, 'heavyDebt', ROLE_PATHS.heavyDebt)
  };
  const rolePass =
    roles.safe.ok && roles.safe.evidence.every(step => step.bufferAfter.length === 0) &&
    roles.lightDebt.evidence[1].bufferAfter.some(item =>
      item.color === 17 && item.remaining === 10) &&
    roles.lightDebt.evidence[2].bufferAfter.length === 0 &&
    roles.heavyDebt.evidence[1].bufferAfter.some(item =>
      item.color === 34 && item.remaining === 19) &&
    roles.heavyDebt.evidence[2].bufferAfter.length === 0;

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 30000 });
  const players = [];
  const playerPlans = [];
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap
      });
      const plan = pressurePlan(A, level, run, atlasLookup);
      const summary = {
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        bufferPeak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        bufferTimeline: run.bufferTimeline,
        windows: plan.windows,
        pickOrder: run.pickOrder,
        picks: uniquePicks(run)
      };
      players.push(summary);
      playerPlans.push({ seed, reviveCap, steps: plan.steps, windows: plan.windows });
    }
  }

  const zeroRevive = players.filter(player => player.reviveCap === 0);
  const twoWindowPlayers = zeroRevive.filter(player => player.windows.length >= 2);
  const pressureWindow1 = playerPlans.find(plan =>
    plan.seed === 7 && plan.reviveCap === 0).windows[0];
  const pressureWindow2 = playerPlans.find(plan =>
    plan.seed === 7 && plan.reviveCap === 0).windows[1];

  const roundtrip = A.parseLevel(A.fromGameFormat(A.toGameFormat(level)));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: 20000,
    greedyOnly: true
  });

  let boxes = 0;
  let black = 0;
  let ice = 0;
  let chain = 0;
  let pipe = 0;
  let question = 0;
  let questionPixels = 0;
  let sum = 0;
  let minCapacity = Infinity;
  let maxCapacity = -Infinity;
  for (const row of level.board.cells) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.t === 'black') black++;
      if (cell.t === 'box') {
        boxes++;
        sum += cell.count;
        minCapacity = Math.min(minCapacity, cell.count);
        maxCapacity = Math.max(maxCapacity, cell.count);
        if (cell.numice > 0) ice++;
        if (cell.chain > 0) chain++;
        if (cell.q) {
          question++;
          questionPixels += cell.count;
        }
      }
      if (cell.t === 'pipe') pipe++;
    }
  }

  const solvePicks = uniquePicks(solve);
  const routeKeys = new Set([poseKey(solvePicks.slice(0, 12))]);
  for (const player of players) routeKeys.add(poseKey(player.picks.slice(0, 12)));

  const checks = {
    capacityContract: boxes === 47 && sum === 1225 &&
      minCapacity >= 20 && maxCapacity <= 40,
    boardContract: boxes === 47 && black === 2,
    noNewObstacles: ice === 0 && chain === 0 && pipe === 0 && question === 0,
    openingHasSevenLiveChoices: openingMoves.length === 7 &&
      openingMoves.every(move => move.applied && move.consumed > 0),
    roleGraphPass: rolePass,
    solvePass: solve.completed && solve.progress === 100,
    playersPass: players.every(player =>
      player.won && player.progress === 100 && player.revivesUsed === 0),
    twoPressureWindowsPerZeroReviveSeed:
      twoWindowPlayers.length === zeroRevive.length,
    pressurePeakReachesFour:
      zeroRevive.every(player => player.bufferPeak >= 4),
    pressureWindowsHaveReleases:
      zeroRevive.every(player => player.windows.every(window => !!window.release)),
    routeDiversity: routeKeys.size >= 2,
    roundtripPass: roundtripSolve.completed === true
  };
  const passed = Object.values(checks).every(Boolean);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(LEVEL_FILE, JSON.stringify(A.toGameFormat(level), null, 2) + '\n');
  const sha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(LEVEL_FILE))
    .digest('hex');

  const storyPlan = {
    schema: '006-story-plan-v2',
    status: passed ? 'STORY_PRESSURE_PASS' : 'STORY_PRESSURE_FAIL',
    source: SOURCE,
    selectedSearchCandidate: SELECTED,
    level: LEVEL_FILE,
    sha256,
    opening: {
      moves: openingMoves,
      roles: ROLE_PATHS
    },
    pressureWindows: [pressureWindow1, pressureWindow2],
    playerPlans,
    acceptance: {
      pressureThreshold: 3,
      peakTarget: 4,
      minWindowsPerZeroReviveSeed: 2,
      requiresVisibleRelease: true,
      noOpeningDeadChoice: true,
      noNewObstaclesInV14: true
    }
  };
  fs.writeFileSync(PLAN_JSON, JSON.stringify(storyPlan, null, 2) + '\n');

  const report = {
    schema: '006-pressure-story-v14',
    status: passed ? 'V14_PASS' : 'V14_FAIL',
    source: SOURCE,
    selectedSearchCandidate: SELECTED,
    gameFormat: LEVEL_FILE,
    routeFile: ROUTE_FILE,
    storyPlan: PLAN_JSON,
    sha256,
    board: {
      rows: 7,
      cols: 7,
      boxes,
      black,
      ice,
      chain,
      pipe,
      question,
      questionPixels,
      capacityMin: minCapacity,
      capacityMax: maxCapacity,
      capacitySum: sum
    },
    openingMoves,
    roles,
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer,
      bufferTimeline: solve.stepBufferHistory || [],
      picks: solvePicks
    },
    players,
    routeDiversity: routeKeys.size,
    checks
  };
  fs.writeFileSync(DEBUG_FILE, JSON.stringify(report, null, 2) + '\n');

  fs.writeFileSync(ROUTE_FILE, JSON.stringify({
    schema: '006-player-routes-v2',
    levelFile: LEVEL_FILE,
    playerRuns: players
  }, null, 2) + '\n');

  fs.writeFileSync(PLAN_MD, [
    '# 006 · StoryPlan v2',
    '',
    '## 结论',
    '',
    passed
      ? '通过：无新增语义障碍时，3个0复活seed均出现两个真实压力窗口，峰值达到4。'
      : '失败：布局未满足两个压力窗口和释放要求。',
    '',
    '## 开局',
    '',
    `- ${openingMoves.length}个无冰入口；`,
    '- 所有入口当前均有实际消除，无零收益选项；',
    '- 安全、轻债、长债三条职责路径仍保留。',
    '',
    '## 第一压力窗口',
    '',
    pressureWindow1
      ? `- 步骤${pressureWindow1.startStep}～${pressureWindow1.endStep}，峰值${pressureWindow1.peak}；` +
        `\n- 峰值暂存：${pressureWindow1.peakStep.buffer.map(item => item.color + '欠' + item.remaining).join('、')}；` +
        `\n- 释放：第${pressureWindow1.release.step}步 ${pressureWindow1.release.color}/${pressureWindow1.release.count}，` +
        `暂存下降${pressureWindow1.release.reduction}；`
      : '- 未形成。',
    '',
    '## 第二压力窗口',
    '',
    pressureWindow2
      ? `- 步骤${pressureWindow2.startStep}～${pressureWindow2.endStep}，峰值${pressureWindow2.peak}；` +
        `\n- 峰值暂存：${pressureWindow2.peakStep.buffer.map(item => item.color + '欠' + item.remaining).join('、')}；` +
        `\n- 释放：第${pressureWindow2.release.step}步 ${pressureWindow2.release.color}/${pressureWindow2.release.count}，` +
        `暂存下降${pressureWindow2.release.reduction}；`
      : '- 未形成。',
    '',
    '## 边界',
    '',
    '- v14只调整车辆位置，不新增冰、链、管道或问号；',
    '- 两处压力由车辆位置、目标区域揭示和单色多车债务共同形成；',
    '- 第二卡点是否还需要额外障碍，由v14首轮真人试玩和消融结果决定。',
    ''
  ].join('\n') + '\n');

  fs.writeFileSync(REPORT_MD, [
    '# 006 · Pressure Story v14',
    '',
    '## 结论',
    '',
    passed
      ? '通过：7个开局动作均有实际收益；三个0复活seed各有两个buffer 3/4窗口。'
      : '失败：保留证据。',
    '',
    '## 棋盘',
    '',
    `- 7×7、${boxes}车、${black}黑；`,
    `- 0冰/链/管道/问号；`,
    `- 容量${minCapacity}～${maxCapacity}，总和${sum}。`,
    '',
    '## 压力',
    '',
    pressureWindow1
      ? `- 第一窗口：第${pressureWindow1.startStep}～${pressureWindow1.endStep}步，峰值${pressureWindow1.peak}。`
      : '- 第一窗口缺失。',
    pressureWindow2
      ? `- 第二窗口：第${pressureWindow2.startStep}～${pressureWindow2.endStep}步，峰值${pressureWindow2.peak}。`
      : '- 第二窗口缺失。',
    `- 0复活PlayerSim：${zeroRevive.filter(player => player.won).length}/${zeroRevive.length}通关；`,
    `- 0复活seed中出现两个窗口：${twoWindowPlayers.length}/${zeroRevive.length}；`,
    `- 路线多样性：${routeKeys.size}；`,
    `- JSON往返可解：${roundtripSolve.completed ? '是' : '否'}。`,
    '',
    '## SHA-256',
    '',
    '`' + sha256 + '`',
    ''
  ].join('\n') + '\n');

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    sha256,
    board: report.board,
    openingMoves: openingMoves.map(move => ({
      r: move.r,
      c: move.c,
      car: move.color + '/' + move.count,
      canConsume: move.canConsume,
      consumed: move.consumed
    })),
    pressureWindows: [pressureWindow1, pressureWindow2].map(window => ({
      startStep: window.startStep,
      endStep: window.endStep,
      peak: window.peak,
      buffer: window.peakStep.buffer,
      release: window.release
    })),
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      peak: solve.maxBuffer
    },
    players: players.map(player => ({
      seed: player.seed,
      reviveCap: player.reviveCap,
      won: player.won,
      progress: player.progress,
      peak: player.bufferPeak,
      windows: player.windows.map(window => ({
        startStep: window.startStep,
        endStep: window.endStep,
        peak: window.peak
      }))
    })),
    checks
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
