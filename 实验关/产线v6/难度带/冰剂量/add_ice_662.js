#!/usr/bin/env node
'use strict';
/**
 * add_ice_662 —— 冰剂量实验：在底座上按格加数字冰（只改 type/param），其余不动。
 * 用法：
 *   node add_ice_662.js <底座.json> --cells "r,c:param;r,c:param;..." --out <变体.json> [--label A]
 * 自检：
 *   - 目标格是车（id>0）、不是锁链格（type 5 param>0）、不是已有冰（type 7）；
 *   - 像素数 == sum(count)（守恒）；
 *   - 逐色守恒（blocks 中每色像素 == 该色车 count 之和）；
 *   - 无空格（49 格 id>0）；
 *   - 开局可点（listMoves !blocked）≥5；
 *   - 冰倒计时按取盒数：param 即需要先取走的盒数（锁链一步扣组员数）。
 */
const fs = require('fs');
const path = require('path');
const B = require(path.join(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const FILE = argv[0];
const CELLS = String(arg('--cells', '')).split(';').filter(Boolean).map(s => {
  const [rc, p] = s.split(':');
  const [r, c] = rc.split(',').map(Number);
  return { r, c, param: Number(p) };
});
const OUT = arg('--out', null);
const LABEL = arg('--label', '');
if (!FILE || FILE.startsWith('--') || !CELLS.length || !OUT) {
  console.error('用法: node add_ice_662.js <底座.json> --cells "r,c:param;..." --out <变体.json> [--label A]');
  process.exit(2);
}

const game = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const out = JSON.parse(JSON.stringify(game));

const checks = [];
for (const cell of CELLS) {
  const { r, c, param } = cell;
  const sp = out.spools[r] && out.spools[r][c];
  if (!sp) { console.error(`格 ${r},${c} 不存在`); process.exit(1); }
  const ok = [];
  if (!(sp.id > 0)) ok.push('不是车(id<=0)');
  if (sp.type === 7) ok.push('已是冰');
  if (sp.type === 5 && sp.param > 0) ok.push('锁链格');
  if (!Number.isFinite(param) || param <= 0) ok.push('param 非法');
  if (ok.length) { console.error(`格 ${r},${c} 不合格: ${ok.join(', ')}`); process.exit(1); }
  sp.type = 7;
  sp.param = param;
  checks.push({ r, c, color: sp.id, count: sp.count, param });
}

// 守恒 / 空格
let px = 0;
const colorPx = {};
for (const row of out.blocks) for (const v of row) if (v > 0) { px++; colorPx[v] = (colorPx[v] || 0) + 1; }
let cap = 0, empty = 0;
const colorCap = {};
for (const row of out.spools) for (const sp of row) {
  if (!sp || !(sp.id > 0)) { empty++; continue; }
  cap += sp.count;
  colorCap[sp.id] = (colorCap[sp.id] || 0) + sp.count;
}
const colorMismatch = [];
for (const k of new Set([...Object.keys(colorPx), ...Object.keys(colorCap)])) {
  if ((colorPx[k] || 0) !== (colorCap[k] || 0)) colorMismatch.push({ color: k, px: colorPx[k] || 0, cap: colorCap[k] || 0 });
}

// 开局可点
const lv = A.parseLevel(A.fromGameFormat(out));
const st = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const opening = Sim.listMoves(st).filter(m => !m.blocked).map(m => m.r + ',' + m.c);

const report = {
  label: LABEL,
  source: path.basename(FILE),
  addedIce: checks,
  totalPx: px,
  totalCap: cap,
  conservation: px === cap && colorMismatch.length === 0,
  colorMismatch,
  emptyCells: empty,
  openingCount: opening.length,
  opening,
  openingCells: out.spools.length * out.spools[0].length
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify(report));
