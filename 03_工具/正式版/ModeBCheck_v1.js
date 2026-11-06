#!/usr/bin/env node
'use strict';
/**
 * ModeBCheck_v1 —— Mode B 指标检查（不依赖四象限/骨架/门）
 *
 * 输出五组：
 *  1) 硬门：容量守恒、最小路线可通、无空格、玩家 2 复活通关、最小车容量
 *  2) 节奏：压力段（暂存≥3、前后被≤2包住）的位置/长度/数量，峰值，前段 at4
 *  3) 估算落差：每个取车点 1 − 可见量/容量 的均值、最大值、压力段内均值
 *  4) 选择：好决策数（有得选且不是全可吃满）、没得选步数
 *  5) 容错：20 条噪声求解器（与 ArlCheck 同口径）
 *
 * 用法：node ModeBCheck_v1.js <关卡.json> [--json 报告.json] [--tol 20]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const fs = require('fs');

function arg(k, d) { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }

function countReach(state, blocks, color) {
  const H = blocks.length, W = blocks[0].length, elim = state.eliminated;
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    elim[y - 1][x] || elim[y + 1][x] || elim[y][x - 1] || elim[y][x + 1];
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (!elim[y][x] && reach(y, x) && blocks[y][x] === color) n++;
  return n;
}

function gapProfile(lv, blocks, pickOrder) {
  const Sim = A.Simulator;
  let st;
  try { st = Sim.enter(lv, { useSlotStart: true, instantChain: false }); } catch (e) { return []; }
  const out = [];
  for (const p of pickOrder || []) {
    if (!st || st.gameOver) break;
    if (p.chainIndex != null && p.chainIndex !== 0) continue;
    const vis = countReach(st, blocks, p.color);
    const cap = p.count || 0;
    // 有界落差：(容量 − 可见) / max(容量, 可见)。正=看起来不够、实际要更多；负=看起来就够
    const gap = cap > 0 ? (cap - vis) / Math.max(cap, vis, 1) : 0;
    out.push({ r: p.r, c: p.c, color: p.color, vis, cap, gap, raw: cap > 0 ? 1 - vis / cap : 0 });
    try { Sim.applyPick(st, p.r, p.c); } catch (e) { break; }
  }
  return out;
}

function stretches(buf) {
  const out = [];
  let s = -1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] >= 3) { if (s < 0) s = i; }
    else { if (s >= 0) { out.push({ start: s, end: i - 1, len: i - s }); s = -1; } }
  }
  if (s >= 0) out.push({ start: s, end: buf.length - 1, len: buf.length - s });
  return out;
}

function decisionMetric(g, pickOrder) {
  const H = g.blocks.length, W = g.blocks[0].length, rows = g.spools.length, cols = g.spools[0].length;
  const col = g.blocks.map(r => r.slice());
  const gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const tc = g.spools.map(r => r.map(() => false));
  const exposedAt = (r, c) => (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) ||
    (tc[r - 1] && tc[r - 1][c]) || (tc[r + 1] && tc[r + 1][c]) || tc[r][c - 1] || tc[r][c + 1];
  const taken = new Set();
  let good = 0, dead = 0, n = 0;
  for (const p of (pickOrder || [])) {
    if (p.chainIndex != null && p.chainIndex !== 0) continue;
    n++;
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || !reach(y, x)) continue; const cc = col[y][x]; cnt[cc] = (cnt[cc] || 0) + 1;
    }
    let avail = 0, fill = 0;
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      const s = g.spools[r][c2];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c2) || !exposedAt(r, c2)) continue;
      const t = Array.isArray(s.type) ? s.type : [s.type || 0];
      if (t.includes(7)) continue;
      avail++; if ((cnt[s.id] || 0) >= s.count) fill++;
    }
    if (avail >= 2 && fill >= 1 && fill < avail) good++;
    if (fill === 0) dead++;
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue;
      list.push([(H - 1 - y) + x, y, x]);
    }
    list.sort((a, b) => a[0] - b[0]);
    let k = 0;
    for (const [, y, x] of list) { if (k >= p.count) break; gone[y][x] = true; k++; }
    taken.add(p.r + ',' + p.c); tc[p.r][p.c] = true;
  }
  return { good, dead, n };
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error('用法: node ModeBCheck_v1.js <关卡.json> [--json 报告.json] [--tol 20]'); process.exit(2); }
  const jsonOut = arg('--json', ''), tolN = +arg('--tol', '20');
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lv = A.parseLevel(A.fromGameFormat(g));
  const blocks = g.blocks, H = blocks.length, W = blocks[0].length;

  // 硬门
  const px = {}, sums = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = blocks[y][x]; if (c > 0) px[c] = (px[c] || 0) + 1; }
  const caps = [];
  let empty = 0;
  for (const row of g.spools) for (const s of row) {
    if (!s) { empty++; continue; }
    const types = Array.isArray(s.type) ? s.type : [s.type || 0];
    const isPipe = types.some(x => x >= 11 && x <= 14);
    if (isPipe) {
      // 管道队列也算进该色总容量（AGENTS.md 红线：sum(count) 含管道队列）
      const ps = Array.isArray(s.param) ? s.param : [];
      for (const q of ps) if (q && q.id > 0) sums[q.id] = (sums[q.id] || 0) + (q.count || 0);
      if (s.id > 0) { sums[s.id] = (sums[s.id] || 0) + s.count; caps.push(s.count); }
      continue;
    }
    if (s.id > 0) { sums[s.id] = (sums[s.id] || 0) + s.count; caps.push(s.count); }
    else if (s.id !== -1) empty++;
  }
  const colors = new Set([...Object.keys(px), ...Object.keys(sums)]);
  let conserved = true, pxTotal = 0, sumTotal = 0;
  for (const c of colors) {
    pxTotal += px[c] || 0; sumTotal += sums[c] || 0;
    if ((px[c] || 0) !== (sums[c] || 0)) conserved = false;
  }
  const minCap = caps.length ? Math.min(...caps) : 0;
  const mb = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
  const hist = mb.stepBufferHistory || [];
  const peakMin = Math.max(0, ...hist);
  const e10 = Math.max(1, Math.round(hist.length * 0.1));
  const early4 = hist.slice(0, e10).filter(v => v >= 4).length;
  const pr = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 2, capturePreviewStats: false });
  const picks = (pr.pickOrder || []).filter(p => p.chainIndex == null || p.chainIndex === 0);
  const tl = pr.bufferTimeline || [];
  const pbuf = picks.map(p => tl[p.tick] != null ? tl[p.tick] : 0);
  const pPeak = Math.max(0, ...pbuf);

  // 节奏
  const segsMin = stretches(hist), segsP = stretches(pbuf);

  // 估算落差
  const gapMin = gapProfile(lv, blocks, (mb.pickOrder || []).filter(p => p.chainIndex == null || p.chainIndex === 0));
  const gapP = gapProfile(lv, blocks, picks);
  const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const share = (a, t) => a.length ? a.filter(x => x >= t).length / a.length : 0;
  const gapAvgMin = avg(gapMin.map(x => x.gap)), gapMaxMin = gapMin.length ? Math.max(...gapMin.map(x => x.gap)) : 0;
  const gapMedMin = med(gapMin.map(x => x.gap)), gapDebtMin = share(gapMin.map(x => x.gap), 0.2);
  const gapAvgP = avg(gapP.map(x => x.gap)), gapMaxP = gapP.length ? Math.max(...gapP.map(x => x.gap)) : 0;
  const inSeg = gapMin.filter((x, i) => segsMin.some(s => i >= s.start && i <= s.end)).map(x => x.gap);

  // 选择
  const dec = decisionMetric(g, mb.pickOrder || []);

  // 容错
  let tol = 0;
  for (let i = 0; i < tolN; i++) {
    const nz = i === 0 ? 0 : 0.2 + (i % 5) * 0.2;
    const oo = A.Solver.runSolver(lv, nz, 1000 + i * 37, false, false, { capturePreviewStats: false, instantChain: false });
    if (oo.completed) tol++;
  }

  const hard = {
    conserved, solvable: !!mb.won, noEmpty: empty === 0,
    player2: !!pr.won, minCap
  };
  const report = {
    file, hard,
    boxes: mb.completedBoxes + '/' + mb.totalBoxes,
    peakMin, early4,
    beats: { min: segsMin, player: segsP },
    peakPlayer: pPeak,
    gap: { minAvg: +gapAvgMin.toFixed(3), minMed: +gapMedMin.toFixed(3), minMax: +gapMaxMin.toFixed(3), debtShare: +gapDebtMin.toFixed(2), playerAvg: +gapAvgP.toFixed(3), playerMax: +gapMaxP.toFixed(3), inBeatAvg: +avg(inSeg).toFixed(3) },
    decision: { ...dec, ratio: dec.n ? +(dec.good / dec.n).toFixed(2) : 0 },
    tolerance: { tol, n: tolN }
  };
  console.log('=== ' + file.split('/').pop() + ' ===');
  console.log('硬门: 守恒' + (conserved ? '✓' : '✗') + ' 可通' + (mb.won ? '✓' : '✗') + ' 无空格' + (empty === 0 ? '✓' : '✗') +
    ' 玩家2复活' + (pr.won ? '✓' : '✗') + ' 最小车' + minCap + 'px');
  console.log('节奏: 峰值(min/player) ' + peakMin + '/' + pPeak + '  前10% at4=' + early4 +
    '  min压力段 ' + (segsMin.map(s => s.start + '-' + s.end + '(' + s.len + ')').join(',') || '无') +
    '  player压力段 ' + (segsP.map(s => s.start + '-' + s.end + '(' + s.len + ')').join(',') || '无'));
  console.log('估算落差: min均值' + gapAvgMin.toFixed(2) + '/中位' + gapMedMin.toFixed(2) + '/max' + gapMaxMin.toFixed(2) +
    ' 债车占比' + (gapDebtMin * 100).toFixed(0) + '%  player均值' + gapAvgP.toFixed(2) + '  段内均值' + avg(inSeg).toFixed(2));
  console.log('选择: 好决策 ' + dec.good + '/' + dec.n + '  没得选 ' + dec.dead);
  console.log('容错: ' + tol + '/' + tolN);
  if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2)); console.log('已写：' + jsonOut); }
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
