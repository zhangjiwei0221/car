#!/usr/bin/env node
'use strict';
/**
 * SwapClimb_v7 —— 墙模式（bottomOnly+instantChain）换位爬山 v2（2026-11-22）
 *
 * v2 目标函数（越小越好）：
 *   |随意 − mid| + 0.6*max(0, 早死share−0.15) + 0.5*max(0, 0.85−认真) + 0.02*倒序
 * 只跑 p ∈ {0,0.1,0.2,0.8,0.9,1}（各 games 局），比全 11 档便宜。
 * 早死 = 死亡时进度 <10%。
 *
 * 用法：
 *   node SwapClimb_v7.js <底座.json> <输出.json> [--iters 30] [--games 35] [--seed 977]
 *        [--lo 0.58] [--hi 0.68] [--report 报告.json]
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const IN = argv[0], OUT = argv[1];
const ITERS = Number(arg('--iters', 30));
const GAMES = Number(arg('--games', 35));
const SEED = Number(arg('--seed', 977));
const LO = Number(arg('--lo', 0.58));
const HI = Number(arg('--hi', 0.68));
const MID = (LO + HI) / 2;
const REPORT = arg('--report', null);
const EARLY_W = Number(arg('--early-w', 0.6));
if (!IN || !OUT) { console.error('用法: node SwapClimb_v7.js <底座.json> <输出.json> [--iters 30] [--games 35] [--seed 977] [--lo .58] [--hi .68]'); process.exit(2); }

const lcg = (s) => { let x = s; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; };
const rnd = lcg(SEED);
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
function isPlainCar(x) { if (!x || !(x.id > 0) || !(x.count > 0)) return false; const t = Array.isArray(x.type) ? x.type : [x.type]; return t.every(v => v === 0); }
const isWon = (st) => st.eliminatedPixels >= st.totalPixels;
const isDead = (st) => !!(st.overflow || st.buffer.length > st.bufferLimit || Sim.isDeadEnd(st));

function playOne(lv, p, r) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: true, instantChain: true });
  for (let step = 0; step < 200; step++) {
    if (isWon(s)) return { won: true, prog: 1 };
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    if (!ms.length) break;
    let pick = null;
    if (r() < p) {
      let bg = -1;
      for (const m of ms) {
        const t = St.cloneState(s), e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (isDead(t) && !isWon(t)) continue;
        const g = t.eliminatedPixels - e0;
        if (g > bg) { bg = g; pick = t; }
      }
    } else {
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      for (const i of idx) {
        const m = ms[i], t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!isDead(t) || isWon(t)) { pick = t; break; }
      }
    }
    if (!pick) break;
    s = pick;
  }
  return { won: isWon(s), prog: s.eliminatedPixels / s.totalPixels };
}

const PS = [0, 0.1, 0.2, 0.8, 0.9, 1];
function evalWall(game) {
  let lv;
  try { lv = A.parseLevel(A.fromGameFormat(game)); } catch (e) { return null; }
  const rates = {};
  let deaths = 0, early = 0;
  for (const p of PS) {
    const r = lcg(Math.round(SEED + p * 1000));
    let w = 0;
    for (let g = 0; g < GAMES; g++) {
      const res = playOne(lv, p, r);
      if (res.won) w++; else { deaths++; if (res.prog < 0.1) early++; }
    }
    rates[p] = w / GAMES;
  }
  const casual = (rates[0] + rates[0.1] + rates[0.2]) / 3;
  const fair = (rates[0.8] + rates[0.9] + rates[1]) / 3;
  const earlyShare = deaths ? early / deaths : 0;
  let inv = 0;
  for (let i = 1; i < PS.length; i++) if (rates[PS[i]] < rates[PS[i - 1]]) inv++;
  return { casual, fair, earlyShare, inv, rates };
}
function score(ev) {
  if (!ev) return 1e9;
  return Math.abs(ev.casual - MID)
    + EARLY_W * Math.max(0, ev.earlyShare - 0.15)
    + 0.5 * Math.max(0, 0.85 - ev.fair)
    + 0.02 * ev.inv;
}
const clones = (g) => JSON.parse(JSON.stringify(g));
const brief = (ev) => ev ? { casual: +ev.casual.toFixed(3), fair: +ev.fair.toFixed(3), early: +ev.earlyShare.toFixed(3), inv: ev.inv } : null;

let cur = clones(base);
let curEv = evalWall(cur), curScore = score(curEv);
let best = clones(cur), bestScore = curScore;
const log = [{ iter: 0, ...brief(curEv), accepted: true }];
console.log('iter0', JSON.stringify(brief(curEv)));

for (let it = 1; it <= ITERS; it++) {
  if (curEv && curEv.casual <= HI && curEv.casual >= LO && curEv.earlyShare <= 0.15 && curEv.fair >= 0.85 && curEv.inv <= 2) break;
  const g = clones(cur);
  const cells = [];
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) if (isPlainCar(g.spools[r][c])) cells.push([r, c]);
  const a = cells[Math.floor(rnd() * cells.length)], b = cells[Math.floor(rnd() * cells.length)];
  if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
  const tmp = g.spools[a[0]][a[1]]; g.spools[a[0]][a[1]] = g.spools[b[0]][b[1]]; g.spools[b[0]][b[1]] = tmp;
  const ev = evalWall(g);
  if (!ev) { log.push({ iter: it, swap: [a, b], accepted: false }); continue; }
  const vs = score(ev);
  const better = vs < curScore && ev.casual <= Math.max(curEv.casual, HI);
  log.push({ iter: it, swap: [a, b], ...brief(ev), accepted: better });
  console.log(`iter${it} (${a})<->(${b})`, JSON.stringify(brief(ev)), better ? '接受' : '');
  if (better) { cur = g; curEv = ev; curScore = vs; if (vs < bestScore) { best = clones(g); bestScore = vs; } }
}
fs.writeFileSync(OUT, JSON.stringify(best, null, 1));
if (REPORT) fs.writeFileSync(REPORT, JSON.stringify({ base: IN, out: OUT, lo: LO, hi: HI, iters: ITERS, games: GAMES, final: brief(curEv), log }, null, 1));
console.log('最终', JSON.stringify(brief(curEv)), '→', OUT);
