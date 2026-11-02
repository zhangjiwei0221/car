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
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let a4 = 0;
  for (const v of buf) if (v >= 4) a4++;
  const peak = Math.max(0, ...buf);
  return { midCanFill, fillRatio, a4, peak, won: !!o.completed, steps: buf.length };
}

let g = B.readJson(FILE);
let cur = evaluate(g);
const score = m => -m.midCanFill * 100 - m.fillRatio * 50 + m.a4;
console.log(`基线：中段可吃满 ${cur.midCanFill.toFixed(1)} 辆、可吃满率 ${(cur.fillRatio * 100).toFixed(0)}%、at4=${cur.a4}、峰值=${cur.peak}`);

let best = JSON.parse(JSON.stringify(g)), bestM = cur, bestS = score(cur);
for (let it = 1; it <= ITERS; it++) {
  const cand = JSON.parse(JSON.stringify(best));
  const rows = cand.spools.length, cols = cand.spools[0].length;
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (cand.spools[r][c] && cand.spools[r][c].id > 0) cells.push([r, c]);
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
  if (it % 40 === 0) console.log(`  ${it} 轮：中段可吃满 ${bestM.midCanFill.toFixed(1)} 辆、可吃满率 ${(bestM.fillRatio * 100).toFixed(0)}%、at4=${bestM.a4}`);
}
fs.writeFileSync(OUT, JSON.stringify(best));
console.log(`\n结果：中段可吃满 ${bestM.midCanFill.toFixed(1)} 辆、可吃满率 ${(bestM.fillRatio * 100).toFixed(0)}%、at4=${bestM.a4}、峰值=${bestM.peak}、可通=${bestM.won}`);
console.log('已写入', OUT);
