'use strict';
// 壳锁债源复现：死亡进度明细（按 seed 分三段 + 分箱 + p1 明细）。
// 用法: node 死亡进度_壳锁.js 标签1=目录1 标签2=目录2 ...
const fs = require('fs');
const path = require('path');
const readDir = dir => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
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
for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf('=');
  const tag = arg.slice(0, i), dir = arg.slice(i + 1);
  const ps = readDir(dir);
  if (!ps.length) { console.log(`${tag}\tNO_DATA`); continue; }
  for (const seed of [...new Set(ps.flatMap(p => p.seeds.map(s => s.seed)))].sort((a, b) => a - b)) {
    const flat = [];
    for (const p of ps) {
      let off = 0;
      for (const sd of p.seeds) {
        const arr = p.perGame.slice(off, off + sd.games); off += sd.games;
        if (sd.seed === seed) flat.push(...arr.map(g => ({ ...g, p: p.p })));
      }
    }
    if (!flat.length) continue;
    const rand = flat.filter(g => g.p <= 0.2001), car = flat.filter(g => g.p >= 0.7999), p1 = flat.filter(g => g.p === 1);
    const dead = a => a.filter(g => !g.won).map(g => g.deathProgress);
    const rD = dead(rand), cD = dead(car), p1D = dead(p1);
    console.log(`${tag}\tseed${seed}\trandDeaths ${rD.length}/${rand.length} [${fmt(rD)}]\tcarefulDeaths ${cD.length}/${car.length} [${fmt(cD)}] median ${median(cD)}\tp1Deaths ${p1D.length}/${p1.length} [${p1D.map(x => (x * 100).toFixed(1) + '%').join(',')}]`);
  }
}
