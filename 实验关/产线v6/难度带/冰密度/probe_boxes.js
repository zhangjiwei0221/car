#!/usr/bin/env node
'use strict';
/**
 * probe_boxes —— 首可点“取盒数”探针（冰密度实验，2026-11-19）
 *
 * 与 冰剂量/probe_wall_662.js 同口径（corner、useSlotStart:true、instantChain:false、
 * 同一 LCG、p-贪心同选步），区别：把“步数”换成**累计取盒数**（锁链一步扣 2 球 = 2 盒）。
 * 用途：S-前置 的 param 依据 = 该格首可点盒数 − 3。
 *
 * 每格记录（跨局取中位）：
 *   firstPickableStep / firstPickableBalls —— 首次可点时的步号与已累计取走的盒数；
 *   firstPickStep / firstPickBalls        —— 首次被拿时的步号与累计盒数；
 *   brokenBalls                           —— 冰碎时的累计盒数（仅有冰格）。
 * 无冰关卡也可用：只给格子报告 firstPickable*。
 *
 * 用法：
 *   node probe_boxes.js <关卡.json> --cells "r,c;..." [--p 0.1,0.2] [--games 100]
 *        [--seed 977] [--out 结果.json]
 */
const fs = require('fs');
const path = require('path');
const B = require(path.join(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const FILE = argv[0];
if (!FILE || FILE.startsWith('--')) {
  console.error('用法: node probe_boxes.js <关卡.json> --cells "r,c;..." [--p 0.1,0.2] [--games 100] [--seed 977] [--out 结果.json]');
  process.exit(2);
}
const CELLS = String(arg('--cells', '')).split(';').filter(Boolean).map(s => {
  const [r, c] = s.split(',').map(Number);
  return { r, c };
});
const PS = String(arg('--p', '0.1,0.2')).split(',').map(Number).filter(Number.isFinite);
const GAMES = Number(arg('--games', 100));
const SEED = Number(arg('--seed', 977));
const OUT = arg('--out', null);
const MAX_STEPS = 200;

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const lcg = (seed) => { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; };
const median = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

const game = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));

function frozen(s, r, c) {
  return !!(s.numice && s.numice[r + ',' + c] && s.numice[r + ',' + c].remaining > 0);
}
function pickableActual(s, map, r, c) {
  const m = map.get(r + ',' + c);
  return !!(m && !m.blocked);
}

function play(p, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const opening = Sim.listMoves(s).filter(m => !m.blocked).length;
  const cellState = {};
  for (const { r, c } of CELLS) cellState[r + ',' + c] = {
    wasIce: frozen(s, r, c), balls: 0,
    firstPickableStep: null, firstPickableBalls: null,
    firstPickStep: null, firstPickBalls: null, brokenBalls: null,
    wallSteps: 0
  };
  let steps = 0, balls = 0;
  const avail = [];
  while (steps < MAX_STEPS) {
    if (isWon(s)) break;
    const map = new Map(Sim.listMoves(s).map(m => [m.r + ',' + m.c, m]));
    avail.push([...map.values()].filter(m => !m.blocked).length);
    for (const { r, c } of CELLS) {
      const cs = cellState[r + ',' + c];
      if (cs.firstPickableStep == null && pickableActual(s, map, r, c)) {
        cs.firstPickableStep = steps + 1; cs.firstPickableBalls = balls;
      }
    }
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    const alive = (t) => !isDead(t) || isWon(t);
    let pick = null;
    if (rnd() < p) {
      const cand = [];
      for (const m of ms) {
        const t = St.cloneState(s), e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!alive(t)) continue;
        cand.push({ m, t, gain: t.eliminatedPixels - e0 });
      }
      if (cand.length) {
        let best = -Infinity;
        for (const o of cand) if (o.gain > best) best = o.gain;
        const tied = cand.filter(o => o.gain === best);
        pick = tied[Math.floor(rnd() * tied.length)];
      }
    } else {
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      for (const k of idx) {
        const m = ms[k], t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (alive(t)) { pick = { m, t }; break; }
      }
    }
    if (!pick) break;
    const took = (pick.t.lastPick && pick.t.lastPick.boxes) || 1;
    const pickedKey = pick.m.r + ',' + pick.m.c;
    const cs0 = cellState[pickedKey];
    if (cs0 && cs0.firstPickStep == null) { cs0.firstPickStep = steps + 1; cs0.firstPickBalls = balls; }
    s = pick.t;
    steps++; balls += took;
    for (const { r, c } of CELLS) {
      const cs = cellState[r + ',' + c];
      if (cs.wasIce && cs.brokenBalls == null && !frozen(s, r, c)) cs.brokenBalls = balls;
    }
  }
  return { won: isWon(s), steps, balls, opening, avail, cellState };
}

const results = {};
for (const p of PS) {
  const rnd = lcg(SEED);
  const perGame = [];
  for (let g = 0; g < GAMES; g++) perGame.push(play(p, rnd));
  const agg = {
    games: GAMES, wins: perGame.filter(x => x.won).length,
    opening: perGame[0].opening,
    meanAvailFirst10: mean(perGame.map(x => mean(x.avail.slice(0, 10)))),
    meanSteps: mean(perGame.map(x => x.steps)),
    meanBalls: mean(perGame.map(x => x.balls)),
    cells: {}
  };
  for (const { r, c } of CELLS) {
    const key = r + ',' + c;
    const arr = perGame.map(x => x.cellState[key]);
    const pickable = arr.filter(x => x.firstPickableBalls != null);
    const picked = arr.filter(x => x.firstPickBalls != null);
    agg.cells[key] = {
      wasIce: arr.filter(x => x.wasIce).length,
      firstPickableStepMed: median(pickable.map(x => x.firstPickableStep)),
      firstPickableBallsMed: median(pickable.map(x => x.firstPickableBalls)),
      firstPickableRate: pickable.length / GAMES,
      firstPickStepMed: median(picked.map(x => x.firstPickStep)),
      firstPickBallsMed: median(picked.map(x => x.firstPickBalls)),
      pickedRate: picked.length / GAMES,
      brokenBallsMed: median(arr.map(x => x.brokenBalls).filter(x => x != null)),
    };
  }
  results['p' + p] = agg;
}
const out = { level: path.basename(FILE), cells: CELLS, seed: SEED, results };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
