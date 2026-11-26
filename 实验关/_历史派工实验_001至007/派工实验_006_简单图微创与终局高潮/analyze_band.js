#!/usr/bin/env node
'use strict';
/**
 * analyze_band.js —— 对比两张 32×32 图：色数/总像素/最大连通块/改动像素/ASCII 对照
 * 用法: node analyze_band.js <原图.txt> <新图.txt> [输出txt]
 */
const fs = require('fs');
const [A, B, OUT] = process.argv.slice(2);
if (!A || !B) { console.error('用法: node analyze_band.js <原图> <新图> [输出]'); process.exit(2); }
function load(p) {
  const ls = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const body = ls[0].startsWith('像素') ? ls.slice(1) : ls;
  return body.filter(l => l.trim()).map(l => l.trim().split(/\s+/).map(Number));
}
function comps(m) {
  const R = m.length, C = m[0].length, seen = m.map(r => r.map(() => false)), out = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (seen[r][c]) continue;
    const col = m[r][c], st = [[r, c]], cells = [];
    seen[r][c] = true;
    while (st.length) {
      const [y, x] = st.pop(); cells.push([y, x]);
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny >= 0 && nx >= 0 && ny < R && nx < C && !seen[ny][nx] && m[ny][nx] === col) { seen[ny][nx] = true; st.push([ny, nx]); }
      }
    }
    out.push({ color: col, cells });
  }
  return out.sort((a, b) => b.cells.length - a.cells.length);
}
function stats(m) {
  const cnt = {};
  for (const row of m) for (const v of row) cnt[v] = (cnt[v] || 0) + 1;
  const cs = comps(m);
  const mx = cs[0];
  const ys = mx.cells.map(p => p[0]);
  return { total: m.length * m[0].length, colors: Object.keys(cnt).length, cnt, max: mx, minRow: Math.min(...ys), maxRow: Math.max(...ys), comps: cs };
}
const a = stats(load(A)), b = stats(load(B));
const lines = [];
lines.push(`原图 ${A}: 像素=${a.total} 色数=${a.colors} 最大连通块=${a.max.cells.length}px(色${a.max.color}, 行${a.minRow}..${a.maxRow})`);
lines.push(`新图 ${B}: 像素=${b.total} 色数=${b.colors} 最大连通块=${b.max.cells.length}px(色${b.max.color}, 行${b.minRow}..${b.maxRow})`);
const keys = [...new Set([...Object.keys(a.cnt), ...Object.keys(b.cnt)])].map(Number).sort((x, y) => x - y);
lines.push('逐色像素: ' + keys.map(k => `${k}:${a.cnt[k] || 0}→${b.cnt[k] || 0}`).join(' '));
const changed = [];
const raw = load(A), raw2 = load(B);
for (let r = 0; r < raw.length; r++) for (let c = 0; c < raw[0].length; c++) if (raw[r][c] !== raw2[r][c]) changed.push([r, c, raw[r][c], raw2[r][c]]);
lines.push(`改动像素=${changed.length} 行=${[...new Set(changed.map(x => x[0]))].join(',')} 列=${Math.min(...changed.map(x => x[1]))}..${Math.max(...changed.map(x => x[1]))}`);
const adj = changed.length ? Math.max(0, Math.min(...changed.map(x => x[0])) - 2) : 0;
const adjEnd = changed.length ? Math.min(raw.length - 1, Math.max(...changed.map(x => x[0])) + 2) : 0;
lines.push('');
lines.push(`ASCII 对照（行 ${adj}..${adjEnd}，色号两位；新图有改动处用 [] 标出）：`);
for (let r = adj; r <= adjEnd; r++) {
  const left = raw[r].map((v, c) => String(v).padStart(2, ' ')).join(' ');
  const right = raw2[r].map((v, c) => (raw[r][c] !== v ? '[' + String(v).padStart(2, ' ') + ']' : ' ' + String(v).padStart(2, ' '))).join(' ');
  lines.push(`r${String(r).padStart(2, ' ')} 原: ${left}`);
  lines.push(`    新: ${right}`);
}
const text = lines.join('\n');
console.log(text);
if (OUT) fs.writeFileSync(OUT, text + '\n');
