#!/usr/bin/env node
'use strict';

/**
 * “按目标进度布障碍”求解器 v1
 *
 * 目的：不再猜“把障碍放哪”，而是：
 *   1) 看目标进度（默认 55%）那一刻，场上有几辆免费车；
 *   2) 对每辆免费车尝试“改成管道（进队列、格子阻挡）”或“与相邻免费车成链”；
 *   3) 只保留：该进度免费车减少 + 全知可通关 + 峰值≤4 + 产品审核通过 的改动。
 *
 * 用法：node 03_工具/正式版/Solve006ObstacleTarget_v713.js <level.json> [--progress 0.55]
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const file = process.argv[2];
if (!file) { console.error('用法: Solve006ObstacleTarget_v713.js <level.json> [--progress 0.55]'); process.exit(1); }
const pi = process.argv.indexOf('--progress');
const PROGRESS = pi >= 0 ? Number(process.argv[pi + 1]) : 0.55;

const A = B.loadSolver();

function isCar(cell) {
  if (!cell) return false;
  const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
  return cell.id > 0 && t.every(x => x !== 11);
}

function solveGame(game) {
  const level = A.parseLevel(A.fromGameFormat(game));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const picks = B.uniquePicks(solve);
  return { level, solve, picks, history: solve.stepBufferHistory || [] };
}

/** 在目标进度处：可点车、免费车、每色可用 */
function snapshot(game, progress) {
  const r = solveGame(game);
  if (!r.solve.completed) return { completed: false, free: [], steps: r.picks.length };
  const steps = r.picks.length;
  const s = Math.max(0, Math.min(steps - 1, Math.round(progress * steps)));
  const st = A.Simulator.createState(r.level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  for (let i = 0; i < s; i++) { st.capOps = []; A.Simulator.applyPick(st, r.picks[i].r, r.picks[i].c); }
  const moves = A.Simulator.listMoves(st).filter(m => !m.blocked);
  const cars = [];
  for (const m of moves) {
    const probe = A.Simulator.createState(r.level, { useSlotStart: true, instantChain: true });
    probe.capture = true;
    for (let i = 0; i < s; i++) { probe.capOps = []; A.Simulator.applyPick(probe, r.picks[i].r, r.picks[i].c); }
    probe.capOps = [];
    if (!A.Simulator.applyPick(probe, m.r, m.c)) continue;
    const items = (probe.buffer || []).filter(it => (it.progress || 0) < (it.need || 0));
    const debt = items.reduce((a, it) => a + (it.need - (it.progress || 0)), 0);
    cars.push({ r: m.r, c: m.c, color: m.antBox.color, cap: m.antBox.count, debt });
  }
  return { completed: true, steps, s, pickable: cars.length, free: cars.filter(x => x.debt === 0), cars, history: r.history };
}

function auditOf(game) {
  const r = solveGame(game);
  if (!r.solve.completed) return { pass: false, reason: 'not-completed' };
  const total = r.picks.length;
  const samples = r.history.map((buf, i) => ({ done: i + 1, buf }));
  const audit = A.Analysis.chokepointAudit(samples, total, game.bufferLimit || 5);
  return { pass: audit.pass, earlyMax: audit.earlyMax, lateMax: audit.lateMax, peak: audit.peakBuf,
    high: audit.high, reasons: audit.reasons, steps: total, peak2: r.solve.maxBuffer };
}

function asPipe(game, r, c, type) {
  const g = B.clone(game);
  const cell = g.spools[r][c];
  const q = { id: cell.id, count: cell.count };
  cell.id = 0; cell.type = type; cell.param = [q]; cell.count = 0;
  return g;
}

function asChain(game, cells) {
  const g = B.clone(game);
  for (const [r, c] of cells) {
    const cell = g.spools[r][c];
    const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
    if (Array.isArray(t)) {
      if (t.indexOf(5) >= 0) return null;
      cell.type = t.concat([5]);
      cell.param = (Array.isArray(cell.param) ? cell.param : [cell.param]).concat([99]);
    } else {
      cell.type = 5; cell.param = 99;
    }
  }
  return g;
}

function main() {
  const base = B.readJson(file);
  const snap = snapshot(base, PROGRESS);
  console.log(`基线：进度 ${(PROGRESS * 100).toFixed(0)}% ≈ 第 ${snap.s} 步，可点 ${snap.pickable}，免费 ${snap.free.length}`);
  console.log('免费车：' + snap.free.map(f => `(${f.r},${f.c})${f.color}/${f.cap}`).join('  '));

  const rows = [];
  const dirs = [11, 12, 13, 14];
  for (const f of snap.free) {
    for (const d of dirs) {
      const dv = A.PIPE_DIRS[d];
      const er = f.r + dv[0], ec = f.c + dv[1];
      if (er < 0 || er >= base.spools.length || ec < 0 || ec >= base.spools[0].length) continue;
      const g = asPipe(base, f.r, f.c, d);
      let s2, a2;
      try { s2 = snapshot(g, PROGRESS); a2 = auditOf(g); } catch (e) { continue; }
      if (!a2.pass) continue;
      rows.push({ kind: 'pipe', at: `(${f.r},${f.c})`, dir: d, freeAfter: s2.free.length, free: s2.free,
        peak: a2.peak2, steps: a2.steps, early: a2.earlyMax, late: a2.lateMax });
      break; // 每个位置只试第一个合法方向
    }
  }
  // 成链：相邻两辆免费车
  for (let i = 0; i < snap.free.length; i++) {
    for (let j = i + 1; j < snap.free.length; j++) {
      const a = snap.free[i], b = snap.free[j];
      if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) continue;
      const g = asChain(base, [[a.r, a.c], [b.r, b.c]]);
      if (!g) continue;
      let s2, a2;
      try { s2 = snapshot(g, PROGRESS); a2 = auditOf(g); } catch (e) { continue; }
      if (!a2.pass) continue;
      rows.push({ kind: 'chain', at: `(${a.r},${a.c})+(${b.r},${b.c})`, freeAfter: s2.free.length, free: s2.free,
        peak: a2.peak2, steps: a2.steps, early: a2.earlyMax, late: a2.lateMax });
    }
  }

  rows.sort((x, y) => (x.freeAfter - y.freeAfter) || (x.peak - y.peak));
  console.log('\n候选（只列审核通过的）：');
  console.log('改动 | 该进度免费车 | 峰值 | 步数 | 前期/后期');
  for (const r of rows.slice(0, 12)) {
    console.log(`${r.kind} ${r.at}${r.dir ? '/dir' + r.dir : ''} | ${r.freeAfter} | ${r.peak} | ${r.steps} | ${r.early}/${r.late}`);
  }
  if (!rows.length) console.log('（没有审核通过的候选）');
}

main();
