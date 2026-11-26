#!/usr/bin/env node
'use strict';
/**
 * TargetReachCurve_v1 —— 目标图自身的“开图曲线”（不含棋盘/车）
 *
 * 按“每次取一个颜色、消掉它当前全部可达像素”的开图模型（乐观上界），记录每色在每一步的：
 *   - reach：该色当前可达、未消的像素数
 *   - elim ：该色已消像素数
 * 用途：判断框色/颜色在“第 N 步”能露出多少，给门的落位/时机和容量上限一个下界。
 * 注意：这是“所有颜色按 D 顺序一起消”的乐观开图曲线，真实棋盘/车序会更慢；只作下界/排序。
 *
 * 用法：node TargetReachCurve_v1.js <目标图.txt> [--out 报告.json] [--steps 40]
 */
const fs = require('fs');

function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  const rows = [];
  for (const line of lines) { const t = line.trim(); if (!t || /[^\d\s]/.test(t)) continue; rows.push(t.split(/\s+/).map(Number)); }
  return rows;
}
function arg(k, d) { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }

function main() {
  const file = process.argv[2];
  if (!file) { console.error('用法: node TargetReachCurve_v1.js <目标图.txt> [--out 报告.json] [--steps 40]'); process.exit(2); }
  const out = arg('--out', ''), maxSteps = +arg('--steps', '40');
  const b = parse(file), H = b.length, W = b[0].length;
  const elim = Array.from({ length: H }, () => Array(W).fill(false));
  const total = {}, gone = {}, reach = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = b[y][x]; if (c > 0) total[c] = (total[c] || 0) + 1; }
  const reachable = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 || elim[y - 1][x] || elim[y + 1][x] || elim[y][x - 1] || elim[y][x + 1];
  const scanReach = () => {
    for (const c of Object.keys(total)) reach[c] = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (elim[y][x] || !reachable(y, x)) continue;
      const c = b[y][x]; if (c > 0) reach[c]++;
    }
  };
  const stepRow = (step) => ({
    step,
    reach: { ...reach }, gone: { ...gone }
  });
  const rows = [];
  scanReach();
  rows.push(stepRow(0));
  // 按“每次取一个颜色、消掉它当前全部可达像素”的开图模型（乐观上界）
  for (let step = 1; step <= maxSteps; step++) {
    let pickColor = null, pickD = Infinity;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (elim[y][x] || b[y][x] <= 0 || !reachable(y, x)) continue;
      const d = (H - 1 - y) + x;
      if (d < pickD) { pickD = d; pickColor = b[y][x]; }
    }
    if (pickColor == null) break;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (elim[y][x] || b[y][x] !== pickColor || !reachable(y, x)) continue;
      elim[y][x] = true; gone[pickColor] = (gone[pickColor] || 0) + 1;
    }
    scanReach();
    rows.push(stepRow(step));
  }
  const colors = Object.keys(total).map(Number).sort((a, b) => total[b] - total[a]);
  const summary = colors.map(c => {
    const firstReach = rows.find(r => (r.reach[c] || 0) > 0);
    const steps = [0, 5, 10, 15, 20, 25, 30];
    return {
      color: c, total: total[c],
      firstReachStep: firstReach ? firstReach.step : null,
      reachAt: Object.fromEntries(steps.map(s => [s, rows[s] ? (rows[s].reach[c] || 0) : null])),
      goneAt: Object.fromEntries(steps.map(s => [s, rows[s] ? (rows[s].gone[c] || 0) : null]))
    };
  });
  console.log('=== ' + file.split('/').pop() + ' ===');
  console.log('色 总px 首次可达步 reach@0/5/10/15/20/25/30');
  for (const s of summary) {
    console.log(' ' + String(s.color).padEnd(3) + String(s.total).padEnd(5) + String(s.firstReachStep).padEnd(6) +
      [0, 5, 10, 15, 20, 25, 30].map(x => s.reachAt[x]).join('/'));
  }
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ tool: 'TargetReachCurve_v1', target: file, rows: rows.slice(0, Math.min(maxSteps, H * W) + 1), summary }, null, 2));
    console.log('已写：' + out);
  }
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
