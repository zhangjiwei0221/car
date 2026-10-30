// SizeAdvisor_v723.js —— 尺寸顾问：面积 → 车数/棋盘 → 容量合同（含守恒预检）
// 用法（CLI）：node SizeAdvisor_v723.js --target 关卡/xxx.txt
// 用法（模块）：const { advise } = require('./SizeAdvisor_v723.js')
'use strict';
const fs = require('fs');

function loadMatrix(path) {
  const lines = fs.readFileSync(path, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  const body = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return body.map(l => l.split(/\s+/).map(Number));
}

function colorTotals(g) {
  const t = {};
  for (const row of g) for (const v of row) t[v] = (t[v] || 0) + 1;
  return t;
}

// 核心：给定像素数与用户容量偏好，推荐棋盘与合同
function advise(pixels, opts) {
  opts = opts || {};
  const avgTarget = opts.avg || 28;          // 期望平均容量
  const capMin = opts.capMin || 20;          // 合同下限（用户口径，不缩放）
  const capMax = opts.capMax || 40;          // 合同上限
  let cars = Math.max(1, Math.round(pixels / avgTarget));
  // 选行列：rows*cols >= cars，行列尽量接近，且不超出 cars+4（少留空格）
  let best = null;
  for (let r = 4; r <= 12; r++) {
    const c = Math.ceil(cars / r);
    if (c < 4 || c > 12) continue;
    const cells = r * c;
    const waste = cells - cars;
    const aspect = Math.abs(r - c);
    const score = waste * 3 + aspect;
    if (waste > 6) continue;
    if (!best || score < best.score) best = { rows: r, cols: c, cells, waste, score };
  }
  if (!best) { const r = Math.ceil(Math.sqrt(cars)); best = { rows: r, cols: Math.ceil(cars / r), cells: 0, waste: 0, score: 0 }; }
  best.cells = best.rows * best.cols;
  const avg = pixels / cars;
  const lo = Math.max(capMin, Math.floor(avg * 0.8));
  const hi = Math.min(capMax, Math.ceil(avg * 1.35));
  return {
    pixels, cars, rows: best.rows, cols: best.cols, cells: best.cells,
    avg: Math.round(avg * 10) / 10,
    contract: [lo, hi],
    // 守恒预检：车数×下限 ≤ 像素 ≤ 车数×上限
    conservationOk: cars * lo <= pixels && pixels <= cars * hi,
    demandLo: cars * lo, demandHi: cars * hi
  };
}

function report(path) {
  const g = loadMatrix(path);
  const R = g.length, C = g[0].length;
  const t = colorTotals(g);
  const pixels = R * C;
  const a = advise(pixels);
  const colors = Object.keys(t).length;
  const maxColor = Math.max(...Object.values(t));
  const minColor = Math.min(...Object.values(t));
  console.log(`目标图：${path}（${R}×${C} = ${pixels} px，${colors} 色）`);
  console.log(`  最大色 ${maxColor} px / 最小色 ${minColor} px`);
  console.log(`  建议棋盘 ${a.rows}×${a.cols}（${a.cells} 格）/ 车 ${a.cars} 辆 / 平均 ${a.avg} px`);
  console.log(`  合同 [${a.contract[0]}, ${a.contract[1]}]  需求区间 ${a.demandLo}–${a.demandHi} px`);
  console.log(`  守恒预检：${a.conservationOk ? '✅ 可行' : '❌ 不可行（调棋盘或合同）'}`);
  if (minColor < a.contract[0]) console.log(`  ⚠️ 有颜色只有 ${minColor} px < 合同下限，会被拆成更小的车`);
  return a;
}

if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const t = arg('--target');
  if (!t) { console.log('用法：node SizeAdvisor_v723.js --target 关卡/xxx.txt'); process.exit(1); }
  report(t);
}
module.exports = { advise, loadMatrix, colorTotals, report };
