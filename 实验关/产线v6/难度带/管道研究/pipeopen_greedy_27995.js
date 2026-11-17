#!/usr/bin/env node
'use strict';
// 纯贪心（p=1，逐位复刻 PInterpPlayer 贪心端）下管道是否开管 / 死亡点；pid 27995
// 用法: node pipeopen_greedy_27995.js <关卡.json> [--games 100 --seed 977]
const path = require('path');
const fs = require('fs');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2], GAMES = Number(arg('--games', 100)), SEED = Number(arg('--seed', 977));
const isWon = s => s.eliminatedPixels >= s.totalPixels;
const isDead = s => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
const g = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));
const pipes = [];
for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[0].length; c++) {
  const s = g.spools[r][c], t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
  if (t.some(x => x >= 11 && x <= 14)) pipes.push([r, c]);
}
const initNext = {}; { const s0 = Sim.createState(lv, { useSlotStart: true, instantChain: false }); for (const [r, c] of pipes) initNext[r + ',' + c] = s0.cells[r][c].next || 0; }
const rnd = lcg(SEED);
const rows = [];
for (let gi = 0; gi < GAMES; gi++) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  let steps = 0, openStep = null;
  while (!isWon(s) && steps < 200) {
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    const cand = [];
    for (const m of ms) { const t = St.cloneState(s); const e0 = t.eliminatedPixels; if (!Sim.applyPick(t, m.r, m.c)) continue; if (isDead(t) && !isWon(t)) continue; cand.push({ t, gain: t.eliminatedPixels - e0 }); }
    if (!cand.length) break;
    const best = Math.max(...cand.map(o => o.gain));
    const tied = cand.filter(o => o.gain === best);
    s = tied[Math.floor(rnd() * tied.length)].t; steps++;
    if (openStep === null && pipes.some(([r, c]) => (s.cells[r][c].next || 0) > (initNext[r + ',' + c] || 0))) openStep = steps;
  }
  rows.push({ won: isWon(s), steps, deathProgress: isWon(s) ? null : +(s.eliminatedPixels / s.totalPixels).toFixed(3), opened: openStep !== null, openStep });
}
const losses = rows.filter(x => !x.won);
console.log(JSON.stringify({ file: path.basename(path.dirname(path.resolve(FILE))), games: GAMES, win: rows.filter(x => x.won).length / GAMES, losses: losses.length, lossesNeverOpened: losses.filter(x => !x.opened).length, lossProgress: losses.map(x => x.deathProgress), lossesOpenStep: losses.map(x => x.openStep) }));
