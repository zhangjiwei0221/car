#!/usr/bin/env node
'use strict';
/**
 * 主体体检 v720
 * 目标图 → 每色的区域分散度 + 主体候选 + 包围色唯一性 + 每辆车“需要几个区”。
 *
 * 为什么要这个：
 *   目标图由“主体 + 过渡色”构成。过渡色（如 006 的 31/30/5）全区都是碎块，
 *   车容量一旦超过该色最大连通区，就必须跨区取 —— 玩家开始“赌”。
 *   这个工具把“赌不赌”变成数字：需要几个区。
 *
 * 用法：
 *   node SubjectAudit_v720.js <目标图.txt> [--json]
 *   node SubjectAudit_v720.js --level <关卡.json>   # 同时算每辆车的跨区数
 */
const fs = require('fs');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const li = argv.indexOf('--level');
const levelPath = li >= 0 ? argv[li + 1] : null;
const targetPath = argv.find(a => !a.startsWith('--') && a !== levelPath);
if (!targetPath) { console.error('用法: node SubjectAudit_v720.js <目标图.txt> [--level 关卡.json] [--json]'); process.exit(1); }

function loadTarget(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const rows = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return rows.filter(l => l.trim()).map(l => l.trim().split(/\s+/).map(Number));
}
const g = loadTarget(targetPath);
const R = g.length, C = g[0].length;
const total = {};
for (const row of g) for (const v of row) total[v] = (total[v] || 0) + 1;

// 连通区
const seen = Array.from({ length: R }, () => new Array(C).fill(false));
const regions = {}; // color -> [[cells]]
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  if (seen[r][c]) continue;
  const col = g[r][c];
  const stack = [[r, c]]; seen[r][c] = true; const cells = [];
  while (stack.length) {
    const [y, x] = stack.pop(); cells.push([y, x]);
    for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ny = y + dy, nx = x + dx;
      if (ny >= 0 && nx >= 0 && ny < R && nx < C && !seen[ny][nx] && g[ny][nx] === col) { seen[ny][nx] = true; stack.push([ny, nx]); }
    }
  }
  (regions[col] = regions[col] || []).push(cells);
}
// 包围色统计（4 邻接、异色）
const ring = {};
for (const col of Object.keys(regions)) {
  const nb = {};
  for (const cells of regions[col]) for (const [y, x] of cells) {
    for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ny = y + dy, nx = x + dx;
      if (ny >= 0 && nx >= 0 && ny < R && nx < C && g[ny][nx] !== col) nb[g[ny][nx]] = (nb[g[ny][nx]] || 0) + 1;
    }
  }
  ring[col] = Object.entries(nb).sort((a, b) => b[1] - a[1]);
}
// 每色指标
const colors = Object.keys(total).map(Number).sort((a, b) => total[b] - total[a]).map(col => {
  const rs = regions[col];
  const mx = Math.max(...rs.map(x => x.length));
  return { col, total: total[col], regions: rs.length, maxRegion: mx, maxShare: +(mx / total[col] * 100).toFixed(0), ring: ring[col].slice(0, 3) };
});
// 主体候选：区域数少、最大占比高
const subjects = colors.filter(x => x.maxShare >= 28).map(x => ({ ...x, kind: '主体候选' }));
const halos = colors.filter(x => x.maxShare < 15).map(x => ({ ...x, kind: '过渡/碎色' }));

// 每辆车的“需要几个区”
let carReport = null;
if (levelPath) {
  const Lv = JSON.parse(fs.readFileSync(levelPath, 'utf8'));
  carReport = [];
  for (let r = 0; r < Lv.spools.length; r++) for (let c = 0; c < Lv.spools[r].length; c++) {
    const cell = Lv.spools[r][c];
    if (!(cell.id > 0)) continue;
    const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
    if (t.some(x => x >= 11 && x <= 14)) continue;
    const col = colors.find(x => x.col === cell.id);
    if (!col) continue;
    // 最多能吃到的像素按最大区（保守），跨区数 = ceil(容量 / 最大区)
    const need = Math.ceil(cell.count / col.maxRegion);
    carReport.push({ r, c, color: cell.id, count: cell.count, maxRegion: col.maxRegion, regionsNeeded: need, predictable: need <= 1 });
  }
  carReport.sort((a, b) => b.regionsNeeded - a.regionsNeeded);
}

if (asJson) {
  console.log(JSON.stringify({ target: targetPath, total: total, colors, subjects, halos, cars: carReport }, null, 2));
  process.exit(0);
}

const pad = (s, w) => { s = String(s); const len = [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0); return s + ' '.repeat(Math.max(0, w - len)); };
console.log(`\n目标图：${targetPath}（${R}×${C}，${Object.values(total).reduce((a, b) => a + b, 0)} px）\n`);
console.log(pad('色', 5) + pad('像素', 6) + pad('区数', 5) + pad('最大区', 7) + pad('占比', 5) + pad('判定', 10) + '包围色');
colors.forEach(x => {
  const judge = x.maxShare >= 28 ? '主体' : x.maxShare < 15 ? '过渡/碎' : '中间';
  console.log(pad(x.col, 5) + pad(x.total, 6) + pad(x.regions, 5) + pad(x.maxRegion, 7) + pad(x.maxShare + '%', 5) + pad(judge, 10) + x.ring.map(([k, v]) => `${k}(${v})`).join(' '));
});
console.log(`\n主体候选（最大区占比≥28%）：${subjects.map(s => s.col + '(' + s.maxShare + '%)').join(', ') || '无'}`);
console.log(`过渡/碎色（<15%）：${halos.map(s => s.col + '(' + s.maxShare + '%)').join(', ') || '无'}`);

// 包围色唯一性
const ringMap = {};
subjects.forEach(s => { const top = s.ring[0]; if (top) (ringMap[top[0]] = ringMap[top[0]] || []).push(s.col); });
const dup = Object.entries(ringMap).filter(([, v]) => v.length > 1);
console.log(`\n包围色唯一性：${dup.length ? '⚠️ 有重复 ' + dup.map(([k, v]) => `${k}←${v.join('/')}`).join('; ') : '✅ 每个主体都有独立包围色'}`);

if (carReport) {
  const bad = carReport.filter(x => !x.predictable);
  console.log(`\n车辆“跨区”检查：${carReport.length} 辆，其中 ${bad.length} 辆需要 ≥2 个区（玩家要赌）`);
  bad.slice(0, 12).forEach(x => console.log(`  (${x.r},${x.c}) ${x.color}/${x.count}  最大区 ${x.maxRegion} → 需 ${x.regionsNeeded} 个区`));
  if (bad.length > 12) console.log(`  … 其余 ${bad.length - 12} 辆略`);
}
