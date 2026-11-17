#!/usr/bin/env node
'use strict';
/**
 * pipe_queue2_27995.js —— 「一条管道队列放 2 辆车」的探索变体（管道研究用，pid 27995）
 *
 * 这是**协议例外**：单格变体做不到双车队列——第 2 辆车的容量必须从它的格子搬走，
 * 所以本脚本会改动 2 格（目标块 + 第 2 格清空）。推荐把第 2 格选成管道的出口格：
 * createState 时会立刻把队首车吐进出口格（simulator.createState → checkPipeRelease），
 * 因此实际游玩时盘面没有洞；但**原始 spools 里第 2 格是空 id=0**，
 * ArlCheck 的「无空格」会 +1 —— 该变体只作机制参考，不能当交付格式。
 *
 * 用法：
 *   node pipe_queue2_27995.js <关卡.json> --cell r,c --dir 13 --second r,c --out <结果.json>
 * 自检：容量守恒；只允许 (r,c) 与 second 两格不同。
 */
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const CELL = arg('--cell', '').split(',').map(Number);
const SECOND = arg('--second', '').split(',').map(Number);
const DIR = Number(arg('--dir', 13));
const OUT = arg('--out', '');
if (!FILE || CELL.length !== 2 || SECOND.length !== 2 || ![11, 12, 13, 14].includes(DIR) || !OUT) {
  console.error('用法: node pipe_queue2_27995.js <关卡.json> --cell r,c --dir 11|12|13|14 --second r,c --out <结果.json>'); process.exit(2);
}
const DY = { 11: -1, 12: 0, 13: 1, 14: 0 }, DX = { 11: 0, 12: 1, 13: 0, 14: -1 };
const g = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const base = JSON.parse(JSON.stringify(g));
const [r, c] = CELL, [r2, c2] = SECOND;
const s = g.spools[r][c], s2 = g.spools[r2][c2];
if (!s || !(s.id > 0) || !s2 || !(s2.id > 0)) { console.error('FAIL 两格都必须是普通车'); process.exit(3); }
const tl = x => Array.isArray(x.type) ? x.type : [x.type || 0];
if (tl(s).some(x => x > 0) || tl(s2).some(x => x > 0)) { console.error('FAIL 只接受普通车（type=0）'); process.exit(3); }
const sumOf = (gg) => { let sum = 0; for (const row of gg.spools) for (const x of row) { const t = x ? (Array.isArray(x.type) ? x.type : [x.type || 0]) : []; if (t.some(v => v >= 11 && v <= 14)) { (x.param || []).forEach(b => { sum += (b.count || 0); }); continue; } if (x && x.id === -1) continue; if (x && x.id > 0) sum += x.count; } return sum; };
const before = sumOf(g);
g.spools[r][c] = { id: 0, type: DIR, param: [{ id: s.id, count: s.count }, { id: s2.id, count: s2.count }], count: 0 };
g.spools[r2][c2] = { id: 0, type: 0, param: 0, count: 0 };
const after = sumOf(g);
if (after !== before) { console.error(`FAIL 容量不守恒 ${before} → ${after}`); process.exit(3); }
const diffs = [];
for (const k of ['toprow', 'blocks', 'maprow', 'mapcol']) if (JSON.stringify(g[k]) !== JSON.stringify(base[k])) diffs.push(k);
for (let i = 0; i < g.spools.length; i++) for (let j = 0; j < g.spools[0].length; j++) {
  if ((i === r && j === c) || (i === r2 && j === c2)) continue;
  if (JSON.stringify(g.spools[i][j]) !== JSON.stringify(base.spools[i][j])) diffs.push(`spool_${i}_${j}`);
}
if (diffs.length) { console.error('FAIL 目标格外有改动: ' + diffs.join(',')); process.exit(3); }
fs.writeFileSync(OUT, JSON.stringify(g, null, 1));
console.log(JSON.stringify({ ok: true, file: OUT, pipe: [r, c], dir: DIR, queue: [{ id: s.id, count: s.count }, { id: s2.id, count: s2.count }], emptied: [r2, c2], exit: [r + DY[DIR], c + DX[DIR]], capacity: after, note: '第2格清空 → 原始 spools 有 1 个空格（ArlCheck 无空格会 FAIL）' }));
