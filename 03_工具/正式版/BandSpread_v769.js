#!/usr/bin/env node
'use strict';
/**
 * BandSpread_v769 —— 按「颜色在画面的上下位置」分配车数/容量（不改图）
 *
 * 思路（用户 C 方案）：
 *   靠上的颜色 → 合并成大车（顶部打开前填不满 → 后期才可能完成）
 *   靠下的颜色 → 拆成小车（开局好填、格子多）
 * 守恒：每色容量和不变；格子数不变。
 *
 * 用法：node BandSpread_v769.js <关卡.json> --out 结果.json [--cap-min 14] [--cap-max 60]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--cap-min', '--cap-max'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/band.json');
const CAP_MIN = Number(arg('--cap-min', 14));
const CAP_MAX = Number(arg('--cap-max', 60));

const g = B.readJson(FILE);
const rows = g.spools.length, cols = g.spools[0].length;
const H = g.blocks.length, W = g.blocks[0].length;

// 1) 每个颜色的"重心高度"（0=底 1=顶）
const sum = {}, tot = {};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const c = g.blocks[y][x];
  sum[c] = (sum[c] || 0) + (1 - y / (H - 1));
  tot[c] = (tot[c] || 0) + 1;
}
const centroid = c => (sum[c] || 0) / (tot[c] || 1);

// 2) 收集每色的车
const byColor = {};
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const s = g.spools[r][c];
  if (!s || !(s.id > 0)) continue;
  const t = Array.isArray(s.type) ? s.type : [s.type || 0];
  if (t.includes(5) || t.includes(7)) continue;   // 锁链/冰不动
  (byColor[s.id] = byColor[s.id] || []).push({ r, c, s });
}

// 3) 高色阶 → 合并；低色阶 → 拆分
const top = [], bottom = [];
for (const id of Object.keys(byColor).map(Number)) (centroid(id) >= 0.5 ? top : bottom).push(id);
const freed = [];
let merged = 0, split = 0;
for (const id of top) {
  const cars = byColor[id].sort((a, b) => a.s.count - b.s.count);
  for (let i = 0; i + 1 < cars.length; i += 2) {
    if (cars[i].s.count + cars[i + 1].s.count > CAP_MAX) continue;
    cars[i].s.count += cars[i + 1].s.count;
    freed.push({ r: cars[i + 1].r, c: cars[i + 1].c });
    merged++;
  }
}
for (const slot of freed) {
  let best = null;
  for (const id of bottom) for (const cd of byColor[id]) {
    if (cd.s.count < CAP_MIN * 2) continue;
    if (!best || cd.s.count < best.s.count) best = cd;
  }
  if (!best) break;
  const half = Math.floor(best.s.count / 2);
  best.s.count -= half;
  g.spools[slot.r][slot.c] = { id: best.s.id, type: 0, param: 0, count: half };
  split++;
}
fs.writeFileSync(OUT, JSON.stringify(g));
const caps = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const s = g.spools[r][c]; if (s && s.id > 0) caps.push(s.count); }
caps.sort((a, b) => a - b);
console.log(`靠上颜色合并 ${merged} 对、靠下颜色拆出 ${split} 辆 → 容量 ${caps[0]}~${caps[caps.length - 1]}（中位 ${caps[Math.floor(caps.length / 2)]}）合计 ${caps.reduce((a, b) => a + b, 0)}`);
console.log('已写入', OUT);
