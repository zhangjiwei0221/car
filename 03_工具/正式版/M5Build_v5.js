#!/usr/bin/env node
'use strict';
/**
 * M5Build_v5 —— 用“能走通的点击结算路线”做窗口 + 两辆债车 + 链组
 *
 * 用法：
 *   node M5Build_v5.js <base.recipe.json> --outdir <dir> [--window 12] [--margin 8] [--chain 1]
 *
 * 流程：
 *   1. build base，跑 AnimClickSettle（free-first）拿一条能走通的路线；
 *   2. 回放该路线，记录每一步被点车的“点击前 reach”；
 *   3. 选 window / window+5 两辆被点车，把容量设为 reach+margin（同色内重分）；
 *   4. 可选：把 window 附近路线上的相邻两辆车绑成 2 连链；
 *   5. 重建 + 验收。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const baseFile = process.argv[2], outdir = arg('--outdir', '');
const windowStep = Number(arg('--window', 12)) || 12;
const margin = Number(arg('--margin', 8)) || 8;
const useChain = arg('--chain', '1') !== '0';
if (!baseFile || !outdir) { console.error('用法: node M5Build_v5.js <base.recipe.json> --outdir <dir> [--window 12] [--margin 8]'); process.exit(2); }
fs.mkdirSync(outdir, { recursive: true });
const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));

function build(recipe, tag) {
  const rf = path.join(outdir, tag + '.recipe.json'), lf = path.join(outdir, tag + '.json');
  fs.writeFileSync(rf, JSON.stringify(recipe, null, 1));
  try { cp.execSync(`node 03_工具/正式版/BuildFromRecipe_v1.js ${rf} --out ${lf}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return null; }
  return lf;
}
function clickRoute(lf, tag) {
  const jf = path.join(outdir, tag + '.click.json');
  try {
    cp.execSync(`node 03_工具/正式版/AnimClickSettle_v1.js ${lf} --out ${jf}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
    return JSON.parse(fs.readFileSync(jf, 'utf8'));
  } catch (e) { return null; }
}
function metrics(lf) {
  let arl = '';
  try { arl = cp.execSync(`node 03_工具/正式版/ArlCheck_v793.js ${lf}`, { encoding: 'utf8' }); } catch (e) { arl = e.stdout || ''; }
  let lay = '';
  try { lay = cp.execSync(`node 03_工具/正式版/LayoutScore_v1.js ${lf}`, { encoding: 'utf8' }); } catch (e) { lay = e.stdout || ''; }
  const pe = cp.execSync(`node 03_工具/正式版/PlayerEngineCheck_v1.js ${lf} --family --prefer-small-debt`, { encoding: 'utf8' });
  const peak = +((arl.match(/峰值=4\s+(\d+)/) || [])[1] || 0);
  const mid = +((arl.match(/玩家中段 45–80%\s+\d+ 步（占比 (\d+)%）/) || [])[1] || 0);
  const tol = +((arl.match(/容错 55–75%\s+(\d+)\/20/) || [])[1] || 0);
  const open = +((arl.match(/开局可点≥5\s+(\d+)/) || [])[1] || 0);
  const hard = +((lay.match(/hard=(\d+)/) || [])[1] || 0);
  const p0 = /policy0=Y/.test(pe);
  const pass = peak === 4 && mid >= 45 && mid <= 80 && tol >= 11 && tol <= 15 && open >= 5 && p0 && hard === 0;
  let score = 0; score -= Math.abs(peak - 4) * 200;
  score += mid >= 45 && mid <= 80 ? 200 : -Math.abs(mid - 62) * 5;
  score += tol >= 11 && tol <= 15 ? 200 : -Math.abs(tol - 13) * 12;
  score += open >= 5 ? 50 : -100; score += p0 ? 100 : -200; score -= hard * 300;
  return { peak, mid, tol, open, hard, p0, pass, score };
}
function partition(total, n, lo, hi) {
  if (n <= 0 || n * lo > total || n * hi < total) return null;
  const a = new Array(n).fill(Math.floor(total / n));
  let diff = total - a.reduce((x, y) => x + y, 0);
  for (let g = 0; diff !== 0 && g < n * 12; g++) for (let i = 0; i < n && diff !== 0; i++) {
    if (diff > 0 && a[i] < hi) { a[i]++; diff--; } else if (diff < 0 && a[i] > lo) { a[i]--; diff++; }
  }
  return diff === 0 ? a : null;
}
function replayReach(lf, route) {
  const lv = A.parseLevel(A.fromGameFormat(JSON.parse(fs.readFileSync(lf, 'utf8'))));
  const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const out = [];
  for (const st of route.steps || []) {
    const picks = st.picked || [];
    const rows = [];
    for (const p of picks) {
      const em = s.eliminated.map(row => row.slice());
      const reach = A.Simulator.floodFillCount(em, s.blocks, s.rows, s.cols, p.color, false);
      rows.push({ r: p.r, c: p.c, color: p.color, count: p.count, reach });
    }
    out.push({ step: st.step, picks: rows });
    const tr = picks[0]; if (tr && !A.Simulator.applyPick(s, tr.r, tr.c)) break;
  }
  return out;
}
function adjust(recipe, info) {
  const r = JSON.parse(JSON.stringify(recipe));
  const by = {};
  for (const c of r.cars) (by[c.id] = by[c.id] || []).push(c);
  const queue = {};
  for (const p of r.pipes || []) for (const q of p.param || []) queue[q.id] = (queue[q.id] || 0) + q.count;
  const targets = [];
  for (const step of info) {
    if (step.step < windowStep || step.step > windowStep + 5) continue;
    for (const p of step.picks) targets.push(p);
  }
  let changed = 0;
  for (const t of targets) {
    const arr = by[t.color]; if (!arr || arr.length < 2) continue;
    const car = arr.find(c => c.r === t.r && c.c === t.c); if (!car) continue;
    const spoolTotal = arr.reduce((a, c) => a + c.count, 0);
    let want = Math.max(8, Math.min(90, t.reach + margin));
    want = Math.min(want, spoolTotal - 8 * (arr.length - 1));
    if (want <= car.count) continue;
    const rest = partition(spoolTotal - want, arr.length - 1, 8, 90);
    if (!rest) continue;
    car.count = want; let k = 0;
    for (const c of arr) if (c !== car) c.count = rest[k++];
    changed++;
    if (changed >= 2) break;
  }
  // 把 window 附近路线上的相邻两辆内部车绑链
  if (useChain) {
    const positions = [];
    for (const step of info) if (step.step >= windowStep - 2 && step.step <= windowStep + 7) for (const p of step.picks) positions.push(p);
    const blocked = new Set();
    for (const o of r.obstacles || []) if (o.type === 7 || o.type === 5) blocked.add(o.r + ',' + o.c);
    let best = null;
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i], b = positions[j];
      if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) continue;
      if (blocked.has(a.r + ',' + a.c) || blocked.has(b.r + ',' + b.c)) continue;
      const ca = r.cars.find(c => c.r === a.r && c.c === a.c);
      const cb = r.cars.find(c => c.r === b.r && c.c === b.c);
      if (!ca || !cb) continue;
      const sc = ca.count + cb.count;
      if (!best || sc < best.sc) best = { a, b, ca, cb, sc };
    }
    if (best) {
      r.obstacles = (r.obstacles || []).filter(o => !(o.type === 5 && o.param === 9));
      r.obstacles.push({ r: best.a.r, c: best.a.c, type: 5, param: 9 }, { r: best.b.r, c: best.b.c, type: 5, param: 9 });
    }
  }
  return r;
}

const baseLf = build(base, 'base');
if (!baseLf) throw new Error('base build fail');
const route = clickRoute(baseLf, 'base');
if (!route) throw new Error('base click route fail');
const info = replayReach(baseLf, route);
console.log('route steps', route.clicks, 'replay', info.length);
const cand = adjust(base, info);
const lf = build(cand, 'v5');
if (!lf) throw new Error('v5 build fail');
const m = metrics(lf);
console.log('v5', m);
fs.writeFileSync(path.join(outdir, 'v5.recipe.json'), JSON.stringify(cand, null, 1));
