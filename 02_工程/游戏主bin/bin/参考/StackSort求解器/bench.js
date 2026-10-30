/**
 * StackSort 求解器 - 跑分 / A-B + 决策分发基准脚本（Node 运行）
 *
 * 用法：node bench.js [runsPerMode]
 *   runsPerMode = 每个决策模式的重跑次数（默认 8）。
 *
 * 用 solveTagged：对每关打"障碍组合标签"，跑所有决策模式取最优，记忆胜出模式。
 * 输出：每关最优步数 + 胜出模式 + 各模式步数 + 标签；全局通关率、平均步数、各标签胜出模式统计。
 * 用途：换策略前后各跑一次，对比"平均最优步数"与"各类型胜出模式"评估策略（A/B）。
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { SS: {}, console };
vm.createContext(ctx);
['colors.js', 'level-loader.js', 'engine.js', 'solver.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', f), 'utf8'), ctx, { filename: f });
});
const E = ctx.SS.Engine, L = ctx.SS.LevelLoader, S = ctx.SS.Solver;
const dir = path.join(__dirname, '..', 'levels（实验1-100关）');

const SUPPORTED = { Surprise: 1, Ice: 1, LinkedCards: 1, FixedColor: 1, Rock: 1, Key: 1, Lock: 1, CoveredColor: 1, Bomb: 1 };
const RUNS = parseInt(process.argv[2], 10) || 8;

function obstaclesOf(lvl) {
  const s = {};
  lvl.boards.forEach(b => {
    b.columnFeatures.forEach(cf => cf.forEach(f => s[f.type] = 1));
    (b.links || []).forEach(() => s.LinkedCards = 1);
    b.columns.forEach(c => c.tiles.forEach(t => (t.features || []).forEach(x => s[x] = 1)));
  });
  return Object.keys(s).sort();
}

let solved = 0, total = 0, sumBest = 0, fail = [];
const tagWin = {};   // tag -> { mode: count } 各标签胜出模式统计
const t0 = Date.now();
const rows = [];

for (let i = 1; i <= 100; i++) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, 'level_' + i + '.json'), 'utf8')); }
  catch (e) { continue; }
  ctx.SS.Colors.reset();
  const lvl = L.parse(raw);
  if (lvl.boards.length !== 1) continue;
  if (obstaclesOf(lvl).some(o => !SUPPORTED[o])) continue;
  const st = E.createState(lvl.boards[0], lvl.stepCount);
  if (!S.validateLevel(st).valid) continue;

  total++;
  const r = S.solveTagged(st, { runsPerMode: RUNS });
  if (r.solved) {
    solved++;
    sumBest += r.steps;
    const within = r.steps <= lvl.stepCount ? '' : ' ⚠超上限';
    (tagWin[r.tag] = tagWin[r.tag] || {})[r.mode] = (tagWin[r.tag][r.mode] || 0) + 1;
    rows.push('L' + String(i).padEnd(3) + ' 步' + String(r.steps).padEnd(4) +
      '上限' + String(lvl.stepCount).padEnd(4) + within.padEnd(7) +
      ' 模式=' + String(r.mode).padEnd(7) +
      ' byMode=' + JSON.stringify(r.byMode) + ' [' + r.tag + ']');
  } else {
    fail.push(i);
  }
}

rows.forEach(x => console.log(x));
console.log('================ 汇总 (每模式跑' + RUNS + '遍) ================');
console.log('合法可支持关: ' + total + '，通关: ' + solved + '，失败: ' + (fail.length ? fail.join(' ') : '无'));
console.log('平均最优步数: ' + (sumBest / solved).toFixed(2));
console.log('--- 各障碍标签的胜出决策模式 ---');
Object.keys(tagWin).sort().forEach(tag => console.log('  ' + tag + ' -> ' + JSON.stringify(tagWin[tag])));
console.log('总用时: ' + (Date.now() - t0) + 'ms');
