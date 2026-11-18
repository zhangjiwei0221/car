'use strict';
// 因素拆分汇总（pid 96256）。读各变体 pinterp/p*/<level>/summary.json → 逐 seed 重算。
// 用法: node 汇总_96256.js <因素拆分目录>
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || __dirname;
const spec = [
  ['R_1车', 'R 1车'],
  ['V1_2车基准', 'V1 2车基准'],
  ['V2_顺序', 'V2 顺序'],
  ['V3_方向', 'V3 方向'],
  ['V4_内容34', 'V4 内容34'],
  ['V5_内容15', 'V5 内容15'],
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
const bin = d => (d < 0.1 ? '<10' : d < 0.25 ? '10-25' : d < 0.5 ? '25-50' : d < 0.9 ? '50-90' : '>90');
for (const [dirName, tag] of spec) {
  const dir = path.join(ROOT, dirName, 'pinterp');
  const ps = readDir(dir);
  if (!ps.length) { console.log(`${tag}\tNO_DATA`); continue; }
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
    const rand = flat.filter(g => g.p <= 0.2001), car = flat.filter(g => g.p >= 0.7999);
    const win = arr => arr.filter(g => g.won).length / arr.length;
    const lt = (arr, t) => arr.filter(g => !g.won && g.deathProgress < t).length;
    const p1 = flat.filter(g => g.p === 1);
    const p1dead = p1.filter(g => !g.won).map(g => g.deathProgress);
    const carDead = car.filter(g => !g.won).map(g => g.deathProgress);
    const randDead = rand.filter(g => !g.won).map(g => g.deathProgress);
    const dist = arr => { const o = { '<10': 0, '10-25': 0, '25-50': 0, '50-90': 0, '>90': 0 }; for (const d of arr) o[bin(d)]++; return o; };
    console.log([
      tag, `seed${seed}`,
      `rand ${(win(rand) * 100).toFixed(1)}`, `careful ${(win(car) * 100).toFixed(1)}`,
      `lt10 ${lt(flat, 0.10)}/${flat.length}`, `lt25 ${lt(flat, 0.25)}/${flat.length}`,
      `randLt10 ${lt(rand, 0.10)}/${rand.length}`, `randLt25 ${lt(rand, 0.25)}/${rand.length}`,
      `p1deaths ${p1dead.length}/${p1.length} [${p1dead.map(x => (x * 100).toFixed(1) + '%').join(',')}]`,
      `careDeaths ${carDead.length}/${car.length} ${JSON.stringify(dist(carDead))}`,
      `randDeaths ${randDead.length}/${rand.length} ${JSON.stringify(dist(randDead))}`,
    ].join('\t'));
  }
  // per-p win table (seed 977 / other)
  const seeds = [...new Set(ps.flatMap(p => p.seeds.map(s => s.seed)))].sort((a, b) => a - b);
  console.log(`${tag}\tp\t` + ps.map(p => p.p).join('\t'));
  for (const seed of seeds) {
    const row = ps.map(p => { const sd = p.seeds.find(s => s.seed === seed); return sd ? sd.winRate.toFixed(3) : '-'; });
    console.log(`${tag}\tseed${seed}\t` + row.join('\t'));
  }
}
