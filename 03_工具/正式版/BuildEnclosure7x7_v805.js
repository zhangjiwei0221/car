#!/usr/bin/env node
'use strict';
/**
 * BuildEnclosure7x7_v805
 *
 * 7×7、9黑块的“第一阶段”原型：
 * - 前6步只允许香肠阶段颜色和红框1；
 * - 15/25/19 框车不得进入实际可选池；
 * - 15门在下方，由非门冰柱封住；
 * - 全部目标像素仍然守恒。
 *
 * 用法：
 *   node 03_工具/正式版/BuildEnclosure7x7_v805.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const targetFile = path.join(ROOT, '输出/四框1px_bfc465e8-b415-4605-a43e-10300c301ea6/final_enclosure/target_enclosure_3px.txt');
const outFile = path.join(ROOT, '实验关/四象限/00030_最终包围_7x7_第一阶段_v1/关卡_7x7_第一阶段_v1.json');
const planFile = path.join(ROOT, '实验关/四象限/00030_最终包围_7x7_第一阶段_v1/阶段计划_7x7_第一阶段_v1.json');

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

// 前两层：香肠阶段入口；r2c3 是非门冰柱，封住下方15门。
put(0, 0, 32, 41); put(0, 1, 22, 85); put(0, 2, 33, 29); put(0, 3, 1, 19);
put(0, 4, 13, 40); put(0, 5, 26, 52); put(0, 6, 32, 40);
put(1, 0, 1, 32); put(1, 1, 22, 26); put(1, 2, 33, 34); put(1, 3, 27, 11);
put(1, 4, 28, 37); put(1, 5, 32, 1);
put(2, 0, 1, 25); put(2, 1, 13, 40); put(2, 2, 33, 44); put(2, 3, 26, 52, 10);
put(3, 0, 27, 64);

// 门15：下方门，左右黑块；上方 r2c3 非门冰柱是唯一入口。
put(3, 3, 15, 60);
// 第二阶段普通车放在门15的下一行，避免前6步露出框15。
put(4, 0, 24, 47); put(4, 1, 15, 60); put(4, 2, 15, 59); put(4, 3, 24, 46);
put(4, 4, 30, 28); put(4, 5, 30, 28); put(4, 6, 29, 34);
// 后两行：剩余香肠色、7/25/14、最终19/31/5。
put(5, 0, 32, 79); put(5, 1, 32, 40); put(5, 2, 33, 38); put(5, 3, 33, 36);
put(5, 4, 28, 36); put(5, 5, 7, 23); put(5, 6, 25, 55);
put(6, 0, 25, 54); put(6, 1, 14, 33); put(6, 2, 19, 51); put(6, 3, 19, 51);
put(6, 4, 19, 51); put(6, 5, 31, 16); put(6, 6, 5, 3);

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
  name: '7×7 第一阶段：香肠入口',
  source: 'target_enclosure_3px.txt',
  stageOrder: ['香肠'],
  stages: [{
    subject: '香肠',
    frameColor: 1,
    doorCar: { color: 1, count: 26, position: [0, 3], ice: false },
    allowedFrameColors: [1],
    forbiddenFrameColors: [15, 25, 19],
    forbiddenUntilStep: 6,
    allowedNonFrameColors: [32, 33, 13, 26, 27, 28, 22],
    intent: '前6步只允许香肠阶段颜色和红框1；15/25/19框车不得进入实际可选池',
    completionGate: { subject: '香肠', progressPct: 60 }
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

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(level, null, 2));
fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
console.log(`已写关卡：${outFile}`);
console.log(`已写计划：${planFile}`);
console.log(`棋盘 ${ROWS}×${COLS} / 车 ${plan.verification.cars} / 黑块 ${plan.verification.blackCells} / 容量 ${total}/${targetTotal} / 逐色守恒 ✅`);
