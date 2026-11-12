#!/usr/bin/env node
'use strict';
/**
 * build_C3_variants —— C3 后期色前置：106 底座上的 E/F/G（2026-11-12）
 *
 * 后期色定义（按目标图消耗/需求进度 p50，见 说明.md）：
 *   5(0.631) / 3(0.728) / 8(0.789) / 1(0.799) / 23(0.814) / 22(0.903) / 32(0.588)
 *   共 15 辆车。只用整辆车换位；不改容量/颜色/目标图；不用冰；不加链。
 *
 * E 轻度：4 辆后期色车 → 行0–1
 * F 中度：8 辆后期色车 → 行0–2
 * G 重度：12 辆后期色车 → 外圈（行0–2），行0 七格中 7 格为后期色
 *
 * 用法：node build_C3_variants.js <base.json> --out <目录>
 */
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('用法: node build_C3_variants.js <base.json> --out <目录>'); process.exit(2); }
const OUT = arg('--out', path.dirname(file));
const base = JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
function swap(g, a, b) { const t = g.spools[a[0]][a[1]]; g.spools[a[0]][a[1]] = g.spools[b[0]][b[1]]; g.spools[b[0]][b[1]] = t; }
function save(name, g) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(g, null, 1));
  const totals = {};
  for (const row of g.spools) for (const c of row) { if (!c || c.id <= 0) continue; totals[c.id] = (totals[c.id] || 0) + c.count; }
  console.log(name, JSON.stringify(totals));
}
fs.mkdirSync(OUT, { recursive: true });

// 后期车 → 外圈目标格
const E_SWAPS = [
  [[6, 6], [0, 0]], // 22/14 → (0,0)
  [[6, 3], [0, 1]], // 23/29 → (0,1)
  [[6, 1], [0, 2]], // 1/34  → (0,2)
  [[4, 6], [1, 0]], // 8/41  → (1,0)
];
const F_EXTRA = [
  [[5, 0], [0, 3]], // 3/40  → (0,3)
  [[2, 4], [0, 4]], // 5/43  → (0,4)
  [[6, 4], [0, 5]], // 5/24  → (0,5)
  [[2, 6], [1, 1]], // 32/43 → (1,1)
];
const G_EXTRA = [
  [[3, 1], [0, 6]], // 32/43 → (0,6)
  [[3, 3], [1, 2]], // 32/43 → (1,2)
  [[4, 2], [1, 3]], // 32/43 → (1,3)
  [[5, 1], [2, 0]], // 32/43 → (2,0)
];

const E = clone(base);
for (const [a, b] of E_SWAPS) swap(E, a, b);
save('E_light.json', E);

const F = clone(base);
for (const [a, b] of [...E_SWAPS, ...F_EXTRA]) swap(F, a, b);
save('F_medium.json', F);

const G = clone(base);
for (const [a, b] of [...E_SWAPS, ...F_EXTRA, ...G_EXTRA]) swap(G, a, b);
save('G_heavy.json', G);

console.log('E swaps:', E_SWAPS.map(x => x.map(y => y.join(',')).join('↔')).join(' '));
console.log('F adds:', F_EXTRA.map(x => x.map(y => y.join(',')).join('↔')).join(' '));
console.log('G adds:', G_EXTRA.map(x => x.map(y => y.join(',')).join('↔')).join(' '));
