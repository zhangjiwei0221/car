#!/usr/bin/env node
'use strict';
/**
 * FeelBuild_v766 —— 以「玩家感受」为目标的构建器
 *
 * 目标：让"眼前能一口吃满的车"尽可能少（玩家被迫吃不满 → 有压力）
 * 主指标：midCanFill（中段 45%~55% 区间，平均能吃满的车数）
 * 次指标：fillRatio（全程可吃满率）、at4
 *
 * 动作：两辆车交换棋盘位置（颜色/容量不变，只改几何）
 * 用法：node FeelBuild_v766.js <关卡.json> --out 结果.json --iters 200 [--ref corner]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--iters', '--ref'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/feelbuild.json');
const ITERS = Number(arg('--iters', 200));
const REF = String(arg('--ref', 'corner'));
const A = B.loadSolver(REF);

function evaluate(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const H = g.blocks.length, W = g.blocks[0].length;
  const col = g.blocks.map(r => r.slice());
  const gone = g.blocks.map(r => r.map(() => false));
  const rows = g.spools.length, cols = g.spools[0].length;
  const reach = (y, x) => (y === 0 || x === 0 || y === H - 1 || x === W - 1) ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const per = [];
  const taken = new Set();
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || !reach(y, x)) continue;
      const c = col[y][x]; cnt[c] = (cnt[c] || 0) + 1;
    }
    let avail = 0, canFill = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c)) continue;
      avail++;
      if ((cnt[s.id] || 0) >= s.count) canFill++;
    }
    per.push({ avail, canFill, ratio: avail ? canFill / avail : 0 });
    const c = p.color;
    const list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || col[y][x] !== c || !reach(y, x)) continue;
      list.push([(H - 1 - y) + x, y, x]);
    }
    list.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
  }
  const N = per.length || 1;
  const mid = per.slice(Math.floor(N * 0.45), Math.floor(N * 0.55));
  const midCanFill = mid.reduce((s, x) => s + x.canFill, 0) / (mid.length || 1);
  const fillRatio = per.reduce((s, x) => s + x.ratio, 0) / N;
  // 【2026-11-02】被迫欠债步数：这一步没有任何一辆车能一口吃满 → 玩家只能吃不满
  const forcedZero = per.filter(x => x.canFill === 0).length;
  const forcedRatio = forcedZero / N;
  // 后段（80%–100%）被迫欠债步数 —— 契约最看重这一段
  const tail = per.slice(Math.floor(N * 0.8));
  const forcedTail = tail.filter(x => x.canFill === 0).length;
  const early = per.slice(0, Math.max(1, Math.floor(N * 0.2)));
  const earlyForced = early.filter(x => x.canFill === 0).length;
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let a4 = 0, r4 = 0, cur4 = 0;
  for (const v of buf) { if (v >= 4) { a4++; cur4++; r4 = Math.max(r4, cur4); } else cur4 = 0; }
  const peak = Math.max(0, ...buf);
  const earlyN = Math.max(1, Math.floor(buf.length * 0.2));
  const early4 = buf.slice(0, earlyN).filter(v => v >= 4).length;
  const tailN = Math.floor(buf.length * 0.8);
  const tail3 = buf.slice(tailN).filter(v => v >= 3).length;
  return { midCanFill, fillRatio, forcedZero, forcedRatio, forcedTail, earlyForced, a4, r4, early4, tail3, peak, won: !!o.completed, steps: buf.length };
}

let g = B.readJson(FILE);
let cur = evaluate(g);
// 主目标：被迫欠债比例（越高越好）；次：可吃满率（越低越好）；再次：at4
// 【2026-11-02 用户定稿】目标改成 at4/run4（全知路线）：高压步数要多、要连续，且前 20% 不许压
const score = m => m.a4 * 10 + m.r4 * 30 - m.early4 * 200 + m.tail3 * 5;
console.log(`基线：被迫欠债 ${cur.forcedZero} 步(${(cur.forcedRatio * 100).toFixed(0)}%)、可吃满率 ${(cur.fillRatio * 100).toFixed(0)}%、at4=${cur.a4}、峰值=${cur.peak}`);

let best = JSON.parse(JSON.stringify(g)), bestM = cur, bestS = score(cur);
for (let it = 1; it <= ITERS; it++) {
  const cand = JSON.parse(JSON.stringify(best));
  const rows = cand.spools.length, cols = cand.spools[0].length;
  // 【修复】只允许交换"普通车"：锁链组(type 5)与冰(type 7)都不能移动，
  // 否则锁链会被拆散到棋盘各处（用户 2026-11-02 实测发现）。
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = cand.spools[r][c];
    if (!s || !(s.id > 0)) continue;
    const t = Array.isArray(s.type) ? s.type : [s.type || 0];
    if (t.includes(5) || t.includes(7)) continue;   // 锁链 / 冰 → 不动
    cells.push([r, c]);
  }
  if (cells.length < 2) break;
  const i = Math.floor(Math.random() * cells.length);
  let j = Math.floor(Math.random() * cells.length);
  if (i === j) j = (j + 1) % cells.length;
  const [r1, c1] = cells[i], [r2, c2] = cells[j];
  const t = cand.spools[r1][c1]; cand.spools[r1][c1] = cand.spools[r2][c2]; cand.spools[r2][c2] = t;
  const m = evaluate(cand);
  if (!m.won || m.peak > 4) continue;
  const s = score(m);
  if (s > bestS) { bestS = s; bestM = m; best = cand; }
  if (it % 40 === 0) console.log(`  ${it} 轮：at4=${bestM.a4} run4=${bestM.r4} 前段at4=${bestM.early4} 后段at3=${bestM.tail3}`);
}
fs.writeFileSync(OUT, JSON.stringify(best));
console.log(`\n结果：at4=${bestM.a4} run4=${bestM.r4} 前段at4=${bestM.early4} 后段at3=${bestM.tail3} 峰值=${bestM.peak} 可通=${bestM.won}`);
console.log('已写入', OUT);
