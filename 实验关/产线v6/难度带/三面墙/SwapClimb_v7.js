#!/usr/bin/env node
'use strict';
/**
 * SwapClimb_v7 —— 墙模式（bottomOnly+instantChain）专用的换位爬山（2026-11-22）
 *
 * 背景：PressureBuild_v5 的目标是四边模式的 freeP3，对墙模式不适用（实测五种子全 1.000）。
 * 本工具直接以“墙+瞬时”的随意档（p 0/0.1/0.2 × games）为适应度，随机交换两辆普通车，
 * 目标区间 [lo, hi]；超过 hi 就继续压，低于 lo 就回退。
 *
 * 用法：
 *   node SwapClimb_v7.js <底座.json> <输出.json> [--iters 40] [--games 60] [--seed 977]
 *        [--lo 0.58] [--hi 0.68] [--report 报告.json]
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const IN = argv[0], OUT = argv[1];
const ITERS = Number(arg('--iters', 40));
const GAMES = Number(arg('--games', 60));
const SEED = Number(arg('--seed', 977));
const LO = Number(arg('--lo', 0.58));
const HI = Number(arg('--hi', 0.68));
const REPORT = arg('--report', null);
if (!IN || !OUT) { console.error('用法: node SwapClimb_v7.js <底座.json> <输出.json> [--iters 40] [--games 60] [--seed 977] [--lo .58] [--hi .68]'); process.exit(2); }

const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
const lcg = (s) => { let x = s; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; };
const rnd = lcg(SEED);

function isPlainCar(x) { if (!x || !(x.id > 0) || !(x.count > 0)) return false; const t = Array.isArray(x.type) ? x.type : [x.type]; return t.every(v => v === 0); }

// 墙+瞬时的随意档：p 0/0.1/0.2 各 GAMES 局（与 PInterpPlayer 同源）
function evalWall(game) {
  let lv;
  try { lv = A.parseLevel(A.fromGameFormat(game)); } catch (e) { return null; }
  let wins = 0, total = 0, deaths = 0, early = 0;
  for (const p of [0, 0.1, 0.2]) {
    for (let g = 0; g < GAMES; g++) {
      const r = rndOnce(SEED + g * 7 + Math.round(p * 100));
      let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: true, instantChain: true });
      const isWon = (st) => st.eliminatedPixels >= st.totalPixels;
      const isDead = (st) => !!(st.overflow || st.buffer.length > st.bufferLimit || Sim.isDeadEnd(st));
      let ok = false; let deathProg = null;
      for (let step = 0; step < 200; step++) {
        if (isWon(s)) { ok = true; break; }
        const ms = Sim.listMoves(s).filter(m => !m.blocked);
        if (!ms.length) break;
        let pick = null;
        // 贪心端
        if (r() < p) {
          let bg = -1;
          for (const m of ms) {
            const t2 = A.SolverStrategy.cloneState(s);
            const e0 = t2.eliminatedPixels;
            if (!Sim.applyPick(t2, m.r, m.c)) continue;
            if (isDead(t2) && !isWon(t2)) continue;
            const g2 = t2.eliminatedPixels - e0;
            if (g2 > bg) { bg = g2; pick = t2; }
          }
        } else {
          const idx = ms.map((_, i) => i);
          for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
          for (const i of idx) {
            const m = ms[i], t2 = A.SolverStrategy.cloneState(s);
            if (!Sim.applyPick(t2, m.r, m.c)) continue;
            if (!isDead(t2) || isWon(t2)) { pick = t2; break; }
          }
        }
        if (!pick) break;
        s = pick;
      }
      total++; if (ok) wins++; else if (deathProg == null) deathProg = s.eliminatedPixels / s.totalPixels;
      if (!ok) { deaths++; if (s.eliminatedPixels / s.totalPixels < 0.1) early++; }
    }
  }
  const casual = wins / total;
  const earlyShare = deaths ? early / deaths : 0;
  return { casual, earlyShare };
}
const rndOnce = (seed) => { let x = seed; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; };

function clones(g) { return JSON.parse(JSON.stringify(g)); }
function score(ev) { if (!ev) return 1e9; return Math.abs(ev.casual - (LO + HI) / 2) + 0.6 * Math.max(0, ev.earlyShare - 0.15); }

let cur = clones(base);
let curEv = evalWall(cur);
let curScore = score(curEv);
let best = clones(cur), bestScore = curScore;
const log = [{ iter: 0, casual: +curEv.casual.toFixed(3), early: +curEv.earlyShare.toFixed(3), accepted: true }];
console.log('iter0 随意', curEv.casual.toFixed(3), '早死', curEv.earlyShare.toFixed(3));

for (let it = 1; it <= ITERS; it++) {
  if (curEv && curEv.casual <= HI && curEv.casual >= LO && curEv.earlyShare <= 0.15) break;
  const g = clones(cur);
  const cells = [];
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) if (isPlainCar(g.spools[r][c])) cells.push([r, c]);
  const a = cells[Math.floor(rnd() * cells.length)], b = cells[Math.floor(rnd() * cells.length)];
  if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
  const tmp = g.spools[a[0]][a[1]]; g.spools[a[0]][a[1]] = g.spools[b[0]][b[1]]; g.spools[b[0]][b[1]] = tmp;
  const ev = evalWall(g);
  if (!ev) { log.push({ iter: it, swap: [a, b], casual: null, accepted: false }); continue; }
  const vs = score(ev);
  const better = vs < curScore && ev.casual <= Math.max(curEv.casual, HI);
  log.push({ iter: it, swap: [a, b], casual: +ev.casual.toFixed(3), early: +ev.earlyShare.toFixed(3), accepted: better });
  console.log(`iter${it} 换 (${a})<->(${b}) 随意 ${ev.casual.toFixed(3)} 早死 ${ev.earlyShare.toFixed(3)} ${better ? '接受' : ''}`);
  if (better) { cur = g; curEv = ev; curScore = vs; if (vs < bestScore) { best = clones(g); bestScore = vs; } }
}
fs.writeFileSync(OUT, JSON.stringify(best, null, 1));
if (REPORT) fs.writeFileSync(REPORT, JSON.stringify({ base: IN, out: OUT, lo: LO, hi: HI, iters: ITERS, games: GAMES, final: curScore, log }, null, 1));
console.log('最终', JSON.stringify(curEv), '→', OUT);
