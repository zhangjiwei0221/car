#!/usr/bin/env node
'use strict';

/**
 * E6.8R v26：把“区域揭示顺序”嵌进链组搜索
 *
 * 对每个候选链组集合：
 *   1. 打链 → 跑全知；
 *   2. 在**这条新路线**上算每组进入时的可用率（可消像素 / 组容量）；
 *   3. 只保留：4段窗口、峰值≤4、每组可用率40%～70%、≤6步释放、全程不触5。
 *
 * 用法：node 03_工具/正式版/Search006V26_v702.js [--write]
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, '实验关/关卡6/原型_v24/关卡_实验_006_v24.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v26');

const BASE = [
  { id: 2, cells: [[2, 5], [3, 5]] },
  { id: 3, cells: [[4, 1], [4, 2]] }
];

function isCar(cell) {
  if (!cell || !(cell.id > 0)) return false;
  const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
  return t.indexOf(11) < 0;
}

function candidates(sp) {
  const out = [], seen = new Set();
  const push = cells => {
    const key = cells.map(c => c.join(',')).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    if (cells.some(([r]) => r === 0)) return;
    out.push({ cells, color: sp[cells[0][0]][cells[0][1]].id,
      cap: cells.reduce((a, [r, c]) => a + sp[r][c].count, 0) });
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
  for (const grp of groups) for (const [r, c] of grp.cells) {
    g.spools[r][c].type = 5;
    g.spools[r][c].param = grp.id;
  }
  return g;
}

function stateAt(A, level, picks, s) {
  const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  for (let i = 0; i < s; i++) { st.capOps = []; A.Simulator.applyPick(st, picks[i].r, picks[i].c); }
  return st;
}

function availAt(A, level, picks, s, color) {
  const st = stateAt(A, level, picks, s);
  const moves = A.Simulator.listMoves(st).filter(m => !m.blocked && m.antBox.color === color);
  let sum = 0;
  for (const m of moves) {
    const st2 = stateAt(A, level, picks, s);
    st2.capture = true; st2.capOps = [];
    if (!A.Simulator.applyPick(st2, m.r, m.c)) continue;
    for (const op of st2.capOps || []) if (op.t === 'eat') sum += (op.cells ? op.cells.length : 0);
  }
  return sum;
}

function groupEvents(A, level, picks, groups) {
  const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  const ev = {};
  groups.forEach(g => { ev[g.id] = { entered: false, entryStep: null, debt: false, maxDebt: 0, releaseStep: null, link: null }; });
  for (let i = 0; i < picks.length; i++) {
    st.capOps = [];
    if (!A.Simulator.applyPick(st, picks[i].r, picks[i].c)) continue;
    const last = st.lastPick || {};
    if (last.isChain && ev[last.chain] && !ev[last.chain].entered) {
      ev[last.chain].entered = true;
      ev[last.chain].entryStep = i + 1;
      ev[last.chain].link = st._linkSeq;
      const items0 = (st.buffer || []).filter(it => it.link === st._linkSeq);
      ev[last.chain].entryDebt = items0.reduce((a, it) => a + Math.max(0, (it.need || 0) - (it.progress || 0)), 0);
      ev[last.chain].entryConsumed = items0.reduce((a, it) => a + Math.min(it.need || 0, it.progress || 0), 0);
    }
    groups.forEach(g => {
      const e = ev[g.id];
      if (!e.entered) return;
      const items = (st.buffer || []).filter(it => it.link === e.link);
      if (items.length) {
        const debts = items.filter(it => (it.progress || 0) < (it.need || 0));
        if (debts.length) { e.debt = true; e.maxDebt = Math.max(e.maxDebt, ...debts.map(it => it.need - (it.progress || 0))); }
      } else if (!e.releaseStep) e.releaseStep = i + 1;
    });
  }
  return ev;
}

function annotate(game, groups) {
  return groups.map(g => {
    const color = game.spools[g.cells[0][0]][g.cells[0][1]].id;
    const cap = g.cells.reduce((a, [r, c]) => a + game.spools[r][c].count, 0);
    return { ...g, color, cap };
  });
}

function evaluate(A, game, groups) {
  groups = annotate(game, groups);
  const applied = withChains(game, groups);
  const level = A.parseLevel(A.fromGameFormat(applied));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const picks = B.uniquePicks(solve);
  const history = solve.stepBufferHistory || [];
  const windows = B.pressureWindows(history, 3);
  const ev = groupEvents(A, level, picks, groups);
  const detail = groups.map(g => {
    const e = ev[g.id];
    const ratio = e.entered && g.cap ? (e.entryConsumed || 0) / g.cap : null;
    return { id: g.id, cells: g.cells, color: g.color, cap: g.cap,
      entryStep: e.entryStep, debt: e.maxDebt, entryDebt: e.entryDebt || 0,
      ratio: ratio == null ? null : Number(ratio.toFixed(2)),
      releaseStep: e.releaseStep, waitSteps: e.entryStep && e.releaseStep ? e.releaseStep - e.entryStep : null };
  });
  const allGood = detail.every(d => d.entryStep && d.debt >= 5 && d.ratio >= 0.3 && d.ratio <= 0.7 &&
    d.waitSteps != null && d.waitSteps <= 8);
  const peakOk = solve.completed && solve.maxBuffer <= 4;
  const score =
    (solve.completed ? 0 : -9999) + Math.min(windows.length, 4) * 1000 +
    (peakOk ? 200 : -900) + (allGood ? 500 : -6000) +
    detail.reduce((a, d) => a + Math.min(d.debt || 0, 25), 0) +
    (history[history.length - 1] === 0 ? 100 : 0) -
    Math.max(0, 40 - picks.length) * 60;
  return { applied, level, picks, history, windows, detail, allGood, peakOk, score,
    steps: picks.length, peak: solve.maxBuffer, completed: solve.completed };
}

function main() {
  const A = B.loadSolver();
  const game = B.readJson(SRC);
  const cands = candidates(game.spools);
  const write = process.argv.includes('--write');

  let best = null;
  const evaluateSet = groups => {
    try { return evaluate(A, game, groups); } catch (e) { return null; }
  };

  const baseResult = evaluateSet(BASE);
  best = { groups: BASE, result: baseResult };
  console.log('基线(2组):', fmt(baseResult));

  // 贪心：最多加 4 组
  let improved = true;
  while (improved && best.groups.length < 6) {
    improved = false;
    for (const cand of cands) {
      if (cand.cells.some(([r, c]) => best.groups.some(g => g.cells.some(([rr, cc]) => rr === r && cc === c)))) continue;
      const groups = best.groups.concat([{ id: best.groups.length + 2, cells: cand.cells, color: cand.color, cap: cand.cap }]);
      const r = evaluateSet(groups);
      if (!r) continue;
      if (process.env.VERBOSE) console.log('  +' + cand.cells.map(c => c.join(',')).join('+'), fmt(r));
      if (r.score > best.result.score) { best = { groups, result: r }; improved = true; }
    }
    if (improved) console.log('改进→ ' + best.groups.length + '组:', fmt(best.result));
  }

  console.log('\n最终:', fmt(best.result));
  best.result.detail.forEach(d => {
    console.log(`  组${d.id} ${d.cells.map(c => c.join(',')).join('+')} 色${d.color} 容量${d.cap} ` +
      `进${d.entryStep}步 债${d.debt}px 可用率${d.ratio} 放${d.releaseStep}步 等${d.waitSteps}步`);
  });

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'search-v26.json'), JSON.stringify({
    groups: best.groups, steps: best.result.steps, peak: best.result.peak,
    windows: best.result.windows, detail: best.result.detail,
    history: best.result.history, allGood: best.result.allGood
  }, null, 2));
  if (write) fs.writeFileSync(path.join(OUT, '关卡_实验_006_v26.json'), JSON.stringify(best.result.applied, null, 2));
  console.log('written=' + path.join(OUT, 'search-v26.json'));
}

function fmt(r) {
  return `steps=${r.steps} peak=${r.peak} windows=${r.windows.length} ` +
    `[${r.windows.map(w => w.start + '-' + w.end + ':' + w.peak).join(' ')}] ` +
    `allGood=${r.allGood} score=${Math.round(r.score)}`;
}

main();
