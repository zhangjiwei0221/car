#!/usr/bin/env node
'use strict';
/**
 * 交叠构建器 v719（第3步·收敛版）
 * 只动“车的顺序 + 同色容量 + 链/冰”，不动目标图与切法。
 *
 * 目标函数（按优先级）：
 *   1) 空窗总步数（两次债务句之间压力<3 的步数）最小
 *   2) at4（页面口径停在4的步数）最大
 *   3) run4（最长连续4）最大
 * 约束：峰值≤4、不用道具可通关、每个组≥20、容量守恒、CLI 可解（仅终局校验）。
 *
 * 移动类型：
 *   capswap  —— 同色两辆非链车的容量互换（等价于重分配）
 *   posswap  —— 两辆非链车交换位置（改变取车顺序）
 *   chain    —— 相邻两辆非链车成链
 *   ice      —— 非链车加数字冰（param 可选）
 *
 * 用法：
 *   node OverlapBuild_v719.js <关卡.json> --out 结果.json [--rounds 6] [--samples 40]
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const REF = (() => { const i = process.argv.indexOf('--ref'); return i > 0 ? process.argv[i + 1] : 'ring'; })();
const A = B.loadSolver(REF);

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith('--'));
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg('--out', '');
const ROUNDS = Number(arg('--rounds', 6));
const SAMPLES = Number(arg('--samples', 40));
const MIN_AT4 = Number(arg('--min-at4', 0));
let NEW_ALLOW = [];
const GUIDE = Number(arg('--guide-color', 0));   // 要求第 1 步必须是这个颜色（引导）
const GUIDE_STEPS = Number(arg('--guide-steps', 0));  // 前 K 步只允许引导色
const NO_EARLY = Number(arg('--no-early', 0));
const W_RUN4 = Number(arg('--w-run4', 5));   // 奖励最长连续 >=4 的步数（默认 5）
const OBJ = String(arg('--obj', 'low'));   // low=原目标(减少低压段) | at4=最大化 at4   // 目标里奖励最长连续 >=4
const MODE = String(arg('--mode', 'b')).toLowerCase();   // b=瞬时连锁（默认） / a=四边入口        // 前 K 步不许到 buffer>=4（避免前期卡点）
const ALLOW = String(arg('--allow-colors', '')).split(',').map(Number).filter(n => n > 0);
NEW_ALLOW = ALLOW.length ? ALLOW : (GUIDE > 0 ? [GUIDE] : []);
if (!file) { console.error('用法: node OverlapBuild_v719.js <关卡.json> --out 结果.json'); process.exit(1); }

const base = B.readJson(file);

// 【--lock-subject】主体锁：容量转移/换位/成链只能在同一个主体（象限）内发生。
// 前提：目标图按象限用互不重叠的颜色（四色系图）；否则这些颜色跨象限，约束对它们不生效。
const LOCK_SUBJECT = argv.includes('--lock-subject');
const GATE = argv.includes('--gate');
const PROTECT = new Set(String(arg('--protect-colors', '')).split(',').map(Number).filter(n => n > 0));  // 不许动的车（如外框壳）
const SHELL = String(arg('--shell-colors', '')).split(',').map(Number).filter(n => n > 0);   // 外框壳色（按开口顺序）
const MIN_GAP = Number(arg('--min-shell-gap', 0));
const BAN_EARLY4 = argv.includes('--ban-early4');
const BUFTH = Number(arg('--buf-threshold', 4));   // 高压线（默认 4）   // 前 20% 不许出现 buffer=4   // 相邻两次开壳至少隔几手（0=不管）          // 评分前先按主体装闸门（数字冰），直接优化要交付的版本
const QMAP = new Map();
if (LOCK_SUBJECT || GATE) {
  const blk = base.blocks || [], H = blk.length, W = H ? blk[0].length : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = blk[y][x], q = (y < H / 2 ? 0 : 2) + (x < W / 2 ? 0 : 1);
    if (!QMAP.has(c)) QMAP.set(c, new Set());
    QMAP.get(c).add(q);
  }
  const multi = [...QMAP.values()].filter(s => s.size > 1).length;
  if (multi) console.error(`[lock-subject] 警告：${multi} 个颜色跨象限，约束对它们不生效`);
}
const quadOfId = id => { const s = QMAP.get(id); return (s && s.size === 1) ? [...s][0] : -1; };
const sameQuad = (a, b) => quadOfId(a.id) !== -1 && quadOfId(a.id) === quadOfId(b.id);
const prot = cell => PROTECT.size > 0 && PROTECT.has(cell && cell.id);

// 【--gate】把后三个主体的车冻到「前序主体车数累计」个盒子，返回新对象（不动搜索态）
function applyGates(g) {
  if (!GATE) return g;
  const h = JSON.parse(JSON.stringify(g));
  const cnt = [0, 0, 0, 0];
  for (const row of h.spools) for (const s of row) {
    if (!s || !(s.id > 0)) continue;
    const q = quadOfId(s.id); if (q >= 0) cnt[q]++;
  }
  const gate = []; let acc = 0;
  for (let q = 0; q < 4; q++) { gate[q] = acc; acc += cnt[q]; }
  for (const row of h.spools) for (const s of row) {
    if (!s || !(s.id > 0)) continue;
    const q = quadOfId(s.id); if (q <= 0) continue;
    const t = Array.isArray(s.type) ? s.type : [s.type || 0];
    const ps = Array.isArray(s.param) ? s.param.slice() : [s.param];
    if (t.includes(5)) s.type = [5, 7], s.param = [ps[t.indexOf(5)], gate[q]];
    else s.type = 7, s.param = gate[q];
  }
  return h;
}

function evalLevel(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: MODE !== 'a' });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let run4 = 0, cur = 0, at4 = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }
  // 空窗总步数
  const cls = buf.map(v => v >= 4 ? 'H' : v >= 2 ? 'M' : 'L');
  const beats = []; let i = 0;
  while (i < buf.length) { let j = i; while (j + 1 < buf.length && cls[j + 1] === cls[i]) j++; beats.push({ k: cls[i], from: i + 1, to: j + 1 }); i = j + 1; }
  let gapTotal = 0, gapMax = 0;
  for (let k = 0; k < beats.length; k++) {
    if (beats[k].k !== 'H') continue;
    let m = k + 1; while (m < beats.length && beats[m].k !== 'H') m++;
    if (m >= beats.length) break;
    let low = 0;
    for (let s2 = beats[k].to + 1; s2 <= beats[m].from - 1; s2++) if (buf[s2 - 1] < 3) low++;
    if (low >= 2) { gapTotal += low; gapMax = Math.max(gapMax, low); }
  }
  // 全程低压步数：整个路线里 buffer<3 的步数（越少=释放段越短）
  let lowTotal = 0;
  for (let s5 = 0; s5 < buf.length; s5++) if (buf[s5] < 3) lowTotal++;
  // 最长连续低压段（释放段长度）——按“无压段≤2步”的目标直接惩罚
  let lowRun = 0, curLow = 0;
  for (let s6 = 0; s6 < buf.length; s6++) { if (buf[s6] < 3) { curLow++; lowRun = Math.max(lowRun, curLow); } else curLow = 0; }
  // 前导释放段：第一笔债（buf>=4）之前，压力<3 的步数（本次新增，按棋盘语言口径）
  const firstHigh = buf.findIndex(v => v >= 4);
  let leadFree = 0;
  if (firstHigh > 0) for (let s4 = 0; s4 < firstHigh; s4++) if (buf[s4] < 3) leadFree++;
  // 尾段空窗：最后 25% 步里压力<3 的个数
  const tailFrom = Math.max(0, Math.floor(buf.length * 0.75));
  let tailFree = 0;
  for (let s3 = tailFrom; s3 < buf.length; s3++) if (buf[s3] < 3) tailFree++;
  // 引导检查：第 1 步取的颜色
  const firstColor = (o.pickOrder && o.pickOrder[0]) ? o.pickOrder[0].color : null;
  const firstK = (o.pickOrder || []).slice(0, GUIDE_STEPS).map(p => p.color);
  const earlyHigh = buf.slice(0, NO_EARLY).some(v => v >= 4);
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, gapTotal, gapMax, tailFree, leadFree, lowTotal, lowRun, firstColor, firstK, earlyHigh, steps: buf.length, itemUses: o.itemUses || 0 };
}
function cliOK(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.solveInstantChain(lv);
  return !!(o && o.completed);
}
const isPlain = (cell) => { const t = cell && (Array.isArray(cell.type) ? cell.type : [cell.type || 0]); return cell && cell.id > 0 && t.every(x => x === 0 || x === null); };

const R = base.spools.length, C = base.spools[0].length;
const plainCells = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (isPlain(base.spools[r][c])) plainCells.push([r, c]);

let rnd = 20261028;
const rand = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };
const pick = a => a[Math.floor(rand() * a.length)];

function neighbors(r, c) {
  const out = [];
  for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nc >= 0 && nr < R && nc < C) out.push([nr, nc]);
  }
  return out;
}
function applyMove(g, mv) {
  const h = JSON.parse(JSON.stringify(g));
  if (mv.type === 'capswap') {
    const [a, b] = mv.cells;
    const ca = h.spools[a[0]][a[1]], cb = h.spools[b[0]][b[1]];
    if (ca.id !== cb.id) return null;
    const t = ca.count; ca.count = cb.count; cb.count = t;
    if (ca.count < 20 || cb.count < 20 || ca.count > 40 || cb.count > 40) return null;
    return h;
  }
  if (mv.type === 'posswap') {
    const [a, b] = mv.cells;
    const ca = h.spools[a[0]][a[1]], cb = h.spools[b[0]][b[1]];
    const id = ca.id, cnt = ca.count;
    ca.id = cb.id; ca.count = cb.count; cb.id = id; cb.count = cnt;
    return h;
  }
  if (mv.type === 'memberswap') {
    const [a, b] = mv.cells;
    const ca = h.spools[a[0]][a[1]], cb = h.spools[b[0]][b[1]];
    if (ca.id === cb.id) return null;
    const id = ca.id, cnt = ca.count;
    ca.id = cb.id; ca.count = cb.count; cb.id = id; cb.count = cnt;
    return h;
  }
  if (mv.type === 'capmove') {
    const [a, b] = mv.cells;
    const ca = h.spools[a[0]][a[1]], cb = h.spools[b[0]][b[1]];
    if (ca.id !== cb.id) return null;
    const d = mv.delta || 2;
    if (ca.count - d < 20 || cb.count + d > 40) return null;
    ca.count -= d; cb.count += d;
    return h;
  }
  if (mv.type === 'chain') {
    // 每条新链用独立组号，避免两次成链共用 777 导致“4 个格子一组”的非法链
    let maxChain = 0;
    for (const row of h.spools) for (const cell of row) {
      const t = cell.type;
      const ts = Array.isArray(t) ? t : [t || 0];
      if (ts.includes(5)) {
        const ps = Array.isArray(cell.param) ? cell.param : [cell.param];
        const v = Number(ps[ts.indexOf(5)]);
        if (Number.isFinite(v) && v > maxChain) maxChain = v;
      }
    }
    const cid = maxChain + 1;
    for (const [r, c] of mv.cells) {
      const cell = h.spools[r][c];
      if (!isPlain(cell)) return null;
      cell.type = 5; cell.param = cid;
    }
    return h;
  }
  if (mv.type === 'ice') {
    const [r, c] = mv.cells[0];
    const cell = h.spools[r][c];
    const t = cell.type; const ts = Array.isArray(t) ? t : [t];
    if (!ts.every(x => x === 0 || x === null)) return null;
    const ps = Array.isArray(cell.param) ? cell.param : [cell.param];
    cell.type = ts.filter(x => x !== 0).concat([7]);
    cell.param = ps.filter((_, i) => ts[i] !== 0).concat([mv.param]);
    return h;
  }
  return null;
}
function candidateMoves(g) {
  const moves = [];
  const plain = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (isPlain(g.spools[r][c])) plain.push([r, c]);
  // 同色容量互换
  for (let i = 0; i < plain.length; i++) for (let j = i + 1; j < plain.length; j++) {
    const a = plain[i], b = plain[j];
    if (g.spools[a[0]][a[1]].id !== g.spools[b[0]][b[1]].id) continue;
    if (g.spools[a[0]][a[1]].count === g.spools[b[0]][b[1]].count) continue;
    if (prot(g.spools[a[0]][a[1]]) || prot(g.spools[b[0]][b[1]])) continue;
    moves.push({ type: 'capswap', cells: [a, b] });
  }
  // 位置互换（随机抽样）
  const swaps = [];
  for (let k = 0; k < SAMPLES; k++) {
    const a = pick(plain), b = pick(plain);
    if (a[0] === b[0] && a[1] === b[1]) continue;
    if (g.spools[a[0]][a[1]].id === g.spools[b[0]][b[1]].id) continue;
    if (LOCK_SUBJECT && !sameQuad(g.spools[a[0]][a[1]], g.spools[b[0]][b[1]])) continue;
    if (prot(g.spools[a[0]][a[1]]) || prot(g.spools[b[0]][b[1]])) continue;
    swaps.push({ type: 'posswap', cells: [a, b] });
  }
  moves.push(...swaps);
  const chainCells0 = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const cell = g.spools[r][c];
    if (!cell || !(cell.id > 0)) continue;
    const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
    if (t.includes(5)) chainCells0.push([r, c]);
  }
  // 换成员：链组成员与任意非同色普通车交换“颜色+容量”（链组改吃另一种颜色）
  for (const a of chainCells0) {
    const colorA = g.spools[a[0]][a[1]].id;
    for (const b of plain) {
      const cellB = g.spools[b[0]][b[1]];
      if (cellB.id === colorA) continue;
      if (LOCK_SUBJECT && !sameQuad(g.spools[a[0]][a[1]], cellB)) continue;
      if (prot(g.spools[a[0]][a[1]]) || prot(cellB)) continue;
      moves.push({ type: 'memberswap', cells: [a, b] });
    }
  }
  // 缩小链组成员：把容量转移给同色其它车（加速释放）
  const chainCells = chainCells0;
  // 同色容量转移（任意两辆非链车，双向；用来把“末段那辆”的容量抬过剩余像素）
  for (let i = 0; i < plain.length; i++) for (let j = i + 1; j < plain.length; j++) {
    const a = plain[i], b = plain[j];
    if (g.spools[a[0]][a[1]].id !== g.spools[b[0]][b[1]].id) continue;
    if (prot(g.spools[a[0]][a[1]]) || prot(g.spools[b[0]][b[1]])) continue;
    for (const d of [2, 4, 6, 8]) {
      moves.push({ type: 'capmove', cells: [a, b], delta: d });
      moves.push({ type: 'capmove', cells: [b, a], delta: d });
    }
  }
  // 相邻成链
  for (const [r, c] of plain) for (const [nr, nc] of neighbors(r, c)) {
    if (!isPlain(g.spools[nr][nc])) continue;
    if (r > nr || (r === nr && c > nc)) continue;
    if (LOCK_SUBJECT && !sameQuad(g.spools[r][c], g.spools[nr][nc])) continue;
    if (prot(g.spools[r][c]) || prot(g.spools[nr][nc])) continue;
    moves.push({ type: 'chain', cells: [[r, c], [nr, nc]], tag: moves.length });
  }
  // 三连（合法：2–3 格正交相邻），用来做更硬的组债务
  for (let r = 0; r < R; r++) for (let c = 0; c + 2 < C; c++) {
    const trio = [[r, c], [r, c + 1], [r, c + 2]];
    if (!trio.every(([y, x]) => isPlain(base.spools[y][x]))) continue;
    if (LOCK_SUBJECT && new Set(trio.map(([y, x]) => quadOfId(base.spools[y][x].id))).size !== 1) continue;
    if (trio.some(([y, x]) => prot(base.spools[y][x]))) continue;
    moves.push({ type: 'chain', cells: trio });
  }
  for (let r = 0; r + 2 < R; r++) for (let c = 0; c < C; c++) {
    const trio = [[r, c], [r + 1, c], [r + 2, c]];
    if (!trio.every(([y, x]) => isPlain(base.spools[y][x]))) continue;
    if (LOCK_SUBJECT && new Set(trio.map(([y, x]) => quadOfId(base.spools[y][x].id))).size !== 1) continue;
    if (trio.some(([y, x]) => prot(base.spools[y][x]))) continue;
    moves.push({ type: 'chain', cells: trio });
  }
  // 加冰（少量）
  for (let k = 0; k < 6; k++) {
    const [r, c] = pick(plain);
    moves.push({ type: 'ice', cells: [[r, c]], param: 8 + Math.floor(rand() * 12) });
  }
  return moves;
}


(async () => {
const { createPool } = require('./EvalPool_v749');
const POOL = createPool({ workers: Number(process.env.EVAL_WORKERS || 6), ref: REF, mode: MODE, guideSteps: GUIDE_STEPS, noEarly: NO_EARLY, shellColors: SHELL, bufThreshold: BUFTH });

let cur = base;
let curE = await POOL.evalOne(applyGates(cur));
console.log(`基线：步${curE.steps} 峰值${curE.peak} at4=${curE.at4} run4=${curE.run4} 空窗总${curE.gapTotal}/最大${curE.gapMax} 前导空${curE.leadFree}`);
const log = [];
let _seedS = Number((process.argv[process.argv.indexOf('--seed') + 1]) || 20261030) || 20261030;
function rndS() { _seedS = (_seedS * 1103515245 + 12345) & 0x7fffffff; return _seedS / 0x7fffffff; }
function sampleMoves(all, n) {
  if (!(n > 0) || all.length <= n) return all;
  const byType = {};
  for (const m of all) (byType[m.type] = byType[m.type] || []).push(m);
  const types = Object.keys(byType);
  const per = Math.max(4, Math.floor(n / Math.max(1, types.length)));
  const out = [];
  for (const t of types) {
    const arr = byType[t];
    if (arr.length <= per) { out.push(...arr); continue; }
    const idx = arr.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rndS() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    out.push(...idx.slice(0, per).map(i => arr[i]));
  }
  return out;
}

for (let round = 0; round < ROUNDS; round++) {
  const allMoves = candidateMoves(cur);
  const moves = sampleMoves(allMoves, SAMPLES);
  console.log(`  第${round + 1}轮：候选 ${allMoves.length} 个，本轮评估 ${moves.length} 个`);
  // 先应用全部候选，再并行评估
  const cands = [];
  for (const mv of moves) { const h = applyMove(cur, mv); if (h) cands.push({ mv, h, hg: applyGates(h) }); }
  const evals = await POOL.evalAll(cands.map(c => c.hg));
  let best = null, bestE = null;
  for (let i = 0; i < cands.length; i++) {
    const e = evals[i]; const mv = cands[i].mv;
    if (!e || e.error) continue;
    if (!e.won || e.peak > 4 || e.itemUses > 0) continue;
    if (BAN_EARLY4 && e.early4 > 0) continue;    // 硬约束：前期不许压到 4
    if (MIN_GAP > 0 && SHELL.length) {          // 开壳间隔硬约束：不合格直接淘汰
      const d = (e.shellDone || []).filter(v => v != null).sort((a, b) => a - b);
      let okGap = d.length === SHELL.length;
      for (let gi = 1; okGap && gi < d.length; gi++) if (d[gi] - d[gi - 1] < MIN_GAP) okGap = false;
      if (!okGap) continue;
    }
    if (GUIDE > 0 && e.firstColor !== GUIDE) continue;
    if (NO_EARLY > 0 && e.earlyHigh) continue;
    if (GUIDE_STEPS > 0) {
      const allow = ALLOW.length ? NEW_ALLOW : [GUIDE];
      if (!e.firstK.every(c => allow.includes(c))) continue;
    }
    if (e.at4 < Math.max(MIN_AT4, curE.at4 - 1)) continue;
    const scoreOf = x => OBJ === 'at4' ? (x.at4 * 10 + x.run4)
      : OBJ === 'late' ? ((x.late4run || 0) * 100 + (x.late4 || 0) * 10 + x.at4 * 0.1)
      : (x.lowRun * 10 + x.lowTotal - W_RUN4 * x.run4);
    const scoreE = scoreOf(e), scoreC = scoreOf(curE);
    if (OBJ === 'low') {
      if (scoreE > scoreC) continue;
      if (scoreE === scoreC && e.at4 <= curE.at4) continue;
    } else {
      if (scoreE <= scoreC) continue;      // at4/late 目标：必须严格更好
    }
    const bestScore = bestE ? scoreOf(bestE) : (OBJ === 'low' ? Infinity : -Infinity);
    if ((OBJ !== 'low' ? scoreE > bestScore : scoreE < bestScore)
      || (scoreE === bestScore && e.at4 > bestE.at4)) { best = { mv, level: cands[i].h }; bestE = e; }
  }
  if (!best) { console.log(`第${round + 1}轮：无改进，停止`); break; }
  cur = best.level; curE = bestE;
  const desc = best.mv.type === 'memberswap' ? `换链成员 ${best.mv.cells[0]}↔${best.mv.cells[1]}`
    : best.mv.type === 'capmove' ? `缩链成员 ${best.mv.cells[0]}→${best.mv.cells[1]} 转 ${best.mv.delta}`
    : best.mv.type === 'capswap' ? `容量互换 ${best.mv.cells[0]}↔${best.mv.cells[1]}`
    : best.mv.type === 'posswap' ? `位置互换 ${best.mv.cells[0]}↔${best.mv.cells[1]}`
      : best.mv.type === 'chain' ? `成链 ${best.mv.cells[0]}+${best.mv.cells[1]}`
        : `加冰 ${best.mv.cells[0]}=${best.mv.param}`;
  console.log(`第${round + 1}轮：${desc} → 最长低压段${curE.lowRun} 低压步${curE.lowTotal} at4=${curE.at4} run4=${curE.run4}`);
  log.push({ round: round + 1, move: best.mv, after: { gapTotal: curE.gapTotal, gapMax: curE.gapMax, at4: curE.at4, run4: curE.run4 } });
}
await POOL.close();
const ok = cliOK(cur);
console.log(`\n终局：最长低压段${curE.lowRun} 低压步${curE.lowTotal} at4=${curE.at4} run4=${curE.run4} 峰值${curE.peak} CLI=${ok ? '✅' : '❌'}`);
if (OUT && ok) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(applyGates(cur), null, 2));
  fs.writeFileSync(OUT.replace(/\.json$/, '.moves.json'), JSON.stringify(log, null, 2));
  console.log(`已写入：${OUT}`);
}
})().catch(e => { console.error(e); process.exit(1); });
