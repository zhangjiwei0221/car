#!/usr/bin/env node
'use strict';
/**
 * ChainRatchetCheck_v1 —— 锁链棘轮 / 进度死锁检查（2026-11-11）
 *
 * 为什么需要它：
 *   `ZC_181` 过了 policy0/OpeningCheck，但真人路径在第 36 步把 buffer 推到 3 后，
 *   三锁链（需 3 个空位）永远进不去，而它锁着债车要的颜色；最后 4 笔债 + 2 条三锁链 + 1 个空位 = 死局。
 *   policy0 只证明“存在一条路线能赢”，不证明“合理路线不会走进死局”。
 *
 * 检查什么（沿路线逐状态）：
 *   1. 进度死锁：buffer 非空时，枚举所有合法走法，模拟后若没有任何走法能让任一暂存车
 *      进度增加 / 完成（completedBoxes 增加），判 progressDead。
 *   2. 立即死：所有合法走法模拟后都满足「buffer 满且本步无完成 / overflow / 无合法走法」，判 allMovesDead。
 *   3. 棘轮陷阱：某状态有「可进入的链组」（组大小 ≤ 空位），但走任一非链车后，
 *      该链组变成不可进入，且新局面 progressDead → 标记 trapMove。
 *
 * 路线：
 *   --path <编辑器点击路径.json>  可选，优先检查真人路径
 *   默认还跑 solver / free-first / max-eat / small-debt 四条策略路线
 *   （策略打分与 ClickSettlePolicyCheck_v1 同口径，复制在此以免依赖其内部函数）
 *
 * 用法：
 *   node ChainRatchetCheck_v1.js <关卡.json | 目录> [--path 用户路径.json]
 *        [--out report.json] [--limit N] [--no-policy]
 *
 * 只读；不改关卡。结论是「这些路线上出现了死局」，不是「所有路线都会死」。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.indexOf(k) > 0;
const input = process.argv[2];
const outFile = arg('--out', null);
const userPath = arg('--path', null);
const limit = Number(arg('--limit', 0)) || 0;
const noPolicy = has('--no-policy');

if (!input) {
  console.error('用法: node ChainRatchetCheck_v1.js <关卡.json | 目录> [--path 用户路径.json] [--out report.json]');
  process.exit(2);
}

const clone = s => JSON.parse(JSON.stringify(s));
const liveMoves = s => A.Simulator.listMoves(s).filter(m => !m.blocked);
const sig = s => s.buffer.map(b => b.key + ':' + b.progress).sort().join(',');

function stateKey(s) {
  const cells = s.cells.map(row => row.map(c => (c && c.t === 'box') ? (c.color + '.' + (c.chain || 0) + '.' + (c.numice || 0)) : '-').join('|')).join('/');
  return s.buffer.map(b => b.key + ':' + b.progress).sort().join(',') + '#' + s.eliminatedPixels + '#' + cells;
}
/**
 * 有界多步推进搜索：是否存在一条走法（≤ depth 步）能让任一暂存车进度增加 / 完成。
 * 只用于 buffer≥3 的危险状态；depth 默认 5、节点预算 800。
 */
function canProgress(s, depth, budget, memo) {
  if (depth <= 0) return false;
  const k = stateKey(s);
  if (memo.has(k)) return false;
  memo.add(k);
  const before = {};
  for (const b of s.buffer) before[b.key] = b.progress;
  for (const m of liveMoves(s)) {
    if (budget.n-- <= 0) return false;
    const c = clone(s);
    const done0 = c.completedBoxes;
    if (!A.Simulator.applyPick(c, m.r, m.c)) continue;
    if (c.gameWon || c.eliminatedPixels >= c.totalPixels) return true;
    if (c.completedBoxes > done0 || c.buffer.some(b => before[b.key] != null && b.progress > before[b.key])) return true;
    const dead = c.overflow || c.buffer.length > c.bufferLimit
      || (c.buffer.length >= c.bufferLimit && c.completedBoxes === done0 && liveMoves(c).length === 0);
    if (dead) continue;
    if (canProgress(c, depth - 1, budget, memo)) return true;
  }
  return false;
}

function chainGroups(s) {
  const g = {};
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const cell = s.cells[r][c];
    if (!cell || cell.t !== 'box' || !(cell.chain > 0)) continue;
    const k = cell.chain;
    g[k] = g[k] || { chain: k, size: 0, colors: [] };
    g[k].size++;
    if (g[k].colors.indexOf(cell.color) < 0) g[k].colors.push(cell.color);
  }
  return Object.keys(g).map(k => g[k]);
}

/**
 * 单状态检查：返回 { free, lockedChains, moves, progressDead, allMovesDead, deadMoves }
 */
function analyzeState(s) {
  if (s.gameWon || s.eliminatedPixels >= s.totalPixels) return { won: true };
  const free = s.bufferLimit - s.buffer.length;
  const chains = chainGroups(s);
  const lockedChains = chains.filter(g => g.size > free);
  const ms = liveMoves(s);
  let anyBufferProgress = false;
  let allMovesDead = ms.length > 0;
  const deadMoves = [];
  const beforeByKey = {};
  for (const b of s.buffer) beforeByKey[b.key] = b.progress;
  for (const m of ms) {
    const c = clone(s);
    const beforeDone = c.completedBoxes;
    if (!A.Simulator.applyPick(c, m.r, m.c)) { allMovesDead = false; continue; }
    // 进度只看「已在暂存里的车」：新增一辆债车不算进度
    const progressed = c.completedBoxes > beforeDone
      || c.buffer.some(b => beforeByKey[b.key] != null && b.progress > beforeByKey[b.key]);
    if (progressed) anyBufferProgress = true;
    const noMoves = liveMoves(c).length === 0;
    const wonAfter = c.gameWon || c.eliminatedPixels >= c.totalPixels;
    const dead = !wonAfter && (c.overflow || c.buffer.length > c.bufferLimit
      || (c.buffer.length >= c.bufferLimit && c.completedBoxes === beforeDone) || noMoves);
    if (!dead) allMovesDead = false;
    else deadMoves.push({ r: m.r, c: m.c, color: m.antBox && m.antBox.color, count: m.antBox && m.antBox.count, reason: c.overflow ? 'overflow' : noMoves ? 'noMoves' : 'bufferFullNoComplete' });
  }
  // 一层推进只作快速路径；真正判死锁要有界多步搜索（buffer≥3 才有棘轮风险）
  let progressDead = false;
  if (s.buffer.length >= 3 && ms.length > 0 && !anyBufferProgress) {
    progressDead = !canProgress(s, 5, { n: 800 }, new Set());
  }
  return {
    free, chains, lockedChains,
    moves: ms.length,
    progressDead,
    allMovesDead,
    deadMoves: allMovesDead ? deadMoves : []
  };
}

/** 在状态 s 上找「棘轮陷阱」：可进入的链 → 走非链车后链被锁且新局面 progressDead */
function findTraps(s) {
  const an = analyzeState(s);
  if (an.won || !an.chains) return [];
  const enterable = an.chains.filter(g => g.size <= an.free && g.size > 1);
  if (!enterable.length) return [];
  const traps = [];
  for (const m of liveMoves(s)) {
    const cell = s.cells[m.r][m.c];
    if (cell && cell.chain > 0) continue;             // 只看非链车
    const c = clone(s);
    if (!A.Simulator.applyPick(c, m.r, m.c)) continue;
    const after = analyzeState(c);
    if (after.won || !after.progressDead) continue;
    const locked = (after.lockedChains || []).filter(g => enterable.some(e => e.chain === g.chain));
    if (locked.length) {
      traps.push({
        move: { r: m.r, c: m.c, color: cell && cell.color, count: cell && cell.count },
        lockedChains: locked.map(g => ({ chain: g.chain, size: g.size, colors: g.colors })),
        bufferAfter: c.buffer.length,
        freeAfter: after.free
      });
    }
  }
  return traps;
}

// ---------- 路线生成 ----------
function solverRoute(lv) {
  const min = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
  const byStep = {};
  for (const p of min.pickOrder || []) if (!byStep[p.step]) byStep[p.step] = { r: p.r, c: p.c };
  return Object.keys(byStep).map(Number).sort((a, b) => a - b).map(s => ({ r: byStep[s].r, c: byStep[s].c }));
}

// 与 ClickSettlePolicyCheck_v1 同口径的打分
function moveScore(s, m, strategy) {
  const c = clone(s);
  const before = c.eliminatedPixels;
  if (!A.Simulator.applyPick(c, m.r, m.c)) return null;
  const gain = c.eliminatedPixels - before;
  const buf = c.buffer.length;
  const stuckPx = c.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
  const free = buf === 0 ? 1 : 0;
  const completedDelta = c.completedBoxes - s.completedBoxes;
  const noMoves = c.eliminatedPixels < c.totalPixels && liveMoves(c).length === 0;
  const wonAfter = c.gameWon || c.eliminatedPixels >= c.totalPixels;
  const dead = !wonAfter && (c.overflow || buf > c.bufferLimit || (buf >= c.bufferLimit && completedDelta === 0) || noMoves);
  let score;
  if (strategy === 'max-eat') score = [dead ? 0 : 1, gain, free, -buf, -stuckPx, -m.r, -m.c];
  else if (strategy === 'small-debt') score = [dead ? 0 : 1, free, -buf, -stuckPx, gain, -m.r, -m.c];
  else if (strategy === 'debt-first') score = [dead ? 0 : 1, buf, free, gain, -stuckPx, -m.r, -m.c];
  else score = [dead ? 0 : 1, free, gain, -buf, -stuckPx, -m.r, -m.c];
  return { m, score };
}
function cmp(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }
function chooseMove(s, strategy) {
  let best = null;
  for (const m of liveMoves(s)) {
    const sc = moveScore(s, m, strategy);
    if (!sc) continue;
    if (!best || cmp(sc.score, best.score) > 0) best = sc;
  }
  return best;
}
function policyRoute(lv, strategy) {
  const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const picks = [];
  for (let i = 0; i < 200; i++) {
    if (s.gameWon || s.eliminatedPixels >= s.totalPixels || s.gameOver) break;
    const ch = chooseMove(s, strategy);
    if (!ch) break;
    picks.push({ r: ch.m.r, c: ch.m.c });
    if (!A.Simulator.applyPick(s, ch.m.r, ch.m.c)) break;
  }
  return picks;
}

// ---------- 沿路线检查 ----------
function checkRoute(lv, picks, tag) {
  const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const flags = [];
  const traps = [];
  let steps = 0;
  for (const p of picks) {
    if (s.gameWon || s.eliminatedPixels >= s.totalPixels) break;
    const an = analyzeState(s);
    if (an.won) break;
    if (an.progressDead) flags.push({ step: steps + 1, kind: 'progressDead', buffer: s.buffer.length, free: an.free, moves: an.moves, lockedChains: an.lockedChains.map(g => ({ chain: g.chain, size: g.size, colors: g.colors })) });
    if (an.allMovesDead) flags.push({ step: steps + 1, kind: 'allMovesDead', buffer: s.buffer.length, free: an.free, deadMoves: an.deadMoves.slice(0, 4) });
    if (s.buffer.length >= 2) {
      const t = findTraps(s);
      for (const x of t) traps.push({ step: steps + 1, ...x });
    }
    if (!A.Simulator.applyPick(s, p.r, p.c)) { flags.push({ step: steps + 1, kind: 'illegalPick', pick: p }); break; }
    steps++;
    if (s.gameOver) { flags.push({ step: steps, kind: 'gameOver', buffer: s.buffer.length }); break; }
  }
  // 路线结束后也要看最终状态：真人可能在第 41 步之后进入死局
  if (!(s.gameWon || s.eliminatedPixels >= s.totalPixels)) {
    const anEnd = analyzeState(s);
    if (anEnd.won) { /* 已通 */ }
    else {
      if (anEnd.progressDead) flags.push({ step: steps, kind: 'progressDead', buffer: s.buffer.length, free: anEnd.free, moves: anEnd.moves, lockedChains: anEnd.lockedChains.map(g => ({ chain: g.chain, size: g.size, colors: g.colors })) });
      if (anEnd.allMovesDead) flags.push({ step: steps, kind: 'allMovesDead', buffer: s.buffer.length, free: anEnd.free, deadMoves: anEnd.deadMoves.slice(0, 4) });
      if (s.buffer.length >= 2) for (const x of findTraps(s)) traps.push({ step: steps, ...x });
    }
  }
  const won = s.gameWon || s.eliminatedPixels >= s.totalPixels;
  return { tag, steps, won, progress: s.totalPixels ? +(s.eliminatedPixels / s.totalPixels).toFixed(3) : 0, flags, traps };
}

function collect(p) {
  if (fs.statSync(p).isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(x => path.join(p, x));
}
function isLevel(g) { return g && g.toprow && Array.isArray(g.blocks) && Array.isArray(g.spools); }

const files = collect(input).slice(0, limit || undefined);
const rows = [];
for (const file of files) {
  let g;
  try { g = B.readJson(file); } catch (e) { rows.push({ file, error: 'read: ' + e.message }); continue; }
  if (!isLevel(g)) continue;
  const lv = A.parseLevel(A.fromGameFormat(g));
  const routes = [];
  if (userPath) {
    try {
      const up = B.readJson(userPath);
      const picks = (up.clicks || []).map(c => ({ r: c.r, c: c.c }));
      if (picks.length) routes.push(checkRoute(lv, picks, 'user'));
    } catch (e) { routes.push({ tag: 'user', error: e.message }); }
  }
  if (!noPolicy) {
    const sr = solverRoute(lv);
    if (sr.length) routes.push(checkRoute(lv, sr, 'solver'));
    // debt-first 只作诊断（会把已知低流失关也判死），不进默认硬门
    for (const st of ['free-first', 'max-eat', 'small-debt']) {
      const pr = policyRoute(lv, st);
      if (pr.length) routes.push(checkRoute(lv, pr, st));
    }
  }
  const flags = routes.flatMap(r => (r.flags || []).map(f => ({ tag: r.tag, ...f })));
  const traps = routes.flatMap(r => (r.traps || []).map(f => ({ tag: r.tag, ...f })));
  rows.push({ file: path.basename(file), routes, flags, traps, pass: flags.length === 0 && traps.length === 0 });
}

const summary = {
  levels: rows.length,
  pass: rows.filter(r => r.pass).length,
  fail: rows.filter(r => !r.pass).length,
  progressDead: rows.filter(r => r.flags.some(f => f.kind === 'progressDead')).length,
  allMovesDead: rows.filter(r => r.flags.some(f => f.kind === 'allMovesDead')).length,
  trapLevels: rows.filter(r => r.traps.length > 0).length
};
const out = { tool: 'ChainRatchetCheck_v1', summary, rows };
if (outFile) { fs.writeFileSync(outFile, JSON.stringify(out, null, 1)); console.log('saved ' + outFile); }
else {
  for (const r of rows) {
    if (r.error) { console.log(r.file.padEnd(34) + ' ERROR ' + r.error); continue; }
    console.log((r.file.padEnd(34) + (r.pass ? ' PASS' : ' FAIL') + '  routes=' + r.routes.length + ' flags=' + r.flags.length + ' traps=' + r.traps.length));
    for (const f of r.flags.slice(0, 4)) console.log('   ' + f.tag + ' step' + f.step + ' ' + f.kind + ' buf=' + (f.buffer == null ? '?' : f.buffer) + (f.lockedChains && f.lockedChains.length ? ' locked=' + f.lockedChains.map(x => x.size + '链[' + x.colors.join('/') + ']').join(',') : ''));
    for (const t of r.traps.slice(0, 3)) console.log('   ' + t.tag + ' step' + t.step + ' trap move ' + t.move.color + ':' + t.move.count + ' → 锁 ' + t.lockedChains.map(x => x.size + '链').join(',') + ' buf=' + t.bufferAfter);
  }
  console.log('\n=== summary ===');
  console.log(JSON.stringify(summary, null, 1));
}
