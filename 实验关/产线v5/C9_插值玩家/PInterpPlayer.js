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
// 瞬时连锁（策略0，2026-11-21）：--instant-chain
const INSTANT_CHAIN = flags['instant-chain'] === true;
// 【2026-11-22 第二刀】短视真人模型（--human-casual）：
//   随意端不再闭眼点 0 暴露像素的颜色，而是在“当前能吃到像素(gain>0)”的车里短视选择（不精算车容量是否超过暴露量、易误点大车或贪解链卡槽）；
//   认真端不仅看 gain，而且优先选“能当场吃满退场、暂存区占用最少(-buffer.length)”的车（看数字选小车防占坑）。
const HUMAN_CASUAL = flags['human-casual'] === true;

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
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: BOTTOM_ONLY, instantChain: INSTANT_CHAIN });
  let steps = 0;
  let maxBuffer = s.buffer.length;
  // 【2026-11-22 第三刀】前(0-30%) / 中(30-70%) / 后(70-100%) 三段暂存区峰值波形跟踪
  let bufEarlyMax = s.buffer.length, bufMidMax = 0, bufLateMax = 0;
  const pureRandom = p <= 0;
  const pureGreedy = p >= 1;

  while (!isWon(s) && steps < MAX_STEPS) {
    const progress = s.eliminatedPixels / s.totalPixels;

    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    const aliveT = (t) => !isDead(t) || isWon(t);

    let pick = null;
    const useGreedy = pureGreedy || (!pureRandom && rnd() < p);

    if (HUMAN_CASUAL) {
      // 【2026-11-22 第二刀：短视真人模型】
      // 关键物理差异：
      //   1) 真人没有模拟器的“当步免死透视眼(aliveT)”！当暂存区已占 3-4 格时，若某辆车（或锁链）在当前暴露边界上有同色像素(gain>0)，
      //      短视真人看到“上面有这个颜色可消”就会点下去，而不会提前算清“它吃掉这几颗像素后还剩尾巴，会把第 5 个槽占满导致满槽暴毙(isDead)”！
      //   2) 但真人也绝不瞎点：只要场上有能吃到像素的车(gain>0)，真人不会去点 0 暴露像素的车（除非当前只剩 1-2 格负载且想盲开锁链，或全场无 gain>0 的车）。
      const allMoves = [];
      for (const m of ms) {
        const t = St.cloneState(s);
        const e0 = t.eliminatedPixels;
        const c0 = t.completedBoxes;
        const cell = s.cells[m.r] && s.cells[m.r][m.c];
        const carCount = (cell && cell.count) || 0;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        allMoves.push({
          r: m.r, c: m.c, t,
          alive: aliveT(t),
          gain: t.eliminatedPixels - e0,
          bufAfter: t.buffer.length,
          cleared: t.completedBoxes > c0 ? 1 : 0,
          carCount
        });
      }
      if (useGreedy) {
        // 认真真人端：有免死预判(只选 alive)，且看数字算容量——优先选“当场吃满退场(cleared=1)、暂存最少(-bufAfter)、消得最多(gain)”
        const aliveList = allMoves.filter(o => o.alive);
        if (aliveList.length) {
          aliveList.sort((a, b) => (b.cleared - a.cleared) || (a.bufAfter - b.bufAfter) || (b.gain - a.gain));
          const top = aliveList[0];
          const tied = aliveList.filter(o => o.cleared === top.cleared && o.bufAfter === top.bufAfter && o.gain === top.gain);
          pick = tied[Math.floor(rnd() * tied.length)];
        }
      } else {
        // 【短视随意真人端（两阶段真人心理模型）】：
        // 1) 安全/大意期（暂存区 <= 2 格，空位充裕）：真人只看颜色不看数字！
        //    在所有“当前能吃到像素(gain>0)”的车里，真人反而偏爱“看着还没吃完、或者容量大/带链”的车（不会精算 cleared），
        //    甚至在有多辆同色车时有 70% 概率误点不能当场退场的大车/锁链(cleared===0)，从而在暂存区不知不觉攒下 2-3 辆卡槽大车！
        // 2) 警觉/自救期（暂存区 >= 3 格，红灯亮起只剩 1-2 个空位）：
        //    真人看到槽快满了会本能避开“当步立刻满槽自杀(!alive，如只剩1空位还去点双车链)”的选项；
        //    但在存活选项里，仍有 50% 概率只看眼前能消最多像素(gain最大)而不看能否退场，若前期攒下的卡槽大车无异色车可剥层解救，则在自救期满槽阵亡！
        const aliveList = allMoves.filter(o => o.alive);
        // 【派工#010+#011】视线阈值按全盘平均车容量缩放 + 小车饱腹感识别：
        // <=24px/车（32/35 小图）严格维持 6/8；中大图除认 gain>=chunkThr 外，
        // 只要某辆车能当场吃满退场(cleared===1)或吃饱自身容量的 35%(gain>=6 && gain>=carCount*0.35)，真人同样会纳入主力视野，绝不死磕唯一巨车！
        const avgCap = Math.max(20, Math.round((s.totalPixels || 1024) / 52));
        const chunkThr = avgCap <= 24 ? 6 : Math.round(avgCap * 0.28);
        const fatalThr = avgCap <= 24 ? 8 : Math.round(avgCap * 0.35);
        const isGoodChunk = (o) => o.gain >= chunkThr || (avgCap > 24 && (o.cleared === 1 || (o.gain >= 6 && o.gain >= o.carCount * 0.35)));
        if (s.buffer.length <= 2) {
          const chunkVis = aliveList.filter(isGoodChunk);
          const anyVis   = aliveList.filter(o => o.gain > 0);
          const pool = chunkVis.length > 0 ? chunkVis : (anyVis.length > 0 ? anyVis : aliveList);
          if (pool.length) pick = pool[Math.floor(rnd() * pool.length)];
        } else {
          const fatalVisible = allMoves.filter(o => !o.alive && o.gain >= fatalThr && (avgCap <= 24 || o.gain >= o.carCount * 0.22));
          const safeChunk    = aliveList.filter(isGoodChunk);
          const safeVisible  = safeChunk.length > 0 ? safeChunk : aliveList.filter(o => o.gain > 0);
          if (fatalVisible.length > 0 && rnd() < 0.20) {
            pick = null; // 看走眼大车容量，当步满槽阵亡
          } else if (safeVisible.length > 0) {
            pick = safeVisible[Math.floor(rnd() * safeVisible.length)];
          } else if (aliveList.length > 0) {
            pick = aliveList[Math.floor(rnd() * aliveList.length)];
          }
        }
      }
    } else if (useGreedy) {
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
      return { won: false, steps, deathProgress: round(progress, 6), maxBuffer, bufWave: [bufEarlyMax, bufMidMax, bufLateMax] };
    }
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
    s = pick.t;
    const bNow = s.buffer.length;
    if (bNow > maxBuffer) maxBuffer = bNow;
    const pNow = s.eliminatedPixels / s.totalPixels;
    if (pNow < 0.30) { if (bNow > bufEarlyMax) bufEarlyMax = bNow; }
    else if (pNow < 0.70) { if (bNow > bufMidMax) bufMidMax = bNow; }
    else { if (bNow > bufLateMax) bufLateMax = bNow; }
    steps++;
  }
  if (isWon(s)) return { won: true, steps, deathProgress: null, maxBuffer, bufWave: [bufEarlyMax, bufMidMax, bufLateMax] };
  return { won: false, steps, deathProgress: round(s.eliminatedPixels / s.totalPixels, 6), maxBuffer, bufWave: [bufEarlyMax, bufMidMax, bufLateMax] };
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
    bufWaveMean: allGames.length ? [
      round(allGames.reduce((a, g) => a + (g.bufWave ? g.bufWave[0] : 0), 0) / allGames.length, 2),
      round(allGames.reduce((a, g) => a + (g.bufWave ? g.bufWave[1] : 0), 0) / allGames.length, 2),
      round(allGames.reduce((a, g) => a + (g.bufWave ? g.bufWave[2] : 0), 0) / allGames.length, 2)
    ] : null,
    midTightRate: wins > 0 ? round(allGames.filter(g => g.won && g.bufWave && g.bufWave[1] >= 3).length / wins, 3) : 0,
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
      seeds: sm.seeds, winRate: sm.winRate, deathMean: sm.deathMean, deathDist: sm.deathDist,
      bufWaveMean: sm.bufWaveMean, midTightRate: sm.midTightRate
    });
    console.log(`${pTag(p)}  ${sm.level}  win=${sm.winRate.toFixed(2)}  ${sm.seeds.map(x => `${x.seed}=${x.winRate.toFixed(2)}`).join(' ')}`);
  }
}
fs.writeFileSync(path.join(OUT, 'summary_all.json'), JSON.stringify(all, null, 2));
console.log(`写入 ${path.join(OUT, 'summary_all.json')}  (${all.length} 行)`);
