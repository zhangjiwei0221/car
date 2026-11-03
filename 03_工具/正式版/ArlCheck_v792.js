#!/usr/bin/env node
'use strict';
/**
 * ArlCheck_v792 —— 【新验收标准，2026-11-03 用户定稿】
 *
 *   ① 峰值 = 4
 *   ② 前 20%：at4 = 0
 *   ③ 前 20%：免费步 ≤ 6
 *   ④ 中段（20%~80%）：at3 ≥ 15
 *   ⑤ 后 20%：at3 ≥ 3 且连续 ≥ 3
 *   ⑥ 容错率 ≥ 80%（20 种随机打法）
 *   ⑦ 决策度（好决策步数）≥ 15
 *   ⑧ 没得选（可吃满=0 的步数）≤ 1
 *   ⑨ at4 ≥ 5（保留少量濒死时刻）
 *   ⑩ 可通关 / 无空格 / 容量守恒
 *
 * 用法：node ArlCheck_v792.js <关卡.json> [...]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const fs = require('fs');

function check(f) {
  const g = B.readJson(f);
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  // 【2026-11-03 用户定口径】压力 = 每次选择「结算后」的暂存占用（stepBufferHistory），
  // 不是「每完成一辆车」的样本（pressureSamples）。区别：一次取 3 辆（链）只算 1 步。
  const buf = (Array.isArray(o.stepBufferHistory) && o.stepBufferHistory.length)
    ? o.stepBufferHistory.slice()
    : (o.pressureSamples || []).map(s => s.buf || 0);
  const L = buf.length;
  // 【2026-11-03 用户放宽】前段门槛 20% → 10%，且允许前段 at4 ≤ 1。
  // 理由：不必死磕"开局绝对不碰 4"，只要整体有难度、逼玩家思考即可。
  const eN = Math.max(1, Math.round(L * 0.1)), tN = Math.floor(L * 0.8);
  let a3 = 0, a4 = 0;
  for (const v of buf) { if (v >= 3) a3++; if (v >= 4) a4++; }
  const early4 = buf.slice(0, eN).filter(v => v >= 4).length;
  const earlyFree = buf.slice(0, eN).filter(v => v === 0).length;
  const mid3 = buf.slice(eN, tN).filter(v => v >= 3).length;
  const tail3 = buf.slice(tN).filter(v => v >= 3).length;
  let tailRun = 0, c = 0;
  for (const v of buf.slice(tN)) { if (v >= 3) { c++; tailRun = Math.max(tailRun, c); } else c = 0; }
  const peak = Math.max(0, ...buf);

  // 【2026-11-03 用户定】目标感：不能四个象限同时挖（中期主体会碎）。
  // 象限进度并行度 = 每一步有多少个象限处于「进行中」(2%<进度<98%)，取平均。理想→1。
  let quadAvg = 0, quadSteps = 0, blobAvg = 0;
  {
    const H2 = g.blocks.length, W2 = g.blocks[0].length;
    const quadOf = (y, x) => (y >= H2 / 2 ? '下' : '上') + (x < W2 / 2 ? '左' : '右');
    const totQ = {};
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const v = g.blocks[y][x]; if (v > 0) { const q = quadOf(y, x); totQ[q] = (totQ[q] || 0) + 1; } }
    const col2 = g.blocks.map(r => r.slice()), gone2 = g.blocks.map(r => r.map(() => false));
    const reach2 = (y, x) => y === 0 || x === 0 || y === H2 - 1 || x === W2 - 1 ||
      gone2[y - 1][x] || gone2[y + 1][x] || gone2[y][x - 1] || gone2[y][x + 1];
    const doneQ = {}; Object.keys(totQ).forEach(q => doneQ[q] = 0);
    // 连通块数：某象限已消除区域是不是"一整块"（从一角连续推进）
    const blobsInQuad = (q) => {
      const y0 = q.startsWith('下') ? Math.floor(H2 / 2) : 0, y1 = q.startsWith('下') ? H2 : Math.floor(H2 / 2);
      const x0 = q.endsWith('左') ? 0 : Math.floor(W2 / 2), x1 = q.endsWith('左') ? Math.floor(W2 / 2) : W2;
      const seen = new Set(); let blobs = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (!gone2[y][x] || seen.has(y * W2 + x)) continue;
        blobs++;
        const st = [[y, x]]; seen.add(y * W2 + x);
        while (st.length) {
          const [cy, cx] = st.pop();
          for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ny = cy + dy, nx = cx + dx;
            if (ny < y0 || ny >= y1 || nx < x0 || nx >= x1) continue;
            if (!gone2[ny][nx] || seen.has(ny * W2 + nx)) continue;
            seen.add(ny * W2 + nx); st.push([ny, nx]);
          }
        }
      }
      return blobs;
    };

    let sum = 0, n = 0, blobSum = 0, blobN = 0;
    for (const p of (o.pickOrder || [])) {
      if (p.chainIndex !== 0) continue;
      const c0 = p.color, list2 = [];
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { if (gone2[y][x] || col2[y][x] !== c0 || !reach2(y, x)) continue; list2.push([(H2 - 1 - y) + x, y, x]); }
      list2.sort((a, b) => a[0] - b[0]);
      let k2 = 0;
      for (const [, y, x] of list2) { if (k2 >= p.count) break; gone2[y][x] = true; doneQ[quadOf(y, x)]++; k2++; }
      let inflight = 0;
      for (const q of Object.keys(totQ)) { const r = doneQ[q] / (totQ[q] || 1); if (r > 0.02 && r < 0.98) inflight++; }
      sum += inflight; n++;
      // 碎度只在「进行中」的象限上统计，避免收尾时全部并成 1 块把平均值拉低
      for (const q of Object.keys(totQ)) {
        const r = doneQ[q] / (totQ[q] || 1);
        if (r > 0.05 && r < 0.95) { blobSum += blobsInQuad(q); blobN++; }
      }
    }
    quadAvg = n ? sum / n : 0; quadSteps = n;
    blobAvg = blobN ? blobSum / blobN : 0;
  }
  // 【2026-11-03 用户指出】开局"13 步全是免费车"——前段占比检查抓不到，必须单独量最长连续空转。
  let freeRun = 0, _fr = 0;
  for (const v of buf) { if (v === 0) { _fr++; freeRun = Math.max(freeRun, _fr); } else _fr = 0; }
  // 【2026-11-03 用户反馈】「中期很长一段都是 1」——中段 at3 是比例，连续低压段会被平均掉。
  // 单独量：中段(buf<=1) 的最长连续段。
  let lowRun = 0, _lr = 0;
  for (const v of buf.slice(eN, tN)) { if (v <= 1) { _lr++; lowRun = Math.max(lowRun, _lr); } else _lr = 0; }

  // 【2026-11-03 用户定】20 种打法的曲线 —— 验收用「玩家视角」，不是全知最优路线。
  // 实测差距很大：G 关全知中段 30 步，20 种打法平均只有 7.7 步。
  const runs = [];
  for (let i = 0; i < 20; i++) {
    const nz = i === 0 ? 0 : 0.2 + (i % 5) * 0.2;
    const oo = A.Solver.runSolver(lv, nz, 1000 + i * 37, false, false, { capturePreviewStats: false, instantChain: false });
    const ss = (Array.isArray(oo.stepBufferHistory) && oo.stepBufferHistory.length)
      ? oo.stepBufferHistory.slice()
      : (oo.pressureSamples || []).map(x => x.buf || 0);
    const len = ss.length || 1;
    const e2 = Math.max(1, Math.round(len * 0.1)), t2 = Math.floor(len * 0.8);
    const tl = ss.slice(t2);
    let rn = 0, cc = 0;
    for (const v of tl) { if (v >= 3) { cc++; rn = Math.max(rn, cc); } else cc = 0; }
    runs.push({
      won: !!oo.completed, len,
      mid3: ss.slice(e2, t2).filter(v => v >= 3).length, midN: Math.max(1, t2 - e2),
      tail3: tl.filter(v => v >= 3).length, tailRun: rn,
      max: Math.max(0, ...ss),
    });
  }
  const tol = runs.filter(r => r.won).length;
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const pMidRatio = med(runs.map(r => r.mid3 / r.midN));   // 每局中段占比的中位数
  const pMid3 = med(runs.map(r => r.mid3));
  const pTail3 = med(runs.map(r => r.tail3));
  const pTailRun = med(runs.map(r => r.tailRun));
  const pPeak = med(runs.map(r => r.max));

  // 决策度
  const H = g.blocks.length, W = g.blocks[0].length, rows = g.spools.length, cols = g.spools[0].length;
  const col = g.blocks.map(r => r.slice());
  const gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set(); let good = 0, dead = 0;
  // 【v793 修正】只有"棋盘上暴露的格子"才能选：边框行/列，或与已取走的空位相邻
  const tc = g.spools.map(r => r.map(() => false));
  const exposedAt = (r, c) => (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) ||
    tc[r - 1] && tc[r - 1][c] || tc[r + 1] && tc[r + 1][c] || tc[r][c - 1] || tc[r][c + 1];
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || !reach(y, x)) continue; const cc = col[y][x]; cnt[cc] = (cnt[cc] || 0) + 1; }
    let avail = 0, fill = 0;
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      const s = g.spools[r][c2]; if (!s || !(s.id > 0) || taken.has(r + ',' + c2)) continue;
      if (!exposedAt(r, c2)) continue;
      const t = Array.isArray(s.type) ? s.type : [s.type || 0]; if (t.includes(7)) continue;
      avail++; if (!s.q && (cnt[s.id] || 0) >= s.count) fill++;
    }
    if (avail >= 2 && fill >= 1 && fill < avail) good++;
    if (fill === 0) dead++;
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue; list.push([(H - 1 - y) + x, y, x]); }
    list.sort((a, b) => a[0] - b[0]); let n = 0;
    for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
    tc[p.r][p.c] = true;
  }

  // 容量/空格
  let sum = 0, empty = 0;
  for (const row of g.spools) for (const s of row) {
    const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
    if (t.some(x => x >= 11 && x <= 14)) { (Array.isArray(s.param) ? s.param : []).forEach(b => sum += (b.count || 0)); continue; }
    if (s && s.id === -1) continue;
    if (!s || !s.id || s.id <= 0) { empty++; continue; }
    sum += s.count;
  }
  const px = g.blocks.flat().length;

  const rules = [
    ['峰值=4', peak === 4, peak],
    ['前10% at4≤1', early4 <= 1, early4 + ' 步'],
    ['前10% 免费步', true, earlyFree + '/' + eN, true],   // 软项：只提示，不参与通过判定
    // 【2026-11-03 用户定】压力改用「20 种打法的中位数」——玩家不是全知
    ['最长连续免费≤5', freeRun <= 5, freeRun + ' 步'],
    // 【2026-11-03 用户定】50% → 45%：40×40 的图实测上限 46%，50% 只能靠 35×35 的图达到
    // 【体验优先】中段是区间不是越高越好：太低没紧张感，太高会一直绷着（006 的 95% 就属于过火）
    ['玩家中段 45–80%', pMidRatio >= 0.45 && pMidRatio <= 0.80, pMid3 + ' 步（占比 ' + Math.round(pMidRatio * 100) + '%）'],
    ['中段最长低压≤5', lowRun <= 5, lowRun + ' 步（buf≤1 连续）'],
    // 【目标感】其他象限可以动，但不能四个一起挖到一半（用户：只要主体不乱）
    // 【2026-11-03 用户 mentor】『主体不会很散、知道自己要消除哪个』是首要，难度不是关键
    ['象限并行度≤3.6', quadAvg <= 3.6, quadAvg.toFixed(2) + '（' + quadSteps + ' 步）'],
    // 象限内部碎度：进行中的象限里，已消除区域平均几块（1=从一角连续推进，越大越"多点开花"）
    ['象限内部碎度', true, blobAvg.toFixed(1) + ' 块/象限', true],
    ['玩家后20% at3≥2', pTail3 >= 2, pTail3 + ' 步'],
    ['玩家后20% 连续≥2', pTailRun >= 2, pTailRun],
    // 【2026-11-03 用户选 B】允许玩家死：峰值=4 只约束最优路线，玩家视角放宽到 5。
    ['玩家峰值≤5', pPeak <= 5, pPeak + '（最优路线仍须=4）'],
    // 容错改成区间：100% = 太松（随便玩都能过），<40% = 太脆
    ['容错 55–75%', tol >= 11 && tol <= 15, tol + '/20'],
    // 参考项（不判定）：全知最优路线的数据，用来对比"理想 vs 真实"
    ['（参考）全知 中段', true, mid3 + '/' + (tN - eN), true],
    ['（参考）全知 at4', true, a4, true],
    ['决策度≥15', good >= 15, good + '/' + picks.length],
    // 【2026-11-03 用户选 B】改软项：用户已明确「必须选某色解锁不是问题」
    ['没得选', true, dead, true],
    ['at4≥5', a4 >= 5, a4],
    ['可通关', !!o.completed, o.completed ? '✓' : '✗'],
    ['无空格', empty === 0, empty],
    ['容量守恒', sum === px, sum + '/' + px],
  ];
  const pass = rules.filter(r => !r[3]).every(r => r[1]);   // r[3]=true 的是软项
  return { f, rules, pass, L };
}

if (require.main === module) {
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    const r = check(f);
    console.log('\n=== ' + f.split('/').pop() + '（' + r.L + ' 步）===');
    for (const [name, ok, val, soft] of r.rules) console.log('  ' + (soft ? '⚪' : ok ? '✅' : '❌') + ' ' + name.padEnd(16) + String(val));
    console.log('  → ' + (r.pass ? '通过' : '不通过'));
    if (!r.pass) bad++;
  }
  process.exit(bad ? 1 : 0);
}

module.exports = { check };
