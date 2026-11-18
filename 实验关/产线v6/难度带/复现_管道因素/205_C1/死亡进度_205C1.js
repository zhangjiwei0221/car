'use strict';
// 205 C1 换图复现：死亡进度明细。读各变体 pinterp_<seed> 的 perGame，按三段分箱。
// 用法: node 死亡进度_205C1.js <复现目录>
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || __dirname;
const spec = [
  ['基线', '基线'],
  ['A', 'A 死债队首'],
  ['B0', 'B0 同色顺序'],
  ['A1', 'A1 异色队首'],
  ['B1', 'B1 异色队尾'],
  ['B', 'B 死债队尾(合成)'],
  ['C', 'C 生命线内容'],
  ['D', 'D 深行2车'],
];
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
for (const [dirName, tag] of spec) {
  const base = path.join(ROOT, dirName);
  if (!fs.existsSync(base)) { console.log(`${tag}\tNO_DATA`); continue; }
  for (const d of fs.readdirSync(base)) {
    if (!d.startsWith('pinterp')) continue;
    if (!fs.statSync(path.join(base, d)).isDirectory()) continue;
    const ps = readDir(path.join(base, d));
    if (!ps.length) continue;
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
}
