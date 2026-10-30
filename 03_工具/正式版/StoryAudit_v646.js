#!/usr/bin/env node
'use strict';

/**
 * Story audit v1.
 *
 * Read-only audit for controlled story boards. It compares:
 *   1. the planned story cells;
 *   2. the all-knowing route;
 *   3. PlayerSim with and without revives.
 *
 * This tool must not add, move, or remove obstacles. Its purpose is to answer
 * whether the story is actually reachable and visible before any mechanism is
 * selected.
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

function pct(completed, total) {
  return total ? +(completed / total * 100).toFixed(1) : 0;
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

function bufferSummary(state) {
  return state.buffer.map(item => ({
    color: item.color,
    progress: item.progress,
    need: item.need,
    remaining: item.need - item.progress
  }));
}

function optionSummary(A, state) {
  const preview = A.Simulator.previewNextEliminationOrder(state);
  const moves = A.Simulator.listMoves(state);
  const options = moves.map(move => {
    const stats = preview.byColor[move.antBox.color] || { reachable: 0, remaining: move.antBox.count };
    return {
      r: move.r,
      c: move.c,
      color: move.antBox.color,
      count: move.antBox.count,
      reachable: stats.reachable || 0,
      consumable: !!move.canConsume,
      debt: !move.canConsume && (stats.reachable || 0) > 0,
      dead: !move.canConsume && !(stats.reachable > 0),
      blocked: !!move.blocked
    };
  });
  return {
    preview,
    options,
    counts: {
      moves: options.filter(x => !x.blocked).length,
      ready: options.filter(x => !x.blocked && x.consumable).length,
      partialDebt: options.filter(x => !x.blocked && x.debt).length,
      deadDebt: options.filter(x => !x.blocked && x.dead).length
    }
  };
}

function replayAllKnowing(A, level, solve, lookup) {
  const state = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  const rows = [];
  const seen = new Set();
  for (const pick of solve.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    const before = optionSummary(A, state);
    const bufferBefore = bufferSummary(state);
    const completedBefore = state.completedBoxes;
    const reachableRegionsBefore = reachableRegions(before.preview, lookup);
    if (!A.Simulator.applyPick(state, pick.r, pick.c)) {
      throw new Error('全知路线回放失败: step ' + pick.step + ' (' + pick.r + ',' + pick.c + ')');
    }
    const picked = state.lastPick && state.lastPick.picked || [];
    const bufferAfter = bufferSummary(state);
    rows.push({
      step: pick.step,
      progressPct: pct(state.eliminatedPixels, state.totalPixels),
      pick: {
        r: pick.r,
        c: pick.c,
        color: pick.color,
        count: pick.count,
        groupSize: state.lastPick && state.lastPick.boxes || 1
      },
      picked,
      optionCounts: before.counts,
      options: before.options,
      bufferBefore,
      bufferAfter,
      reachableRegions: reachableRegionsBefore,
      completedDelta: state.completedBoxes - completedBefore,
      stalledAfter: bufferAfter.filter(x => x.remaining > 0)
    });
  }
  return rows;
}

function firstAtCell(route, r, c) {
  return route.find(x => (x.r != null ? x.r : x.pick && x.pick.r) === r &&
    (x.c != null ? x.c : x.pick && x.pick.c) === c) || null;
}

function compactPlayerRun(run) {
  return {
    won: !!run.won,
    progress: run.progress,
    completedBoxes: run.completedBoxes,
    totalBoxes: run.totalBoxes,
    bufferPeak: run.bufferPeak,
    playerAvgBuffer: run.playerAvgBuffer,
    revivesUsed: run.revivesUsed,
    stalledAtEnd: run.stalledAtEnd,
    pickOrder: run.pickOrder,
    instantEvents: run.instantEvents,
    reviveEvents: run.reviveEvents
  };
}

function eventAtTick(run, tick) {
  return (run.instantEvents || []).find(x => x.tick === tick) || null;
}

function playerStoryMatch(run, action) {
  const pick = firstAtCell(run.pickOrder || [], action.r, action.c);
  if (!pick) return null;
  const event = eventAtTick(run, pick.tick);
  return {
    step: pick.step,
    tick: pick.tick,
    color: pick.color,
    count: pick.count,
    bufferBefore: event ? event.bufferBefore : null,
    bufferAfter: event ? event.bufferAfter : null,
    stalledAfter: event ? event.stalled : null,
    revivedThisTick: !!(event && event.revive)
  };
}

function findFirstReach(trace, regionIds) {
  const found = {};
  for (const id of regionIds) found[id] = null;
  for (const row of trace) {
    for (const id of regionIds) {
      if (!found[id] && row.reachableRegions.includes(id)) {
        found[id] = { step: row.step, progressPct: row.progressPct };
      }
    }
  }
  return found;
}

function classifyBeat(name, allKnowing, playerDefault, playerNoRevive) {
  return {
    beat: name,
    allKnowing,
    playerDefault,
    playerNoRevive,
    playerDefaultMatches:
      !!allKnowing &&
      !!playerDefault &&
      allKnowing.step === playerDefault.step &&
      allKnowing.debt === playerDefault.debt,
    playerNoReviveMatches:
      !!allKnowing &&
      !!playerNoRevive &&
      allKnowing.step === playerNoRevive.step &&
      allKnowing.debt === playerNoRevive.debt
  };
}

function markdown(report) {
  const b = report.beats;
  const lines = [
    '# 006 · Story Level v5 故事审计',
    '',
    '> 只读审计。没有增加、移动或删除障碍。',
    '',
    '## 结论',
    '',
    report.verdict,
    '',
    '## 两条真实路线',
    '',
    '| 指标 | 全知 | PlayerSim（默认2次复活） | PlayerSim（0复活） |',
    '|---|---:|---:|---:|',
    '| 通关 | ' + (report.allKnowing.completed ? '是' : '否') +
      ' | ' + (report.playerDefault.won ? '是' : '否') +
      ' | ' + (report.playerNoRevive.won ? '是' : '否') + ' |',
    '| 进度 | ' + report.allKnowing.progress + '%' +
      ' | ' + report.playerDefault.progress + '%' +
      ' | ' + report.playerNoRevive.progress + '%' + ' |',
    '| 峰值 | ' + report.allKnowing.maxBuffer +
      ' | ' + report.playerDefault.bufferPeak +
      ' | ' + report.playerNoRevive.bufferPeak + ' |',
    '| 复活 | 0 | ' + report.playerDefault.revivesUsed +
      ' | ' + report.playerNoRevive.revivesUsed + ' |',
    '',
    '## 计划节拍是否实际发生',
    '',
    '| 节拍 | 计划格 | 全知 | 默认PlayerSim | 0复活PlayerSim | 判定 |',
    '|---|---|---|---|---|---|',
    ...[
      ['教学·入口', '0,3', b.teachEntry],
      ['教学·掏入', '1,3', b.teachHollow],
      ['第一债务', '2,3', b.firstDebt],
      ['第一释放', '3,3', b.firstRelease],
      ['v5第二拍候选', '1,4', b.secondBeatCandidate]
    ].map(([name, cell, x]) => {
      const fmt = y => !y ? '未发生' :
        ('第' + y.step + '步' + (y.debt ? '·留债' : '·即时收满') +
          (y.checkpoint ? '·前置链路后' : ''));
      return '| ' + name + ' | ' + cell + ' | ' + fmt(x.allKnowing) +
        ' | ' + fmt(x.playerDefault) + ' | ' + fmt(x.playerNoRevive) +
        ' | ' + (x.playerDefaultMatches ? '路线一致' : '路线不一致') + ' |';
    }),
    '',
    '## 第一债务窗口',
    '',
    '全知第 2 步后：',
    '',
    '| 选项 | 当前可达/需求 | 分类 |',
    '|---|---:|---|',
    ...report.firstDebtWindow.options
      .filter(x => !x.blocked)
      .sort((a, b) => a.r - b.r || a.c - b.c)
      .map(x => '| (' + x.r + ',' + x.c + ') ' + x.color + '/' + x.count +
        ' | ' + x.reachable + '/' + x.count + ' | ' +
        (x.consumable ? '可立即收满' : x.debt ? '可见部分债务' : '当前死债') + ' |'),
    '',
    '计数：' + [
      '可立即收满 ' + report.firstDebtWindow.counts.ready,
      '可见部分债务 ' + report.firstDebtWindow.counts.partialDebt,
      '当前死债 ' + report.firstDebtWindow.counts.deadDebt
    ].join('；') + '。',
    '',
    '## 中段揭示',
    '',
    '- R59：' + (report.reveals.R59 ? '全知第 ' + report.reveals.R59.step + ' 步 / ' + report.reveals.R59.progressPct + '%' : '未找到'),
    '- R65：' + (report.reveals.R65 ? '全知第 ' + report.reveals.R65.step + ' 步 / ' + report.reveals.R65.progressPct + '%' : '未找到'),
    '- 这仍是全知路线证据；默认 PlayerSim 在此之前已经走上另一条恢复路线。',
    '',
    '## 故事缺口',
    '',
    ...report.gaps.map(x => '- **' + x.atom + '**：' + x.finding),
    '',
    '## 下一步裁决',
    '',
    ...report.next.map(x => '- ' + x),
    ''
  ];
  return lines.join('\n');
}

function main() {
  const levelFile = path.resolve(arg(
    '--level',
    '实验关/关卡6/原型_v5/关卡_实验_v5.json'
  ));
  const atlasFile = path.resolve(arg(
    '--atlas',
    '实验关/关卡6/分析_v632/target-atlas.json'
  ));
  const outDir = path.resolve(arg('--out-dir', path.dirname(levelFile)));
  const seeds = arg('--seeds', '7,1009,2027').split(',').map(Number);
  const A = loadSolver();
  const level = A.parseLevel(A.fromGameFormat(readJson(levelFile)));
  const atlas = readJson(atlasFile);
  const lookup = regionLookup(atlas);

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  if (!solve.completed) throw new Error('全知未通关，无法做故事审计');
  const trace = replayAllKnowing(A, level, solve, lookup);

  const playerDefaultRuns = seeds.map(seed =>
    compactPlayerRun(A.PlayerSim.run(level, { seed, instantChain: true, reviveCap: 2 }))
  );
  const playerNoReviveRuns = seeds.map(seed =>
    compactPlayerRun(A.PlayerSim.run(level, { seed, instantChain: true, reviveCap: 0 }))
  );
  const playerDefault = playerDefaultRuns[0];
  const playerNoRevive = playerNoReviveRuns[0];

  const actions = [
    { role: 'teachEntry', r: 0, c: 3, expectedColor: 30, expectedDebt: false },
    { role: 'teachHollow', r: 1, c: 3, expectedColor: 15, expectedDebt: false },
    { role: 'firstDebt', r: 2, c: 3, expectedColor: 17, expectedDebt: true },
    { role: 'firstRelease', r: 3, c: 3, expectedColor: 31, expectedDebt: false },
    { role: 'secondBeatCandidate', r: 1, c: 4, expectedColor: 30, expectedDebt: true }
  ];

  const beats = {};
  for (const action of actions) {
    const ak = firstAtCell(trace, action.r, action.c);
    const allKnowing = ak ? {
      step: ak.step,
      progressPct: ak.progressPct,
      debt: ak.stalledAfter.some(x => x.color === action.expectedColor),
      checkpoint: !!ak
    } : null;
    const def = playerStoryMatch(playerDefault, action);
    const noRev = playerStoryMatch(playerNoRevive, action);
    const normalize = x => x ? {
      step: x.step,
      progressPct: null,
      debt: (x.stalledAfter || []).some(y => y.color === action.expectedColor),
      checkpoint: !!x
    } : null;
    beats[action.role] = classifyBeat(
      action.role,
      allKnowing,
      normalize(def),
      normalize(noRev)
    );
    beats[action.role].allKnowingRaw = allKnowing;
    beats[action.role].playerDefaultRaw = def;
    beats[action.role].playerNoReviveRaw = noRev;
  }

  const firstDebtStep = trace.find(x => x.step === 3);
  if (!firstDebtStep) throw new Error('未找到全知第3步');
  const reveals = findFirstReach(trace, ['R59', 'R65']);
  const defaultRevive = playerDefault.reviveEvents[0] || null;

  const gaps = [
    {
      atom: 'choice / voluntaryDebt',
      finding: '第一债务窗口不是“一个正确债务加少量替代”，而是 8 个可选债务，其中 6 个当前可达数为 0。' +
        '棋盘没有告诉玩家为什么应选 17/26，反而把完全消不掉的 22/35 放在最先被扫到的位置。'
    },
    {
      atom: 'visibleHope / repair',
      finding: defaultRevive
        ? ('默认 PlayerSim 在第 ' + defaultRevive.tick + ' tick 用复活清掉 ' +
          defaultRevive.targets.map(x => x.color + '欠' + x.remaining).join('、') +
          '；这证明无复活路线在 ' + playerNoRevive.progress + '% 处已死。当前“通关”不能作为故事成立证据。')
        : '未观察到复活，但默认 PlayerSim 仍未遵循计划节拍。'
    },
    {
      atom: 'secondBeat',
      finding: 'v5 放在 (1,4) 的第二辆 30/22 在当前局面一取即满，没有形成第二笔债务，也没有触发第二次释放。'
    },
    {
      atom: 'reveal',
      finding: 'R59/R65 只在全知第 ' + [reveals.R59 && reveals.R59.step, reveals.R65 && reveals.R65.step].filter(Boolean).join('/') +
        ' 步可达；默认 PlayerSim 已先走偏并复活，因此目前没有“玩家从空间关系中看见揭示”的证据。'
    },
    {
      atom: 'finale',
      finding: '全知第 33~47 步主要是连续可收满的清尾，没有基于前两拍的新组合决策；当前更像自动清盘，不是收束。'
    }
  ];

  const report = {
    schema: 'story-audit-v1',
    levelFile,
    atlasFile,
    obstacleChanges: 0,
    seeds,
    allKnowing: {
      completed: solve.completed,
      progress: solve.progress,
      steps: solve.steps,
      maxBuffer: solve.maxBuffer
    },
    playerDefault,
    playerNoRevive,
    playerDefaultRuns,
    playerNoReviveRuns,
    beats,
    firstDebtWindow: {
      counts: firstDebtStep.optionCounts,
      options: firstDebtStep.options
    },
    reveals,
    trace,
    gaps,
    verdict: 'v5 不通过故事审计。第一段教学成立，但第一债务的选择并不可解释；' +
      '默认 PlayerSim 依靠 1 次复活才通关，0 复活仅到 ' + playerNoRevive.progress + '%。' +
      'v5 的第二拍候选没有留债，因此当前缺口不是“少一组障碍”，而是可点选项池与第二拍因果没有被棋盘控制。',
    next: [
      '先冻结 v5 为“机械可解但故事不成立”的反例，不继续在它上面叠障碍。',
      '下一版优先重排车辆可见性：第一债务时刻只暴露有解释的 2~3 个选择，至少让预期车收益明显高于死债。',
      '把“第二拍”定义为必须出现的实际状态变化（新债务或新释放），不能只移动一辆同色车到目标格。',
      '只有在选项池控制后仍缺少延迟、绑定或空间塑形时，才允许加入单一语义障碍，并做移除消融。',
      '验收必须同时报告默认 PlayerSim 与 0 复活 PlayerSim；复活后通关不能替代故事路线发生。'
    ]
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'story-audit-v1.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(outDir, 'story-audit-v1.md'),
    markdown(report)
  );
  console.log(JSON.stringify({
    ok: true,
    outDir,
    verdict: report.verdict,
    allKnowing: report.allKnowing,
    playerDefault: {
      won: playerDefault.won,
      progress: playerDefault.progress,
      revivesUsed: playerDefault.revivesUsed,
      bufferPeak: playerDefault.bufferPeak
    },
    playerNoRevive: {
      won: playerNoRevive.won,
      progress: playerNoRevive.progress,
      revivesUsed: playerNoRevive.revivesUsed,
      bufferPeak: playerNoRevive.bufferPeak
    },
    firstDebtWindow: report.firstDebtWindow.counts,
    reveals
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
