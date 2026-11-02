#!/usr/bin/env node
'use strict';
/**
 * pick_subjects_v758 —— 从主体库自动挑 4 个并给出拼接参数
 *
 * 规则（2026-11-02 用户确认）：
 *   · 四个主体之间颜色两两 RGB 距离 ≥ 85（主体不撞色）
 *   · 碎度（平均色块像素）跨度尽量大（便于做"前松后紧"的梯度）
 *   · 背景/边框从"离主体色最远"的色号里挑，不强制 ≥85（色库不够）
 *
 * 用法：node pick_subjects_v758.js [--min-dist 85] [--pool 蚂蚁图库/拼接图/主体图纸库_50张]
 * 输出：可直接复制的 compose_raw_v757.py 命令
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MIN_D = Number(arg('--min-dist', 85));
const POOL = arg('--pool', path.join(ROOT, '蚂蚁图库/拼接图/主体图纸库_50张'));

const src = fs.readFileSync(path.join(ROOT, '02_工程/游戏主bin/bin/js/color-libs.js'), 'utf8');
const seg = src.split('CL.OLDER = {')[1].split('};')[0];
const hexes = ['#000000', ...[...seg.matchAll(/hex:\s*.\s*(#[0-9A-Fa-f]{6})/g)].map(m => m[1])];
const rgb = hexes.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
const dist = (a, b) => Math.round(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2));

function load(p) {
  return fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.trim().split(/\s+/).map(Number));
}
function frag(m) {
  const H = m.length, W = m[0].length;
  const cnt = {}, comp = {}, seen = m.map(r => r.map(() => false));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = m[y][x]; if (!c) continue;
    cnt[c] = (cnt[c] || 0) + 1;
    if (seen[y][x]) continue;
    comp[c] = (comp[c] || 0) + 1;
    const st = [[y, x]]; seen[y][x] = true;
    while (st.length) {
      const [cy, cx] = st.pop();
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = cy + dy, nx = cx + dx;
        if (ny < 0 || nx < 0 || ny >= H || nx >= W || seen[ny][nx] || m[ny][nx] !== c) continue;
        seen[ny][nx] = true; st.push([ny, nx]);
      }
    }
  }
  const ks = Object.keys(cnt).map(Number).filter(c => cnt[c] >= 8);
  return ks.length ? ks.reduce((s, c) => s + cnt[c] / comp[c], 0) / ks.length : 18;
}

const items = [];
for (const f of fs.readdirSync(POOL).filter(x => x.endsWith('.txt'))) {
  const m = load(path.join(POOL, f));
  if (m.length !== 18 || m[0].length !== 18) continue;
  const cs = [...new Set(m.flat().filter(v => v > 0))];
  if (cs.length < 4) continue;
  items.push({ name: f.replace('.txt', ''), cs, frag: frag(m) });
}

let best = null;
for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++)
  for (let k = j + 1; k < items.length; k++) for (let l = k + 1; l < items.length; l++) {
    const four = [items[i], items[j], items[k], items[l]];
    const sub = [...new Set(four.flatMap(x => x.cs))];
    let mn = 999;
    for (let a = 0; a < sub.length; a++) for (let b = a + 1; b < sub.length; b++) mn = Math.min(mn, dist(rgb[sub[a]], rgb[sub[b]]));
    if (mn < MIN_D) continue;
    const fr = four.map(x => x.frag).sort((a, b) => a - b);
    const spread = fr[3] - fr[0];
    const score = spread * 10 + mn;
    if (!best || score > best.score) best = { score, mn, spread, names: four.map(x => x.name), frags: fr, cs: sub };
  }

if (!best) { console.error(`❌ 没有任意 4 主体组合满足 ≥${MIN_D}`); process.exit(1); }

// 背景/边框：从离主体最远的色号里挑 12 个（不强制 85）
const free = [];
for (let c = 1; c <= 34; c++) {
  if (best.cs.includes(c)) continue;
  free.push([Math.min(...best.cs.map(s => dist(rgb[c], rgb[s]))), c]);
}
free.sort((a, b) => b[0] - a[0]);
const pick = free.slice(0, 12).map(x => x[1]);
const bg = pick.slice(0, 8), fr = pick.slice(8, 12);

console.log('选中的 4 个主体：');
best.names.forEach((n, i) => console.log(`  ${n}  碎度=${best.frags[i].toFixed(1)}px`));
console.log(`主体之间最小色距 = ${best.mn}（≥${MIN_D} ✅）  碎度跨度 = ${best.spread.toFixed(1)}`);
console.log(`背景/边框取色：${pick.join(',')}（离主体最远 ${free[0][0]}，最远第 12 个 ${free[11][0]}）`);
console.log('');
console.log('python3 03_工具/正式版/compose_raw_v757.py \\');
console.log(`  --subjects "${best.names.join(',')}" \\`);
console.log(`  --bg4 "${bg.slice(0,2)};${bg.slice(2,4)};${bg.slice(4,6)};${bg.slice(6,8)}" --frame ${fr.join(',')} \\`);
console.log(`  --out 实验关/目标图_拼接/拼接_自动_40x40.txt --png 实验关/renders/拼接_自动.png`);
