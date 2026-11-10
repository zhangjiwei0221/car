#!/usr/bin/env node
'use strict';
/**
 * ChoiceSpaceCheck_v1 —— 选择空间/可学习性检查
 *
 * 目的：tol 只说明“求解器有赢法”，不说明“玩家找得到/看得出差别”。
 * 本工具沿 free-first 路线逐步枚举合法选项，量：
 *   M/C/F/D        合法 / 能消 / 不加债 / 加债选项数
 *   distinct       不同后果的选项占比（后果签名 = dead/buffer/debt/gain/nextM/完成数）
 *   entropy        选项后果的熵（越高 = 选项越有差别）
 *   gainSpread     各选项“本步消除量”的标准差
 *   debtSpread     各选项“剩余债务”的标准差
 *   bestGap        最优选项与次优选项的价值差（越小 = 越像抛硬币）
 *   forced         M<=1 或 C=0（没得选 / 纯被迫）
 *   fakeChoice     M>1 但 distinct<0.5（选项多，后果看起来一样）
 *   overload       M>=8（选项过多）
 *
 * 用法：
 *   node ChoiceSpaceCheck_v1.js <关卡.json | 目录> [--out report.json] [--limit N] [--max-steps N]
 *
 * 输出：每关一行 + JSON（含逐步明细）。只读，不改关卡。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
const outFile = arg('--out', null);
const limit = Number(arg('--limit', 0)) || 0;
const maxSteps = Number(arg('--max-steps', 0)) || 80;
if (!input) {
  console.error('用法: node ChoiceSpaceCheck_v1.js <关卡.json | 目录> [--out report.json] [--limit N] [--max-steps N]');
  process.exit(2);
}

function collect(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f));
}
function isLevel(g) { return !!(g && g.toprow && Array.isArray(g.blocks) && Array.isArray(g.spools)); }
function clone(s) { return JSON.parse(JSON.stringify(s)); }
function legal(s) { return A.Simulator.listMoves(s).filter(m => !m.blocked); }
function bucket(x) {
  if (x <= 0) return 0;
  if (x <= 2) return 1;
  if (x <= 5) return 2;
  if (x <= 10) return 3;
  if (x <= 20) return 4;
  return 5;
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length);
}
function entropy(keys) {
  const cnt = {};
  for (const k of keys) cnt[k] = (cnt[k] || 0) + 1;
  const n = keys.length;
  let h = 0;
  for (const k of Object.keys(cnt)) { const p = cnt[k] / n; h -= p * Math.log(p); }
  return h;
}
function evalMove(s, m) {
  const c = clone(s);
  const beforePx = c.eliminatedPixels;
  const doneBefore = c.completedBoxes;
  if (!A.Simulator.applyPick(c, m.r, m.c)) return null;
  const gain = c.eliminatedPixels - beforePx;
  const bufAfter = c.buffer.length;
  const delta = c.completedBoxes - doneBefore;
  const debtPx = c.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
  const noMoves = c.eliminatedPixels < c.totalPixels && legal(c).length === 0;
  const dead = c.overflow || bufAfter > c.bufferLimit || (bufAfter >= c.bufferLimit && delta === 0) || noMoves;
  const nextM = c.eliminatedPixels >= c.totalPixels ? 0 : legal(c).length;
  return { m, c, gain, bufAfter, debtPx, delta, dead, nextM };
}
function analyzeStep(s, step) {
  const moves = legal(s);
  const beforeKeys = new Set(s.buffer.map(b => b.key));
  const evals = [];
  for (const m of moves) {
    const e = evalMove(s, m);
    if (!e) continue;
    e.newInc = e.c.buffer.filter(b => !beforeKeys.has(b.key) && (b.need - b.progress) > 0).length;
    e.sig = [e.dead ? 1 : 0, Math.min(e.bufAfter, 6), bucket(e.debtPx), bucket(e.gain), Math.min(e.nextM, 10), e.delta].join('|');
    e.value = (e.dead ? -1000 : 0) + e.gain * 10 - e.debtPx * 0.5 - e.bufAfter * 3 + e.nextM * 2;
    evals.push(e);
  }
  const M = moves.length, C = evals.filter(e => e.gain > 0).length, D = evals.filter(e => e.newInc > 0).length, F = evals.length - D;
  const sigs = evals.map(e => e.sig);
  const distinct = new Set(sigs).size;
  const distinctRatio = M ? distinct / M : 0;
  const gains = evals.map(e => e.gain);
  const debts = evals.map(e => e.debtPx);
  const vals = evals.map(e => e.value).sort((a, b) => b - a);
  const bestGap = vals.length >= 2 ? vals[0] - vals[1] : 0;
  const fakeChoice = M > 1 && distinctRatio < 0.5;
  const forced = M <= 1 || C === 0;
  const overload = M >= 8;
  // 选择 free-first：先能吃完、再吃得多、再债少
  let best = null;
  for (const e of evals) {
    const score = [e.dead ? 0 : 1, e.bufAfter === 0 ? 1 : 0, e.gain, -e.bufAfter, -e.debtPx, -e.m.r, -e.m.c];
    if (!best || cmp(score, best.score) > 0) best = { e, score };
  }
  return {
    step, M, C, F, D, distinct, distinctRatio, entropy: entropy(sigs), gainSpread: std(gains), debtSpread: std(debts),
    bestGap, forced, fakeChoice, overload, chosen: best ? { r: best.e.m.r, c: best.e.m.c } : null,
    options: evals.map(e => ({ r: e.m.r, c: e.m.c, gain: e.gain, bufferAfter: e.bufAfter, debtPx: e.debtPx, dead: e.dead, nextM: e.nextM, value: +e.value.toFixed(2) }))
  };
}
function cmp(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }

function analyzeLevel(lv) {
  const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const steps = [];
  for (let i = 0; i < maxSteps; i++) {
    if (s.eliminatedPixels >= s.totalPixels) break;
    const st = analyzeStep(s, steps.length + 1);
    steps.push(st);
    if (!st.chosen) break;
    const completedBefore = s.completedBoxes;
    if (!A.Simulator.applyPick(s, st.chosen.r, st.chosen.c)) break;
    if (s.eliminatedPixels >= s.totalPixels) break;
    const dead = s.overflow || s.buffer.length > s.bufferLimit || (s.buffer.length >= s.bufferLimit && s.completedBoxes === completedBefore) || legal(s).length === 0;
    if (dead) break;
  }
  const sum = k => steps.reduce((a, x) => a + x[k], 0);
  return {
    won: s.eliminatedPixels >= s.totalPixels,
    steps: steps.length,
    avgM: mean(steps.map(x => x.M)),
    avgC: mean(steps.map(x => x.C)),
    avgF: mean(steps.map(x => x.F)),
    avgD: mean(steps.map(x => x.D)),
    avgDistinct: mean(steps.map(x => x.distinctRatio)),
    avgEntropy: mean(steps.map(x => x.entropy)),
    avgGainSpread: mean(steps.map(x => x.gainSpread)),
    avgDebtSpread: mean(steps.map(x => x.debtSpread)),
    avgBestGap: mean(steps.map(x => x.bestGap)),
    forcedSteps: steps.filter(x => x.forced).length,
    fakeChoiceSteps: steps.filter(x => x.fakeChoice).length,
    overloadSteps: steps.filter(x => x.overload).length,
    detail: steps
  };
}

const files = collect(input).slice(0, limit || undefined);
const rows = [];
for (const file of files) {
  let g;
  try { g = B.readJson(file); } catch (e) { rows.push({ file, error: 'read: ' + e.message }); continue; }
  if (!isLevel(g)) { rows.push({ file, error: 'not a level' }); continue; }
  const lv = A.parseLevel(A.fromGameFormat(g));
  const r = analyzeLevel(lv);
  const row = { file: path.basename(file), ...r };
  rows.push(row);
  console.log(`${String(row.file).padEnd(30)} steps=${r.steps} won=${r.won ? 'Y' : 'N'} M=${r.avgM.toFixed(2)} C=${r.avgC.toFixed(2)} F=${r.avgF.toFixed(2)} D=${r.avgD.toFixed(2)} distinct=${r.avgDistinct.toFixed(2)} entropy=${r.avgEntropy.toFixed(2)} gainSpread=${r.avgGainSpread.toFixed(2)} debtSpread=${r.avgDebtSpread.toFixed(1)} bestGap=${r.avgBestGap.toFixed(1)} forced=${r.forcedSteps} fake=${r.fakeChoiceSteps} overload=${r.overloadSteps}`);
}
const summary = {
  levels: rows.filter(r => !r.error).length,
  errors: rows.filter(r => r.error).length,
  won: rows.filter(r => r.won).length
};
console.log('\n=== summary ===');
console.log(JSON.stringify(summary, null, 2));
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify({ tool: 'ChoiceSpaceCheck_v1', summary, rows }, null, 2));
  console.log('saved ' + outFile);
}
