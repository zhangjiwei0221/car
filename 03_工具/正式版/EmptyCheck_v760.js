#!/usr/bin/env node
'use strict';
/**
 * EmptyCheck_v760 —— 棋盘空格守卫：任何空格（id≤0 且非管道/黑块）都判不合格
 * 用法：node EmptyCheck_v760.js <关卡.json> [...]   （退出码 0=无空格，1=有空格）
 */
const fs = require('fs');
let bad = 0;
for (const f of process.argv.slice(2)) {
  const g = JSON.parse(fs.readFileSync(f, 'utf8'));
  const rows = g.spools.length, cols = g.spools[0].length;
  const empties = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
    const isPipe = t.some(x => x >= 11 && x <= 14);
    const isBlack = s && s.id === -1;
    if (isPipe || isBlack) continue;
    if (!s || !s.id || s.id <= 0) empties.push(`(${r},${c})`);
  }
  console.log(`${f.split('/').pop().padEnd(36)} 空格=${empties.length}${empties.length ? ' → ' + empties.join(' ') : ''}`);
  if (empties.length) bad++;
}
process.exit(bad ? 1 : 0);
