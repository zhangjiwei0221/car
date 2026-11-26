#!/usr/bin/env node
'use strict';

/**
 * 故事线复盘 v1（只读）：把“免费车是被谁解锁的”摊开
 *
 * 输出三段：
 *  1) 全知路线上的窗口（buffer≥3）与每个窗口起点的可点选项（免费/欠债）；
 *  2) 每种颜色的可用像素随步数变化，以及“跳变步”——即哪一步让某色变可用；
 *  3) 每个免费步：它依赖哪一色、该色最近一次跳变发生在第几步（=解锁车）。
 *
 * 用法：node 03_工具/正式版/StoryReview006_v712.js <level.json> [--out x.md]
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const file = process.argv[2];
if (!file) { console.error('用法: StoryReview006_v712.js <level.json> [--out x.md]'); process.exit(1); }
const oi = process.argv.indexOf('--out');
const outFile = oi >= 0 ? process.argv[oi + 1] : path.join(path.dirname(file), '故事线复盘.md');

const A = B.loadSolver();
const game = B.readJson(file);
const level = A.parseLevel(A.fromGameFormat(game));
const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
const picks = B.uniquePicks(solve);
const history = solve.stepBufferHistory || [];

function stateAt(s) {
  const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  for (let i = 0; i < s; i++) { st.capOps = []; A.Simulator.applyPick(st, picks[i].r, picks[i].c); }
  return st;
}

/** 当前步每色“最好一辆车能吃多少” */
function colorAvail(st) {
  const moves = A.Simulator.listMoves(st).filter(m => !m.blocked);
  const out = {};
  for (const m of moves) {
    const st2 = stateAt(st.__s);
    st2.capOps = [];
    if (!A.Simulator.applyPick(st2, m.r, m.c)) continue;
    const items = (st2.buffer || []).filter(it => (it.progress || 0) < (it.need || 0));
    const eaten = (m.antBox.count || 0) - items.reduce((a, it) => a + (it.need - (it.progress || 0)), 0);
    out[m.antBox.color] = Math.max(out[m.antBox.color] || 0, eaten);
  }
  return out;
}

const avails = [];
const freeList = [];
for (let s = 0; s <= picks.length; s++) {
  const st = stateAt(s);
  st.__s = s;
  const moves = A.Simulator.listMoves(st).filter(m => !m.blocked);
  const av = {};
  const details = [];
  for (const m of moves) {
    const st2 = stateAt(s);
    st2.capOps = [];
    if (!A.Simulator.applyPick(st2, m.r, m.c)) continue;
    const items = (st2.buffer || []).filter(it => (it.progress || 0) < (it.need || 0));
    const debt = items.reduce((a, it) => a + (it.need - (it.progress || 0)), 0);
    const eaten = (m.antBox.count || 0) - debt;
    av[m.antBox.color] = Math.max(av[m.antBox.color] || 0, eaten);
    details.push({ r: m.r, c: m.c, color: m.antBox.color, cap: m.antBox.count, eaten, debt });
  }
  avails.push({ step: s + 1, av, details, pickable: moves.length,
    free: details.filter(d => d.debt === 0).length });
  if (s < picks.length) {
    const p = picks[s];
    const d = details.find(x => x.r === p.r && x.c === p.c);
    if (d && d.debt === 0) freeList.push({ step: s + 1, ...d });
  }
}

// 颜色跳变：某色可用像素比上一步明显增加（≥该色任一车容量的一半）
const jumps = {};
for (let s = 1; s < avails.length; s++) {
  for (const c of Object.keys(avails[s].av)) {
    const prev = avails[s - 1].av[c] || 0;
    const cur = avails[s].av[c];
    if (cur - prev >= 10) (jumps[c] = jumps[c] || []).push({ step: avails[s].step, from: prev, to: cur });
  }
}

const windows = B.pressureWindows(history, 3);
const lines = [];
lines.push('# 006 故事线复盘 · ' + path.basename(file));
lines.push('');
lines.push('全知 ' + picks.length + ' 步 / 峰值 ' + solve.maxBuffer + ' / 窗口 ' + windows.length +
  '（' + (windows.map(w => w.start + '~' + w.end + ':' + w.peak).join('、') || '无') + '）');
lines.push('');
lines.push('## 1. 窗口起点的选择面');
lines.push('');
lines.push('| 窗口 | 起点可点 | 免费车 | 欠债车 | 各色可用 |');
lines.push('|---|---:|---:|---:|---|');
for (const w of windows) {
  const a = avails[w.start - 1];
  lines.push('| ' + w.start + '~' + w.end + '（峰' + w.peak + '） | ' + a.pickable + ' | ' + a.free + ' | ' +
    (a.pickable - a.free) + ' | ' + Object.keys(a.av).sort((x, y) => x - y).map(c => c + ':' + a.av[c]).join(' ') + ' |');
}
lines.push('');
lines.push('## 2. 颜色跳变（哪一步让某色变可用）');
lines.push('');
for (const c of Object.keys(jumps).sort((a, b) => a - b)) {
  lines.push('- 色 ' + c + '：' + jumps[c].map(j => '第' + j.step + '步 ' + j.from + '→' + j.to).join('，'));
}
lines.push('');
lines.push('## 3. 免费步与它的解锁步');
lines.push('');
lines.push('| 免费步 | 车 | 色 | 该色最近跳变步（解锁） |');
lines.push('|---:|---|---:|---|');
for (const f of freeList) {
  const js = (jumps[f.color] || []).filter(j => j.step <= f.step);
  const last = js.length ? js[js.length - 1] : null;
  lines.push('| ' + f.step + ' | (' + f.r + ',' + f.c + ') ' + f.cap + ' | ' + f.color + ' | ' +
    (last ? '第' + last.step + '步（' + last.from + '→' + last.to + '）' : '开局即够') + ' |');
}
lines.push('');
// 钥匙车排行：每个跳变步的 pick 解锁了多少个免费步
const keyMap = {};
freeList.forEach(f => {
  const js = (jumps[f.color] || []).filter(j => j.step <= f.step);
  if (!js.length) return;
  const j = js[js.length - 1];
  const k = j.step;
  keyMap[k] = keyMap[k] || { step: k, color: f.color, from: j.from, to: j.to, frees: [] };
  keyMap[k].frees.push(f.step);
});
lines.push('## 4. 钥匙车排行（锁住它，就能锁住后面一串免费步）');
lines.push('');
lines.push('| 解锁步 | 该步取的车 | 解锁色 | 可用跳变 | 解锁的免费步 | 数量 |');
lines.push('|---:|---|---:|---|---|---:|');
Object.values(keyMap).sort((a, b) => b.frees.length - a.frees.length).forEach(k => {
  const pk = picks[k.step - 1];
  lines.push('| ' + k.step + ' | (' + pk.r + ',' + pk.c + ') ' + pk.color + '/' + pk.count + ' | ' + k.color +
    ' | ' + k.from + '→' + k.to + ' | ' + k.frees.join('、') + ' | ' + k.frees.length + ' |');
});
lines.push('');
lines.push('## 5. 结论');
lines.push('');
const freeAtOpen = avails[0].free;
lines.push('- 开局 ' + avails[0].pickable + ' 辆可点、' + freeAtOpen + ' 辆免费；');
lines.push('- 全知路线免费步 ' + freeList.length + ' 个，占 ' + (100 * freeList.length / picks.length).toFixed(0) + '%；');
lines.push('- 每个免费步都对应某色的一次“跳变”——跳变越集中，免费车越成串。');

fs.writeFileSync(outFile, lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log('\nwritten=' + outFile);
