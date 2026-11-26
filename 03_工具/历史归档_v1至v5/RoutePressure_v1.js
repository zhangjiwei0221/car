#!/usr/bin/env node
'use strict';
/**
 * RoutePressure_v1 —— 同一关卡在“五种走法”下的暂存压力画像
 *
 * 用户 2026-11-13：不只看它们能不能通过，要看这些求解器走法下的**暂存区压力值**。
 *
 * 五种走法：
 *   min     最小暂存路线（Solver.runMinBuffer，depth 3）
 *   beam    强搜索路线（束搜索 W=16，找到解即记录该路径）
 *   greedy  贪心（每步吃最多；避开当步就死）
 *   ff      会玩（free-first：先不欠债、再吃得多、再债少）
 *   rand    随机（同 PopulationSim；跑 N 局，取通关局的中位曲线）
 *
 * 输出（每关）：
 *   max     路线上暂存的最大值
 *   p3      buffer≥3 的步数占比
 *   mean    平均暂存
 *   steps   步数
 *
 * 用法：node RoutePressure_v1.js <关卡.json> [--rand 40] [--width 16]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const file = process.argv[2];
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const NR = Number(arg('--rand', 40));
const W = Number(arg('--width', 16));
if (!file) { console.error('用法: node RoutePressure_v1.js <关卡.json> [--rand 40] [--width 16]'); process.exit(2); }

const lv = A.parseLevel(A.fromGameFormat(JSON.parse(fs.readFileSync(file, 'utf8'))));
const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));

function summarize(bufs) {
  if (!bufs.length) return { steps: 0, max: 0, p3: 0, mean: 0 };
  const sum = bufs.reduce((a, b) => a + b, 0);
  return {
    steps: bufs.length,
    max: Math.max(...bufs),
    p3: +(bufs.filter(b => b >= 3).length / bufs.length).toFixed(3),
    mean: +(sum / bufs.length).toFixed(2),
  };
}

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

function walk(policy) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const bufs = [];
  for (let i = 0; i < 200 && !isWon(s); i++) {
    const opts = expand(s);
    if (!opts.length) return { won: false, bufs };
    const pick = policy(opts, s);
    if (!pick) return { won: false, bufs };
    bufs.push(s.buffer.length);
    s = pick.t;
  }
  return { won: isWon(s), bufs };
}

const greedy = () => walk((opts) => {
  const safe = opts.filter(o => !isDead(o.t) || isWon(o.t));
  if (!safe.length) return null;
  safe.sort((a, b) => (b.gain - a.gain) || (a.t.buffer.length - b.t.buffer.length));
  return safe[0];
});

const freeFirst = () => walk((opts) => {
  const safe = opts.filter(o => !isDead(o.t) || isWon(o.t));
  if (!safe.length) return null;
  const key = (o) => [o.t.buffer.length === 0 ? 1 : 0, o.gain, -o.t.buffer.length,
    -o.t.buffer.reduce((a, b) => a + (b.need - b.progress), 0), -o.r, -o.c];
  let best = null, bk = null;
  for (const o of safe) { const k = key(o); if (!best || cmp(k, bk) > 0) { best = o; bk = k; } }
  return best;
});

function cmp(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }

// 束搜索：保留完整父链，返回找到解的那条路径的暂存序列
const keyOf = (s) => {
  let k = '';
  for (const row of s.cells) for (const c of row) k += (c && c.t === 'box') ? '1' : '0';
  let ice = '';
  if (s.numice) for (const kk of Object.keys(s.numice).sort()) ice += kk + ':' + s.numice[kk].remaining + ';';
  return k + '|' + s.eliminatedPixels + '|' + ice + '|' + s.buffer.map(b => b.color + ':' + b.progress).sort().join(',');
};

function beam() {
  let beam = [{ s: Sim.createState(lv, { useSlotStart: true, instantChain: false }), bufs: [] }];
  for (let depth = 0; depth < 200; depth++) {
    const next = new Map();
    for (const node of beam) {
      if (isWon(node.s)) return { won: true, bufs: node.bufs };
      for (const o of expand(node.s)) {
        const bufs = node.bufs.concat([node.s.buffer.length]);
        if (isWon(o.t)) return { won: true, bufs };
        if (isDead(o.t)) continue;
        const k = keyOf(o.t);
        if (!next.has(k)) next.set(k, { s: o.t, bufs });
      }
    }
    const arr = [...next.values()];
    arr.sort((a, b) => (a.s.buffer.length - b.s.buffer.length) || (b.s.eliminatedPixels - a.s.eliminatedPixels));
    beam = arr.slice(0, W);
    if (!beam.length) break;
  }
  return { won: false, bufs: [] };
}

function rand() {
  const bufsAll = [];
  let seed = 977;
  const r2 = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let g = 0; g < NR; g++) {
    const r = walk((opts) => {
      const safe = opts.filter(o => !isDead(o.t) || isWon(o.t));
      if (!safe.length) return null;
      return safe[Math.floor(r2() * safe.length)];
    });
    if (r.won) bufsAll.push(r.bufs);
  }
  if (!bufsAll.length) return { won: false, bufs: [] };
  // 中位曲线：按步取中位
  const L = Math.min(...bufsAll.map(b => b.length));
  const med = [];
  for (let i = 0; i < L; i++) {
    const col = bufsAll.map(b => b[i]).sort((x, y) => x - y);
    med.push(col[Math.floor(col.length / 2)]);
  }
  return { won: true, bufs: med };
}

const out = { level: file.split('/').pop() };
const mb = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
if (mb && mb.stepBufferHistory) out.min = { won: !!mb.won, ...summarize(mb.stepBufferHistory) };
else out.min = { won: false, steps: 0, max: 0, p3: 0, mean: 0 };
const bm = beam(); out.beam = { won: bm.won, ...summarize(bm.bufs) };
const gr = greedy(); out.greedy = { won: gr.won, ...summarize(gr.bufs) };
const ff = freeFirst(); out.ff = { won: ff.won, ...summarize(ff.bufs) };
const rd = rand(); out.rand = { won: rd.won, ...summarize(rd.bufs) };
console.log(JSON.stringify(out));
