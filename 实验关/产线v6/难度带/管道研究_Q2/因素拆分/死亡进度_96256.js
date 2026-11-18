'use strict';
// 死亡进度明细（pid 96256）。R/V1 的 4242 取自既有产物（关卡文件与本次重建逐字节一致）。
// 用法: node 死亡进度_96256.js <因素拆分目录>
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || __dirname;
const PRIOR_R = path.join(ROOT, '../../管道研究/P-开局-晚色');
const PRIOR_V1 = path.join(ROOT, '../Q2_开局2车');
const spec = [
  ['R', 977, [path.join(ROOT, 'R_1车/pinterp')]],
  ['R', 4242, [path.join(PRIOR_R, 'pinterp_4242')]],
  ['V1', 977, [path.join(ROOT, 'V1_2车基准/pinterp')]],
  ['V1', 4242, [path.join(PRIOR_V1, 'pinterp')]],
  ['V2', 977, [path.join(ROOT, 'V2_顺序/pinterp')]],
  ['V2', 4242, [path.join(ROOT, 'V2_顺序/pinterp')]],
  ['V3', 977, [path.join(ROOT, 'V3_方向/pinterp')]],
  ['V3', 4242, [path.join(ROOT, 'V3_方向/pinterp')]],
  ['V4', 977, [path.join(ROOT, 'V4_内容34/pinterp')]],
  ['V5', 977, [path.join(ROOT, 'V5_内容15/pinterp')]],
];
const readDir = dir => {
  const out = [];
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d);
    if (!fs.statSync(f).isDirectory()) continue;
    const lv = fs.readdirSync(f).filter(x => fs.statSync(path.join(f, x)).isDirectory())[0];
    if (!lv) continue;
    const sf = path.join(f, lv, 'summary.json');
    if (fs.existsSync(sf)) out.push(JSON.parse(fs.readFileSync(sf, 'utf8')));
  }
  return out.sort((a, b) => a.p - b.p);
};
const bin = d => d < 0.10 ? '<10' : d < 0.25 ? '10-25' : d < 0.40 ? '25-40' : d < 0.50 ? '40-50' : d < 0.90 ? '50-90' : '>90';
const bins = ['<10', '10-25', '25-40', '40-50', '50-90', '>90'];
const fmt = a => { const o = {}; for (const b of bins) o[b] = 0; for (const d of a) o[bin(d)]++; return bins.map(b => `${b}:${o[b]}`).join(' '); };
const median = a => { if (!a.length) return '—'; const s = [...a].sort((x, y) => x - y); return (s[Math.floor((s.length - 1) / 2)] * 100).toFixed(1) + '%'; };
for (const [tag, seed, dirs] of spec) {
  const flat = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const p of readDir(dir)) {
      let off = 0;
      for (const sd of p.seeds) {
        const arr = p.perGame.slice(off, off + sd.games); off += sd.games;
        if (sd.seed === seed) flat.push(...arr.map(g => ({ ...g, p: p.p })));
      }
    }
  }
  if (!flat.length) { console.log(`${tag}\tseed${seed}\tNO_DATA`); continue; }
  const rand = flat.filter(g => g.p <= 0.2001), car = flat.filter(g => g.p >= 0.7999), p1 = flat.filter(g => g.p === 1);
  const dead = a => a.filter(g => !g.won).map(g => g.deathProgress);
  const rD = dead(rand), cD = dead(car), p1D = dead(p1);
  console.log(`${tag}\tseed${seed}\trandDeaths ${rD.length}/${rand.length} [${fmt(rD)}]\tcarefulDeaths ${cD.length}/${car.length} [${fmt(cD)}] median ${median(cD)}\tp1Deaths ${p1D.length}/${p1.length} [${p1D.map(x => (x * 100).toFixed(1) + '%').join(',')}]`);
}
