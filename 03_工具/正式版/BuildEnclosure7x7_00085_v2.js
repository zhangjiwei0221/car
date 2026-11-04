#!/usr/bin/env node
'use strict';
/**
 * BuildEnclosure7x7_00085_v2
 *
 * 00085 第一阶段 v2：门链 + 跨阶段债车。
 *
 * 用户 2026-11-04 试玩反馈（v1）：
 *   1. 鸡腿消完后，要拿其他象限的颜色，至少要拿四辆完全没用的车；
 *   2. 不用鸡腿完全消掉才出现其他框车，大概消完就可以了；
 *   3. 消完鸡腿完全没有留下债车。
 *
 * v2 结构：
 *   - row0 只放鸡腿阶段车；33:70 是债车（鸡腿吃 47，欠 23，等煎蛋阶段才还）；
 *   - r1c0 是冰闸车 32:23（冰7），鸡腿约 81% 时放行 27 门；
 *   - r2c0 是书27门；r2c1/r2c2 是鸡腿最后两辆余量（1:17 / 30:14）；
 *   - 27 门之后才是书阶段，5/20 门继续封在链上；
 *   - 7×7、40 车、9 黑块、1600/1600。
 *
 * 用法：
 *   node 03_工具/正式版/BuildEnclosure7x7_00085_v2.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const targetFile = path.join(ROOT, 'test/00085_四框_门色独占.txt');
const outDir = path.join(ROOT, '实验关/四象限/00085_最终包围_7x7_第一阶段_v2');
const outFile = path.join(outDir, '关卡_00085_7x7_第一阶段_v2.json');
const planFile = path.join(outDir, '阶段计划_00085_7x7_第一阶段_v2.json');

function loadTarget(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const body = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return body.filter(l => l.trim()).map(l => l.trim().split(/\s+/).map(Number));
}
const blocks = loadTarget(targetFile);
const targetCounts = {};
for (const row of blocks) for (const x of row) if (x > 0) targetCounts[x] = (targetCounts[x] || 0) + 1;

const ROWS = 7, COLS = 7;
const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
function black(r, c) { grid[r][c] = { id: -1, type: 0, param: 0, count: 0 }; }
function put(r, c, id, count, ice = 0) {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) throw new Error(`越界 ${r},${c}`);
  grid[r][c] = { id, type: ice > 0 ? 7 : 0, param: ice, count };
}
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) black(r, c);

// row0：鸡腿阶段 7 辆。33:70 跨阶段债车。
put(0, 0, 29, 60); put(0, 1, 29, 40); put(0, 2, 29, 40);
put(0, 3, 14, 56); put(0, 4, 14, 55); put(0, 5, 33, 70); put(0, 6, 13, 48);

// 门链：冰闸车 -> 下一道门。门本身不加冰。
put(1, 0, 32, 23, 7);              // 鸡腿 ~81% 时放行 27 门
put(2, 0, 27, 60);                 // 书门
put(2, 1, 1, 17); put(2, 2, 30, 14); // 鸡腿最后两辆余量，27 门之后才拿
put(2, 3, 3, 24); put(2, 4, 24, 22); put(2, 5, 31, 44); put(2, 6, 31, 44);

put(3, 0, 26, 36, 20);             // 书阶段闸车
put(3, 1, 30, 43); put(3, 2, 13, 43); put(3, 3, 32, 54);
put(3, 4, 26, 36); put(3, 5, 13, 43); put(3, 6, 27, 58);

put(4, 0, 5, 60);                  // 煎蛋门
put(4, 1, 30, 43); put(4, 2, 13, 43); put(4, 6, 24, 21);

put(5, 0, 2, 37, 24);              // 煎蛋阶段闸车
put(5, 1, 33, 28); put(5, 2, 5, 69); put(5, 3, 2, 37);
put(5, 4, 32, 27); put(5, 5, 3, 23); put(5, 6, 32, 54);

put(6, 0, 20, 60);                 // 三角饭团门
put(6, 1, 20, 46); put(6, 2, 19, 25); put(6, 3, 23, 16);
put(6, 4, 28, 18); put(6, 5, 32, 27); put(6, 6, 26, 36);

const spools = grid.map(row => row.map(x => x ? ({ id: x.id, type: x.type, param: x.param, count: x.count }) : ({ id: -1, type: 0, param: 0, count: 0 })));
const level = { toprow: blocks.length, blocks, maprow: ROWS, mapcol: COLS, spools };
const got = {};
for (const row of spools) for (const x of row) if (x.id > 0) got[x.id] = (got[x.id] || 0) + x.count;
const allColors = [...new Set([...Object.keys(targetCounts), ...Object.keys(got)])].map(Number).sort((a, b) => a - b);
const bad = allColors.filter(c => (got[c] || 0) !== (targetCounts[c] || 0));
const total = spools.flat().filter(x => x.id > 0).reduce((a, x) => a + x.count, 0);
const targetTotal = blocks.flat().filter(x => x > 0).length;
if (bad.length) throw new Error('逐色容量不守恒: ' + bad.map(c => `${c}:${got[c] || 0}/${targetCounts[c] || 0}`).join(' '));
if (total !== targetTotal) throw new Error(`总容量不守恒: ${total}/${targetTotal}`);

const plan = {
  name: '00085 7×7 第一阶段 v2：门链 + 33 跨阶段债车',
  source: 'test/00085_四框_门色独占.txt（框色 29/27/5/20，各自不跨主体）',
  stageOrder: ['鸡腿'],
  stages: [{
    subject: '鸡腿',
    frameColor: 29,
    doorCar: { color: 29, count: 60, position: [0, 0], ice: false },
    allowedFrameColors: [29],
    forbiddenFrameColors: [27, 5, 20],
    forbiddenUntilStep: 6,
    allowedNonFrameColors: [14, 13, 33, 32, 1, 30],
    intent: '前6步只允许鸡腿阶段颜色和框29；书27/煎蛋5/三角饭团20框车不得进入实际可选池',
    completionGate: { subject: '鸡腿', progressPct: 60 }
  }],
  debtEvents: [{
    id: '鸡腿-33跨阶段债',
    color: 33,
    need: 70,
    enterStage: '鸡腿',
    minHoldSteps: 5,
    note: '鸡腿吃 47，欠 23，等煎蛋阶段 5 门打开后释放'
  }],
  verification: {
    board: '7x7',
    blackCells: spools.flat().filter(x => x.id === -1).length,
    cars: spools.flat().filter(x => x.id > 0).length,
    capacity: total,
    targetPixels: targetTotal,
    capacityOk: total === targetTotal,
    note: '第一阶段原型；不是完整四阶段成品关。'
  }
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(level, null, 2));
fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
console.log(`已写关卡：${outFile}`);
console.log(`已写计划：${planFile}`);
console.log(`棋盘 ${ROWS}×${COLS} / 车 ${plan.verification.cars} / 黑块 ${plan.verification.blackCells} / 容量 ${total}/${targetTotal} / 逐色守恒 ✅`);
