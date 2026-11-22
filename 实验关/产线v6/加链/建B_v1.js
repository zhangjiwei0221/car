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
 *   node 建B_v1.js <A关卡.json> <r1,c1> <r2,c2> <out.json> [--gid 1] [--allow-valve]
 *
 * 逃生阀检查（2026-11-17，EscapeValveCheck_v1）：
 *   链绑了“开局点一下即吃满”的车 → 满格时唯一能腾位的车被锁住/要 2 空位 → 开局锁死
 *   （103 的 13 局死因）。默认拒绝这种链；确需实验请加 --allow-valve。
 */
const fs = require('fs');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const gidArg = process.argv.indexOf('--gid');
const GID = gidArg > 0 ? Number(process.argv[gidArg + 1]) : 1;
// 允许的最大行号（2026-11-20 中段链实验）：默认 1；传 --max-row 4 可建第 2–4 行的链
const maxRowArg = process.argv.indexOf('--max-row');
const MAXROW = maxRowArg > 0 ? Number(process.argv[maxRowArg + 1]) : 1;
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
if (Math.max(r1, r2) > MAXROW) fail('两格必须在第 0–' + MAXROW + ' 行（--max-row 可放开）');
if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) fail('两格必须正交相邻');

// 逃生阀检查：默认拒绝“绑开局能一次吃满的车”
if (!process.argv.includes('--allow-valve')) {
  const EV = require('../../../03_工具/正式版/EscapeValveCheck_v1.js');
  const valves = EV.openingValves(before);
  const vkey = new Set(valves.map(v => v.r + ',' + v.c));
  const hits = [[r1, c1], [r2, c2]].filter(([r, c]) => vkey.has(r + ',' + c));
  if (hits.length) fail('链绑了开局逃生阀 ' + hits.map(([r, c]) => `(${r},${c})`).join(' ') +
    '（点一下即吃满，满格时唯一出路）——确需实验请加 --allow-valve');
}
const ca = after.spools[r1][c1], cb = after.spools[r2][c2];
for (const [r, c, cell] of [[r1, c1, ca], [r2, c2, cb]]) {
  if (!cell || !(cell.id > 0) || !(cell.count > 0)) fail(`(${r},${c}) 不是车`);
  const ts = Array.isArray(cell.type) ? cell.type : (cell.type === 0 || cell.type == null ? [] : [cell.type]);
  if (ts.includes(5)) fail(`(${r},${c}) 已经是锁链`);
}
// gid 撞组保护（2026-11-22）：底座已带锁链组（如 CarSplitPlan 的 R1 守卫组）时，
// 用同一个 gid 会把新对**并进旧组**，生成 3+ 格、可能断开的链组——引擎照算，
// 直到 LayoutScore L4 才暴露（实测把难度从 1.000 压到 .65 的“关键链”就是这样来的）。
if (!process.argv.includes('--allow-merge')) {
  let usedBy = null;
  for (let r = 0; r < rows && !usedBy; r++) for (let c = 0; c < cols; c++) {
    const cell = before.spools[r][c];
    const ts = Array.isArray(cell.type) ? cell.type : (cell.type === 0 || cell.type == null ? [] : [cell.type]);
    if (!ts.includes(5)) continue;
    const gs = Array.isArray(cell.param) ? cell.param : [cell.param];
    if (gs.includes(GID)) { usedBy = `(${r},${c})`; break; }
  }
  if (usedBy) fail(`gid ${GID} 已被 ${usedBy} 占用——再建会并成一组断链（排版 L4）。换一个 gid，或确需合并加 --allow-merge`);
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
