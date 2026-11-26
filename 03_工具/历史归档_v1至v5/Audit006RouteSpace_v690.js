#!/usr/bin/env node
'use strict';

/**
 * E6.8R: audit whether planned story states survive across route families.
 *
 * This is intentionally a diagnostic, not a generator. It runs deterministic
 * human-like policy families on the current level and reports which planned
 * debt states can be bypassed.
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const ROOT = path.resolve(__dirname, '..', '..');
const VERSION = process.env.AUDIT_VERSION || 'v19';
const LEVEL_FILE = process.env.AUDIT_LEVEL ?
  path.resolve(ROOT, process.env.AUDIT_LEVEL) :
  path.join(
    ROOT,
    '实验关/关卡6/原型_' + VERSION,
    '关卡_实验_006_' + VERSION + '.json'
  );
const ATLAS_FILE = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');
const OUT_DIR = process.env.AUDIT_OUT_DIR ?
  path.resolve(ROOT, process.env.AUDIT_OUT_DIR) :
  path.join(ROOT, '实验关/关卡6/原型_' + VERSION);
const OUT = path.join(OUT_DIR, 'route-space-audit-v1.json');
const REPORT = path.join(OUT_DIR, 'route-space-audit-v1.md');

const GAME = B.readJson(LEVEL_FILE);

function chainsFromGame(game) {
  const byGroup = {};
  for (let r = 0; r < game.maprow; r++) {
    for (let c = 0; c < game.mapcol; c++) {
      const spool = game.spools[r][c];
      if (!spool || spool.id <= 0) continue;
      const types = Array.isArray(spool.type) ? spool.type : [spool.type];
      if (!types.includes(5)) continue;
      const index = types.indexOf(5);
      const group = Array.isArray(spool.param) ? spool.param[index] : spool.param;
      if (!(group > 0)) continue;
      (byGroup[group] = byGroup[group] || []).push([r, c]);
    }
  }
  return Object.keys(byGroup).map(Number).sort((a, b) => a - b).map(id => ({
    id,
    cells: byGroup[id],
    role: 'group-' + id
  }));
}

const CHAINS = chainsFromGame(GAME);

function regionLookup() {
  const atlas = B.readJson(ATLAS_FILE);
  const lookup = { byCell: {}, byId: {} };
  for (const region of atlas.target.regions || []) {
    lookup.byId[region.id] = region;
    for (const cell of region.cells || []) {
      lookup.byCell[cell[0] + ',' + cell[1]] = region.id;
    }
  }
  return lookup;
}

function options(A, state, detailed) {
  return A.Simulator.listMoves(state)
    .filter(move => !move.blocked)
    .map(move => {
      const base = {
        r: move.r,
        c: move.c,
        color: move.antBox.color,
        count: move.antBox.count,
        canConsume: !!move.canConsume,
        groupSize: move.groupSize || 1
      };
      if (!detailed) return base;
      const child = A.SolverStrategy.cloneState(state);
      const before = child.eliminatedPixels;
      child.capOps = [];
      const applied = A.Simulator.applyPick(child, move.r, move.c);
      return {
        ...base,
        applied,
        consumed: child.eliminatedPixels - before,
        bufferAfter: child.buffer.length,
        debt: child.buffer.reduce((sum, item) =>
          sum + Math.max(0, item.need - item.progress), 0)
      };
    });
}

function scoreMove(policy, move) {
  if (policy === 'leftColumn') return [-move.c, -move.r, move.canConsume ? 0 : 1];
  if (policy === 'rightColumn') return [-(-move.c), -move.r, move.canConsume ? 0 : 1];
  if (policy === 'rowMajor') return [-move.r, -move.c, move.canConsume ? 0 : 1];
  if (policy === 'safe') {
    return [
      move.canConsume ? 1 : 0,
      move.consumed,
      -move.bufferAfter,
      -move.debt,
      -move.r,
      -move.c
    ];
  }
  if (policy === 'debtSeek') {
    return [
      move.debt,
      move.groupSize,
      move.consumed,
      -move.bufferAfter,
      -move.r,
      -move.c
    ];
  }
  throw new Error('unknown policy ' + policy);
}

function lexGreater(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return a.length > b.length;
}

function choose(A, state, policy, first) {
  let moves = options(A, state, true);
  if (first) {
    moves = moves.filter(move =>
      move.r === first[0] && move.c === first[1]);
  }
  if (!moves.length) return null;
  if (policy === 'safe') {
    const full = moves.filter(move => move.canConsume);
    if (full.length) moves = full;
  }
  let best = null;
  for (const move of moves) {
    const score = scoreMove(policy, move);
    if (!best || lexGreater(score, best.score)) best = { move, score };
  }
  return best && best.move;
}

function runPolicy(A, level, policy, first) {
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  const picks = [];
  const timeline = [];
  let fixedDone = !first;
  let guard = 300;

  while (state.eliminatedPixels < state.totalPixels && guard-- > 0) {
    const move = choose(A, state, policy, fixedDone ? null : first);
    if (!move) break;
    state.capOps = [];
    if (!A.Simulator.applyPick(state, move.r, move.c)) break;
    picks.push({
      r: move.r,
      c: move.c,
      color: move.color,
      count: move.count,
      canConsume: move.canConsume,
      groupSize: move.groupSize
    });
    timeline.push(state.buffer.length);
    fixedDone = true;
  }

  const events = B.obstacleEvents(A, level, picks);
  const chainSummary = {};
  for (const group of CHAINS) {
    const event = events.chains[group.id];
    chainSummary[group.id] = {
      role: group.role,
      cells: group.cells,
      entered: event.entered,
      consumedCurrent: event.entryConsumedMember,
      debt: event.debtMember,
      completed: event.completedMember,
      released: event.released,
      entryStep: event.entry && event.entry.step,
      releaseStep: event.release && event.release.step
    };
  }

  const windows = B.pressureWindows(timeline, 3);
  const controlDeadline = Math.max(1, Math.ceil(picks.length * 0.7));
  const controlledDebtGroups = CHAINS.filter(group => {
    const item = chainSummary[group.id];
    return item.debt && item.released &&
      item.entryStep != null && item.entryStep <= controlDeadline;
  }).length;
  return {
    policy,
    first: first || null,
    won: state.eliminatedPixels >= state.totalPixels,
    progress: +(state.eliminatedPixels / state.totalPixels * 100).toFixed(1),
    steps: picks.length,
    peak: timeline.length ? Math.max(...timeline) : 0,
    windows,
    reachedBuffer3: timeline.some(value => value >= 3),
    reachedBuffer4: timeline.some(value => value >= 4),
    reachedBuffer5: timeline.some(value => value >= 5),
    chains: chainSummary,
    plannedDebtGroups: CHAINS.filter(group =>
      chainSummary[group.id].debt && chainSummary[group.id].released).length,
    controlledDebtGroups,
    controlDeadline,
    missedDebtGroups: CHAINS.filter(group =>
      !chainSummary[group.id].debt || !chainSummary[group.id].released)
      .map(group => group.id),
    picks,
    timeline
  };
}

function summarizeChainEvents(A, level, picks) {
  const events = B.obstacleEvents(A, level, picks);
  const summary = {};
  for (const group of CHAINS) {
    const event = events.chains[group.id];
    summary[group.id] = {
      role: group.role,
      cells: group.cells,
      entered: event.entered,
      consumedCurrent: event.entryConsumedMember,
      debt: event.debtMember,
      completed: event.completedMember,
      released: event.released,
      entryStep: event.entry && event.entry.step,
      releaseStep: event.release && event.release.step
    };
  }
  return summary;
}

function runAllKnowing(A, level) {
  const solve = A.Solver.solveInstantChain(level, {
    timeBudgetMs: 30000
  });
  const picks = B.uniquePicks(solve);
  const timeline = solve.stepBufferHistory || [];
  const chain = summarizeChainEvents(A, level, picks);
  const steps = picks.length;
  const controlDeadline = Math.max(1, Math.ceil(steps * 0.7));
  const controlledDebtGroups = CHAINS.filter(group => {
    const item = chain[group.id];
    return item.debt && item.released &&
      item.entryStep != null && item.entryStep <= controlDeadline;
  }).length;
  return {
    policy: 'allKnowing',
    first: null,
    won: !!solve.completed && solve.progress === 100,
    progress: solve.progress,
    steps,
    peak: solve.maxBuffer || (timeline.length ? Math.max(...timeline) : 0),
    windows: B.pressureWindows(timeline, 3),
    reachedBuffer3: timeline.some(value => value >= 3),
    reachedBuffer4: timeline.some(value => value >= 4),
    reachedBuffer5: timeline.some(value => value >= 5),
    chains: chain,
    plannedDebtGroups: CHAINS.filter(group =>
      chain[group.id].debt && chain[group.id].released).length,
    controlledDebtGroups,
    controlDeadline,
    missedDebtGroups: CHAINS.filter(group =>
      !chain[group.id].debt || !chain[group.id].released)
      .map(group => group.id),
    picks,
    timeline
  };
}

function main() {
  const A = B.loadSolver();
  B.CHAIN_GROUPS.splice(0, B.CHAIN_GROUPS.length, ...B.clone(CHAINS));
  const level = A.parseLevel(A.fromGameFormat(B.readJson(LEVEL_FILE)));
  const lookup = regionLookup();
  const policies = ['leftColumn', 'rightColumn', 'rowMajor', 'safe', 'debtSeek'];
  const runs = [runAllKnowing(A, level)];
  for (const policy of policies) {
    runs.push(runPolicy(A, level, policy));
  }

  const initial = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  initial.capture = true;
  const firstMoves = options(A, initial, true);
  const firstEntryRuns = [];
  for (const first of firstMoves) {
    const result = runPolicy(A, level, 'safe', [first.r, first.c]);
    firstEntryRuns.push({
      first: {
        r: first.r,
        c: first.c,
        color: first.color,
        count: first.count,
        canConsume: first.canConsume,
        consumed: first.consumed,
        debt: first.debt
      },
      result
    });
  }

  const bypasses = runs.filter(run =>
    run.won && run.controlledDebtGroups === 0);
  const uncontrolledWins = runs.filter(run =>
    run.won && (run.controlledDebtGroups === 0 || run.reachedBuffer5));
  const failedPolicies = runs.filter(run => !run.won);
  const summary = {
    schema: '006-route-space-audit-v1',
    version: VERSION,
    level: LEVEL_FILE,
    policyCount: policies.length,
    firstEntryCount: firstEntryRuns.length,
    bypassCount: bypasses.length,
    uncontrolledWinCount: uncontrolledWins.length,
    failedPolicyCount: failedPolicies.length,
    bypassPolicies: bypasses.map(run => ({
      policy: run.policy,
      missedDebtGroups: run.missedDebtGroups,
      peak: run.peak,
      windows: run.windows
    })),
    failedPolicies: failedPolicies.map(run => ({
      policy: run.policy,
      progress: run.progress,
      peak: run.peak,
      missedDebtGroups: run.missedDebtGroups
    })),
    minimumRequiredDebtGroups: CHAINS.length,
    runs,
    firstEntries: firstEntryRuns
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n');

  const lines = [
    '# 006 · 路线空间审计 ' + VERSION,
    '',
    '## 结论',
    '',
    bypasses.length || uncontrolledWins.length || failedPolicies.length
      ? '失败：存在无受控组债务、触顶或无法通关的策略族。'
      : '通过：当前策略族均在70%前进组债务，零复活通关且不触顶。',
    '',
    '## 策略族',
    '',
    '| 策略 | 通关 | 进度 | 步数 | 峰值 | 受控债务组 | 漏掉组 |',
    '|---|---:|---:|---:|---:|---:|---|'
  ];
  for (const run of runs) {
    lines.push(`| ${run.policy} | ${run.won ? '是' : '否'} | ` +
      `${run.progress}% | ${run.steps} | ${run.peak} | ` +
      `${run.controlledDebtGroups}/${CHAINS.length} | ` +
      `${run.missedDebtGroups.join('、') || '无'} |`);
  }
  lines.push('', '## 首行固定首取', '',
    '| 首取 | 通关 | 进度 | 峰值 | 受控债务组 | 漏掉组 |',
    '|---|---:|---:|---:|---:|---|');
  for (const item of firstEntryRuns) {
    const run = item.result;
    lines.push(`| (${item.first.r},${item.first.c}) ${item.first.color}/${item.first.count} | ` +
      `${run.won ? '是' : '否'} | ${run.progress}% | ${run.peak} | ` +
      `${run.controlledDebtGroups}/${CHAINS.length} | ` +
      `${run.missedDebtGroups.join('、') || '无'} |`);
  }
  lines.push('');
  fs.writeFileSync(REPORT, lines.join('\n') + '\n');

  console.log(JSON.stringify({
    ok: true,
    version: VERSION,
    output: OUT,
    report: REPORT,
    bypassCount: bypasses.length,
    uncontrolledWinCount: uncontrolledWins.length,
    failedPolicyCount: failedPolicies.length,
    policies: runs.map(run => ({
      policy: run.policy,
      won: run.won,
      progress: run.progress,
      steps: run.steps,
      peak: run.peak,
      plannedDebtGroups: run.plannedDebtGroups,
      controlledDebtGroups: run.controlledDebtGroups,
      missedDebtGroups: run.missedDebtGroups,
      windows: run.windows
    })),
    firstEntries: firstEntryRuns.map(item => ({
      first: item.first,
      won: item.result.won,
      progress: item.result.progress,
      peak: item.result.peak,
      plannedDebtGroups: item.result.plannedDebtGroups,
      controlledDebtGroups: item.result.controlledDebtGroups,
      missedDebtGroups: item.result.missedDebtGroups
    }))
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
