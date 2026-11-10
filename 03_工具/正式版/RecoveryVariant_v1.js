#!/usr/bin/env node
'use strict';
/**
 * RecoveryVariant_v1 —— 方向1：只改恢复/容错（不动目标图、不动每色容量）
 *
 * 模式：
 *   ice50   ：所有数字冰 param 减半；减到 0 就去掉冰
 *   noChain ：所有锁链(type 5)拆成普通车；type [5,6] 保留问号、去掉链
 *   easy    ：ice50 + noChain
 *
 * 只改 spools 里的 type/param；id/count 不变，所以逐色容量守恒不变。
 *
 * 用法：
 *   node RecoveryVariant_v1.js <关卡.json> --mode ice50|noChain|easy --out <变体.json>
 */
const fs = require('fs');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
const mode = arg('--mode', 'easy');
const outFile = arg('--out', null);
if (!levelFile || !outFile) {
  console.error('用法: node RecoveryVariant_v1.js <关卡.json> --mode ice50|noChain|easy --out <变体.json>');
  process.exit(2);
}
const doIce = mode === 'ice50' || mode === 'easy';
const doChain = mode === 'noChain' || mode === 'easy';
const g = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
if (!g || !Array.isArray(g.spools)) throw new Error('不是关卡 JSON');
let iceChanged = 0, chainChanged = 0;
for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
  const s = g.spools[r][c];
  if (!s) continue;
  let type = s.type;
  if (doIce && type === 7) {
    const p = Number(s.param) || 0;
    const np = Math.floor(p / 2);
    if (np <= 0) { s.type = 0; s.param = 0; } else { s.param = np; }
    iceChanged++;
    type = s.type;
  }
  if (doChain) {
    if (type === 5) {
      s.type = 0; s.param = 0; chainChanged++;
    } else if (Array.isArray(type) && type.includes(5)) {
      s.type = type.map(t => t === 5 ? 0 : t);
      s.param = 0;
      chainChanged++;
    }
  }
}
fs.writeFileSync(outFile, JSON.stringify(g));
console.log('已写：' + outFile + '（ice ' + iceChanged + '，chain ' + chainChanged + '）');
