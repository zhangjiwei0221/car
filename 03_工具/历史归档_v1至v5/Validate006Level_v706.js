#!/usr/bin/env node
'use strict';
/**
 * 通用关卡验收：步数/峰值/窗口/链组事件/逐色守恒/往返/首行颜色。
 * 用法：node 03_工具/正式版/Validate006Level_v706.js <关卡.json>
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const file = process.argv[2];
if (!file) { console.error('用法: node Validate006Level_v706.js <level.json>'); process.exit(1); }

const _REF = (() => { const i = process.argv.indexOf('--ref'); return i > 0 ? process.argv[i + 1] : 'ring'; })();
const _MODE = (() => { const i = process.argv.indexOf('--mode'); return i > 0 ? process.argv[i + 1] : 'a'; })();
const _INSTANT = _MODE !== 'a';
const A = B.loadSolver(_REF);
const game = B.readJson(file);
const level = A.parseLevel(A.fromGameFormat(game));
const solve = _INSTANT
  ? A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 })
  : (A.Solver.solve(level, { timeBudgetMs: 20000 }) || {});
const picks = B.uniquePicks(solve);
const history = solve.stepBufferHistory || [];
const windows = B.pressureWindows(history, 3);

// 链组
const groups = {};
for (let r = 0; r < game.spools.length; r++) for (let c = 0; c < game.spools[r].length; c++) {
  const cell = game.spools[r][c];
  const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
  if (t.indexOf(5) >= 0 && t.indexOf(11) < 0) {
    const id = Array.isArray(cell.param) ? cell.param[0] : cell.param;
    (groups[id] = groups[id] || { id, cells: [] }).cells.push([r, c]);
  }
}
const gids = Object.keys(groups).map(Number).sort((a, b) => a - b);
const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: _INSTANT });
st.capture = true;
const ev = {};
gids.forEach(id => { ev[id] = { entry: null, link: null, debt: 0, release: null }; });
for (let i = 0; i < picks.length; i++) {
  st.capOps = [];
  if (!A.Simulator.applyPick(st, picks[i].r, picks[i].c)) continue;
  const last = st.lastPick || {};
  if (last.isChain && ev[last.chain] && ev[last.chain].entry == null) {
    ev[last.chain].entry = i + 1; ev[last.chain].link = st._linkSeq;
    const items = (st.buffer || []).filter(it => it.link === st._linkSeq);
    ev[last.chain].entryDebt = items.reduce((a, it) => a + Math.max(0, (it.need || 0) - (it.progress || 0)), 0);
    ev[last.chain].cap = items.reduce((a, it) => a + (it.need || 0), 0);
  }
  gids.forEach(id => {
    const e = ev[id];
    if (e.entry == null) return;
    const items = (st.buffer || []).filter(it => it.link === e.link);
    if (items.length) {
      const d = items.reduce((a, it) => a + Math.max(0, (it.need || 0) - (it.progress || 0)), 0);
      if (d > e.debt) e.debt = d;
    } else if (e.release == null) e.release = i + 1;
  });
}

// 逐色守恒
const perColor = {}, targetTotals = {};
for (const row of game.spools) for (const cell of row) {
  const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
  if (t.some(x => x >= 11 && x <= 14)) {
    for (const it of (Array.isArray(cell.param) ? cell.param : [])) if (it && it.id > 0) perColor[it.id] = (perColor[it.id] || 0) + it.count;
    continue;
  }
  if (cell.id > 0) perColor[cell.id] = (perColor[cell.id] || 0) + cell.count;
}
for (const row of game.blocks) for (const v of row) if (v > 0) targetTotals[v] = (targetTotals[v] || 0) + 1;
const mismatch = Object.keys(targetTotals).filter(k => perColor[k] !== targetTotals[k]);

// 往返
const rt = A.parseLevel(A.fromGameFormat(A.toGameFormat(level)));
const rtSolve = A.Solver.solveInstantChain(rt, { timeBudgetMs: 20000, greedyOnly: true });

console.log('file=' + file);
console.log('steps=' + picks.length + ' peak=' + solve.maxBuffer + ' completed=' + solve.completed);
console.log('windows=' + windows.length + ' [' + windows.map(w => w.start + '-' + w.end + ':' + w.peak).join(' ') + ']');
console.log('row0=' + game.spools[0].map(c => c.id + '/' + c.count).join(','));
gids.forEach(id => {
  const e = ev[id];
  console.log(`group${id} [${groups[id].cells.map(c => c.join(',')).join('+')}] entry=${e.entry} debt=${e.debt} cap=${e.cap || '-'} ratio=${e.cap ? (1 - e.debt / e.cap).toFixed(2) : '-'} release=${e.release} wait=${e.entry && e.release ? e.release - e.entry : '-'}`);
});
// 锁链组体检：组大小 ≤3 且正交相邻；否则判错（防止组ID串组）
const groupCells = {};
for (let r = 0; r < game.spools.length; r++) for (let c = 0; c < game.spools[r].length; c++) {
  const cell = game.spools[r][c];
  const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
  if (t.indexOf(5) < 0) continue;
  const pp = cell.param;
  const cid = Array.isArray(pp) ? pp[t.indexOf(5)] : pp;
  (groupCells[cid] = groupCells[cid] || []).push([r, c]);
}
let chainProblem = false;
Object.keys(groupCells).forEach(cid => {
  const cells = groupCells[cid];
  if (cells.length > 3) { chainProblem = true; console.log('CHAIN-BUG: 组' + cid + ' 有 ' + cells.length + ' 格（上限3）' + JSON.stringify(cells)); }
  // 相邻性：每格至少与组内另一格正交相邻
  const adj = cells.every(([r, c]) => cells.some(([r2, c2]) => (Math.abs(r - r2) + Math.abs(c - c2)) === 1));
  if (!adj) { chainProblem = true; console.log('CHAIN-BUG: 组' + cid + ' 存在不相邻格' + JSON.stringify(cells)); }
});
console.log('chainGroups=' + JSON.stringify(Object.keys(groupCells).map(k => k + ':' + groupCells[k].length)) + (chainProblem ? ' ✗' : ' ok'));
console.log('capacity: mismatch=' + (mismatch.length ? mismatch.join(',') : 'none') + ' sum=' + Object.values(perColor).reduce((a, b) => a + b, 0));
console.log('roundtrip=' + (rtSolve.completed ? 'ok' : 'fail'));
if (process.argv.includes('--audit')) {
  const total = picks.length;
  const samples = history.map((buf, i) => ({ done: i + 1, buf }));
  const audit = A.Analysis && A.Analysis.chokepointAudit ? A.Analysis.chokepointAudit(samples, total, game.bufferLimit || 5) : null;
  if (audit) {
    console.log('audit: pass=' + audit.pass + ' hasChoke=' + audit.hasChoke +
      ' earlyMax=' + (audit.earlyMax || 0).toFixed(2) + '/' + audit.earlyCap +
      ' lateMax=' + (audit.lateMax || 0).toFixed(2) + ' high=' + audit.high +
      ' peak=' + audit.peakBuf + ' reasons=' + JSON.stringify(audit.reasons));
  } else {
    console.log('audit: Analysis.chokepointAudit 不可用');
  }
}
if (process.argv.includes('--timeline')) {
  console.log('timeline:');
  picks.forEach((p, i) => {
    console.log('  ' + String(i + 1).padStart(2) + ' buf=' + history[i] + ' pick=(' + p.r + ',' + p.c + ') ' + p.color + '/' + p.count);
  });
}
