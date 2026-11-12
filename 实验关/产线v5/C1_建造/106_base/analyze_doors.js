#!/usr/bin/env node
'use strict';
/**
 * 106 底座「门候补车」分析（只读关卡；不修改任何关卡/工具）
 *
 * 用法:
 *   node analyze_doors.js <关卡.json> --target <目标图.txt> --games 20 --seed 1 \
 *        --colors 32,14 --out <结果.json>
 *
 * 输出:
 *   1) 每个目标色车的 count/位置/障碍（链组、数字冰、问号、管道）
 *   2) 车上容量合计 vs 目标图该色像素数
 *   3) 20 局随机玩家（与 PopulationSim_v1 完全相同的 LCG + 洗牌 + 当步不死判据）
 *      每辆车「第一次进入合法可点列表」时的进度；跨局取中位数
 *
 * 随机玩家逐行对齐 PopulationSim_v1.runRandomNoStats：
 *   - lcg(seed)：rs=(rs*1103515245+12345)&0x7fffffff; return rs/0x7fffffff
 *   - 每步 Sim.listMoves(s).filter(!blocked)，倒序 Fisher-Yates 洗牌，取第一个当步不死的
 *   - 同一 seed 下 20 局连续消耗同一 LCG（与 PopulationSim 的 runLevel 相同）
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
if (!levelFile || levelFile.startsWith('--')) {
  console.error('用法: node analyze_doors.js <关卡.json> --target <图.txt> --games 20 --seed 1 --colors 32,14 --out <结果.json>');
  process.exit(2);
}
const targetFile = arg('--target', '/Users/red/Desktop/正常关卡/106.txt');
const NGAMES = Number(arg('--games', 20));
const SEED = Number(arg('--seed', 1));
const COLORS = String(arg('--colors', '32,14')).split(',').map(Number);
const OUT = arg('--out', `/tmp/analyze_doors_${process.pid}.json`);

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) {
  if (!a.length) return null;
  const b = a.slice().sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

// ---------- 目标图像素 ----------
const tl = fs.readFileSync(targetFile, 'utf8').trim().split(/\r?\n/).slice(1);
const targetHist = {};
for (const line of tl) for (const x of line.trim().split(/\s+/).map(Number)) if (x) targetHist[x] = (targetHist[x] || 0) + 1;

// ---------- 关卡车表 ----------
const game = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));
const sp = game.spools;
const obstacleOf = (s) => {
  const types = Array.isArray(s.type) ? s.type : (s.type ? [s.type] : []);
  if (types.includes(5)) return { kind: 'chain', group: s.param };
  if (types.includes(7)) return { kind: 'numice', ticks: Array.isArray(s.param) ? s.param[types.indexOf(7)] : s.param };
  if (types.includes(6)) return { kind: 'question' };
  const pipe = types.find(t => t >= 11 && t <= 14);
  if (pipe) return { kind: 'pipe', dir: pipe, queue: s.param };
  return { kind: 'none' };
};
const cars = [];
for (let r = 0; r < sp.length; r++) for (let c = 0; c < sp[r].length; c++) {
  const s = sp[r][c];
  if (s && s.id > 0) cars.push({ r, c, color: s.id, count: s.count || 0, obs: obstacleOf(s), rawType: s.type, rawParam: s.param });
}

// ---------- 20 局随机玩家：记录每车第一次可点进度 ----------
const firstSeen = new Map(); // key r,c -> [progress...]
for (const car of cars) if (COLORS.includes(car.color)) firstSeen.set(car.r + ',' + car.c, []);
const routes = [];
const rnd = lcg(SEED);
for (let g = 0; g < NGAMES; g++) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const route = [];
  const seenThisGame = new Set();
  while (!isWon(s)) {
    const progress = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    // 第一次可点：本步合法列表里出现即记录（同一局只记一次）
    for (const m of ms) {
      const key = m.r + ',' + m.c;
      if (firstSeen.has(key) && !seenThisGame.has(key)) {
        seenThisGame.add(key);
        firstSeen.get(key).push(progress);
      }
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
    route.push({ step: route.length + 1, r: pick.r, c: pick.c, progress: Math.round(progress * 1e6) / 1e6 });
    s = pick.t;
  }
  routes.push({ won: isWon(s), steps: route.length, route });
}

const perCar = cars.filter(c => COLORS.includes(c.color)).map(c => {
  const vals = firstSeen.get(c.r + ',' + c.c) || [];
  return {
    ...c,
    firstClickSamples: vals.map(v => Math.round(v * 1e4) / 1e4).sort((a, b) => a - b),
    firstClickMedian: median(vals) == null ? null : Math.round(median(vals) * 1e4) / 1e4,
    gamesSeen: vals.length
  };
});
for (const color of COLORS) {
  const list = perCar.filter(c => c.color === color);
  list.sort((a, b) => (a.firstClickMedian == null ? 2 : a.firstClickMedian) - (b.firstClickMedian == null ? 2 : b.firstClickMedian));
  const sum = list.reduce((a, b) => a + b.count, 0);
  console.log(`\n=== 颜色 ${color}：${list.length} 辆，容量合计 ${sum} / 目标像素 ${targetHist[color] || 0} ${sum === (targetHist[color] || 0) ? '✅' : '❌'} ===`);
  console.log('pos       count  障碍              首次可点进度中位   样本');
  for (const c of list) {
    const obs = c.obs.kind === 'chain' ? `链组${c.obs.group}`
      : c.obs.kind === 'numice' ? `数字冰${c.obs.ticks}`
      : c.obs.kind === 'question' ? '问号' : c.obs.kind;
    const med = c.firstClickMedian == null ? '从未可点' : (c.firstClickMedian * 100).toFixed(1) + '%';
    console.log(`r${c.r}c${c.c}     ${String(c.count).padEnd(5)}  ${obs.padEnd(16)}  ${med.padEnd(16)}  ${c.gamesSeen}/${NGAMES}`);
  }
}
const wins = routes.filter(r => r.won).length;
console.log(`\n随机玩家 ${NGAMES} 局：通关 ${wins}/${NGAMES}（seed=${SEED}）`);

fs.writeFileSync(OUT, JSON.stringify({
  level: path.resolve(levelFile), target: path.resolve(targetFile), seed: SEED, games: NGAMES,
  targetHist, cars: perCar, randomWins: wins, routes
}, null, 1));
console.log('结果: ' + path.resolve(OUT));
