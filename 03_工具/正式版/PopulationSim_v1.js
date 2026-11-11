#!/usr/bin/env node
'use strict';
/**
 * PopulationSim_v1 —— 产线 v5 / A3·T4：群体模拟，输出逐局路线（2026-11-12）
 *
 * 来源：本文件的三个玩家实现 **逐行抽取** 自 PressureBuild_v5.js 的
 *   playPath()（random / lure 两种）与 freePath()。
 *   判据、随机数发生器（LCG）、洗牌顺序、排序键均未改动；只额外记录路线与
 *   每步的选项计数 M/C/F/D（纯观测，不参与决策）。
 *
 * 玩家：
 *   random  —— 每步把“合法可点”的车洗牌，逐个 cloneState+applyPick，
 *              第一个“当步不死”的就点；不死 = !overflow && buffer<=bufferLimit && !Sim.isDeadEnd。
 *   skilled —— free-first：dead / 吃完 / 吃得多 / 债少（PressureBuild_v5.freePath 的排序键）。
 *   greedy  —— lure：本步吃得最多，平手暂存少（PressureBuild_v5.playPath 'lure'）。
 *
 * 用法：
 *   node PopulationSim_v1.js <关卡.json | 目录> --random 100 --seeds 1,2,3 [--skilled] [--greedy] --out <目录>
 *
 * 输出（单文件输入直接写到 --out；目录输入写到 --out/<关名>/）：
 *   routes_seed<种子>.json  { level, seed, player:'random', games:[
 *     { won, steps, deathStep, deathProgress, maxBuffer,
 *       route:[{step,r,c,buffer,progress,gain,M,C,F,D}] } ] }
 *   summary.json            { level, random, seeds:[{seed,games,wins,winRate}],
 *                             randomWinRate:{mean,min,max,range},
 *                             skilled:{won,freeP3,steps}|null,
 *                             greedy:{won,steps}|null }
 *
 * 字段口径：
 *   steps       实际点了多少步
 *   deathStep   死亡时已点步数（= route.length）；通关为 null
 *   deathProgress 死亡状态 eliminatedPixels/totalPixels（0–1）；通关为 null
 *   buffer      该步**点之前**的暂存车数（与 PressureBuild 的 bufs 同口径）
 *   progress    该步**点之前**的 eliminatedPixels/totalPixels（0–1）
 *   gain        该步消除的像素数
 *   M           该步合法可点车数（Sim.listMoves 且 !blocked）
 *   C           该步至少吃 1px 的选项数
 *   F           该步不增加（<=）暂存车数的选项数
 *   D           该步增加暂存车数、但“当步不死”的选项数（死判据同 random 玩家）
 *   maxBuffer   全程暂存车数最大值（含点之前与终态）
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

// ==================== 参数 ====================
function usage(msg) {
  if (msg) console.error(msg);
  console.error('用法: node PopulationSim_v1.js <关卡.json | 目录> --random 100 --seeds 1,2,3 [--skilled] [--greedy] --out <目录>');
  process.exit(2);
}
const args = process.argv.slice(2);
const flags = {};
const positionals = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const nxt = args[i + 1];
    if (nxt !== undefined && !nxt.startsWith('--')) { flags[key] = nxt; i++; }
    else flags[key] = true;
  } else positionals.push(a);
}
const INPUT = positionals[0];
if (!INPUT) usage('缺少关卡输入');
const NRAND = flags.random === undefined ? 100 : Number(flags.random);
if (!Number.isFinite(NRAND) || NRAND < 1) usage('--random 必须是正整数');
const SEEDS = String(flags.seeds === undefined ? '1,2,3' : flags.seeds)
  .split(',').map(x => Number(x.trim())).filter(x => Number.isFinite(x));
if (!SEEDS.length) usage('--seeds 解析为空');
const DO_SKILLED = !!flags.skilled;
const DO_GREEDY = !!flags.greedy;
const OUT = flags.out === true || flags.out === undefined ? '' : String(flags.out);
if (!OUT) usage('需要 --out <目录>');

// ==================== 与 PressureBuild_v5.js 同口径的基础函数 ====================
const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const legalN = (s) => Sim.listMoves(s).filter(m => !m.blocked).length;

function expand(s) {
  const out = [];
  for (const m of Sim.listMoves(s)) {
    if (m.blocked) continue;
    const t = St.cloneState(s);
    const e0 = t.eliminatedPixels, d0 = t.completedBoxes;
    if (!Sim.applyPick(t, m.r, m.c)) continue;
    out.push({ r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0, delta: t.completedBoxes - d0 });
  }
  return out;
}

function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function round(x, n) { const p = Math.pow(10, n); return Math.round(x * p) / p; }

// —— free-first（原样搬运 PressureBuild_v5.freePath；额外记录终态进度/maxBuffer）——
function freePath(lv) {
  const s0 = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  let s = s0; const hs = [], bufs = [];
  let maxBuffer = s.buffer.length;
  for (let i = 0; i < 80 && !isWon(s); i++) {
    const opts = expand(s);
    if (!opts.length) return { won: false, H: 0, bufs, maxBuffer, progress: s.eliminatedPixels / s.totalPixels };
    let best = null, bestKey = null;
    for (const o of opts) {
      const t = o.t, bufAfter = t.buffer.length;
      const debtPx = t.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
      const nextM = isWon(t) ? 0 : legalN(t);
      const dead = t.overflow || bufAfter > t.bufferLimit || (bufAfter >= t.bufferLimit && o.delta === 0) || (!isWon(t) && nextM === 0);
      const key = [dead ? 0 : 1, bufAfter === 0 ? 1 : 0, o.gain, -bufAfter, -debtPx, -o.r, -o.c];
      if (!best || cmpArr(key, bestKey) > 0) { best = o; bestKey = key; }
    }
    hs.push(0); // H 不在本工具口径内，仅保持数组长度与压力步数一致
    bufs.push(s.buffer.length);
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
    const done0 = s.completedBoxes;
    s = best.t;
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
    if (isWon(s)) break;
    if (s.overflow || s.buffer.length > s.bufferLimit || (s.buffer.length >= s.bufferLimit && s.completedBoxes === done0) || legalN(s) === 0) {
      return { won: false, H: mean(hs), bufs, maxBuffer, progress: s.eliminatedPixels / s.totalPixels };
    }
  }
  return { won: isWon(s), H: mean(hs), bufs, maxBuffer, progress: s.eliminatedPixels / s.totalPixels };
}

// —— lure：原样搬运 PressureBuild_v5.playPath('lure') ——
function lurePath(lv) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const open = legalN(s);
  const bufs = [];
  let maxBuffer = s.buffer.length;
  while (!isWon(s)) {
    let pick = null;
    const opts = expand(s).filter(o => !isDead(o.t) || isWon(o.t));
    if (opts.length) { opts.sort((a, b) => (b.gain - a.gain) || (a.t.buffer.length - b.t.buffer.length)); pick = opts[0]; }
    if (!pick) return { won: false, steps: bufs.length, open, bufs, maxBuffer, progress: s.eliminatedPixels / s.totalPixels };
    bufs.push(s.buffer.length);
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
    s = pick.t;
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
  }
  return { won: true, steps: bufs.length, open, bufs, maxBuffer, progress: s.eliminatedPixels / s.totalPixels };
}

// ==================== 逐局 random（含 M/C/F/D 观测） ====================
// 观测不改变决策：先按 Sim.listMoves 的同一顺序展开全部合法选项，
// 但 random 玩家仍然**洗牌整张合法车列表**（与 PressureBuild 相同的随机数消耗），
// 再按洗牌顺序找第一个“当步不死”的选项。
function runRandom(lv, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const route = [];
  let maxBuffer = s.buffer.length;
  while (!isWon(s)) {
    const bufBefore = s.buffer.length;
    const progress = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);

    // 与 expand() 同序展开，记录每步选项计数（纯观测）
    const expanded = [];
    let C = 0, F = 0, D = 0;
    for (const m of ms) {
      const t = St.cloneState(s);
      const e0 = t.eliminatedPixels, d0 = t.completedBoxes;
      if (!Sim.applyPick(t, m.r, m.c)) { expanded.push(null); continue; }
      const o = { r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0, delta: t.completedBoxes - d0, bufAfter: t.buffer.length, alive: null };
      expanded.push(o);
      if (o.gain >= 1) C++;
      if (o.bufAfter <= bufBefore) F++;
    }
    const alive = (o) => {
      if (o.alive === null) o.alive = (!isDead(o.t) || isWon(o.t));
      return o.alive;
    };
    for (const o of expanded) {
      if (!o) continue;
      if (o.bufAfter > bufBefore && alive(o)) D++;
    }

    // 洗牌：与 PressureBuild 完全相同的 LCG 消耗（ms.length-1 次）
    const idx = ms.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }

    let pick = null;
    for (const k of idx) {
      const o = expanded[k];
      if (!o) continue;
      if (alive(o)) { pick = o; break; }
    }
    if (!pick) {
      if (bufBefore > maxBuffer) maxBuffer = bufBefore;
      return {
        won: false,
        steps: route.length,
        deathStep: route.length,
        deathProgress: round(progress, 6),
        maxBuffer,
        route
      };
    }
    route.push({
      step: route.length + 1,
      r: pick.r, c: pick.c,
      buffer: bufBefore,
      progress: round(progress, 6),
      gain: pick.gain,
      M: ms.length, C, F, D
    });
    s = pick.t;
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
  }
  return { won: true, steps: route.length, deathStep: null, deathProgress: null, maxBuffer, route };
}

// —— 与 PressureBuild_v5.evaluate 相同的 LCG ——
function lcg(seed) {
  let rs = seed;
  return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
}

function p3of(bufs) { return bufs.length ? bufs.filter(b => b >= 3).length / bufs.length : 0; }

// ==================== 主流程 ====================
function listLevels(input) {
  const st = fs.statSync(input);
  if (st.isDirectory()) {
    return fs.readdirSync(input).filter(f => f.toLowerCase().endsWith('.json'))
      .sort().map(f => path.join(input, f));
  }
  return [input];
}

function runLevel(file, outDir) {
  const game = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lv = A.parseLevel(A.fromGameFormat(game));
  fs.mkdirSync(outDir, { recursive: true });
  const levelName = path.basename(file);

  const seedRows = [];
  for (const seed of SEEDS) {
    const rnd = lcg(seed);
    const games = [];
    for (let i = 0; i < NRAND; i++) games.push(runRandom(lv, rnd));
    const wins = games.filter(g => g.won).length;
    const winRate = wins / NRAND;
    seedRows.push({ seed, games: NRAND, wins, winRate: round(winRate, 4) });
    fs.writeFileSync(path.join(outDir, `routes_seed${seed}.json`),
      JSON.stringify({ level: levelName, seed, player: 'random', games }));
  }

  const rates = seedRows.map(x => x.winRate);
  const randomWinRate = {
    mean: round(mean(rates), 4),
    min: round(Math.min(...rates), 4),
    max: round(Math.max(...rates), 4),
    range: round(Math.max(...rates) - Math.min(...rates), 4)
  };

  let skilled = null;
  if (DO_SKILLED) {
    const F = freePath(lv);
    skilled = { won: F.won, freeP3: round(p3of(F.bufs), 4), steps: F.bufs.length, deathProgress: F.won ? null : round(F.progress, 6), maxBuffer: F.maxBuffer };
  }
  let greedy = null;
  if (DO_GREEDY) {
    const L = lurePath(lv);
    greedy = { won: L.won, steps: L.steps, deathProgress: L.won ? null : round(L.progress, 6), maxBuffer: L.maxBuffer };
  }

  const summary = {
    level: levelName,
    random: NRAND,
    seeds: seedRows,
    randomWinRate,
    skilled,
    greedy
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  const parts = [`${levelName}  random[${seedRows.map(r => `${r.seed}=${r.winRate.toFixed(2)}`).join(' ')}] mean=${randomWinRate.mean.toFixed(3)} range=${randomWinRate.range.toFixed(3)}`];
  if (skilled) parts.push(`skilled(freeP3=${skilled.freeP3.toFixed(3)},${skilled.won ? 'won' : 'lost'})`);
  if (greedy) parts.push(`greedy(${greedy.won ? 'won' : 'lost'})`);
  console.log(parts.join('  '));
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
if (multi) {
  fs.writeFileSync(path.join(OUT, 'summary_all.json'), JSON.stringify(all, null, 2));
}
