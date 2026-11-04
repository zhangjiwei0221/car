#!/usr/bin/env node
'use strict';
/**
 * BuildEnclosure7x7_00085_v1
 *
 * 00085 四象限图的「第一阶段」原型：
 * - 源图 test/00085_四框_门色独占.txt（框色 29/27/5/20，各自只出现在本象限）；
 * - 7×7、9 黑块、40 辆车、容量 1600/1600；
 * - 鸡腿（框29）在顶部入口，书27/煎蛋5/三角饭团20 的门封在深处；
 * - r2c3 是非门冰柱（26:36，冰18），用来把煎蛋门放到第一阶段门槛之后；
 * - 门车均不加冰。
 *
 * 用法：
 *   node 03_工具/正式版/BuildEnclosure7x7_00085_v1.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const targetFile = path.join(ROOT, 'test/00085_四框_门色独占.txt');
const outDir = path.join(ROOT, '实验关/四象限/00085_最终包围_7x7_第一阶段_v1');
const outFile = path.join(outDir, '关卡_00085_7x7_第一阶段_v1.json');
const planFile = path.join(outDir, '阶段计划_00085_7x7_第一阶段_v1.json');

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

// 第一阶段：鸡腿（框29）。12 辆车在顶部入口，29 门首步可吃满。
put(0, 0, 29, 60); put(0, 1, 14, 56); put(0, 2, 13, 24); put(0, 3, 33, 23);
put(0, 4, 32, 23); put(0, 5, 1, 17); put(0, 6, 30, 14);
put(1, 0, 29, 40); put(1, 1, 14, 55); put(1, 2, 13, 24); put(1, 3, 33, 24);
put(2, 0, 29, 40);

// 未来门：书27在 r2c6（黑块封顶），煎蛋5在 r3c3（冰柱封顶），三角饭团20在底行 r6c0。
put(2, 3, 26, 36, 18);
put(2, 6, 27, 60);
put(3, 0, 33, 51); put(3, 1, 13, 43); put(3, 3, 5, 60); put(3, 5, 32, 54); put(3, 6, 26, 36);
put(4, 0, 30, 43); put(4, 1, 13, 43); put(4, 2, 32, 54); put(4, 3, 27, 58);
put(4, 4, 26, 36); put(4, 5, 30, 43); put(4, 6, 24, 43);
put(5, 0, 32, 54); put(5, 1, 13, 43); put(5, 2, 5, 69); put(5, 3, 2, 37);
put(5, 4, 2, 37); put(5, 5, 3, 24); put(5, 6, 3, 23);
put(6, 0, 20, 60); put(6, 1, 20, 46); put(6, 2, 31, 44); put(6, 3, 31, 44);
put(6, 4, 19, 25); put(6, 5, 23, 16); put(6, 6, 28, 18);

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
  name: '00085 7×7 第一阶段：鸡腿入口',
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
  debtEvents: [],
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
