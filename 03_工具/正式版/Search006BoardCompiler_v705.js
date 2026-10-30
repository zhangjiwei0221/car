#!/usr/bin/env node
'use strict';

/**
 * E6.8R v30：链组 × 车格位置 联合搜索（棋盘编译器最小版）
 *
 * 背景（详见 01_交接文档/棋盘编译器_问题与改进记录.md）：
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
const OUT = path.join(ROOT, '实验关/关卡6/原型_v30c');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) : dflt;
};
const ITERS = arg('--iters', 4000);
const SEED = arg('--seed', 20261028);
const WRITE = argv.includes('--write');
const TARGET_W = arg('--windows', 4);

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
  // 违约项（每个都单独计数，便于爬山“一格格修”）
  const v = [];
  if (groups.length < 3) v.push('groups<' + 3);
  if (windows.length < 3) v.push('windows<' + 3);
  if (solve.maxBuffer > 4) v.push('peak>' + 4);
  if (history[history.length - 1] !== 0) v.push('end-nonzero');
  detail.forEach((d, i) => {
    if (!d.entryStep) v.push('g' + i + '-not-entered');
    if (d.entryStep && (d.ratio < 0.3 || d.ratio > 0.7)) v.push('g' + i + '-ratio' + d.ratio);
    if (d.entryStep && d.wait != null && d.wait > 8) v.push('g' + i + '-wait' + d.wait);
    if (d.entryStep && (d.maxDebt || 0) < 8) v.push('g' + i + '-debt' + (d.maxDebt || 0));
  });
  const goal = Math.abs(windows.length - TARGET_W) + v.length;
  const score =
    Math.min(windows.length, 4) * 500 +
    detail.reduce((a, d) => a + Math.min(d.maxDebt || 0, 20), 0) -
    Math.max(0, 40 - picks.length) * 40;
  return { ok: v.length === 0, violations: v, goal, score,
    steps: picks.length, peak: solve.maxBuffer, windows, detail, applied, picks, history };
}

function colorMaxAvail(A, game) {
  const level = A.parseLevel(A.fromGameFormat(game));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const picks = B.uniquePicks(solve);
  const colors = new Set();
  for (const row of game.spools) for (const cell of row) if (isCar(cell)) colors.add(cell.id);
  const max = {};
  colors.forEach(c => { max[c] = 0; });
  for (let s = 0; s <= picks.length; s++) {
    const base = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
    base.capture = true;
    for (let k = 0; k < s; k++) { base.capOps = []; A.Simulator.applyPick(base, picks[k].r, picks[k].c); }
    const moves = A.Simulator.listMoves(base).filter(m => !m.blocked);
    const stepSum = {};
    for (const m of moves) {
      const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
      st.capture = true;
      for (let k = 0; k < s; k++) { st.capOps = []; A.Simulator.applyPick(st, picks[k].r, picks[k].c); }
      st.capOps = [];
      if (!A.Simulator.applyPick(st, m.r, m.c)) continue;
      let eaten = 0;
      for (const op of st.capOps || []) if (op.t === 'eat') eaten += (op.cells ? op.cells.length : 0);
      stepSum[m.antBox.color] = (stepSum[m.antBox.color] || 0) + eaten;
    }
    Object.keys(stepSum).forEach(c => { if (stepSum[c] > max[c]) max[c] = stepSum[c]; });
  }
  return max;
}

function main() {
  const A = B.loadSolver();
  const base = B.readJson(SRC);
  const rand = rng(SEED);
  const cars = [];
  for (let r = 0; r < base.spools.length; r++) for (let c = 0; c < base.spools[r].length; c++) {
    if (isCar(base.spools[r][c])) cars.push([r, c]);
  }

  const maxAvail = colorMaxAvail(A, base);
  console.log('per-color max avail=', JSON.stringify(maxAvail));

  const eligible = (cand) => {
    const m = maxAvail[cand.color] || 0;
    if (!m) return false;
    const lo = 0.30 * m, hi = 0.80 * m;
    return cand.cap >= lo && cand.cap <= hi;
  };

  function groupsFor(sp) {
    return candidateGroups(sp).filter(eligible);
  }

  function evalState(state) {
    return evaluate(A, base, state.swaps, state.groups);
  }

  function randomStart() {
    const nSwaps = Math.floor(rand() * 3);
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
    const pool = groupsFor(swapped.spools);
    const groups = [];
    const usedCells = new Set(), usedColors = new Set();
    const shuffled = pool.slice().sort(() => rand() - 0.5);
    for (const cand of shuffled) {
      if (groups.length >= 3 + Math.floor(rand() * 2)) break;
      if (cand.cells.some(([r, c]) => usedCells.has(r + ',' + c))) continue;
      if (usedColors.has(cand.color)) continue;
      groups.push(cand);
      usedColors.add(cand.color);
      cand.cells.forEach(([r, c]) => usedCells.add(r + ',' + c));
    }
    return { swaps, groups };
  }

  // 把组整体上移：与第 1~2 行的等长连续车格交换载荷
  function moveGroupUp(swappedSp, groups, usedCells) {
    if (!groups.length) return null;
    const g = groups[Math.floor(rand() * groups.length)];
    const len = g.cells.length;
    const curRow = Math.min(...g.cells.map(c => c[0]));
    const targets = [];
    for (let r = 1; r < Math.min(3, curRow); r++) {
      for (let c = 0; c + len <= swappedSp[r].length; c++) {
        const cells = [];
        let ok = true;
        for (let k = 0; k < len; k++) {
          const cell = swappedSp[r][c + k];
          const key = r + ',' + (c + k);
          if (!isCar(cell) || usedCells.has(key)) { ok = false; break; }
          cells.push([r, c + k]);
        }
        if (ok) targets.push(cells);
      }
    }
    if (!targets.length) return null;
    const t = targets[Math.floor(rand() * targets.length)];
    const swaps = [];
    for (let k = 0; k < len; k++) swaps.push([g.cells[k], t[k]]);
    return { swaps, newCells: t };
  }

  function neighbor(state) {
    const next = { swaps: state.swaps.slice().filter(sw => sw[0].join(',') !== sw[1].join(',')) },
      groups = state.groups.slice();
    next.groups = groups;
    const kind = rand();
    const swappedNow = applySwaps(base, next.swaps);
    const occupied = new Set();
    next.groups.forEach(g => g.cells.forEach(([r, c]) => occupied.add(r + ',' + c)));
    if (kind < 0.30) {
      const mv = moveGroupUp(swappedNow.spools, next.groups, occupied);
      if (mv) {
        next.swaps = next.swaps.concat(mv.swaps);
        // 组位置同步到新格
        const gi = next.groups.findIndex(g => mv.swaps.some(sw => sw[0][0] === g.cells[0][0] && sw[0][1] === g.cells[0][1]));
        if (gi >= 0) next.groups[gi] = { ...next.groups[gi], cells: mv.newCells };
        return next;
      }
    }
    const swapped = applySwaps(base, next.swaps);
    const pool = groupsFor(swapped.spools);

    if (kind < 0.45 || pool.length === 0) {
      // 换一对车格：替换或新增/删除
      if (next.swaps.length && rand() < 0.5) {
        next.swaps[Math.floor(rand() * next.swaps.length)] = [cars[Math.floor(rand() * cars.length)], cars[Math.floor(rand() * cars.length)]];
      } else if (next.swaps.length < 3) {
        next.swaps.push([cars[Math.floor(rand() * cars.length)], cars[Math.floor(rand() * cars.length)]]);
      } else {
        next.swaps.splice(Math.floor(rand() * next.swaps.length), 1);
      }
      return next;
    }
    // 换组：替换一个 / 加一个 / 删一个
    const usedCells = new Set();
    next.groups.forEach(g => g.cells.forEach(([r, c]) => usedCells.add(r + ',' + c)));
    const free = pool.filter(c => !c.cells.some(([r, c]) => usedCells.has(r + ',' + c)));
    if (free.length === 0) return next;
    if (next.groups.length && rand() < 0.5) {
      const idx = Math.floor(rand() * next.groups.length);
      const others = next.groups.filter((_, i) => i !== idx);
      const colors = new Set(others.map(g => g.color));
      const pick = free.filter(c => !colors.has(c.color));
      if (pick.length) next.groups[idx] = pick[Math.floor(rand() * pick.length)];
    } else if (next.groups.length < 4) {
      const colors = new Set(next.groups.map(g => g.color));
      const pick = free.filter(c => !colors.has(c.color));
      if (pick.length) next.groups.push(pick[Math.floor(rand() * pick.length)]);
    } else {
      next.groups.splice(Math.floor(rand() * next.groups.length), 1);
    }
    return next;
  }

  let best = null;
  const restarts = Math.max(1, Math.floor(ITERS / 400));
  const perRestart = Math.floor(ITERS / restarts);
  for (let r = 0; r < restarts; r++) {
    let state = randomStart();
    let result = evalState(state);
    let cur = { state, result };
    console.log(`restart ${r + 1}/${restarts}: goal=${result.goal} windows=${result.windows.length} peak=${result.peak} steps=${result.steps}`);
    for (let it = 0; it < perRestart; it++) {
      const cand = neighbor(cur.state);
      let r2;
      try { r2 = evalState(cand); } catch (e) { continue; }
      if (!r2 || r2.goal === undefined) continue;
      const better = r2.goal < cur.result.goal || (r2.goal === cur.result.goal && r2.score > cur.result.score);
      const temp = 0.3 * (1 - it / perRestart);
      const accept = better || rand() < temp;
      if (accept) cur = { state: cand, result: r2 };
      if (!best || cur.result.goal < best.result.goal ||
        (cur.result.goal === best.result.goal && cur.result.score > best.result.score)) {
        best = { state: cur.state, result: cur.result };
      }
      if (cur.result.ok && (!best || best.result.goal !== 0)) break;
    }
    if (best && best.result.ok) break;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const payload = best ? {
    swaps: best.state.swaps.map(s => s.map(p => p.join(',')).join('-')),
    groups: best.state.groups.map(g => ({ color: g.color, cap: g.cap, cells: g.cells })),
    ok: best.result.ok, goal: best.result.goal, violations: best.result.violations,
    steps: best.result.steps, peak: best.result.peak,
    windows: best.result.windows, detail: best.result.detail, history: best.result.history
  } : null;
  fs.writeFileSync(path.join(OUT, 'board-search-v2.json'), JSON.stringify(payload, null, 2));
  if (WRITE && best && best.result.applied) {
    fs.writeFileSync(path.join(OUT, '关卡_实验_006_v30c.json'), JSON.stringify(best.result.applied, null, 2));
  }
  console.log('DONE ok=' + (best ? best.result.ok : 'none') + ' goal=' + (best ? best.result.goal : '-'));
  if (payload) {
    console.log('swaps=' + payload.swaps.join(' | '));
    console.log('groups=' + payload.groups.map(g => g.color + ':' + g.cells.map(c => c.join(',')).join('+')).join(' | '));
    console.log('violations=' + JSON.stringify(payload.violations));
    console.log('detail=' + JSON.stringify(payload.detail));
  }
}

main();
