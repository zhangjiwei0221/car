'use strict';
// 逐色守恒（管道感知版）：普通车按 id/count 计；管道 type 11–14 按 param[{id,count}] 计入队列色。
// 用法: node 守恒_含管道_v1.js <关卡.json> [out.json]
const fs = require('fs');
const g = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const px = {}; let bg = 0;
for (const row of g.blocks) for (const v of row) { if (!v) { bg++; continue; } px[v] = (px[v] || 0) + 1; }
const car = {};
const tl = (s) => { const t = s && s.type != null ? s.type : 0; return Array.isArray(t) ? t : [t]; };
for (const row of g.spools) for (const s of row) {
  if (!s || s.id === -1) continue;
  if (tl(s).some(v => v >= 11 && v <= 14)) {
    for (const b of (Array.isArray(s.param) ? s.param : [])) car[b.id] = (car[b.id] || 0) + (b.count || 0);
  } else if (s.id > 0) car[s.id] = (car[s.id] || 0) + s.count;
}
const colors = [...new Set([...Object.keys(px), ...Object.keys(car)])].map(Number).sort((a, b) => a - b);
const rows = colors.map(c => ({ color: c, pixels: px[c] || 0, carSum: car[c] || 0, ok: (px[c] || 0) === (car[c] || 0) }));
const pxTotal = rows.reduce((s, r) => s + r.pixels, 0), carTotal = rows.reduce((s, r) => s + r.carSum, 0);
const out = { file: process.argv[2].split('/').pop(), bgPixels: bg, pxTotal, carTotal, ok: pxTotal === carTotal && rows.every(r => r.ok), colors: rows };
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ok: out.ok, pxTotal, carTotal, colors: rows.length, bad: rows.filter(r => !r.ok) }));
