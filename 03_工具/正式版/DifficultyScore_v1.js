#!/usr/bin/env node
'use strict';
/**
 * DifficultyScore_v1 —— 难度分（0=很容易，100=很难）
 *
 * 校准：G2 2–13（n=12）；D vs 线上胜率 r=-0.86、失败率 +0.80、关流失 +0.88。
 * 输入：RecoveryVariantCheck / M5Batch 的 variants.json（行里有 arl/opening/choice）。
 *
 * 公式（可解释）：
 *   base = 100 * (0.25*C0n + 0.20*F0n + 0.15*Mn + 0.20*Hn + 0.05*openN + 0.10*tolN + 0.05*midHighN)
 *   C0n=min(C0/2,1), F0n=min(F0/4,1), Mn=clamp((8-M)/5), Hn=clamp((1.5-H)/0.5),
 *   openN=clamp((6-openM)/3), tolN=clamp((18-tol)/16), midHighN=clamp((mid-70)/20)
 *   惩罚：canPass!=✓ +20；peak<=2 && mid>=70 +15；mid>=80 +15
 *
 * 用法：
 *   node DifficultyScore_v1.js --results <variants.json> [--out report.json]
 */
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const resultsFile = arg('--results', null);
const outFile = arg('--out', null);
if (!resultsFile) { console.error('用法: node DifficultyScore_v1.js --results <variants.json> [--out report.json]'); process.exit(2); }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function scoreRow(r) {
  const a = r.arl || {}, o = r.opening || {}, c = r.choice || {};
  const C0 = Number(o.c0AtBufLt5 || 0);
  const F0 = Number(o.f0AtBuf3 || 0);
  const openM = Number(o.openM != null ? o.openM : 0);
  const M = Number(c.M != null ? c.M : 0);
  const H = Number(c.entropy != null ? c.entropy : 0);
  const peak = Number(a.peak != null ? a.peak : 0);
  const mid = Number(a.mid != null ? a.mid : 0);
  const tol = Number(a.tol != null ? a.tol : 0);
  const can = a.canPass;
  const s = {
    C0: clamp(C0 / 2, 0, 1), F0: clamp(F0 / 4, 0, 1),
    M: clamp((8 - M) / 5, 0, 1), H: clamp((1.5 - H) / 0.5, 0, 1),
    open: clamp((6 - openM) / 3, 0, 1), tol: clamp((18 - tol) / 16, 0, 1),
    midHigh: clamp((mid - 70) / 20, 0, 1)
  };
  let d = 100 * (0.25 * s.C0 + 0.20 * s.F0 + 0.15 * s.M + 0.20 * s.H + 0.05 * s.open + 0.10 * s.tol + 0.05 * s.midHigh);
  const penalties = [];
  if (can !== '✓') { d += 20; penalties.push('can✗+20'); }
  if (peak <= 2 && mid >= 70) { d += 15; penalties.push('flatLong+15'); }
  if (mid >= 80) { d += 15; penalties.push('mid>=80+15'); }
  d = clamp(d, 0, 100);
  return { tag: r.tag || r.file || '', D: +d.toFixed(1), hard: d >= 60 ? 'hard' : d >= 40 ? 'mid-hard' : d >= 20 ? 'mid-easy' : 'easy', C0, F0, openM, M, H, peak, mid, tol, can, penalties };
}
const j = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
const rows = (j.rows || j).map(scoreRow).sort((a, b) => b.D - a.D);
console.log('tag'.padEnd(30), 'D', 'band', 'C0', 'F0', 'openM', 'M', 'H', 'peak/mid/tol', 'can');
for (const r of rows) {
  console.log(String(r.tag).padEnd(30), String(r.D).padStart(5), r.hard.padEnd(9), String(r.C0).padStart(2), String(r.F0).padStart(2), String(r.openM).padStart(5), r.M.toFixed(2).padStart(5), r.H.toFixed(2).padStart(5), `${r.peak}/${r.mid}/${r.tol}`.padStart(10), r.can, r.penalties.join(','));
}
if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ tool: 'DifficultyScore_v1', resultsFile, rows }, null, 2)); console.log('saved ' + outFile); }
