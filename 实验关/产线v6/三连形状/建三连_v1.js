#!/usr/bin/env node
'use strict';
/**
 * 建三连_v1 —— 三连锁形状对照实验 · 构造器（2026-11-13）
 *
 * 只做一件事：把指定的三格车设成同一锁链组（type=5, param=<gid>）。
 * 不改 count / id / 目标图 / 其他障碍；输出前自检：
 *   - 除这三格的 type/param 外，其余字段与输入逐字节一致；
 *   - 逐色容量守恒不变；
 *   - 三格几何形状与声明一致（v=纵向 / h=横向 / l=直角，两两正交连通）；
 *   - 三格都是车，且原本不是锁链。
 *
 * 用法：
 *   node 建三连_v1.js <输入.json> <shape:v|h|l> <r1,c1> <r2,c2> <r3,c3> <out.json> [--gid 1]
 */
const fs = require('fs');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const gidArg = process.argv.indexOf('--gid');
const GID = gidArg > 0 ? Number(process.argv[gidArg + 1]) : 1;
const [IN, SHAPE, C1, C2, C3, OUT] = args;
if (!IN || !SHAPE || !C1 || !C2 || !C3 || !OUT) {
  console.error('用法: node 建三连_v1.js <输入.json> <v|h|l> <r1,c1> <r2,c2> <r3,c3> <out.json> [--gid 1]');
  process.exit(2);
}
const parseRC = (s) => s.split(',').map(Number);
const cells = [parseRC(C1), parseRC(C2), parseRC(C3)];
const clone = (o) => JSON.parse(JSON.stringify(o));
const before = JSON.parse(fs.readFileSync(IN, 'utf8'));
const after = clone(before);

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

// ---- 几何自检 ----
function orthoAdj(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1; }
const sorted = cells.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
function hasEdge(a, b) { return sorted.some(x => x[0] === a[0] && x[1] === a[1]) && sorted.some(x => x[0] === b[0] && x[1] === b[1]); }
let shapeOk = false;
if (SHAPE === 'v') {
  // 同一列连续三行
  shapeOk = cells.every(x => x[1] === cells[0][1]) &&
    new Set(cells.map(x => x[0])).size === 3 &&
    Math.max(...cells.map(x => x[0])) - Math.min(...cells.map(x => x[0])) === 2;
} else if (SHAPE === 'h') {
  shapeOk = cells.every(x => x[0] === cells[0][0]) &&
    new Set(cells.map(x => x[1])).size === 3 &&
    Math.max(...cells.map(x => x[1])) - Math.min(...cells.map(x => x[1])) === 2;
} else if (SHAPE === 'l') {
  // 直角：恰好一个拐角，两根臂各长 2，三格两两正交连通
  const deg = cells.map(a => cells.filter(b => orthoAdj(a, b)).length).sort((x, y) => x - y);
  shapeOk = deg[0] === 1 && deg[1] === 1 && deg[2] === 2;
} else fail('shape 必须是 v / h / l');

if (!shapeOk) fail(`三格几何不符合形状 ${SHAPE}: ` + cells.map(x => x.join(',')).join(' | '));

const rows = after.spools.length, cols = after.spools[0].length;
const changed = [];
for (const [r, c] of cells) {
  if (r < 0 || c < 0 || r >= rows || c >= cols) fail(`(${r},${c}) 越界`);
  const cell = after.spools[r][c];
  if (!cell || !(cell.id > 0) || !(cell.count > 0)) fail(`(${r},${c}) 不是车`);
  const ts = Array.isArray(cell.type) ? cell.type : (cell.type === 0 || cell.type == null ? [] : [cell.type]);
  if (ts.includes(5)) fail(`(${r},${c}) 已经是锁链`);
  const ice = ts.indexOf(7), q = ts.indexOf(6);
  const nt = [5], np2 = [GID];
  if (ice >= 0) { nt.push(7); np2.push(Array.isArray(cell.param) ? cell.param[ice] : cell.param); }
  if (q >= 0) { nt.push(6); np2.push(0); }
  cell.type = nt.length === 1 ? 5 : nt;
  cell.param = np2.length === 1 ? GID : np2;
  changed.push(`${r},${c}`);
}

// ---- 自检：只有这三格变化 ----
const diffs = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const x = JSON.stringify(before.spools[r][c]), y = JSON.stringify(after.spools[r][c]);
  if (x !== y) diffs.push(`${r},${c}`);
}
const expect = cells.map(x => x.join(',')).sort().join('|');
if (diffs.sort().join('|') !== expect) fail('除了三格之外还有变化: ' + diffs.join(' '));
if (JSON.stringify(before.blocks) !== JSON.stringify(after.blocks)) fail('目标图被改动');
if (before.toprow !== after.toprow || before.maprow !== after.maprow || before.mapcol !== after.mapcol) fail('尺寸字段被改动');

function colorTotals(g) {
  const t = {};
  for (const row of g.spools) for (const c of row) {
    if (!c || !(c.id > 0) || !(c.count > 0)) continue;
    t[c.id] = (t[c.id] || 0) + c.count;
  }
  return t;
}
const ta = colorTotals(before), tb = colorTotals(after);
for (const k of new Set([...Object.keys(ta), ...Object.keys(tb)])) if (ta[k] !== tb[k]) fail(`颜色 ${k} 容量变了 ${ta[k]} → ${tb[k]}`);
if (JSON.stringify(ta) !== JSON.stringify(tb)) fail('逐色容量表变化');

fs.writeFileSync(OUT, JSON.stringify(after, null, 1));
const types = cells.map(([r, c]) => {
  const o = before.spools[r][c];
  return { cell: `${r},${c}`, color: o.id, count: o.count, wasType: o.type };
});
console.log(JSON.stringify({ ok: true, shape: SHAPE, gid: GID, out: OUT, cells: types, changedCells: diffs }, null, 1));
