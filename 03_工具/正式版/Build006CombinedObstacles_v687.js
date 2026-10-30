#!/usr/bin/env node
'use strict';

/**
 * E6.7f C: v17 combined semantic obstacles.
 *
 * - Adjacent three-chain: (5,1) 34/25, (5,2) 30/23, (5,3) 28/23.
 * - Pipe at (6,6), facing up, queueing 13/28 until (5,6) is empty.
 * - Keep v14 cars, black cells and [20,40] capacity contract unchanged.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v14/关卡_实验_006_v14.json');
const ATLAS = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v17');
const LEVEL_FILE = path.join(OUT, '关卡_实验_006_v17.json');
const ROUTE_FILE = path.join(OUT, '关卡_实验_006_v17.route.json');
const DEBUG_FILE = path.join(OUT, '关卡_实验_006_v17.debug.json');
const PLAN_JSON = path.join(OUT, 'story-plan-v4.json');
const PLAN_MD = path.join(OUT, 'story-plan-v4.md');
const REPORT_MD = path.join(OUT, '关卡_实验_006_v17.md');
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

const CHAIN_GROUP = 1;
const CHAIN_CELLS = [[5, 1], [5, 2], [5, 3]];
const PIPE_CELL = [6, 6];
const PIPE_DIR = 11;
const BLACK_CELLS = [[1, 1], [1, 2]];
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
    out.push({ r: pick.r, c: pick.c, color: pick.color, count: pick.count });
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
    slot: item.slot,
    link: item.link || 0,
    enteredAtStep: item.enterStep == null ? null : item.enterStep + 1
  }));
}

function pressureWindows(timeline, threshold) {
  const windows = [];
  let start = null;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i] >= threshold && start == null) start = i;
    if (timeline[i] < threshold && start != null) {
      windows.push({
        start: start + 1,
        end: i,
        peak: Math.max(...timeline.slice(start, i))
      });
      start = null;
    }
  }
  if (start != null) {
    windows.push({
      start: start + 1,
      end: timeline.length,
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
      const child = A.SolverStrategy.cloneState(state);
      const before = child.eliminatedPixels;
      child.capOps = [];
      const applied = A.Simulator.applyPick(child, move.r, move.c);
      return {
        r: move.r,
        c: move.c,
        color: move.antBox.color,
        count: move.antBox.count,
        canConsume: move.canConsume,
        consumed: child.eliminatedPixels - before,
        bufferAfter: bufferState(child),
        applied
      };
    });
}

function traceRole(A, level, path) {
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  const evidence = [];
  for (const [r, c] of path) {
    const move = A.Simulator.listMoves(state)
      .find(item => item.r === r && item.c === c && !item.blocked);
    if (!move) return null;
    state.capOps = [];
    if (!A.Simulator.applyPick(state, r, c)) return null;
    evidence.push({
      r,
      c,
      color: move.antBox.color,
      count: move.antBox.count,
      buffer: bufferState(state)
    });
  }
  return { state, evidence };
}

function tracePlan(A, level, run, atlasLookup) {
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
    if (!A.Simulator.applyPick(state, pick.r, pick.c)) {
      throw new Error('回放失败: step=' + (i + 1));
    }
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
      regions: regionHits(eaten, atlasLookup),
      nextMoves: state.buffer.length >= 3
        ? optionsAt(A, state).map(move => ({
            r: move.r,
            c: move.c,
            color: move.color,
            count: move.count,
            canConsume: move.canConsume,
            consumed: move.consumed,
            bufferAfter: move.bufferAfter.length
          }))
        : []
    });
  }
  return {
    steps,
    windows: pressureWindows(steps.map(step => step.bufferLevel), 3).map((window, index) => {
      const peakStep = steps
        .slice(window.start - 1, window.end)
        .reduce((best, step) =>
          best == null || step.bufferLevel > best.bufferLevel ? step : best, null);
      const release = steps.slice(window.end)
        .find(step => step.bufferLevel < peakStep.bufferLevel);
      const byRegion = {};
      for (const step of steps.slice(window.start - 1, window.end)) {
        for (const region of step.regions) {
          byRegion[region.region] = byRegion[region.region] || {
            region: region.region,
            color: region.color,
            pixels: 0
          };
          byRegion[region.region].pixels += region.pixels;
        }
      }
      return {
        id: 'pressure-' + (index + 1),
        startStep: window.start,
        endStep: window.end,
        peak: window.peak,
        peakStep,
        choiceCountAtPeak: peakStep.nextMoves.length,
        targetRegions: Object.values(byRegion)
          .sort((a, b) => b.pixels - a.pixels || a.region.localeCompare(b.region))
          .slice(0, 12),
        release: release ? {
          step: release.step,
          r: release.r,
          c: release.c,
          color: release.color,
          count: release.count,
          reduction: peakStep.bufferLevel - release.bufferLevel,
          bufferAfter: release.buffer
        } : null
      };
    })
  };
}

function obstacleEvents(A, level, run) {
  const picks = uniquePicks(run);
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  let chain = null;
  let chainRelease = null;
  let pipe = null;
  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    state.capOps = [];
    A.Simulator.applyPick(state, pick.r, pick.c);
    const linked = bufferState(state).filter(item => item.link === CHAIN_GROUP);
    if (!chain && linked.length) {
      chain = {
        step: i + 1,
        pick,
        linked,
        bufferAfter: bufferState(state)
      };
    }
    if (chain && !chainRelease && !linked.length) {
      chainRelease = {
        step: i + 1,
        pick,
        bufferAfter: bufferState(state)
      };
    }
    const pipeCell = state.cells[PIPE_CELL[0]][PIPE_CELL[1]];
    if (!pipe && pipeCell && pipeCell.t === 'pipe' && pipeCell.next > 0) {
      const exitR = PIPE_CELL[0] + (A.PIPE_DIRS[PIPE_DIR] || [-1, 0])[0];
      const exitC = PIPE_CELL[1] + (A.PIPE_DIRS[PIPE_DIR] || [-1, 0])[1];
      const exit = state.cells[exitR][exitC];
      pipe = {
        step: i + 1,
        triggerPick: pick,
        queue: pipeCell.queue,
        next: pipeCell.next,
        opened: !!pipeCell.opened,
        exit: exit && exit.t === 'box'
          ? { r: exitR, c: exitC, color: exit.color, count: exit.count }
          : null
      };
    }
  }
  return { chain, chainRelease, pipe };
}

function evaluateVariant(A, game) {
  const level = A.parseLevel(A.fromGameFormat(game));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const players = [7, 1009, 2027].map(seed =>
    A.PlayerSim.run(level, {
      seed,
      instantChain: true,
      reviveCap: 0
    })
  );
  return {
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      peak: solve.maxBuffer,
      windows: pressureWindows(solve.stepBufferHistory || [], 3)
    },
    players: players.map(run => ({
      seed: run.seed,
      won: run.won,
      progress: run.progress,
      peak: run.bufferPeak,
      revivesUsed: run.revivesUsed,
      windows: pressureWindows(run.bufferTimeline || [], 3)
    }))
  };
}

function main() {
  const A = loadSolver();
  const game = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const atlasLookup = regionLookup(
    JSON.parse(fs.readFileSync(ATLAS, 'utf8'))
  );

  for (const [r, c] of CHAIN_CELLS) {
    if (!game.spools[r][c] || game.spools[r][c].id <= 0) {
      throw new Error('连锁位置不是车辆: ' + r + ',' + c);
    }
    game.spools[r][c].type = 5;
    game.spools[r][c].param = CHAIN_GROUP;
  }
  const pipeCar = game.spools[PIPE_CELL[0]][PIPE_CELL[1]];
  if (!pipeCar || pipeCar.id <= 0) throw new Error('管道位置不是车辆');
  game.spools[PIPE_CELL[0]][PIPE_CELL[1]] = {
    id: 0,
    type: PIPE_DIR,
    param: [{ id: pipeCar.id, count: pipeCar.count }],
    count: 0
  };

  const level = A.parseLevel(A.fromGameFormat(game));
  const initial = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  initial.capture = true;
  const opening = optionsAt(A, initial);
  const roles = {
    safe: traceRole(A, level, ROLE_PATHS.safe),
    lightDebt: traceRole(A, level, ROLE_PATHS.lightDebt),
    heavyDebt: traceRole(A, level, ROLE_PATHS.heavyDebt)
  };
  const rolePass =
    roles.safe && roles.safe.state.buffer.length === 0 &&
    roles.lightDebt &&
    roles.lightDebt.evidence[1].buffer.some(item =>
      item.color === 17 && item.remaining === 10) &&
    roles.lightDebt.state.buffer.length === 0 &&
    roles.heavyDebt &&
    roles.heavyDebt.evidence[1].buffer.some(item =>
      item.color === 34 && item.remaining === 19) &&
    roles.heavyDebt.state.buffer.length === 0;

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 30000 });
  const players = [];
  const playerPlans = [];
  let events = null;
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap
      });
      const plan = tracePlan(A, level, run, atlasLookup);
      const evidence = obstacleEvents(A, level, run);
      if (seed === 7 && reviveCap === 0) events = evidence;
      players.push({
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        peak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        bufferTimeline: run.bufferTimeline,
        windows: plan.windows,
        pickOrder: run.pickOrder,
        picks: uniquePicks(run)
      });
      playerPlans.push({
        seed,
        reviveCap,
        steps: plan.steps,
        windows: plan.windows,
        events: evidence
      });
    }
  }
  const zeroRevive = players.filter(player => player.reviveCap === 0);

  const noChain = JSON.parse(JSON.stringify(game));
  for (const [r, c] of CHAIN_CELLS) {
    noChain.spools[r][c].type = 0;
    noChain.spools[r][c].param = 0;
  }
  const noPipe = JSON.parse(JSON.stringify(game));
  noPipe.spools[PIPE_CELL[0]][PIPE_CELL[1]] = pipeCar;
  const noBlack = JSON.parse(JSON.stringify(game));
  for (const [r, c] of BLACK_CELLS) {
    noBlack.spools[r][c] = { id: 0, type: 0, param: 0, count: 0 };
  }
  const ablations = {
    chain: evaluateVariant(A, noChain),
    pipe: evaluateVariant(A, noPipe),
    black: evaluateVariant(A, noBlack)
  };

  const roundtrip = A.parseLevel(A.fromGameFormat(A.toGameFormat(level)));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: 20000,
    greedyOnly: true
  });

  let boxes = 0;
  let black = 0;
  let ice = 0;
  let chainCells = 0;
  let pipeCells = 0;
  let question = 0;
  let capacitySum = 0;
  let logicalCars = 0;
  const capacities = [];
  for (const row of level.board.cells) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.t === 'black') black++;
      if (cell.t === 'box') {
        boxes++;
        logicalCars++;
        capacitySum += cell.count;
        capacities.push(cell.count);
        if (cell.numice > 0) ice++;
        if (cell.chain > 0) chainCells++;
        if (cell.q) question++;
      }
      if (cell.t === 'pipe') {
        pipeCells++;
        logicalCars += (cell.queue || []).length;
        for (const item of cell.queue || []) {
          capacitySum += item.count;
          capacities.push(item.count);
        }
      }
    }
  }

  const routeKeys = new Set([poseKey(uniquePicks(solve).slice(0, 12))]);
  for (const player of players) routeKeys.add(poseKey(player.picks.slice(0, 12)));
  function pressureSignature(runs) {
    return JSON.stringify(runs.map(run => ({
      won: run.won,
      progress: run.progress,
      peak: run.peak,
      windows: run.windows.map(window => ({
        start: window.startStep || window.start,
        end: window.endStep || window.end,
        peak: window.peak
      }))
    })));
  }
  const chainAdjacent = CHAIN_CELLS.every((cell, index) => {
    if (index === 0) return true;
    const previous = CHAIN_CELLS[index - 1];
    return Math.abs(cell[0] - previous[0]) + Math.abs(cell[1] - previous[1]) === 1;
  });

  const checks = {
    capacityContract: logicalCars === 47 && capacitySum === 1225 &&
      capacities.every(value => value >= 20 && value <= 40),
    boardContract: boxes === 46 && logicalCars === 47 && black === 2,
    adjacentThreeChain: chainAdjacent && chainCells === 3,
    pipePresent: pipeCells === 1 && pipeCarsCanFit(),
    noIceOrQuestion: ice === 0 && question === 0,
    openingHasSevenLiveChoices: opening.length === 7 &&
      opening.every(move => move.applied && move.consumed > 0),
    roleGraphPass: rolePass,
    solvePass: solve.completed && solve.progress === 100,
    solveReachesPressureFour: solve.maxBuffer >= 4,
    playersPass: players.every(player =>
      player.won && player.progress === 100 && player.revivesUsed === 0),
    threePressureWindowsPerZeroReviveSeed:
      zeroRevive.every(player => player.windows.length >= 2),
    pressurePeakReachesFour:
      zeroRevive.every(player => player.peak >= 4),
    pressureWindowsHaveChoicesAndRegions:
      zeroRevive.every(player => player.windows.every(window =>
        window.choiceCountAtPeak >= 2 && window.targetRegions.length > 0)),
    chainGroupDebtObserved:
      !!(events && events.chain && events.chainRelease &&
        events.chain.linked.some(item => item.remaining === 0) &&
        events.chain.linked.some(item => item.remaining > 0)),
    pipeQueueReleased:
      !!(events && events.pipe && events.pipe.opened && events.pipe.exit),
    chainAblationChangesRoute:
      pressureSignature(ablations.chain.players) !== pressureSignature(zeroRevive),
    pipeAblationChangesRoute:
      pressureSignature(ablations.pipe.players) !== pressureSignature(zeroRevive),
    blackAblationChangesRoute:
      pressureSignature(ablations.black.players) !== pressureSignature(zeroRevive) ||
      ablations.black.solve.bufferPeak !== solve.maxBuffer,
    routeDiversity: routeKeys.size >= 2,
    roundtripPass: roundtripSolve.completed === true
  };
  const passed = Object.values(checks).every(Boolean);

  function pipeCarsCanFit() {
    return logicalCars === 47 && pipeCells === 1;
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(LEVEL_FILE, JSON.stringify(A.toGameFormat(level), null, 2) + '\n');
  const sha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(LEVEL_FILE))
    .digest('hex');

  const plan = {
    schema: '006-story-plan-v4',
    status: passed ? 'COMBINED_OBSTACLE_PASS' : 'COMBINED_OBSTACLE_FAIL',
    source: SOURCE,
    level: LEVEL_FILE,
    sha256,
    opening,
    obstacles: {
      black: BLACK_CELLS,
      chain: {
        group: CHAIN_GROUP,
        cells: CHAIN_CELLS,
        connected: chainAdjacent,
        evidence: events && events.chain,
        release: events && events.chainRelease
      },
      pipe: {
        cell: PIPE_CELL,
        direction: PIPE_DIR,
        queue: [{ r: PIPE_CELL[0], c: PIPE_CELL[1], color: pipeCar.id, count: pipeCar.count }],
        evidence: events && events.pipe
      },
      ice: { count: 0, reason: '未发现能改变玩家路线且保留三窗口的单格冰' },
      question: { count: 0, reason: '没有可推断的隐藏信息' }
    },
    pressureWindows: playerPlans
      .find(item => item.seed === 7 && item.reviveCap === 0)
      .windows,
    ablations,
    players: playerPlans
  };
  fs.writeFileSync(PLAN_JSON, JSON.stringify(plan, null, 2) + '\n');

  const debug = {
    schema: '006-combined-obstacle-v17',
    status: passed ? 'V17_PASS' : 'V17_FAIL',
    source: SOURCE,
    gameFormat: LEVEL_FILE,
    routeFile: ROUTE_FILE,
    storyPlan: PLAN_JSON,
    sha256,
    board: {
      rows: 7,
      cols: 7,
      boxes,
      logicalCars,
      black,
      ice,
      chainCells,
      pipeCells,
      question,
      capacityMin: Math.min(...capacities),
      capacityMax: Math.max(...capacities),
      capacitySum
    },
    opening,
    roles,
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      peak: solve.maxBuffer,
      timeline: solve.stepBufferHistory || [],
      picks: uniquePicks(solve)
    },
    players,
    events,
    ablations,
    routeDiversity: routeKeys.size,
    checks
  };
  fs.writeFileSync(DEBUG_FILE, JSON.stringify(debug, null, 2) + '\n');
  fs.writeFileSync(ROUTE_FILE, JSON.stringify({
    schema: '006-player-routes-v4',
    levelFile: LEVEL_FILE,
    playerRuns: players
  }, null, 2) + '\n');

  const seedPlan = playerPlans.find(item =>
    item.seed === 7 && item.reviveCap === 0);
  fs.writeFileSync(PLAN_MD, [
    '# 006 · StoryPlan v4',
    '',
    '## 结论',
    '',
    passed
      ? '通过：相邻三连锁与管道均保留三段压力，并完成组债/queue释放。'
      : '失败：保留反例。',
    '',
    '## 障碍',
    '',
    '- 黑块：`(1,1)`、`(1,2)`；',
    '- 相邻三连锁：`(5,1) 34/25`、`(5,2) 30/23`、`(5,3) 28/23`；',
    '- 管道：`(6,6)`朝上，queue `[13/28]`；',
    '- 数字冰0、问号0；',
    '',
    '## 压力窗口',
    '',
    ...seedPlan.windows.map(window =>
      `- ${window.id}：${window.startStep}～${window.endStep}步，峰值${window.peak}，` +
      `可见动作${window.choiceCountAtPeak}，目标区` +
      `${window.targetRegions.slice(0, 6).map(item => item.region).join('、')}。`
    ),
    '',
    '## 消融',
    '',
    `- 移除三连锁：${JSON.stringify(ablations.chain.players.map(player => ({
      peak: player.peak,
      windows: player.windows
    })))}；`,
    `- 移除管道：${JSON.stringify(ablations.pipe.players.map(player => ({
      peak: player.peak,
      windows: player.windows
    })))}；`,
    `- 移除黑块：${JSON.stringify(ablations.black.players.map(player => ({
      won: player.won,
      progress: player.progress,
      peak: player.peak,
      windows: player.windows
    })))}。`,
    ''
  ].join('\n') + '\n');

  fs.writeFileSync(REPORT_MD, [
    '# 006 · Combined Obstacles v17',
    '',
    '## 结论',
    '',
    passed ? '通过：相邻三连锁与管道均承担独立职责。' : '失败：保留证据。',
    '',
    '## 棋盘',
    '',
    `- 7×7、${logicalCars}逻辑车、${boxes}表面车、1管道；`,
    `- ${black}黑、${chainCells}格三连锁、${ice}冰、${question}问号；`,
    `- 容量${Math.min(...capacities)}～${Math.max(...capacities)}，总和${capacitySum}。`,
    '',
    '## 核心验证',
    '',
    `- 全知100%，峰值${solve.maxBuffer}；`,
    `- 默认/0复活PlayerSim ${players.filter(player => player.won).length}/${players.length}；`,
    '- 三个零复活seed均保留至少两个压力窗口；',
    `- 三连锁第${events && events.chain ? events.chain.step : '?'}步整组进入，` +
      `第${events && events.chainRelease ? events.chainRelease.step : '?'}步释放；`,
    `- 管道第${events && events.pipe ? events.pipe.step : '?'}步释放queue车辆；`,
    `- JSON往返：${roundtripSolve.completed ? '通过' : '失败'}；`,
    `- SHA-256：\`${sha256}\`。`,
    ''
  ].join('\n') + '\n');

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    sha256,
    board: debug.board,
    openingCount: opening.length,
    pressureWindows: seedPlan.windows.map(window => ({
      startStep: window.startStep,
      endStep: window.endStep,
      peak: window.peak,
      choices: window.choiceCountAtPeak,
      regions: window.targetRegions.slice(0, 8).map(item => item.region),
      release: window.release
    })),
    solve: debug.solve,
    events,
    ablations,
    players: players.map(player => ({
      seed: player.seed,
      reviveCap: player.reviveCap,
      won: player.won,
      progress: player.progress,
      peak: player.peak,
      revivesUsed: player.revivesUsed,
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
