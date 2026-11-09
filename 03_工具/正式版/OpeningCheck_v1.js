#!/usr/bin/env node
'use strict';
/**
 * OpeningCheck_v1 —— M4.6 opening / recovery 检查器
 *
 * 输入：
 *   node OpeningCheck_v1.js <关卡.json> --click <AnimClickSettle.json>
 *   node OpeningCheck_v1.js <关卡.json> --path  <编辑器点击路径.json>
 *
 * 沿给定路线逐步枚举合法车，计算 M/C/F/D：
 *   M = 合法可选车（过容量门）
 *   C = 本步至少消 1px 的选项
 *   F = 本步不新增未完成车的选项
 *   D = 本步新增未完成车的选项
 *
 * 输出（默认人读；--json 机器读）：
 *   - F0 步数 / 最长连续 F0 / 首次 F0
 *   - buffer<5 时 C0 步数（两个候选都 0 消除 = 被迫拿）
 *   - buffer≥1/3/4 时 minF / F/M
 *   - 违约：buffer≥1 时 F<1；连续 F=0>1；buffer<5 时 C=0
 *
 * 只读，不改关卡。
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const S = A.Simulator;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
const clickFile = arg('--click', null);
const pathFile = arg('--path', null);
const asJson = process.argv.includes('--json');
if (!levelFile || (!clickFile && !pathFile)) {
  console.error('用法: node OpeningCheck_v1.js <关卡.json> --click <click.json> | --path <用户路径.json> [--json]');
  process.exit(2);
}

const g = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));
const clone = x => JSON.parse(JSON.stringify(x));

let route = [];
if (clickFile) {
  const c = JSON.parse(fs.readFileSync(clickFile, 'utf8'));
  route = (c.steps || []).map(s => ({ picks: s.picked || [], step: s.step }));
} else {
  const p = JSON.parse(fs.readFileSync(pathFile, 'utf8'));
  route = (p.clicks || []).map(c => ({
    picks: c.picked && c.picked.length ? c.picked : [{ r: c.r, c: c.c }],
    step: c.n
  }));
}

let s = S.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const rows = [];

for (const st of route) {
  const moves = S.listMoves(s).filter(m => !m.blocked);
  const beforeKeys = new Set(s.buffer.map(b => b.key));
  let M = moves.length, C = 0, F = 0, D = 0, full = 0;
  for (const m of moves) {
    const c = clone(s);
    const beforePx = c.eliminatedPixels;
    let ok = false;
    try { ok = S.applyPick(c, m.r, m.c); } catch (e) { }
    if (!ok) continue;
    if (c.eliminatedPixels > beforePx) C++;
    if (m.canConsume) full++;
    const newInc = c.buffer.filter(b => !beforeKeys.has(b.key) && (b.need - b.progress) > 0).length;
    if (newInc > 0) D++; else F++;
  }
  const buf = s.buffer.length;
  const chosen = (st.picks || []).map(p => `${p.r},${p.c}:${p.color ?? ''}:${p.count ?? ''}`).join('+');
  rows.push({ step: st.step, buf, M, C, F, D, full, chosen });

  for (const p of st.picks || []) {
    if (!S.applyPick(s, p.r, p.c)) break;
  }
}

let cur = 0, maxF0 = 0;
for (const r of rows) {
  if (r.F === 0) { cur++; maxF0 = Math.max(maxF0, cur); } else cur = 0;
}
const f0 = rows.filter(r => r.F === 0);
const c0 = rows.filter(r => r.C === 0);
const c0Low = rows.filter(r => r.C === 0 && r.buf < 5);
const hi1 = rows.filter(r => r.buf >= 1);
const hi3 = rows.filter(r => r.buf >= 3);
const hi4 = rows.filter(r => r.buf >= 4);
const f0Low = rows.filter(r => r.F === 0 && r.buf <= 2);
const f0High = rows.filter(r => r.F === 0 && r.buf >= 3);
let curHigh = 0, maxF0High = 0;
for (const r of rows) {
  if (r.F === 0 && r.buf >= 3) { curHigh++; maxF0High = Math.max(maxF0High, curHigh); } else curHigh = 0;
}
const avg = (a, k) => a.length ? a.reduce((x, r) => x + r[k], 0) / a.length : null;
const minF = a => a.length ? Math.min(...a.map(r => r.F)) : null;
const fm = a => a.length ? a.reduce((x, r) => x + r.F / Math.max(1, r.M), 0) / a.length : null;
const violations = {
  // 低 buffer 的 F=0 只是背债，不判死；buffer≥3 还没有安全选项才是问题
  f0AtBuf3: f0High.length,
  f0RunAtBuf3Gt1: maxF0High > 1,
  // buffer<5 时所有候选都 0 消除 = 纯被迫拿
  c0AtBufLt5: c0Low.length,
};
const summary = {
  steps: rows.length,
  avgM: avg(rows, 'M'), avgC: avg(rows, 'C'), avgF: avg(rows, 'F'), avgD: avg(rows, 'D'),
  f0Steps: f0.length, maxF0, firstF0: f0.length ? f0[0].step : null,
  f0Low: f0Low.length, f0High: f0High.length, maxF0AtBuf3: maxF0High,
  c0Steps: c0.length, c0AtBufLt5: c0Low.length, firstC0: c0.length ? c0[0].step : null,
  minF_buf1: minF(hi1), fm_buf1: fm(hi1),
  minF_buf3: minF(hi3), fm_buf3: fm(hi3),
  minF_buf4: minF(hi4), fm_buf4: fm(hi4),
  violations,
  pass: violations.f0AtBuf3 === 0 && !violations.f0RunAtBuf3Gt1 && violations.c0AtBufLt5 === 0,
};

if (asJson) {
  console.log(JSON.stringify({ level: levelFile, route: clickFile || pathFile, summary, rows }, null, 2));
} else {
  console.log(`\n=== ${levelFile.split('/').pop()} · ${(clickFile || pathFile).split('/').pop()} ===`);
  for (const r of rows) {
    const flag = (r.buf >= 3 && r.F < 1) || (r.C === 0 && r.buf < 5) ? ' ❌' : '';
    console.log(`  step ${String(r.step).padStart(2)} buf=${r.buf} M=${r.M} C=${r.C} F=${r.F} D=${r.D} full=${r.full}  ${r.chosen}${flag}`);
  }
  console.log('--- summary ---');
  console.log(JSON.stringify(summary, null, 2));
  console.log(summary.pass ? '→ opening/recovery PASS' : '→ opening/recovery FAIL');
}
process.exit(summary.pass ? 0 : 1);
