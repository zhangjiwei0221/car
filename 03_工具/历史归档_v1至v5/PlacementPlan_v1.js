#!/usr/bin/env node
'use strict';
/**
 * PlacementPlan_v1 —— 只重排普通车的位置，不改容量/链/冰/管道（v1.5 M2b）
 *
 * 目标：在不删车、不改容量的前提下，打散同色相邻/连线和 30 色大堆。
 * 做法：固定链/冰/管道/问号/黑格；只把普通车（id>0, type=0, 非q）在普通格之间重排；
 *      默认保留 row0 不动（避免破坏开局），用模拟退火降低同色相邻/连线分数。
 *
 * 用法：
 *   node PlacementPlan_v1.js <关卡.json> --out <新关卡.json>
 *        [--seeds 20] [--iters 3000] [--keep-row0 1] [--same-row]
 *
 * 只读输入；输出新关卡。
 */
const fs = require('fs');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.indexOf(k) > 0;

function isPipe(s) { return !!(s && typeof s.type === 'number' && s.type >= 11 && s.type <= 14); }
function isChain(s) { return !!(s && (s.type === 5 || (Array.isArray(s.type) && s.type.includes(5)))); }
function isIce(s) { return !!(s && (s.type === 7 || (Array.isArray(s.type) && s.type.includes(7)))); }
function isPlain(s) { return !!(s && s.id > 0 && s.type === 0 && !s.q); }
function cellKey(r, c) { return r + ',' + c; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

function score(g) {
  const H = g.spools.length, W = g.spools[0].length;
  let adj = 0, run = 0, cluster = 0;
  const colorCells = {};
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const s = g.spools[r][c];
    if (!s || s.id <= 0) continue;
    (colorCells[s.id] = colorCells[s.id] || []).push([r, c]);
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= H || nc >= W) continue;
      const t = g.spools[nr][nc];
      if (t && t.id === s.id) adj++;
    }
  }
  // 同色最大连续（横/竖）
  for (let r = 0; r < H; r++) {
    let cur = 1;
    for (let c = 1; c < W; c++) {
      const a = g.spools[r][c - 1], b = g.spools[r][c];
      if (a && b && a.id === b.id) cur++; else cur = 1;
      if (cur >= 3) run += cur - 2;
    }
  }
  for (let c = 0; c < W; c++) {
    let cur = 1;
    for (let r = 1; r < H; r++) {
      const a = g.spools[r - 1][c], b = g.spools[r][c];
      if (a && b && a.id === b.id) cur++; else cur = 1;
      if (cur >= 3) run += cur - 2;
    }
  }
  // 同色连通块（只按上下左右），块越大罚越多
  for (const color of Object.keys(colorCells)) {
    const set = new Set(colorCells[color].map(([r, c]) => cellKey(r, c)));
    const seen = new Set();
    for (const k of set) {
      if (seen.has(k)) continue;
      let n = 0; const st = [k]; seen.add(k);
      while (st.length) {
        const [r, c] = st.pop().split(',').map(Number); n++;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nk = cellKey(r + dr, c + dc);
          if (set.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); }
        }
      }
      if (n > 3) cluster += (n - 3) * (n - 3);
    }
  }
  return adj * 10 + run * 20 + cluster * 2;
}

function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

function run(g, seeds, iters, keepRow0, sameRow) {
  const H = g.spools.length, W = g.spools[0].length;
  const plain = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (keepRow0 && r === 0) continue;
    if (isPlain(g.spools[r][c])) plain.push([r, c]);
  }
  const byRow = new Map();
  for (const [r, c] of plain) {
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push([r, c]);
  }
  let best = clone(g), bestScore = score(g);
  for (let seed = 1; seed <= seeds; seed++) {
    const random = rng(seed * 7919 + 17);
    const cur = clone(g);
    let curScore = score(cur);
    for (let it = 0; it < iters; it++) {
      const pool = sameRow ? [...byRow.values()] : null;
      let a, b;
      if (sameRow) {
        const rows = [...byRow.keys()];
        if (!rows.length) break;
        const rr = rows[Math.floor(random() * rows.length)];
        const cells = byRow.get(rr);
        if (cells.length < 2) continue;
        a = cells[Math.floor(random() * cells.length)];
        b = cells[Math.floor(random() * cells.length)];
      } else {
        if (plain.length < 2) break;
        a = plain[Math.floor(random() * plain.length)];
        b = plain[Math.floor(random() * plain.length)];
      }
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const ta = cur.spools[a[0]][a[1]], tb = cur.spools[b[0]][b[1]];
      if (!isPlain(ta) || !isPlain(tb)) continue;
      cur.spools[a[0]][a[1]] = tb;
      cur.spools[b[0]][b[1]] = ta;
      const ns = score(cur);
      const t = 0.5 * (1 - it / iters) + 0.02;
      if (ns <= curScore || random() < Math.exp((curScore - ns) / (t * 1000))) {
        curScore = ns;
      } else {
        cur.spools[a[0]][a[1]] = ta;
        cur.spools[b[0]][b[1]] = tb;
      }
    }
    if (curScore < bestScore) { best = clone(cur); bestScore = curScore; }
  }
  return { level: best, before: score(g), after: bestScore, plainCells: plain.length };
}

function main() {
  const file = process.argv[2];
  const out = arg('--out', null);
  const seeds = Number(arg('--seeds', 20)) || 20;
  const iters = Number(arg('--iters', 3000)) || 3000;
  const keepRow0 = !has('--no-keep-row0');
  const sameRow = has('--same-row');
  if (!file || !out) { console.error('用法: node PlacementPlan_v1.js <关卡.json> --out <新关卡.json> [--seeds 20] [--iters 3000] [--no-keep-row0] [--same-row]'); process.exit(2); }
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = run(g, seeds, iters, keepRow0, sameRow);
  fs.writeFileSync(out, JSON.stringify(r.level));
  console.log(`已写 ${out}；同色分 ${r.before} → ${r.after}；可重排普通格 ${r.plainCells} 个`);
}

if (require.main === module) main();
module.exports = { score, run };
