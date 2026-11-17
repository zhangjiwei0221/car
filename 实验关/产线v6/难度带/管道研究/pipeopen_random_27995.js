#!/usr/bin/env node
'use strict';
/**
 * pipeopen_random_27995.js —— 纯随机玩家（p=0，逐位复刻 PInterpPlayer）下管道的开管时机
 *
 * 输出每关：openRate（100 局里开了几次）、openStep 中位、openProgress 中位、neverOpen 数。
 * 用法: node pipeopen_random_27995.js <关卡.json> [--games 100 --seed 977]
 * 只读。pid 27995。
 */
const path = require('path');
const fs = require('fs');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const GAMES = Number(arg('--games', 100)), SEED = Number(arg('--seed', 977));
const isWon = s => s.eliminatedPixels >= s.totalPixels;
const isDead = s => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
const game = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));
const pipes = [];
for (let r = 0; r < game.spools.length; r++) for (let c = 0; c < game.spools[0].length; c++) {
  const s = game.spools[r][c]; const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
  if (t.some(x => x >= 11 && x <= 14)) pipes.push([r, c]);
}
const initNext = {};
{ const s0 = Sim.createState(lv, { useSlotStart: true, instantChain: false }); for (const [r, c] of pipes) initNext[r + ',' + c] = (s0.cells[r][c].next || 0); }
const rnd = lcg(SEED);
const rows = [];
for (let gi = 0; gi < GAMES; gi++) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  let steps = 0, openStep = null, openProgress = null;
  while (!isWon(s) && steps < 200) {
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    const idx = ms.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
    let pick = null;
    for (const k of idx) {
      const m = ms[k]; const t = St.cloneState(s);
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      if (!isDead(t) || isWon(t)) { pick = t; break; }
    }
    if (!pick) break;
    s = pick; steps++;
    if (openStep === null && pipes.some(([r, c]) => (s.cells[r][c].next || 0) > (initNext[r + ',' + c] || 0))) {
      openStep = steps; openProgress = s.eliminatedPixels / s.totalPixels;
    }
  }
  rows.push({ won: isWon(s), steps, deathProgress: isWon(s) ? null : +(s.eliminatedPixels / s.totalPixels).toFixed(3), openStep, openProgress: openProgress == null ? null : +openProgress.toFixed(3) });
}
const opens = rows.filter(x => x.openStep !== null);
const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const out = {
  file: path.basename(path.dirname(path.resolve(FILE))) + '/' + path.basename(FILE), games: GAMES, seed: SEED,
  openRate: +(opens.length / GAMES).toFixed(3), neverOpen: GAMES - opens.length,
  openStepMedian: med(opens.map(x => x.openStep)), openProgressMedian: med(opens.map(x => x.openProgress)),
  opensAmongDeaths: opens.filter(x => !x.won).length, deaths: rows.filter(x => !x.won).length,
  wins: rows.filter(x => x.won).length
};
console.log(JSON.stringify(out));
