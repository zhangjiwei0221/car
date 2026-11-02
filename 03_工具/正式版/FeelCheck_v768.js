#!/usr/bin/env node
'use strict';
/**
 * FeelCheck_v768 —— 【正式验收】玩家感受：被迫欠债步数
 *
 * 定义：某一步「没有任何一辆车能一口吃满」→ 玩家只能吃不满 → 被迫欠债。
 * 这个指标直接对应玩家体感，替代（或补充）buffer 契约。
 *
 * 合格线（用户 2026-11-02 定）：
 *   ① 前 20% 的被迫欠债 ≤ 1 步（开局别压）
 *   ② 全程被迫欠债 ≥ 30%
 *   ③ 峰值 ≤ 4、可通关
 *
 * 用法：node FeelCheck_v768.js <关卡.json> [...]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const MIN_TOTAL = 0.30;   // 全程被迫欠债比例下限
const MAX_EARLY = 1;      // 前 20% 被迫欠债步数上限

function check(f) {
  const g = B.readJson(f);
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const H = g.blocks.length, W = g.blocks[0].length, rows = g.spools.length, cols = g.spools[0].length;
  const col = g.blocks.map(r => r.slice());
  const gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => (y === 0 || x === 0 || y === H - 1 || x === W - 1) ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set();
  const per = [];
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || !reach(y, x)) continue;
      const c = col[y][x]; cnt[c] = (cnt[c] || 0) + 1;
    }
    let canFill = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c) || s.q) continue;   // 问号=玩家不知道 → 不算免费
      if ((cnt[s.id] || 0) >= s.count) canFill++;
    }
    per.push(canFill);
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue;
      list.push([(H - 1 - y) + x, y, x]);
    }
    list.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
  }
  const N = per.length || 1;
  const earlyN = Math.max(1, Math.floor(N * 0.2));
  const forced = per.filter(v => v === 0).length;
  const earlyForced = per.slice(0, earlyN).filter(v => v === 0).length;
  const tail = per.slice(Math.floor(N * 0.8));
  const tailForced = tail.filter(v => v === 0).length;
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const peak = Math.max(0, ...buf);
  const ok = o.completed && peak <= 4 && earlyForced <= MAX_EARLY && forced / N >= MIN_TOTAL;
  return { forced, N, ratio: forced / N, earlyForced, tailForced, peak, won: !!o.completed, ok };
}

let bad = 0;
for (const f of process.argv.slice(2)) {
  const r = check(f);
  const name = f.split('/').pop();
  console.log(`${name.padEnd(38)} 被迫欠债 ${String(r.forced).padStart(2)}/${r.N} 步(${Math.round(r.ratio * 100)}%) | 前20% ${r.earlyForced} 步 | 后20% ${r.tailForced} 步 | 峰值${r.peak} | 可通${r.won ? '✓' : '✗'} → ${r.ok ? '✅ 合格' : '❌ 不合格'}`);
  if (!r.ok) bad++;
}
process.exit(bad ? 1 : 0);
