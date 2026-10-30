#!/usr/bin/env node
'use strict';
/**
 * 句子表验证器 v717
 * 把一条全知路线的压力曲线自动切成“句子”（节拍），并检查相邻句子是否“交叠”。
 *
 * 句子类型：
 *   教学句   —— 开局 buf 长期 <=1（可自由取）
 *   债务句   —— buf >=4 的连续步（卡点）
 *   中压段   —— buf 2~3
 *   释放句   —— buf 从高位一路降到 <=1
 *   空窗     —— buf <=1 且长度 >=2，且前后都是债务句（= 压力断了）
 *
 * 用法：
 *   node SentenceTable_v717.js <关卡.json> [--json] [--items]
 *   默认不用道具（--items 则允许道具，与生产页口径一致）
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith('--'));
const asJson = argv.includes('--json');
const useItems = argv.includes('--items');
if (!file) { console.error('用法: node SentenceTable_v717.js <关卡.json> [--json] [--items]'); process.exit(1); }

const g = B.readJson(file);
const lv = A.parseLevel(A.fromGameFormat(g));
const limit = g.bufferLimit || lv.bufferLimit || 5;
const high = limit - 1.5;                 // 产品口径的卡点线
const o = A.Solver.runSolver(lv, 0, 1, useItems, false, { capturePreviewStats: true, instantChain: true });
const samples = o.pressureSamples || [];
const picks = o.pickOrder || [];
const buf = samples.map(s => s.buf || 0);
const n = buf.length;

// 每步的“负债明细”：谁在里面、还欠多少
function debtAt(i) {
  const s = samples[i] || {};
  const items = s.items || s.buffer || [];
  return items;
}

// 1) 逐步分类
const cls = buf.map(v => v >= 4 ? 'HIGH' : v >= 2 ? 'MID' : 'LOW');

// 2) 合并成句
const beats = [];
let i = 0;
while (i < n) {
  let j = i;
  while (j + 1 < n && cls[j + 1] === cls[i]) j++;
  beats.push({ kind: cls[i], from: i + 1, to: j + 1, len: j - i + 1, peak: Math.max(...buf.slice(i, j + 1)), min: Math.min(...buf.slice(i, j + 1)) });
  i = j + 1;
}

// 3) 给句子起名字
function nameOf(b, idx, prev, next) {
  if (b.kind === 'HIGH') return '债务句';
  if (b.kind === 'LOW') {
    if (b.to <= 8) return '教学句';
    if (prev && prev.kind === 'HIGH' && b.len >= 2) return '释放句/空窗';
    return '释放句';
  }
  // MID
  if (prev && prev.kind === 'HIGH') return '回落';
  if (next && next.kind === 'HIGH') return '起债';
  return '中压';
}

// 4) 交叠检查：相邻两个债务句之间，LOW 段长度
const overlaps = [];
for (let k = 0; k < beats.length; k++) {
  if (beats[k].kind !== 'HIGH') continue;
  let m = k + 1;
  while (m < beats.length && beats[m].kind !== 'HIGH') m++;
  if (m >= beats.length) break;
  const between = beats.slice(k + 1, m);
  const lowSteps = between.filter(b => b.kind === 'LOW').reduce((a, b) => a + b.len, 0);
  const midSteps = between.filter(b => b.kind === 'MID').reduce((a, b) => a + b.len, 0);
  overlaps.push({
    a: `#${k + 1} ${beats[k].from}-${beats[k].to}`,
    b: `#${m + 1} ${beats[m].from}-${beats[m].to}`,
    lowSteps, midSteps,
    overlapped: lowSteps <= 1,
    gap: lowSteps >= 2 ? lowSteps : 0,
  });
}

// 5) 输出
if (asJson) {
  console.log(JSON.stringify({ file, steps: n, high, buf, beats, overlaps }, null, 2));
  process.exit(0);
}

const pad = (s, w) => { s = String(s); const len = [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0); return s + ' '.repeat(Math.max(0, w - len)); };
console.log(`\n关卡：${file}`);
console.log(`全知：${n} 步 / 峰值 ${Math.max(...buf)} / 卡点线 ${high} / 道具 ${o.itemUses || 0}\n`);
console.log(pad('#', 3) + pad('类型', 12) + pad('步', 10) + pad('长度', 5) + pad('峰值', 5) + '压力条');
beats.forEach((b, idx) => {
  const nm = nameOf(b, idx, beats[idx - 1], beats[idx + 1]);
  const bar = '█'.repeat(Math.min(b.peak, 10));
  console.log(pad(idx + 1, 3) + pad(nm, 12) + pad(`${b.from}-${b.to}`, 10) + pad(b.len, 5) + pad(b.peak, 5) + bar);
});

const gaps = overlaps.filter(x => x.gap > 0);
console.log(`\n交叠检查：${overlaps.length} 对相邻债务句，其中 ${gaps.length} 对存在空窗`);
overlaps.forEach(x => {
  console.log(`  ${x.a}  →  ${x.b}   ${x.overlapped ? '✅ 交叠（空窗≤1步）' : `❌ 空窗 ${x.gap} 步（低谷）`}`);
});
if (gaps.length) {
  console.log(`\n最大空窗：${Math.max(...gaps.map(x => x.gap))} 步`);
  console.log('修复思路：在空窗里补一句“过渡句”（链一辆 unlock 早的车 + 一辆 unlock 晚的车），');
  console.log('或用数字冰把释放车的解冻推迟到空窗之后（param = 目标球数）。');
}
