'use strict';
// 205 C1 换图复现汇总。读 <变体>/pinterp_<seed>/p*/<level>/summary.json → 逐 seed 重算三段。
// 用法: node 汇总_205C1.js <复现目录>
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
const bin = d => (d < 0.1 ? '<10' : d < 0.25 ? '10-25' : d < 0.4 ? '25-40' : d < 0.5 ? '40-50' : d < 0.9 ? '50-90' : '>90');
for (const [dirName, tag] of spec) {
  // 支持 基线/pinterp_977 与 A/pinterp_977 两种布局
  let dirs = [];
  const base = path.join(ROOT, dirName);
  if (!fs.existsSync(base)) { console.log(`${tag}\tNO_DATA`); continue; }
  for (const d of fs.readdirSync(base)) {
    if (d.startsWith('pinterp') && fs.statSync(path.join(base, d)).isDirectory()) dirs.push(path.join(base, d));
  }
  if (!dirs.length && fs.existsSync(path.join(base, 'pinterp'))) dirs.push(path.join(base, 'pinterp'));
  for (const dir of dirs) {
    const ps = readDir(dir);
    if (!ps.length) continue;
    const seedTag = path.basename(dir).replace('pinterp', '').replace(/^_/, '') || '?';
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
      const dist = arr => { const o = { '<10': 0, '10-25': 0, '25-40': 0, '40-50': 0, '50-90': 0, '>90': 0 }; for (const d of arr) o[bin(d)]++; return o; };
      console.log([
        tag, `${seedTag}seed${seed}`,
        `rand ${(win(rand) * 100).toFixed(1)}`, `careful ${(win(car) * 100).toFixed(1)}`,
        `lt10 ${lt(flat, 0.10)}/${flat.length}`, `lt25 ${lt(flat, 0.25)}/${flat.length}`,
        `randLt10 ${lt(rand, 0.10)}/${rand.length}`, `randLt25 ${lt(rand, 0.25)}/${rand.length}`,
        `p1deaths ${p1dead.length}/${p1.length} [${p1dead.map(x => (x * 100).toFixed(1) + '%').join(',')}]`,
        `careDeaths ${carDead.length}/${car.length} ${JSON.stringify(dist(carDead))}`,
        `randDeaths ${randDead.length}/${rand.length} ${JSON.stringify(dist(randDead))}`,
      ].join('\t'));
    }
    const seeds = [...new Set(ps.flatMap(p => p.seeds.map(s => s.seed)))].sort((a, b) => a - b);
    for (const seed of seeds) {
      const row = ps.map(p => { const sd = p.seeds.find(s => s.seed === seed); return sd ? sd.winRate.toFixed(3) : '-'; });
      console.log(`${tag}\t${seedTag}seed${seed}\tp\t` + ps.map(p => p.p).join('\t'));
      console.log(`${tag}\t${seedTag}seed${seed}\twin\t` + row.join('\t'));
    }
  }
}
