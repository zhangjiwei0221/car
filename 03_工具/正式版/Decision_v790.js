#!/usr/bin/env node
'use strict';
/**
 * Decision_v790 —— 决策度：每一步"有得选，但选错要付代价"
 *
 * 每步统计：
 *   可选车数  = 场上暴露的车
 *   可吃满数  = 其中"颜色可及像素 ≥ 容量"的车
 *   陷阱数    = 可选 − 可吃满
 * 决策度（好）：可选 3~10，可吃满 1~2（有选择、但要判断）
 * 决策度（差）：可吃满 0（只能等死）或可吃满 ≈ 可选（随便选都行）
 *
 * 用法：node Decision_v790.js <关卡.json> [...]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const fs = require('fs');

function analyze(f) {
  const g = B.readJson(f);
  const H = g.blocks.length, W = g.blocks[0].length;
  const rows = g.spools.length, cols = g.spools[0].length;
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const col = g.blocks.map(r => r.slice());
  const gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set();
  const steps = [];
  for (const p of picks) {
    // 当前可及像素
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || !reach(y, x)) continue;
      const c = col[y][x]; cnt[c] = (cnt[c] || 0) + 1;
    }
    let avail = 0, fill = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c)) continue;
      const t = Array.isArray(s.type) ? s.type : [s.type || 0];
      if (t.includes(7)) continue;            // 冰未解冻，不可取
      avail++;
      if (!s.q && (cnt[s.id] || 0) >= s.count) fill++;
    }
    steps.push({ avail, fill, trap: Math.max(0, avail - fill) });
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
  const N = steps.length;
  const good = steps.filter(s => s.avail >= 3 && s.fill >= 1 && s.fill <= 2).length;   // 有选择但要判断
  const dead = steps.filter(s => s.fill === 0).length;                                 // 没得选
  const trivial = steps.filter(s => s.fill >= Math.max(3, s.avail * 0.6)).length;       // 随便选
  const avgAvail = steps.reduce((a, s) => a + s.avail, 0) / Math.max(1, N);
  const avgFill = steps.reduce((a, s) => a + s.fill, 0) / Math.max(1, N);
  return { f, N, good, dead, trivial, avgAvail, avgFill, won: !!o.completed };
}

let last = [];
for (const f of process.argv.slice(2)) {
  const r = analyze(f);
  console.log((r.f.split('/').slice(-2)[0]).padEnd(14) + ' 步' + String(r.N).padStart(3) +
    ' | 可选均' + r.avgAvail.toFixed(1).padStart(5) + ' 可吃满均' + r.avgFill.toFixed(1).padStart(4) +
    ' | 好决策 ' + String(r.good).padStart(3) + '/' + r.N +
    ' | 没得选 ' + String(r.dead).padStart(3) + ' | 随便选 ' + String(r.trivial).padStart(3) + ' | 可通' + (r.won ? '✓' : '✗'));
}
