#!/usr/bin/env node
'use strict';
/**
 * PipeConvert_v772 —— 把车变成管道（1 球），棋盘不留空格
 *
 * 原理：车和管道占同一个格子 → 格子总数不变 → 不会产生空格。
 *       车变成管道后，它的颜色/容量进入队列(param)，等"前方格变空"才吐出来 → 出场被推迟。
 *
 * 用法：node PipeConvert_v772.js <关卡.json> --out 结果.json [--count 2]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--count', '--ref'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/pipe.json');
const WANT = Number(arg('--count', 2));
const DIRS = [[11, -1, 0], [12, 0, 1], [13, 1, 0], [14, 0, -1]];

function stats(g) {
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const H = g.blocks.length, W = g.blocks[0].length, rows = g.spools.length, cols = g.spools[0].length;
  const col = g.blocks.map(r => r.slice()), gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => (y === 0 || x === 0 || y === H - 1 || x === W - 1) || gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set(); let forced = 0;
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || !reach(y, x)) continue; const c = col[y][x]; cnt[c] = (cnt[c] || 0) + 1; }
    let canFill = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c) || s.q) continue;
      if ((cnt[s.id] || 0) >= s.count) canFill++;
    }
    if (canFill === 0) forced++;
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue; list.push([(H - 1 - y) + x, y, x]); }
    list.sort((a, b) => a[0] - b[0]);
    let n = 0; for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
  }
  let empty = 0, sum = 0, pipes = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
    if (t.some(x => x >= 11 && x <= 14)) {
      pipes++;
      (Array.isArray(s.param) ? s.param : []).forEach(b => sum += (b.count || 0));
      continue;
    }
    if (s && s.id === -1) continue;
    if (!s || !s.id || s.id <= 0) { empty++; continue; }
    sum += s.count;
  }
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  return { forced, steps: picks.length, won: !!o.completed, peak: Math.max(0, ...buf), empty, sum, pipes };
}

const g = B.readJson(FILE);
const base = stats(g);
console.log(`基线：被迫欠债 ${base.forced}/${base.steps}(${Math.round(100*base.forced/base.steps)}%) 峰值 ${base.peak} 空格 ${base.empty} 容量 ${base.sum} 管道 ${base.pipes}`);
const rows = g.spools.length, cols = g.spools[0].length;
let added = 0;
for (let r = 0; r < rows && added < WANT; r++) for (let c = 0; c < cols && added < WANT; c++) {
  const s = g.spools[r][c];
  if (!s || !(s.id > 0)) continue;
  const t = Array.isArray(s.type) ? s.type : [s.type || 0];
  if (t.includes(5) || t.includes(7) || t.includes(13) || s.q) continue;
  // 至少一侧要有邻居车（前方格将来能变空）
  const dir = DIRS.find(([code, dr, dc]) => {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) return false;
    const nb = g.spools[nr][nc];
    return nb && nb.id > 0;
  });
  if (!dir) continue;
  const old = JSON.parse(JSON.stringify(s));
  g.spools[r][c] = { id: 0, type: dir[0], param: [{ id: s.id, count: s.count }], count: 0 };
  const m = stats(g);
  if (m.won && m.peak <= 4 && m.empty === 0 && m.sum === base.sum && m.forced >= base.forced - 1) {
    added++; console.log(`  管道 @(${r},${c}) dir=${dir[0]} 球=色${old.id}×${old.count} → 被迫欠债 ${m.forced} 峰值${m.peak} 空格${m.empty}`);
  } else {
    g.spools[r][c] = old;
  }
}
const fin = stats(g);
fs.writeFileSync(OUT, JSON.stringify(g));
console.log(`结果：加 ${added} 个管道 → 被迫欠债 ${fin.forced}/${fin.steps}(${Math.round(100*fin.forced/fin.steps)}%) 峰值 ${fin.peak} 空格 ${fin.empty} 容量 ${fin.sum}`);
console.log('已写入', OUT);
