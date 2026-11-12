#!/usr/bin/env node
'use strict';
/**
 * build_106_variants —— C2 难度标定：106 底座上的 A/B/C/D 变体（2026-11-12）
 *
 * A 底座：不改（已有文件）。
 * B 只放门1：32@(2,6) + 28@(1,6) 同组链（卡片 gate1）。
 * C 门1 + 门2：B + 14@(6,0) + 3@(5,0) 同组链（卡片 gate2）。
 * D 门1 + 把 32 的 3–4 辆车压到门后：
 *   不改容量/颜色/目标图；不用冰；只做整辆车换位（不碰锁链/管道/黑块）。
 *   把早期 32 车 (3,3)/(3,1)/(4,3)/(4,2) 换到行 5–6 的后期车位置。
 *
 * 用法：node build_106_variants.js <base.json> --out <目录>
 */
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('用法: node build_106_variants.js <base.json> --out <目录>'); process.exit(2); }
const OUT = arg('--out', path.dirname(file));
const base = JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const typeList = (c) => Array.isArray(c.type) ? c.type : (c.type === 0 || c.type == null ? [] : [c.type]);
function setChain(cell, gid) {
  const ts = typeList(cell), ice = ts.indexOf(7), q = ts.indexOf(6);
  const nt = [5], np = [gid];
  if (ice >= 0) { nt.push(7); np.push(Array.isArray(cell.param) ? cell.param[ice] : cell.param); }
  if (q >= 0) { nt.push(6); np.push(0); }
  cell.type = nt.length === 1 ? 5 : nt;
  cell.param = np.length === 1 ? gid : np;
}
function swap(g, a, b) { const t = g.spools[a[0]][a[1]]; g.spools[a[0]][a[1]] = g.spools[b[0]][b[1]]; g.spools[b[0]][b[1]] = t; }
function save(name, g) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(g, null, 1));
  const totals = {};
  for (const row of g.spools) for (const c of row) { if (!c || c.id <= 0) continue; totals[c.id] = (totals[c.id] || 0) + c.count; }
  console.log(name, 'colors', JSON.stringify(totals));
}

fs.mkdirSync(OUT, { recursive: true });

// B
const B = clone(base);
setChain(B.spools[2][6], 1);
setChain(B.spools[1][6], 1);
save('B_gate1.json', B);

// C
const C = clone(B);
setChain(C.spools[6][0], 2);
setChain(C.spools[5][0], 2);
save('C_gate12.json', C);

// D
const D = clone(B);
// 4 个换位：早期 32 → 行 5/6 后期位置
swap(D, [3, 3], [6, 3]); // 32/43 ↔ 23/29
swap(D, [3, 1], [6, 1]); // 32/43 ↔ 1/34
swap(D, [4, 3], [6, 4]); // 32/43 ↔ 5/24
swap(D, [4, 2], [5, 6]); // 32/43 ↔ 28/39
save('D_gate1_push32.json', D);

console.log('B chain group1: (2,6)32/43 + (1,6)28/43');
console.log('C chain group1 + group2: (6,0)14/35 + (5,0)3/40');
console.log('D chain group1 + swaps: (3,3)↔(6,3), (3,1)↔(6,1), (4,3)↔(6,4), (4,2)↔(5,6)');
