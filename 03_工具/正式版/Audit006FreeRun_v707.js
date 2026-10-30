#!/usr/bin/env node
'use strict';

/**
 * E6.8R “免费步”审计 v1
 *
 * 用户试玩反馈（2026-10-28）：
 *   “全知求解器压力超高，但我实际卡了一次之后一路畅通，每一步都是免费步。”
 *
 * 这个工具就是验证这句话：用一个“只挑免费步”的玩家策略跑关卡——
 * 只要存在任何“能收满”的动作就优先做，没有才挑欠最少的。
 *
 * 输出：通关与否、峰值、窗口、被迫欠债步数、最长连续免费步。
 *
 * 用法：node 03_工具/正式版/Audit006FreeRun_v707.js <level.json>
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const file = process.argv[2];
if (!file) { console.error('用法: node Audit006FreeRun_v707.js <level.json>'); process.exit(1); }

const A = B.loadSolver();
const game = B.readJson(file);
const level = A.parseLevel(A.fromGameFormat(game));

/** 克隆/重建 state：模拟到第 s 步 */
function stateAt(picks, s) {
  const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  for (let i = 0; i < s; i++) { st.capOps = []; A.Simulator.applyPick(st, picks[i].r, picks[i].c); }
  return st;
}

/** 在 state 上模拟一次选择，返回该动作是否“收满”（债务 0） */
function pickDebt(picks, s, move) {
  const st = stateAt(picks, s);
  st.capture = true;
  st.capOps = [];
  if (!A.Simulator.applyPick(st, move.r, move.c)) return null;
  const items = (st.buffer || []).filter(it => (it.progress || 0) < (it.need || 0));
  const debt = items.reduce((a, it) => a + (it.need - (it.progress || 0)), 0);
  return debt;
}

function runFreeFirst() {
  const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  const picks = [];
  const history = [];
  const debts = [];
  const maxSteps = 200;
  for (let step = 0; step < maxSteps; step++) {
    if (st.cleared) break;
    const moves = A.Simulator.listMoves(st).filter(m => !m.blocked);
    if (!moves.length) break;
    const scored = [];
    for (const m of moves) {
      const debt = pickDebt(picks, picks.length, m);
      if (debt == null) continue;
      scored.push({ move: m, debt });
    }
    if (!scored.length) break;
    // 真人式“免费步”：优先非锁链、能收满的动作；锁链整组入场会一次塞 2~3 件，尽量避免
    scored.sort((a, b) => {
      const ca = (a.move.groupSize > 1) ? 1 : 0;
      const cb = (b.move.groupSize > 1) ? 1 : 0;
      return (ca - cb) || (a.debt - b.debt) || (b.move.antBox.count - a.move.antBox.count);
    });
    const chosen = scored[0];
    st.capOps = [];
    A.Simulator.applyPick(st, chosen.move.r, chosen.move.c);
    picks.push({ r: chosen.move.r, c: chosen.move.c, color: chosen.move.antBox.color, count: chosen.move.antBox.count });
    history.push((st.buffer || []).length);
    debts.push(chosen.debt);
  }
  return { picks, history, debts, cleared: !!st.cleared };
}

const run = runFreeFirst();
const windows = B.pressureWindows(run.history, 3);
const forced = run.debts.map((d, i) => ({ step: i + 1, debt: d })).filter(x => x.debt > 0);
let longestFree = 0;
run.debts.forEach(d => { if (d === 0) longestFree++; });

// 最长连续免费
let cur = 0, best = 0;
run.debts.forEach(d => { if (d === 0) { cur++; best = Math.max(best, cur); } else cur = 0; });

// 全知对照
const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
const akHistory = solve.stepBufferHistory || [];
const akWindows = B.pressureWindows(akHistory, 3);

console.log('file=' + file);
console.log('freeFirst: picks=' + run.picks.length + ' cleared=' + run.cleared +
  ' peak=' + Math.max(0, ...run.history) + ' windows=' + windows.length +
  ' forcedDebtSteps=' + forced.length + ' longestFreeRun=' + best);
console.log('  forced=' + JSON.stringify(forced.slice(0, 8)));
console.log('  windows=' + JSON.stringify(windows));
console.log('allKnowing: steps=' + B.uniquePicks(solve).length + ' peak=' + solve.maxBuffer +
  ' windows=' + akWindows.length + ' ' + JSON.stringify(akWindows));
