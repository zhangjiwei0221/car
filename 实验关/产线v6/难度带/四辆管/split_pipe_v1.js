#!/usr/bin/env node
'use strict';
/**
 * split_pipe_v1 —— 拆半管道：管身车整辆进队列，其余目标车“拆一半”进队列，另一半留在盘上。
 *
 * 与 build_natural_pipe 的区别：后者把整辆车搬走（原位变黑块）；本脚本把部分车拆成两半，
 * 盘上保留一半（count=floor/2）、队列放另一半，不产生黑块。
 *
 * 用法：
 *   node split_pipe_v1.js <底座.json> <输出.json> --pipe r,c --dir 11|12|13|14 \
 *        --split "r,c;r,c;..." [--report <diff.json>]
 *
 * 规则：
 *   - P（管身格）的车整辆进队列，P 变功能管 {id:0,type:dir,param:[...],count:0}；
 *   - --split 列出的每格：盘上 count=floor(c/2)、队列 {id, count:ceil(c/2)}；
 *   - 不允许 0 容量管；逐色容量守恒（车 + 队列 = 像素总数）；开局可点 ≥5。
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator;

const argv = process.argv.slice(2);
const pos = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; }
  else pos.push(argv[i]);
}
const [baseFile, outFile] = pos;
if (!baseFile || !outFile || !opt.pipe || !opt.dir) {
  console.error('用法: node split_pipe_v1.js <底座> <输出> --pipe r,c --dir 11|12|13|14 --split "r,c;..."');
  process.exit(2);
}
const P = String(opt.pipe).split(',').map(Number);
const DIR = Number(opt.dir);
const SPLIT = String(opt.split || '').split(';').filter(Boolean).map(s => s.split(',').map(Number));
if (![11, 12, 13, 14].includes(DIR)) { console.error('dir 必须是 11/12/13/14'); process.exit(2); }
if (!SPLIT.length) { console.error('--split 不能为空'); process.exit(2); }

const game = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
const out = JSON.parse(JSON.stringify(game));
const sp = out.spools;
const ROWS = sp.length, COLS = sp[0].length;
const isCar = (x) => x && x.id > 0 && x.count > 0;
const queue = [];

// 1) 管身车整辆进队列
const pCell = sp[P[0]][P[1]];
if (!isCar(pCell)) { console.error(`P (${P}) 不是车`); process.exit(1); }
const ts = Array.isArray(pCell.type) ? pCell.type : [pCell.type];
if (ts.some(t => t >= 11 && t <= 14)) { console.error('P 已是管道'); process.exit(1); }
queue.push({ id: pCell.id, count: pCell.count, from: [P[0], P[1]], half: false });
sp[P[0]][P[1]] = { id: 0, type: DIR, param: [], count: 0 };

// 2) 拆半车：盘上留 floor(c/2)，队列放 ceil(c/2)
for (const [r, c] of SPLIT) {
  const cell = sp[r][c];
  if (!isCar(cell)) { console.error(`split (${r},${c}) 不是车`); process.exit(1); }
  const t2 = Array.isArray(cell.type) ? cell.type : [cell.type];
  if (t2.some(t => t > 0)) { console.error(`split (${r},${c}) 不是普通车`); process.exit(1); }
  const c0 = cell.count;
  const keep = Math.floor(c0 / 2), put = c0 - keep;
  if (keep < 8) { console.error(`split (${r},${c}) 留下的一半 <8px`); process.exit(1); }
  queue.push({ id: cell.id, count: put, from: [r, c], half: true });
  sp[r][c] = { id: cell.id, type: 0, param: 0, count: keep };
}

// 3) 写队列
sp[P[0]][P[1]].param = queue.map(q => ({ id: q.id, count: q.count }));

// 4) 自检
const A2 = { parseLevel: A.parseLevel, fromGameFormat: A.fromGameFormat };
let lv;
try { lv = A2.parseLevel(A2.fromGameFormat(out)); } catch (e) { console.error('解析失败', e.message); process.exit(1); }
let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
const open = Sim.listMoves(s).filter(m => !m.blocked).length;
const colorSum = {};
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const x = sp[r][c]; if (!x) continue;
  if (x.id > 0) colorSum[x.id] = (colorSum[x.id] || 0) + x.count;
  const ts = Array.isArray(x.type) ? x.type : [x.type];
  if (ts.some(t => t >= 11 && t <= 14) && Array.isArray(x.param)) {
    for (const q of x.param) if (q && q.id > 0) colorSum[q.id] = (colorSum[q.id] || 0) + q.count;
  }
}
const blk = {}; for (let r = 0; r < out.blocks.length; r++) for (let c = 0; c < out.blocks[r].length; c++) {
  const col = out.blocks[r][c]; if (col > 0) blk[col] = (blk[col] || 0) + 1;
}
const bad = Object.keys(blk).filter(k => colorSum[k] !== blk[k]);
const rep = {
  base: baseFile, out: outFile, pipe: { r: P[0], c: P[1], dir: DIR },
  queue: queue.map(q => ({ id: q.id, count: q.count, from: q.from, half: q.half })),
  queueCars: queue.length, blacks: 0, openingPickable: open,
  colorMismatch: bad, totalPx: Object.values(blk).reduce((a, b) => a + b, 0),
  totalCap: Object.values(colorSum).reduce((a, b) => a + b, 0)
};
if (bad.length) { console.error(JSON.stringify(rep)); process.exit(1); }
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify(rep));
