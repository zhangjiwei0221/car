#!/usr/bin/env node
'use strict';
/**
 * probe_wall_662 —— 冰“墙效应”探针（冰剂量实验，2026-11-19）
 *
 * 口径与 PInterpPlayer / BaitLocator 一致：corner、useSlotStart:true、instantChain:false、
 * 同一 LCG（p 决定走贪心还是随机，随机端洗牌取第一个不死）。
 *
 * 每一步记录：
 *   - 当前可点（listMoves !blocked）数量（开前 / 前 10 步均值 / 全程均值）；
 *   - 每个目标格：实际是否可点；若被冰冻住，反事实解锁后是否可点（= 被冰墙掉的选项）；
 *   - 首次可点步（1-based 点击序号）、首次被拿步、冰破碎步。
 * 破碎阈值：数字冰按“本步取走的盒数”倒计时（普通步 -1，锁链步 -组员数）——直接读 state.numice.remaining。
 *
 * 用法：
 *   node probe_wall_662.js <关卡.json> --cells "r,c;r,c;..." [--p 0.1,0.2] [--games 100]
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
  console.error('用法: node probe_wall_662.js <关卡.json> --cells "r,c;..." [--p 0.1,0.2] [--games 100] [--seed 977] [--out 结果.json]');
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

// 反事实：临时移除目标格的 numice，算“若冰不存在时它是否可点/非阻塞”
function counterfactualPickable(s, r, c) {
  const key = r + ',' + c;
  const it = s.numice && s.numice[key];
  if (!it) return null;
  const saved = s.numice[key];
  delete s.numice[key];
  let pickable = false, nonblocked = false;
  try {
    if (Sim.isPickable(s, r, c)) {
      pickable = true;
      const mv = Sim.listMoves(s).filter(m => m.r === r && m.c === c);
      nonblocked = mv.length > 0 && !mv[0].blocked;
    }
  } finally {
    s.numice[key] = saved;
  }
  return { pickable, nonblocked };
}

function play(p, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const opening = Sim.listMoves(s).filter(m => !m.blocked).length;
  const cellState = {};
  for (const { r, c } of CELLS) cellState[r + ',' + c] = {
    wasIce: frozen(s, r, c),
    firstPickable: null, firstPick: null, broken: null,
    wallSteps: 0, lostOptionsSum: 0
  };
  let steps = 0;
  const avail = [];
  while (steps < MAX_STEPS) {
    if (isWon(s)) break;
    const map = new Map(Sim.listMoves(s).map(m => [m.r + ',' + m.c, m]));
    const actualAvail = [...map.values()].filter(m => !m.blocked).length;
    avail.push(actualAvail);
    // 反事实：把所有“冰着且本可点”的目标格也解锁，看看总选项能多几个
    const frozenTargets = CELLS.filter(({ r, c }) => frozen(s, r, c));
    let cfAvail = actualAvail;
    if (frozenTargets.length) {
      const saved = {};
      let removed = 0;
      for (const { r, c } of frozenTargets) {
        const key = r + ',' + c;
        saved[key] = s.numice[key]; delete s.numice[key]; removed++;
      }
      cfAvail = Sim.listMoves(s).filter(m => !m.blocked).length;
      const unlocks = {};
      for (const { r, c } of frozenTargets) {
        const key = r + ',' + c;
        unlocks[key] = Sim.isPickable(s, r, c);
      }
      for (const key in saved) s.numice[key] = saved[key];
      if (removed) {
        for (const { r, c } of CELLS) {
          const key = r + ',' + c, cs = cellState[key];
          if (frozen(s, r, c) && unlocks[key]) cs.wallSteps++;
        }
        const lost = cfAvail - actualAvail;
        if (lost > 0) for (const { r, c } of CELLS) if (frozen(s, r, c)) cellState[r + ',' + c].lostOptionsSum += lost / frozenTargets.length;
      }
    }
    for (const { r, c } of CELLS) {
      const key = r + ',' + c, cs = cellState[key];
      if (cs.firstPickable == null && pickableActual(s, map, r, c)) cs.firstPickable = steps + 1;
    }
    // 选步（与 BaitLocator / PInterp 同口径）
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
    const pickedKey = pick.m.r + ',' + pick.m.c;
    if (cellState[pickedKey] && cellState[pickedKey].firstPick == null) cellState[pickedKey].firstPick = steps + 1;
    s = pick.t;
    steps++;
    for (const { r, c } of CELLS) {
      const key = r + ',' + c, cs = cellState[key];
      if (cs.wasIce && cs.broken == null && !frozen(s, r, c)) cs.broken = steps;
    }
  }
  const won = isWon(s);
  return { won, steps, opening, avail, cellState };
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
    meanAvailAll: mean(perGame.map(x => mean(x.avail))),
    meanSteps: mean(perGame.map(x => x.steps)),
    cells: {}
  };
  for (const { r, c } of CELLS) {
    const key = r + ',' + c;
    const arr = perGame.map(x => x.cellState[key]);
    const withPick = arr.filter(x => x.firstPick != null);
    agg.cells[key] = {
      wasIce: arr.filter(x => x.wasIce).length,
      firstPickableMed: median(arr.map(x => x.firstPickable).filter(x => x != null)),
      firstPickableRate: arr.filter(x => x.firstPickable != null).length / GAMES,
      firstPickMed: median(withPick.map(x => x.firstPick)),
      pickedRate: withPick.length / GAMES,
      brokenMed: median(arr.map(x => x.broken).filter(x => x != null)),
      wallStepsMean: mean(arr.map(x => x.wallSteps)),
      lostOptionsMean: mean(arr.map(x => x.lostOptionsSum))
    };
  }
  results['p' + p] = agg;
}
const out = { level: path.basename(FILE), cells: CELLS, seed: SEED, results };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
