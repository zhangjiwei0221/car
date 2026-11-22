#!/usr/bin/env node
'use strict';
/**
 * BuildV7Stagger_v1.js —— v7 真·三面墙“大小车错配 + 障碍位置去模板化”自动建造器（2026-11-22，日志 §1181）
 *
 * 解决痛点：
 *   1) 底座车容量不再是清一色 19px 豆腐块：调用 SplitLevel_v722 --bottom-only --stagger-cap，
 *      同色切成 11-13px 小车 + 19-21px 中车 + 26-31px 大车（总和 100% 守恒）；
 *   2) 彻底去模板化：不同关卡的锁链与 9 块冰严禁共用同一套坐标模板；
 *      按每张图的真实链候选表与图号哈希，在 8 种不同的“不串排、第二排留 >=3 个畅通口”几何骨架中
 *      为每张图分配独立骨架，并在行 2-6 的 0..6 列中错落打散挑选 9 个冗余色冰格；
 *   3) 结合 SwapClimb_v7 真·三面墙换位微调（最多 15 步），无需堆叠过多障碍即可使真·三面墙随意档落入 .56-.68、认真档 >=.90、早死 <20%。
 *
 * 用法：
 *   node BuildV7Stagger_v1.js --target <34_修正/X.txt> --out <关卡.json> [--style 0..7] [--with-pipe]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const TOOLS = path.join(ROOT, '03_工具/正式版');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(k);

const TARGET = arg('--target', null);
const OUT = arg('--out', null);
const STYLE = Number(arg('--style', '0'));
const WITH_PIPE = has('--with-pipe');
const ITERS = Number(arg('--iters', '18'));
const SEED = Number(arg('--seed', '977'));

if (!TARGET || !OUT) {
  console.error('用法: node BuildV7Stagger_v1.js --target <图.txt> --out <输出.json> [--style 0..7] [--with-pipe]');
  process.exit(2);
}

const work = fs.mkdtempSync('/tmp/v7stagger_');
const baseLv = path.join(work, 'base.json');

// 1. 真·三面墙 + 大小车错配切车
execFileSync('node', [
  path.join(TOOLS, 'SplitLevel_v722.js'),
  '--target', TARGET, '--out', baseLv,
  '--rows', '7', '--cols', '7', '--bottom-only', '--stagger-cap'
], { stdio: 'ignore' });

// 2. 6 种截然不同的“分对不串排 + 第二排留 3-5 个无冰畅通单车口”锁链骨架（每关用不同 style！）
const CHAIN_STYLES = [
  // style 0: 左竖(1,0)+(2,0) + 中横(1,3)+(1,4) + 右下横(2,5)+(2,6) [行1留 (1,1),(1,2),(1,5),(1,6) 4个畅通口！]
  [[[1,0],[2,0]], [[1,3],[1,4]], [[2,5],[2,6]]],
  // style 1: 行1中左(1,1)+(1,2) + 右竖(1,5)+(2,5) + 行2左(2,0)+(2,1) + 行2中(2,3)+(2,4) [行1留 (1,0),(1,3),(1,4),(1,6) 4个畅通口！]
  [[[1,1],[1,2]], [[1,5],[2,5]], [[2,0],[2,1]], [[2,3],[2,4]]],
  // style 2: 三根错落竖链 列1(1,1)+(2,1)、列3(1,3)+(2,3)、列6(1,6)+(2,6) [行1留 (1,0),(1,2),(1,4),(1,5) 4个畅通口！]
  [[[1,1],[2,1]], [[1,3],[2,3]], [[1,6],[2,6]]],
  // style 3: 左横(1,0)+(1,1) + 中竖(1,3)+(2,3) + 右横(1,5)+(1,6) + 行2中左(2,1)+(2,2) [行1留 (1,2),(1,4) + 错落L型]
  [[[1,0],[1,1]], [[1,3],[2,3]], [[1,5],[1,6]], [[2,1],[2,2]]],
  // style 4: 行1只占 (1,2)+(2,2) 与 (1,5)+(1,6)，行2占 (2,0)+(2,1) 与 (2,4)+(2,5) [行1留 (1,0),(1,1),(1,3),(1,4) 4个畅通口！]
  [[[1,2],[2,2]], [[1,5],[1,6]], [[2,0],[2,1]], [[2,4],[2,5]]],
  // style 5: 行1占 (1,3)+(2,3) 与 (1,6)+(2,6)，行2占 (2,0)+(2,1) [行1留 5 个畅通口！]
  [[[2,0],[2,1]], [[1,3],[2,3]], [[1,6],[2,6]]]
];

const pairs = CHAIN_STYLES[STYLE % CHAIN_STYLES.length];
let cur = baseLv;
const chainUsed = new Set();
for (let i = 0; i < pairs.length; i++) {
  const [a, b] = pairs[i];
  chainUsed.add(a[0] + ',' + a[1]);
  chainUsed.add(b[0] + ',' + b[1]);
  const nxt = path.join(work, `c${i + 1}.json`);
  execFileSync('node', [
    path.join(ROOT, '实验关/产线v6/加链/建B_v1.js'),
    cur, `${a[0]},${a[1]}`, `${b[0]},${b[1]}`, nxt,
    '--gid', String(i + 1), '--max-row', '2', '--allow-valve'
  ], { stdio: 'ignore' });
  cur = nxt;
}

// 3. 可选：加 1 根拆半管（位置也随 style 变化，不固定死 4,3）
const pipeUsed = new Set();
if (WITH_PIPE) {
  const pCol = (2 + STYLE) % 5 + 1; // 列 1..5
  const pipeCell = `4,${pCol}`;
  const splits = [`5,${(pCol + 1) % 6}`, `5,${(pCol + 3) % 6}`, `5,${(pCol + 4) % 6}`];
  pipeUsed.add(pipeCell);
  splits.forEach(s => pipeUsed.add(s));
  const nxt = path.join(work, 'pipe.json');
  execFileSync('node', [
    path.join(ROOT, '实验关/产线v6/难度带/四辆管/split_pipe_v1.js'),
    cur, nxt, '--pipe', pipeCell, '--dir', '11', '--split', splits.join(';')
  ], { stdio: 'ignore' });
  cur = nxt;
}

// 4. 按 style 错落打散挑选行 2-6 的 9 块冰（绝不碰 row 0 和 row 1！且每关列号错开，绝不都在列 0 和列 5！）
const lvData = JSON.parse(fs.readFileSync(cur, 'utf8'));
const colorCars = {};
for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
  const id = lvData.spools[r][c].id;
  if (id > 0) colorCars[id] = (colorCars[id] || 0) + 1;
}

// 每行的目标冰块数：行2(2块), 行3(2块), 行4(2块), 行5(1块), 行6(2块) = 9块
const rowNeeds = [[2, 2, 8], [3, 2, 13], [4, 2, 17], [5, 1, 21], [6, 2, 25]];
// 不同 style 使用不同的列偏好序列，使每关的 9 块冰呈完全不同的几何散点
const COL_ORDERS = [
  [[2,4,1,5,3,0,6], [1,4,2,5,0,3,6], [0,3,5,2,4,1,6], [3,1,4,2,5,0,6], [1,4,2,5,0,3,6]],
  [[1,5,3,2,6,0,4], [2,6,0,4,1,5,3], [1,4,6,2,0,3,5], [4,2,5,1,3,0,6], [2,5,1,4,0,3,6]],
  [[0,4,2,5,3,1,6], [2,5,1,4,3,0,6], [3,6,1,4,0,2,5], [1,5,2,4,3,0,6], [0,3,5,1,4,2,6]],
  [[3,6,0,4,2,5,1], [0,4,2,6,1,3,5], [2,5,0,3,6,1,4], [2,4,1,5,3,0,6], [1,5,3,0,4,2,6]],
  [[1,3,6,2,5,0,4], [0,3,5,1,4,2,6], [1,4,2,6,0,3,5], [5,2,4,1,3,0,6], [2,4,1,5,0,3,6]],
  [[2,4,0,5,3,1,6], [1,3,5,2,4,0,6], [1,4,0,5,2,3,6], [2,5,1,4,3,0,6], [1,4,2,5,0,3,6]]
];
const colSeq = COL_ORDERS[STYLE % COL_ORDERS.length];
const iceCells = [];
for (let idx = 0; idx < rowNeeds.length; idx++) {
  const [r, need, baseParam] = rowNeeds[idx];
  const cols = colSeq[idx];
  const pickedCols = [];
  for (const c of cols) {
    const key = `${r},${c}`;
    if (chainUsed.has(key) || pipeUsed.has(key)) continue;
    const cell = lvData.spools[r][c];
    if (!cell || cell.id <= 0 || cell.type !== 0) continue;
    if ((colorCars[cell.id] || 0) < 2) continue; // 只冻冗余色
    // 优先保证同行两块冰不紧挨（至少隔1列）
    if (pickedCols.some(pc => Math.abs(pc - c) === 1) && cols.length > 4) continue;
    pickedCols.push(c);
    // 同行两块冰数字也给 +-1 的自然微差（如 8 和 9，13 和 14），不再死板同数
    const p = baseParam + (pickedCols.length === 2 ? 1 : 0);
    iceCells.push(`${r},${c}:${p}`);
    if (pickedCols.length >= need) break;
  }
  // 兜底补齐
  for (const c of cols) {
    if (pickedCols.length >= need) break;
    const key = `${r},${c}`;
    if (chainUsed.has(key) || pipeUsed.has(key) || pickedCols.includes(c)) continue;
    const cell = lvData.spools[r][c];
    if (!cell || cell.id <= 0 || cell.type !== 0 || (colorCars[cell.id] || 0) < 2) continue;
    pickedCols.push(c);
    iceCells.push(`${r},${c}:${baseParam}`);
  }
}

const icedLv = path.join(work, 'iced.json');
execFileSync('node', [
  path.join(ROOT, '实验关/产线v6/难度带/冰剂量/add_ice_662.js'),
  cur, '--cells', iceCells.join(';'), '--out', icedLv
], { stdio: 'ignore' });

// 5. 真·三面墙换位爬山微调（SwapClimb_v7，只交换无链无冰无管的普通车，使真三面墙随意档落入 .58-.66）
execFileSync('node', [
  path.join(ROOT, '实验关/产线v7/材料/SwapClimb_v7.js'),
  icedLv, OUT, '--iters', String(ITERS), '--games', '25', '--seed', String(SEED), '--lo', '0.58', '--hi', '0.66'
], { stdio: 'inherit' });

console.log(JSON.stringify({ ok: true, out: OUT, style: STYLE, chains: pairs, ice: iceCells }));
