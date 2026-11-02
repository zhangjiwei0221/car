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

function donor(bottomIds) {
  let best = null;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    if (!s || !(s.id > 0)) continue;
    if (!bottomIds.includes(s.id)) continue;
    if (s.count < CAP_MIN * 2) continue;
    const t = Array.isArray(s.type) ? s.type : [s.type || 0];
    if (t.includes(5) || t.includes(7)) continue;
    if (!best || s.count > best.s.count) best = { r, c, s };
  }
  return best;
}

// 合并一对，并立刻把腾出的格子用"靠下颜色"拆一辆填上；填不上就回滚
for (const id of top) {
  const cars = byColor[id].sort((a, b) => a.s.count - b.s.count);
  for (let i = 0; i + 1 < cars.length; i += 2) {
    const a = cars[i], b = cars[i + 1];
    if (!a.s || !b.s || a.s.count + b.s.count > CAP_MAX) continue;
    const oldA = a.s.count, oldB = b.s.count;
    a.s.count = oldA + oldB;
    b.s.count = 0;                       // 先清零，避免重复计数
    const d = donor(bottom);
    if (!d) { a.s.count = oldA; b.s.count = oldB; continue; }   // 没人可拆 → 回滚
    const half = Math.floor(d.s.count / 2);
    d.s.count -= half;
    g.spools[b.r][b.c] = { id: d.s.id, type: 0, param: 0, count: half };
    merged++; split++;
  }
}

fs.writeFileSync(OUT, JSON.stringify(g));
const caps = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const s = g.spools[r][c]; if (s && s.id > 0) caps.push(s.count); }
caps.sort((a, b) => a - b);
console.log(`靠上颜色合并 ${merged} 对、靠下颜色拆出 ${split} 辆 → 容量 ${caps[0]}~${caps[caps.length - 1]}（中位 ${caps[Math.floor(caps.length / 2)]}）合计 ${caps.reduce((a, b) => a + b, 0)}`);
console.log('已写入', OUT);
