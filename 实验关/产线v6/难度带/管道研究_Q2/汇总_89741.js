'use strict';
// 读 PInterp 目录（p*/<level>/summary.json）→ 对照表（pid 89741）。
// 逐 seed 用 perGame 重算 lt10/lt25（summary_all 不含 perGame，且多 seed 时 deathDist 是 200 局合并）。
const fs = require('fs');
const spec = [
  ['底座',        ['实验关/产线v6/难度带/闭环_靶向清理/6/pinterp_基线_977','实验关/产线v6/难度带/闭环_靶向清理/6/pinterp_基线_4242']],
  ['1车开局晚色', ['实验关/产线v6/难度带/管道研究/P-开局-晚色/pinterp_977','实验关/产线v6/难度带/管道研究/P-开局-晚色/pinterp_4242']],
  ['2车开局',     ['实验关/产线v6/难度带/管道研究_Q2/Q2_开局2车/pinterp']],
  ['3车开局',     ['实验关/产线v6/难度带/管道研究_Q2/Q2_开局3车/pinterp']],
  ['1车深行',     ['实验关/产线v6/难度带/管道研究/P-深行/pinterp_977','实验关/产线v6/难度带/管道研究/P-深行/pinterp_4242']],
  ['2车深行',     ['实验关/产线v6/难度带/管道研究_Q2/Q2_深行2车/pinterp']],
];
const readDir = dir => {
  const out = [];
  for (const d of fs.readdirSync(dir)) {
    const f = dir + '/' + d;
    if (!fs.statSync(f).isDirectory()) continue;
    const lv = fs.readdirSync(f)[0];
    const sf = f + '/' + lv + '/summary.json';
    if (fs.existsSync(sf)) out.push(JSON.parse(fs.readFileSync(sf, 'utf8')));
  }
  return out.sort((a, b) => a.p - b.p);
};
for (const [tag, dirs] of spec) {
  const bySeed = {};
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const p of readDir(dir)) {
      let off = 0;
      for (const sd of p.seeds) {
        const arr = p.perGame.slice(off, off + sd.games); off += sd.games;
        (bySeed[sd.seed] = bySeed[sd.seed] || []).push(...arr.map(g => ({ ...g, p: p.p })));
      }
    }
  }
  for (const seed of Object.keys(bySeed).sort()) {
    const flat = bySeed[seed];
    const rand = flat.filter(g => g.p <= 0.2001), car = flat.filter(g => g.p >= 0.7999);
    const win = arr => arr.filter(g => g.won).length / arr.length;
    const lt = (arr, t) => arr.filter(g => !g.won && g.deathProgress < t).length;
    console.log(`${tag}\tseed${seed}\trand ${(win(rand) * 100).toFixed(1)}\tcareful ${(win(car) * 100).toFixed(1)}` +
      `\tlt10 ${lt(flat, 0.10)}/${flat.length}\tlt25 ${lt(flat, 0.25)}/${flat.length}` +
      `\trand-lt10 ${lt(rand, 0.10)}/${rand.length}\trand-lt25 ${lt(rand, 0.25)}/${rand.length}`);
  }
}
