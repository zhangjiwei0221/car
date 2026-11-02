#!/usr/bin/env node
'use strict';
/**
 * Decision_v793 —— 决策度（修正版）
 *
 * v790 的 bug：把"棋盘上剩下所有车"都算成可选，
 * 实际只有"暴露的格子"才能选（第一行/第一列/最后一行/最后一列，
 * 或与已取走的空位相邻）。黑块不算空位、不传播暴露。
 *
 * 每步统计：
 *   可选 = 暴露的车
 *   可吃满 = 其中该色可及像素 ≥ 容量
 *   好决策 = 可选 ≥2 且 可吃满 ≥1 且 可吃满 < 可选（有得选，但要判断）
 *   没得选 = 可吃满 = 0
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const fs = require('fs');

function analyze(f) {
  const g = B.readJson(f);
  const H = g.blocks.length, W = g.blocks[0].length, rows = g.spools.length, cols = g.spools[0].length;
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const col = g.blocks.map(r => r.slice());
  const gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];

  // 棋盘上的"已空"标记（取走的车）
  const takenCell = g.spools.map(r => r.map(() => false));
  const cellOpen = (r, c) => takenCell[r][c];          // 已取走 = 空
  const slotExposed = (r, c) => {
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) return true;
    return cellOpen(r - 1, c) || cellOpen(r + 1, c) || cellOpen(r, c - 1) || cellOpen(r, c + 1);
  };

  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set();
  let good = 0, dead = 0, forced = 0, sumAvail = 0;
  const avs = [];
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || !reach(y, x)) continue;
      const c = col[y][x]; cnt[c] = (cnt[c] || 0) + 1;
    }
    let avail = 0, fill = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c)) continue;
      if (!slotExposed(r, c)) continue;               // 关键修正：只算暴露的
      const t = Array.isArray(s.type) ? s.type : [s.type || 0];
      if (t.includes(7)) continue;
      avail++;
      if (!s.q && (cnt[s.id] || 0) >= s.count) fill++;
    }
    avs.push(avail); sumAvail += avail;
    if (avail >= 2 && fill >= 1 && fill < avail) good++;
    if (fill === 0) dead++;
    if (avail === 1) forced++;
    // 推进
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue;
      list.push([(H - 1 - y) + x, y, x]);
    }
    list.sort((a, b) => a[0] - b[0]); let n = 0;
    for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
    takenCell[p.r][p.c] = true;
  }
  const N = picks.length;
  return { f, N, good, dead, forced, avg: sumAvail / Math.max(1, N), max: Math.max(0, ...avs), won: !!o.completed };
}

for (const f of process.argv.slice(2)) {
  const r = analyze(f);
  console.log(r.f.split('/').slice(-2)[0].padEnd(14) +
    ' 步' + String(r.N).padStart(3) +
    ' | 平均可选 ' + r.avg.toFixed(1).padStart(4) + '（最多 ' + String(r.max).padStart(2) + '）' +
    ' | 好决策 ' + String(r.good).padStart(3) + '/' + r.N +
    ' | 没得选 ' + String(r.dead).padStart(2) +
    ' | 唯一选择 ' + String(r.forced).padStart(2) + ' | 可通' + (r.won ? '✓' : '✗'));
}
