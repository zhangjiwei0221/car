#!/usr/bin/env node
'use strict';
/**
 * 多链实验 · 加一条两连锁（2026-11-13）
 *
 * 与 ../加链/建B_v1.js 相同，唯一放宽：允许两格落在第 0、1、2 行（规则 2：
 * 优先第 0–1 行，凑不出才放第 2 行，调用方负责记录）。仍要求正交相邻、
 * 都是车、都不是锁链。只改这两格的 type/param，其余逐字节不变。
 *
 * 用法：
 *   node 建链_v1.js <输入.json> <r1,c1> <r2,c2> <out.json> --gid <N>
 */
const fs = require('fs');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const gidArg = process.argv.indexOf('--gid');
const GID = gidArg > 0 ? Number(process.argv[gidArg + 1]) : 1;
const [IN, A1, B1, OUT] = args;
if (!IN || !A1 || !B1 || !OUT) {
  console.error('用法: node 建链_v1.js <输入.json> <r1,c1> <r2,c2> <out.json> --gid N');
  process.exit(2);
}
const parseRC = (s) => s.split(',').map(Number);
const [r1, c1] = parseRC(A1), [r2, c2] = parseRC(B1);
const clone = (o) => JSON.parse(JSON.stringify(o));
const before = JSON.parse(fs.readFileSync(IN, 'utf8'));
const after = clone(before);

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }
const rows = after.spools.length, cols = after.spools[0].length;
if (r1 < 0 || r2 < 0 || r1 > 2 || r2 > 2) fail('两格必须在第 0–2 行（规则 2）');
if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) fail('两格必须正交相邻');
const ca = after.spools[r1][c1], cb = after.spools[r2][c2];
const typeList = (c) => Array.isArray(c.type) ? c.type : (c.type === 0 || c.type == null ? [] : [c.type]);
for (const [r, c, cell] of [[r1, c1, ca], [r2, c2, cb]]) {
  if (!cell || !(cell.id > 0) || !(cell.count > 0)) fail(`(${r},${c}) 不是车`);
  if (typeList(cell).includes(5)) fail(`(${r},${c}) 已经是锁链`);
}
function setChain(cell, gid) {
  const ts = typeList(cell);
  const ice = ts.indexOf(7), q = ts.indexOf(6);
  const nt = [5], np2 = [gid];
  if (ice >= 0) { nt.push(7); np2.push(Array.isArray(cell.param) ? cell.param[ice] : cell.param); }
  if (q >= 0) { nt.push(6); np2.push(0); }
  cell.type = nt.length === 1 ? 5 : nt;
  cell.param = np2.length === 1 ? gid : np2;
}
setChain(ca, GID); setChain(cb, GID);

const diffs = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  if (JSON.stringify(before.spools[r][c]) !== JSON.stringify(after.spools[r][c])) diffs.push(`${r},${c}`);
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
console.log(JSON.stringify({ ok: true, out: OUT, chain: { gid: GID, a: [r1, c1], b: [r2, c2], row: Math.max(r1, r2) }, colors: [ca.id, cb.id], counts: [ca.count, cb.count], changedCells: diffs }, null, 1));
