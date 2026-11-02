#!/usr/bin/env node
'use strict';
/**
 * CapSpread_v764 —— 容量再分配：让车的大小拉开差距
 *
 * 用户诉求：容量没有死规定，有的车可以小，有的 40+ 都行。
 * 做法：把 --big-colors（通常是背景色）的车两两合并 → 大车；
 *       腾出的格子，从 --small-colors（细节色）里挑车对半拆 → 小车。
 * 守恒：每色容量总和不变；格子数不变（合一辆必拆一辆）。
 *
 * 用法：node CapSpread_v764.js <关卡.json> --out 结果.json --big-colors 31,32 --rounds 8
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--big-colors', '--rounds'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/capspread.json');
const BIG = String(arg('--big-colors', '31,32')).split(',').map(Number).filter(n => n > 0);
const QUAD = String(arg('--quad', ''));   // 按象限分配：如 "tr"=上右合并成大车，"bl"=下左拆成小车
const ROUNDS = Number(arg('--rounds', 8));

const g = B.readJson(FILE);
const rows = g.spools.length, cols = g.spools[0].length;

function carsOf(color) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    if (s && s.id === color) out.push({ r, c, s });
  }
  return out;
}

// 按象限收集车：tl/tr/bl/br
function carsInQuad(q) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    if (!s || !(s.id > 0)) continue;
    const qq = (r < rows / 2 ? 't' : 'b') + (c < cols / 2 ? 'l' : 'r');
    if (qq === q) out.push({ r, c, s });
  }
  return out;
}

let merged = 0, split = 0, freed = [];
// 象限模式：把 --quad 里 "big:tr,b:small:bl" 形式解析出来
if (QUAD) {
  const parts = QUAD.split(',').map(x => x.trim()).filter(Boolean);
  const bigQs = parts.filter(x => x.startsWith('big:')).map(x => x.slice(4));
  const smallQs = parts.filter(x => x.startsWith('small:')).map(x => x.slice(6));
  const bigCars = [];
  for (const q of bigQs) bigCars.push(...carsInQuad(q).sort((a, b) => a.s.count - b.s.count));
  const CAP_MAX = Number(arg('--cap-max', 60));
  for (let i = 0; i + 1 < bigCars.length; i += 2) {
    if (bigCars[i].s.count + bigCars[i + 1].s.count > CAP_MAX) continue;   // 不超上限
    bigCars[i].s.count += bigCars[i + 1].s.count;
    freed.push({ r: bigCars[i + 1].r, c: bigCars[i + 1].c });
    merged++;
  }
  for (const slot of freed) {
    let best = null;
    for (const q of smallQs) for (const cd of carsInQuad(q)) {
      if (cd.s.count < 30) continue;        // 拆完至少还有 15
      if (!best || cd.s.count < best.s.count) best = cd;
    }
    if (!best) break;
    const half = Math.floor(best.s.count / 2);
    best.s.count -= half;
    g.spools[slot.r][slot.c] = { id: best.s.id, type: 0, param: 0, count: half };
    split++;
  }
  fs.writeFileSync(OUT, JSON.stringify(g));
  const cs = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const s = g.spools[r][c]; if (s && s.id > 0) cs.push(s.count); }
  cs.sort((a, b) => a - b);
  console.log(`[象限模式] 合并 ${merged} 对、拆出 ${split} 辆 → 最小${cs[0]} 中位${cs[Math.floor(cs.length / 2)]} 最大${cs[cs.length - 1]} 合计${cs.reduce((a, b) => a + b, 0)}`);
  console.log('已写入', OUT);
  process.exit(0);
}
// 1) 合并大车：同色两两合并，后者变空位
for (const color of BIG) {
  const cars = carsOf(color).sort((a, b) => a.s.count - b.s.count);
  for (let i = 0; i + 1 < cars.length; i += 2) {
    cars[i].s.count += cars[i + 1].s.count;
    freed.push({ r: cars[i + 1].r, c: cars[i + 1].c });
    merged++;
  }
}
// 2) 用小色拆车填空位：找当前最小的车，对半拆出一辆放空位
for (const slot of freed) {
  let best = null;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    if (!s || !(s.id > 0) || s.count < 12) continue;
    const t = Array.isArray(s.type) ? s.type : [s.type || 0];
    if (t.includes(5) || t.includes(7)) continue;
    if (BIG.includes(s.id)) continue;
    if (!best || s.count > best.s.count) best = { r, c, s };
  }
  if (!best) break;
  const half = Math.floor(best.s.count / 2);
  best.s.count -= half;
  g.spools[slot.r][slot.c] = { id: best.s.id, type: 0, param: 0, count: half };
  split++;
}
fs.writeFileSync(OUT, JSON.stringify(g));
const caps = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const s = g.spools[r][c]; if (s && s.id > 0) caps.push(s.count); }
caps.sort((a, b) => a - b);
const sum = caps.reduce((a, b) => a + b, 0);
console.log(`合并 ${merged} 对、拆出 ${split} 辆 → 容量 最小${caps[0]} 中位${caps[Math.floor(caps.length / 2)]} 最大${caps[caps.length - 1]}（合计 ${sum}）`);
console.log('分布:', caps.filter((c, i) => i % 6 === 0).join(','));
console.log('已写入', OUT);
