#!/usr/bin/env node
'use strict';
/**
 * BuildFinalEnclosure_v803
 *
 * 把 final_enclosure 目标图编译成“四阶段门车 + 非门冰柱”样板。
 * 只负责生成可验证的关卡和阶段计划，不把 StagePlanCheck 通过冒充全量验收。
 *
 * 用法：
 *   node 03_工具/正式版/BuildFinalEnclosure_v803.js
 *   node 03_工具/正式版/BuildFinalEnclosure_v803.js --out <level.json> --plan <plan.json>
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const targetFile = path.join(ROOT, '输出/四框1px_bfc465e8-b415-4605-a43e-10300c301ea6/final_enclosure/target_enclosure_3px.txt');
const outFile = path.resolve(arg('--out', path.join(ROOT, '实验关/四象限/00030_最终包围_阶段样板_v1/关卡_最终包围_v1.json')));
const planFile = path.resolve(arg('--plan', path.join(ROOT, '实验关/四象限/00030_最终包围_阶段样板_v1/阶段计划_最终包围_v1.json')));

function loadTarget(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const body = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return body.filter(l => l.trim()).map(l => l.trim().split(/\s+/).map(Number));
}
const blocks = loadTarget(targetFile);
const R = blocks.length, C = blocks[0].length;
const targetCounts = {};
for (const row of blocks) for (const x of row) if (x > 0) targetCounts[x] = (targetCounts[x] || 0) + 1;

const ROWS = 10, COLS = 7;
const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
function black(r, c) { grid[r][c] = { id: -1, type: 0, param: 0, count: 0, stage: 0, role: 'black' }; }
function put(r, c, id, count, stage, role, ice = 0) {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) throw new Error(`越界 ${r},${c}`);
  grid[r][c] = { id, type: ice > 0 ? 7 : 0, param: ice, count, stage, role };
}
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) black(r, c);

// 第一段：香肠。顶部保留 7 个入口；第 4 行 c3 是非门冰柱，
// 它直接封住第二段门 15 的唯一上方入口。
put(0, 0, 32, 40, 1, 'stage1-white');
put(0, 3, 1, 26, 1, 'stage1-door-1');
put(0, 4, 13, 27, 1, 'stage1');
put(0, 6, 32, 40, 1, 'stage1-white');
put(1, 0, 1, 25, 1, 'stage1');
put(1, 1, 22, 37, 1, 'stage1');
put(1, 2, 27, 37, 1, 'stage1');
put(1, 4, 28, 37, 1, 'stage1');
put(1, 5, 33, 37, 1, 'stage1');
put(2, 0, 32, 40, 1, 'stage1-white');
put(2, 1, 26, 35, 1, 'stage1');
put(2, 2, 33, 36, 1, 'stage1');
put(2, 4, 22, 37, 1, 'stage1');
put(3, 0, 1, 25, 1, 'stage1');
put(3, 2, 13, 23, 1, 'stage1');
put(3, 3, 33, 29, 1, 'stage1-ice-blocker', 10);
put(3, 4, 32, 35, 1, 'stage1-white');
put(3, 5, 26, 35, 1, 'stage1');

// 第二段：香蕉。门 15 在 c3，左右是黑块，只有上面的冰柱能打开它。
put(4, 0, 24, 36, 2, 'stage2');
put(4, 1, 15, 45, 2, 'stage2');
put(4, 3, 15, 44, 2, 'stage2-door-15');
put(4, 5, 30, 28, 2, 'stage2');
put(5, 0, 15, 45, 2, 'stage2');
put(5, 1, 24, 31, 2, 'stage2');
put(5, 2, 30, 28, 2, 'stage2');
put(5, 3, 29, 34, 2, 'stage2');
put(5, 4, 7, 23, 2, 'stage2');
put(5, 5, 15, 45, 2, 'stage2');
put(5, 6, 24, 26, 2, 'stage2');

// 第三段：奶茶。25 车全部藏在门 25 后面；门上方只有一根非门冰柱。
// 行 6 的 c2/c4 是黑墙，防止侧向提前露出 25。
put(6, 0, 33, 36, 3, 'stage3');
put(6, 1, 14, 33, 3, 'stage3');
put(6, 3, 26, 34, 3, 'stage3-ice-blocker', 30);
put(6, 5, 22, 37, 3, 'stage3');
put(6, 6, 28, 36, 3, 'stage3');
put(7, 0, 33, 43, 3, 'stage3');
put(7, 2, 25, 37, 3, 'stage3');
put(7, 3, 25, 36, 3, 'stage3-door-25');
put(7, 4, 25, 36, 3, 'stage3');
put(7, 5, 13, 30, 3, 'stage3');
put(7, 6, 27, 38, 3, 'stage3');
put(8, 3, 32, 46, 3, 'stage3-white-final-debt', 6);

// 第四段：猕猴桃。最后一行才有 19/31/5；31 在门 19 的右侧，
// 门 19 未取走前不会被暴露。
put(9, 0, 5, 3, 4, 'stage4');
put(9, 1, 19, 31, 4, 'stage4');
put(9, 2, 19, 31, 4, 'stage4');
put(9, 3, 19, 30, 4, 'stage4-door-19');
put(9, 4, 19, 31, 4, 'stage4');
put(9, 5, 31, 16, 4, 'stage4-enclosure');
put(9, 6, 19, 30, 4, 'stage4');

const spools = grid.map(row => row.map(x => x ? ({ id: x.id, type: x.type, param: x.param, count: x.count }) : ({ id: -1, type: 0, param: 0, count: 0 })));
const level = { toprow: R, blocks, maprow: ROWS, mapcol: COLS, spools };
const got = {};
for (const row of spools) for (const x of row) if (x.id > 0) got[x.id] = (got[x.id] || 0) + x.count;
const allColors = [...new Set([...Object.keys(targetCounts), ...Object.keys(got)])].map(Number).sort((a, b) => a - b);
const bad = allColors.filter(c => (got[c] || 0) !== (targetCounts[c] || 0));
const total = spools.flat().filter(x => x.id > 0).reduce((a, x) => a + x.count, 0);
const targetTotal = blocks.flat().filter(x => x > 0).length;
if (bad.length) throw new Error('逐色容量不守恒: ' + bad.map(c => `${c}:${got[c] || 0}/${targetCounts[c] || 0}`).join(' '));
if (total !== targetTotal) throw new Error(`总容量不守恒: ${total}/${targetTotal}`);

const S1 = [1, 32, 33, 13, 26, 27, 28, 22];
const S2 = [...S1, 15, 24, 30, 29, 7];
const S3 = [...S2, 25, 14];
const S4 = [...S3, 19, 31, 5];
const plan = {
  name: '最终包围色四阶段样板 v1',
  source: 'target_enclosure_3px.txt',
  stageOrder: ['香肠', '香蕉', '奶茶', '猕猴桃'],
  stages: [
    {
      subject: '香肠', frameColor: 1,
      doorCar: { color: 1, count: 26, position: [0, 3], ice: false },
      allowedFrameColors: [1], forbiddenFrameColors: [15, 25, 19],
      allowedNonFrameColors: S1.filter(x => x !== 1),
      intent: '先只开香肠的框色与香肠主色；15/25/19 门车全部藏在非门冰柱后',
      completionGate: { subject: '香肠', progressPct: 60 }
    },
    {
      subject: '香蕉', frameColor: 15,
      doorCar: { color: 15, count: 44, position: [4, 3], ice: false },
      allowedFrameColors: [1, 15], forbiddenFrameColors: [25, 19],
      allowedNonFrameColors: S2.filter(x => x !== 1 && x !== 15),
      intent: '香肠达到门槛后，15 门才从冰柱下方进入；24/30/29/7 在香蕉段承担普通车',
      completionGate: { subject: '香蕉', progressPct: 60 }
    },
    {
      subject: '奶茶', frameColor: 25,
      doorCar: { color: 25, count: 36, position: [7, 3], ice: false },
      allowedFrameColors: [1, 15, 25], forbiddenFrameColors: [19],
      allowedNonFrameColors: S3.filter(x => x !== 1 && x !== 15 && x !== 25),
      intent: '25 门在第二根非门冰柱后；14 与共享色作为奶茶段普通车',
      completionGate: { subject: '奶茶', progressPct: 60 }
    },
    {
      subject: '猕猴桃', frameColor: 19,
      doorCar: { color: 19, count: 30, position: [9, 3], ice: false },
      allowedFrameColors: [1, 15, 25, 19], forbiddenFrameColors: [],
      allowedNonFrameColors: S4.filter(x => ![1, 15, 25, 19].includes(x)),
      intent: '最后一行才是 19 门；31 在门后，白色 32 的未完成债务必须等 31 包围打开',
      completionGate: { subject: '猕猴桃', progressPct: 100 }
    }
  ],
  debtEvents: [
    { id: 'white_32_final_enclosure', color: 32, need: 46, enterStage: '奶茶', releaseStage: '猕猴桃', minHoldSteps: 9, releaseRequiresColor: 31, expectedReleaseRemaining: 9 }
  ],
  verification: {
    targetFile,
    targetPixels: targetTotal,
    capacity: total,
    capacityOk: total === targetTotal,
    board: `${ROWS}x${COLS}`,
    note: '阶段结构样板；StagePlanCheck 通过不等于 ArlCheck 全量通过。'
  }
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.mkdirSync(path.dirname(planFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(level, null, 2));
fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
console.log(`已写关卡：${outFile}`);
console.log(`已写计划：${planFile}`);
console.log(`棋盘 ${ROWS}×${COLS} / 车 ${spools.flat().filter(x => x.id > 0).length} / 容量 ${total}/${targetTotal} / 逐色守恒 ✅`);
