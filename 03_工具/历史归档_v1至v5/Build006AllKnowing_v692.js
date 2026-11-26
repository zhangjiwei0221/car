#!/usr/bin/env node
'use strict';

/**
 * E6.8R all-knowing-only milestone.
 *
 * v20 keeps two authored chain debts:
 *   - middle-right: (2,5) 5/21 + (3,5) 5/40
 *   - upper-right:  (1,5) 22/35 + (1,6) 34/25
 *
 * The old bottom three-chain is removed because the all-knowing route completed
 * it without debt. PlayerSim and policy-family results are diagnostics at this
 * milestone; only all-knowing story contracts are hard acceptance.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v19/关卡_实验_006_v19.json');
const ATLAS = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');
const GUIDED = process.env.GUIDED006 === '1';
const VERSION = GUIDED ? 'v21' : 'v20';
const OUT = path.join(ROOT, '实验关/关卡6/原型_' + VERSION);
const LEVEL_FILE = path.join(OUT, '关卡_实验_006_' + VERSION + '.json');
const ROUTE_FILE = path.join(OUT, '关卡_实验_006_' + VERSION + '.route.json');
const DEBUG_FILE = path.join(OUT, '关卡_实验_006_' + VERSION + '.debug.json');
const PLAN_FILE = path.join(OUT, GUIDED ? 'story-plan-v7.json' : 'story-plan-v6.json');
const REPORT_FILE = path.join(OUT, '关卡_实验_006_' + VERSION + '.md');
const AUDIT_FILE = path.join(OUT, 'route-space-audit-v1.json');

const REMOVED_GROUP = {
  id: 1,
  cells: [[5, 1], [5, 2], [5, 3]]
};
const CHAINS = [
  {
    id: 2,
    cells: [[2, 5], [3, 5]],
    role: '中段小件先完成，大件留下30px债务，第26步整组释放'
  },
  {
    id: 3,
    cells: GUIDED ? [[4, 1], [4, 2]] : [[1, 5], [1, 6]],
    role: GUIDED
      ? '中段15色组承诺，第一辆完成、第二辆留下22px债务，三步内释放'
      : '右上入口形成长期组承诺，直到终局附近才获得足够供给'
  }
];

function lookupAtlas() {
  const atlas = B.readJson(ATLAS);
  const lookup = { byCell: {}, byId: {} };
  for (const region of atlas.target.regions || []) {
    lookup.byId[region.id] = region;
    for (const cell of region.cells || []) {
      lookup.byCell[cell[0] + ',' + cell[1]] = region.id;
    }
  }
  return lookup;
}

function applyChains(game) {
  for (const [r, c] of REMOVED_GROUP.cells) {
    game.spools[r][c].type = 0;
    game.spools[r][c].param = 0;
  }
  for (const group of CHAINS) {
    for (const [r, c] of group.cells) {
      const spool = game.spools[r][c];
      if (!spool || spool.id <= 0) {
        throw new Error('锁链目标不是车辆: ' + r + ',' + c);
      }
      const oldTypes = Array.isArray(spool.type) ? spool.type : [spool.type];
      const oldParams = Array.isArray(spool.param) ? spool.param : [spool.param];
      const iceIndex = oldTypes.indexOf(7);
      const ice = iceIndex >= 0 ? (parseInt(oldParams[iceIndex], 10) || 0) : 0;
      spool.type = ice > 0 ? [5, 7] : 5;
      spool.param = ice > 0 ? [group.id, ice] : group.id;
    }
  }
}

function boardStats(level) {
  let boxes = 0;
  let black = 0;
  let ice = 0;
  let chainCells = 0;
  let pipeCells = 0;
  let question = 0;
  let logicalCars = 0;
  let capacitySum = 0;
  const capacities = [];
  for (const row of level.board.cells) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.t === 'black') black++;
      if (cell.t === 'pipe') {
        pipeCells++;
        logicalCars += (cell.queue || []).length;
        for (const item of cell.queue || []) {
          capacities.push(item.count);
          capacitySum += item.count;
        }
      }
      if (cell.t !== 'box') continue;
      boxes++;
      logicalCars++;
      capacities.push(cell.count);
      capacitySum += cell.count;
      if (cell.numice > 0) ice++;
      if (cell.chain > 0) chainCells++;
      if (cell.q) question++;
    }
  }
  return {
    rows: level.board.rows,
    cols: level.board.cols,
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
  };
}

function variantSolve(A, game) {
  const level = A.parseLevel(A.fromGameFormat(game));
  const solve = A.Solver.solveInstantChain(level, {
    timeBudgetMs: 20000
  });
  return {
    completed: solve.completed,
    progress: solve.progress,
    peak: solve.maxBuffer,
    windows: B.pressureWindows(solve.stepBufferHistory || [], 3),
    picks: B.uniquePicks(solve)
  };
}

function main() {
  const A = B.loadSolver();
  B.CHAIN_GROUPS.splice(0, B.CHAIN_GROUPS.length, ...B.clone(CHAINS));
  const game = B.readJson(SOURCE);
  applyChains(game);
  const level = A.parseLevel(A.fromGameFormat(game));
  const atlasLookup = lookupAtlas();
  const stats = boardStats(level);

  const solve = A.Solver.solveInstantChain(level, {
    timeBudgetMs: 30000
  });
  const picks = B.uniquePicks(solve);
  const events = B.obstacleEvents(A, level, picks);
  const trace = B.tracePlan(A, level, solve, atlasLookup);
  const roles = B.roleEvidence(A, level);
  const initial = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  initial.capture = true;
  const opening = B.optionsAt(A, initial, true);
  const matrix = B.openingMatrix(A, level, atlasLookup);
  const randomAudit = B.randomAudit(A, level, 500);
  const players = [];
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap
      });
      players.push({
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        peak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        stalledAtEnd: run.stalledAtEnd || 0,
        timeline: run.bufferTimeline || [],
        picks: B.uniquePicks(run)
      });
    }
  }

  const noMiddle = B.clone(game);
  for (const [r, c] of CHAINS[0].cells) {
    noMiddle.spools[r][c].type = 0;
    noMiddle.spools[r][c].param = 0;
  }
  const noUpper = B.clone(game);
  for (const [r, c] of CHAINS[1].cells) {
    noUpper.spools[r][c].type = 0;
    noUpper.spools[r][c].param = 0;
  }
  const ablations = {
    middleChain: variantSolve(A, noMiddle),
    upperChain: variantSolve(A, noUpper)
  };

  const chainChecks = {};
  for (const chain of CHAINS) {
    const event = events.chains[chain.id];
    chainChecks[chain.id] = {
      entered: event.entered,
      entryConsumedMember: event.entryConsumedMember,
      completedMember: event.completedMember,
      debtMember: event.debtMember,
      released: event.released,
      entryStep: event.entry && event.entry.step,
      releaseStep: event.release && event.release.step,
      entryResults: event.entry && event.entry.entryResults
    };
  }

  const roundtrip = A.parseLevel(A.fromGameFormat(A.toGameFormat(level)));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: 20000,
    greedyOnly: true
  });
  const chainAdjacent = CHAINS.every(group =>
    group.cells.slice(1).every((cell, index) =>
      Math.abs(cell[0] - group.cells[index][0]) +
      Math.abs(cell[1] - group.cells[index][1]) === 1));
  const allChainsHaveDebt = CHAINS.every(chain => {
    const item = chainChecks[chain.id];
    return item.entered && item.entryConsumedMember &&
      item.debtMember && item.completedMember && item.released;
  });
  const mainWindow = trace.windows.find(window => window.peak >= 4);
  const checks = {
    capacityContract: stats.logicalCars === 47 && stats.capacitySum === 1225 &&
      stats.capacityMin >= 20 && stats.capacityMax <= 40,
    boardContract: stats.rows === 7 && stats.cols === 7 &&
      stats.black === 2 && stats.ice === 5 && stats.pipeCells === 1 &&
      stats.chainCells === 4 && stats.question === 0,
    noInitialIce: level.board.cells[0].every(cell =>
      !cell || cell.t !== 'box' || cell.numice === 0),
    openingHasSevenChoices: opening.length === 7 &&
      opening.every(move => move.applied && move.consumed > 0),
    allKnowingSolvable: solve.completed && solve.progress === 100,
    allKnowingPeakFour: solve.maxBuffer === 4,
    allKnowingHasBufferFourWindow: !!mainWindow,
    allChainsHaveRealDebt: allChainsHaveDebt,
    chainsAdjacent: chainAdjacent,
    middleChainAblationChanges:
      JSON.stringify(ablations.middleChain.windows) !== JSON.stringify(trace.windows) ||
      JSON.stringify(ablations.middleChain.picks) !== JSON.stringify(picks),
    upperChainAblationChanges:
      JSON.stringify(ablations.upperChain.windows) !== JSON.stringify(trace.windows) ||
      JSON.stringify(ablations.upperChain.picks) !== JSON.stringify(picks),
    roundtripPass: !!roundtripSolve.completed
  };
  if (GUIDED) {
    checks.roleGraphPass = roles.ok;
    checks.playersPass = players.every(player =>
      player.won && player.progress === 100 && player.revivesUsed === 0);
    checks.noRevivePass = players.filter(player =>
      player.reviveCap === 0).every(player =>
      player.won && player.revivesUsed === 0);
  }
  const passed = Object.values(checks).every(Boolean);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(LEVEL_FILE, JSON.stringify(A.toGameFormat(level), null, 2) + '\n');
  const sha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(LEVEL_FILE))
    .digest('hex');

  const audit = {
    schema: '006-all-knowing-stage-v1',
    level: LEVEL_FILE,
    sha256,
    allKnowing: {
      completed: solve.completed,
      progress: solve.progress,
      steps: picks.length,
      peak: solve.maxBuffer,
      timeline: solve.stepBufferHistory || [],
      windows: trace.windows,
      picks,
      chains: chainChecks
    },
    opening,
    openingMatrix: matrix,
    chains: CHAINS,
    ablations,
    playerSimDiagnostic: {
      hardGate: false,
      runs: players,
      zeroReviveWon: players.filter(run =>
        run.reviveCap === 0 && run.won && run.revivesUsed === 0).length,
      defaultWon: players.filter(run =>
        run.reviveCap === 2 && run.won).length
    },
    roleGraphDiagnostic: {
      hardGate: false,
      ok: roles.ok
    },
    randomExternalAudit: {
      hardGate: false,
      audit: randomAudit
    },
    checks
  };
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(audit, null, 2) + '\n');
  fs.writeFileSync(PLAN_FILE, JSON.stringify({
    schema: '006-story-plan-v6-all-knowing',
    status: passed
      ? (GUIDED ? 'V21_GUIDED_PASS' : 'V20_ALL_KNOWING_PASS')
      : (GUIDED ? 'V21_GUIDED_FAIL' : 'V20_ALL_KNOWING_FAIL'),
    level: LEVEL_FILE,
    sha256,
    chains: CHAINS,
    allKnowing: audit.allKnowing,
    playerSim: audit.playerSimDiagnostic,
    roleGraph: audit.roleGraphDiagnostic
  }, null, 2) + '\n');
  fs.writeFileSync(ROUTE_FILE, JSON.stringify({
    schema: '006-all-knowing-route-v1',
    levelFile: LEVEL_FILE,
    solve,
    steps: trace.steps
  }, null, 2) + '\n');

  const debug = {
    schema: '006-all-knowing-' + VERSION,
    status: passed
      ? (GUIDED ? 'V21_GUIDED_PASS' : 'V20_ALL_KNOWING_PASS')
      : (GUIDED ? 'V21_GUIDED_FAIL' : 'V20_ALL_KNOWING_FAIL'),
    source: SOURCE,
    gameFormat: LEVEL_FILE,
    sha256,
    board: stats,
    allKnowing: audit.allKnowing,
    opening,
    chains: CHAINS,
    ablations,
    playerSimDiagnostic: audit.playerSimDiagnostic,
    roleGraphDiagnostic: audit.roleGraphDiagnostic,
    randomExternalAudit: audit.randomExternalAudit,
    checks
  };
  fs.writeFileSync(DEBUG_FILE, JSON.stringify(debug, null, 2) + '\n');

  const lines = [
    '# 006 · ' + VERSION + (GUIDED ? ' 硬引导样板' : ' 全知优先样板'),
    '',
    '## 结论',
    '',
    passed
      ? '全知里程碑通过：两组锁链均产生真实债务并释放，路线峰值4。'
      : '全知里程碑失败：不得接入生产页面。',
    '',
    '## 全知路线',
    '',
    `- ${picks.length}步通关；`,
    `- 峰值${solve.maxBuffer}；`,
    ...trace.windows.map(window =>
      `- ${window.startStep}～${window.endStep}步，峰值${window.peak}，` +
      `释放步${window.releaseStep ? window.releaseStep.step : '无'}。`),
    '',
    '## 锁链',
    '',
    ...CHAINS.map(chain => {
      const item = chainChecks[chain.id];
      return `- ${chain.cells.map(cell => '(' + cell[0] + ',' + cell[1] + ')')
        .join('+')}：第${item.entryStep}步进入，` +
        `第${item.releaseStep}步释放，` +
        `债务成员${item.debtMember ? '有' : '无'}。`;
    }),
    '',
    '## 当前阶段边界',
    '',
    '- 全知故事契约是硬门；',
    '- PlayerSim暂时只作诊断；',
    `- 0复活PlayerSim：${audit.playerSimDiagnostic.zeroReviveWon}/3；`,
    `- 默认复活PlayerSim：${audit.playerSimDiagnostic.defaultWon}/3；`,
    GUIDED
      ? '- 角色图和0复活PlayerSim作为v21附加硬门；'
      : '- 角色图和策略族旁路暂不否决v20；',
    GUIDED
      ? '- 策略族继续审计，真实UI等待策略空间稳定后再升级。'
      : '- 真实UI暂不升级，等待全知路线稳定后再做引导。',
    ''
  ];
  fs.writeFileSync(REPORT_FILE, lines.join('\n') + '\n');

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    sha256,
    board: stats,
    allKnowing: {
      progress: solve.progress,
      steps: picks.length,
      peak: solve.maxBuffer,
      windows: trace.windows,
      chains: chainChecks
    },
    playerSim: audit.playerSimDiagnostic.runs.map(run => ({
      seed: run.seed,
      reviveCap: run.reviveCap,
      won: run.won,
      progress: run.progress,
      peak: run.peak,
      revivesUsed: run.revivesUsed,
      stalledAtEnd: run.stalledAtEnd
    })),
    roleGraph: roles.ok,
    randomAudit,
    checks
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
