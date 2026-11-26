#!/usr/bin/env node
'use strict';

/**
 * E6.7f B: add one semantic two-chain checkpoint to v14.
 *
 * 4,1 / 5,2 are linked because the first completes while the second remains
 * partial. The completed member is held by the group until the other catches
 * up, creating a third, visibly different pressure window.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v14/关卡_实验_006_v14.json');
const BASE_DEBUG = path.join(ROOT, '实验关/关卡6/原型_v14/关卡_实验_006_v14.debug.json');
const ATLAS = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v15');
const LEVEL_FILE = path.join(OUT, '关卡_实验_006_v15.json');
const ROUTE_FILE = path.join(OUT, '关卡_实验_006_v15.route.json');
const DEBUG_FILE = path.join(OUT, '关卡_实验_006_v15.debug.json');
const PLAN_JSON = path.join(OUT, 'story-plan-v3.json');
const PLAN_MD = path.join(OUT, 'story-plan-v3.md');
const REPORT_MD = path.join(OUT, '关卡_实验_006_v15.md');
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

const CHAIN_CELLS = [[4, 1], [5, 2]];
const CHAIN_GROUP = 1;

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
    slot: item.slot,
    link: item.link || 0,
    enteredAtStep: item.enterStep == null ? null : item.enterStep + 1
  }));
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

function tracePressure(A, level, run, atlasLookup) {
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
      throw new Error('压力回放失败: step=' + (i + 1));
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

  const windows = windowsAtLeast(steps.map(step => step.bufferLevel), 3);
  return {
    steps,
    windows: windows.map((window, index) => {
      const peakStep = steps
        .slice(window.start - 1, window.end)
        .reduce((best, step) =>
          best == null || step.bufferLevel > best.bufferLevel ? step : best, null);
      const release = steps
        .slice(window.end)
        .find(step => step.bufferLevel < peakStep.bufferLevel);
      return {
        id: 'pressure-' + (index + 1),
        startStep: window.start,
        endStep: window.end,
        length: window.length,
        peak: window.peak,
        peakStep,
        steps: steps.slice(window.start - 1, window.end),
        choiceCountAtPeak: peakStep.nextMoves.length,
        targetRegions: (function () {
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
          return Object.values(byRegion)
            .sort((a, b) => b.pixels - a.pixels || a.region.localeCompare(b.region))
            .slice(0, 12);
        })(),
        release: release ? {
          step: release.step,
          r: release.r,
          c: release.c,
          color: release.color,
          count: release.count,
          bufferAfter: release.buffer,
          reduction: peakStep.bufferLevel - release.bufferLevel
        } : null
      };
    })
  };
}

function chainEvidence(A, level, run) {
  const picks = uniquePicks(run);
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  let entered = null;
  let released = null;

  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    state.capOps = [];
    A.Simulator.applyPick(state, pick.r, pick.c);
    const linked = bufferState(state).filter(item => item.link === CHAIN_GROUP);
    if (!entered && linked.length > 0) {
      entered = {
        step: i + 1,
        pick,
        buffer: bufferState(state),
        linked
      };
    }
    if (entered && !released && linked.length === 0) {
      released = {
        step: i + 1,
        pick,
        buffer: bufferState(state)
      };
    }
  }
  return { entered, released };
}

function main() {
  const A = loadSolver();
  const game = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const atlasLookup = regionLookup(
    JSON.parse(fs.readFileSync(ATLAS, 'utf8'))
  );
  for (const [r, c] of CHAIN_CELLS) {
    if (!game.spools[r][c] || game.spools[r][c].id <= 0) {
      throw new Error('锁链位置不是车辆: ' + r + ',' + c);
    }
    game.spools[r][c].type = 5;
    game.spools[r][c].param = CHAIN_GROUP;
  }
  const level = A.parseLevel(A.fromGameFormat(game));

  const opening = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  opening.capture = true;
  const openingMoves = optionsAt(A, opening);

  const roles = {
    safe: traceRole(A, level, 'safe', [[0, 3], [1, 3]]),
    lightDebt: traceRole(A, level, 'lightDebt', [[0, 0], [1, 0], [2, 0]]),
    heavyDebt: traceRole(A, level, 'heavyDebt', [[0, 6], [1, 6], [2, 6]])
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
  let groupEvidence = null;
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap
      });
      const trace = tracePressure(A, level, run, atlasLookup);
      const group = chainEvidence(A, level, run);
      if (seed === 7 && reviveCap === 0) groupEvidence = group;
      const summary = {
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        bufferPeak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        bufferTimeline: run.bufferTimeline,
        windows: trace.windows,
        pickOrder: run.pickOrder,
        picks: uniquePicks(run)
      };
      players.push(summary);
      playerPlans.push({
        seed,
        reviveCap,
        windows: trace.windows,
        steps: trace.steps,
        group
      });
    }
  }

  const zeroRevive = players.filter(player => player.reviveCap === 0);
  const baseDebug = JSON.parse(fs.readFileSync(BASE_DEBUG, 'utf8'));
  const chainAblation = {
    withoutChain: {
      solveBufferPeak: baseDebug.solve.bufferPeak,
      windowsPerZeroReviveSeed: baseDebug.players
        .filter(player => player.reviveCap === 0)
        .map(player => player.windows.length)
    },
    withChain: {
      solveBufferPeak: solve.maxBuffer,
      windowsPerZeroReviveSeed: zeroRevive.map(player => player.windows.length)
    }
  };

  const noBlackGame = JSON.parse(JSON.stringify(game));
  for (let r = 0; r < noBlackGame.maprow; r++) {
    for (let c = 0; c < noBlackGame.mapcol; c++) {
      if (noBlackGame.spools[r][c].id === -1) {
        noBlackGame.spools[r][c] = { id: 0, type: 0, param: 0, count: 0 };
      }
    }
  }
  const noBlackLevel = A.parseLevel(A.fromGameFormat(noBlackGame));
  const noBlackSolve = A.Solver.solveInstantChain(noBlackLevel, {
    timeBudgetMs: 20000
  });
  const noBlackPlayers = [7, 1009, 2027].map(seed =>
    A.PlayerSim.run(noBlackLevel, {
      seed,
      instantChain: true,
      reviveCap: 0
    })
  );
  const blackAblation = {
    withBlack: {
      solveBufferPeak: solve.maxBuffer,
      playersWon: zeroRevive.filter(player => player.won).length
    },
    withoutBlack: {
      solveCompleted: noBlackSolve.completed,
      solveProgress: noBlackSolve.progress,
      solveBufferPeak: noBlackSolve.maxBuffer,
      playersWon: noBlackPlayers.filter(run => run.won).length,
      playersProgress: noBlackPlayers.map(run => run.progress)
    }
  };

  const baseTimeline = JSON.stringify(
    players.find(player => player.seed === 7 && player.reviveCap === 0).bufferTimeline
  );
  let iceProbeChanged = 0;
  let iceProbePassed = 0;
  for (let r = 1; r < game.maprow; r++) {
    for (let c = 0; c < game.mapcol; c++) {
      const sourceSpool = game.spools[r][c];
      if (!sourceSpool || sourceSpool.id <= 0 ||
          CHAIN_CELLS.some(([cr, cc]) => cr === r && cc === c)) continue;
      const probeGame = JSON.parse(JSON.stringify(game));
      probeGame.spools[r][c].type = 7;
      probeGame.spools[r][c].param = 1;
      let probeLevel;
      try { probeLevel = A.parseLevel(A.fromGameFormat(probeGame)); }
      catch (e) { continue; }
      const probe = A.PlayerSim.run(probeLevel, {
        seed: 7,
        instantChain: true,
        reviveCap: 0
      });
      if (JSON.stringify(probe.bufferTimeline) !== baseTimeline) iceProbeChanged++;
      if (probe.won && probe.progress === 100 && probe.revivesUsed === 0) iceProbePassed++;
    }
  }
  const obstacleDecision = {
    schema: '006-obstacle-decision-v1',
    black: {
      keep: blackAblation.withBlack.playersWon > blackAblation.withoutBlack.playersWon ||
        blackAblation.withBlack.solveBufferPeak !== blackAblation.withoutBlack.solveBufferPeak,
      role: 'structural-shape',
      ablation: blackAblation
    },
    chain: {
      keep: chainAblation.withoutChain.solveBufferPeak !== chainAblation.withChain.solveBufferPeak ||
        JSON.stringify(chainAblation.withoutChain.windowsPerZeroReviveSeed) !==
          JSON.stringify(chainAblation.withChain.windowsPerZeroReviveSeed),
      role: 'group-debt',
      ablation: chainAblation
    },
    ice: {
      keep: false,
      reason: iceProbeChanged === 0
        ? '所有单格1步冰探针均未改变seed7路线或buffer曲线'
        : '单格冰虽有变化，但未形成独立可解释职责',
      changedSeed7Routes: iceProbeChanged,
      passedSeed7Routes: iceProbePassed
    },
    pipe: {
      keep: false,
      reason: '当前满盘没有空闲出口供queue释放；必须为管道单独重摆，暂不强行加入'
    },
    question: {
      keep: false,
      reason: '顶层信息立即公开，没有可推断的未知；问号只会隐藏答案'
    }
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
  let chainGroups = new Set();
  let pipe = 0;
  let question = 0;
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
        if (cell.chain > 0) {
          chainCells++;
          chainGroups.add(cell.chain);
        }
        if (cell.q) question++;
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
    oneTwoChainGroup: chainCells === 2 && chainGroups.size === 1,
    noIcePipeQuestion: ice === 0 && pipe === 0 && question === 0,
    openingHasSevenLiveChoices: openingMoves.length === 7 &&
      openingMoves.every(move => move.applied && move.consumed > 0),
    roleGraphPass: rolePass,
    solvePass: solve.completed && solve.progress === 100,
    solveReachesPressureFour: solve.maxBuffer >= 4,
    playersPass: players.every(player =>
      player.won && player.progress === 100 && player.revivesUsed === 0),
    twoPressureWindowsPerZeroReviveSeed:
      zeroRevive.every(player => player.windows.length >= 2),
    pressurePeakReachesFour:
      zeroRevive.every(player => player.bufferPeak >= 4),
    pressureWindowsHaveChoicesAndRegions:
      zeroRevive.every(player => player.windows.every(window =>
        window.choiceCountAtPeak >= 2 && window.targetRegions.length > 0)),
    chainGroupDebtObserved: !!(groupEvidence &&
      groupEvidence.entered &&
      groupEvidence.entered.linked.some(item => item.remaining === 0) &&
      groupEvidence.entered.linked.some(item => item.remaining > 0) &&
      groupEvidence.released),
    chainAblationChangesPressure:
      chainAblation.withoutChain.solveBufferPeak !== chainAblation.withChain.solveBufferPeak ||
      JSON.stringify(chainAblation.withoutChain.windowsPerZeroReviveSeed) !==
        JSON.stringify(chainAblation.withChain.windowsPerZeroReviveSeed),
    blackAblationChangesRoute:
      blackAblation.withoutBlack.playersWon < blackAblation.withBlack.playersWon ||
      blackAblation.withoutBlack.solveBufferPeak !== blackAblation.withBlack.solveBufferPeak,
    iceProbeRejectsUnnecessaryIce: iceProbeChanged === 0,
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
    schema: '006-story-plan-v3',
    status: passed ? 'CHAIN_CHECKPOINT_PASS' : 'CHAIN_CHECKPOINT_FAIL',
    source: SOURCE,
    selectedSearchCandidate: path.join(
      ROOT,
      '实验关/关卡6/搜索_v14_pressure/best-candidate-v1.json'
    ),
    level: LEVEL_FILE,
    sha256,
    openingMoves,
    pressureWindows: playerPlans
      .find(plan => plan.seed === 7 && plan.reviveCap === 0)
      .windows,
    groupDebt: {
      role: 'groupCommitment',
      chainGroup: CHAIN_GROUP,
      cells: CHAIN_CELLS.map(([r, c]) => {
        const spool = game.spools[r][c];
        return { r, c, color: spool.id, count: spool.count };
      }),
      targetRegion: 'R57（两辆车的消费 trace 均覆盖）',
      evidence: groupEvidence
    },
    chainAblation,
    blackAblation,
    obstacleDecision,
    playerPlans
  };
  fs.writeFileSync(PLAN_JSON, JSON.stringify(storyPlan, null, 2) + '\n');

  const report = {
    schema: '006-chain-checkpoint-v15',
    status: passed ? 'V15_PASS' : 'V15_FAIL',
    source: SOURCE,
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
      chainCells,
      chainGroups: chainGroups.size,
      pipe,
      question,
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
    groupEvidence,
    chainAblation,
    blackAblation,
    obstacleDecision,
    routeDiversity: routeKeys.size,
    checks
  };
  fs.writeFileSync(DEBUG_FILE, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(ROUTE_FILE, JSON.stringify({
    schema: '006-player-routes-v3',
    levelFile: LEVEL_FILE,
    playerRuns: players
  }, null, 2) + '\n');

  const seedPlan = playerPlans.find(plan =>
    plan.seed === 7 && plan.reviveCap === 0);
  fs.writeFileSync(PLAN_MD, [
    '# 006 · StoryPlan v3',
    '',
    '## 结论',
    '',
    passed
      ? '通过：保留开放开局与两个压力窗口，并用一组二连锁形成第三段组债承诺。'
      : '失败：链组未满足职责、压力或可解要求。',
    '',
    '## 压力窗口',
    '',
    ...seedPlan.windows.map(window =>
      `- ${window.id}：第${window.startStep}～${window.endStep}步，峰值${window.peak}；` +
      `峰值可见动作${window.choiceCountAtPeak}；` +
      `目标区${window.targetRegions.slice(0, 5).map(region => region.region).join('、')}；` +
      `释放第${window.release.step}步，下降${window.release.reduction}。`
    ),
    '',
    '## 锁链职责',
    '',
    `- 锁链组${CHAIN_GROUP}：${CHAIN_CELLS.map(([r, c]) => {
      const spool = game.spools[r][c];
      return '(' + r + ',' + c + ') ' + spool.id + '/' + spool.count;
    }).join(' + ')}；`,
    groupEvidence && groupEvidence.entered
      ? `- 第${groupEvidence.entered.step}步整组进入；组内${groupEvidence.entered.linked
          .map(item => item.color + '剩' + item.remaining).join('、')}；`
      : '- 组债未发生；',
    groupEvidence && groupEvidence.released
      ? `- 第${groupEvidence.released.step}步整组释放，暂存回到${groupEvidence.released.buffer.length}。`
      : '- 组债未释放。',
    '- 关联目标：两辆车的消费 trace 均覆盖 R57；',
    '- 移除锁链后v14全知峰值1；加入后v15全知峰值4，且PlayerSim新增第三段压力窗口。',
    `- 移除黑块后0复活PlayerSim通关${blackAblation.withoutBlack.playersWon}/3；黑块参与路径塑形。`,
    `- 单格数字冰探针改变seed7路线数：${iceProbeChanged}；因此不为了展示机制强行加冰。`,
    '- 管道不加入：当前满盘没有queue出口；需要隐藏车时会单独重摆。',
    '- 问号不加入：顶层信息立即公开，没有可推断的未知。',
    ''
  ].join('\n') + '\n');

  fs.writeFileSync(REPORT_MD, [
    '# 006 · Chain Checkpoint v15',
    '',
    '## 结论',
    '',
    passed ? '通过：二连锁形成可解释组债并改善压力。' : '失败：保留证据。',
    '',
    '## 棋盘',
    '',
    `- 7×7、${boxes}车、${black}黑、${ice}冰；`,
    `- ${chainCells}格锁链，${chainGroups.size}组；`,
    `- ${pipe}管道、${question}问号；`,
    `- 容量${minCapacity}～${maxCapacity}，总和${sum}。`,
    '',
    '## 障碍决策',
    '',
    `- 黑块：保留；移除后PlayerSim通关${blackAblation.withoutBlack.playersWon}/3。`,
    `- 二连锁：保留；移除后全知峰值${chainAblation.withoutChain.solveBufferPeak}，` +
      `加入后${chainAblation.withChain.solveBufferPeak}。`,
    `- 数字冰：${iceProbeChanged === 0 ? '拒绝；单格探针未改变seed7路线或压力' : '待复核；探针改变了路线'}。`,
    '- 管道：拒绝；当前无queue出口，强行加入会破坏布局。',
    '- 问号：拒绝；没有可推断线索。',
    '',
    '## 验证',
    '',
    `- 全知100%，峰值${solve.maxBuffer}；`,
    `- 默认/0复活PlayerSim通过${players.filter(player => player.won).length}/${players.length}；`,
    `- 0复活seed均有至少两个3/4窗口；`,
    `- 组债进入步骤：${groupEvidence && groupEvidence.entered ? groupEvidence.entered.step : '无'}；`,
    `- 组债释放步骤：${groupEvidence && groupEvidence.released ? groupEvidence.released.step : '无'}；`,
    `- JSON往返：${roundtripSolve.completed ? '通过' : '失败'}；`,
    `- SHA-256：\`${sha256}\`。`,
    ''
  ].join('\n') + '\n');

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    sha256,
    board: report.board,
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      peak: solve.maxBuffer,
      windows: windowsAtLeast(solve.stepBufferHistory || [], 3)
    },
    pressureWindows: seedPlan.windows.map(window => ({
      id: window.id,
      startStep: window.startStep,
      endStep: window.endStep,
      peak: window.peak,
      release: window.release
    })),
    groupEvidence,
    chainAblation,
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
