#!/usr/bin/env node
'use strict';
/**
 * 复现_早期链 · 独立合法项检查（只读）
 *
 * 输出一行 JSON：
 *   {label, ok, px, tpx, cars, empty, open, diffs}
 *   px/tpx   = 逐色容量合计（车 count 总和 / 目标图像素总和，不含背景 0）
 *   cars     = 车数（id>0 且 count>0）
 *   empty    = 空格数（spools 里 id<=0 的格）
 *   open     = 开局合法可点车数（corner 口径、listMoves 过滤 blocked，未点前）
 *   diffs    = 逐色不一致列表
 *
 * 口径与 AGENTS 红线 2 一致：loadSolver('corner')，useSlotStart:true，instantChain:false。
 * 用法：node _检查_合法项.js <关卡.json> [--out 结果.json]
 */
const fs = require('fs');
const path = require('path');
const B = require(path.join(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LEVEL = process.argv[2];
if (!LEVEL || LEVEL.startsWith('--')) { console.error('用法: node _检查_合法项.js <关卡.json> [--out 结果.json]'); process.exit(2); }
const OUT = arg('--out', '');

const game = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
const totalsPx = {}, totalsCar = {};
for (const row of game.blocks) for (const c of row) if (c > 0) totalsPx[c] = (totalsPx[c] || 0) + 1;
let cars = 0, empty = 0, px = 0;
for (const row of game.spools) for (const s of row) {
  if (!s || !(s.id > 0)) { empty++; continue; }
  if (!(s.count > 0)) continue;
  cars++; px += s.count;
  totalsCar[s.id] = (totalsCar[s.id] || 0) + s.count;
}
const tpx = Object.values(totalsPx).reduce((a, b) => a + b, 0);
const diffs = [];
for (const k of new Set([...Object.keys(totalsPx), ...Object.keys(totalsCar)])) {
  if ((totalsPx[k] || 0) !== (totalsCar[k] || 0)) diffs.push({ color: Number(k), px: totalsPx[k] || 0, car: totalsCar[k] || 0 });
}
const lv = A.parseLevel(A.fromGameFormat(game));
const st = Sim.createState(lv, { useSlotStart: true, instantChain: false });
const open = Sim.listMoves(st).filter(m => !m.blocked).length;

const out = {
  label: LEVEL.replace(/\.json$/, ''),
  ok: diffs.length === 0 && px === tpx && empty === 0,
  px, tpx, cars, empty, open, diffs
};
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify(out));
