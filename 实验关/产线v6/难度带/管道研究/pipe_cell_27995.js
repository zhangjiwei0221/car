#!/usr/bin/env node
'use strict';
/**
 * pipe_cell_27995.js —— 指定格子 / 指定方向的「车 → 管道」转换（管道研究用，pid 27995）
 *
 * 与 PipeConvert_v772（只能从左上角取前 N 个）/ PipeSearch_v808（只枚举朝外方向）不同，
 * 本脚本只做一件事：把 (r,c) 的车格改成管道，队列 = 原车 {id,count}，type = dir。
 *
 * 官方格式（utils.js toGameFormat）：
 *   管道 = { id: 0, type: dir(11上/12右/13下/14左), param: [{id,count},...], count: 0 }
 *
 * 用法：
 *   node pipe_cell_27995.js <关卡.json> --cell r,c --dir 13 --out <结果.json>
 *
 * 自检：
 *   1. 出口格 (r+dy, c+dx) 必须在界内、且不是黑块（黑块永远不会空，管道永远不开）；
 *   2. 目标格必须是普通车（id>0，type 不含 5/6/7/11-14）；
 *   3. 除目标格外，toprow/blocks/maprow/mapcol/其他 spool 与底座逐字节一致；
 *   4. 容量守恒：sum(车 count) + sum(管道 param count) 不变。
 * 只新增产物；不改任何现有文件。
 */
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
if (!FILE || FILE.startsWith('--')) { console.error('用法: node pipe_cell_27995.js <关卡.json> --cell r,c --dir 13 --out <结果.json>'); process.exit(2); }
const CELL = arg('--cell', '').split(',').map(Number);
const DIR = Number(arg('--dir', 13));
const OUT = arg('--out', '');
if (!OUT || CELL.length !== 2 || !(CELL[0] >= 0) || !(CELL[1] >= 0) || ![11, 12, 13, 14].includes(DIR)) {
  console.error('参数错误：需要 --cell r,c --dir 11|12|13|14 --out <结果.json>'); process.exit(2);
}
const DY = { 11: -1, 12: 0, 13: 1, 14: 0 }, DX = { 11: 0, 12: 1, 13: 0, 14: -1 };
const NAME = { 11: '上', 12: '右', 13: '下', 14: '左' };

const g = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const base = JSON.parse(JSON.stringify(g));
const R = g.spools.length, C = g.spools[0].length;
const [r, c] = CELL;
const er = r + DY[DIR], ec = c + DX[DIR];
if (!(r < R && c < C && er >= 0 && er < R && ec >= 0 && ec < C)) {
  console.error(`FAIL 出口越界：(${r},${c}) 朝${NAME[DIR]} → (${er},${ec})`); process.exit(3);
}
const exit = g.spools[er][ec];
if (exit && exit.id === -1) { console.error(`FAIL 出口是黑块 (${er},${ec})，管道永远不会开`); process.exit(3); }
const s = g.spools[r][c];
if (!s || !(s.id > 0)) { console.error(`FAIL (${r},${c}) 不是车`); process.exit(3); }
const tl = Array.isArray(s.type) ? s.type : [s.type || 0];
if (tl.some(x => [5, 6, 7, 11, 12, 13, 14].includes(x))) {
  console.error(`FAIL (${r},${c}) 带功能 type=${JSON.stringify(s.type)}（链/问号/冰/管道），本实验只转普通车`); process.exit(3);
}

const sumOf = (gg) => {
  let sum = 0;
  for (const row of gg.spools) for (const x of row) {
    const t = x ? (Array.isArray(x.type) ? x.type : [x.type || 0]) : [];
    if (t.some(v => v >= 11 && v <= 14)) { (Array.isArray(x.param) ? x.param : []).forEach(b => { sum += (b.count || 0); }); continue; }
    if (x && x.id === -1) continue;
    if (x && x.id > 0) sum += x.count;
  }
  return sum;
};
const before = sumOf(g);
const queue = [{ id: s.id, count: s.count }];
g.spools[r][c] = { id: 0, type: DIR, param: queue, count: 0 };
const after = sumOf(g);
if (after !== before) { console.error(`FAIL 容量不守恒 ${before} → ${after}`); process.exit(3); }

// 除目标格外逐字节一致
const diffs = [];
for (const k of ['toprow', 'blocks', 'maprow', 'mapcol']) {
  if (JSON.stringify(g[k]) !== JSON.stringify(base[k])) diffs.push(k);
}
for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
  if (i === r && j === c) continue;
  if (JSON.stringify(g.spools[i][j]) !== JSON.stringify(base.spools[i][j])) diffs.push(`spool_${i}_${j}`);
}
if (diffs.length) { console.error('FAIL 目标格外有改动: ' + diffs.join(',')); process.exit(3); }

fs.writeFileSync(OUT, JSON.stringify(g, null, 1));
console.log(JSON.stringify({
  ok: true, file: OUT, cell: [r, c], from: { id: s.id, count: s.count, type: s.type },
  pipe: { type: DIR, dirName: NAME[DIR], exit: [er, ec], exitCell: exit ? { id: exit.id, count: exit.count, type: exit.type } : null },
  capacity: after
}));
