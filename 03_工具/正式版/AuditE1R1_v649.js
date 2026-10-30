#!/usr/bin/env node
'use strict';

/**
 * E1-R1 story audit.
 *
 * Read-only checks for the v7 controlled-choice board:
 *   - debt windows and selectable alternatives;
 *   - planned PlayerSim prefix;
 *   - PlayerSim reveal timing;
 *   - final debt/release in the actual player route;
 *   - divergence between the planned route and the all-knowing route.
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

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function routePrefix(run, count) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({
      step: pick.step,
      tick: pick.tick,
      r: pick.r,
      c: pick.c,
      color: pick.color,
      count: pick.count
    });
    if (out.length >= count) break;
  }
  return out;
}

function optionSummary(A, state) {
  const preview = A.Simulator.previewNextEliminationOrder(state);
  return A.Simulator.listMoves(state)
    .filter(move => !move.blocked)
    .map(move => {
      const stats = preview.byColor[move.antBox.color] || { reachable: 0 };
      return {
        r: move.r,
        c: move.c,
        color: move.antBox.color,
        count: move.antBox.count,
        reachable: stats.reachable || 0,
        consumable: !!move.canConsume,
        debt: !move.canConsume && (stats.reachable || 0) > 0,
        dead: !move.canConsume && !(stats.reachable > 0)
      };
    })
    .sort((a, b) => a.r - b.r || a.c - b.c);
}

function windowAfter(A, level, actions) {
  const state = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  for (const action of actions) {
    if (!A.Simulator.applyPick(state, action.r, action.c)) {
      throw new Error('无法回放窗口前缀: ' + action.r + ',' + action.c);
    }
  }
  const options = optionSummary(A, state);
  return {
    actions,
    options,
    counts: {
      moves: options.length,
      ready: options.filter(x => x.consumable).length,
      partialDebt: options.filter(x => x.debt).length,
      deadDebt: options.filter(x => x.dead).length
    }
  };
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
    const frame = run.frames[i];
    for (const cell of frame.eats || []) {
      if (!eliminated[cell.r][cell.c]) {
        eliminated[cell.r][cell.c] = true;
        eliminatedPixels++;
      }
    }
    view.eliminated = eliminated;
    view.eliminatedPixels = eliminatedPixels;
    const preview = A.Simulator.previewNextEliminationOrder(view);
    const reachable = new Set();
    for (let r = 0; r < preview.rank.length; r++) {
      for (let c = 0; c < preview.rank[r].length; c++) {
        if (preview.rank[r][c] > 0) {
          const id = byCell[r + ',' + c];
          if (id) reachable.add(id);
        }
      }
    }
    for (const id of ['R59', 'R65']) {
      if (!firstReach[id] && reachable.has(id)) {
        const pick = run.pickOrder[i];
        firstReach[id] = {
          frame: i + 1,
          step: pick && pick.step,
          tick: pick && pick.tick,
          progressPct: +(eliminatedPixels / level.totalPixels * 100).toFixed(1),
          pick: pick ? {
            r: pick.r,
            c: pick.c,
            color: pick.color,
            count: pick.count
          } : null
        };
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
          bufferAfter: events[i + 1].bufferAfter,
          stalled: events[i + 1].stalled
        } : null
      };
    }
  }
  return null;
}

function main() {
  const variant = arg('--variant', '8');
  if (variant !== '7' && variant !== '8' && variant !== '9') {
    throw new Error('只支持 --variant 7 / 8 / 9');
  }
  const label = 'v' + variant;
  const auditVersion = variant === '9' ? 'v4' : variant === '8' ? 'v3' : 'v2';
  const levelFile = path.resolve(arg(
    '--level',
    variant === '9'
      ? '实验关/关卡6/原型_v9/关卡_实验_v9.json'
      : variant === '8'
      ? '实验关/关卡6/原型_v8/关卡_实验_v8.json'
      : '实验关/关卡6/原型_v7/关卡_实验_v7.json'
  ));
  const atlasFile = path.resolve(arg(
    '--atlas',
    '实验关/关卡6/分析_v632/target-atlas.json'
  ));
  const outDir = path.resolve(arg('--out-dir', path.dirname(levelFile)));
  const A = loadSolver();
  const level = A.parseLevel(A.fromGameFormat(readJson(levelFile)));
  const atlas = readJson(atlasFile);

  const actions = variant === '8' || variant === '9'
    ? [
        { role: 'entry', r: 0, c: 2 },
        { role: 'hollow', r: 0, c: 1 },
        { role: 'debt1', r: 0, c: 0 },
        { role: 'release1', r: 1, c: 0 },
        { role: 'debt2', r: 0, c: 3 },
        { role: 'release2', r: 1, c: 3 }
      ]
    : [
        { role: 'entry', r: 0, c: 0 },
        { role: 'hollow', r: 0, c: 1 },
        { role: 'debt1', r: 0, c: 2 },
        { role: 'release1', r: 1, c: 2 },
        { role: 'debt2', r: 0, c: 3 },
        { role: 'release2', r: 0, c: 6 }
      ];
  const firstWindow = windowAfter(A, level, actions.slice(0, 2));
  const secondWindow = windowAfter(A, level, actions.slice(0, 4));

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  if (!solve.completed) throw new Error(label + ' 全知不可解');
  const player = A.PlayerSim.run(level, {
    seed: 7,
    instantChain: true,
    reviveCap: 0,
    capture: true
  });
  if (!player.won) throw new Error(label + ' 0复活 PlayerSim 未通关');

  const expectedPrefix = actions.map(x => x.r + ',' + x.c);
  const actualPrefix = routePrefix(player, actions.length).map(x => x.r + ',' + x.c);
  const prefixMatches = expectedPrefix.length === actualPrefix.length &&
    expectedPrefix.every((cell, i) => cell === actualPrefix[i]);
  const allKnowingPrefix = routePrefix(solve, actions.length);
  const allKnowingPlannedPrefix = allKnowingPrefix.map(x => x.r + ',' + x.c);
  const allKnowingMatchesPlan = expectedPrefix.every((cell, i) => cell === allKnowingPlannedPrefix[i]);

  const reveals = playerReveals(A, level, player, atlas);
  const finale = finalDebtAndRelease(player);

  const checks = {
    firstWindowNoDeadDebt: firstWindow.counts.deadDebt === 0,
    secondWindowNoDeadDebt: secondWindow.counts.deadDebt === 0,
    playerStartsWithExpectedOptions: firstWindow.counts.ready === 0 &&
      firstWindow.counts.partialDebt === firstWindow.counts.moves,
    playerPrefixMatchesPlan: prefixMatches,
    playerCompletesWithoutRevive: player.won && player.revivesUsed === 0,
    playerRevealsR59: !!reveals.R59,
    playerRevealsR65: !!reveals.R65,
    hasFinalDebtAndRelease: !!(finale && finale.next &&
      finale.next.bufferAfter < finale.debt.bufferAfter),
    allKnowingMatchesPlan
  };

  const allChecksPass = Object.keys(checks).every(key => checks[key]);
  const report = {
    schema: variant === '9'
      ? 'e1-r3-story-audit-v1'
      : variant === '8'
      ? 'e1-r2-story-audit-v1'
      : 'e1-r1-story-audit-v1',
    levelFile,
    atlasFile,
    actions,
    firstWindow,
    secondWindow,
    allKnowing: {
      completed: solve.completed,
      progress: solve.progress,
      maxBuffer: solve.maxBuffer,
      first6: allKnowingPrefix,
      matchesPlan: allKnowingMatchesPlan
    },
    player: {
      seed: 7,
      reviveCap: 0,
      won: player.won,
      progress: player.progress,
      revivesUsed: player.revivesUsed,
      bufferPeak: player.bufferPeak,
      playerAvgBuffer: player.playerAvgBuffer,
      first6: routePrefix(player, actions.length),
      matchesPlan: prefixMatches
    },
    reveals,
    finale,
    checks,
    verdict: allChecksPass
      ? '机器审计全部通过：全知和0复活 PlayerSim 均走完整六步链，两个债务窗口无死债，玩家揭示和末段释放成立；仍待人工审阅可读性。'
      : checks.firstWindowNoDeadDebt &&
        checks.secondWindowNoDeadDebt &&
        checks.playerPrefixMatchesPlan &&
        checks.playerCompletesWithoutRevive &&
        checks.playerRevealsR59 &&
        checks.playerRevealsR65 &&
        checks.hasFinalDebtAndRelease
        ? '玩家故事链已成立，但全知旁路仍未解决。'
        : '仍有关键故事检查未通过。',
    remaining:
      allKnowingMatchesPlan
        ? ['人工审阅；进入 E1 完整样板评审。']
        : [
            '全知路线会先取部分支持车再回到计划债务，尚未消除旁路；',
            '确认这种偏离是否仍保留核心思考，还是需要继续重排车辆；',
            '人工审阅首行观感、揭示可读性和末段压力；',
            'E1 通过前不得进入 E2。'
          ]
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'story-audit-' + auditVersion + '.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  const md = [
    '# 006 · ' + (variant === '9' ? 'E1-R3' : variant === '8' ? 'E1-R2' : 'E1-R1') + ' Story Audit ' + auditVersion,
    '',
    '> 只读审计；没有新增或修改障碍。',
    '',
    '## 结论',
    '',
    report.verdict,
    '',
    '## 第一债务窗口',
    '',
    '| 选项 | 可达/需求 | 分类 |',
    '|---|---:|---|',
    ...firstWindow.options.map(x => '| (' + x.r + ',' + x.c + ') ' +
      x.color + '/' + x.count + ' | ' + x.reachable + '/' + x.count + ' | ' +
      (x.consumable ? '可立即收满' : x.debt ? '可见部分债务' : '当前死债') + ' |'),
    '',
    '计数：可立即收满 ' + firstWindow.counts.ready +
      '；可见部分债务 ' + firstWindow.counts.partialDebt +
      '；当前死债 ' + firstWindow.counts.deadDebt + '。',
    '',
    '## 第二拍窗口',
    '',
    '| 选项 | 可达/需求 | 分类 |',
    '|---|---:|---|',
    ...secondWindow.options.map(x => '| (' + x.r + ',' + x.c + ') ' +
      x.color + '/' + x.count + ' | ' + x.reachable + '/' + x.count + ' | ' +
      (x.consumable ? '可立即收满' : x.debt ? '可见部分债务' : '当前死债') + ' |'),
    '',
    '## 玩家路线',
    '',
    '- 0 复活通关：' + (player.won ? '是' : '否'),
    '- 前六步符合计划：' + (prefixMatches ? '是' : '否'),
    '- 首六步：' + actualPrefix.join(' → '),
    '- R59：' + (reveals.R59 ? '第 ' + reveals.R59.step + ' 步 / ' + reveals.R59.progressPct + '%' : '未出现'),
    '- R65：' + (reveals.R65 ? '第 ' + reveals.R65.step + ' 步 / ' + reveals.R65.progressPct + '%' : '未出现'),
    '- 末段债务：' + (finale ? '第 ' + finale.debt.tick + ' tick，' +
      finale.debt.color + '/' + finale.debt.need : '未找到'),
    '- 末段释放：' + (finale && finale.next ? '下一 tick，buffer ' +
      finale.debt.bufferAfter + ' → ' + finale.next.bufferAfter : '未找到'),
    '',
    '## 全知旁路',
    '',
    '- 全知前六步符合计划：' + (allKnowingMatchesPlan ? '是' : '否'),
    '- 全知前六步：' + allKnowingPrefix.map(x => x.r + ',' + x.c + ':' +
      x.color + '/' + x.count).join(' → '),
    '',
    '## 剩余',
    '',
    ...report.remaining.map(x => '- ' + x),
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'story-audit-' + auditVersion + '.md'), md);
  console.log(JSON.stringify({
    ok: true,
    outDir,
    checks,
    verdict: report.verdict,
    firstWindow: firstWindow.counts,
    secondWindow: secondWindow.counts,
    player: report.player,
    reveals,
    finale,
    allKnowing: {
      maxBuffer: solve.maxBuffer,
      first6: allKnowingPrefix
    }
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
