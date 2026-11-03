#!/usr/bin/env node
'use strict';
/**
 * TopoSearch_v797 —— 黑块布局搜索（2026-11-03）
 *
 * 为什么做这个（日志 §880.2 的四条死路）：
 *   方形棋盘的压力与选择只能二选一——因为**棋盘拓扑是固定输入，从没被搜索过**。
 *   黑块是唯一能改拓扑的手段（永久占位、收窄暴露面），但一直是手工摆 1–3 个。
 *
 * 做法：
 *   把一辆车变成黑块 → 它的容量转给同色的另一辆车（守恒不破）→ 复测
 *   → 好就留、差就撤 → 爬山 N 轮。
 *
 * 硬约束（任一破坏立即回滚）：
 *   · 被吞的车必须还有同色车（否则该色永不可消 = 直接不可通关）
 *   · 容量守恒 / 无空格 / 可通关 / 峰值 4 / 前 20% at4=0
 *
 * 用法：
 *   node TopoSearch_v797.js <关卡.json> --out 结果.json [--iters 200] [--max-black 4] [--seed 1]
 *
 * 末尾会用 ArlCheck 跑一遍 13 项，通过项数变少则整体回滚（跟 RxPrescribe 一样的安全闸）。
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--iters', '--max-black', '--ref', '--seed'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/topo.json');
const REF = arg('--ref', 'corner');
const ITERS = Number(arg('--iters', '200'));
const MAX_BLACK = Number(arg('--max-black', '4'));
const SEED = Number(arg('--seed', '1'));
const QUIET = process.argv.includes('--quiet');

const A = B.loadSolver(REF);

let _s = (SEED >>> 0) || 1;
const rand = () => {
  _s = (_s + 0x6D2B79F5) >>> 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const clone = o => JSON.parse(JSON.stringify(o));
const typesOf = s => (s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : []);

function solveOnce(g) {
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false,
    { capturePreviewStats: true, instantChain: false });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const L = buf.length, eN = Math.max(1, Math.round(L * 0.2)), tN = Math.floor(L * 0.8);
  const tail = buf.slice(tN);
  let run = 0, c = 0;
  for (const v of tail) { if (v >= 3) { c++; run = Math.max(run, c); } else c = 0; }
  return {
    o, L, won: !!o.completed, peak: Math.max(0, ...buf), buf,
    early4: buf.slice(0, eN).filter(v => v >= 4).length,
    earlyFree: buf.slice(0, eN).filter(v => v === 0).length,
    mid3: buf.slice(eN, tN).filter(v => v >= 3).length,
    tail3: tail.filter(v => v >= 3).length, tailRun: run,
    at4: buf.filter(v => v >= 4).length,
    tailN: tail.length,
  };
}

/** 决策度（口径同 ArlCheck_v793：只算暴露的格子） */
function decision(g, o) {
  const H = g.blocks.length, W = g.blocks[0].length, rows = g.spools.length, cols = g.spools[0].length;
  const col = g.blocks.map(r => r.slice()), gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const tc = g.spools.map(r => r.map(() => false));
  const exposedAt = (r, c) => (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) ||
    (tc[r - 1] && tc[r - 1][c]) || (tc[r + 1] && tc[r + 1][c]) || tc[r][c - 1] || tc[r][c + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  let good = 0, dead = 0;
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || !reach(y, x)) continue;
      cnt[col[y][x]] = (cnt[col[y][x]] || 0) + 1;
    }
    let avail = 0, fill = 0;
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      const s = g.spools[r][c2];
      if (!s || !(s.id > 0) || !exposedAt(r, c2)) continue;
      if (typesOf(s).includes(7)) continue;           // 冰不可选
      avail++;
      if (!s.q && (cnt[s.id] || 0) >= s.count) fill++;
    }
    if (avail >= 2 && fill >= 1 && fill < avail) good++;
    if (fill === 0) dead++;
    // 推进（corner 顺序）
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue;
      list.push([(H - 1 - y) + x, y, x]);
    }
    list.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    tc[p.r][p.c] = true;
  }
  return { good, dead, picks: picks.length };
}

function evaluate(g) {
  const m = solveOnce(g);
  const d = m.won ? decision(g, m.o) : { good: 0, dead: 999, picks: 0 };
  return { ...m, ...d };
}

/** 得分：压力与选择并重；dead 重罚 */
const scoreOf = m => m.mid3 * 1.0 + m.tail3 * 2.5 + m.tailRun * 1.5 + m.good * 1.2 - m.dead * 2.5;

/** 硬门：破坏这些就不许保留 */
const hardOK = m => m.won && m.peak === 4 && m.early4 === 0 && m.at4 >= 5;

function carCells(g) {
  const out = [];
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[0].length; c++) {
    const s = g.spools[r][c];
    if (s && s.id > 0 && !typesOf(s).includes(5) && !typesOf(s).includes(7) && !s.q) out.push([r, c]);
  }
  return out;
}
function blackCount(g) {
  let n = 0;
  for (const row of g.spools) for (const s of row) if (!s || !(s.id > 0)) n++;
  return n;
}

/** 把 (r,c) 的车变黑块，容量转给同色另一辆；返回撤销函数（不可行返回 null） */
function blackout(g, r, c) {
  const s = g.spools[r][c];
  if (!s || !(s.id > 0)) return null;
  const same = [];
  for (const row of g.spools) for (const x of row) {
    if (!x || x === s) continue;
    if (x.id === s.id && !typesOf(x).includes(7)) same.push(x);
  }
  if (!same.length) return null;                    // 单车辆颜色：吞了就永不可消
  const tgt = same[Math.floor(rand() * same.length)];
  const oldS = { id: s.id, type: s.type, param: s.param, count: s.count, q: s.q };
  const oldC = tgt.count;
  tgt.count += s.count;
  s.id = -1; s.type = 0; s.param = 0; s.count = 0; s.q = false;
  return () => {
    s.id = oldS.id; s.type = oldS.type; s.param = oldS.param; s.count = oldS.count; s.q = oldS.q;
    tgt.count = oldC;
  };
}

// ═══════════════════════════════════════════
let g = B.readJson(FILE);
const g0 = clone(g);
const m0 = evaluate(g);
const log = [];

if (!QUIET) {
  console.log(`基线：步${m0.L} 峰${m0.peak} 中${m0.mid3} 后${m0.tail3}/${m0.tailRun} 决策${m0.good} 没得选${m0.dead} 黑块${blackCount(g)}`);
}

const baseBlack = blackCount(g);      // 关卡自带的黑块（边框外的空位也算），MAX_BLACK 指的是"最多再加几个"
let best = hardOK(m0) ? scoreOf(m0) : -1e9;
let cur = best;
let kept = 0;

for (let it = 0; it < ITERS; it++) {
  if (blackCount(g) - baseBlack >= MAX_BLACK) break;
  const cells = carCells(g);
  if (!cells.length) break;
  const [r, c] = cells[Math.floor(rand() * cells.length)];
  const undo = blackout(g, r, c);
  if (!undo) continue;
  const m2 = evaluate(g);
  if (hardOK(m2) && scoreOf(m2) > cur) {
    cur = scoreOf(m2);
    kept++;
    if (!QUIET) log.push(`保留黑块(${r},${c})：中${m2.mid3} 后${m2.tail3}/${m2.tailRun} 决策${m2.good} 没得选${m2.dead}`);
  } else {
    undo();
  }
}

const mf = evaluate(g);
if (!QUIET) {
  console.log(`爬完 ${ITERS} 轮：新增 ${kept} 个黑块（原有 ${baseBlack}，现共 ${blackCount(g)}）`);
  log.slice(-8).forEach(x => console.log('  · ' + x));
  console.log(`结果：中${mf.mid3} 后${mf.tail3}/${mf.tailRun} 决策${mf.good} 没得选${mf.dead} 峰${mf.peak} 可通${mf.won}`);
}

// ── 13 项总闸 ──
let out = clone(g);
fs.writeFileSync(OUT, JSON.stringify(out));
if (!QUIET) {
  const { check } = require('./ArlCheck_v792');
  const passed = f => check(f).rules.filter(r => r[1]).length;
  let p0 = null, p1 = null;
  try { p0 = passed(FILE); p1 = passed(OUT); } catch (e) {}
  if (p0 != null && p1 != null) {
    console.log(`13 项：改前 ${p0}/13 → 改后 ${p1}/13`);
    if (p1 < p0) {
      fs.writeFileSync(OUT, JSON.stringify(g0));
      console.log(`搜索让通过项减少（${p0}→${p1}），已整体回滚`);
    }
  }
}
if (!QUIET) console.log('已写入', OUT);
