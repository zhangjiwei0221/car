#!/usr/bin/env node
'use strict';
/**
 * WindowCheck_v753 —— 压力契约验收器（按段比对，不只看总量）
 *
 * 用法：
 *   node WindowCheck_v753.js <关卡.json> [--contract 契约.json] [--ref corner] [--mode a] [--solver run|solve]
 *
 * 契约格式：
 * {
 *   "bufferLine": 3,                                  // 高压线：buffer ≥ 此值算"压"
 *   "segments": [
 *     { "from": 0.00, "to": 0.20, "max4": 0 },        // 该段"到线"步数上限
 *     { "from": 0.20, "to": 0.80, "min4": 1 },        // 该段"到线"步数下限
 *     { "from": 0.80, "to": 1.00, "minRun": 3 }       // 该段"到线"最长连续下限
 *   ]
 * }
 * from/to 用步数百分比（0~1）。未写的项不检查。
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const FILE = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--contract'
  && argv[argv.indexOf(a) - 1] !== '--ref' && argv[argv.indexOf(a) - 1] !== '--mode' && argv[argv.indexOf(a) - 1] !== '--solver');
const REF = arg('--ref', 'corner');
const MODE = arg('--mode', 'a');
const SOLVER = arg('--solver', 'run');
if (!FILE) { console.error('用法: node WindowCheck_v753.js <关卡.json> [--contract 契约.json]'); process.exit(1); }

const DEFAULT_CONTRACT = {
  bufferLine: 3,
  segments: [
    { from: 0.00, to: 0.20, max4: 1 },   // 前期允许 1 步挂账（2026-11-02 用户定）
    { from: 0.20, to: 0.80 },
    { from: 0.80, to: 1.00, minRun: 3 },
  ],
};
const contractPath = arg('--contract', '');
const C = contractPath ? JSON.parse(fs.readFileSync(contractPath, 'utf8')) : DEFAULT_CONTRACT;
const LINE = Number(C.bufferLine || 3);

const A = B.loadSolver(REF);
const g = B.readJson(FILE);
const lv = A.parseLevel(A.fromGameFormat(g));
let buf, solved, boxes;
if (SOLVER === 'solve') {
  const r = A.Solver.solve(lv, { timeBudgetMs: 20000 });
  buf = (r.stepBufferHistory || []).slice(); solved = !!r.completed;
  boxes = (r.completedBoxes || 0) + '/' + (r.totalBoxes || 0);
} else {
  const r = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  buf = (r.pressureSamples || []).map(s => s.buf || 0); solved = !!r.completed;
  boxes = (r.completedBoxes || 0) + '/' + (r.totalBoxes || 0);
}

const N = buf.length;
function segStats(from, to) {
  const a = Math.round(N * from), b = Math.round(N * to);
  const sub = buf.slice(a, b);
  let run = 0, cur = 0;
  for (const v of sub) { if (v >= LINE) { cur++; run = Math.max(run, cur); } else cur = 0; }
  return { a: a + 1, b, steps: sub.length, hit: sub.filter(v => v >= LINE).length, run, peak: Math.max(0, ...sub) };
}

console.log(`file=${FILE}`);
console.log(`口径=${SOLVER} ref=${REF} mode=${MODE} 步数=${N} 可通关=${solved} 盒=${boxes} 高压线=${LINE}`);
console.log('');
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
console.log(pad('段', 3) + pad('区间', 14) + padl('步数', 5) + padl('到线', 5) + padl('连续', 5) + padl('峰值', 5) + '  ' + pad('要求', 24) + '判定');
let fails = 0;
for (let i = 0; i < C.segments.length; i++) {
  const s = C.segments[i];
  const st = segStats(s.from, s.to);
  const req = [];
  let ok = true;
  if (s.max4 != null) { req.push(`max=${s.max4}`); if (st.hit > s.max4) ok = false; }
  if (s.min4 != null) { req.push(`min=${s.min4}`); if (st.hit < s.min4) ok = false; }
  if (s.minRun != null) { req.push(`连续≥${s.minRun}`); if (st.run < s.minRun) ok = false; }
  if (!ok) fails++;
  console.log(pad(i + 1, 3) + pad(`${(s.from * 100) | 0}%-${(s.to * 100) | 0}%`, 14)
    + padl(st.steps, 5) + padl(st.hit, 5) + padl(st.run, 5) + padl(st.peak, 5)
    + '  ' + pad(req.join(' ') || '—', 24) + (ok ? '✅' : '❌'));
}
console.log('');
console.log(`总判定：${fails === 0 ? '✅ PASS' : `❌ FAIL（${fails}/${C.segments.length} 段不合格）`}`);
if (!solved) console.log('⚠️ 不可通关，契约判定无意义');
process.exit(fails === 0 && solved ? 0 : 1);
