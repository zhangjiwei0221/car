#!/usr/bin/env node
'use strict';
/**
 * measure_base —— 底座上逐车测量「首次可点进度」与「可点那一刻吃到多少」
 * C3 标定曲线（2026-11-12）
 *
 * 用法：
 *   node measure_base.js <关卡.json> --games 20 --seed 1 --out /tmp/xxx_<pid>.json
 *
 * 随机玩家逐行对齐 PopulationSim_v1.runRandomNoStats / analyze_doors.js：
 *   lcg(seed), 每步 listMoves().filter(!blocked) 倒序 Fisher-Yates 洗牌，取第一个当步不死。
 *
 * 每辆车在「第一次进入合法可点列表」时记录：
 *   progress —— 点之前 eliminatedPixels/totalPixels
 *   gain     —— cloneState + applyPick 后 eliminatedPixels 的增量
 *               （= 该色此刻可达像素数，被 count 截断；这就是玩家点下去实际吃到的量）
 *   ratio    —— gain / count
 * 跨局取中位数。ratio < 0.6 视为「吃不饱的诱人车」（代价车）。
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
if (!levelFile || levelFile.startsWith('--')) {
  console.error('用法: node measure_base.js <关卡.json> --games 20 --seed 1 --out <结果.json>');
  process.exit(2);
}
const NGAMES = Number(arg('--games', 20));
const SEED = Number(arg('--seed', 1));
const OUT = arg('--out', `/tmp/measure_base_${process.pid}.json`);

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) {
  if (!a.length) return null;
  const b = a.slice().sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;

const game = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));
const cars = [];
for (let r = 0; r < game.spools.length; r++) {
  for (let c = 0; c < game.spools[r].length; c++) {
    const s = game.spools[r][c];
    if (s && s.id > 0 && (!s.type || (Array.isArray(s.type) ? !s.type.length : s.type === 0))) {
      cars.push({ key: r + ',' + c, r, c, color: s.id, count: s.count || 0 });
    }
  }
}
const byKey = new Map(cars.map(c => [c.key, c]));
const samples = new Map(cars.map(c => [c.key, []])); // key -> [{progress,gain,ratio,buffer}]
const routes = [];
const rnd = lcg(SEED);

for (let g = 0; g < NGAMES; g++) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const route = [];
  const seenThisGame = new Set();
  while (!isWon(s)) {
    const progress = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    for (const m of ms) {
      const key = m.r + ',' + m.c;
      if (!samples.has(key) || seenThisGame.has(key)) continue;
      const car = byKey.get(key);
      const t = St.cloneState(s);
      s.removed = s.removed || {};
      const ok = Sim.applyPick(t, m.r, m.c);
      if (!ok) continue;
      seenThisGame.add(key);
      const gain = t.eliminatedPixels - s.eliminatedPixels;
      samples.get(key).push({
        progress: r4(progress),
        buffer: s.buffer.length,
        gain,
        ratio: car.count ? r4(gain / car.count) : 0
      });
    }
    const idx = ms.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
    let pick = null;
    for (const k of idx) {
      const m = ms[k], t = St.cloneState(s);
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      if (!isDead(t) || isWon(t)) { pick = { r: m.r, c: m.c, t }; break; }
    }
    if (!pick) break;
    route.push({ step: route.length + 1, r: pick.r, c: pick.c, progress: r4(progress) });
    s = pick.t;
  }
  routes.push({ won: isWon(s), steps: route.length, route });
}

function pct(a, p) {
  if (!a.length) return null;
  const b = a.slice().sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1)))];
}
const perCar = cars.map(c => {
  const ss = samples.get(c.key);
  const ratios = ss.map(x => x.ratio);
  const gains = ss.map(x => x.gain);
  const progs = ss.map(x => x.progress);
  return {
    r: c.r, c: c.c, color: c.color, count: c.count, gamesSeen: ss.length,
    firstProgressMedian: median(progs),
    firstProgressP25: pct(progs, 0.25),
    firstProgressP75: pct(progs, 0.75),
    gainMedian: median(gains),
    ratioMedian: median(ratios),
    ratioP25: pct(ratios, 0.25),
    ratioP75: pct(ratios, 0.75),
    samples: ss
  };
});
perCar.sort((a, b) => (a.ratioMedian == null ? 2 : a.ratioMedian) - (b.ratioMedian == null ? 2 : b.ratioMedian));

const wins = routes.filter(r => r.won).length;
console.log(`随机玩家 ${NGAMES} 局 seed=${SEED}：通关 ${wins}/${NGAMES}`);
console.log('pos      color/count  首次可点进度中位  gain中位  gain/count 中位  p25   p75  样本');
for (const c of perCar) {
  const p = (x) => x == null ? '—' : (x * 100).toFixed(1) + '%';
  console.log(`r${c.r}c${c.c}   ${String(c.color).padStart(2)}/${String(c.count).padEnd(4)}   ${p(c.firstProgressMedian).padEnd(15)} ${String(c.gainMedian).padEnd(8)}  ${p(c.ratioMedian).padEnd(16)} ${p(c.ratioP25).padEnd(5)} ${p(c.ratioP75).padEnd(5)} ${c.gamesSeen}/${NGAMES}`);
}
const hungry = perCar.filter(c => c.ratioMedian != null && c.ratioMedian < 0.6);
console.log(`\nratio < 0.6 的车：${hungry.length}`);
for (const c of hungry) console.log(`  r${c.r}c${c.c} ${c.color}/${c.count} ratio=${c.ratioMedian} progress=${c.firstProgressMedian}`);

fs.writeFileSync(OUT, JSON.stringify({
  level: path.resolve(levelFile), seed: SEED, games: NGAMES, randomWins: wins,
  perCar, hungryKeys: hungry.map(c => c.r + ',' + c.c)
}, null, 1));
console.log('结果: ' + path.resolve(OUT));
