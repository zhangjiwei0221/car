#!/usr/bin/env node
'use strict';
/**
 * first_pick_steps —— 记录每格“首次被拿”时的累计取盒数（步序号），用于配深行表演冰 param。
 * 口径与 PInterpPlayer 一致：corner（useSlotStart:true / instantChain:false），同 LCG。
 * 用法：node first_pick_steps.js <关卡.json> [--p 0,0.2] [--games 100] [--seed 977] [--rows 2]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../../');
const B = require(path.join(ROOT, '03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const FILE = argv[0];
const PS = String(arg('--p', '0,0.2')).split(',').map(Number);
const NGAMES = Number(arg('--games', 100));
const SEED = Number(arg('--seed', 977));
const MINROW = Number(arg('--rows', 2));

const lcg = (seed) => { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; };
const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const MAX_STEPS = 200;

function play(lv, p, rnd, first) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  let steps = 0;
  while (!isWon(s) && steps < MAX_STEPS) {
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    let pick = null;
    const useGreedy = p >= 1 || (p > 0 && rnd() < p);
    if (useGreedy) {
      const cand = [];
      for (const m of ms) {
        const t = St.cloneState(s), e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!isDead(t) || isWon(t)) cand.push({ r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0 });
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
        const m = ms[k], t = St.cloneState(s), e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!isDead(t) || isWon(t)) { pick = { r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0 }; break; }
      }
    }
    if (!pick) return;
    const key = pick.r + ',' + pick.c;
    if (!(key in first)) first[key] = steps; // 本步之前已取的盒数 = steps
    s = pick.t;
    steps++;
  }
}

const game = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));
const acc = {};
for (const p of PS) {
  const rnd = lcg(SEED);
  for (let i = 0; i < NGAMES; i++) {
    const first = {};
    play(lv, p, rnd, first);
    for (const k in first) (acc[k] = acc[k] || []).push(first[k]);
  }
}
const out = [];
for (const k in acc) {
  const [r] = k.split(',').map(Number);
  if (r < MINROW) continue;
  const a = acc[k].slice().sort((x, y) => x - y);
  const n = a.length;
  const med = n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  out.push({ cell: k, n, med, min: a[0], max: a[n - 1] });
}
out.sort((a, b) => a.med - b.med);
for (const x of out) console.log(x.cell, 'med=' + x.med, 'min=' + x.min, 'max=' + x.max, 'n=' + x.n);
