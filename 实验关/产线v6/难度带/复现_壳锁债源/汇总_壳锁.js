'use strict';
// 壳锁债源复现：读 PInterpPlayer 输出目录，按 seed 重算三段与 lt10/lt25。
// 用法: node 汇总_壳锁.js 标签1=目录1 标签2=目录2 ...
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
const bin = d => d < 0.1 ? '<10' : d < 0.25 ? '10-25' : d < 0.4 ? '25-40' : d < 0.5 ? '40-50' : d < 0.9 ? '50-90' : '>90';
const bins = ['<10', '10-25', '25-40', '40-50', '50-90', '>90'];
const dist = a => { const o = {}; for (const b of bins) o[b] = 0; for (const d of a) o[bin(d)]++; return bins.map(b => `${b}:${o[b]}`).join(' '); };
const median = a => { if (!a.length) return '—'; const s = [...a].sort((x, y) => x - y); return (s[Math.floor((s.length - 1) / 2)] * 100).toFixed(1) + '%'; };

for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf('=');
  const tag = arg.slice(0, i), dir = arg.slice(i + 1);
  const ps = readDir(dir);
  if (!ps.length) { console.log(`${tag}\tNO_DATA\t${dir}`); continue; }
  const bySeed = {};
  for (const p of ps) {
    let off = 0;
    for (const sd of p.seeds) {
      const arr = p.perGame.slice(off, off + sd.games); off += sd.games;
      (bySeed[sd.seed] = bySeed[sd.seed] || []).push(...arr.map(g => ({ ...g, p: p.p })));
    }
  }
  for (const seed of Object.keys(bySeed).sort((a, b) => a - b)) {
    const flat = bySeed[seed];
    const rand = flat.filter(g => g.p <= 0.2001), car = flat.filter(g => g.p >= 0.7999), p1 = flat.filter(g => g.p === 1);
    const win = arr => arr.filter(g => g.won).length / arr.length;
    const lt = (arr, t) => arr.filter(g => !g.won && g.deathProgress < t).length;
    const dead = arr => arr.filter(g => !g.won).map(g => g.deathProgress);
    console.log([
      tag, `seed${seed}`,
      `rand ${(win(rand) * 100).toFixed(1)}`, `careful ${(win(car) * 100).toFixed(1)}`,
      `lt10 ${lt(flat, 0.10)}/${flat.length}`, `lt25 ${lt(flat, 0.25)}/${flat.length}`,
      `p1deaths ${dead(p1).length}/${p1.length} [${dead(p1).map(x => (x * 100).toFixed(1) + '%').join(',')}]`,
      `careDeaths ${dead(car).length}/${car.length} [${dist(dead(car))}] median ${median(dead(car))}`,
      `randDeaths ${dead(rand).length}/${rand.length} [${dist(dead(rand))}]`,
    ].join('\t'));
    // 逐 p
    const ps2 = ps.map(p => { const sd = p.seeds.find(s => Number(s.seed) === Number(seed)); return sd ? sd.winRate.toFixed(3) : '-'; });
    console.log(`${tag}\tseed${seed}\tp\t` + ps.map(p => p.p).join('\t'));
    console.log(`${tag}\tseed${seed}\twin\t` + ps2.join('\t'));
  }
}
