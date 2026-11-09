#!/usr/bin/env node
'use strict';
/**
 * M5Build_v2 —— 在合法候选上做“冰/链组”局部搜索
 *
 * 用法：
 *   node M5Build_v2.js <base.recipe.json> --outdir <dir> [--iters 30] [--seed 1]
 *
 * 每个 iteration：
 *   - 随机改一个冰的 param（4..18）
 *   - 或把一组 2 连链换到另一对相邻内部格
 *   - 重建 → ArlCheck/PlayerEngine/LayoutScore/AnimClickSettle → 打分
 * 只保留“全过”或分数更高的候选。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const baseFile = process.argv[2];
const outdir = arg('--outdir', '');
const iters = Number(arg('--iters', 30)) || 30;
const seed = Number(arg('--seed', 1)) || 1;
if (!baseFile || !outdir) { console.error('用法: node M5Build_v2.js <base.recipe.json> --outdir <dir> [--iters 30] [--seed 1]'); process.exit(2); }
fs.mkdirSync(outdir, { recursive: true });
const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
let _s = (seed >>> 0) || 1;
const rand = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
const clone = o => JSON.parse(JSON.stringify(o));

function build(recipe, tag) {
  const rf = path.join(outdir, tag + '.recipe.json');
  const lf = path.join(outdir, tag + '.json');
  fs.writeFileSync(rf, JSON.stringify(recipe, null, 1));
  try { cp.execSync(`node 03_工具/正式版/BuildFromRecipe_v1.js ${rf} --out ${lf}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return null; }
  return lf;
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
function mutate(recipe) {
  const r = clone(recipe);
  const ices = r.obstacles.filter(o => o.type === 7);
  const chains = r.obstacles.filter(o => o.type === 5);
  // 同色车之间挪容量（守恒），这是抬峰值/调中段的主要杠杆
  if (rand() < 0.35 && r.cars && r.cars.length) {
    const by = {};
    for (const c of r.cars) (by[c.id] = by[c.id] || []).push(c);
    const keys = Object.keys(by).filter(k => by[k].length >= 2);
    if (keys.length) {
      const arr = by[keys[Math.floor(rand() * keys.length)]];
      const a = arr[Math.floor(rand() * arr.length)];
      const b = arr[Math.floor(rand() * arr.length)];
      if (a !== b) {
        const d = 2 + Math.floor(rand() * 7);
        if (a.count - d >= 8 && b.count + d <= 90) { a.count -= d; b.count += d; }
      }
    }
  } else if (ices.length && rand() < 0.65) {
    const o = ices[Math.floor(rand() * ices.length)];
    o.param = Math.max(4, Math.min(18, (o.param || 8) + (rand() < 0.5 ? -2 : 2)));
  } else if (chains.length) {
    // 找一对相邻内部格（不是当前链），把当前第一组 2 连移过去
    const group = chains[0].param;
    const cells = [];
    for (let rr = 0; rr < 7; rr++) for (let cc = 0; cc < 7; cc++) {
      const sp = r.cars.find(x => x.r === rr && x.c === cc);
      if (sp && !(rr === 0 || rr === 1)) cells.push([rr, cc]);
    }
    const pairs = [];
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      if (Math.abs(cells[i][0] - cells[j][0]) + Math.abs(cells[i][1] - cells[j][1]) !== 1) continue;
      pairs.push([cells[i], cells[j]]);
    }
    if (pairs.length) {
      const [a, b] = pairs[Math.floor(rand() * pairs.length)];
      r.obstacles = r.obstacles.filter(o => !(o.type === 5 && o.param === group));
      r.obstacles.push({ r: a[0], c: a[1], type: 5, param: group }, { r: b[0], c: b[1], type: 5, param: group });
    }
  }
  return r;
}

let best = clone(base), bestLf = build(best, 'base');
let bestM = bestLf ? metrics(bestLf) : { score: -1e9, pass: false };
console.log('base', bestM);
for (let i = 1; i <= iters; i++) {
  const cand = mutate(best);
  const lf = build(cand, 'it' + i);
  if (!lf) continue;
  const m = metrics(lf);
  console.log('it' + i, m);
  if (m.pass || m.score > bestM.score) { best = cand; bestM = m; bestLf = lf; }
  if (m.pass) { fs.copyFileSync(lf, path.join(outdir, 'PASS.json')); fs.writeFileSync(path.join(outdir, 'PASS.recipe.json'), JSON.stringify(cand, null, 1)); break; }
}
fs.writeFileSync(path.join(outdir, 'best.recipe.json'), JSON.stringify(best, null, 1));
console.log('best', bestM);
