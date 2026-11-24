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
const B = require(path.resolve(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const IN = argv[0], OUT = argv[1];
const ITERS = Number(arg('--iters', 40));
const GAMES = Number(arg('--games', 12));
const SEED = Number(arg('--seed', 977));
const LO = Number(arg('--lo', 0.58));
const HI = Number(arg('--hi', 0.68));
const MID = (LO + HI) / 2;
const HUM_LO = Number(arg('--hum-lo', 0.32));
const HUM_HI = Number(arg('--hum-hi', 0.75));
const HUM_MID = (HUM_LO + HUM_HI) / 2;
const REPORT = arg('--report', null);
const EARLY_W = Number(arg('--early-w', 3.0));
const HUMAN_CASUAL = argv.includes('--human-casual');
if (!IN || !OUT) { console.error('用法: node SwapClimb_v7.js <底座.json> <输出.json> [--iters 30] [--games 35] [--seed 977] [--lo .58] [--hi .68]'); process.exit(2); }

const lcg = (s) => { let x = s; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; };
const rnd = lcg(SEED);
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
function isPlainCar(x) { if (!x || !(x.id > 0) || !(x.count > 0)) return false; const t = Array.isArray(x.type) ? x.type : [x.type]; return t.every(v => v === 0); }
const isWon = (st) => st.eliminatedPixels >= st.totalPixels;
const isDead = (st) => !!(st.overflow || st.buffer.length > st.bufferLimit || Sim.isDeadEnd(st));

function playOne(lv, p, r, isHum = HUMAN_CASUAL) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: true, instantChain: true });
  for (let step = 0; step < 80; step++) {
    if (isWon(s)) return { won: true, prog: 1 };
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    if (!ms.length) break;
    let pick = null;
    const useG = (p >= 1) || (p > 0 && r() < p);
    if (isHum) {
      const allMoves = [];
      for (const m of ms) {
        const t = St.cloneState(s), e0 = t.eliminatedPixels, c0 = t.completedBoxes;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        allMoves.push({
          t, alive: !isDead(t) || isWon(t),
          gain: t.eliminatedPixels - e0,
          bufAfter: t.buffer.length,
          cleared: t.completedBoxes > c0 ? 1 : 0
        });
      }
      const aliveList = allMoves.filter(o => o.alive);
      if (useG) {
        if (aliveList.length) {
          aliveList.sort((a, b) => (b.cleared - a.cleared) || (a.bufAfter - b.bufAfter) || (b.gain - a.gain));
          const top = aliveList[0];
          const tied = aliveList.filter(o => o.cleared === top.cleared && o.bufAfter === top.bufAfter && o.gain === top.gain);
          pick = tied[Math.floor(r() * tied.length)].t;
        }
      } else if (s.buffer.length <= 2) {
        const chunkVis = aliveList.filter(o => o.gain >= 6);
        const anyVis   = aliveList.filter(o => o.gain > 0);
        const pool = chunkVis.length ? chunkVis : (anyVis.length ? anyVis : aliveList);
        if (pool.length) pick = pool[Math.floor(r() * pool.length)].t;
      } else {
        const fatalVis = allMoves.filter(o => !o.alive && o.gain >= 8);
        const safeChunk = aliveList.filter(o => o.gain >= 6);
        const safeVis = safeChunk.length ? safeChunk : aliveList.filter(o => o.gain > 0);
        if (fatalVis.length > 0 && r() < 0.20) pick = null;
        else if (safeVis.length) pick = safeVis[Math.floor(r() * safeVis.length)].t;
        else if (aliveList.length) pick = aliveList[Math.floor(r() * aliveList.length)].t;
      }
    } else if (useG) {
      const cand = [];
      let bg = -Infinity;
      for (const m of ms) {
        const t = St.cloneState(s), e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (isDead(t) && !isWon(t)) continue;
        const g = t.eliminatedPixels - e0;
        if (g > bg) bg = g;
        cand.push({ t, g });
      }
      if (cand.length) {
        const tied = cand.filter(o => o.g === bg);
        pick = tied[Math.floor(r() * tied.length)].t;
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
function evalWall(game, nGames = GAMES) {
  let lv;
  try { lv = A.parseLevel(A.fromGameFormat(game)); } catch (e) { return null; }
  const rates = {};
  let deaths = 0, early = 0;
  for (const p of PS) {
    const r = lcg(SEED);
    let w = 0;
    for (let g = 0; g < nGames; g++) {
      const res = playOne(lv, p, r);
      if (res.won) w++; else { deaths++; if (res.prog < 0.1) early++; }
    }
    rates[p] = w / nGames;
  }
  const casual = (rates[0] + rates[0.1] + rates[0.2]) / 3;
  const fair = (rates[0.8] + rates[0.9] + rates[1]) / 3;
  const earlyShare = deaths ? early / deaths : 0;
  let inv = 0;
  for (let i = 1; i < PS.length; i++) if (rates[PS[i]] < rates[PS[i - 1]]) inv++;
  // 【2026-11-24 惰性双目标联合爬山】只在主尺 casual 接近目标带 [LO-0.12, HI+0.12] 且 fair>=0.85 时才测短视真人，兼顾速度与双尺命中！
  let humCasual = HUM_MID, humFair = 1.0;
  if (casual >= LO - 0.12 && casual <= HI + 0.12 && fair >= 0.85 && earlyShare <= 0.18) {
    const hGames = Math.min(nGames, 12);
    const rh = lcg(SEED), rhF = lcg(SEED);
    let hw = 0, hfw = 0;
    for (let g = 0; g < hGames; g++) {
      if (playOne(lv, 0.1, rh, true).won) hw++;
      if (playOne(lv, 0.9, rhF, true).won) hfw++;
    }
    humCasual = hw / hGames;
    humFair = hfw / hGames;
  }
  return { casual, fair, humCasual, humFair, earlyShare, inv, rates };
}
function score(ev) {
  if (!ev) return 1e9;
  const humOver = Math.max(0, (ev.humCasual || 0) - HUM_HI);
  const humUnder = Math.max(0, HUM_LO - (ev.humCasual || 0));
  // 带内 [HUM_LO, HUM_HI] 且 humFair>=0.88 时 humPen=0，避免与带外惰性未测步产生评分标尺跳变！
  const humPen = 0.85 * (humOver + humUnder) + 0.6 * Math.max(0, 0.88 - (ev.humFair ?? 1));
  return Math.abs(ev.casual - MID)
    + humPen
    + EARLY_W * Math.max(0, ev.earlyShare - 0.15)
    + 0.5 * Math.max(0, 0.85 - ev.fair)
    + 0.02 * ev.inv;
}
const clones = (g) => JSON.parse(JSON.stringify(g));
const brief = (ev) => ev ? { casual: +ev.casual.toFixed(3), fair: +ev.fair.toFixed(3), hum: +(ev.humCasual || 0).toFixed(3), hFair: +(ev.humFair ?? 1).toFixed(3), early: +ev.earlyShare.toFixed(3), inv: ev.inv } : null;

let cur = clones(base);
let curEv = evalWall(cur), curScore = score(curEv);
let best = clones(cur), bestScore = curScore;
const log = [{ iter: 0, ...brief(curEv), accepted: true }];
console.log('iter0', JSON.stringify(brief(curEv)));

// 预计算每个颜色在三面墙(自底 row=R-1 向上)下的平均深度 colorDepth[id]（越靠顶边值越大、越晚暴露）
const colorDepth = {};
{
  const Bmat = base.blocks, BR = Bmat.length, BC = Bmat[0].length;
  const sumD = {}, cntD = {};
  for (let r = 0; r < BR; r++) for (let c = 0; c < BC; c++) {
    const v = Bmat[r][c]; if (v <= 0) continue;
    sumD[v] = (sumD[v] || 0) + (BR - 1 - r);
    cntD[v] = (cntD[v] || 0) + 1;
  }
  for (const k of Object.keys(cntD)) colorDepth[k] = sumD[k] / cntD[k];
}

for (let it = 1; it <= ITERS; it++) {
  if (curEv && curEv.casual <= HI && curEv.casual >= LO && curEv.humCasual <= HUM_HI && curEv.humCasual >= HUM_LO && curEv.earlyShare <= 0.15 && curEv.fair >= 0.85 && (curEv.humFair ?? 1) >= 0.85 && curEv.inv <= 2) {
    const fullEv = evalWall(cur, 40);
    if (fullEv && fullEv.casual <= HI + 0.01 && fullEv.casual >= LO - 0.01 && fullEv.humCasual <= HUM_HI + 0.02 && fullEv.humCasual >= HUM_LO - 0.02 && fullEv.fair >= 0.85 && (fullEv.humFair ?? 1) >= 0.85 && fullEv.earlyShare <= 0.18) {
      curEv = fullEv; best = clones(cur); break;
    }
    curEv = fullEv || curEv; curScore = score(curEv);
  }
  const g = clones(cur);
  // 【2026-11-23 定向供需错位换位】
  // 当 casual > HI（太易需加压）：只从 front(row 0..2) 选浅层/小车，与 deep(row 3..6) 中更深层或更大容量的车对调，拒绝无效反向换位！
  const R = g.spools.length;
  const CLIMAX_SET = new Set(['5,2', '5,4', '6,2', '6,4']);
  const front = [], deep = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < g.spools[r].length; c++) {
    if (!isPlainCar(g.spools[r][c]) || CLIMAX_SET.has(`${r},${c}`)) continue;
    if (r <= 2) front.push([r, c]);
    if (r >= 3) deep.push([r, c]);
  }
  if (!front.length || !deep.length) continue;
  const needHarder = !curEv || (curEv.casual > HI) || (curEv.casual >= LO && curEv.humCasual > HUM_HI);
  let a = null, b = null;
  for (let tryPair = 0; tryPair < 25; tryPair++) {
    const ca = front[Math.floor(rnd() * front.length)];
    const cb = deep[Math.floor(rnd() * deep.length)];
    const cellA = g.spools[ca[0]][ca[1]], cellB = g.spools[cb[0]][cb[1]];
    if (cellA.id === cellB.id) continue;
    const dA = colorDepth[cellA.id] || 0, dB = colorDepth[cellB.id] || 0;
    // 三面墙下 row 0 是唯一底边入口，严禁把过于靠顶边(dB > 18)的深层死车塞进 row 0 导致 early>0.70 开局锁死！
    if (ca[0] === 0 && needHarder && dB > 18) continue;
    if (needHarder && (dB > dA + 1.0 || (dB >= dA - 1.0 && cellB.count > cellA.count))) { a = ca; b = cb; break; }
    if (!needHarder && (dA > dB + 1.0 || cellA.count > cellB.count)) { a = ca; b = cb; break; }
  }
  if (!a || !b) {
    a = front[Math.floor(rnd() * front.length)];
    b = deep[Math.floor(rnd() * deep.length)];
    if (!a || !b || g.spools[a[0]][a[1]].id === g.spools[b[0]][b[1]].id) continue;
  }
  const tmp = g.spools[a[0]][a[1]]; g.spools[a[0]][a[1]] = g.spools[b[0]][b[1]]; g.spools[b[0]][b[1]] = tmp;
  const ev = evalWall(g);
  if (!ev) { log.push({ iter: it, swap: [a, b], accepted: false }); continue; }
  const vs = score(ev);
  const fairOk = (ev.fair >= 0.88 || ev.fair >= curEv.fair) && ((ev.humFair ?? 1) >= 0.88 || (ev.humFair ?? 1) >= (curEv.humFair ?? 0));
  const earlyOk = ev.earlyShare <= 0.15 || ev.earlyShare <= curEv.earlyShare;
  const casBoundOk = ev.casual <= Math.max(curEv.casual, HI) && ev.casual >= Math.min(curEv.casual, LO);
  const humBoundOk = ev.humCasual <= Math.max(curEv.humCasual, HUM_HI) && ev.humCasual >= Math.min(curEv.humCasual, HUM_LO);
  const better = fairOk && earlyOk && casBoundOk && humBoundOk && vs < curScore;
  log.push({ iter: it, swap: [a, b], ...brief(ev), accepted: better });
  console.log(`iter${it} (${a})<->(${b})`, JSON.stringify(brief(ev)), better ? '接受' : '');
  if (better) { cur = g; curEv = ev; curScore = vs; if (vs < bestScore) { best = clones(g); bestScore = vs; } }
}
fs.writeFileSync(OUT, JSON.stringify(best, null, 1));
if (REPORT) fs.writeFileSync(REPORT, JSON.stringify({ base: IN, out: OUT, lo: LO, hi: HI, iters: ITERS, games: GAMES, final: brief(curEv), log }, null, 1));
console.log('最终', JSON.stringify(brief(curEv)), '→', OUT);
