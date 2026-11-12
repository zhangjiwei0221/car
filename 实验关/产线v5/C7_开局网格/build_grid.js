#!/usr/bin/env node
'use strict';
/**
 * build_grid —— C7 开局网格：A（开局可点 4/5/6，数字冰）× B（代价车 0/1/2，换到开局）
 * C7_开局网格（2026-11-12）
 *
 * 用法：
 *   node build_grid.js <base.json> --out <目录>
 *
 * A 用数字冰 type:7 / param:n 锁住第 0 行的部分车（n=1–3，按球数倒计时）。
 *   嵌套：A7 不锁；A6 锁 c6(n=1)；A5 锁 c5(n=2)+c6(n=1)；A4 锁 c4(n=3)+c5(n=2)+c6(n=1)。
 *   被锁的 c4/c5/c6 全是“首点可吃满”的救援车；c3（30/45，ratio=1）永远不锁 → 至少 1 辆救援车。
 * B 把 C5 的零收益+长债务后期色车换到第 0 行（本底座第 0 行是唯一“开局就能点”的行）：
 *   B1：22/14  r6c6 -> r0c0（11/58 回填 r6c6）
 *   B2：+23/29 r6c3 -> r0c1（24/54 回填 r6c3）
 *
 * 只新增 C7 目录内文件；不改 count、不改颜色、不改目标图、不碰锁链/管道/黑块。
 * 每个变体校验：逐色守恒、总像素 2025、49 车、无空格。
 */
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file || file.startsWith('--')) {
  console.error('用法: node build_grid.js <base.json> --out <目录>');
  process.exit(2);
}
const OUT = arg('--out', __dirname);
if (!path.isAbsolute(OUT)) { console.error('OUT 必须绝对路径'); process.exit(2); }
const base = JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

// A 阶梯：冰值（球数倒计时）；只锁第 0 行 c4/c5/c6（均为救援车），c3 恒不锁。
const ICE = {
  7: [],
  6: [{ c: 6, n: 1 }],
  5: [{ c: 5, n: 2 }, { c: 6, n: 1 }],
  4: [{ c: 4, n: 3 }, { c: 5, n: 2 }, { c: 6, n: 1 }]
};
// B 阶梯：只换普通车（type=0），每次 1 辆，嵌套。
const SWAPS = [
  { color: 22, count: 14, from: [6, 6], to: [0, 0], note: '22/14 后期色，开局可达 0；换出 11/58 回填 r6c6' },
  { color: 23, count: 29, from: [6, 3], to: [0, 1], note: '23/29 后期色，开局可达 0；换出 24/54 回填 r6c3' }
];

function swap(g, a, b) {
  const t = g.spools[a[0]][a[1]];
  g.spools[a[0]][a[1]] = g.spools[b[0]][b[1]];
  g.spools[b[0]][b[1]] = t;
}
function colorTotals(g) {
  const t = {};
  for (const row of g.spools) for (const s of row) if (s && s.id > 0) t[s.id] = (t[s.id] || 0) + s.count;
  return t;
}
const baseTotals = colorTotals(base);
const BASE_TOTAL = Object.values(baseTotals).reduce((a, b) => a + b, 0);
const BASE_CARS = base.spools.flat().filter(s => s && s.id > 0).length;
const BASE_EMPTY = base.spools.flat().filter(s => !s || !(s.id > 0)).length;

function verify(g, label) {
  const t = colorTotals(g);
  const keys = new Set([...Object.keys(baseTotals), ...Object.keys(t)]);
  const bad = [];
  for (const k of keys) if ((baseTotals[k] || 0) !== (t[k] || 0)) bad.push(`${k}:${baseTotals[k] || 0}->${t[k] || 0}`);
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  const cars = g.spools.flat().filter(s => s && s.id > 0).length;
  const empty = g.spools.flat().filter(s => !s || !(s.id > 0)).length;
  if (bad.length) throw new Error(`${label} 逐色守恒失败: ${bad.join(',')}`);
  if (total !== BASE_TOTAL) throw new Error(`${label} 总量 ${total} != ${BASE_TOTAL}`);
  if (cars !== BASE_CARS) throw new Error(`${label} 车数 ${cars} != ${BASE_CARS}`);
  if (empty !== BASE_EMPTY) throw new Error(`${label} 空格 ${empty} != ${BASE_EMPTY}`);
  console.log(`${label}: 守恒 ${total}/${BASE_TOTAL}，${cars} 车，空格 ${empty}，逐色 OK`);
}

fs.mkdirSync(OUT, { recursive: true });
const manifest = { base: path.resolve(file), ice: ICE, swaps: SWAPS, variants: {} };
for (const a of [7, 6, 5, 4]) {
  for (const b of [0, 1, 2]) {
    const g = clone(base);
    // B：先换位（前 b 个 swap，嵌套）
    for (let i = 0; i < b; i++) swap(g, SWAPS[i].from, SWAPS[i].to);
    // A：再上数字冰（只动第 0 行，且和目标/来源格不重叠）
    const iceList = [];
    for (const it of ICE[a]) {
      const cell = g.spools[0][it.c];
      if (!cell || !(cell.id > 0)) throw new Error(`A${a}B${b} r0c${it.c} 不是车`);
      cell.type = 7;
      cell.param = it.n;
      iceList.push({ r: 0, c: it.c, color: cell.id, count: cell.count, n: it.n });
    }
    const name = `A${a}_B${b}`;
    verify(g, name);
    fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(g, null, 1));
    manifest.variants[name] = {
      A: a, B: b,
      openingClickTarget: a === 7 ? 7 : a,
      ice: iceList,
      swaps: SWAPS.slice(0, b).map(s => ({ color: s.color, count: s.count, from: s.from, to: s.to })),
      row0: g.spools[0].map((s, c) => ({ c, color: s.id, count: s.count, ice: (Array.isArray(s.type) ? s.type.includes(7) : s.type === 7) ? s.param : 0 }))
    };
  }
}
fs.writeFileSync(path.join(OUT, 'grid_manifest.json'), JSON.stringify(manifest, null, 1));
console.log('\n冰清单（A）：');
for (const a of [7, 6, 5, 4]) console.log(`  A${a}: ` + (ICE[a].length ? ICE[a].map(x => `r0c${x.c} n=${x.n}`).join('，') : '无（对照）'));
console.log('换位清单（B，嵌套）：');
SWAPS.forEach((s, i) => console.log(`  B${i + 1}: ${s.color}/${s.count} r${s.from[0]}c${s.from[1]} -> r${s.to[0]}c${s.to[1]}`));
console.log('\n生成 12 个变体（A=7 三个是对照）:'); console.log(Object.keys(manifest.variants).join(', '));
