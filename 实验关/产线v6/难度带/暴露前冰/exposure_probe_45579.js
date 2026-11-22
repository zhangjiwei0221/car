#!/usr/bin/env node
'use strict';
/**
 * exposure_probe —— 每格“暴露”（首次进入 Sim.listMoves 且非 blocked）时的累计取盒数探针
 * （暴露前冰实验，2026-11-20；pid 45579）
 *
 * 口径：corner、useSlotStart:true、instantChain:false、与 PInterpPlayer 同一 LCG。
 * 默认纯随机玩家（p=0，整张合法车列表洗牌取第一个不死）；每局独立种子 seed+i。
 * “累计取盒数”= 已取走的盒数（锁链一步扣组员数）。
 *
 * 每格输出（跨局）：
 *   exposureBallsMed  首次非 blocked 时的累计盒数（中位，仅暴露过的局）
 *   exposureStepMed   同上，步号
 *   exposureRate      20 局里暴露过的比例
 *   firstPickBallsMed 首次被拿时的累计盒数（中位）
 * 每行输出：行内各格 exposureBallsMed 的中位（以及全格×全局观测的中位）。
 *
 * 用法：
 *   node exposure_probe_<pid>.js <关卡.json> [--games 20] [--seed 977] [--p 0] [--out 结果.json]
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
  console.error('用法: node exposure_probe_<pid>.js <关卡.json> [--games 20] [--seed 977] [--p 0] [--out 结果.json]');
  process.exit(2);
}
const GAMES = Number(arg('--games', 20));
const SEED = Number(arg('--seed', 977));
const P = Number(arg('--p', 0));
const OUT = arg('--out', null);
const MAX_STEPS = 200;

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const lcg = (seed) => { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; };
const median = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

const game = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));
const ROWS = game.spools.length;
const COLS = game.spools[0].length;

function play(rnd) {
  const BOTTOM_ONLY = argv.includes('--bottom-only');
  const INSTANT_CHAIN = argv.includes('--instant-chain');
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: BOTTOM_ONLY, instantChain: INSTANT_CHAIN });
  const cellState = {};
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    cellState[r + ',' + c] = { exposed: false, exposureBalls: null, exposureStep: null, picked: false, pickBalls: null };
  }
  let steps = 0, balls = 0;
  while (steps < MAX_STEPS) {
    if (isWon(s)) break;
    const moves = Sim.listMoves(s);
    const seen = new Set();
    for (const m of moves) {
      const key = m.r + ',' + m.c;
      seen.add(key);
      const cs = cellState[key];
      if (cs && !cs.exposed && !m.blocked) {
        cs.exposed = true; cs.exposureBalls = balls; cs.exposureStep = steps + 1;
      }
    }
    const ms = moves.filter(m => !m.blocked);
    const alive = (t) => !isDead(t) || isWon(t);
    let pick = null;
    if (rnd() < P) {
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
    const key = pick.m.r + ',' + pick.m.c;
    const cs = cellState[key];
    if (cs && !cs.picked) { cs.picked = true; cs.pickBalls = balls; }
    const took = (pick.t.lastPick && pick.t.lastPick.boxes) || 1;
    s = pick.t;
    steps++; balls += took;
  }
  return { won: isWon(s), steps, balls, cellState };
}

const perGame = [];
for (let g = 0; g < GAMES; g++) {
  const rnd = lcg(SEED + g);
  perGame.push(play(rnd));
}

const cells = {}, rows = {};
for (let r = 0; r < ROWS; r++) {
  const rowCellMeds = [];
  const rowObs = [];
  for (let c = 0; c < COLS; c++) {
    const key = r + ',' + c;
    const arr = perGame.map(x => x.cellState[key]);
    const exp = arr.filter(x => x.exposed);
    const picked = arr.filter(x => x.picked);
    const med = median(exp.map(x => x.exposureBalls));
    cells[key] = {
      exposedRate: exp.length / GAMES,
      exposureBallsMed: med,
      exposureStepMed: median(exp.map(x => x.exposureStep)),
      exposureBallsList: exp.map(x => x.exposureBalls),
      firstPickBallsMed: median(picked.map(x => x.pickBalls)),
      pickedRate: picked.length / GAMES,
    };
    if (exp.length) {
      rowCellMeds.push(med);
      for (const x of exp) rowObs.push(x.exposureBalls);
    }
  }
  rows[r] = {
    cellsWithExposure: rowCellMeds.length,
    medianOfCellMeds: median(rowCellMeds),
    medianOfAllObs: median(rowObs),
    cellMeds: rowCellMeds,
  };
}

const out = {
  level: path.basename(FILE), games: GAMES, seed: SEED, p: P,
  wins: perGame.filter(x => x.won).length,
  meanSteps: mean(perGame.map(x => x.steps)),
  meanBalls: mean(perGame.map(x => x.balls)),
  rows, cells,
};
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
