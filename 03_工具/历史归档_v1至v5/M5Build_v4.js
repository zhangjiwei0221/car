#!/usr/bin/env node
'use strict';
/**
 * M5Build_v4 —— 路线条件化 reach 容量改写
 *
 * 用法：
 *   node M5Build_v4.js <base.recipe.json> --outdir <dir> [--iters 3] [--margin 10] [--seed 1]
 *
 * 每轮：
 *   1. BuildFromRecipe 生成关卡；
 *   2. ReachabilityCurve_v1 跑 6 条真实路线，拿每辆车 env.med reach；
 *   3. 每色选一辆“债车”（maxDebt 最大），容量 = med + margin（8..90）；
 *   4. 其余同色车按剩余总量重分；
 *   5. 重建 + ArlCheck/PlayerEngine/LayoutScore/AnimClickSettle，保留 best/pass。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const baseFile = process.argv[2], outdir = arg('--outdir', '');
const iters = Number(arg('--iters', 3)) || 3;
const margin = Number(arg('--margin', 10)) || 10;
const seed = Number(arg('--seed', 1)) || 1;
if (!baseFile || !outdir) { console.error('用法: node M5Build_v4.js <base.recipe.json> --outdir <dir> [--iters 3] [--margin 10]'); process.exit(2); }
fs.mkdirSync(outdir, { recursive: true });
let _s = (seed >>> 0) || 1;
const rand = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
const clone = o => JSON.parse(JSON.stringify(o));

function partition(total, n, lo, hi) {
  if (n <= 0) return null;
  if (n * lo > total || n * hi < total) return null;
  const a = new Array(n).fill(Math.floor(total / n));
  let diff = total - a.reduce((x, y) => x + y, 0);
  for (let guard = 0; diff !== 0 && guard < n * 12; guard++) {
    for (let i = 0; i < n && diff !== 0; i++) {
      if (diff > 0 && a[i] < hi) { a[i]++; diff--; }
      else if (diff < 0 && a[i] > lo) { a[i]--; diff++; }
    }
  }
  return diff === 0 ? a : null;
}
function build(recipe, tag) {
  const rf = path.join(outdir, tag + '.recipe.json'), lf = path.join(outdir, tag + '.json');
  fs.writeFileSync(rf, JSON.stringify(recipe, null, 1));
  try { cp.execSync(`node 03_工具/正式版/BuildFromRecipe_v1.js ${rf} --out ${lf}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return null; }
  return lf;
}
function reachData(lf, tag) {
  const rf = path.join(outdir, tag + '.reach.json');
  try {
    cp.execSync(`node 03_工具/正式版/ReachabilityCurve_v1.js ${lf} --out ${rf}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    return JSON.parse(fs.readFileSync(rf, 'utf8'));
  } catch (e) { return null; }
}
function metrics(lf) {
  let arl = '';
  try { arl = cp.execSync(`node 03_工具/正式版/ArlCheck_v793.js ${lf}`, { encoding: 'utf8' }); } catch (e) { arl = e.stdout || ''; }
  let lay = '';
  try { lay = cp.execSync(`node 03_工具/正式版/LayoutScore_v1.js ${lf}`, { encoding: 'utf8' }); } catch (e) { lay = e.stdout || ''; }
  const pe = cp.execSync(`node 03_工具/正式版/PlayerEngineCheck_v1.js ${lf} --family --prefer-small-debt`, { encoding: 'utf8' });
  let click = {};
  try { click = JSON.parse(cp.execSync(`node 03_工具/正式版/AnimClickSettle_v1.js ${lf} --out ${lf.replace(/\.json$/, '.click.json')}`, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) { click = {}; }
  const peak = +((arl.match(/峰值=4\s+(\d+)/) || [])[1] || 0);
  const mid = +((arl.match(/玩家中段 45–80%\s+\d+ 步（占比 (\d+)%）/) || [])[1] || 0);
  const tol = +((arl.match(/容错 55–75%\s+(\d+)\/20/) || [])[1] || 0);
  const open = +((arl.match(/开局可点≥5\s+(\d+)/) || [])[1] || 0);
  const hard = +((lay.match(/hard=(\d+)/) || [])[1] || 0);
  const p0 = /policy0=Y/.test(pe);
  const pass = peak === 4 && mid >= 45 && mid <= 80 && tol >= 11 && tol <= 15 && open >= 5 && p0 && hard === 0 && !!click.clicks;
  let score = 0;
  score -= Math.abs(peak - 4) * 200;
  score += mid >= 45 && mid <= 80 ? 200 : -Math.abs(mid - 62) * 5;
  score += tol >= 11 && tol <= 15 ? 200 : -Math.abs(tol - 13) * 12;
  score += open >= 5 ? 50 : -100;
  score += p0 ? 100 : -200;
  score -= hard * 300;
  score += click.clicks ? 50 : -100;
  return { peak, mid, tol, open, hard, p0, click, pass, score };
}

function adjust(recipe, reach) {
  const r = clone(recipe);
  const by = {};
  for (const c of r.cars) (by[c.id] = by[c.id] || []).push(c);
  // 每种颜色的总容量（含管道队列）
  const queueById = {};
  for (const p of r.pipes || []) for (const q of p.param || []) queueById[q.id] = (queueById[q.id] || 0) + q.count;
  for (const id of Object.keys(by)) {
    const arr = by[id];
    const queueTotal = queueById[id] || 0;
    const spoolTotal = arr.reduce((a, c) => a + c.count, 0);
    // 从 reach 结果取该色每辆车的中位 reach；没有就跳过
    const info = [];
    for (const c of arr) {
      const hit = (reach.cars || []).find(x => x.r === c.r && x.c === c.c);
      info.push({ car: c, med: hit && hit.env ? hit.env.med : 0, maxDebt: hit ? hit.maxDebt : 0 });
    }
    const debt = info.filter(x => x.med > 0).sort((a, b) => b.maxDebt - a.maxDebt)[0];
    if (!debt) continue;
    const n = arr.length;
    if (n < 2) continue;   // 单辆车无法在同一色内重分容量，跳过（保持守恒）
    let want = Math.max(8, Math.min(90, debt.med + margin));
    want = Math.min(want, spoolTotal - 8 * (n - 1));
    const rest = partition(spoolTotal - want, n - 1, 8, 90);
    if (!rest) continue;
    debt.car.count = want;
    let k = 0;
    for (const c of arr) if (c !== debt.car) c.count = rest[k++];
  }
  return r;
}

let best = clone(JSON.parse(fs.readFileSync(baseFile, 'utf8')));
let bestLf = build(best, 'base');
let bestM = bestLf ? metrics(bestLf) : { score: -1e9, pass: false };
console.log('base', bestM);
for (let i = 1; i <= iters; i++) {
  const reach = bestLf ? reachData(bestLf, 'reach' + i) : null;
  if (!reach) { console.log('reach fail', i); break; }
  const cand = adjust(best, reach);
  const lf = build(cand, 'it' + i);
  if (!lf) { console.log('build fail', i); continue; }
  const m = metrics(lf);
  console.log('it' + i, m);
  if (m.pass || m.score > bestM.score) { best = cand; bestM = m; bestLf = lf; }
  if (m.pass) { fs.copyFileSync(lf, path.join(outdir, 'PASS.json')); fs.writeFileSync(path.join(outdir, 'PASS.recipe.json'), JSON.stringify(cand, null, 1)); break; }
}
fs.writeFileSync(path.join(outdir, 'best.recipe.json'), JSON.stringify(best, null, 1));
console.log('best', bestM);
