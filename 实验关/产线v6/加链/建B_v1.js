#!/usr/bin/env node
'use strict';
/**
 * 加链 A/B · 建 B 版（2026-11-13）
 *
 * 只做一件事：把指定的两个正交相邻车格设成同一锁链组（type=5, param=<gid>）。
 * 不改 count / id / 目标图 / 其他障碍；输出前自检：
 *   - 除这两格的 type/param 外，其余字段与输入逐字节一致；
 *   - 逐色容量守恒不变；
 *   - 两格正交相邻、都是车、都在第 0 行或第 0–1 行。
 *
 * 用法：
 *   node 建B_v1.js <A关卡.json> <r1,c1> <r2,c2> <out.json> [--gid 1]
 */
const fs = require('fs');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const gidArg = process.argv.indexOf('--gid');
const GID = gidArg > 0 ? Number(process.argv[gidArg + 1]) : 1;
const [IN, A1, B1, OUT] = args;
if (!IN || !A1 || !B1 || !OUT) {
  console.error('用法: node 建B_v1.js <A关卡.json> <r1,c1> <r2,c2> <out.json> [--gid 1]');
  process.exit(2);
}
const parseRC = (s) => s.split(',').map(Number);
const [r1, c1] = parseRC(A1), [r2, c2] = parseRC(B1);
const clone = (o) => JSON.parse(JSON.stringify(o));
const before = JSON.parse(fs.readFileSync(IN, 'utf8'));
const after = clone(before);

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }
const rows = after.spools.length, cols = after.spools[0].length;
if (Math.max(r1, r2) > 1) fail('两格必须在第 0 行或第 0–1 行');
if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) fail('两格必须正交相邻');
const ca = after.spools[r1][c1], cb = after.spools[r2][c2];
for (const [r, c, cell] of [[r1, c1, ca], [r2, c2, cb]]) {
  if (!cell || !(cell.id > 0) || !(cell.count > 0)) fail(`(${r},${c}) 不是车`);
  const ts = Array.isArray(cell.type) ? cell.type : (cell.type === 0 || cell.type == null ? [] : [cell.type]);
  if (ts.includes(5)) fail(`(${r},${c}) 已经是锁链`);
}
function setChain(cell, gid) {
  const ts = Array.isArray(cell.type) ? cell.type : (cell.type === 0 || cell.type == null ? [] : [cell.type]);
  const ice = ts.indexOf(7), q = ts.indexOf(6);
  const nt = [5], np2 = [gid];
  if (ice >= 0) { nt.push(7); np2.push(Array.isArray(cell.param) ? cell.param[ice] : cell.param); }
  if (q >= 0) { nt.push(6); np2.push(0); }
  cell.type = nt.length === 1 ? 5 : nt;
  cell.param = np2.length === 1 ? gid : np2;
}
setChain(ca, GID); setChain(cb, GID);

// 自检：只有这两格的 type/param 变化
const diffs = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const x = JSON.stringify(before.spools[r][c]), y = JSON.stringify(after.spools[r][c]);
  if (x !== y) diffs.push(`${r},${c}`);
}
const expect = [`${r1},${c1}`, `${r2},${c2}`].sort().join('|');
if (diffs.sort().join('|') !== expect) fail('除了两格之外还有变化: ' + diffs.join(' '));
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

fs.writeFileSync(OUT, JSON.stringify(after, null, 1));
console.log(JSON.stringify({ ok: true, out: OUT, chain: { gid: GID, a: [r1, c1], b: [r2, c2] }, colors: [ca.id, cb.id], counts: [ca.count, cb.count], changedCells: diffs }, null, 1));
