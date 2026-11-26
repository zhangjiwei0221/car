#!/usr/bin/env node
'use strict';
/**
 * ChokeExplain_v776 —— 卡点归因：每个"吃不满的时刻"到底为什么
 *
 * 用户 2026-11-02：「生成完之后，去说明每个卡点是因为什么，也就是精准造关卡」
 *
 * 输出：对每个 被迫欠债 / 暂存≥3 的步，列出
 *   ① 可点的车、各自缺多少像素
 *   ② 这些颜色的像素分布在哪（几个连通块、被什么挡住）
 *   ③ 一句话结论
 *
 * 用法：node ChokeExplain_v776.js <关卡.json> [--max 12]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--max'].includes(process.argv[process.argv.indexOf(a) - 1]));
const MAX = Number(arg('--max', 12));

const g = B.readJson(FILE);
const H = g.blocks.length, W = g.blocks[0].length, rows = g.spools.length, cols = g.spools[0].length;
const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
const col = g.blocks.map(r => r.slice());
const gone = g.blocks.map(r => r.map(() => false));
const reach = (y, x) => (y === 0 || x === 0 || y === H - 1 || x === W - 1) ||
  gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
const taken = new Set();
const buf = (o.pressureSamples || []).map(s => s.buf || 0);

function colorStats(c) {
  // 该色：总像素、可及像素、连通块数、最大块
  let total = 0, reachN = 0, comps = 0, maxBlk = 0;
  const seen = gone.map(r => r.map(() => false));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (col[y][x] !== c) continue;
    total++;
    if (!gone[y][x] && reach(y, x)) reachN++;
    if (!gone[y][x] && !seen[y][x]) {
      comps++;
      let n = 0; const st = [[y, x]]; seen[y][x] = true;
      while (st.length) {
        const [cy, cx] = st.pop(); n++;
        for (const [dy, dx] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const ny = cy + dy, nx = cx + dx;
          if (ny < 0 || nx < 0 || ny >= H || nx >= W || seen[ny][nx] || col[ny][nx] !== c) continue;
          seen[ny][nx] = true; st.push([ny, nx]);
        }
      }
      maxBlk = Math.max(maxBlk, n);
    }
  }
  return { total, reachN, comps, maxBlk };
}

let shown = 0;
for (let i = 0; i < picks.length && shown < MAX; i++) {
  const p = picks[i];
  // 当前可及的每色像素
  const cnt = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (gone[y][x] || !reach(y, x)) continue;
    const c = col[y][x]; cnt[c] = (cnt[c] || 0) + 1;
  }
  const avail = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    if (!s || !(s.id > 0) || taken.has(r + ',' + c)) continue;
    const need = s.count, has = cnt[s.id] || 0;
    avail.push({ r, c, id: s.id, need, has, deficit: Math.max(0, need - has), q: !!s.q });
  }
  const canFill = avail.filter(a => a.q ? false : a.deficit === 0).length;
  const t = g.spools[p.r][p.c];
  const isForced = canFill === 0;
  const buffer = buf[i] || 0;
  const prevBuf = i > 0 ? (buf[i - 1] || 0) : 0;
  const rose = buffer > prevBuf;
  if (isForced || rose) {
    shown++;
    const pct = Math.round(100 * (i + 1) / picks.length);
    console.log(`\n━━ 第 ${p.step} 步（进度 ${pct}%，暂存 ${prevBuf}→${buffer}）${isForced ? '【无处可逃：没有一辆车能吃满】' : '【暂存上升】'}`);
    if (isForced) {
      const near = avail.filter(a => !a.q).sort((a, b) => a.deficit - b.deficit).slice(0, 3);
      console.log(`   眼前 ${avail.length} 辆可点，能一口吃满的 0 辆。最接近的：`);
      for (const a of near) {
        const st = colorStats(a.id);
        const whyTxt = a.q ? '（问号：看不出来）'
          : (st.comps >= 3 ? `该色被切成 ${st.comps} 块，散在各处`
             : (st.reachN < a.need ? `够得着的只有 ${st.reachN}，要 ${a.need}` : '差一点'));
        console.log(`     (${a.r},${a.c}) 色${String(a.id).padStart(2)} 需要${String(a.need).padStart(2)} 可及${String(a.has).padStart(2)} 缺${String(a.deficit).padStart(2)}  · ${whyTxt}`);
      }
    } else {
      const mine = avail.find(a => a.r === p.r && a.c === p.c) || { id: p.color, need: p.count, has: cnt[p.color] || 0, deficit: Math.max(0, p.count - (cnt[p.color] || 0)) };
      const st = colorStats(mine.id);
      console.log(`   这一步取 (${p.r},${p.c}) 色${mine.id}：需要 ${mine.need}，当时可及 ${mine.has} → 没填满，进了暂存`);
      const whyTxt = st.comps >= 3 ? `该色像素被切成 ${st.comps} 块（最大块 ${st.maxBlk}），散在各处`
        : (st.reachN < mine.need ? `够得着的只有 ${st.reachN}，而车要 ${mine.need}` : '这一手可及像素不足');
      console.log(`   ▶ 原因：${whyTxt}`);
    }
  }
  // 推进
  const c0 = p.color, list = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue;
    list.push([(H - 1 - y) + x, y, x]);
  }
  list.sort((a, b) => a[0] - b[0]);
  let n = 0; for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
  taken.add(p.r + ',' + p.c);
}
