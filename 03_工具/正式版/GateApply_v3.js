#!/usr/bin/env node
'use strict';
/**
 * GateApply_v3 —— 产线 v5 / C1：ZC_23 “中段有代价的门”（2026-11-12）
 *
 * 设计（路线 2）：
 *   钥匙 = 早期色车（开门时该色可达 ≥ 容量 → 进场就吃满，给玩家立刻收益）；
 *   代价 = 后期色车（该色 p50 ≥ 0.6，或开门时可达 < 容量的一半 → 链组要占好几步）。
 *   目标：开门进度 30–55%；会玩 chainFillSteps ≥ 2；win ≥ 0.9；entropy ≥ 1.45。
 *
 * 做法：
 *   1) 底座 20 随机 + 1 free-first：算每色 activationProgress 的 p10/p50/p90，分早/中/晚。
 *   2) 枚举所有正交相邻车格对（一端早期色、一端后期色）；也枚举“把后期色车换到早期色车旁边”
 *      的 1 次换位（只换普通/冰/问号车，不碰锁链/管道/黑块）。
 *   3) 每个候选：free-first + N 局随机；量 chainFillSteps / 开门进度 / 拿门率 / win / entropy /
 *      守恒 / Solvable width8 / 开门时两种颜色的可达像素 vs 容量。
 *   4) 选门：先严格满足“钥匙可达≥容量 + 代价可达<容量一半 + 30–55 + 会玩 fill≥2 + win≥0.9 + 熵≥1.45”；
 *      若没有，退回“四项数值目标”并明确标注 strict=false；若还没有，报告“这张图做不到”。
 *
 * 口径：loadSolver('corner')，useSlotStart:true，instantChain:false。
 * 只改 type/param（上链）与整辆车换位；不改 count / id / 目标图 / 其他障碍。
 *
 * 用法：
 *   node GateApply_v3.js <关卡.json> --out <目录> [--runs 30] [--seed 977]
 *        [--eval-runs 30] [--eval-seeds 977,4242,31337] [--max-swaps 3]
 *
 * 输出：关卡_ZC_23_gate3.json、GateApply_v3.json
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const LEVEL = process.argv[2];
if (!LEVEL || LEVEL.startsWith('--') || has('--help')) {
  console.error('用法: node GateApply_v3.js <关卡.json> --out <目录> [--runs 30] [--seed 977] [--eval-runs 30] [--eval-seeds 977,4242,31337] [--max-swaps 3]');
  process.exit(2);
}
const OUT = arg('--out', path.join(path.dirname(LEVEL), '23_gate3'));
const RUNS = Math.max(5, Number(arg('--runs', 30)) || 30);
const SEED = Number(arg('--seed', 977));
const EVAL_RUNS = Math.max(5, Number(arg('--eval-runs', 30)) || 30);
const EVAL_SEEDS = String(arg('--eval-seeds', '977,4242,31337')).split(',').map(x => Number(x.trim())).filter(x => Number.isFinite(x));
const MAX_SWAPS = Math.max(1, Number(arg('--max-swaps', 3)) || 3);
const GATE_COLOR = 31; // 仅用于报告“门色”是否被用到；v3 不强制
const W0 = 0.30, W1 = 0.55, CENTER = 0.425;

const baseGame = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
if (!baseGame || !Array.isArray(baseGame.spools)) { console.error('不是可识别的关卡 JSON（缺少 spools）'); process.exit(2); }
const ROWS = baseGame.spools.length, COLS = baseGame.spools[0].length;

// ==================== 基础 ====================
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) { if (!a || !a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
function q(a, p) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.floor(p * (b.length - 1))))]; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function r3(x) { return x == null ? null : +Number(x).toFixed(4); }
const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const typeList = (c) => Array.isArray(c.type) ? c.type : (c.type === 0 || c.type == null ? [] : [c.type]);
const chainOf = (c) => { const ts = typeList(c); const i = ts.indexOf(5); if (i < 0) return 0; return Array.isArray(c.param) ? (Number(c.param[i]) || 0) : (Number(c.param) || 0); };
function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }
function setChain(cell, gid) {
  const ts = typeList(cell), ice = ts.indexOf(7), qq = ts.indexOf(6);
  const nt = [5], np = [gid];
  if (ice >= 0) { nt.push(7); np.push(Array.isArray(cell.param) ? cell.param[ice] : cell.param); }
  if (qq >= 0) { nt.push(6); np.push(0); }
  cell.type = nt.length === 1 ? 5 : nt;
  cell.param = np.length === 1 ? gid : np;
}
function maxChainId(game) { let m = 0; for (const row of game.spools) for (const c of row) { const g = chainOf(c); if (g > m) m = g; } return m; }
function isCar(c) { return c && c.id > 0 && c.count > 0; }
function isPipe(c) { return typeList(c).some(t => t >= 11 && t <= 14); }
function swappable(c) { if (!isCar(c) || isPipe(c)) return false; const ts = typeList(c); return !ts.includes(5); }
function neighbors(r, c) { return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([rr, cc]) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS); }

// ==================== 可达像素 ====================
function reachableCount(s, color) {
  const rows = s.rows, cols = s.cols, blocks = s.blocks, elim = s.eliminated;
  const DIR = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const open = new Uint8Array(rows * cols), st = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const edge = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
    if (edge && elim[r][c]) { const id = r * cols + c; if (!open[id]) { open[id] = 1; st.push(id); } }
  }
  while (st.length) {
    const cur = st.pop(), cr = (cur / cols) | 0, cc = cur % cols;
    for (const [dr, dc] of DIR) {
      const nr = cr + dr, nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const id = nr * cols + nc;
      if (open[id] || !elim[nr][nc]) continue;
      open[id] = 1; st.push(id);
    }
  }
  const vis = new Uint8Array(rows * cols), st2 = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (elim[r][c] || blocks[r][c] !== color) continue;
    const edge = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
    let seed = edge;
    for (const [dr, dc] of DIR) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && open[nr * cols + nc]) { seed = true; break; }
    }
    if (!seed) continue;
    const id = r * cols + c;
    if (!vis[id]) { vis[id] = 1; st2.push(id); }
  }
  let count = 0;
  while (st2.length) {
    const cur = st2.pop(); count++;
    const cr = (cur / cols) | 0, cc = cur % cols;
    for (const [dr, dc] of DIR) {
      const nr = cr + dr, nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || elim[nr][nc] || blocks[nr][nc] !== color) continue;
      const id = nr * cols + nc;
      if (!vis[id]) { vis[id] = 1; st2.push(id); }
    }
  }
  return count;
}

// ==================== 玩家模拟 ====================
function bucket(x) { if (x <= 0) return 0; if (x <= 2) return 1; if (x <= 5) return 2; if (x <= 10) return 3; if (x <= 20) return 4; return 5; }
function entropy(keys) { if (!keys.length) return 0; const c = {}; for (const k of keys) c[k] = (c[k] || 0) + 1; let h = 0; for (const k in c) { const p = c[k] / keys.length; h -= p * Math.log(p); } return h; }

function runOnce(lv, game, gid, rnd, free) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const chainCells = new Set();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (chainOf(game.spools[r][c]) === gid) chainCells.add(r + ',' + c);
  let open = null, openState = null, takeProgress = null, took = false, fill = 0, done = true, links = null;
  let peak = s.buffer.length, guard = 0;
  const sigs = [];
  while (!isWon(s) && guard++ < 400) {
    const p = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    let gateNow = false;
    for (const m of ms) if (chainCells.has(m.r + ',' + m.c)) { gateNow = true; if (open == null) { open = p; openState = St.cloneState(s); } }
    if (s.buffer.length > peak) peak = s.buffer.length;
    if (links && !done) {
      const live = links.filter(l => s.buffer.some(b => b.link === l));
      if (live.length) fill++;
      links = live.length ? live : null;
      if (!links) done = true;
    }
    const linksBefore = new Set(s.buffer.map(b => b.link).filter(Boolean));
    let pick = null;
    if (free) {
      const keys = [], evals = [];
      for (const m of ms) {
        const t = St.cloneState(s);
        const e0 = t.eliminatedPixels, d0 = t.completedBoxes;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        const gain = t.eliminatedPixels - e0, bufAfter = t.buffer.length;
        const debtPx = t.buffer.reduce((x, b) => x + (b.need - b.progress), 0);
        const noMoves = t.eliminatedPixels < t.totalPixels && Sim.listMoves(t).filter(x => !x.blocked).length === 0;
        const dead = t.overflow || bufAfter > t.bufferLimit || (bufAfter >= t.bufferLimit && t.completedBoxes - d0 === 0) || noMoves;
        const nextM = t.eliminatedPixels >= t.totalPixels ? 0 : Sim.listMoves(t).filter(x => !x.blocked).length;
        keys.push([dead ? 1 : 0, Math.min(bufAfter, 6), bucket(debtPx), bucket(gain), Math.min(nextM, 10), t.completedBoxes - d0].join('|'));
        evals.push({ m, t, gain, bufAfter, debtPx, dead });
      }
      sigs.push(entropy(keys));
      if (!evals.length) break;
      let best = null, bestKey = null;
      for (const o of evals) {
        const key = [o.dead ? 0 : 1, o.bufAfter === 0 ? 1 : 0, o.gain, -o.bufAfter, -o.debtPx, -o.m.r, -o.m.c];
        if (!best || cmpArr(key, bestKey) > 0) { best = o; bestKey = key; }
      }
      if (!best) break;
      const lp = best.t.lastPick;
      if (lp && lp.isChain && lp.chain === gid) { took = true; takeProgress = p; const nl = [...new Set(best.t.buffer.map(b => b.link).filter(l => l && !linksBefore.has(l)))]; links = nl.length ? nl : null; done = !links; fill = 0; }
      s = best.t;
    } else {
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      for (const k of idx) {
        const m = ms[k], t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!isDead(t) || isWon(t)) { pick = t; break; }
      }
      if (!pick) break;
      const lp = pick.lastPick;
      if (lp && lp.isChain && lp.chain === gid) { took = true; takeProgress = p; const nl = [...new Set(pick.buffer.map(b => b.link).filter(l => l && !linksBefore.has(l)))]; links = nl.length ? nl : null; done = !links; fill = 0; }
      s = pick;
    }
  }
  return { won: isWon(s), open, openState, takeProgress, took, fill, peak, entropy: mean(sigs) };
}

// ==================== Solvable width 8 ====================
function keyOf(s) {
  let k = ''; for (const row of s.cells) for (const c of row) k += (c && c.t === 'box') ? '1' : '0';
  let ice = ''; if (s.numice) for (const kk of Object.keys(s.numice).sort()) ice += kk + ':' + s.numice[kk].remaining + ';';
  return k + '|' + s.eliminatedPixels + '|' + ice + '|' + s.buffer.map(b => b.color + ':' + b.progress).sort().join(',');
}
function better(a, b) { return (a.buffer.length - b.buffer.length) || (b.eliminatedPixels - a.eliminatedPixels); }
function solvableWidth8(lv) {
  const s0 = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const totalPx = s0.totalPixels || lv.totalPixels || 0;
  let beam = [s0], found = (totalPx > 0 && s0.eliminatedPixels >= totalPx) ? s0 : null;
  const maxSteps = (lv.totalBoxes || 1) + 1;
  for (let step = 0; step < maxSteps && beam.length && !found; step++) {
    const next = [];
    for (const s of beam) {
      for (const m of Sim.listMoves(s).filter(m => !m.blocked)) {
        const child = St.cloneState(s);
        if (!Sim.applyPick(child, m.r, m.c)) continue;
        if (child.eliminatedPixels >= totalPx) { found = child; break; }
        if (child.overflow || child.buffer.length > child.bufferLimit) continue;
        if (child.buffer.length >= child.bufferLimit && Sim.isDeadEnd(child)) continue;
        next.push(child);
      }
      if (found) break;
    }
    if (found) break;
    next.sort(better);
    const seen = new Set(), kept = [];
    for (const s of next) { const k = keyOf(s); if (seen.has(k)) continue; seen.add(k); kept.push(s); if (kept.length >= 8) break; }
    beam = kept;
  }
  return { solvable: !!found, steps: found ? found.steps : null };
}

// ==================== 守恒 ====================
function colorTotals(g) {
  const t = {};
  for (const row of g.spools) for (const c of row) { if (!isCar(c)) continue; if (!t[c.id]) t[c.id] = { px: 0, cars: 0 }; t[c.id].px += c.count; t[c.id].cars++; }
  return t;
}
function conservation(before, after) {
  const a = colorTotals(before), b = colorTotals(after);
  const colors = [...new Set([...Object.keys(a), ...Object.keys(b)])].map(Number).sort((x, y) => x - y);
  const rows = colors.map(c => ({ color: c, before: a[c] || { px: 0, cars: 0 }, after: b[c] || { px: 0, cars: 0 }, ok: (a[c] || {}).px === (b[c] || {}).px && (a[c] || {}).cars === (b[c] || {}).cars }));
  return { ok: rows.every(x => x.ok), totalBefore: rows.reduce((s, x) => s + x.before.px, 0), totalAfter: rows.reduce((s, x) => s + x.after.px, 0), colors: rows };
}

// ==================== 每色进度分位 ====================
function colorStats() {
  const lv = A.parseLevel(A.fromGameFormat(baseGame));
  const rnd = lcg(SEED), runs = [];
  for (let i = 0; i < 20; i++) runs.push(runOnce(lv, baseGame, null, rnd, false));
  runs.push(runOnce(lv, baseGame, null, null, true));
  // runOnce 不记录 first；这里单独跑一次记录 activation 的轻量函数
  const byColor = {};
  function lightRun(free) {
    let st = Sim.createState(lv, { useSlotStart: true, instantChain: false });
    const first = {};
    const rr = lcg(SEED + 1);
    while (!isWon(st)) {
      const p = st.eliminatedPixels / st.totalPixels;
      const ms = Sim.listMoves(st).filter(m => !m.blocked);
      for (const m of ms) { const k = m.r + ',' + m.c; if (first[k] == null) first[k] = p; }
      let pick = null;
      if (free) {
        const opts = [];
        for (const m of ms) { const t = St.cloneState(st); const e0 = t.eliminatedPixels, d0 = t.completedBoxes; if (!Sim.applyPick(t, m.r, m.c)) continue; const buf = t.buffer.length, debt = t.buffer.reduce((x, b) => x + (b.need - b.progress), 0); const nextM = isWon(t) ? 0 : Sim.listMoves(t).filter(x => !x.blocked).length; opts.push({ m, t, gain: t.eliminatedPixels - e0, buf, debt, dead: t.overflow || buf > t.bufferLimit || (buf >= t.bufferLimit && t.completedBoxes - d0 === 0) || (!isWon(t) && nextM === 0) }); }
        let best = null, bk = null; for (const o of opts) { const k = [o.dead ? 0 : 1, o.buf === 0 ? 1 : 0, o.gain, -o.buf, -o.debt, -o.m.r, -o.m.c]; if (!best || cmpArr(k, bk) > 0) { best = o; bk = k; } }
        if (!best) break; pick = best.t;
      } else {
        const idx = ms.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
        for (const k of idx) { const m = ms[k], t = St.cloneState(st); if (!Sim.applyPick(t, m.r, m.c)) continue; if (!isDead(t) || isWon(t)) { pick = t; break; } }
        if (!pick) break;
      }
      st = pick;
    }
    for (const k in first) { const [r, c] = k.split(',').map(Number); const cell = baseGame.spools[r][c]; if (!isCar(cell)) continue; (byColor[cell.id] = byColor[cell.id] || []).push(first[k]); }
  }
  for (let i = 0; i < 20; i++) lightRun(false);
  lightRun(true);
  const rows = Object.keys(byColor).map(Number).sort((a, b) => a - b).map(color => {
    const a = byColor[color];
    return { color, p10: r3(q(a, 0.10)), p50: r3(median(a)), p90: r3(q(a, 0.90)), samples: a.length, px: colorTotals(baseGame)[color] ? colorTotals(baseGame)[color].px : 0, cars: colorTotals(baseGame)[color] ? colorTotals(baseGame)[color].cars : 0 };
  });
  rows.sort((a, b) => a.p50 - b.p50);
  for (const r of rows) r.phase = r.p50 < 0.30 ? 'early' : (r.p50 < 0.60 ? 'mid' : 'late');
  return rows;
}

const COLORS = colorStats();
const colorInfo = {}; for (const c of COLORS) colorInfo[c.color] = c;

// ==================== 候选生成 ====================
const GID = maxChainId(baseGame) + 1;

function pairLabel(a, b) {
  const ca = baseGame.spools[a[0]][a[1]], cb = baseGame.spools[b[0]][b[1]];
  return `${a.join(',')}(${ca.id}/${ca.count})+${b.join(',')}(${cb.id}/${cb.count})`;
}
function buildPair(a, b) {
  const g = clone(baseGame);
  setChain(g.spools[a[0]][a[1]], GID); setChain(g.spools[b[0]][b[1]], GID);
  return g;
}
function buildSwap(key, target, late) {
  const g = clone(baseGame);
  const tmp = g.spools[late[0]][late[1]];
  g.spools[late[0]][late[1]] = g.spools[target[0]][target[1]];
  g.spools[target[0]][target[1]] = tmp;
  setChain(g.spools[key[0]][key[1]], GID);
  setChain(g.spools[target[0]][target[1]], GID);
  return g;
}

// 底座相邻：早期色 + 后期色（p50≥0.55，允许 4/15）
const baseCandidates = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const a = baseGame.spools[r][c]; if (!isCar(a) || isPipe(a)) continue;
  for (const [rr, cc] of [[r + 1, c], [r, c + 1]]) {
    if (rr >= ROWS || cc >= COLS) continue;
    const b = baseGame.spools[rr][cc]; if (!isCar(b) || isPipe(b)) continue;
    const pa = colorInfo[a.id] ? colorInfo[a.id].p50 : null, pb = colorInfo[b.id] ? colorInfo[b.id].p50 : null;
    if (pa == null || pb == null) continue;
    const earlyLate = (pa < 0.30 && pb >= 0.55) || (pb < 0.30 && pa >= 0.55);
    if (!earlyLate) continue;
    baseCandidates.push({ type: 'base', a: [r, c], b: [rr, cc], swaps: 0, swapDesc: 'none', key: pa < 0.30 ? [r, c] : [rr, cc], late: pa < 0.30 ? [rr, cc] : [r, c], game: buildPair([r, c], [rr, cc]) });
  }
}

// 换位候选：key 的 base free-first activation 在 0.20–0.55；late 车色 p50≥0.55
// 先用轻量 free 跑 base 得到每格 free activation
const baseFreeAct = (() => {
  const lv = A.parseLevel(A.fromGameFormat(baseGame));
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false }); const first = {};
  while (!isWon(s)) {
    const p = s.eliminatedPixels / s.totalPixels; const ms = Sim.listMoves(s).filter(m => !m.blocked);
    for (const m of ms) { const k = m.r + ',' + m.c; if (first[k] == null) first[k] = p; }
    const opts = [];
    for (const m of ms) { const t = St.cloneState(s); const e0 = t.eliminatedPixels, d0 = t.completedBoxes; if (!Sim.applyPick(t, m.r, m.c)) continue; const buf = t.buffer.length, debt = t.buffer.reduce((x, b) => x + (b.need - b.progress), 0); const nextM = isWon(t) ? 0 : Sim.listMoves(t).filter(x => !x.blocked).length; opts.push({ m, t, gain: t.eliminatedPixels - e0, buf, debt, dead: t.overflow || buf > t.bufferLimit || (buf >= t.bufferLimit && t.completedBoxes - d0 === 0) || (!isWon(t) && nextM === 0) }); }
    let best = null, bk = null; for (const o of opts) { const k = [o.dead ? 0 : 1, o.buf === 0 ? 1 : 0, o.gain, -o.buf, -o.debt, -o.m.r, -o.m.c]; if (!best || cmpArr(k, bk) > 0) { best = o; bk = k; } }
    if (!best) break; s = best.t;
  }
  return first;
})();

const lateCells = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const cell = baseGame.spools[r][c]; if (!isCar(cell) || !swappable(cell)) continue;
  const info = colorInfo[cell.id]; if (info && info.p50 >= 0.55) lateCells.push([r, c]);
}
const keyCells = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const cell = baseGame.spools[r][c]; if (!isCar(cell) || !swappable(cell)) continue;
  const info = colorInfo[cell.id]; if (!info || info.p50 >= 0.40) continue;
  const fa = baseFreeAct[r + ',' + c];
  if (fa == null || fa < 0.20 || fa > 0.55) continue;
  keyCells.push([r, c]);
}

const swapCandidates = [];
for (const key of keyCells) {
  for (const target of neighbors(key[0], key[1])) {
    const tc = baseGame.spools[target[0]][target[1]]; if (!swappable(tc)) continue;
    for (const late of lateCells) {
      if (late[0] === key[0] && late[1] === key[1]) continue;
      if (late[0] === target[0] && late[1] === target[1]) continue;
      const game = buildSwap(key, target, late);
      const lv = A.parseLevel(A.fromGameFormat(game));
      const F = runOnce(lv, game, GID, null, true);
      if (!F.took || F.open == null || F.open < W0 || F.open > W1) continue;
      swapCandidates.push({ type: 'swap', key, target, late, swaps: 1, swapDesc: `${late.join(',')}→${target.join(',')}`, game, quick: F });
    }
  }
}
swapCandidates.sort((a, b) => (b.quick.fill - a.quick.fill) || (Math.abs(a.quick.open - CENTER) - Math.abs(b.quick.open - CENTER)));
const shortlist = swapCandidates.slice(0, 999);

// ==================== 完整评估 ====================
function evaluateCandidate(c) {
  const game = c.game, lv = A.parseLevel(A.fromGameFormat(game));
  const F = runOnce(lv, game, GID, null, true);
  const rnd = lcg(SEED); const R = [];
  for (let i = 0; i < RUNS; i++) R.push(runOnce(lv, game, GID, rnd, false));
  const takers = R.filter(x => x.took);
  const keyCell = game.spools[c.key[0]][c.key[1]], lateCell = game.spools[c.target ? c.target[0] : c.late[0]][c.target ? c.target[1] : c.late[1]];
  const keyColor = keyCell.id, keyCap = keyCell.count, lateColor = lateCell.id, lateCap = lateCell.count;
  let keyReach = null, lateReach = null;
  if (F.openState) { keyReach = reachableCount(F.openState, keyColor); lateReach = keyColor === lateColor ? keyReach : reachableCount(F.openState, lateColor); }
  const cons = conservation(baseGame, game);
  const sol = solvableWidth8(lv);
  const keyInfo = colorInfo[keyColor] || {}, lateInfo = colorInfo[lateColor] || {};
  return {
    ...c, pair: c.type === 'base' ? pairLabel(c.a, c.b) : `${c.key.join(',')}(${keyColor}/${keyCap})+${c.target.join(',')}(${lateColor}/${lateCap})`,
    keyColor, keyCap, keyPhase: keyInfo.p50 == null ? null : (keyInfo.p50 < 0.30 ? 'early' : (keyInfo.p50 < 0.60 ? 'mid' : 'late')), keyP50: keyInfo.p50,
    lateColor, lateCap, latePhase: lateInfo.p50 == null ? null : (lateInfo.p50 < 0.30 ? 'early' : (lateInfo.p50 < 0.60 ? 'mid' : 'late')), lateP50: lateInfo.p50,
    keyReach, lateReach, lateHalf: lateCap / 2,
    keyFills: keyReach != null && keyReach >= keyCap,
    lateScarce: lateReach != null && lateReach < lateCap / 2,
    freeOpen: r3(F.open), freeFill: F.fill, freeTake: F.took, freeEntropy: r3(F.entropy),
    randOpenMed: r3(median(R.map(x => x.open).filter(v => v != null))),
    randFillMed: r3(median(takers.map(x => x.fill))),
    randTakeRate: r3(takers.length / R.length), winRate: r3(R.filter(x => x.won).length / R.length),
    solvable: sol.solvable, solSteps: sol.steps, conservation: cons.ok,
    peakBufferMed: r3(median(R.map(x => x.peak))), _game: game
  };
}
const full = [];
for (const c of baseCandidates) full.push(evaluateCandidate(c));
for (const c of shortlist) full.push(evaluateCandidate(c));

function score(r) {
  const openCloseness = Math.abs((r.freeOpen == null ? 2 : r.freeOpen) - CENTER);
  const randOpenOk = r.randOpenMed != null && r.randOpenMed >= W0 && r.randOpenMed <= W1;
  const strict = r.keyFills && r.lateScarce && r.freeOpen >= W0 && r.freeOpen <= W1 && randOpenOk && r.freeFill >= 2 && r.winRate >= 0.9 && r.freeEntropy >= 1.45 && r.solvable && r.conservation;
  const formal = r.freeOpen >= W0 && r.freeOpen <= W1 && randOpenOk && r.freeFill >= 2 && r.winRate >= 0.9 && r.freeEntropy >= 1.45 && r.solvable && r.conservation;
  return { strict, formal, openCloseness, randOpenOk };
}
for (const r of full) Object.assign(r, score(r));
const strictOK = full.filter(r => r.strict);
const formalOK = full.filter(r => r.formal);
function rank(a, b) {
  return (b.freeFill - a.freeFill) || (Math.abs(a.freeOpen - CENTER) - Math.abs(b.freeOpen - CENTER)) || (a.keyP50 - b.keyP50) || (b.randFillMed - a.randFillMed) || (b.freeEntropy - a.freeEntropy);
}
strictOK.sort(rank); formalOK.sort(rank);
const selected = strictOK[0] || formalOK[0] || null;
const allSorted = full.slice().sort((a, b) => (Number(b.strict) - Number(a.strict)) || (Number(b.formal) - Number(a.formal)) || rank(a, b));
const top5 = allSorted.slice(0, 5);

// ==================== 最终评估（30×3） ====================
function evalFinal(game) {
  const lv = A.parseLevel(A.fromGameFormat(game));
  const F = runOnce(lv, game, GID, null, true);
  const seeds = [];
  for (const seed of EVAL_SEEDS) {
    const rnd = lcg(seed); const R = [];
    for (let i = 0; i < EVAL_RUNS; i++) R.push(runOnce(lv, game, GID, rnd, false));
    const takers = R.filter(x => x.took);
    seeds.push({ seed, games: EVAL_RUNS, wins: R.filter(x => x.won).length, winRate: r3(R.filter(x => x.won).length / EVAL_RUNS), openMed: r3(median(R.map(x => x.open).filter(v => v != null))), fillMed: r3(median(takers.map(x => x.fill))), takeRate: r3(takers.length / EVAL_RUNS) });
  }
  return { skilled: { open: r3(F.open), fill: F.fill, took: F.took, won: F.won, entropy: r3(F.entropy) }, seeds };
}

let finalEval = null, baseEval = null, outLevel = null;
if (selected) {
  fs.mkdirSync(OUT, { recursive: true });
  outLevel = path.join(OUT, '关卡_ZC_23_gate3.json');
  fs.writeFileSync(outLevel, JSON.stringify(selected._game));
  finalEval = evalFinal(selected._game);
  const lv0 = A.parseLevel(A.fromGameFormat(baseGame));
  const F0 = runOnce(lv0, baseGame, GID, null, true);
  const seeds0 = [];
  for (const seed of EVAL_SEEDS) { const rnd = lcg(seed); const R = []; for (let i = 0; i < EVAL_RUNS; i++) R.push(runOnce(lv0, baseGame, GID, rnd, false)); seeds0.push({ seed, winRate: r3(R.filter(x => x.won).length / EVAL_RUNS) }); }
  baseEval = { skilled: { won: F0.won, entropy: r3(F0.entropy) }, seeds: seeds0 };
}

const conclusion = strictOK.length ? '中段有代价的门成立' : (formalOK.length ? '只有换位后才成立（数值目标成立；严格“钥匙吃满+代价稀缺”不成立）' : '这张图做不到');
const report = {
  tool: 'GateApply_v3', created: new Date().toISOString(), level: path.basename(LEVEL), output: outLevel,
  params: { runs: RUNS, seed: SEED, evalRuns: EVAL_RUNS, evalSeeds: EVAL_SEEDS, maxSwaps: MAX_SWAPS },
  colorStats: COLORS,
  counts: { baseCandidates: baseCandidates.length, swapCandidates: swapCandidates.length, shortlist: shortlist.length, fullEvaluated: full.length, strictOK: strictOK.length, formalOK: formalOK.length },
  rule: { window: [W0, W1], target: 'freeFill>=2; win>=0.9; entropy>=1.45; solvable; conservation', strictDesign: 'keyReach>=keyCap && lateReach<lateCap/2' },
  top5: top5.map(r => ({ pair: r.pair, type: r.type, swaps: r.swaps, swapDesc: r.swapDesc, keyColor: r.keyColor, keyCap: r.keyCap, keyPhase: r.keyPhase, keyP50: r.keyP50, keyReach: r.keyReach, keyFills: r.keyFills, lateColor: r.lateColor, lateCap: r.lateCap, latePhase: r.latePhase, lateP50: r.lateP50, lateReach: r.lateReach, lateScarce: r.lateScarce, freeFill: r.freeFill, randFillMed: r.randFillMed, freeOpen: r.freeOpen, randOpenMed: r.randOpenMed, randTakeRate: r.randTakeRate, winRate: r.winRate, entropy: r.freeEntropy, solvable: r.solvable, conservation: r.conservation, strict: r.strict, formal: r.formal })),
  selected: selected ? {
    pair: selected.pair, type: selected.type, swaps: selected.swaps, swapDesc: selected.swapDesc,
    key: selected.key, target: selected.target || selected.b, late: selected.late,
    keyColor: selected.keyColor, keyCap: selected.keyCap, keyPhase: selected.keyPhase, keyP50: selected.keyP50, keyReach: selected.keyReach, keyFills: selected.keyFills,
    lateColor: selected.lateColor, lateCap: selected.lateCap, latePhase: selected.latePhase, lateP50: selected.lateP50, lateReach: selected.lateReach, lateScarce: selected.lateScarce,
    freeFill: selected.freeFill, freeOpen: selected.freeOpen, freeEntropy: selected.freeEntropy, randFillMed: selected.randFillMed, randOpenMed: selected.randOpenMed, randTakeRate: selected.randTakeRate, winRate: selected.winRate,
    solvable: selected.solvable, conservation: selected.conservation, strict: selected.strict, formal: selected.formal,
    final: finalEval, base: baseEval
  } : null,
  conclusion,
  all: full.map(r => { const x = { ...r }; delete x._game; delete x.game; delete x.quick; return x; })
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'GateApply_v3.json'), JSON.stringify(report, null, 2));

const pct = x => x == null ? '—' : (100 * x).toFixed(1) + '%';
console.log(`[GateApply_v3] ${path.basename(LEVEL)}  base=${baseCandidates.length} swap=${swapCandidates.length} shortlist=${shortlist.length} strict=${strictOK.length} formal=${formalOK.length}`);
console.log('color stats:');
for (const c of COLORS) console.log(`  ${String(c.color).padStart(2)} ${c.phase.padEnd(5)} p10=${c.p10} p50=${c.p50} p90=${c.p90} ${c.px}px/${c.cars}辆`);
console.log('top5:');
for (const r of top5) console.log(`  ${r.pair}  ${r.type} swaps=${r.swaps}  key=${r.keyPhase}/p50=${r.keyP50} reach=${r.keyReach}/${r.keyCap}  late=${r.latePhase}/p50=${r.lateP50} reach=${r.lateReach}/${r.lateCap}  freeFill=${r.freeFill} open=${pct(r.freeOpen)}  randFill=${r.randFillMed} randOpen=${pct(r.randOpenMed)} take=${pct(r.randTakeRate)} win=${pct(r.winRate)} H=${r.freeEntropy}  strict=${r.strict} formal=${r.formal}`);
if (selected) {
  console.log(`selected: ${selected.pair} type=${selected.type} swaps=${selected.swaps} swap=${selected.swapDesc}`);
  console.log(`final: ${finalEval.seeds.map(s => `${s.seed}:win=${pct(s.winRate)},open=${pct(s.openMed)},fill=${s.fillMed},take=${pct(s.takeRate)}`).join('  ')}`);
  console.log(`skilled: open=${pct(finalEval.skilled.open)} fill=${finalEval.skilled.fill} H=${finalEval.skilled.entropy}`);
}
console.log(`conclusion: ${conclusion}`);
console.log(`report: ${path.join(OUT, 'GateApply_v3.json')}`);
