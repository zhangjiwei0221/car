#!/usr/bin/env node
'use strict';
/**
 * GateApply_v1 —— 产线 v5 / C1：按 B3 卡点卡片在安全版上造一个“门”（2026-11-12）
 *
 * 做四件事（只新增障碍，不改容量 / 颜色 / 目标图）：
 *   1) 在底座上跑 N 局随机玩家 + 1 条会玩（free-first）路线，记录每个车格
 *      **第一次变成可点**时的进度（eliminatedPixels / totalPixels），取中位数。
 *   2) 选钥匙车：同门色、容量最接近卡片、底座 activationProgress 落在窗口附近。
 *      选代价车：价格色、与钥匙正交相邻；若不相邻，允许 1–2 次换位
 *      （只换普通 / 冰 / 问号车，不碰锁链 / 管道 / 黑块），换完重算 activationProgress 再选。
 *   3) 两者设成同一锁链组：type:[5], param:<盘上未用过的组号>。
 *   4) 卡片要求“门后 3–4 辆”时，若门打开后同门色剩余车不足 3 辆，
 *      给 1–2 辆“同门色、暴露早于窗口”的车加数字冰（type:7）。
 *      冰值 = 从该车暴露到窗口结束（w1）大约要拿走的**球数**中位数（锁链一步 2/3 球就扣 2/3）。
 *
 * 重要口径：
 *   - 一切玩家模拟都用 loadSolver('corner') + useSlotStart:true + instantChain:false，
 *     与造关 / 验收一致（AGENTS 红线 2）。
 *   - 车的 count 一律不动；换位只交换整辆车；冰 / 锁链只改 type/param。
 *   - 门激活窗口 = 锁链组里**任一成员第一次可点**时的进度中位数。
 *   - 覆盖率 / 通过率按 README §8.6：分母是“到达卡点窗口（maxProgress ≥ 窗口起点）”的局。
 *
 * 用法：
 *   node GateApply_v1.js <关卡.json> --card <卡片.json> [--gate 1]
 *        [--runs 20] [--seed 977] [--out <目录>]
 *        [--eval-runs 30] [--eval-seeds 977,4242,31337]
 *
 * 输出（--out 目录）：
 *   关卡_<名>_gate<id>.json   加门后的关卡（原文件不动）
 *   GateApply_gate<id>.json   全部选择理由、冰值算法、守恒、逐种子指标
 *
 * 退出码：0 = 已产出（不代表验收通过）；2 = 参数 / 输入错误。
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
  console.error('用法: node GateApply_v1.js <关卡.json> --card <卡片.json> [--gate 1] [--runs 20] [--seed 977] [--out <目录>] [--eval-runs 30] [--eval-seeds 977,4242,31337]');
  process.exit(2);
}
const CARD_FILE = arg('--card', '');
if (!CARD_FILE) { console.error('缺少 --card <卡片.json>'); process.exit(2); }
const GATE_ID = Number(arg('--gate', 1));
const RUNS = Math.max(2, Number(arg('--runs', 20)) || 20);
const SEED = Number(arg('--seed', 977));
const OUT = arg('--out', path.join(path.dirname(LEVEL), 'C1_建造'));
// 策划可钉死某个邻格 / 代价车（自动搜索被随机路线噪声带偏时用；不改变“同色、容量最接近”的选车规则）
const FORCE_TARGET = arg('--force-target', ''); // "r,c"
const FORCE_PRICE = arg('--force-price', '');   // "r,c"
const NO_ICE = has('--no-ice');                 // 卡片的后门供给只做诊断、不加冰（冰会压选择熵）
const sameCell = (a, b) => a && b && a.r === b.r && a.c === b.c;
const EVAL_RUNS = Math.max(2, Number(arg('--eval-runs', 30)) || 30);
const EVAL_SEEDS = String(arg('--eval-seeds', '977,4242,31337'))
  .split(',').map(x => Number(x.trim())).filter(x => Number.isFinite(x));
if (!EVAL_SEEDS.length) { console.error('--eval-seeds 解析为空'); process.exit(2); }

const card = JSON.parse(fs.readFileSync(CARD_FILE, 'utf8'));
const gate = (card.gates || []).find(g => Number(g.gateId) === GATE_ID);
if (!gate) { console.error(`卡片里没有 gateId=${GATE_ID}`); process.exit(2); }
const W0 = Number(gate.progressWindow[0]), W1 = Number(gate.progressWindow[1]);
const GATE_COLOR = Number(gate.gateColor);
const KEY_CAP = Number(gate.door && gate.door.keyCar && gate.door.keyCar.capacity);
const PRICE_COLOR = Number(gate.door && gate.door.priceCar && gate.door.priceCar.color);
const PRICE_CAP = Number(gate.door && gate.door.priceCar && gate.door.priceCar.capacity);
const BEHIND_HINT = String((gate.door && gate.door.heldBehindDoor) || '');
const WANT_BEHIND = /3\s*[–-]\s*4|3\s*辆|4\s*辆/.test(BEHIND_HINT) ? [3, 4] : null;

const baseGame = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
if (!baseGame || !Array.isArray(baseGame.spools)) { console.error('不是可识别的关卡 JSON（缺少 spools）'); process.exit(2); }
const ROWS = baseGame.spools.length, COLS = baseGame.spools[0].length;

// ==================== 通用 ====================
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) {
  if (!a || !a.length) return null;
  const b = a.slice().sort((x, y) => x - y), n = b.length;
  return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function quantile(a, p) {
  if (!a.length) return null;
  const b = a.slice().sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.max(0, Math.floor(p * (b.length - 1))))];
}
function r3(x) { return x == null ? null : +Number(x).toFixed(4); }
const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const typeList = (cell) => Array.isArray(cell.type) ? cell.type : (cell.type === 0 || cell.type == null ? [] : [cell.type]);
const cellChain = (cell) => {
  const ts = typeList(cell);
  const i = ts.indexOf(5);
  if (i < 0) return 0;
  return Array.isArray(cell.param) ? (Number(cell.param[i]) || 0) : (Number(cell.param) || 0);
};
function isGateCell(cell, gid) { return gid != null && cellChain(cell) === gid; }

// 可换位：普通 / 冰 / 问号；不碰锁链、管道、黑块、空格
function swappable(cell) {
  if (!cell || !cell.count || cell.id <= 0) return false;
  const ts = typeList(cell);
  if (ts.includes(5)) return false;
  if (ts.some(t => t >= 11 && t <= 14)) return false;
  return true;
}
function isPlain(cell) {
  if (!cell || !cell.count || cell.id <= 0) return false;
  const ts = typeList(cell);
  return ts.length === 0 || (ts.length === 1 && ts[0] === 0);
}
function neighborCells(r, c) {
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .filter(([rr, cc]) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS);
}

// ==================== 玩家模拟（与 PopulationSim_v1 的 random / free-first 同口径） ====================
// random：合法车洗牌 → 第一个“当步不死”的；free-first：dead / 吃完 / 吃得多 / 债少（PressureBuild_v5.freePath）
function randomRun(lv, game, gid, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const first = {}, steps = [];
  let gateFirst = null, tookGate = false, peak = s.buffer.length, guard = 0;
  while (!isWon(s) && guard++ < 400) {
    const prog = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    let gateNow = false;
    for (const m of ms) {
      const k = m.r + ',' + m.c;
      if (first[k] == null) first[k] = prog;
      if (isGateCell(game.spools[m.r][m.c], gid)) { gateNow = true; if (gateFirst == null) gateFirst = prog; }
    }
    if (s.buffer.length > peak) peak = s.buffer.length;
    steps.push({ prog, buf: s.buffer.length, r: null, c: null, balls: 0, gateNow });
    const idx = ms.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
    let pick = null, pk = null;
    for (const k of idx) {
      const m = ms[k];
      const t = St.cloneState(s);
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      if (!isDead(t) || isWon(t)) { pick = t; pk = m; break; }
    }
    if (!pick) break;
    const lp = pick.lastPick || null;
    const balls = lp && Array.isArray(lp.picked) ? lp.picked.length : 1;
    const st = steps[steps.length - 1];
    st.r = pk.r; st.c = pk.c; st.balls = balls;
    if (lp && lp.isChain && lp.chain === gid) tookGate = true;
    s = pick;
  }
  return finishRun(s, steps, first, gateFirst, tookGate, peak);
}

function freeRun(lv, game, gid) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const first = {}, steps = [];
  let gateFirst = null, tookGate = false, peak = s.buffer.length, guard = 0;
  while (!isWon(s) && guard++ < 400) {
    const prog = s.eliminatedPixels / s.totalPixels;
    const opts = [];
    let gateNow = false;
    for (const m of Sim.listMoves(s)) {
      if (m.blocked) continue;
      const k = m.r + ',' + m.c;
      if (first[k] == null) first[k] = prog;
      if (isGateCell(game.spools[m.r][m.c], gid)) { gateNow = true; if (gateFirst == null) gateFirst = prog; }
      const t = St.cloneState(s);
      const e0 = t.eliminatedPixels, d0 = t.completedBoxes;
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      const bufAfter = t.buffer.length;
      const debtPx = t.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
      const nextM = isWon(t) ? 0 : Sim.listMoves(t).filter(x => !x.blocked).length;
      const dead = t.overflow || bufAfter > t.bufferLimit || (bufAfter >= t.bufferLimit && t.completedBoxes - d0 === 0) || (!isWon(t) && nextM === 0);
      opts.push({ m, t, gain: t.eliminatedPixels - e0, dead, bufAfter, debtPx, nextM });
    }
    if (s.buffer.length > peak) peak = s.buffer.length;
    steps.push({ prog, buf: s.buffer.length, r: null, c: null, balls: 0, gateNow });
    if (!opts.length) break;
    let best = null, bestKey = null;
    for (const o of opts) {
      const key = [o.dead ? 0 : 1, o.bufAfter === 0 ? 1 : 0, o.gain, -o.bufAfter, -o.debtPx, -o.m.r, -o.m.c];
      if (!best || cmpArr(key, bestKey) > 0) { best = o; bestKey = key; }
    }
    if (!best) break;
    const lp = best.t.lastPick || null;
    const balls = lp && Array.isArray(lp.picked) ? lp.picked.length : 1;
    const st = steps[steps.length - 1];
    st.r = best.m.r; st.c = best.m.c; st.balls = balls;
    if (lp && lp.isChain && lp.chain === gid) tookGate = true;
    const done0 = s.completedBoxes;
    s = best.t;
    if (isWon(s)) break;
    // freePath 的死亡判据（与 PressureBuild_v5 一致）
    if (s.overflow || s.buffer.length > s.bufferLimit || (s.buffer.length >= s.bufferLimit && s.completedBoxes === done0) || Sim.listMoves(s).filter(x => !x.blocked).length === 0) break;
  }
  return finishRun(s, steps, first, gateFirst, tookGate, peak);
}

function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }

function finishRun(s, steps, first, gateFirst, tookGate, peak) {
  const maxProgress = Math.max(...steps.map(x => x.prog), s.eliminatedPixels / s.totalPixels);
  return {
    won: isWon(s), maxProgress, deathProgress: isWon(s) ? null : s.eliminatedPixels / s.totalPixels,
    first, steps, gateFirst, tookGate, peak, bufferLimit: s.bufferLimit
  };
}

function batch(game, gid, runs, seed, opts) {
  const lv = A.parseLevel(A.fromGameFormat(game));
  const rnd = lcg(seed);
  const out = [];
  for (let i = 0; i < runs; i++) out.push(randomRun(lv, game, gid, rnd));
  const skilled = opts && opts.skilled ? freeRun(lv, game, gid) : null;
  return { runs: out, skilled, lv };
}

function aggregate(batchRes) {
  const runs = batchRes.runs;
  const wins = runs.filter(x => x.won).length;
  const reached = runs.filter(x => x.maxProgress >= W0);
  const cov = reached.length ? reached.filter(x => x.steps.some(st => st.prog >= W0 - 0.05 && st.prog <= W1 + 0.05 && st.buf >= 3)).length / reached.length : null;
  const covAll = runs.length ? runs.filter(x => x.steps.some(st => st.prog >= W0 - 0.05 && st.prog <= W1 + 0.05 && st.buf >= 3)).length / runs.length : null;
  const pass = reached.length ? reached.filter(x => x.maxProgress >= W1 + 0.10).length / reached.length : null;
  const take = runs.length ? runs.filter(x => x.tookGate).length / runs.length : null;
  const actVals = runs.map(x => x.gateFirst).filter(v => v != null);
  const widths = runs.map(x => {
    let run = 0, best = 0;
    for (const st of x.steps) { if (st.gateNow) { run++; if (run > best) best = run; } else run = 0; }
    return best;
  });
  const maxProgs = runs.map(x => x.maxProgress);
  const loserProgs = runs.filter(x => !x.won).map(x => x.deathProgress).filter(v => v != null);
  return {
    games: runs.length, wins, winRate: runs.length ? wins / runs.length : null,
    activationN: actVals.length, activationMedian: median(actVals), activationP25: quantile(actVals, 0.25), activationP75: quantile(actVals, 0.75),
    coverage: cov, coverageAllRuns: covAll, passRate: pass, takeRate: take,
    reachedWindow: reached.length, windowWidthMedian: median(widths), windowWidthP25: quantile(widths, 0.25),
    peakBufferMedian: median(runs.map(x => x.peak)),
    maxProgressMedian: median(maxProgs), maxProgressP10: quantile(maxProgs, 0.10), maxProgressP90: quantile(maxProgs, 0.90),
    deathProgressMedian: median(loserProgs)
  };
}

function cellActivationMedians(batchRes) {
  const agg = {};
  for (const run of batchRes.runs) for (const k in run.first) (agg[k] = agg[k] || []).push(run.first[k]);
  if (batchRes.skilled) for (const k in batchRes.skilled.first) (agg[k] = agg[k] || []).push(batchRes.skilled.first[k]);
  const out = {};
  for (const k in agg) out[k] = median(agg[k]);
  return out;
}

// 从“该格第一次可点”到窗口结束（w1）之间拿走的球数（中位数）。锁链一步拿走 2/3 个球，冰按球数倒计时。
function ballsFromExposureToWindow(batchRes, r, c) {
  const key = r + ',' + c;
  const vals = [];
  const all = batchRes.runs.concat(batchRes.skilled ? [batchRes.skilled] : []);
  for (const run of all) {
    if (run.first[key] == null) continue;
    let sum = 0, started = false;
    for (const st of run.steps) {
      if (st.prog >= run.first[key] - 1e-9) started = true;
      if (started && st.prog <= W1 + 1e-9) sum += st.balls || 0;
      if (st.prog > W1 + 1e-9) break;
    }
    vals.push(sum);
  }
  return { median: median(vals), n: vals.length, values: vals };
}

// ==================== 守恒 / 结构校验 ====================
function colorTotals(game) {
  const t = {};
  for (const row of game.spools) for (const cell of row) {
    if (!cell || cell.id <= 0) continue;
    if (!t[cell.id]) t[cell.id] = { px: 0, cars: 0 };
    t[cell.id].px += cell.count || 0;
    t[cell.id].cars++;
  }
  return t;
}
function conservationReport(before, after) {
  const a = colorTotals(before), b = colorTotals(after);
  const colors = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).map(Number).sort((x, y) => x - y);
  const rows = colors.map(c => ({
    color: c,
    pxBefore: a[c] ? a[c].px : 0, pxAfter: b[c] ? b[c].px : 0,
    carsBefore: a[c] ? a[c].cars : 0, carsAfter: b[c] ? b[c].cars : 0,
    ok: (a[c] ? a[c].px : 0) === (b[c] ? b[c].px : 0) && (a[c] ? a[c].cars : 0) === (b[c] ? b[c].cars : 0)
  }));
  const totalBefore = rows.reduce((s, x) => s + x.pxBefore, 0);
  const totalAfter = rows.reduce((s, x) => s + x.pxAfter, 0);
  return {
    ok: rows.every(x => x.ok) && totalBefore === totalAfter,
    totalPxBefore: totalBefore, totalPxAfter: totalAfter,
    colors: rows
  };
}

// ==================== 选门 ====================
function maxChainId(game) {
  let m = 0;
  for (const row of game.spools) for (const cell of row) {
    const gid = cellChain(cell);
    if (gid > m) m = gid;
  }
  return m;
}

const baseBatch = batch(baseGame, null, RUNS, SEED, { skilled: true });
const baseAct = cellActivationMedians(baseBatch);
const baseAgg = aggregate(baseBatch);
const baseSkilledMeta = baseBatch.skilled ? {
  won: baseBatch.skilled.won, maxProgress: baseBatch.skilled.maxProgress,
  peakBuffer: baseBatch.skilled.peak, activationMedian: baseBatch.skilled.gateFirst
} : null;

// 钥匙候选：同门色、可换位；容量差优先，普通车优先，底座 activation 靠近窗口中心
const keyCands = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const cell = baseGame.spools[r][c];
  if (!cell || cell.id !== GATE_COLOR || !swappable(cell)) continue;
  const act = baseAct[r + ',' + c] == null ? null : baseAct[r + ',' + c];
  keyCands.push({ r, c, count: cell.count, plain: isPlain(cell), act, capDiff: Math.abs(cell.count - KEY_CAP) });
}
keyCands.sort((a, b) => (a.capDiff - b.capDiff) || (Number(b.plain) - Number(a.plain)) ||
  (Math.abs((a.act == null ? 2 : a.act) - (W0 + W1) / 2) - Math.abs((b.act == null ? 2 : b.act) - (W0 + W1) / 2)));

// 代价候选：价格色、可换位；容量差优先
const priceCands = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const cell = baseGame.spools[r][c];
  if (!cell || cell.id !== PRICE_COLOR || !swappable(cell)) continue;
  priceCands.push({ r, c, count: cell.count, plain: isPlain(cell), capDiff: Math.abs(cell.count - PRICE_CAP) });
}
priceCands.sort((a, b) => (a.capDiff - b.capDiff) || (Number(b.plain) - Number(a.plain)));

const GID = maxChainId(baseGame) + 1;
const CENTER = (W0 + W1) / 2;
const ACT_LO = W0 - 0.05, ACT_HI = W1 + 0.05;

function makeDoor(game, key, target, price) {
  const g = clone(game);
  // 换位：只交换整辆车（count/颜色/type 一起走）
  if (!(price.r === target.r && price.c === target.c)) {
    const tmp = g.spools[price.r][price.c];
    g.spools[price.r][price.c] = g.spools[target.r][target.c];
    g.spools[target.r][target.c] = tmp;
  }
  // 门：钥匙 + 代价同一锁链组；（换位后钥匙位置不变）
  g.spools[key.r][key.c].type = [5];
  g.spools[key.r][key.c].param = GID;
  g.spools[target.r][target.c].type = [5];
  g.spools[target.r][target.c].param = GID;
  return g;
}

const search = [];
function parseCell(s) {
  if (!s) return null;
  const [r, c] = String(s).split(',').map(Number);
  return Number.isFinite(r) && Number.isFinite(c) ? { r, c } : null;
}
const FORCE_T = parseCell(FORCE_TARGET), FORCE_P = parseCell(FORCE_PRICE);
// 选门搜索用两个种子（默认 977 + 4242），每个 RUNS 局；最终评估仍是 3 种子 × EVAL_RUNS。
// 单种子 30 局仍会把“整局路线依赖”的候选排错（实测同候选中位数差 5–10pp）。
const SEARCH_SEEDS = [SEED];
for (const s of EVAL_SEEDS) if (!SEARCH_SEEDS.includes(s)) { SEARCH_SEEDS.push(s); break; }
function quickEval(cand) {
  const runs = [];
  for (const s of SEARCH_SEEDS) runs.push(...batch(cand, GID, RUNS, s, { skilled: false }).runs);
  return aggregate({ runs, skilled: null });
}
const keyPool = keyCands.filter(x => x.plain).length ? keyCands.filter(x => x.plain) : keyCands;
const pricePool = priceCands.filter(x => x.plain).length ? priceCands.filter(x => x.plain) : priceCands;
for (const key of keyPool) {
  const nbrs = neighborCells(key.r, key.c).filter(([tr, tc]) => {
    const t = baseGame.spools[tr][tc];
    if (FORCE_T && !(tr === FORCE_T.r && tc === FORCE_T.c)) return false;
    return t && swappable(t) && t.id !== GATE_COLOR;
  });
  const plainNbrs = nbrs.filter(([tr, tc]) => isPlain(baseGame.spools[tr][tc]));
  for (const [tr, tc] of (plainNbrs.length ? plainNbrs : nbrs)) {
    const target = baseGame.spools[tr][tc];
    if (!target || !swappable(target)) continue;
    if (target.id === GATE_COLOR) continue; // 不把门色往外挪，保留门外/门后供给
    // 已经相邻的价格车：无需换位
    const direct = target.id === PRICE_COLOR ? [{ r: tr, c: tc, count: target.count, capDiff: Math.abs(target.count - PRICE_CAP), direct: true }] : pricePool.map(p => ({ ...p, direct: false }));
    for (const price of direct) {
      if (FORCE_P && !(price.r === FORCE_P.r && price.c === FORCE_P.c)) continue;
      if (!price.direct && price.r === tr && price.c === tc) continue;
      const cand = makeDoor(baseGame, key, { r: tr, c: tc }, price);
      const quick = quickEval(cand);
      const inWindow = quick.activationMedian != null && quick.activationMedian >= ACT_LO && quick.activationMedian <= ACT_HI;
      search.push({
        key: `${key.r},${key.c}`, keyCount: key.count, keyCapDiff: key.capDiff, keyBaseAct: r3(key.act), keyPlain: key.plain,
        target: `${tr},${tc}`, targetColor: target.id, targetCount: target.count, targetPlain: isPlain(target),
        price: `${price.r},${price.c}`, priceCount: price.count, priceCapDiff: price.capDiff, swaps: price.direct ? 0 : 1,
        gateActivation: r3(quick.activationMedian), activationP25: r3(quick.activationP25), activationP75: r3(quick.activationP75),
        winRate: r3(quick.winRate), coverage: r3(quick.coverage),
        inWindow,
        _cand: cand
      });
    }
  }
}
const valid = search.filter(x => x.inWindow && x.winRate != null && x.winRate >= 0.9);
function searchRank(a, b) {
  // 稳定性罚项：p25 太低说明一部分玩家在窗口前就把门点开了（中位数被少数局拉进窗口）
  const instab = x => 0.3 * Math.max(0, 0.45 - (x.activationP25 == null ? 0 : x.activationP25));
  return (a.keyCapDiff - b.keyCapDiff) ||
    (a.priceCapDiff - b.priceCapDiff) ||
    ((Math.abs(a.gateActivation - CENTER) + instab(a)) - (Math.abs(b.gateActivation - CENTER) + instab(b))) ||
    (a.swaps - b.swaps) ||
    (b.winRate - a.winRate);
}
valid.sort(searchRank);
const near = search.slice().sort((a, b) => Math.abs(a.gateActivation - CENTER) - Math.abs(b.gateActivation - CENTER));
const chosen = valid[0] || near[0] || null;
if (!chosen) { console.error('找不到任何可用的钥匙 / 代价组合（盘上没有同色可换位车？）'); process.exit(2); }

let game = chosen._cand;
let gateGid = GID;
// 去掉内部字段，报告用
for (const x of search) delete x._cand;

// ==================== 门后 3–4 辆：不足才加冰 ====================
const iceLog = { decision: '', wantBehind: WANT_BEHIND, additions: [], evidence: [] };
function measureBehind(g) {
  const b = batch(g, gateGid, RUNS, SEED, { skilled: true });
  const agg = aggregate(b);
  const acts = cellActivationMedians(b);
  const doorAct = agg.activationMedian;
  const behind = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const cell = g.spools[r][c];
    if (!cell || cell.id !== GATE_COLOR) continue;
    if (r === chosen.key.split(',')[0] * 1 && c === chosen.key.split(',')[1] * 1) continue;
    const act = acts[r + ',' + c];
    if (act != null && doorAct != null && act > doorAct + 0.005) behind.push({ r, c, act: +act.toFixed(3), count: cell.count });
  }
  return { batch: b, agg, acts, doorAct, behind };
}
let behindInfo = WANT_BEHIND ? measureBehind(game) : null;
if (WANT_BEHIND && NO_ICE) {
  iceLog.decision = '--no-ice: 只诊断门后供给，不加冰';
  if (behindInfo) iceLog.evidence.push({ stage: 'no-ice', doorActivation: r3(behindInfo.doorAct), behind: behindInfo.behind, behindPx: behindInfo.behind.reduce((s, x) => s + x.count, 0) });
} else if (WANT_BEHIND) {
  iceLog.evidence.push({ stage: 'before-ice', doorActivation: r3(behindInfo.doorAct), behind: behindInfo.behind, behindPx: behindInfo.behind.reduce((s, x) => s + x.count, 0) });
  let tries = 0;
  while (behindInfo.behind.length < WANT_BEHIND[0] && tries < 2) {
    // 候选：同门色、普通车、暴露早于窗口、不是钥匙、未结冰/未上链
    const cands = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = game.spools[r][c];
      if (!cell || cell.id !== GATE_COLOR || !isPlain(cell)) continue;
      if (r + ',' + c === chosen.key) continue;
      const act = behindInfo.acts[r + ',' + c];
      if (act == null || act >= W0) continue;
      const est = ballsFromExposureToWindow(behindInfo.batch, r, c);
      if (est.median == null) continue;
      cands.push({ r, c, act, value: Math.max(1, Math.round(est.median)), est });
    }
    // 优先冰“暴露最早”的车：把更多门外供给推到门后；同样早的再看容量
    cands.sort((a, b) => (a.act - b.act) || (b.count - a.count));
    let bestIce = null;
    for (const cand of cands.slice(0, 4)) {
      const g2 = clone(game);
      g2.spools[cand.r][cand.c].type = [7];
      g2.spools[cand.r][cand.c].param = cand.value;
      const m2 = measureBehind(g2);
      const q = aggregate(batch(g2, gateGid, 15, SEED, { skilled: false }));
      const ok = q.winRate >= 0.9 && q.activationMedian != null && q.activationMedian >= ACT_LO && q.activationMedian <= ACT_HI;
      const rec = {
        cell: `${cand.r},${cand.c}`, count: game.spools[cand.r][cand.c].count,
        exposureActivation: r3(cand.act), iceValue: cand.value, estimateMedianBalls: r3(cand.est.median), estimateN: cand.est.n,
        after: { gateActivation: r3(q.activationMedian), winRate: r3(q.winRate), behind: m2.behind.length, behindPx: m2.behind.reduce((s, x) => s + x.count, 0) },
        accepted: ok, _g: g2, _m: m2
      };
      if (ok && (!bestIce || (m2.behind.length > bestIce._m.behind.length) ||
        (m2.behind.length === bestIce._m.behind.length && Math.abs(q.activationMedian - CENTER) < Math.abs(bestIce.after.gateActivation - CENTER)))) bestIce = rec;
    }
    if (!bestIce) { iceLog.decision = 'no valid ice candidate kept gate window / win'; break; }
    game = bestIce._g; behindInfo = bestIce._m;
    delete bestIce._g; delete bestIce._m;
    iceLog.additions.push(bestIce);
    tries++;
  }
  iceLog.decision = game === chosen._cand ? 'behind-door supply already within card range; no ice added' :
    `added ${iceLog.additions.length} ice car(s) to bring behind-door supply to card range`;
  if (!iceLog.additions.length && behindInfo) iceLog.decision = 'behind-door supply within card range; no ice added';
}
// 清理 chosen 内部字段
delete chosen._cand;

// ==================== 最终评估 ====================
const outName = `关卡_${path.basename(LEVEL).replace(/\.json$/i, '')}_gate${GATE_ID}.json`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, outName), JSON.stringify(game));

const evalSeeds = [];
for (const seed of EVAL_SEEDS) {
  const b = batch(game, gateGid, EVAL_RUNS, seed, { skilled: true });
  evalSeeds.push({ seed, ...aggregate(b), skilled: b.skilled ? { won: b.skilled.won, maxProgress: r3(b.skilled.maxProgress), peakBuffer: b.skilled.peak, gateActivation: r3(b.skilled.gateFirst) } : null });
}
const allRuns = [];
for (const seed of EVAL_SEEDS) allRuns.push(batch(game, gateGid, EVAL_RUNS, seed, { skilled: false }));
const overall = aggregate({ runs: allRuns.flatMap(x => x.runs), skilled: null });

const baseEvalSeeds = [];
for (const seed of EVAL_SEEDS) {
  const b = batch(baseGame, null, EVAL_RUNS, seed, { skilled: true });
  baseEvalSeeds.push({ seed, ...aggregate(b), skilled: b.skilled ? { won: b.skilled.won, maxProgress: r3(b.skilled.maxProgress), peakBuffer: b.skilled.peak } : null });
}
// 重新汇总底座（aggregate 需要 runs 数组）
const baseAll = [];
for (const seed of EVAL_SEEDS) baseAll.push(batch(baseGame, null, EVAL_RUNS, seed, { skilled: false }));
const baseOverall2 = aggregate({ runs: baseAll.flatMap(x => x.runs), skilled: null });

const conservation = conservationReport(baseGame, game);
const blocksUnchanged = JSON.stringify(baseGame.blocks) === JSON.stringify(game.blocks);
const cellsCount = (g) => g.spools.reduce((s, row) => s + row.filter(x => x && x.id > 0 && x.count > 0).length, 0);

// 最终（90 局）口径的门后供给：门打开后仍可点的同门色车（不含钥匙）
const finalActs = cellActivationMedians({ runs: allRuns.flatMap(x => x.runs), skilled: null });
const finalBehindCells = [];
if (overall.activationMedian != null) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const cell = game.spools[r][c];
    if (!cell || cell.id !== GATE_COLOR) continue;
    if (`${r},${c}` === chosen.key) continue;
    const act = finalActs[r + ',' + c];
    if (act != null && act > overall.activationMedian + 0.005) finalBehindCells.push({ cell: `${r},${c}`, count: cell.count, activation: r3(act) });
  }
}
const gateBehind = {
  doorActivation: r3(overall.activationMedian),
  cars: finalBehindCells.length,
  px: finalBehindCells.reduce((s, x) => s + x.count, 0),
  cells: finalBehindCells
};
const finalInWindow = overall.activationMedian != null && overall.activationMedian >= 0.45 && overall.activationMedian <= 0.60;

const acceptance = {
  solvable: null, // 由外部 Solvable_v1 判定，写进说明
  conservation: conservation.ok,
  blocksUnchanged,
  openingCells: null, // 由 ArlCheck / 外部工具判定
  randomWinRate: r3(overall.winRate),
  choiceEntropy: null, // 由外部 ChoiceSpaceCheck_v1 判定
  gateActivationMedian: r3(overall.activationMedian),
  gateWindowInWindow: finalInWindow,
  gateBehindCars: gateBehind.cars,
  gateBehindPx: gateBehind.px,
  coverage: r3(overall.coverage),
  passRate: r3(overall.passRate),
  thresholds: {
    randomWinRate: 0.9, choiceEntropy: 1.45,
    gateActivation: [0.45, 0.60], coverage: 0.70, passRate: 0.85
  }
};
acceptance.winPass = overall.winRate != null && overall.winRate >= 0.9;
acceptance.activationPass = overall.activationMedian != null && overall.activationMedian >= 0.45 && overall.activationMedian <= 0.60;
acceptance.coveragePass = overall.coverage != null && overall.coverage >= 0.7;
acceptance.passRatePass = overall.passRate != null && overall.passRate >= 0.85;

const report = {
  tool: 'GateApply_v1',
  created: new Date().toISOString(),
  level: path.basename(LEVEL),
  card: path.basename(CARD_FILE),
  gateId: GATE_ID,
  params: { runs: RUNS, seed: SEED, searchSeeds: SEARCH_SEEDS, evalRuns: EVAL_RUNS, evalSeeds: EVAL_SEEDS },
  window: [W0, W1], gateColor: GATE_COLOR, keyCapTarget: KEY_CAP, priceColor: PRICE_COLOR, priceCapTarget: PRICE_CAP,
  newChainGroup: gateGid,
  base: { aggregate: baseAgg, skilled: baseSkilledMeta },
  selection: {
    keyCandidatesRanked: keyCands.map(x => ({ cell: `${x.r},${x.c}`, count: x.count, plain: x.plain, baseActivation: r3(x.act), capDiff: x.capDiff })),
    priceCandidatesRanked: priceCands.map(x => ({ cell: `${x.r},${x.c}`, count: x.count, plain: x.plain, capDiff: x.capDiff })),
    chosen: { ...chosen, quickInWindow: chosen.inWindow },
    validCount: valid.length,
    searchTop: valid.slice(0, 8).concat(search.filter(x => !x.inWindow).slice(0, 5))
  },
  ice: iceLog,
  conservation,
  finalGate: {
    activationMedian: r3(overall.activationMedian), activationP25: r3(overall.activationP25), activationP75: r3(overall.activationP75),
    inWindow: finalInWindow, behind: gateBehind,
    note: 'finalGate 是 90 局（3 种子 × 30）口径；selection.chosen.quickInWindow 是 40 局搜索口径，两者可能不同。'
  },
  evaluation: { seeds: evalSeeds, overall },
  baselineEvaluation: { seeds: baseEvalSeeds, overall: baseOverall2 },
  acceptance,
  note: '门激活窗口 / 覆盖率 / 通过率均由随机玩家模拟估计（GateApply 自己算），不是强搜索；Solvable/ChoiceSpace/LayoutScore/ArlCheck 由外部工具复核。'
};
const reportFile = path.join(OUT, `GateApply_gate${GATE_ID}.json`);
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

// ==================== 控制台摘要 ====================
const pct = x => x == null ? '—' : (100 * x).toFixed(1) + '%';
console.log(`[GateApply_v1] ${path.basename(LEVEL)} → ${path.join(OUT, outName)}`);
console.log(`key=${chosen.key}(${chosen.keyCount}) price=${chosen.price}(${chosen.priceCount}) → target=${chosen.target}(was ${chosen.targetColor}/${chosen.targetCount}) swaps=${chosen.swaps} group=${gateGid}`);
console.log(`gate act median=${pct(overall.activationMedian)} (p25=${pct(overall.activationP25)} p75=${pct(overall.activationP75)})  win=${pct(overall.winRate)}  cov=${pct(overall.coverage)}  pass=${pct(overall.passRate)}  take=${pct(overall.takeRate)}  width=${overall.windowWidthMedian}  behind=${gateBehind.cars}辆/${gateBehind.px}px`);
console.log(`baseline win=${pct(baseOverall2.winRate)}  peak=${baseOverall2.peakBufferMedian}  maxProgress=${pct(baseOverall2.maxProgressMedian)}`);
console.log(`conservation=${conservation.ok} blocksUnchanged=${blocksUnchanged} cars=${cellsCount(baseGame)}→${cellsCount(game)}`);
console.log(`acceptance: win=${acceptance.winPass} activation=${acceptance.activationPass} coverage=${acceptance.coveragePass} pass=${acceptance.passRatePass}`);
console.log(`report: ${reportFile}`);
process.exit(0);
