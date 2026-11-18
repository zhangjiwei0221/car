#!/usr/bin/env node
'use strict';
/**
 * build_variant_multi_89741.js —— build_variant.js 的多壳版（N 车队列 → 1 功能管道 + N−1 空壳）。
 * 由 实验关/产线v6/管道试点/build_variant.js 复制而来，唯一改动：`shell` → `shells` 数组。
 * 用法:
 *   node build_variant_multi_89741.js <源关卡.json> <输出.json> <config.json>
 *
 * config.json:
 *   {
 *     "name": "C1",
 *     "pipe":  {"r":0,"c":2,"type":12,"queue":[{"id":19,"count":54},{"id":3,"count":44},{"id":34,"count":45}]},
 *     "shells": [{"r":1,"c":0,"type":11},{"r":0,"c":6,"type":13}], // 空队列管道壳（占位，保满盘）
 *     "movedFrom": [[0,2],[1,0],[0,6]]           // 被移走的车原位（逐格校验 id/count 与队列一致）
 *   }
 *
 * 校验：逐色容量守恒（含队列）、无空格、被移走格与新管道/壳一一对应。
 */
const fs = require('fs');

const src = process.argv[2], out = process.argv[3], cfgFile = process.argv[4];
if (!src || !out || !cfgFile) { console.error('用法: build_variant_multi_89741.js <源> <输出> <config>'); process.exit(2); }
const game = JSON.parse(fs.readFileSync(src, 'utf8'));
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const rows = game.maprow, cols = game.mapcol;
const sp = game.spools.map(r => r.map(s => ({ ...s })));

// 记录被移走的车（按 movedFrom 顺序 = 队列顺序）
const queue = cfg.pipe.queue || [];
const moved = cfg.movedFrom.map(([r, c]) => {
  const s = sp[r][c];
  return { r, c, id: s.id, count: s.count, type: s.type };
});
if (moved.length !== queue.length) throw new Error('movedFrom 与队列长度不一致');
for (let i = 0; i < moved.length; i++) {
  if (moved[i].id !== queue[i].id || moved[i].count !== queue[i].count)
    throw new Error(`队列[${i}] 与移走车不一致: 队列 ${queue[i].id}:${queue[i].count} vs 盘上 ${moved[i].id}:${moved[i].count}`);
  const t = moved[i].type;
  const isBox = t === 0 || t == null;
  if (!isBox) throw new Error(`移走格 (${moved[i].r},${moved[i].c}) 不是普通车 (type=${JSON.stringify(t)})`);
}

// 原位放管道：pipe 格放队列；shells 格放空队列；其余被移走格必须由 pipe/shell 覆盖
const placed = new Set();
sp[cfg.pipe.r][cfg.pipe.c] = { id: 0, type: cfg.pipe.type, param: queue.map(x => ({ id: x.id, count: x.count })), count: 0 };
placed.add(cfg.pipe.r + ',' + cfg.pipe.c);
for (const sh of (cfg.shells || (cfg.shell ? [cfg.shell] : []))) {
  sp[sh.r][sh.c] = { id: 0, type: sh.type, param: [], count: 0 };
  placed.add(sh.r + ',' + sh.c);
}
for (const m of moved) {
  if (!placed.has(m.r + ',' + m.c)) throw new Error(`被移走格 (${m.r},${m.c}) 未被管道/壳覆盖 → 会留空格`);
}
if (placed.size !== moved.length) throw new Error(`管道/壳格数 ${placed.size} ≠ 队列车数 ${moved.length}（会清空盘上其他车）`);

// 逐色守恒
const px = {};
for (const row of game.blocks) for (const v of row) if (v > 0) px[v] = (px[v] || 0) + 1;
const caps = {};
for (const row of sp) for (const s of row) {
  const t = Array.isArray(s.type) ? s.type : [s.type || 0];
  const isPipe = t.some(x => x >= 11 && x <= 14);
  if (isPipe) { for (const q of (Array.isArray(s.param) ? s.param : [])) if (q && q.id > 0) (caps[q.id] = caps[q.id] || []).push(q.count); continue; }
  if (s.id > 0) (caps[s.id] = caps[s.id] || []).push(s.count);
}
const bad = [];
for (const k of Object.keys(px)) {
  const sum = (caps[k] || []).reduce((a, b) => a + b, 0);
  if (sum !== px[k]) bad.push(`色${k} 像素${px[k]} 容量${sum}`);
}
// 无空格
const empties = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const s = sp[r][c];
  const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
  const isPipe = t.some(x => x >= 11 && x <= 14);
  if (!s || (s.id <= 0 && s.id !== -1 && !isPipe)) empties.push(`(${r},${c})`);
}
game.spools = sp;
fs.writeFileSync(out, JSON.stringify(game));
console.log(JSON.stringify({
  name: cfg.name, out,
  pipe: cfg.pipe, shells: cfg.shells || (cfg.shell ? [cfg.shell] : []),
  moved: moved.map(m => `${m.r},${m.c}=${m.id}:${m.count}`),
  conserved: bad.length === 0, bad,
  empties: empties.length, emptyList: empties
}));
if (bad.length || empties.length) process.exit(1);
