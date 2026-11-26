#!/usr/bin/env node
'use strict';
/**
 * 交叠修复器 v718
 * 目标：给“债务句之间的空窗”找一句过渡句（链/冰），让压力不断档。
 *
 * 流程：
 *   1) 跑全知（不用道具），切句，找最大的空窗；
 *   2) 枚举候选：空窗内相邻对成链、空窗车与晚解锁车成链、空窗释放车加冰；
 *   3) 逐个验证：空窗是否缩小、at4 是否保住、是否可解、峰值是否≤4、CLI 是否通关；
 *   4) 输出排名 + 最佳候选写到 --out。
 *
 * 用法：
 *   node GapRepair_v718.js <关卡.json> [--out 结果.json] [--max 60] [--save]
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith('--'));
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg('--out', '');
const MAXEVAL = Number(arg('--max', 60));
const SAVE = argv.includes('--save');
if (!file) { console.error('用法: node GapRepair_v718.js <关卡.json> [--out x.json] [--max 60] [--save]'); process.exit(1); }

const base = B.readJson(file);

function solveNoItem(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let run4 = 0, cur = 0, at4 = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, buf, picks: o.pickOrder || [], itemUses: o.itemUses || 0 };
}
function cliOK(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.solveInstantChain(lv);
  return !!(o && o.completed);
}
function gapsOf(buf) {
  const cls = buf.map(v => v >= 4 ? 'H' : v >= 2 ? 'M' : 'L');
  const beats = []; let i = 0;
  while (i < buf.length) { let j = i; while (j + 1 < buf.length && cls[j + 1] === cls[i]) j++; beats.push({ k: cls[i], from: i + 1, to: j + 1 }); i = j + 1; }
  const gaps = [];
  for (let k = 0; k < beats.length; k++) {
    if (beats[k].k !== 'H') continue;
    let m = k + 1; while (m < beats.length && beats[m].k !== 'H') m++;
    if (m >= beats.length) break;
    // 空窗 = 两次债务句之间“压力 <3”的连续步数（含中压2）
    let low = 0;
    for (let s2 = beats[k].to + 1; s2 <= beats[m].from - 1; s2++) if (buf[s2 - 1] < 3) low++;
    if (low >= 2) gaps.push({ from: beats[k].to + 1, to: beats[m].from - 1, len: low, a: `${beats[k].from}-${beats[k].to}`, b: `${beats[m].from}-${beats[m].to}` });
  }
  return gaps;
}
// 每辆车的解锁步
function unlockTable(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
  const picks = o.pickOrder || [];
  const rows = [];
  for (let s = 0; s < picks.length; s++) {
    const st = A.Simulator.createState(lv, { useSlotStart: true, instantChain: true }); st.capture = true;
    for (let i = 0; i < s; i++) { st.capOps = []; A.Simulator.applyPick(st, picks[i].r, picks[i].c); }
    const av = {};
    for (const m of A.Simulator.listMoves(st).filter(x => !x.blocked)) {
      const p = A.Simulator.createState(lv, { useSlotStart: true, instantChain: true }); p.capture = true;
      for (let i = 0; i < s; i++) { p.capOps = []; A.Simulator.applyPick(p, picks[i].r, picks[i].c); }
      p.capOps = [];
      if (!A.Simulator.applyPick(p, m.r, m.c)) continue;
      const items = (p.buffer || []).filter(it => (it.progress || 0) < (it.need || 0));
      const eaten = (m.antBox.count || 0) - items.reduce((a, it) => a + (it.need - (it.progress || 0)), 0);
      av[m.antBox.color] = Math.max(av[m.antBox.color] || 0, eaten);
    }
    rows.push(av);
  }
  const table = {};
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const cell = g.spools[r][c]; if (!(cell.id > 0)) continue;
    const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
    if (t.some(x => x >= 11 && x <= 14)) continue;
    for (let s = 0; s < rows.length; s++) if ((rows[s][cell.id] || 0) >= cell.count) { table[r + ',' + c] = s + 1; break; }
  }
  return table;
}
const isPlain = (cell) => { const t = cell && (Array.isArray(cell.type) ? cell.type : [cell.type || 0]); return cell && cell.id > 0 && t.every(x => x === 0 || x === null); };

const b0 = solveNoItem(base);
const gaps0 = gapsOf(b0.buf);
console.log(`基线：${b0.buf.length} 步 / 峰值 ${b0.peak} / at4 ${b0.at4} / run4 ${b0.run4} / 空窗 ${gaps0.length} 处`);
gaps0.forEach(g => console.log(`  空窗 ${g.from}-${g.to}（${g.len} 步，在 ${g.a} 与 ${g.b} 之间）`));
if (!gaps0.length) { console.log('没有空窗，无需修复'); process.exit(0); }
const target = gaps0.sort((x, y) => y.len - x.len)[0];
console.log(`\n主攻空窗：${target.from}-${target.to}（${target.len} 步）`);

const unlock = unlockTable(base);
const inGap = (r, c) => {
  const i = b0.picks.findIndex(p => p.r === r && p.c === c);
  return i >= 0 && i + 1 >= target.from && i + 1 <= target.to;
};
const R = base.spools.length, C = base.spools[0].length;
const cands = [];
// A) 空窗内相邻对成链
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  if (!isPlain(base.spools[r][c])) continue;
  for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const nr = r + dr, nc = c + dc;
    if (nr >= R || nc >= C || !isPlain(base.spools[nr][nc])) continue;
    if (!inGap(r, c) && !inGap(nr, nc)) continue;
    cands.push({ kind: 'chain', cells: [[r, c], [nr, nc]], why: `空窗内成链 ${r},${c}+${nr},${nc}` });
  }
}
// B) 空窗车 × 晚解锁邻居
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  if (!inGap(r, c) || !isPlain(base.spools[r][c])) continue;
  for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nc < 0 || nr >= R || nc >= C || !isPlain(base.spools[nr][nc])) continue;
    const u = unlock[nr + ',' + nc];
    if (u && u >= target.to + 2) cands.push({ kind: 'chain', cells: [[r, c], [nr, nc]], why: `空窗车 ${r},${c} 绑晚解锁(${u}) ${nr},${nc}` });
  }
}
// B2) 全盘相邻对（不限空窗）：链组的入场可能落在空窗里
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  if (!isPlain(base.spools[r][c])) continue;
  for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const nr = r + dr, nc = c + dc;
    if (nr >= R || nc >= C || !isPlain(base.spools[nr][nc])) continue;
    if (inGap(r, c) && inGap(nr, nc)) continue; // 已在上面的 A 类
    cands.push({ kind: 'chain', cells: [[r, c], [nr, nc]], why: `相邻对 ${r},${c}+${nr},${nc}` });
  }
}
// C) 空窗释放车加冰（推迟解冻到空窗结束）
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  if (!inGap(r, c)) continue;
  const cell = base.spools[r][c];
  const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
  if (t.includes(7)) continue;
  cands.push({ kind: 'ice', cells: [[r, c]], param: target.to + 2, why: `空窗车 ${r},${c} 加冰到第 ${target.to + 2} 球` });
}

function apply(g, cand) {
  const h = JSON.parse(JSON.stringify(g));
  if (cand.kind === 'chain') {
    for (const [r, c] of cand.cells) {
      const cell = h.spools[r][c];
      const t = cell.type; const ts = Array.isArray(t) ? t : [t];
      if (!ts.every(x => x === 0 || x === null)) return null;
      const ps = Array.isArray(cell.param) ? cell.param : [cell.param];
      cell.type = ts.filter(x => x !== 0).concat([5]);
      cell.param = ps.filter((_, i) => (ts[i] !== 0)).concat([777]);
    }
  } else {
    const [r, c] = cand.cells[0];
    const cell = h.spools[r][c];
    const t = cell.type; const ts = Array.isArray(t) ? t : [t];
    const ps = Array.isArray(cell.param) ? cell.param : [cell.param];
    cell.type = ts.concat([7]); cell.param = ps.concat([cand.param]);
  }
  return h;
}

const results = [];
let evaluated = 0;
for (const cand of cands) {
  if (evaluated >= MAXEVAL) break;
  const h = apply(base, cand); if (!h) continue;
  evaluated++;
  let r1; try { r1 = solveNoItem(h); } catch (e) { continue; }
  if (!r1.won || r1.peak > 4) continue;
  if (r1.at4 < b0.at4 - 3) continue;
  const gaps1 = gapsOf(r1.buf);
  const main = gaps1.find(g => g.len >= 2);
  const maxGap = gaps1.length ? Math.max(...gaps1.map(g => g.len)) : 0;
  const ok = cliOK(h);
  results.push({ cand, at4: r1.at4, run4: r1.run4, gaps: maxGap, gapCount: gaps1.length, cli: ok, level: h });
}
results.sort((a, b) => (a.gaps - b.gaps) || (b.at4 - a.at4));
console.log(`\n评估 ${evaluated} 个候选，通过筛选 ${results.length} 个`);
results.slice(0, 10).forEach((r, i) => {
  console.log(`${i + 1}. ${r.cand.why}  → 空窗 ${r.gaps} 步（原 ${target.len}）/ at4 ${r.at4} / run4 ${r.run4} / CLI ${r.cli ? '✅' : '❌'}`);
});
const best = results.find(r => r.cli);
if (best && OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(best.level, null, 2));
  console.log(`\n最佳候选已写入：${OUT}`);
}
if (!results.length) console.log('\n没有候选能缩小空窗——按“补一句过渡句”的方向，需要换车或改容量。');
