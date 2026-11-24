#!/usr/bin/env node
'use strict';
// 派工#002 结构验收：容量守恒（含管道队列）/ 5 对阶梯链 / 7 冰靶向 / 终局 2x2
const fs = require('fs');
const crypto = require('crypto');
const f = process.argv[2];
const mode = process.argv[3] || 'v6';
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
const R = d.spools.length, C = d.spools[0].length;

let px = 0; const colorPx = {};
for (const row of d.blocks) for (const v of row) if (v > 0) { px++; colorPx[v] = (colorPx[v] || 0) + 1; }
let cap = 0; const colorCap = {}, colorCars = {};
for (const row of d.spools) for (const s of row) {
  if (s && s.id > 0) {
    cap += s.count; colorCap[s.id] = (colorCap[s.id] || 0) + s.count;
    if (s.type !== 7) colorCars[s.id] = (colorCars[s.id] || 0) + 1;
  } else if (s && s.type === 11 && Array.isArray(s.param)) {
    for (const q of s.param) { if (q.id > 0) { cap += q.count; colorCap[q.id] = (colorCap[q.id] || 0) + q.count; } }
  }
}
const mism = [];
for (const k of new Set([...Object.keys(colorPx), ...Object.keys(colorCap)]))
  if ((colorPx[k] || 0) !== (colorCap[k] || 0)) mism.push({ color: k, px: colorPx[k] || 0, cap: colorCap[k] || 0 });

// 链组
const chainGroups = {};
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = d.spools[r][c];
  if (s && s.type === 5) { (chainGroups[s.param] = chainGroups[s.param] || []).push([r, c]); }
}
const chainSizes = Object.values(chainGroups).map(g => g.length);
const pairCount = chainSizes.filter(n => n === 2).length;
const tripleCount = chainSizes.filter(n => n === 3).length;

// 冰
const ice = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = d.spools[r][c];
  if (s && s.type === 7) ice.push({ r, c, p: s.param, id: s.id, count: s.count, cars: colorCars[s.id] || 0 });
}
const deep = ice.filter(x => x.r >= 4 && x.r <= 6);
const deepWindow = deep.filter(x => x.p >= 18 && x.p <= 31);
const scarce = deep.filter(x => x.cars < 3);

// 管道
let pipeCells = 0, pipeQueue = 0;
for (const row of d.spools) for (const s of row) if (s && s.type === 11) { pipeCells++; pipeQueue += (s.param || []).length; }

// 2x2
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
  climax['5,2'].core > 0 && climax['5,4'].core > 0 && climax['5,2'].id !== climax['6,2'].id && climax['5,4'].id !== climax['6,4'].id);

const md5 = crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex').slice(0, 8);
const checks = {
  conservation: px === cap && mism.length === 0,
  chains4to5: pairCount >= 4 && pairCount <= 5,
  ice7: ice.length === 7,
  deep3: deepWindow.length >= 3,
  noScarceIce: scarce.length === 0,
  climaxOk
};
const out = {
  file: f, md5, px, cap, conservation: checks.conservation, colorMismatch: mism,
  chainGroups: chainSizes, pairCount, tripleCount,
  pipeCells, pipeQueue, iceCount: ice.length, maxIce: Math.max(0, ...ice.map(x => x.p)),
  deepWindowCount: deepWindow.length, deepIce: deep, scarceIce: scarce,
  climax, climaxOk, checks, accept002: Object.values(checks).every(Boolean)
};
console.log(JSON.stringify(out, null, 2));
