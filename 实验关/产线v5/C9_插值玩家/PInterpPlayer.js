#!/usr/bin/env node
'use strict';
/**
 * PInterpPlayer —— C9 插值玩家（p-贪心）
 *
 * 每一步：
 *   - 以概率 p 走「贪心」：在“当步不死”的选项里选本步 gain 最大；并列时均匀随机。
 *   - 以概率 1−p 走「随机」：在“当步不死”的选项里均匀随机。
 * 当步不死 = !overflow && buffer.length<=bufferLimit && !Sim.isDeadEnd（通关除外）。
 *
 * 口径与 PopulationSim_v1 / C8_greedy_v1 一致：
 *   loadSolver('corner')、createState(useSlotStart:true, instantChain:false)、
 *   Sim.listMoves 过滤 !blocked、随机数用同一个 LCG、赢了就停。
 *
 * 端点刻意对齐已知实现（便于复核）：
 *   p <= 0：不额外消耗决策随机数，完全复刻 PopulationSim_v1 random 的
 *           “整张合法车列表洗牌（ms.length−1 次 rnd）→ 取第一个当步不死”，
 *           因此同种子下 p=0 的通关率与 PopulationSim_v1 --random 逐局相同。
 *   p >= 1：不额外消耗决策随机数，完全复刻 C8_greedy_v1 的
 *           “gain 最大、并列均匀随机（每步消耗 1 次 rnd）”，
 *           因此同种子下 p=1 的通关率与 C8_greedy_v1 逐局相同。
 *   0<p<1：每步先抽 1 次 rnd 决定走哪一端；随机端仍用“洗牌→第一个不死”。
 *   不同 p 是各自独立的模拟（不是对同一条随机流做插值），只共享种子。
 *
 * 用法：
 *   node PInterpPlayer.js <关卡.json | 目录> [--levels 2,3,...,13] \
 *     [--p 0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1] \
 *     [--games 100] [--seeds 977,4242] [--out <目录>]
 *
 * 目录输入时用 --levels 精确挑选 G2_bq_level_<n>.json（默认 2..13）。
 *
 * 输出（每个 p 一个子目录，目录名 p0.000 … p1.000）：
 *   <out>/p<p>/G2_bq_level_<n>/summary.json
 *     { level, p, games, seeds:[{seed,games,wins,winRate}], winRate,
 *       deathMean, deathDist, perGame:[{won,steps,deathProgress,maxBuffer}] }
 *   <out>/summary_all.json  上面 summary 的数组（不含 perGame）
 *
 * 字段口径同 PopulationSim_v1 / C8_greedy_v1：
 *   steps        实际点了多少步
 *   deathProgress 失败步之前 eliminatedPixels/totalPixels（0–1）；通关为 null
 *   maxBuffer    全程暂存车数最大值
 */
const fs = require('fs');
const path = require('path');

const B = require('../../../03_工具/正式版/Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

// ==================== 参数 ====================
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
if (!INPUT || flags.help) {
  console.error('用法: node PInterpPlayer.js <关卡.json | 目录> [--levels 2,3,...,13] [--p 0,0.1,...,1] [--games 100] [--seeds 977,4242] [--out <目录>]');
  process.exit(INPUT ? 0 : 2);
}
const LEVELS = String(flags.levels === undefined ? '2,3,4,5,6,7,8,9,10,11,12,13' : flags.levels)
  .split(',').map(x => Number(x.trim())).filter(Number.isFinite);
const PLIST = String(flags.p === undefined ? '0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1' : flags.p)
  .split(',').map(x => Number(x.trim())).filter(x => Number.isFinite(x) && x >= 0 && x <= 1);
if (!PLIST.length) { console.error('--p 解析为空'); process.exit(2); }
const NGAMES = flags.games === undefined ? 100 : Number(flags.games);
if (!Number.isFinite(NGAMES) || NGAMES < 1) { console.error('--games 必须是正整数'); process.exit(2); }
const SEEDS = String(flags.seeds === undefined ? '977' : flags.seeds)
  .split(',').map(x => Number(x.trim())).filter(Number.isFinite);
if (!SEEDS.length) { console.error('--seeds 解析为空'); process.exit(2); }
const OUT = flags.out === true || flags.out === undefined ? '' : String(flags.out);
if (!OUT) { console.error('需要 --out <目录>'); process.exit(2); }
// 三面墙（bottomOnly）：上/左/右为墙、只从底边进（2026-11-21）
const BOTTOM_ONLY = flags['bottom-only'] === true;

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const round = (x, n) => { const p = Math.pow(10, n); return Math.round(x * p) / p; };

// 与 PopulationSim_v1 / C8_greedy_v1 / PressureBuild_v5 相同的 LCG（逐位复刻，含浮点损失）
function lcg(seed) {
  let rs = seed;
  return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
}

const MAX_STEPS = 200;

/**
 * 一局 p-贪心。
 * @param {object} lv   A.parseLevel(A.fromGameFormat(game))
 * @param {number} p    贪心概率
 * @param {function} rnd LCG
 */
function playInterp(lv, p, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: BOTTOM_ONLY, instantChain: false });
  let steps = 0;
  let maxBuffer = s.buffer.length;
  const pureRandom = p <= 0;
  const pureGreedy = p >= 1;

  while (!isWon(s) && steps < MAX_STEPS) {
    const progress = s.eliminatedPixels / s.totalPixels;

    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    const aliveT = (t) => !isDead(t) || isWon(t);

    let pick = null;
    const useGreedy = pureGreedy || (!pureRandom && rnd() < p);

    if (useGreedy) {
      // 贪心端：展开全部合法选项，alive 里 gain 最大；并列均匀随机。
      // 与 C8_greedy_v1 一致：每步消耗 1 次 rnd（即使没有并列）。
      const cand = [];
      for (const m of ms) {
        const t = St.cloneState(s);
        const e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!aliveT(t)) continue;
        cand.push({ r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0 });
      }
      if (cand.length) {
        let best = -Infinity;
        for (const o of cand) if (o.gain > best) best = o.gain;
        const tied = cand.filter(o => o.gain === best);
        pick = tied[Math.floor(rnd() * tied.length)];
      }
    } else {
      // 随机端：整张合法车列表洗牌（ms.length−1 次 rnd）→ 第一个当步不死。
      // 与 PopulationSim_v1 runRandomNoStats 逐位一致（含惰性 clone+applyPick）。
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const x = idx[i]; idx[i] = idx[j]; idx[j] = x;
      }
      for (const k of idx) {
        const m = ms[k];
        const t = St.cloneState(s);
        const e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (aliveT(t)) { pick = { r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0 }; break; }
      }
    }

    if (!pick) {
      if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
      return { won: false, steps, deathProgress: round(progress, 6), maxBuffer };
    }
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
    s = pick.t;
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
    steps++;
  }
  if (isWon(s)) return { won: true, steps, deathProgress: null, maxBuffer };
  return { won: false, steps, deathProgress: round(s.eliminatedPixels / s.totalPixels, 6), maxBuffer };
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

function pTag(p) { return 'p' + p.toFixed(3); }

function listLevels(input) {
  const st = fs.statSync(input);
  if (st.isDirectory()) {
    const want = new Set(LEVELS);
    const found = fs.readdirSync(input)
      .map(f => ({ f, m: /^G2_bq_level_(\d+)\.json$/i.exec(f) }))
      .filter(x => x.m && want.has(Number(x.m[1])))
      .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
      .map(x => path.join(input, x.f));
    if (found.length !== want.size) {
      const got = new Set(found.map(f => Number(/^G2_bq_level_(\d+)\.json$/i.exec(path.basename(f))[1])));
      const missing = LEVELS.filter(n => !got.has(n));
      if (missing.length) console.error(`警告: 目录中缺少关卡 ${missing.join(',')}`);
    }
    return found;
  }
  return [input];
}

function runLevel(file, p, outDir) {
  const game = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lv = A.parseLevel(A.fromGameFormat(game));
  fs.mkdirSync(outDir, { recursive: true });
  const levelName = path.basename(file);

  const seedRows = [];
  const allGames = [];
  for (const seed of SEEDS) {
    const rnd = lcg(seed);
    const perGame = [];
    for (let i = 0; i < NGAMES; i++) perGame.push(playInterp(lv, p, rnd));
    const wins = perGame.filter(g => g.won).length;
    seedRows.push({ seed, games: NGAMES, wins, winRate: round(wins / NGAMES, 4) });
    allGames.push(...perGame);
  }
  const wins = allGames.filter(g => g.won).length;
  const fails = allGames.filter(g => !g.won);
  const summary = {
    level: levelName,
    levelNo: Number((/level_(\d+)/i.exec(levelName) || [])[1]),
    p,
    games: allGames.length,
    seeds: seedRows,
    winRate: round(wins / allGames.length, 4),
    deathMean: fails.length ? round(fails.reduce((a, g) => a + g.deathProgress, 0) / fails.length, 4) : null,
    deathDist: deathDist(allGames),
    perGame: allGames
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

// ==================== 主流程 ====================
const levels = listLevels(INPUT);
fs.mkdirSync(OUT, { recursive: true });
const all = [];
for (const p of PLIST) {
  for (const file of levels) {
    const outDir = path.join(OUT, pTag(p), path.basename(file).replace(/\.json$/i, ''));
    const sm = runLevel(file, p, outDir);
    all.push({
      level: sm.level, levelNo: sm.levelNo, p: sm.p, games: sm.games,
      seeds: sm.seeds, winRate: sm.winRate, deathMean: sm.deathMean, deathDist: sm.deathDist
    });
    console.log(`${pTag(p)}  ${sm.level}  win=${sm.winRate.toFixed(2)}  ${sm.seeds.map(x => `${x.seed}=${x.winRate.toFixed(2)}`).join(' ')}`);
  }
}
fs.writeFileSync(path.join(OUT, 'summary_all.json'), JSON.stringify(all, null, 2));
console.log(`写入 ${path.join(OUT, 'summary_all.json')}  (${all.length} 行)`);
