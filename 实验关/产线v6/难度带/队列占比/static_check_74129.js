#!/usr/bin/env node
'use strict';
/**
 * static_check_74129 —— 队列占比实验的静态预检（只读，不写关卡）
 *
 * 检查项：
 *  1) 开局可点（引擎口径 corner / useSlotStart / instantChain:false）
 *  2) 静态连通：所有非永久阻挡格必须能经 4 邻接到达第 0 行（永久阻挡 = 黑块 + 管身）；
 *     管出口格视为源（开管后激活）。必要条件，不是充分条件。
 *  3) 逐色隐藏占比：queue 内 count / 该色总像素
 *  4) 逐色剩余车上限占比
 *  5) 队列顺序、黑块清单、占比 = 队列车 / (车 + 队列车)
 *
 * 用法:
 *   node static_check_74129.js <底座.json> --pipe r,c --dir D --queue "r,c;r,c;..."
 */
const path = require('path');
const fs = require('fs');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator;

const argv = process.argv.slice(2);
const pos = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { opt[a.slice(2)] = argv[i + 1]; i++; }
  else pos.push(a);
}
const baseFile = pos[0];
if (!baseFile || !opt.pipe || !opt.dir || !opt.queue) {
  console.error('用法: node static_check_74129.js <底座.json> --pipe r,c --dir D --queue "r,c;..."');
  process.exit(2);
}
const P = opt.pipe.split(',').map(Number);
const DIR = Number(opt.dir);
const QUEUE = opt.queue.split(';').filter(Boolean).map(s => s.split(',').map(Number));
const game = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
const sp = game.spools;
const R = sp.length, C = sp[0].length;
const dy = { 11: -1, 12: 0, 13: 1, 14: 0 }[DIR], dx = { 11: 0, 12: 1, 13: 0, 14: -1 }[DIR];
const exit = [P[0] + dy, P[1] + dx];

// 改关（与 build_natural_pipes_61842 同规则）
const next = JSON.parse(JSON.stringify(game));
const param = QUEUE.map(([r, c]) => ({ id: sp[r][c].id, count: sp[r][c].count }));
next.spools[P[0]][P[1]] = { id: 0, type: DIR, param, count: 0 };
const blacks = [];
for (const [r, c] of QUEUE) {
  if (r === P[0] && c === P[1]) continue;
  next.spools[r][c] = { id: -1, type: 0, param: 0, count: 0 };
  blacks.push([r, c]);
}

// 静态连通（4 邻接，永久阻挡 = 黑块/管道）
const blocked = Array.from({ length: R }, () => Array(C).fill(false));
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = next.spools[r][c];
  const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
  if (!s || s.id === -1 || t.some(x => x >= 11 && x <= 14)) blocked[r][c] = true;
}
const seen = Array.from({ length: R }, () => Array(C).fill(false));
const q = [];
for (let c = 0; c < C; c++) if (!blocked[0][c]) { seen[0][c] = true; q.push([0, c]); }
if (!blocked[exit[0]][exit[1]]) { seen[exit[0]][exit[1]] = true; q.push(exit); } // 开管源
const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
for (let h = 0; h < q.length; h++) {
  for (const [dr, dc] of dirs) {
    const nr = q[h][0] + dr, nc = q[h][1] + dc;
    if (nr < 0 || nr >= R || nc < 0 || nc >= C || seen[nr][nc] || blocked[nr][nc]) continue;
    seen[nr][nc] = true; q.push([nr, nc]);
  }
}
const unreachable = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  if (!blocked[r][c] && !seen[r][c]) unreachable.push(`${r},${c}`);
}

// 逐色
const totalPx = {}, hiddenPx = {}, hiddenCars = {}, totalCars = {};
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = sp[r][c];
  if (!s || !(s.id > 0)) continue;
  totalPx[s.id] = (totalPx[s.id] || 0) + s.count;
  totalCars[s.id] = (totalCars[s.id] || 0) + 1;
}
for (const [r, c] of QUEUE) {
  const s = sp[r][c];
  hiddenPx[s.id] = (hiddenPx[s.id] || 0) + s.count;
  hiddenCars[s.id] = (hiddenCars[s.id] || 0) + 1;
}
const perColor = Object.keys(totalPx).sort((a, b) => a - b).map(k => ({
  color: Number(k),
  pxShareHidden: +((hiddenPx[k] || 0) / totalPx[k]).toFixed(3),
  carsHidden: `${hiddenCars[k] || 0}/${totalCars[k]}`,
  pxLeft: totalPx[k] - (hiddenPx[k] || 0),
}));

// 开局可点
const lv = A.parseLevel(A.fromGameFormat(next));
const st0 = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const opening = Sim.listMoves(st0).filter(m => !m.blocked).length;

const Q = QUEUE.length;
const ratio = +(Q / (49 + Q - Q)).toFixed(4); // 195 底座：总车恒为 49；见下
const totalCarsAll = 49;
const out = {
  base: path.basename(baseFile), pipe: P, dir: DIR, exit,
  queueCars: Q, deadDebtCars: Q - 1, blacks: blacks.length,
  ratioQOfTotal: +(Q / totalCarsAll).toFixed(4),
  opening, unreachable, unreachableCount: unreachable.length,
  hiddenPxTotal: Object.values(hiddenPx).reduce((a, b) => a + b, 0),
  perColor,
  queue: QUEUE.map(([r, c]) => `${r},${c}:${sp[r][c].id}/${sp[r][c].count}`),
};
console.log(JSON.stringify(out, null, 1));
process.exit(unreachable.length ? 1 : 0);
