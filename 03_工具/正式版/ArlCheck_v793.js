#!/usr/bin/env node
'use strict';
/**
 * ArlCheck_v793 —— 【13项验收，2026-11-04 口径变更】
 *
 * v793 只改一处：⑩「可通关」改用「最小暂存路线」（玩家会走的路）；
 * 原全知贪心路线保留为 ⚪ 参考项，只提示「贪心陷阱」，不再否决。
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
 *   ⑩ 可通关（最小路线）/ 无空格 / 容量守恒
 *
 * 用法：node ArlCheck_v793.js <关卡.json> [...]
 */
const B = require('./Build006Thickness_v688');
const { detect: detectSubjects } = require('./SubjectDetect_v800');
const A = B.loadSolver('corner');
const fs = require('fs');

/**
 * 【2026-11-04 用户定】「暂存区最少」路线——这才是玩家会走的路。
 * v635：统一调用编辑器同一个 Solver.runMinBuffer，避免两套实现漂移。
 */
function minBufferRun(lv, DEPTH = 3) {
  const r = A.Solver.runMinBuffer(lv, { depth: DEPTH, instantChain: false });
  return {
    buf: r.bufHistory || r.stepBufferHistory || [],
    won: !!r.won,
    done: r.completedBoxes || 0,
    total: r.totalBoxes || 0,
    detail: r
  };
}

function check(f) {
  const SOFT_TOLERANCE = process.argv.includes('--soft-tolerance');
  const g = B.readJson(f);
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  // 【2026-11-04 用户定】压力口径 = 「暂存区最少」的路线（玩家会走的路），不是原求解器的贪心路线。
  const mb = minBufferRun(lv, 3);
  const buf = mb.buf.length ? mb.buf.slice() : ((Array.isArray(o.stepBufferHistory) && o.stepBufferHistory.length)
    ? o.stepBufferHistory.slice()
    : (o.pressureSamples || []).map(s => s.buf || 0));
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

  // 【2026-11-03 用户+mentor】主体级并行度：任何时候有几个「主体」在动、还剩几个完全没动。
  // 这比象限口径准——象限会把背景色算进去（食物图象限 3.98，但主体其实只动了 2.95 个）。
  let subjAvg = null, subjN = 0, minUntouched = null, avgUntouched = null;
  {
    const subs = detectSubjects(g.blocks);
    subjN = subs.length;
    if (subjN >= 2) {
      const col3 = g.blocks.map(r => r.slice()), gone3 = g.blocks.map(r => r.map(() => false));
      const H3 = g.blocks.length, W3 = g.blocks[0].length;
      const reach3 = (y, x) => y === 0 || x === 0 || y === H3 - 1 || x === W3 - 1 ||
        gone3[y - 1][x] || gone3[y + 1][x] || gone3[y][x - 1] || gone3[y][x + 1];
      const done = subs.map(() => 0);
      let sSum = 0, sN = 0, uSum = 0, uMin = 1e9;
      for (const p of (o.pickOrder || [])) {
        if (p.chainIndex !== 0) continue;
        const c0 = p.color, list3 = [];
        for (let y = 0; y < H3; y++) for (let x = 0; x < W3; x++) { if (gone3[y][x] || col3[y][x] !== c0 || !reach3(y, x)) continue; list3.push([(H3 - 1 - y) + x, y, x]); }
        list3.sort((a, b) => a[0] - b[0]);
        let k3 = 0;
        for (const [, y, x] of list3) {
          if (k3 >= p.count) break;
          gone3[y][x] = true;
          for (let i = 0; i < subs.length; i++) if (subs[i].cells.has(y + ',' + x)) done[i]++;
          k3++;
        }
        let inflight = 0, untouched = 0;
        for (let i = 0; i < subs.length; i++) {
          const r = done[i] / (subs[i].size || 1);
          if (r > 0.02 && r < 0.98) inflight++;
          if (r <= 0.02) untouched++;
        }
        sSum += inflight; sN++;
        uSum += untouched; uMin = Math.min(uMin, untouched);
      }
      if (sN) { subjAvg = sSum / sN; avgUntouched = uSum / sN; minUntouched = uMin; }
    }
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
  // 【2026-11-04 用户】原实现只数"暴露格"（7×7 边框有 24 格 → 动不动报"可选16辆"），
  // 但真正能点的只有 listMoves 过滤 blocked 之后的那几辆（暂存满/链组放不下会被排除）。
  // 现在改用 Simulator 真实逐步模拟：每步看"能吃满的有几种颜色"。
  let good = 0, dead = 0, simErr = null;
  const totalPicks = (o.pickOrder || []).filter(p => p.chainIndex === 0).length;
  {
    const H = g.blocks.length, W = g.blocks[0].length;
    const col = g.blocks.map(r => r.slice());
    const gone = g.blocks.map(r => r.map(() => false));
    const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
      gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
    const Sim = A.Simulator;
    const st = Sim.enter(lv, { useSlotStart: true, instantChain: false });
    const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
    for (const p of picks) {
      if (!st || st.gameOver) break;
      const moves = Sim.listMoves(st).filter(m => !m.blocked);
      // 【2026-11-04 用户定】"没得选"的真口径：
      //   ① 只有 1 辆车能点；或
      //   ② 能点的车都"吃不到什么"（该色可达像素 < 容量的一半）。
      // 注意：5 辆车里 2 辆吃一半、1 辆吃得满 —— 这算**有得选**（看玩家会不会选错）。
      // 所以「能吃满的车有几辆/几种颜色」都不能当判据，要看"能吃到多少"。
      const cnt = {};
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || !reach(y, x)) continue; const cc = col[y][x]; cnt[cc] = (cnt[cc] || 0) + 1; }
      const useful = moves.filter(m => {
        const got = cnt[m.antBox.color] || 0;
        return m.antBox.count > 0 && got / m.antBox.count >= 0.5;   // 能吃到一半以上
      });
      if (moves.length > 1 && useful.length > 0) good++;
      else dead++;
      try { Sim.applyPick(st, p.r, p.c); } catch (e) { simErr = e.message; break; }
      // 同步"已消除"到图上（口径同 corner：按 D 值升序吃）
      const c0 = p.color, list = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue; list.push([(H - 1 - y) + x, y, x]); }
      list.sort((a, b) => a[0] - b[0]);
      let n = 0;
      for (const [, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    }
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
    // 【核心·目标感】主体级：任何时候至少还有几个主体完全没被碰过
    subjAvg == null
      ? ['主体级并行度', true, '识别不出主体（非图库拼图）', true]
      : ['主体并行度≤65%', subjAvg / subjN <= 0.65, (subjAvg.toFixed(2) + '/' + subjN + '，' + Math.round(100 * subjAvg / subjN) + '%')],
    subjAvg == null
      ? ['未动主体数', true, '—', true]
      : ['全程最少未动主体≥1', minUntouched >= 1, '最少 ' + minUntouched + '，平均 ' + avgUntouched.toFixed(2) + '/' + subjN],
    ['玩家后20% at3≥2', pTail3 >= 2, pTail3 + ' 步'],
    ['玩家后20% 连续≥2', pTailRun >= 2, pTailRun],
    // 【2026-11-03 用户选 B】允许玩家死：峰值=4 只约束最优路线，玩家视角放宽到 5。
    ['玩家峰值≤5', pPeak <= 5, pPeak + '（最优路线仍须=4）'],
    // 容错改成区间：100% = 太松（随便玩都能过），<40% = 太脆
    ['容错 55–75%' + (SOFT_TOLERANCE ? '（参考）' : ''), tol >= 11 && tol <= 15, tol + '/20', SOFT_TOLERANCE],
    // 参考项（不判定）：全知最优路线的数据，用来对比"理想 vs 真实"
    ['（参考）最小暂存路线 通/完成', true, (mb.won ? '通' : '不通') + ' ' + mb.done + '/' + mb.total, true],
    ['（参考）求解器路线 中段', true, (() => {
      const ob = (Array.isArray(o.stepBufferHistory) && o.stepBufferHistory.length) ? o.stepBufferHistory : (o.pressureSamples || []).map(x => x.buf || 0);
      const L2 = ob.length, e2 = Math.max(1, Math.round(L2 * 0.1)), t2 = Math.floor(L2 * 0.8);
      return ob.slice(e2, t2).filter(v => v >= 3).length + '/' + (t2 - e2);
    })(), true],
    ['（参考）全知 at4', true, a4, true],
    // 【2026-11-04 用户定】决策度换成更直观的判据：没得选的步数 ≤ 总步数一半
    ['没得选≤一半', dead <= totalPicks / 2, dead + '/' + totalPicks],
    ['（参考）决策度', true, good + '/' + totalPicks, true],
    // 【2026-11-03 用户选 B】改软项：用户已明确「必须选某色解锁不是问题」
    ['没得选', true, dead, true],
    ['at4≥5', a4 >= 5, a4],
    ['可通关（最小路线）', !!mb.won, mb.won ? '✓' : '✗'],
    ['（参考）贪心路线可通关', !!o.completed, o.completed ? '✓' : '✗', true],
    ['无空格', empty === 0, empty],
    ['容量守恒', sum === px, sum + '/' + px],
  ];
  const pass = rules.filter(r => !r[3]).every(r => r[1]);   // r[3]=true 的是软项
  return { f, rules, pass, L };
}

if (require.main === module) {
  let bad = 0;
  for (const f of process.argv.slice(2).filter(x => !x.startsWith('--'))) {
    const r = check(f);
    console.log('\n=== ' + f.split('/').pop() + '（' + r.L + ' 步）===');
    for (const [name, ok, val, soft] of r.rules) console.log('  ' + (soft ? '⚪' : ok ? '✅' : '❌') + ' ' + name.padEnd(16) + String(val));
    console.log('  → ' + (r.pass ? '通过' : '不通过'));
    if (!r.pass) bad++;
  }
  process.exit(bad ? 1 : 0);
}

module.exports = { check };
