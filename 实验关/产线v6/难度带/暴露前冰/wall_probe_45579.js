#!/usr/bin/env node
'use strict';
/**
 * wall_probe —— 暴露前冰：墙是否落在“可用窗口”内（pid 45579，2026-11-20）
 *
 * 对每个目标格，每步：
 *   actual      = 该格在 Sim.listMoves 中且非 blocked（真可用）
 *   frozen      = 该格数字冰未碎
 *   cfPickable  = 临时移除该格 numice 后，该格在 listMoves 中且非 blocked
 *   墙 = frozen && cfPickable：冰挡住了“本来可点”的选项 → 墙在可用窗口内
 *
 * 每格输出（跨局）：
 *   exposureBallsMed   首次 actual 的累计盒数
 *   brokenBallsMed     冰碎时的累计盒数
 *   firstWallBallsMed  首次“墙”时的累计盒数（仅发生墙的局）
 *   wallGames          发生墙的局数 / 总局数
 *   wallStepsMean      平均墙步数/局
 *   maxWallRunMed      单局最长连续墙步的中位（有墙的局）
 *
 * 用法：
 *   node wall_probe_45579.js <关卡.json> --cells "r,c;..." [--p 0.1,0.2]
 *        [--games 100] [--seed 977] [--out 结果.json]
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
  console.error('用法: node wall_probe_45579.js <关卡.json> --cells "r,c;..." [--p 0.1,0.2] [--games 100] [--seed 977] [--out 结果.json]');
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

function play(p, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const cs = {};
  for (const { r, c } of CELLS) cs[r + ',' + c] = {
    exposureBalls: null, exposureStep: null, brokenBalls: null, brokenStep: null,
    firstWallBalls: null, wallSteps: 0, run: 0, maxRun: 0,
  };
  let steps = 0, balls = 0;
  const alive = (t) => !isDead(t) || isWon(t);
  while (steps < MAX_STEPS) {
    if (isWon(s)) break;
    const moves = Sim.listMoves(s).filter(m => !m.blocked);
    const map = new Map(moves.map(m => [m.r + ',' + m.c, m]));
    // 反事实：一次性移除所有“冰着且当前不可用”的目标格 numice，只算一次 listMoves
    const frozenNonAct = CELLS.filter(({ r, c }) => frozen(s, r, c) && !map.has(r + ',' + c));
    let cfMap = null;
    if (frozenNonAct.length) {
      const saved = {};
      for (const { r, c } of frozenNonAct) { const key = r + ',' + c; saved[key] = s.numice[key]; delete s.numice[key]; }
      cfMap = new Map(Sim.listMoves(s).filter(m => !m.blocked).map(m => [m.r + ',' + m.c, m]));
      for (const key in saved) s.numice[key] = saved[key];
    }
    for (const { r, c } of CELLS) {
      const key = r + ',' + c, o = cs[key];
      const act = map.has(key);
      if (o.exposureBalls == null && act) { o.exposureBalls = balls; o.exposureStep = steps + 1; }
      const fr = frozen(s, r, c);
      if (fr && !act) {
        // 反事实：若是冰挡住的，则算墙
        if (cfMap && cfMap.has(key)) {
          if (o.firstWallBalls == null) o.firstWallBalls = balls;
          o.wallSteps++; o.run++; o.maxRun = Math.max(o.maxRun, o.run);
        } else { o.run = 0; }
      } else { o.run = 0; }
    }
    let pick = null;
    if (rnd() < p) {
      const cand = [];
      for (const m of moves) {
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
      const idx = moves.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      for (const k of idx) {
        const m = moves[k], t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (alive(t)) { pick = { m, t }; break; }
      }
    }
    if (!pick) break;
    const took = (pick.t.lastPick && pick.t.lastPick.boxes) || 1;
    s = pick.t;
    steps++; balls += took;
    for (const { r, c } of CELLS) {
      const key = r + ',' + c, o = cs[key];
      if (o.brokenBalls == null && !frozen(s, r, c)) { o.brokenBalls = balls; o.brokenStep = steps; }
    }
  }
  return { won: isWon(s), steps, balls, cs };
}

const results = {};
for (const p of PS) {
  const rnd = lcg(SEED);
  const perGame = [];
  for (let g = 0; g < GAMES; g++) perGame.push(play(p, rnd));
  const agg = { games: GAMES, wins: perGame.filter(x => x.won).length, cells: {} };
  for (const { r, c } of CELLS) {
    const key = r + ',' + c;
    const arr = perGame.map(x => x.cs[key]);
    const walled = arr.filter(x => x.wallSteps > 0);
    agg.cells[key] = {
      exposureBallsMed: median(arr.map(x => x.exposureBalls).filter(x => x != null)),
      exposureRate: arr.filter(x => x.exposureBalls != null).length / GAMES,
      brokenBallsMed: median(arr.map(x => x.brokenBalls).filter(x => x != null)),
      firstWallBallsMed: median(walled.map(x => x.firstWallBalls)),
      wallGames: walled.length,
      wallStepsMean: mean(arr.map(x => x.wallSteps)),
      maxWallRunMed: median(walled.map(x => x.maxRun)),
      wallStepsMax: Math.max(0, ...arr.map(x => x.wallSteps)),
    };
  }
  results['p' + p] = agg;
}
const out = { level: path.basename(FILE), cells: CELLS, seed: SEED, results };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
