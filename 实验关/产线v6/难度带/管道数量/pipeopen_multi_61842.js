#!/usr/bin/env node
'use strict';
/**
 * pipeopen_multi_61842 —— 纯随机玩家（p=0，逐位复刻 PInterpPlayer）下**每根管**的开管时机
 *
 * 由 管道研究/pipeopen_random_27995.js 扩展：27995 只记“任意一根管第一次开”，
 * 本工具对每根管分别记 openStep / openProgress，并保留 overall（第一根开）对照口径。
 *
 * 输出：{file, games, seed, openRate(any), perPipe:[{pipe,dir,queue,openRate,openStepMedian,
 *        openProgressMedian,neverOpen}], overall:{openRate,...}, deaths,wins}
 * 开管判定：该管出口格 next 增加（=出口格第一次被拿走、管道吐第一个球）。
 *
 * 用法: node pipeopen_multi_61842.js <关卡.json> [--games 100 --seed 977]
 * 只读。pid 61842。
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
  const s = game.spools[r][c];
  const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
  const dir = t.find(x => x >= 11 && x <= 14);
  if (dir) pipes.push({ r, c, dir, queue: s.param });
}
const initNext = {};
{ const s0 = Sim.createState(lv, { useSlotStart: true, instantChain: false }); for (const p of pipes) initNext[p.r + ',' + p.c] = (s0.cells[p.r][p.c].next || 0); }
const rnd = lcg(SEED);
const rows = [];
for (let gi = 0; gi < GAMES; gi++) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  let steps = 0;
  const openStep = pipes.map(() => null), openProgress = pipes.map(() => null);
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
    for (let i = 0; i < pipes.length; i++) {
      if (openStep[i] !== null) continue;
      const p = pipes[i];
      if ((s.cells[p.r][p.c].next || 0) > (initNext[p.r + ',' + p.c] || 0)) {
        openStep[i] = steps; openProgress[i] = s.eliminatedPixels / s.totalPixels;
      }
    }
  }
  rows.push({ won: isWon(s), steps, deathProgress: isWon(s) ? null : +(s.eliminatedPixels / s.totalPixels).toFixed(3), openStep, openProgress });
}
const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const perPipe = pipes.map((p, i) => {
  const opened = rows.filter(x => x.openStep[i] !== null);
  return {
    pipe: [p.r, p.c], dir: p.dir, queue: p.queue,
    openRate: +(opened.length / GAMES).toFixed(3), neverOpen: GAMES - opened.length,
    openStepMedian: med(opened.map(x => x.openStep[i])),
    openProgressMedian: opened.length ? +med(opened.map(x => +x.openProgress[i].toFixed(3))).toFixed(3) : null
  };
});
const anyOpened = rows.filter(x => x.openStep.some(v => v !== null));
const firstStep = rows.map(x => {
  const vals = x.openStep.filter(v => v !== null);
  return vals.length ? Math.min(...vals) : null;
});
const firstProg = rows.map(x => {
  let best = null;
  for (let i = 0; i < pipes.length; i++) if (x.openStep[i] !== null && (best === null || x.openStep[i] < best.step)) best = { step: x.openStep[i], prog: x.openProgress[i] };
  return best ? best.prog : null;
});
const out = {
  file: path.basename(path.dirname(path.resolve(FILE))) + '/' + path.basename(FILE), games: GAMES, seed: SEED,
  perPipe,
  overall: {
    openRate: +(anyOpened.length / GAMES).toFixed(3), neverOpen: GAMES - anyOpened.length,
    openStepMedian: med(firstStep.filter(v => v !== null)),
    openProgressMedian: firstProg.some(v => v !== null) ? +med(firstProg.filter(v => v !== null)).toFixed(3) : null
  },
  opensAmongDeaths: anyOpened.filter(x => !x.won).length,
  deaths: rows.filter(x => !x.won).length,
  wins: rows.filter(x => x.won).length
};
console.log(JSON.stringify(out));
