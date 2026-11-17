#!/usr/bin/env node
'use strict';
/**
 * 链进场_97478 —— 统计 p-贪心各 p 下链组（link>0）的进场进度与驻留步数。
 * 与 PInterpPlayer 同口径（corner / useSlotStart / instantChain:false / LCG seed 977）。
 *
 * 用法：node 链进场_97478.js <关卡.json> <p列表,逗号分隔> <out.json>
 */
const fs = require('fs');
const B = require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const [levelFile, pArg, outFile] = process.argv.slice(2);
if (!levelFile || !pArg || !outFile) {
  console.error('用法: node 链进场_97478.js <关卡.json> <p列表> <out.json>');
  process.exit(2);
}
const PLIST = pArg.split(',').map(Number).filter(x => x >= 0 && x <= 1);
const NGAMES = 100, SEED = 977, MAX_STEPS = 200;
const isWon = s => s.eliminatedPixels >= s.totalPixels;
const isDead = s => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const round = (x, n) => { const p = Math.pow(10, n); return Math.round(x * p) / p; };
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }

function play(lv, p, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const pureRandom = p <= 0, pureGreedy = p >= 1;
  let steps = 0;
  let entry = null, release = null, lastLink = 0;
  while (!isWon(s) && steps < MAX_STEPS) {
    const progress = s.eliminatedPixels / s.totalPixels;
    const linksNow = s.buffer.filter(b => b.link > 0).map(b => b.link);
    if (linksNow.length && entry === null) entry = { progress: round(progress, 4), step: steps };
    if (lastLink && !linksNow.includes(lastLink) && release === null) release = { progress: round(progress, 4), step: steps };
    if (linksNow.length) lastLink = linksNow[0];
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    const aliveT = t => !isDead(t) || isWon(t);
    let pick = null;
    const useGreedy = pureGreedy || (!pureRandom && rnd() < p);
    if (useGreedy) {
      const cand = [];
      for (const m of ms) {
        const t = St.cloneState(s); const e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!aliveT(t)) continue;
        cand.push({ r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0 });
      }
      if (cand.length) {
        let best = -Infinity; for (const o of cand) if (o.gain > best) best = o.gain;
        const tied = cand.filter(o => o.gain === best);
        pick = tied[Math.floor(rnd() * tied.length)];
      }
    } else {
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      for (const k of idx) {
        const m = ms[k]; const t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (aliveT(t)) { pick = { r: m.r, c: m.c, t }; break; }
      }
    }
    if (!pick) return { won: false, deathProgress: round(progress, 4), steps, entry, release };
    s = pick.t; steps++;
  }
  if (isWon(s)) {
    const linksNow = s.buffer.filter(b => b.link > 0);
    if (lastLink && release === null && !linksNow.some(b => b.link === lastLink)) release = { progress: 1, step: steps };
    return { won: true, steps, entry, release };
  }
  return { won: false, deathProgress: round(s.eliminatedPixels / s.totalPixels, 4), steps, entry, release };
}

const game = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));
const out = { tool: '链进场_97478', level: levelFile, seed: SEED, gamesPerP: NGAMES, rows: [] };
for (const p of PLIST) {
  const rnd = lcg(SEED);
  const games = [];
  for (let g = 0; g < NGAMES; g++) games.push(play(lv, p, rnd));
  const entered = games.filter(g => g.entry);
  const eps = entered.map(g => g.entry.progress).sort((a, b) => a - b);
  const holds = entered.filter(g => g.release).map(g => g.release.step - g.entry.step);
  const row = {
    p, games: NGAMES,
    wins: games.filter(g => g.won).length,
    deaths: games.filter(g => !g.won).length,
    chainEntered: entered.length,
    entryMin: eps.length ? eps[0] : null,
    entryMedian: eps.length ? eps[Math.floor(eps.length / 2)] : null,
    entryMax: eps.length ? eps[eps.length - 1] : null,
    entryMean: eps.length ? round(eps.reduce((a, b) => a + b, 0) / eps.length, 4) : null,
    holdMedian: holds.length ? holds.slice().sort((a, b) => a - b)[Math.floor(holds.length / 2)] : null,
    holdMax: holds.length ? Math.max(...holds) : null,
    deathsWithEntry: games.filter(g => !g.won && g.entry).length,
    perGame: games
  };
  out.rows.push(row);
  console.log(JSON.stringify({ p, wins: row.wins, deaths: row.deaths, entered: row.chainEntered, entryMin: row.entryMin, entryMedian: row.entryMedian, entryMax: row.entryMax, entryMean: row.entryMean, holdMedian: row.holdMedian, holdMax: row.holdMax }));
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
