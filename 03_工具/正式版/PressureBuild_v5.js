#!/usr/bin/env node
'use strict';
/**
 * PressureBuild_v5 —— 产线 v5-1：在“安全版”上换位加压（2026-11-11，实验）
 *
 * 思路（日志 §1094/§1095）：
 *   安全版已经“每步有选择”（选择熵高），缺的是压力。
 *   压力来自“能点的车大多暂时吃不满”；容错来自“没有致命/诱饵陷阱”。
 *   只做一件事：交换两辆普通车的位置（容量/颜色/障碍不动，守恒自动成立），爬山。
 *
 * 快速评估（每个候选 ~1s）：
 *   玩家群体   1 条 lure（每步点最诱人的）+ NRAND 条随机玩家（只避开当步就死的）
 *               → win = 随机玩家通关率（容错；分组2 L2–L13 vs 线上失败率 ρ=−0.69）
 *   free 路线压力 freeP3 = 会玩的人（free-first）也得背 ≥3 债的步数占比（压力目标）
 *   free 路线   ChoiceSpace 同口径的 free-first 路线 → 选择熵 H（同 ChoiceSpaceCheck_v1 的签名）
 *   开局可点数
 * 目标：freeP3 接近 --p3（默认 0.40），约束 win ≥ --wmin（默认 0.9）、lure 走通、H ≥ --hmin（默认 1.45）、开局 ≥5。
 * 最终候选必须再跑 FatalOptionCheck_v0 / ChoiceSpaceCheck_v1 / ArlCheck_v793 复核。
 *
 * 用法：
 *   node PressureBuild_v5.js <安全版.json> --out <目录> [--iters 300] [--seed 1] [--p3 0.40] [--hmin 1.45]
 *   node PressureBuild_v5.js <关卡.json> --eval-only
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('用法: node PressureBuild_v5.js <关卡.json> --out <目录> [--iters 300] [--seed 1] [--p3 0.40] [--hmin 1.45] | --eval-only'); process.exit(2); }
const ITERS = Number(arg('--iters', 300));
const SEED = Number(arg('--seed', 1));
const P3T = Number(arg('--p3', 0.40));
const HMIN = Number(arg('--hmin', 1.45));
const OUT = arg('--out', '');

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));

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

// —— ChoiceSpace 同口径的签名/熵 ——
function bucket(x) { if (x <= 0) return 0; if (x <= 2) return 1; if (x <= 5) return 2; if (x <= 10) return 3; if (x <= 20) return 4; return 5; }
function entropy(keys) { const c = {}; for (const k of keys) c[k] = (c[k] || 0) + 1; let h = 0; for (const k in c) { const p = c[k] / keys.length; h -= p * Math.log(p); } return h; }
const legalN = (s) => Sim.listMoves(s).filter(m => !m.blocked).length;

function freePath(lv) {
  const s0 = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  let s = s0; const hs = [], bufs = [];
  for (let i = 0; i < 80 && !isWon(s); i++) {
    const opts = expand(s);
    if (!opts.length) return { won: false, H: 0, bufs };
    const sigs = [];
    let best = null, bestKey = null;
    for (const o of opts) {
      const t = o.t, bufAfter = t.buffer.length;
      const debtPx = t.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
      const nextM = isWon(t) ? 0 : legalN(t);
      const dead = t.overflow || bufAfter > t.bufferLimit || (bufAfter >= t.bufferLimit && o.delta === 0) || (!isWon(t) && nextM === 0);
      sigs.push([dead ? 1 : 0, Math.min(bufAfter, 6), bucket(debtPx), bucket(o.gain), Math.min(nextM, 10), o.delta].join('|'));
      const key = [dead ? 0 : 1, bufAfter === 0 ? 1 : 0, o.gain, -bufAfter, -debtPx, -o.r, -o.c];
      if (!best || cmpArr(key, bestKey) > 0) { best = o; bestKey = key; }
    }
    hs.push(entropy(sigs)); bufs.push(s.buffer.length);
    const done0 = s.completedBoxes;
    s = best.t;
    if (isWon(s)) break;
    if (s.overflow || s.buffer.length > s.bufferLimit || (s.buffer.length >= s.bufferLimit && s.completedBoxes === done0) || legalN(s) === 0) return { won: false, H: mean(hs), bufs };
  }
  return { won: isWon(s), H: mean(hs), bufs };
}
function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

// 玩家群体：style='lure' 每步点最诱人的（吃得最多）；style='rand' 在“当步不死”的选项里随机点
//   （用户真人路径 ZC_18_safe：常点第 3–11 诱人的车、长期背 2–3 个债 → 不是贪心，更像随机里避开明死）
function playPath(lv, style, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const open = legalN(s);
  const bufs = [];
  while (!isWon(s)) {
    let pick = null;
    if (style === 'lure') {
      const opts = expand(s).filter(o => !isDead(o.t) || isWon(o.t));
      if (opts.length) { opts.sort((a, b) => (b.gain - a.gain) || (a.t.buffer.length - b.t.buffer.length)); pick = opts[0]; }
    } else {
      // 随机打乱后逐个试，第一个“当步不死”的就点（与“在不死选项里均匀随机”同分布，但只试 1–2 个）
      const ms = Sim.listMoves(s).filter(m => !m.blocked);
      for (let i = ms.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = ms[i]; ms[i] = ms[j]; ms[j] = x; }
      for (const m of ms) {
        const t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!isDead(t) || isWon(t)) { pick = { t }; break; }
      }
    }
    if (!pick) return { won: false, steps: bufs.length, open, bufs };
    bufs.push(s.buffer.length);
    s = pick.t;
  }
  return { won: true, steps: bufs.length, open, bufs };
}
const NRAND = Number(arg('--nrand', 12));
const WMIN = Number(arg('--wmin', 0.9));
const PSEED = Number(arg('--pseed', 977));

function evaluate(game) {
  const lv = A.parseLevel(A.fromGameFormat(game));
  const L = playPath(lv, 'lure');
  let rs = PSEED; const r2 = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  const rand = [];
  for (let i = 0; i < NRAND; i++) rand.push(playPath(lv, 'rand', r2));
  const F = freePath(lv);
  const win = rand.filter(x => x.won).length / (rand.length || 1);
  const p3of = (x) => x.bufs.length ? x.bufs.filter(b => b >= 3).length / x.bufs.length : 0;
  const wonRuns = rand.filter(x => x.won);
  const p3 = mean((wonRuns.length ? wonRuns : rand).map(p3of));
  const peak = Math.max(...[L, ...rand].map(x => x.bufs.length ? Math.max(...x.bufs) : 0));
  let maxRun = 0; for (const x of wonRuns) { let run = 0; for (const b of x.bufs) { run = b >= 3 ? run + 1 : 0; maxRun = Math.max(maxRun, run); } }
  // 压力看“会玩的人”（free-first 路线）：玩得好也得背 ≥3 个债的步数占比；容错看随机玩家通关率
  const freeP3 = p3of(F);
  const ok = L.won && F.won && L.open >= 5 && F.H >= HMIN && win >= WMIN;
  const score = (ok ? 0 : -5) - Math.abs(freeP3 - P3T) * 10 - Math.max(0, WMIN - win) * 20 + Math.min(F.H, 1.8) * 0.5;
  return { ok, score: +score.toFixed(3), freeP3: +freeP3.toFixed(3), lureWon: L.won, lureP3: +p3of(L).toFixed(3), freeWon: F.won, steps: L.steps, open: L.open, win: +win.toFixed(3), p3: +p3.toFixed(3), peak, maxRun3: maxRun, H: +F.H.toFixed(3) };
}

// —— 可交换的格子：普通车 / 冰车 / 问号车；不碰锁链、管道、黑块、空格 ——
function swappable(cell) {
  if (!cell || !cell.count) return false;
  const ts = Array.isArray(cell.type) ? cell.type : [cell.type];
  if (ts.includes(5)) return false;            // 锁链：保持正交相邻
  if (ts.some(t => t >= 11 && t <= 14)) return false;  // 管道
  return true;
}

const game0 = JSON.parse(fs.readFileSync(file, 'utf8'));
const base = evaluate(game0);
if (has('--eval-only')) { console.log(JSON.stringify({ level: path.basename(file), ...base })); process.exit(0); }
if (!OUT) { console.error('需要 --out <目录>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

let seed = SEED >>> 0 || 1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const cells = [];
game0.spools.forEach((row, r) => row.forEach((c, k) => { if (swappable(c)) cells.push([r, k]); }));

let cur = JSON.parse(JSON.stringify(game0)), curE = base;
let best = cur, bestE = base;
const log = [{ iter: 0, ...base }];
console.log('base', JSON.stringify(base), 'swappable', cells.length);
for (let it = 1; it <= ITERS; it++) {
  const a = cells[Math.floor(rnd() * cells.length)], b = cells[Math.floor(rnd() * cells.length)];
  if (a === b) continue;
  const ca = cur.spools[a[0]][a[1]], cb = cur.spools[b[0]][b[1]];
  if (ca.id === cb.id && ca.count === cb.count) continue;
  const cand = JSON.parse(JSON.stringify(cur));
  cand.spools[a[0]][a[1]] = JSON.parse(JSON.stringify(cb));
  cand.spools[b[0]][b[1]] = JSON.parse(JSON.stringify(ca));
  const e = evaluate(cand);
  // 爬山 + 少量接受变差（退火），温度随迭代降低
  const T = 0.3 * (1 - it / ITERS) + 0.01;
  if (e.score >= curE.score || rnd() < Math.exp((e.score - curE.score) / T)) {
    cur = cand; curE = e;
    if (e.score > bestE.score) { best = cand; bestE = e; log.push({ iter: it, swap: [a, b], ...e }); console.log('it', it, JSON.stringify(e)); }
  }
}
const stem = path.basename(file).replace(/\.json$/, '');
const outLevel = path.join(OUT, `${stem}_v5p_s${SEED}.json`);
fs.writeFileSync(outLevel, JSON.stringify(best));
fs.writeFileSync(path.join(OUT, `${stem}_v5p_s${SEED}.log.json`), JSON.stringify({ base, best: bestE, args: { ITERS, SEED, P3T, HMIN }, log }, null, 2));
console.log('best', JSON.stringify(bestE), '→', outLevel);
