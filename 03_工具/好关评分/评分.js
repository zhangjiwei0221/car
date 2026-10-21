#!/usr/bin/env node
/**
 * 好关评分：把"好关"写成一组可量化的判据，给已落库的每一关打分
 *
 *   node 评分.js [目录或json…] [--limit N] [--out 结果.csv]
 *
 * 默认扫 输出文件/<批次>/生产文档/关卡数据/ 下的 json（含 board，能直接重跑玩家模拟）。
 * 只读：不生成、不写输出文件。
 *
 * 判据（v3，2026-10-18 定；每条都能由引擎现有函数算出，不依赖人工标注）：
 *   硬门 ① 全知可解
 *        ② 稳健玩家通关率 ≥ 50%（18 局：稳健/冒险/乱点各 6）
 *        ③ 被埋 = 0（量够但够不着的车）
 *        ④ 前期峰窗 ≤ 2.0（不在开局压人）
 *        ⑤ 中后期峰窗 ∈ [3.2, 4.8]（有卡点、不过压）
 *        ⑥ 策略差 ≤ 34 个点（不是"只有一种打法能过"）
 *   参考 ⑦ 独木桥 ≤ 1  ⑧ 无满解步数 ≤ 10  ⑨ 预算判断点 ≥ 6  ⑩ 深层色 ≥ 1
 *
 * 总分 100 = 压力 30 + 公平 30 + 选择 15 + 结构 15 + 节奏 10（只是排序用，判据另列）
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const BIN = path.join(HERE, '..', '..', '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const DEFAULT_ROOT = path.join(HERE, '..', '..', '02_工程', '完整主bin快照_20261012', '输出文件');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
               'playersim.js', 'analysis.js', 'generator.js'];

const sandbox = {
  console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
  WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON
};
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;
const G = A.Generator;

// ---------- 参数 ----------
const argv = process.argv.slice(2);
let outCsv = null, limit = 0;
const roots = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') { outCsv = path.resolve(argv[++i] || ''); continue; }
  if (a === '--limit') { limit = parseInt(argv[++i], 10) || 0; continue; }
  if (a.startsWith('--')) continue;
  roots.push(path.resolve(a));
}
if (!roots.length) roots.push(DEFAULT_ROOT);

function walk(p, out) {
  let st;
  try { st = fs.statSync(p); } catch (e) { return; }
  if (st.isFile()) { if (/\.json$/i.test(p)) out.push(p); return; }
  let ents;
  try { ents = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) walk(path.join(p, e.name), out);
}
let files = [];
roots.forEach(r => walk(r, files));
files = files.filter(f => /关卡数据[\/\\]/.test(f));
files.sort();
if (limit > 0) files = files.slice(-limit);   // 取最近 N 个

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const rows = [];
let bad = 0;

for (const f of files) {
  let d;
  try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { bad++; continue; }
  if (!d || !d.board || !d.board.cells) { bad++; continue; }
  const batch = path.basename(path.dirname(path.dirname(path.dirname(f))));
  let parsed;
  try { parsed = A.parseLevel({ blocks: d.blocks, board: d.board, bufferLimit: d.bufferLimit || 5 }); }
  catch (e) { bad++; continue; }

  const audit = d.audit || {};
  const v2 = (d.chokeV2 && d.chokeV2.worst) || (d.generationEval && d.generationEval.auditV2 && d.generationEval.auditV2.worst) || {};
  let play = null, buried = null;
  try { play = G.chokeV2PlayBatch(parsed, { n: 18 }); } catch (e) {}
  try {
    const b = G.buriedCountOf(parsed);
    buried = (b && typeof b === 'object') ? (b.buried != null ? b.buried : b.stuck) : b;
  } catch (e) {}

  let deep = 0;
  try {
    const li = G.veinLayers(parsed, {});
    if (li) deep = Object.keys(li.colorMinLevel).filter(c => (li.colorMinLevel[c] || 0) >= 3).length;
  } catch (e) {}

  const peakP50 = play && play.lateMax ? play.lateMax.p50 : null;
  const r = {
    batch, name: d.name || path.basename(f, '.json'),
    solved: !!(d.solve && d.solve.completed),
    midLateAudit: audit.midLateMax != null ? audit.midLateMax : null,
    midLate: peakP50 != null ? peakP50 : (audit.midLateMax != null ? audit.midLateMax : null),
    midLateAt: audit.midLateAt != null ? audit.midLateAt : null,
    early: audit.earlyMax != null ? audit.earlyMax : null,
    steady: play ? play.steadyWonPct : null,
    spread: play ? play.spreadPct : null,
    bestWon: play ? play.bestWonPct : null,
    steadyGap: (play && play.bestWonPct != null && play.steadyWonPct != null) ? (play.bestWonPct - play.steadyWonPct) : null,
    peakMin: play ? play.lateMax.min : null,
    peakMax: play ? play.lateMax.max : null,
    peakMean: play ? play.lateMax.mean : null,
    buried,
    bridges: v2.bridges != null ? v2.bridges : null,
    r9: v2.r9 != null ? v2.r9 : null,
    minPick: v2.minPick != null ? v2.minPick : null,
    noGood: v2.noGood != null ? v2.noGood : null,
    diff: d.difficulty != null ? d.difficulty : null,
    deep
  };

  // ---- 判据 ----
  const F = [
    ['可解', r.solved === true],
    ['稳健通关≥50%', r.steady != null && r.steady >= 50],
    ['被埋=0', r.buried != null && r.buried === 0],
    ['前期峰窗≤2', r.early != null && r.early <= 2.0],
    ['中后期峰窗3.2~4.8', r.midLate != null && r.midLate >= 3.2 && r.midLate <= 4.8],
    ['稳打不落后>17', r.steadyGap != null && r.steadyGap <= 17]
  ];
  r.fails = F.filter(x => !x[1]).map(x => x[0]);
  r.hardPass = r.fails.length === 0;

  // ---- 总分（排序用）----
  let sPressure = 0;
  if (r.midLate != null) sPressure = r.midLate >= 3.2 && r.midLate <= 4.5 ? 30 : (r.midLate < 3.2 ? 30 * r.midLate / 3.2 * 0.6 : Math.max(0, 30 - (r.midLate - 4.5) * 10));
  let sFair = 0;
  if (r.steady != null) sFair = r.steady / 100 * 25 + (r.spread != null ? clamp(5 - r.spread / 20, 0, 5) : 0);
  let sChoice = 0;
  if (r.r9 != null) sChoice = clamp(r.r9 / 12, 0, 1) * 10 + (r.noGood != null ? clamp(1 - r.noGood / 10, 0, 1) * 5 : 0);
  let sStruct = 0;
  if (r.bridges != null) sStruct = (r.bridges <= 1 ? 10 : 0) + (r.noGood != null && r.noGood <= 3 ? 5 : 0);
  let sRhythm = 0;
  if (r.midLateAt != null) sRhythm = (r.midLateAt >= 60 && r.midLateAt <= 90) ? 10 : clamp(1 - Math.abs(r.midLateAt - 75) / 40, 0, 1) * 10;
  r.score = Math.round(sPressure + sFair + sChoice + sStruct + sRhythm);
  r.parts = { p: Math.round(sPressure), f: Math.round(sFair), c: Math.round(sChoice), s: Math.round(sStruct), r: Math.round(sRhythm) };
  rows.push(r);
}

// ---------- 汇总 ----------
const n = rows.length;
const rate = k => n ? (rows.filter(r => r[k]).length / n * 100) : 0;
const crit = [
  ['可解', rows.filter(r => r.solved).length],
  ['稳健通关≥50%', rows.filter(r => r.steady != null && r.steady >= 50).length],
  ['被埋=0', rows.filter(r => r.buried === 0).length],
  ['前期峰窗≤2', rows.filter(r => r.early != null && r.early <= 2).length],
  ['中后期峰窗3.2~4.8', rows.filter(r => r.midLate != null && r.midLate >= 3.2 && r.midLate <= 4.8).length],
  ['稳打不落后>17', rows.filter(r => r.steadyGap != null && r.steadyGap <= 17).length],
  ['六条全过', rows.filter(r => r.hardPass).length]
];
const avg = k => {
  const v = rows.map(r => r[k]).filter(x => typeof x === 'number' && isFinite(x));
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const med = k => {
  const v = rows.map(r => r[k]).filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

console.log('扫到关卡数据 ' + files.length + ' 个，可用 ' + n + ' 个' + (bad ? '（跳过 ' + bad + '）' : ''));
console.log('\n── 每条判据的通过数（共 ' + n + ' 关）');
crit.forEach(c => console.log('   ' + c[0].padEnd(20) + String(c[1]).padStart(4) + ' / ' + n + '   ' + (n ? (c[1] / n * 100).toFixed(0) : 0) + '%'));

console.log('\n── 分布（中位数 / 均值）');
[['中后期峰窗', 'midLate'], ['前期峰窗', 'early'], ['稳健通关%', 'steady'], ['策略差', 'spread'],
 ['无满解步数', 'noGood'], ['独木桥', 'bridges'], ['预算判断点', 'r9'], ['难度分', 'diff'], ['深层色', 'deep']]
  .forEach(x => console.log('   ' + x[0].padEnd(12) + '中位 ' + String(med(x[1])).padStart(6) + '   均值 ' + String(avg(x[1]) == null ? '-' : avg(x[1]).toFixed(1)).padStart(6)));

console.log('\n── 总分前 10');
rows.slice().sort((a, b) => b.score - a.score).slice(0, 10).forEach(r => {
  console.log('   ' + String(r.score).padStart(3) + '  ' + r.name.padEnd(28) + ' 峰窗 ' + String(r.midLate).padStart(4) +
    ' 稳健 ' + String(r.steady).padStart(3) + '%  被埋 ' + String(r.buried) + '  ' + (r.fails.length ? '✗ ' + r.fails.join('、') : '✅ 六条全过'));
});

// ---------- CSV ----------
const cols = ['batch', 'name', 'score', 'hardPass', 'fails', 'solved', 'midLate', 'midLateAudit', 'midLateAt', 'early', 'steady', 'spread', 'bestWon', 'steadyGap',
  'peakMin', 'peakMax', 'peakMean', 'buried', 'bridges', 'r9', 'noGood', 'diff', 'deep',
  'p_pressure', 'p_fair', 'p_choice', 'p_struct', 'p_rhythm'];
const csv = [cols.join(',')].concat(rows.map(r => cols.map(k => {
  if (k === 'fails') return '"' + r.fails.join('；') + '"';
  if (k === 'hardPass') return r.hardPass ? 1 : 0;
  if (k === 'p_pressure') return r.parts.p;
  if (k === 'p_fair') return r.parts.f;
  if (k === 'p_choice') return r.parts.c;
  if (k === 'p_struct') return r.parts.s;
  if (k === 'p_rhythm') return r.parts.r;
  const v = r[k];
  return v == null ? '' : v;
}).join(','))).join('\n');
const csvPath = outCsv || path.join(HERE, '好关评分.csv');
fs.writeFileSync(csvPath, '\uFEFF' + csv, 'utf8');
console.log('\nCSV: ' + csvPath);
