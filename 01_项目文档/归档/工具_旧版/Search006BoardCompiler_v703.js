#!/usr/bin/env node
'use strict';

/**
 * E6.8R v30：链组 × 车格位置 联合搜索（棋盘编译器最小版）
 *
 * 背景（详见 01_项目文档/棋盘编译器_问题与改进记录.md）：
 *   v22~v29 共 11 种手工配置全部失败，根因是“组进入时机随路线漂移”。
 *   本工具把“交换几辆车”和“选哪几组链”放进同一个评估里，
 *   用硬约束筛解，而不是靠权重哄分数。
 *
 * 硬约束（不满足直接判负）：
 *   - 全知必须通关；
 *   - 峰值 ≤ 4（全程不触 5）；
 *   - 窗口 ≥ 3 段，且每段长度 ≥ 2 步；
 *   - 每组链：进入时已消比例 30%～70%、释放等待 ≤ 8 步；
 *   - 结束时 buffer 必须归零（不能挂着债收尾）。
 *
 * 用法：
 *   node 03_工具/正式版/Search006BoardCompiler_v703.js --iters 600
 *   node 03_工具/正式版/Search006BoardCompiler_v703.js --iters 600 --iters 1200 --write
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, '实验关/关卡6/原型_v24/关卡_实验_006_v24.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v30');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) : dflt;
};
const ITERS = arg('--iters', 400);
const SEED = arg('--seed', 20261028);
const WRITE = argv.includes('--write');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function isCar(cell) {
  if (!cell || !(cell.id > 0)) return false;
  const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
  return t.indexOf(11) < 0;
}

function applySwaps(game, swaps) {
  const g = B.clone(game);
  for (const [a, b] of swaps) {
    const ca = g.spools[a[0]][a[1]];
    const cb = g.spools[b[0]][b[1]];
    const id = ca.id, cnt = ca.count;
    ca.id = cb.id; ca.count = cb.count;
    cb.id = id; cb.count = cnt;
  }
  return g;
}

function candidateGroups(sp) {
  const out = [], seen = new Set();
  const push = cells => {
    const key = cells.map(c => c.join(',')).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    if (cells.some(([r]) => r === 0)) return;
    const color = sp[cells[0][0]][cells[0][1]].id;
    const cap = cells.reduce((a, [r, c]) => a + sp[r][c].count, 0);
    if (cap < 30 || cap > 100) return;
    out.push({ cells, color, cap });
  };
  for (let r = 0; r < sp.length; r++) for (let c = 0; c < sp[r].length; c++) {
    if (!isCar(sp[r][c])) continue;
    const color = sp[r][c].id;
    if (c + 1 < sp[r].length && isCar(sp[r][c + 1]) && sp[r][c + 1].id === color) {
      push([[r, c], [r, c + 1]]);
      if (c + 2 < sp[r].length && isCar(sp[r][c + 2]) && sp[r][c + 2].id === color) push([[r, c], [r, c + 1], [r, c + 2]]);
    }
    if (r + 1 < sp.length && isCar(sp[r + 1][c]) && sp[r + 1][c].id === color) {
      push([[r, c], [r + 1, c]]);
      if (r + 2 < sp.length && isCar(sp[r + 2][c]) && sp[r + 2][c].id === color) push([[r, c], [r + 1, c], [r + 2, c]]);
    }
  }
  return out;
}

function withChains(game, groups) {
  const g = B.clone(game);
  for (const row of g.spools) for (const cell of row) {
    const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
    if (t.indexOf(11) >= 0) continue;
    if (t.indexOf(5) >= 0 || t.indexOf(7) >= 0) { cell.type = 0; cell.param = 0; }
  }
  groups.forEach((grp, i) => {
    for (const [r, c] of grp.cells) {
      g.spools[r][c].type = 5;
      g.spools[r][c].param = i + 2;
    }
  });
  return g;
}

function groupEvents(A, level, picks, groups) {
  const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  const ev = {};
  groups.forEach((g, i) => { ev[i + 2] = { entered: false, entryStep: null, entryDebt: 0, entryConsumed: 0, maxDebt: 0, releaseStep: null, link: null }; });
  for (let i = 0; i < picks.length; i++) {
    st.capOps = [];
    if (!A.Simulator.applyPick(st, picks[i].r, picks[i].c)) continue;
    const last = st.lastPick || {};
    if (last.isChain && ev[last.chain] && !ev[last.chain].entered) {
      const e = ev[last.chain];
      e.entered = true; e.entryStep = i + 1; e.link = st._linkSeq;
      const items = (st.buffer || []).filter(it => it.link === e.link);
      e.entryConsumed = items.reduce((a, it) => a + Math.min(it.need || 0, it.progress || 0), 0);
      e.entryDebt = items.reduce((a, it) => a + Math.max(0, (it.need || 0) - (it.progress || 0)), 0);
    }
    groups.forEach((g, gi) => {
      const e = ev[gi + 2];
      if (!e.entered) return;
      const items = (st.buffer || []).filter(it => it.link === e.link);
      if (items.length) {
        const debts = items.filter(it => (it.progress || 0) < (it.need || 0));
        if (debts.length) e.maxDebt = Math.max(e.maxDebt, ...debts.map(it => it.need - (it.progress || 0)));
      } else if (!e.releaseStep) e.releaseStep = i + 1;
    });
  }
  return ev;
}

function evaluate(A, baseGame, swaps, groups) {
  const swapped = applySwaps(baseGame, swaps);
  const applied = withChains(swapped, groups);
  const level = A.parseLevel(A.fromGameFormat(applied));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  if (!solve.completed) return { ok: false, why: 'solve-failed', score: -1e9 };
  const picks = B.uniquePicks(solve);
  const history = solve.stepBufferHistory || [];
  const windows = B.pressureWindows(history, 3).filter(w => w.end - w.start + 1 >= 2);
  const ev = groupEvents(A, level, picks, groups);
  const detail = groups.map((g, i) => {
    const e = ev[i + 2];
    const ratio = g.cap ? (e.entryConsumed || 0) / g.cap : 0;
    return { cells: g.cells, color: g.color, cap: g.cap, entryStep: e.entryStep,
      ratio: Number(ratio.toFixed(2)), entryDebt: e.entryDebt, maxDebt: e.maxDebt,
      releaseStep: e.releaseStep, wait: e.entryStep && e.releaseStep ? e.releaseStep - e.entryStep : null };
  });
  const groupOK = detail.every(d => d.entryStep && d.ratio >= 0.3 && d.ratio <= 0.7 &&
    d.wait != null && d.wait <= 8 && d.maxDebt >= 8);
  const peakOK = solve.maxBuffer <= 4;
  const endZero = history[history.length - 1] === 0;
  const windowsOK = windows.length >= 3;
  const ok = groupOK && peakOK && endZero && windowsOK;
  const score =
    (ok ? 100000 : 0) +
    Math.min(windows.length, 4) * 2000 +
    (peakOK ? 500 : -3000) +
    (endZero ? 300 : -1500) +
    (groupOK ? 2000 : -3000) +
    detail.reduce((a, d) => a + Math.min(d.maxDebt || 0, 20), 0) -
    Math.max(0, 40 - picks.length) * 80;
  return { ok, score, steps: picks.length, peak: solve.maxBuffer, windows, detail, applied, picks, history };
}

function main() {
  const A = B.loadSolver();
  const base = B.readJson(SRC);
  const rand = rng(SEED);
  const cars = [];
  for (let r = 0; r < base.spools.length; r++) for (let c = 0; c < base.spools[r].length; c++) {
    if (isCar(base.spools[r][c])) cars.push([r, c]);
  }

  const results = [];
  let best = null;
  let feasible = 0;

  for (let it = 0; it < ITERS; it++) {
    const nSwaps = 1 + Math.floor(rand() * 3);
    const swaps = [];
    const used = new Set();
    for (let k = 0; k < nSwaps; k++) {
      const a = cars[Math.floor(rand() * cars.length)];
      const b = cars[Math.floor(rand() * cars.length)];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      if (used.has(a.join(',')) || used.has(b.join(','))) continue;
      used.add(a.join(',')); used.add(b.join(','));
      swaps.push([a, b]);
    }
    const swapped = applySwaps(base, swaps);
    const cands = candidateGroups(swapped.spools);
    if (!cands.length) continue;

    // 贪心选 3～4 组：从“必然欠”的颜色里优先
    const chosen = [];
    const usedCells = new Set();
    const pickPool = cands.filter(c => c.color !== 14 && c.color !== 15 && c.color !== 28);
    const pool = (pickPool.length >= 3 ? pickPool : cands).slice().sort((a, b) => b.cap - a.cap);
    for (const cand of pool) {
      if (chosen.length >= 4) break;
      if (cand.cells.some(([r, c]) => usedCells.has(r + ',' + c))) continue;
      if (chosen.some(g => g.color === cand.color)) continue; // 颜色不重复
      chosen.push(cand);
      cand.cells.forEach(([r, c]) => usedCells.add(r + ',' + c));
    }
    if (chosen.length < 3) continue;

    const r = evaluate(A, base, swaps, chosen);
    if (r.ok) feasible++;
    if (!best || r.score > best.r.score) {
      best = { swaps, groups: chosen, r };
      results.push({ it, ok: r.ok, score: Math.round(r.score), swaps: swaps.map(s => s.map(p => p.join(',')).join('-')), groups: chosen.map(g => g.color + ':' + g.cells.map(c => c.join(',')).join('+')) });
    }
    if ((it + 1) % 25 === 0) {
      console.log(`[${it + 1}/${ITERS}] best=${Math.round(best.r.score)} ok=${best.r.ok} feasible=${feasible} ` +
        `steps=${best.r.steps} peak=${best.r.peak} windows=${best.r.windows.length}`);
    }
  }

  fs.mkdirSync(OUT, { recursive: true });
  const payload = best ? {
    swaps: best.swaps.map(s => s.map(p => p.join(',')).join('-')),
    groups: best.groups.map(g => ({ color: g.color, cap: g.cap, cells: g.cells })),
    ok: best.r.ok, steps: best.r.steps, peak: best.r.peak,
    windows: best.r.windows, detail: best.r.detail, history: best.r.history
  } : null;
  fs.writeFileSync(path.join(OUT, 'board-search-v1.json'), JSON.stringify(payload, null, 2));
  if (WRITE && best) fs.writeFileSync(path.join(OUT, '关卡_实验_006_v30.json'), JSON.stringify(best.r.applied, null, 2));
  console.log('DONE feasible=' + feasible + ' best=' + (best ? Math.round(best.r.score) : 'none'));
  if (best) {
    console.log('swaps=' + payload.swaps.join(' | '));
    console.log('groups=' + payload.groups.map(g => g.color + ':' + g.cells.map(c => c.join(',')).join('+')).join(' | '));
    console.log('detail=' + JSON.stringify(best.r.detail));
  }
}

main();
