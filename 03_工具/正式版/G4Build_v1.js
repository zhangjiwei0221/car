#!/usr/bin/env node
'use strict';
/**
 * G4Build_v1 —— 分组4最小底边重排器
 *
 * 输入一张正常关卡 JSON（用它的 blocks 当目标图），按 bottomOnly 的消除轮次切车：
 *   轮次早 = 底边先露出的颜色 → 放棋盘顶行（棋盘取盒仍按顶部暴露）；
 *   轮次晚 = 上/左/右后露出的颜色 → 放深行。
 *
 * 只做“底边顺序重排”的最小版本：不自动加冰/链/管道；先看底边曲线是否成立。
 *
 * 用法：
 *   node G4Build_v1.js <正常关卡.json> --out <G4关卡.json> [--rows 7 --cols 7]
 *        [--box-min 8 --box-max 40]
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
const out = arg('--out', null);
const rows = Number(arg('--rows', 7));
const cols = Number(arg('--cols', 7));
const boxMin = Number(arg('--box-min', 8));
let boxMax = Number(arg('--box-max', 40));
const LUMP = process.argv.includes('--lump');
const splitColors = String(arg('--split-colors', '')).split(',').filter(Boolean).map(Number);
const splitMax = Number(arg('--split-max', 60)) || 60;
if (!input || !out) {
  console.error('用法: node G4Build_v1.js <正常关卡.json> --out <G4关卡.json> [--rows 7 --cols 7] [--box-min 8] [--box-max 40]');
  process.exit(2);
}
const src = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!src || !Array.isArray(src.blocks) || !Array.isArray(src.spools)) throw new Error('不是关卡 JSON');
const R = src.blocks.length, C = src.blocks[0].length;
const totalPixels = src.blocks.flat().filter(v => v > 0).length;

function splitCount(count, max = boxMax) {
  if (count <= max) return [count];
  let n = Math.ceil(count / max);
  // 不制造 <boxMin 的碎片；若均分太小，减少车数
  while (n > 1 && count / n < boxMin) n--;
  const base = Math.floor(count / n), rem = count - base * n;
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(base + (i < rem ? 1 : 0));
  return parts;
}

// 1) 底边消除顺序：roundColors 是“每一轮从底边可达区剥离的颜色段”
const eo = A.eliminationOrder(src.blocks, R, C, true);
if (!eo || !Array.isArray(eo.roundColors)) throw new Error('eliminationOrder 失败');
const segs = eo.roundColors.filter(s => s && s.color > 0 && s.count > 0);
const covered = segs.reduce((a, s) => a + s.count, 0);
if (covered !== totalPixels) {
  console.error(`⚠️ 底边只覆盖 ${covered}/${totalPixels} 像素；该图有永久不可达像素，仍继续生成，但关卡可能不可通关`);
}

// 2) 切车：默认每轮段按 boxMax 切；--lump 按颜色合并成更大的车（制造跨窗口债）
const cars = [];
if (LUMP) {
  const firstRound = {}, totals = {};
  for (const s of segs) {
    if (firstRound[s.color] == null) firstRound[s.color] = s.round;
    totals[s.color] = (totals[s.color] || 0) + s.count;
  }
  const colors = Object.keys(totals).map(Number).sort((a, b) => firstRound[a] - firstRound[b] || a - b);
  for (const color of colors) {
    const max = splitColors.includes(color) ? splitMax : boxMax;
    for (const n of splitCount(totals[color], max)) cars.push({ color, count: n, round: firstRound[color] });
  }
} else {
  for (const s of segs) {
    for (const n of splitCount(s.count)) cars.push({ color: s.color, count: n, round: s.round });
  }
}
const slots = rows * cols;
if (cars.length > slots) {
  console.error(`车 ${cars.length} > 棋盘 ${slots}；请增大 --box-max 或 --rows/--cols`);
  process.exit(1);
}

// 3) 摆盘：轮次早的放顶行（棋盘 row0 = 顶部暴露），轮次晚的放深行
const spools = [];
for (let r = 0; r < rows; r++) spools.push(new Array(cols).fill(null));
let idx = 0;
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const car = cars[idx++];
  spools[r][c] = car
    ? { id: car.color, type: 0, param: 0, count: car.count }
    : { id: -1, type: 0, param: 0, count: 0 };
}

// 3.1) 可选：把相邻同色车成链（制造整组债）
const autoChain = Number(arg('--auto-chain', 0)) || 0;
if (autoChain > 0) {
  let made = 0, cid = 50;
  for (let r = 0; r < rows && made < autoChain; r++) {
    for (let c = 0; c < cols && made < autoChain; c++) {
      const a = spools[r][c];
      if (!(a && a.id > 0) || a.type !== 0) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= rows || nc >= cols) continue;
        const b = spools[nr][nc];
        if (!(b && b.id > 0) || b.type !== 0 || b.id !== a.id) continue;
        a.type = 5; a.param = cid; b.type = 5; b.param = cid;
        made++; cid++;
        break;
      }
    }
  }
  console.log(`自动成链 ${made} 组`);
}

// 4) 守恒自检
const px = {}, by = {};
for (const row of src.blocks) for (const v of row) if (v > 0) px[v] = (px[v] || 0) + 1;
for (const row of spools) for (const s of row) if (s.id > 0) by[s.id] = (by[s.id] || 0) + s.count;
const bad = Object.keys(px).filter(k => (px[k] || 0) !== (by[k] || 0));
if (bad.length) throw new Error('容量不守恒：' + bad.map(k => `${k}:${by[k] || 0}/${px[k]}`).join(' '));

const level = { toprow: R, blocks: src.blocks, maprow: rows, mapcol: cols, spools };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(level, null, 2));

// 5) 底边首测
const lv = A.parseLevel(A.fromGameFormat(level));
const min = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false, bottomOnly: true });
console.log(`源：${path.basename(input)}  ${R}×${C} / 车 ${cars.length} / 棋盘 ${rows}×${cols}`);
console.log(`轮次段 ${segs.length}，底边覆盖 ${covered}/${totalPixels}`);
console.log(`首测：${min.won ? '通关' : '不通'} / 步 ${min.steps} / 峰值 ${min.maxBuffer} / 进度 ${min.progress}%`);
console.log(`已写：${out}`);
