#!/usr/bin/env node
'use strict';
/**
 * measure —— C5 中段代价：逐车「首次可点进度/首点 gain」+ 逐色「首次可达进度」
 * C5_中段代价（2026-11-12）
 *
 * 用法：
 *   node measure.js <关卡.json> --games 20 --seed 1 [--free] --out /tmp/xxx_<pid>.json
 *
 * 随机玩家逐行对齐 PopulationSim_v1.runRandomNoStats（同 LCG、同倒序洗牌、同「当步不死」）。
 * --free 额外跑 1 条 free-first 路线（与 PopulationSim_v1.freePath 的排序键一致）。
 *
 * 每辆车在「第一次进入合法可点列表」时记录：
 *   progress —— 点之前 eliminatedPixels/totalPixels
 *   gain     —— cloneState + applyPick 后的像素增量（该色此刻可达像素，被 count 截断）
 *   ratio    —— gain / count
 * 每种颜色记录「首次可达进度」：在该状态下 floodFillCount(eliminated, blocks, color) > 0。
 *   这是该色第一次能被吃到的进度（与把哪辆车放哪里无关，是目标图的性质）。
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
if (!levelFile || levelFile.startsWith('--')) {
  console.error('用法: node measure.js <关卡.json> --games 20 --seed 1 [--free] --out <结果.json>');
  process.exit(2);
}
const NGAMES = Number(arg('--games', 20));
const SEED = Number(arg('--seed', 1));
const DO_FREE = process.argv.includes('--free');
const OUT = arg('--out', `/tmp/c5_measure_${process.pid}.json`);

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const legalN = (s) => Sim.listMoves(s).filter(m => !m.blocked).length;
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) {
  if (!a.length) return null;
  const b = a.slice().sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
const r4 = (x) => x == null ? null : Math.round(x * 1e4) / 1e4;
const pct = (a, p) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1)))]; };

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
const colors = [...new Set(cars.map(c => c.color))].sort((a, b) => a - b);
const colorCap = {};
for (const c of cars) colorCap[c.color] = (colorCap[c.color] || 0) + c.count;
const byKey = new Map(cars.map(c => [c.key, c]));
const newSamples = () => new Map(cars.map(c => [c.key, []]));
const newReach = () => new Map(colors.map(col => [col, []]));

function colorReachNow(s, col) {
  const em = s.eliminated.map(row => row.slice());
  return Sim.floodFillCount(em, s.blocks, s.rows, s.cols, col, s.bottomOnly) > 0;
}

/**
 * 走一条路线。policy='random' 或 'free'。
 * 返回 { won, steps, samples: Map key->[{progress,gain,ratio}], reach: Map color->[progress] }
 */
function play(policy, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const samples = newSamples();
  const reach = newReach();
  const seenCar = new Set();
  const reachSeen = new Set();
  let steps = 0;
  while (!isWon(s) && steps < 200) {
    const progress = s.eliminatedPixels / s.totalPixels;
    // 逐色首次可达（纯观测）
    for (const col of colors) {
      if (reachSeen.has(col)) continue;
      if (colorReachNow(s, col)) { reachSeen.add(col); reach.get(col).push(r4(progress)); }
    }
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    for (const m of ms) {
      const key = m.r + ',' + m.c;
      if (!samples.has(key) || seenCar.has(key)) continue;
      const car = byKey.get(key);
      const t = St.cloneState(s);
      const ok = Sim.applyPick(t, m.r, m.c);
      if (!ok) continue;
      seenCar.add(key);
      const gain = t.eliminatedPixels - s.eliminatedPixels;
      samples.get(key).push({ progress: r4(progress), gain, ratio: car.count ? r4(gain / car.count) : 0 });
    }

    let pick = null;
    if (policy === 'random') {
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      for (const k of idx) {
        const m = ms[k], t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!isDead(t) || isWon(t)) { pick = { r: m.r, c: m.c, t }; break; }
      }
    } else {
      // free-first：PopulationSim_v1.freePath 的排序键
      let best = null, bestKey = null;
      for (const m of ms) {
        const t = St.cloneState(s);
        const e0 = t.eliminatedPixels, d0 = t.completedBoxes;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        const o = { r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0, delta: t.completedBoxes - d0 };
        const bufAfter = t.buffer.length;
        const debtPx = t.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
        const nextM = isWon(t) ? 0 : legalN(t);
        const dead = t.overflow || bufAfter > t.bufferLimit || (bufAfter >= t.bufferLimit && o.delta === 0) || (!isWon(t) && nextM === 0);
        const key = [dead ? 0 : 1, bufAfter === 0 ? 1 : 0, o.gain, -bufAfter, -debtPx, -o.r, -o.c];
        let better = false;
        if (!best) better = true;
        else { for (let i = 0; i < key.length; i++) { if (key[i] !== bestKey[i]) { better = key[i] > bestKey[i]; break; } } }
        if (better) { best = o; bestKey = key; }
      }
      if (best) pick = best;
    }
    if (!pick) break;
    steps++;
    s = pick.t;
    if (isDead(s) && !isWon(s)) break;
  }
  return { won: isWon(s), steps, samples, reach };
}

function summarize(samples, reach, games) {
  const perCar = cars.map(c => {
    const ss = samples.get(c.key);
    const progs = ss.map(x => x.progress), gains = ss.map(x => x.gain), ratios = ss.map(x => x.ratio);
    return {
      r: c.r, c: c.c, color: c.color, count: c.count, gamesSeen: ss.length,
      firstProgressMedian: median(progs), firstProgressP25: pct(progs, 0.25), firstProgressP75: pct(progs, 0.75),
      gainMedian: median(gains), ratioMedian: median(ratios), ratioP25: pct(ratios, 0.25), ratioP75: pct(ratios, 0.75),
      samples: ss
    };
  });
  const perColor = colors.map(col => {
    const rr = reach.get(col);
    return {
      color: col, capacity: colorCap[col], gamesSeen: rr.length,
      firstReachMedian: median(rr), firstReachP25: pct(rr, 0.25), firstReachP75: pct(rr, 0.75), values: rr
    };
  });
  return { perCar, perColor };
}

// 20 局随机（同一 LCG 连续消耗，与 PopulationSim 的 runLevel 相同）
const rnd = lcg(SEED);
const aggSamples = newSamples(), aggReach = newReach();
for (const col of colors) aggReach.get(col).length = 0;
let wins = 0;
const routes = [];
for (let g = 0; g < NGAMES; g++) {
  const res = play('random', rnd);
  if (res.won) wins++;
  routes.push({ won: res.won, steps: res.steps });
  for (const [k, arr] of res.samples) for (const x of arr) aggSamples.get(k).push(x);
  for (const [col, arr] of res.reach) for (const x of arr) aggReach.get(col).push(x);
}
const base = summarize(aggSamples, aggReach, NGAMES);

let free = null;
if (DO_FREE) {
  const fr = play('free', null);
  const fs_ = summarize(fr.samples, fr.reach, 1);
  free = { won: fr.won, steps: fr.steps, perCar: fs_.perCar, perColor: fs_.perColor };
}

console.log(`随机玩家 ${NGAMES} 局 seed=${SEED}：通关 ${wins}/${NGAMES}`);
console.log('\ncolor cap  首次可达进度中位(p25..p75)  局数');
for (const c of base.perColor.slice().sort((a, b) => (a.firstReachMedian == null ? 2 : a.firstReachMedian) - (b.firstReachMedian == null ? 2 : b.firstReachMedian))) {
  const p = (x) => x == null ? '—' : (x * 100).toFixed(1) + '%';
  console.log(`${String(c.color).padStart(5)} ${String(c.capacity).padStart(4)}  ${p(c.firstReachMedian).padEnd(10)} (${p(c.firstReachP25)}..${p(c.firstReachP75)})  ${c.gamesSeen}/${NGAMES}`);
}
console.log('\npos      color/count  首次可点中位  首点gain中位  ratio中位  样本');
for (const c of base.perCar.slice().sort((a, b) => (a.firstProgressMedian == null ? 9 : a.firstProgressMedian) - (b.firstProgressMedian == null ? 9 : b.firstProgressMedian))) {
  const p = (x) => x == null ? '—' : (x * 100).toFixed(1) + '%';
  console.log(`r${c.r}c${c.c}   ${String(c.color).padStart(2)}/${String(c.count).padEnd(4)}   ${p(c.firstProgressMedian).padEnd(12)} ${String(c.gainMedian).padEnd(11)} ${p(c.ratioMedian).padEnd(9)} ${c.gamesSeen}/${NGAMES}`);
}
if (free) {
  console.log(`\nfree-first：${free.won ? '通关' : '失败'}，${free.steps} 步`);
  for (const c of free.perCar.slice().sort((a, b) => (a.firstProgressMedian == null ? 9 : a.firstProgressMedian) - (b.firstProgressMedian == null ? 9 : b.firstProgressMedian))) {
    const p = (x) => x == null ? '—' : (x * 100).toFixed(1) + '%';
    console.log(`r${c.r}c${c.c} ${String(c.color).padStart(2)}/${String(c.count).padEnd(4)} first=${p(c.firstProgressMedian).padEnd(8)} gain=${String(c.gainMedian).padEnd(5)} ratio=${p(c.ratioMedian)}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify({
  level: path.resolve(levelFile), seed: SEED, games: NGAMES, randomWins: wins,
  perCar: base.perCar, perColor: base.perColor, routes, freeFirst: free
}, null, 1));
console.log('\n结果: ' + path.resolve(OUT));
