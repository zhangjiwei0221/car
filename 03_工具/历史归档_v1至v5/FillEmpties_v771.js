#!/usr/bin/env node
'use strict';
/**
 * FillEmpties_v771 —— 把棋盘空格填上（拆一辆车搬过去，容量守恒）
 * 用途：管道会把车搬进队列、原地留空；把空格用"拆分其他车"的方式填满，棋盘就不留空。
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--ref'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/filled.json');
const g = B.readJson(FILE);
const rows = g.spools.length, cols = g.spools[0].length;
function isPipe(s) { const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : []; return t.some(x => x >= 11 && x <= 14); }
function isBlack(s) { return s && s.id === -1; }
const empties = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const s = g.spools[r][c];
  if (isPipe(s) || isBlack(s)) continue;
  if (!s || !s.id || s.id <= 0) empties.push([r, c]);
}
console.log('空格数:', empties.length);
let filled = 0;
for (const [er, ec] of empties) {
  // 找一辆"最大的、普通车"来拆
  let best = null;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    if (!s || !(s.id > 0)) continue;
    const t = Array.isArray(s.type) ? s.type : [s.type || 0];
    if (t.includes(5) || t.includes(7)) continue;   // 锁链/冰不拆
    if (s.count < 8) continue;
    if (!best || s.count > best.s.count) best = { r, c, s };
  }
  if (!best) break;
  const half = Math.floor(best.s.count / 2);
  best.s.count -= half;
  g.spools[er][ec] = { id: best.s.id, type: 0, param: 0, count: half };
  filled++;
}
let sum = 0, empty = 0;
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const s = g.spools[r][c];
  if (isPipe(s) || isBlack(s)) continue;
  if (!s || !s.id || s.id <= 0) { empty++; continue; }
  sum += s.count;
}
const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
const buf = (o.pressureSamples || []).map(s => s.buf || 0);
console.log(`填补 ${filled} 格 → 剩余空格 ${empty} | 容量合计 ${sum} | 可通=${o.completed} 步=${buf.length} 峰值=${Math.max(0, ...buf)}`);
fs.writeFileSync(OUT, JSON.stringify(g));
console.log('已写入', OUT);
