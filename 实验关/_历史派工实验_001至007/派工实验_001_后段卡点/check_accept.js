#!/usr/bin/env node
'use strict';
// 派工#001 验收检查：容量守恒（含管道队列）/ 逐色守恒 / 冰块数与位置 / row4..6 深水冰 / 终局 2x2 机关
const fs = require('fs');
const crypto = require('crypto');
const f = process.argv[2];
const mode = process.argv[3] || 'v6'; // v6 | v7, 仅影响 core/shell 判定
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
const R = d.spools.length, C = d.spools[0].length;

let px = 0; const colorPx = {};
for (const row of d.blocks) for (const v of row) if (v > 0) { px++; colorPx[v] = (colorPx[v] || 0) + 1; }

// 盘面车 + 管道队列车（type 11 param 为 [{id,count}]）都要计入容量
let cap = 0, empty = 0, pipeQueueCars = 0; const colorCap = {}, colorOnBoard = {}, colorAll = {};
for (const row of d.spools) for (const s of row) {
  if (!s || !(s.id > 0)) { empty++; if (s && s.type === 11 && Array.isArray(s.param)) {
      for (const q of s.param) {
        if (!(q.id > 0)) continue;
        cap += q.count; pipeQueueCars++;
        colorCap[q.id] = (colorCap[q.id] || 0) + q.count;
        colorAll[q.id] = (colorAll[q.id] || 0) + 1;
      }
    }
    continue;
  }
  cap += s.count; colorCap[s.id] = (colorCap[s.id] || 0) + s.count;
  colorOnBoard[s.id] = (colorOnBoard[s.id] || 0) + 1;
  colorAll[s.id] = (colorAll[s.id] || 0) + 1;
}
const mism = [];
for (const k of new Set([...Object.keys(colorPx), ...Object.keys(colorCap)]))
  if ((colorPx[k] || 0) !== (colorCap[k] || 0)) mism.push({ color: k, px: colorPx[k] || 0, cap: colorCap[k] || 0 });

const ice = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = d.spools[r][c];
  if (s && s.type === 7) ice.push({ r, c, p: s.param, id: s.id, count: s.count, cars: colorAll[s.id] || 0, onBoard: colorOnBoard[s.id] || 0 });
}
const deep = ice.filter(x => x.r >= 4 && x.r <= 6);
const deepWindow = ice.filter(x => x.r >= 4 && x.r <= 6 && x.p >= 18 && x.p <= 31);
const minColorCars = ice.filter(x => x.r >= 4 && x.cars < 3);

// core / shell 判定（与建造器一致）
const corePx = {}, shellPx = {};
if (mode === 'v7') {
  const coreEnd = Math.floor(d.blocks.length * 0.25), shellEnd = Math.floor(d.blocks.length * 0.48);
  for (let r = 0; r < d.blocks.length; r++) for (let c = 0; c < d.blocks[0].length; c++) {
    const v = d.blocks[r][c]; if (v <= 0) continue;
    if (r < coreEnd) corePx[v] = (corePx[v] || 0) + 1;
    else if (r < shellEnd) shellPx[v] = (shellPx[v] || 0) + 1;
  }
} else {
  const B = d.blocks.length, W = d.blocks[0].length;
  for (let r = 0; r < B; r++) for (let c = 0; c < W; c++) {
    const v = d.blocks[r][c]; if (v <= 0) continue;
    const dd = Math.min(r, B - 1 - r, c, W - 1 - c);
    if (dd >= Math.floor(Math.min(B, W) * 0.38)) corePx[v] = (corePx[v] || 0) + 1;
    else if (dd >= Math.floor(Math.min(B, W) * 0.25)) shellPx[v] = (shellPx[v] || 0) + 1;
  }
}
const cell = (r, c) => { const s = d.spools[r][c]; return s ? { id: s.id, type: s.type, count: s.count, core: corePx[s.id] || 0, shell: shellPx[s.id] || 0 } : null; };
const climax = { '5,2': cell(5, 2), '5,4': cell(5, 4), '6,2': cell(6, 2), '6,4': cell(6, 4) };
const climaxOk = !!(climax['5,2'] && climax['5,4'] && climax['6,2'] && climax['6,4'] &&
  climax['5,2'].core > 0 && climax['5,4'].core > 0 &&
  climax['5,2'].id !== climax['6,2'].id && climax['5,4'].id !== climax['6,4'].id);

const md5 = crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex').slice(0, 8);
const out = {
  file: f, md5,
  px, cap, conservation: px === cap, emptyCells: empty, pipeQueueCars,
  colorMismatch: mism,
  iceCount: ice.length, deepIceCount: deep.length, deepWindowCount: deepWindow.length,
  deepIce: deep, deepIceOnScarceColor: minColorCars,
  climax, climaxOk
};
console.log(JSON.stringify(out, null, 2));
if (!(px === cap) || mism.length) process.exit(1);
if (ice.length !== 7) process.exit(2);
if (deepWindow.length < 3) process.exit(3);
if (minColorCars.length) process.exit(4);
if (!climaxOk) process.exit(5);
