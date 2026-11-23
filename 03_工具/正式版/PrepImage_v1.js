#!/usr/bin/env node
'use strict';
/**
 * PrepImage_v1 —— 造关前的目标图预处理：拆掉「大背景 / 外圈顺手色」（2026-11-23）
 *
 * 背景：SplitLevel_v722 按 minRing 摆盘时，一圈纯色边框的所有车 minRing=0，
 *   会全部堆进第 0–1 排；玩家点掉这几辆就把整圈 27%+ 的像素一次清空 —— 白给层。
 *   摆盘层的「每色每排配额」治标，改图才是治本。
 *
 * 规则（全部写死、可复现）：
 *   1) 触发：外圈（距边 <=1）单色占比 >= --ring-thr（默认 0.40）
 *            或单色总占比 >= --total-thr（默认 0.22）
 *   2) 拆法：外圈按弧段交替改色（段长 --seg，默认 3 格）；
 *            若拆后仍超总占比阈值，再把该色最大的非外圈连通块整块改色（最多 3 次）
 *   3) 替代色：必须是图内已有色、与主色 RGB 距离 >= --min-dist（默认 100，防撞色）、
 *            且自身占比 < 20%
 *   4) 校验：色数不变、每色 >= 8px；打印改前/改后每色占比表
 *
 * 用法：
 *   node PrepImage_v1.js --target <图.txt> --out <新图.txt>
 *        [--seg 3] [--ring-thr 0.40] [--total-thr 0.22] [--min-dist 100]
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TARGET = arg('--target', null);
const OUT = arg('--out', null);
const SEG = Number(arg('--seg', 3));
const RING_THR = Number(arg('--ring-thr', 0.40));
const TOTAL_THR = Number(arg('--total-thr', 0.22));
const MIN_DIST = Number(arg('--min-dist', 100));
if (!TARGET || !OUT) {
  console.error('用法: node PrepImage_v1.js --target <图.txt> --out <新图.txt> [--seg 3] [--ring-thr .40] [--total-thr .22]');
  process.exit(2);
}

// 34 色库 RGB（与 utils.js AntSolver.COLORS 一致）
const HEX = {
  1: '#FF3240', 2: '#FF269F', 3: '#FF5294', 4: '#DF2455', 5: '#FF98A3', 6: '#F63C3F',
  7: '#A073E7', 8: '#E749B6', 9: '#AD00AC', 10: '#C538C3', 11: '#A032DC', 12: '#C60174',
  13: '#00ACF6', 14: '#00E1EF', 15: '#256A85', 16: '#7074B6', 17: '#6F67DC', 18: '#6B5BBA',
  19: '#95E502', 20: '#01CC64', 21: '#00AEAD', 22: '#04DB01', 23: '#02CBA9', 24: '#018441',
  25: '#FFB900', 26: '#C15701', 27: '#FF9F6A', 28: '#FF8002', 29: '#F69602', 30: '#F9DA00',
  31: '#FDE8D6', 32: '#FFEAB2', 33: '#010101', 34: '#BBB6B7'
};
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const colorDist = (a, b) => {
  if (!HEX[a] || !HEX[b]) return 0;
  const A = rgb(HEX[a]), B = rgb(HEX[b]);
  return Math.sqrt((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2);
};

// ---------- 读图 ----------
const rawLines = fs.readFileSync(TARGET, 'utf8').trim().split(/\r?\n/);
const hasHeader = rawLines[0].startsWith('像素');
const header = hasHeader ? rawLines[0] : null;
const mat = (hasHeader ? rawLines.slice(1) : rawLines)
  .filter(l => l.trim())
  .map(l => l.trim().split(/\s+/).map(Number));
const R = mat.length, C = mat[0].length;
const TOTAL = R * C;

// ---------- 统计 ----------
function colorStats(m) {
  const total = {}, ring = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = m[r][c]; if (v > 0) total[v] = (total[v] || 0) + 1;
  }
  const ringPath = [];
  for (let c = 0; c < C; c++) ringPath.push([0, c]);
  for (let r = 1; r < R; r++) ringPath.push([r, C - 1]);
  for (let c = C - 2; c >= 0; c--) ringPath.push([R - 1, c]);
  for (let r = R - 2; r >= 1; r--) ringPath.push([r, 0]);
  for (const [r, c] of ringPath) { const v = m[r][c]; if (v > 0) ring[v] = (ring[v] || 0) + 1; }
  return { total, ring, ringPath };
}
function printStats(m, label) {
  const { total, ring, ringPath } = colorStats(m);
  const rows = Object.entries(total)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `色${k}: ${(n / TOTAL * 100).toFixed(1)}% (环${((ring[k] || 0) / ringPath.length * 100).toFixed(0)}%)`);
  console.log(`  ${label} 色数=${Object.keys(total).length} | ${rows.join(' | ')}`);
  return { total, ring, ringPath };
}

// ---------- 连通块（4 邻接） ----------
function componentsOfColor(m, color) {
  const seen = m.map(row => row.map(() => false));
  const out = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (seen[r][c] || m[r][c] !== color) continue;
    const stack = [[r, c]], cells = [];
    seen[r][c] = true;
    while (stack.length) {
      const [y, x] = stack.pop(); cells.push([y, x]);
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny >= 0 && nx >= 0 && ny < R && nx < C && !seen[ny][nx] && m[ny][nx] === color) {
          seen[ny][nx] = true; stack.push([ny, nx]);
        }
      }
    }
    out.push(cells);
  }
  return out.sort((a, b) => b.length - a.length);
}

// ---------- 主流程 ----------
const before = printStats(mat, '改前:');
const outMat = mat.map(row => row.slice());
const changes = [];

for (let pass = 0; pass < 4; pass++) {
  const { total, ring, ringPath } = colorStats(outMat);
  // 找出最该处理的颜色
  let dom = null, domScore = 0;
  for (const k of Object.keys(total)) {
    const c = +k;
    const ringShare = (ring[c] || 0) / ringPath.length;
    const totalShare = total[c] / TOTAL;
    if (ringShare >= RING_THR || totalShare >= TOTAL_THR) {
      const score = ringShare * 2 + totalShare;
      if (score > domScore) { domScore = score; dom = c; }
    }
  }
  if (dom == null) break;

  // 选替代色：图内已有、RGB 距离够、自身占比 <20%（按距离从远到近，可轮流用 2~3 个）
  const candidates = Object.keys(total).map(Number)
    .filter(c => c !== dom && total[c] / TOTAL < 0.20 && colorDist(c, dom) >= MIN_DIST)
    .sort((a, b) => colorDist(b, dom) - colorDist(a, dom));
  const rep = candidates[0];
  if (!rep) {
    console.log(`  ⚠ 色${dom} 超阈值，但图内找不到视觉可分辨（RGB距离>=${MIN_DIST}）的替代色，跳过`);
    break;
  }

  // 1) 外圈弧段轮流拆色：需要几种颜色才能把单色压到 RING_THR 以内
  const ringShareBefore = (ring[dom] || 0) / ringPath.length;
  let ringChanged = 0;
  if (ringShareBefore >= RING_THR) {
    const palette = [dom].concat(candidates.slice(0, 3)); // [主色, 替代1, 替代2, 替代3]
    const K = Math.max(2, Math.min(palette.length, Math.ceil(1 / RING_THR)));
    for (let i = 0; i < ringPath.length; i++) {
      const segIdx = Math.floor(i / SEG);
      const useColor = palette[segIdx % K];
      const [r, c] = ringPath[i];
      if (outMat[r][c] === dom && useColor !== dom) { outMat[r][c] = useColor; ringChanged++; }
    }
  }
  changes.push({ pass: pass + 1, dom, rep, ringShareBefore: +(ringShareBefore * 100).toFixed(0), ringChanged });

  // 2) 若总占比仍超阈值，再整块重分配最大的非外圈连通块
  const st2 = colorStats(outMat);
  if ((st2.total[dom] || 0) / TOTAL >= TOTAL_THR) {
    const comps = componentsOfColor(outMat, dom);
    let moved = 0;
    for (const comp of comps) {
      if ((st2.total[dom] || 0) - moved <= TOTAL_THR * TOTAL) break;
      // 跳过与外圈相连的块（上面已按弧段处理）
      const touchesRing = comp.some(([y, x]) => y === 0 || x === 0 || y === R - 1 || x === C - 1);
      if (touchesRing) continue;
      for (const [y, x] of comp) outMat[y][x] = rep;
      moved += comp.length;
    }
    if (moved) changes.push({ pass: pass + 1, dom, rep, note: `内部连通块整块改色 ${moved}px` });
  }
}

// ---------- 校验 ----------
const after = colorStats(outMat);
const beforeColors = Object.keys(before.total).sort().join(',');
const afterColors = Object.keys(after.total).sort().join(',');
const minPx = Math.min(...Object.values(after.total));
const okColors = beforeColors === afterColors;
const okMin = minPx >= 8;

console.log('改后:', '');
printStats(outMat, '       ');
console.log('  改动明细:', JSON.stringify(changes));
console.log(`  ✅ 校验: 色数不变=${okColors}(${beforeColors} → ${afterColors}) | 每色>=8px=${okMin}(最小${minPx}px)`);
if (!okColors || !okMin) {
  console.error('  ❌ 校验失败，不写出');
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const body = outMat.map(row => row.join('\t')).join('\n');
fs.writeFileSync(OUT, (header ? header + '\n' : '') + body + '\n');
console.log('已写：' + OUT);
