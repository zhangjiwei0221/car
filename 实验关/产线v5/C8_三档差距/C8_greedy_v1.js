#!/usr/bin/env node
'use strict';
/**
 * C8_greedy_v1 —— 贪心玩家（本步吃得最多，平手随机；避开当步就死）批量模拟
 *
 * 任务：C8 三档差距（全知 / 贪心 / 随机）。
 * 口径与 PopulationSim_v1 的 random 玩家一致：
 *   corner（loadSolver('corner')）、useSlotStart: true、instantChain: false。
 * 与 PopulationSim 的 greedy（lure）区别：平手时 **均匀随机**，不是“暂存少优先”，
 * 这样 100 局才有分布，而不是每关一条固定路线。
 *
 * 用法：
 *   node C8_greedy_v1.js <关卡.json | 目录> [--games 100] [--seeds 977] [--out <目录>]
 *
 * 输出（单文件写到 --out；目录输入写到 --out/<关名>/）：
 *   summary.json { level, games, seeds:[{seed,games,wins,winRate}],
 *                  winRate, deathDist:{lt10,p10_25,p25_50,p50_90,gt90},
 *                  perGame:[{won,steps,deathProgress,maxBuffer}] }
 *   deathDist 只统计失败局；区间按死亡时（失败步之前）已消除像素百分比。
 */
const fs = require('fs');
const path = require('path');

const B = require('../../../03_工具/正式版/Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const args = process.argv.slice(2);
const flags = {};
const positionals = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const nxt = args[i + 1];
    if (nxt !== undefined && !nxt.startsWith('--')) { flags[a.slice(2)] = nxt; i++; }
    else flags[a.slice(2)] = true;
  } else positionals.push(a);
}
const INPUT = positionals[0];
if (!INPUT) { console.error('用法: node C8_greedy_v1.js <关卡.json | 目录> [--games 100] [--seeds 977] [--out <目录>]'); process.exit(2); }
const NGAMES = flags.games === undefined ? 100 : Number(flags.games);
if (!Number.isFinite(NGAMES) || NGAMES < 1) { console.error('--games 必须是正整数'); process.exit(2); }
const SEEDS = String(flags.seeds === undefined ? '977' : flags.seeds).split(',').map(x => Number(x.trim())).filter(Number.isFinite);
if (!SEEDS.length) { console.error('--seeds 解析为空'); process.exit(2); }
const OUT = flags.out === true || flags.out === undefined ? '' : String(flags.out);
if (!OUT) { console.error('需要 --out <目录>'); process.exit(2); }

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const round = (x, n) => { const p = Math.pow(10, n); return Math.round(x * p) / p; };

function lcg(seed) {
  let rs = seed;
  return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
}

/** 贪心一局：每步在与当前最优 gain 并列的“当步不死”选项里均匀随机。 */
function playGreedy(lv, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const steps = [];
  let maxBuffer = s.buffer.length;
  const maxSteps = 200;
  while (!isWon(s) && steps.length < maxSteps) {
    const progress = s.eliminatedPixels / s.totalPixels;
    const opts = [];
    for (const m of Sim.listMoves(s)) {
      if (m.blocked) continue;
      const t = St.cloneState(s);
      const e0 = t.eliminatedPixels;
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      opts.push({ r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0 });
    }
    const alive = opts.filter(o => !isDead(o.t) || isWon(o.t));
    if (!alive.length) {
      return { won: false, steps: steps.length, deathProgress: round(progress, 6), maxBuffer };
    }
    let best = -Infinity;
    for (const o of alive) if (o.gain > best) best = o.gain;
    const tied = alive.filter(o => o.gain === best);
    const pick = tied[Math.floor(rnd() * tied.length)];
    steps.push(pick.gain);
    s = pick.t;
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
  }
  if (isWon(s)) return { won: true, steps: steps.length, deathProgress: null, maxBuffer };
  return { won: false, steps: steps.length, deathProgress: round(s.eliminatedPixels / s.totalPixels, 6), maxBuffer };
}

function deathDist(perGame) {
  const d = { lt10: 0, p10_25: 0, p25_50: 0, p50_90: 0, gt90: 0 };
  for (const g of perGame) {
    if (g.won) continue;
    const p = g.deathProgress * 100;
    if (p < 10) d.lt10++;
    else if (p < 25) d.p10_25++;
    else if (p < 50) d.p25_50++;
    else if (p <= 90) d.p50_90++;
    else d.gt90++;
  }
  return d;
}

function listLevels(input) {
  const st = fs.statSync(input);
  if (st.isDirectory()) {
    return fs.readdirSync(input).filter(f => f.toLowerCase().endsWith('.json')).sort().map(f => path.join(input, f));
  }
  return [input];
}

function runLevel(file, outDir) {
  const game = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lv = A.parseLevel(A.fromGameFormat(game));
  fs.mkdirSync(outDir, { recursive: true });
  const levelName = path.basename(file);
  const seedRows = [];
  const allGames = [];
  for (const seed of SEEDS) {
    const rnd = lcg(seed);
    const perGame = [];
    for (let i = 0; i < NGAMES; i++) perGame.push(playGreedy(lv, rnd));
    const wins = perGame.filter(g => g.won).length;
    seedRows.push({ seed, games: NGAMES, wins, winRate: round(wins / NGAMES, 4) });
    allGames.push(...perGame);
  }
  const wins = allGames.filter(g => g.won).length;
  const summary = {
    level: levelName,
    games: allGames.length,
    seeds: seedRows,
    winRate: round(wins / allGames.length, 4),
    deathDist: deathDist(allGames),
    perGame: allGames
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`${levelName}  greedy=${summary.winRate.toFixed(3)}  deathDist=${JSON.stringify(summary.deathDist)}`);
  return summary;
}

const levels = listLevels(INPUT);
const multi = levels.length > 1 || fs.statSync(INPUT).isDirectory();
fs.mkdirSync(OUT, { recursive: true });
const all = [];
for (const file of levels) {
  const outDir = multi ? path.join(OUT, path.basename(file).replace(/\.json$/i, '')) : OUT;
  all.push(runLevel(file, outDir));
}
if (multi) fs.writeFileSync(path.join(OUT, 'summary_all.json'), JSON.stringify(all, null, 2));
