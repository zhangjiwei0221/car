#!/usr/bin/env node
'use strict';
/**
 * GateApply_v2 —— 产线 v5 / C1：ZC_23 “有代价的门” 全相邻对扫描（2026-11-12）
 *
 * 与 v1 的区别（按修正后的规则）：
 *   - 不预设钥匙 / 代价色；遍历盘上所有**正交相邻的车格对**（至少一个成员是门色 31）。
 *   - 对每个候选对：free-first（会玩）+ N 局随机玩家，量：
 *       chainFillSteps      拿到链组后，链组还占着暂存的**后续步数**（0 = 当步吃满离场）
 *       chainOpenProgress   会玩第一次能点该链的进度；随机玩家同指标的中位数
 *       takeRate            随机玩家真的拿该链的比例；会玩是否拿
 *       winRate / entropy   随机通关率；会玩路线逐 step 的选项熵（ChoiceSpace 同签名）
 *       solvable           宽度 8 束搜索能否找到通关路线
 *       conservation       逐色容量守恒
 *       reachableAtOpen    开门时，链组两种颜色在目标图上的“可达像素” vs 链组容量
 *   - 选门：先筛 winRate≥0.9、entropy≥1.45、守恒、可通关；再优先 chainFillSteps≥2；
 *     同分看随机 fill 中位、开门进度离 50–55% 的距离、熵。
 *   - 若没有任何候选 chainFillSteps≥2：**不加冰**（v1 已证伪），报告“做不到”+ 最接近的 5 个。
 *
 * 口径：loadSolver('corner')，useSlotStart:true，instantChain:false（AGENTS 红线 2）。
 * 只改 type/param（上链），不改任何 count / id / 目标图 / 其他障碍。
 *
 * 用法：
 *   node GateApply_v2.js <关卡.json> --out <目录> [--runs 30] [--seed 977]
 *        [--eval-runs 30] [--eval-seeds 977,4242,31337]
 *
 * 输出（--out 目录）：
 *   关卡_ZC_23_gate2.json     选中候选（若存在）
 *   GateApply_v2.json         全部候选 / top5 / 选中理由 / 改前改后数字
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
  console.error('用法: node GateApply_v2.js <关卡.json> --out <目录> [--runs 30] [--seed 977] [--eval-runs 30] [--eval-seeds 977,4242,31337]');
  process.exit(2);
}
const OUT = arg('--out', path.join(path.dirname(LEVEL), '23_gate2'));
const RUNS = Math.max(5, Number(arg('--runs', 30)) || 30);
const SEED = Number(arg('--seed', 977));
const EVAL_RUNS = Math.max(5, Number(arg('--eval-runs', 30)) || 30);
const EVAL_SEEDS = String(arg('--eval-seeds', '977,4242,31337'))
  .split(',').map(x => Number(x.trim())).filter(x => Number.isFinite(x));
const GATE_COLOR = 31;
const W0 = 0.50, W1 = 0.55, CENTER = (W0 + W1) / 2;

const baseGame = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
if (!baseGame || !Array.isArray(baseGame.spools)) { console.error('不是可识别的关卡 JSON（缺少 spools）'); process.exit(2); }
const ROWS = baseGame.spools.length, COLS = baseGame.spools[0].length;

// ==================== 基础 ====================
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) { if (!a || !a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function quantile(a, p) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.floor(p * (b.length - 1))))]; }
function r3(x) { return x == null ? null : +Number(x).toFixed(4); }
const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const typeList = (c) => Array.isArray(c.type) ? c.type : (c.type === 0 || c.type == null ? [] : [c.type]);
const chainOf = (c) => { const ts = typeList(c); const i = ts.indexOf(5); if (i < 0) return 0; return Array.isArray(c.param) ? (Number(c.param[i]) || 0) : (Number(c.param) || 0); };
function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }

// 上链：保留原有数字冰 / 问号（不删既有障碍）
function setChain(cell, gid) {
  const ts = typeList(cell);
  const ice = ts.indexOf(7), q = ts.indexOf(6);
  const nt = [5], np = [gid];
  if (ice >= 0) { nt.push(7); np.push(Array.isArray(cell.param) ? cell.param[ice] : cell.param); }
  if (q >= 0) { nt.push(6); np.push(0); }
  cell.type = nt.length === 1 ? 5 : nt;
  cell.param = np.length === 1 ? gid : np;
}
function maxChainId(game) {
  let m = 0;
  for (const row of game.spools) for (const c of row) { const g = chainOf(c); if (g > m) m = g; }
  return m;
}
function isCar(c) { return c && c.id > 0 && c.count > 0; }
function isPipe(c) { const ts = typeList(c); return ts.some(t => t >= 11 && t <= 14); }

// ==================== 可达像素计数（与 simulator.canConsumeReach 同思路） ====================
function reachableCount(s, color) {
  const rows = s.rows, cols = s.cols, blocks = s.blocks, elim = s.eliminated;
  const open = new Uint8Array(rows * cols), stack = [];
  const DIR = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const edge = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
    if (edge && elim[r][c]) { const id = r * cols + c; if (!open[id]) { open[id] = 1; stack.push(id); } }
  }
  while (stack.length) {
    const cur = stack.pop(), cr = (cur / cols) | 0, cc = cur % cols;
    for (const [dr, dc] of DIR) {
      const nr = cr + dr, nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const id = nr * cols + nc;
      if (open[id] || !elim[nr][nc]) continue;
      open[id] = 1; stack.push(id);
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
// random：PopulationSim_v1.runRandomNoStats 同口径；free：PressureBuild_v5.freePath 同口径。
// 额外记录：链组第一次可点进度、链组拿后占用暂存的后续步数、free 路线逐 step 熵。
function runOnce(lv, game, gid, rnd, free) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const chainCells = new Set();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (chainOf(game.spools[r][c]) === gid) chainCells.add(r + ',' + c);
  let gateOpen = null, gateState = null, took = false, fill = 0, fillDone = true, chainLinks = null;
  let peak = s.buffer.length, guard = 0;
  const sigs = [];
  const DIR = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  while (!isWon(s) && guard++ < 400) {
    const prog = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    let gateNow = false;
    for (const m of ms) if (chainCells.has(m.r + ',' + m.c)) { gateNow = true; if (gateOpen == null) { gateOpen = prog; gateState = St.cloneState(s); } }
    if (s.buffer.length > peak) peak = s.buffer.length;
    // 链组占用：上一 pick 后仍在 buffer 里的 link，每经过一个后续 pick 记 1 步
    if (chainLinks && !fillDone) {
      const live = chainLinks.filter(l => s.buffer.some(b => b.link === l));
      if (live.length) fill++;
      chainLinks = live.length ? live : null;
      if (!chainLinks) fillDone = true;
    }
    if (free) {
      // ChoiceSpace 同签名熵
      const keys = [];
      const evals = [];
      for (const m of ms) {
        const t = St.cloneState(s);
        const e0 = t.eliminatedPixels, d0 = t.completedBoxes;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        const gain = t.eliminatedPixels - e0;
        const bufAfter = t.buffer.length;
        const debtPx = t.buffer.reduce((x, b) => x + (b.need - b.progress), 0);
        const noMoves = t.eliminatedPixels < t.totalPixels && Sim.listMoves(t).filter(x => !x.blocked).length === 0;
        const dead = t.overflow || bufAfter > t.bufferLimit || (bufAfter >= t.bufferLimit && t.completedBoxes - d0 === 0) || noMoves;
        const nextM = t.eliminatedPixels >= t.totalPixels ? 0 : Sim.listMoves(t).filter(x => !x.blocked).length;
        const sig = [dead ? 1 : 0, Math.min(bufAfter, 6), bucket(debtPx), bucket(gain), Math.min(nextM, 10), t.completedBoxes - d0].join('|');
        keys.push(sig);
        evals.push({ m, t, gain, bufAfter, debtPx, dead, nextM });
      }
      sigs.push(entropy(keys));
      if (!evals.length) break;
      let best = null, bestKey = null;
      for (const o of evals) {
        const key = [o.dead ? 0 : 1, o.bufAfter === 0 ? 1 : 0, o.gain, -o.bufAfter, -o.debtPx, -o.m.r, -o.m.c];
        if (!best || cmpArr(key, bestKey) > 0) { best = o; bestKey = key; }
      }
      if (!best) break;
      const linksBefore = new Set(s.buffer.map(b => b.link).filter(Boolean));
      const t = best.t;
      trackChain(t, linksBefore, () => { took = true; });
      s = t;
    } else {
      const linksBefore = new Set(s.buffer.map(b => b.link).filter(Boolean));
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      let pick = null;
      for (const k of idx) {
        const m = ms[k];
        const t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!isDead(t) || isWon(t)) { pick = t; break; }
      }
      if (!pick) break;
      trackChain(pick, linksBefore, () => { took = true; });
      s = pick;
    }
    function trackChain(state, linksBefore, onTake) {
      const lp = state.lastPick;
      if (lp && lp.isChain && lp.chain === gid) {
        onTake();
        const newLinks = [...new Set(state.buffer.map(b => b.link).filter(l => l && !linksBefore.has(l)))];
        chainLinks = newLinks.length ? newLinks : null;
        fillDone = !chainLinks;
        fill = 0;
      }
    }
  }
  return {
    won: isWon(s), maxProgress: Math.max(...(sigs.length ? [s.eliminatedPixels / s.totalPixels] : [0])),
    gateOpen, gateState, took, fill, peak, entropy: mean(sigs),
    steps: guard
  };
}
function bucket(x) { if (x <= 0) return 0; if (x <= 2) return 1; if (x <= 5) return 2; if (x <= 10) return 3; if (x <= 20) return 4; return 5; }
function entropy(keys) { if (!keys.length) return 0; const c = {}; for (const k of keys) c[k] = (c[k] || 0) + 1; let h = 0; for (const k in c) { const p = c[k] / keys.length; h -= p * Math.log(p); } return h; }

// ==================== Solvable width 8（与 Solvable_v1 同口径） ====================
function keyOf(s) {
  let k = '';
  for (const row of s.cells) for (const c of row) k += (c && c.t === 'box') ? '1' : '0';
  let ice = '';
  if (s.numice) for (const kk of Object.keys(s.numice).sort()) ice += kk + ':' + s.numice[kk].remaining + ';';
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
        const px = child.eliminatedPixels || 0;
        if (px >= totalPx) { found = child; break; }
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
  for (const row of g.spools) for (const c of row) {
    if (!c || c.id <= 0 || !(c.count > 0)) continue;
    if (!t[c.id]) t[c.id] = { px: 0, cars: 0 };
    t[c.id].px += c.count; t[c.id].cars++;
  }
  return t;
}
function conservation(before, after) {
  const a = colorTotals(before), b = colorTotals(after);
  const colors = [...new Set([...Object.keys(a), ...Object.keys(b)])].map(Number).sort((x, y) => x - y);
  const rows = colors.map(c => ({ color: c, before: a[c] || { px: 0, cars: 0 }, after: b[c] || { px: 0, cars: 0 }, ok: (a[c] || {}).px === (b[c] || {}).px && (a[c] || {}).cars === (b[c] || {}).cars }));
  return { ok: rows.every(x => x.ok), totalBefore: rows.reduce((s, x) => s + x.before.px, 0), totalAfter: rows.reduce((s, x) => s + x.after.px, 0), colors: rows };
}

// ==================== 枚举相邻对 ====================
const pairs = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const a = baseGame.spools[r][c];
  if (!isCar(a) || isPipe(a)) continue;
  for (const [dr, dc] of [[1, 0], [0, 1]]) {
    const rr = r + dr, cc = c + dc;
    if (rr >= ROWS || cc >= COLS) continue;
    const b = baseGame.spools[rr][cc];
    if (!isCar(b) || isPipe(b)) continue;
    if (a.id !== GATE_COLOR && b.id !== GATE_COLOR) continue;
    pairs.push([[r, c], [rr, cc]]);
  }
}

const GID = maxChainId(baseGame) + 1;
const rows = [];
function build(a, b) {
  const g = clone(baseGame);
  setChain(g.spools[a[0]][a[1]], GID);
  setChain(g.spools[b[0]][b[1]], GID);
  return g;
}
function pairLabel(a, b) {
  const ca = baseGame.spools[a[0]][a[1]], cb = baseGame.spools[b[0]][b[1]];
  return `${a.join(',')}(${ca.id}/${ca.count})+${b.join(',')}(${cb.id}/${cb.count})`;
}

for (const [a, b] of pairs) {
  const cand = build(a, b);
  const lv = A.parseLevel(A.fromGameFormat(cand));
  const F = runOnce(lv, cand, GID, null, true);
  const rnd = lcg(SEED);
  const R = [];
  for (let i = 0; i < RUNS; i++) R.push(runOnce(lv, cand, GID, rnd, false));
  const takers = R.filter(x => x.took);
  const rFills = takers.map(x => x.fill);
  const rOpens = R.map(x => x.gateOpen).filter(v => v != null);
  const colorA = baseGame.spools[a[0]][a[1]].id, colorB = baseGame.spools[b[0]][b[1]].id;
  const capA = baseGame.spools[a[0]][a[1]].count, capB = baseGame.spools[b[0]][b[1]].count;
  let reach = null;
  if (F.gateState) {
    const ra = reachableCount(F.gateState, colorA);
    const rb = colorA === colorB ? ra : reachableCount(F.gateState, colorB);
    reach = { atProgress: r3(F.gateOpen), [colorA]: { reachable: ra, capacity: capA + (colorA === colorB ? capB : 0) } };
    if (colorA !== colorB) reach[colorB] = { reachable: rb, capacity: capB };
  }
  const cons = conservation(baseGame, cand);
  const sol = solvableWidth8(lv);
  rows.push({
    pair: pairLabel(a, b), a: a.join(','), b: b.join(','), colorA, capA, colorB, capB,
    freeOpen: r3(F.gateOpen), freeTake: F.took, freeFill: F.fill, freeWon: F.won,
    randOpenMed: r3(median(rOpens)), randTakeRate: r3(R.filter(x => x.took).length / R.length),
    randFillMed: r3(median(rFills)), winRate: r3(R.filter(x => x.won).length / R.length),
    entropy: r3(F.entropy), solvable: sol.solvable, solSteps: sol.steps, conservation: cons.ok,
    peakBufferMed: r3(median(R.map(x => x.peak))), reach, _cand: cand
  });
}

// ==================== 选门 ====================
function fillPrimary(r) { return r.freeTake ? r.freeFill : (r.randFillMed == null ? -1 : r.randFillMed); }
function rank(a, b) {
  const fa = fillPrimary(a), fb = fillPrimary(b);
  const ca = fa >= 2 ? 1 : 0, cb = fb >= 2 ? 1 : 0;
  return (cb - ca) ||
    (fb - fa) ||
    ((b.randFillMed == null ? -1 : b.randFillMed) - (a.randFillMed == null ? -1 : a.randFillMed)) ||
    (Math.abs((a.freeOpen == null ? 2 : a.freeOpen) - CENTER) - Math.abs((b.freeOpen == null ? 2 : b.freeOpen) - CENTER)) ||
    (a.entropy - b.entropy) * -1 ||
    (b.winRate - a.winRate);
}
const eligible = rows.filter(r => r.conservation && r.solvable && r.winRate >= 0.9 && r.entropy >= 1.45);
const withCost = eligible.filter(r => fillPrimary(r) >= 2);
withCost.sort(rank);
const allSorted = rows.slice().sort(rank);
const selected = withCost[0] || null;
const top5 = allSorted.slice(0, 5);

// ==================== 最终评估（选中候选 30×3） ====================
function evalFinal(cand) {
  const lv = A.parseLevel(A.fromGameFormat(cand));
  const F = runOnce(lv, cand, GID, null, true);
  const seeds = [];
  for (const seed of EVAL_SEEDS) {
    const rnd = lcg(seed);
    const R = [];
    for (let i = 0; i < EVAL_RUNS; i++) R.push(runOnce(lv, cand, GID, rnd, false));
    const takers = R.filter(x => x.took);
    seeds.push({
      seed, games: EVAL_RUNS, wins: R.filter(x => x.won).length, winRate: r3(R.filter(x => x.won).length / EVAL_RUNS),
      openMed: r3(median(R.map(x => x.gateOpen).filter(v => v != null))),
      fillMed: r3(median(takers.map(x => x.fill))), takeRate: r3(takers.length / EVAL_RUNS),
      solved: R.filter(x => x.won).length
    });
  }
  return { skilled: { open: r3(F.gateOpen), fill: F.fill, took: F.took, won: F.won, entropy: r3(F.entropy) }, seeds };
}

let finalEval = null, baseEval = null, outLevel = null;
if (selected) {
  const cand = selected._cand;
  fs.mkdirSync(OUT, { recursive: true });
  outLevel = path.join(OUT, '关卡_ZC_23_gate2.json');
  fs.writeFileSync(outLevel, JSON.stringify(cand));
  finalEval = evalFinal(cand);
  // 底座同样跑一遍（无门）
  const lv0 = A.parseLevel(A.fromGameFormat(baseGame));
  const F0 = runOnce(lv0, baseGame, GID, null, true);
  const seeds0 = [];
  for (const seed of EVAL_SEEDS) {
    const rnd = lcg(seed); const R = [];
    for (let i = 0; i < EVAL_RUNS; i++) R.push(runOnce(lv0, baseGame, GID, rnd, false));
    seeds0.push({ seed, wins: R.filter(x => x.won).length, winRate: r3(R.filter(x => x.won).length / EVAL_RUNS) });
  }
  baseEval = { skilled: { won: F0.won, entropy: r3(F0.entropy) }, seeds: seeds0 };
}

const conclusion = selected ? '有代价的门（chainFillSteps≥2 且 win≥0.9）' : '做不到';
const report = {
  tool: 'GateApply_v2',
  created: new Date().toISOString(),
  level: path.basename(LEVEL), output: outLevel,
  params: { runs: RUNS, seed: SEED, evalRuns: EVAL_RUNS, evalSeeds: EVAL_SEEDS },
  pairsEnumerated: pairs.length,
  rule: {
    gateColor: GATE_COLOR, window: [W0, W1],
    constraints: { winRate: 0.9, entropy: 1.45, conservation: true, solvable: true },
    priority: 'chainFillSteps >= 2 (free-first; fallback random median)',
    fillDefinition: '拿到链组后，链组仍占着暂存的后续步数；0 = 当步吃满离场'
  },
  top5: top5.map(r => ({
    pair: r.pair, freeFill: r.freeFill, randFillMed: r.randFillMed,
    freeOpen: r.freeOpen, randOpenMed: r.randOpenMed,
    randTakeRate: r.randTakeRate, winRate: r.winRate, entropy: r.entropy,
    solvable: r.solvable, conservation: r.conservation, reach: r.reach
  })),
  selected: selected ? {
    pair: selected.pair, a: selected.a, b: selected.b, colorA: selected.colorA, capA: selected.capA, colorB: selected.colorB, capB: selected.capB,
    freeFill: selected.freeFill, randFillMed: selected.randFillMed,
    freeOpen: selected.freeOpen, randOpenMed: selected.randOpenMed,
    randTakeRate: selected.randTakeRate, winRate: selected.winRate, entropy: selected.entropy,
    solvable: selected.solvable, conservation: selected.conservation, reach: selected.reach,
    final: finalEval, base: baseEval
  } : null,
  conclusion,
  maxFillQuestion: {
    maxFreeFill: Math.max(...rows.map(r => r.freeTake ? r.freeFill : -1)),
    maxFreeFillPair: rows.slice().sort((a, b) => (b.freeTake ? b.freeFill : -1) - (a.freeTake ? a.freeFill : -1))[0] ? rows.slice().sort((a, b) => (b.freeTake ? b.freeFill : -1) - (a.freeTake ? a.freeFill : -1))[0].pair : null,
    note: '如果最大值只能到 1，说明所有中间进度对的颜色在开门时都够吃；本盘不是这样（见 top5）。'
  },
  all: rows.map(r => { const x = { ...r }; delete x._cand; return x; })
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'GateApply_v2.json'), JSON.stringify(report, null, 2));

// ==================== 控制台 ====================
const pct = x => x == null ? '—' : (100 * x).toFixed(1) + '%';
console.log(`[GateApply_v2] ${path.basename(LEVEL)}  pairs=${pairs.length}  → ${outLevel || '(no output)'}`);
console.log('top5:');
for (const r of top5) console.log(`  ${r.pair}  fill=${r.freeFill}/${r.randFillMed}  open=${pct(r.freeOpen)}/${pct(r.randOpenMed)}  take=${pct(r.randTakeRate)}  win=${pct(r.winRate)}  H=${r.entropy}  solv=${r.solvable}  cons=${r.conservation}`);
if (selected) {
  console.log(`selected: ${selected.pair}  fill=${selected.freeFill}  freeOpen=${pct(selected.freeOpen)}  take=${pct(selected.randTakeRate)}  win=${pct(selected.winRate)}  H=${selected.entropy}`);
  console.log(`final seeds: ${finalEval.seeds.map(s => `${s.seed}:win=${pct(s.winRate)},open=${pct(s.openMed)},fill=${s.fillMed},take=${pct(s.takeRate)}`).join('  ')}`);
  console.log(`skilled: open=${pct(finalEval.skilled.open)} fill=${finalEval.skilled.fill} took=${finalEval.skilled.took} won=${finalEval.skilled.won} H=${finalEval.skilled.entropy}`);
} else {
  console.log('结论: 做不到（无 chainFillSteps≥2 且满足 win/entropy/守恒/可通关 的候选）');
}
console.log(`report: ${path.join(OUT, 'GateApply_v2.json')}`);
