#!/usr/bin/env node
'use strict';
/**
 * shareF0 —— C3：沿随机玩家路线重放，统计“无免费选项”步（F0）占比（2026-11-12）
 *
 * 口径（与 PopulationSim_v1 --no-mcfd 的随机玩家完全同序列）：
 *   每步把合法车洗牌，逐个 cloneState + applyPick，第一个“当步不死”的就点。
 *   F0：在该步**点之前**，枚举所有 !blocked 的 listMoves，cloneState + applyPick；
 *       如果没有任何一个选项能让 buffer 减少或持平（即全部 bufferAfter > bufferBefore），
 *       记该步为 F0。
 * 输出：每关每种子 games/win/totalSteps/f0Steps/shareF0/最长连续F0/每局 shareF0 中位。
 *
 * 用法：node shareF0.js <关卡.json | 目录> --random 100 --seeds 977,4242,31337 --out <目录>
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../03_工具/正式版/Build006Thickness_v688'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
if (!input || input.startsWith('--')) { console.error('用法: node shareF0.js <关卡.json | 目录> --random 100 --seeds 977,4242,31337 --out <目录>'); process.exit(2); }
const RUNS = Math.max(1, Number(arg('--random', 100)) || 100);
const SEEDS = String(arg('--seeds', '977,4242,31337')).split(',').map(x => Number(x.trim())).filter(x => Number.isFinite(x));
const OUT = arg('--out', '');
const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
function r4(x) { return x == null ? null : +Number(x).toFixed(4); }

function runOnce(lv, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  let total = 0, f0 = 0, run = 0, maxRun = 0, win = false, steps = 0;
  while (!isWon(s)) {
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    steps++;
    // F0 判定：所有合法选项都使 buffer 增加
    let free = false;
    for (const m of ms) {
      const t = St.cloneState(s);
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      if (t.buffer.length <= s.buffer.length) { free = true; break; }
    }
    total++;
    if (!free) { f0++; run++; if (run > maxRun) maxRun = run; } else run = 0;
    // 随机玩家：洗牌 -> 第一个“当步不死”
    const idx = ms.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
    let pick = null;
    for (const k of idx) {
      const m = ms[k], t = St.cloneState(s);
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      if (!isDead(t) || isWon(t)) { pick = t; break; }
    }
    if (!pick) break;
    s = pick;
  }
  win = isWon(s);
  return { win, steps, total, f0, maxRun, share: total ? f0 / total : 0 };
}

function listLevels(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f));
  return [p];
}
const rows = [];
for (const file of listLevels(input)) {
  const game = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!game || !Array.isArray(game.spools)) continue;
  const lv = A.parseLevel(A.fromGameFormat(game));
  const seedRows = [];
  for (const seed of SEEDS) {
    const rnd = lcg(seed);
    const games = [];
    for (let i = 0; i < RUNS; i++) games.push(runOnce(lv, rnd));
    const total = games.reduce((a, g) => a + g.total, 0);
    const f0 = games.reduce((a, g) => a + g.f0, 0);
    const shares = games.map(g => g.share);
    seedRows.push({
      seed, games: RUNS, wins: games.filter(g => g.win).length, winRate: r4(games.filter(g => g.win).length / RUNS),
      totalSteps: total, f0Steps: f0, shareF0: r4(total ? f0 / total : 0),
      shareF0Median: r4(median(shares)),
      longestF0Max: Math.max(...games.map(g => g.maxRun)),
      longestF0Median: median(games.map(g => g.maxRun))
    });
  }
  const all = seedRows;
  const row = {
    file: path.basename(file),
    winMean: r4(all.reduce((a, x) => a + x.winRate, 0) / all.length),
    shareF0Mean: r4(all.reduce((a, x) => a + x.shareF0, 0) / all.length),
    shareF0MedianMean: r4(all.reduce((a, x) => a + x.shareF0Median, 0) / all.length),
    longestF0Median: median(all.map(x => x.longestF0Median)),
    longestF0Max: Math.max(...all.map(x => x.longestF0Max)),
    seeds: all
  };
  rows.push(row);
  console.log(`${row.file}  win=${row.winMean.toFixed(3)}  shareF0=${row.shareF0Mean.toFixed(3)} (per-run med ${row.shareF0MedianMean.toFixed(3)})  longestF0 med=${row.longestF0Median} max=${row.longestF0Max}`);
  for (const x of all) console.log(`  seed${x.seed}: win=${x.winRate.toFixed(2)} shareF0=${x.shareF0.toFixed(3)} per-runMed=${x.shareF0Median.toFixed(3)} longestMed=${x.longestF0Median} max=${x.longestF0Max}`);
}
if (OUT) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'shareF0.json'), JSON.stringify({ tool: 'shareF0', runs: RUNS, seeds: SEEDS, rows }, null, 2));
  console.log('saved ' + path.join(OUT, 'shareF0.json'));
}
