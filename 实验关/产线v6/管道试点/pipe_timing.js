#!/usr/bin/env node
'use strict';
/**
 * pipe_timing.js —— 在 A/B 关上量「管道出口开启时机」与「队列里每辆车实际被取出的进度」。
 *
 * 复用产线口径：loadSolver('corner') + fromGameFormat + parseLevel + createState{useSlotStart:true,instantChain:false}。
 * 两条路线：
 *   - free-first（= PressureBuild_v5.freePath 的排序键，会玩的人）→ 逐步计时
 *   - random（= PopulationSim/PressureBuild 的随机玩家）→ 多局聚合
 *
 * 用法:
 *   node pipe_timing.js <关卡.json> --pipe <r,c> --dir <11|12|13|14> [--random 100] [--seeds 977,4242,31337]
 * 输出 JSON：free 路线与 random 聚合的管道事件（步号 / 进度）。
 */
const fs = require('fs');
const path = require('path');
const B = require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;
const PD = { 11: [-1, 0], 12: [0, 1], 13: [1, 0], 14: [0, -1] };

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file) { console.error('用法: pipe_timing.js <关卡.json> --pipe r,c --dir N [--random 100] [--seeds ...]'); process.exit(2); }
const [pr, pc] = String(arg('--pipe', '')).split(',').map(Number);
const dir = Number(arg('--dir', 13));
const NRAND = Number(arg('--random', 100));
const PSEED = String(arg('--seeds', '977,4242,31337')).split(',').map(Number);
const [dr, dc] = PD[dir];
const er = pr + dr, ec = pc + dc;

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
function expand(s) {
  const out = [];
  for (const m of Sim.listMoves(s)) {
    if (m.blocked) continue;
    const t = St.cloneState(s);
    const e0 = t.eliminatedPixels, d0 = t.completedBoxes;
    if (!Sim.applyPick(t, m.r, m.c)) continue;
    out.push({ r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0, delta: t.completedBoxes - d0 });
  }
  return out;
}
function bucket(x) { if (x <= 0) return 0; if (x <= 2) return 1; if (x <= 5) return 2; if (x <= 10) return 3; if (x <= 20) return 4; return 5; }
function entropy(keys) { const c = {}; for (const k of keys) c[k] = (c[k] || 0) + 1; let h = 0; for (const k in c) { const p = c[k] / keys.length; h -= p * Math.log(p); } return h; }
const legalN = (s) => Sim.listMoves(s).filter(m => !m.blocked).length;
function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }

function pipeOf(s) { return s.cells[pr] && s.cells[pr][pc]; }

// 记录一次“路线”的管道事件；route = [{r,c,progressAfter,nextBefore,nextAfter}]
function recordRoute(states) {
  // states: 0..T 的逐步快照（state 本身，不改）
  const events = { releases: [], takes: [] };
  const qlen = (() => { const p = pipeOf(states[0]); return p && p.queue ? p.queue.length : 0; })();
  let prevNext = pipeOf(states[0]).next || 0;
  let prevProgress = states[0].eliminatedPixels / states[0].totalPixels;
  // 开局已吐出（exit 起始即空）→ 记第 0 步释放
  for (let i = 0; i < prevNext; i++) events.releases.push({ ball: i, step: 0, progress: +prevProgress.toFixed(4) });
  let openedStep = null, openedProgress = null;
  for (let i = 1; i < states.length; i++) {
    const s = states[i], pick = states[i].pick;
    const p = pipeOf(s);
    const nx = p.next || 0;
    const prog = s.eliminatedPixels / s.totalPixels;
    // 取出：这一步点的正是出口格，且此前有球在出口（prevNext>0，即上一状态 next-1 个球已吐出）
    if (pick && pick.r === er && pick.c === ec && prevNext > 0) {
      const ball = prevNext - 1;
      events.takes.push({ ball, step: i, progress: +prog.toFixed(4) });
      if (openedStep === null) { openedStep = i; openedProgress = +prog.toFixed(4); }
    }
    // 释放：这一步把出口清空后管道吐出下一辆（next 增加）
    if (nx > prevNext) for (let b = prevNext; b < nx; b++) events.releases.push({ ball: b, step: i, progress: +prog.toFixed(4) });
    prevNext = nx; prevProgress = prog;
  }
  return { queueLen: qlen, openedStep, openedProgress, events };
}

function snapshotsFromRoute(states, picks) {
  // states: array of Sim states in order; picks: {r,c} per transition (picks[i-1] → states[i])
  return states.map((s, i) => { if (i > 0) s.pick = picks[i - 1]; return s; });
}

function runFree(lv) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const states = [s], picks = [];
  for (let i = 0; i < 80 && !isWon(s); i++) {
    const opts = expand(s);
    if (!opts.length) return { won: false, states, picks };
    let best = null, bestKey = null;
    for (const o of opts) {
      const t = o.t, bufAfter = t.buffer.length;
      const debtPx = t.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
      const nextM = isWon(t) ? 0 : legalN(t);
      const dead = t.overflow || bufAfter > t.bufferLimit || (bufAfter >= t.bufferLimit && o.delta === 0) || (!isWon(t) && nextM === 0);
      const key = [dead ? 0 : 1, bufAfter === 0 ? 1 : 0, o.gain, -bufAfter, -debtPx, -o.r, -o.c];
      if (!best || cmpArr(key, bestKey) > 0) { best = o; bestKey = key; }
    }
    const done0 = s.completedBoxes;
    s = best.t; states.push(s); picks.push({ r: best.r, c: best.c });
    if (isWon(s)) break;
    if (s.overflow || s.buffer.length > s.bufferLimit || (s.buffer.length >= s.bufferLimit && s.completedBoxes === done0) || legalN(s) === 0) break;
  }
  return { won: isWon(s), states, picks };
}

function runRand(lv, seed) {
  // 用与 PressureBuild 相同 LCG；种子保持小值以免浮点精度破坏低位。
  let rs = ((seed * 48271) & 0x7fffffff) || 1;
  const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const states = [s], picks = [];
  while (!isWon(s)) {
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    for (let i = ms.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = ms[i]; ms[i] = ms[j]; ms[j] = x; }
    let pick = null;
    for (const m of ms) {
      const t = St.cloneState(s);
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      if (!isDead(t) || isWon(t)) { pick = { r: m.r, c: m.c, t }; break; }
    }
    if (!pick) return { won: false, states, picks };
    s = pick.t; states.push(s); picks.push({ r: pick.r, c: pick.c });
    if (states.length > 200) break;
  }
  return { won: isWon(s), states, picks };
}

function summarize(tags) {
  const opens = tags.filter(t => t.openedStep != null).map(t => t.openedProgress);
  opens.sort((a, b) => a - b);
  const med = (a) => a.length ? (a.length % 2 ? a[Math.floor(a.length / 2)] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null;
  return {
    n: tags.length,
    openedAny: opens.length,
    openProgress: { min: opens.length ? +opens[0].toFixed(3) : null, med: med(opens) != null ? +med(opens).toFixed(3) : null, max: opens.length ? +opens[opens.length - 1].toFixed(3) : null },
    takes: tags.map(t => t.events.takes.map(x => +x.progress.toFixed(3)))
  };
}

const game = JSON.parse(fs.readFileSync(file, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));
const s0 = Sim.createState(lv, { useSlotStart: true, instantChain: false });
const pipeInit = pipeOf(s0);
const exitBox = s0.cells[er] && s0.cells[er][ec];
const out = {
  file: path.basename(file), pipe: [pr, pc], dir, exit: [er, ec], queueLen: pipeInit.queue ? pipeInit.queue.length : null,
  queue: pipeInit.queue || [], nextAtInit: pipeInit.next || 0,
  exitAtInit: exitBox ? (exitBox.color != null ? `box ${exitBox.color}:${exitBox.count}` : (exitBox.t || 'null')) : 'null',
  openingMoves: legalN(s0)
};
const free = runFree(lv);
out.free = { won: free.won, steps: free.states.length - 1, ...recordRoute(snapshotsFromRoute(free.states, free.picks)) };
const rand = [];
for (let i = 0; i < NRAND; i++) {
  const sd = PSEED[i % PSEED.length] * 1000 + i;
  const r = runRand(lv, sd);
  const rec = recordRoute(snapshotsFromRoute(r.states, r.picks));
  rand.push({ won: r.won, ...rec });
}
const wins = rand.filter(x => x.won);
out.random = {
  n: NRAND, wins: wins.length, winRate: +(wins.length / NRAND).toFixed(3),
  openedAny: rand.filter(x => x.openedStep != null).length,
  openProgressAll: summarize(rand),
  openProgressWins: summarize(wins)
};
console.log(JSON.stringify(out, null, 1));
