/**
 * StackSort 玩家版求解器 - 跑分脚本（Node 运行）
 *
 * 用法：node bench-player.js [runsPerMode]
 *   runsPerMode = 每个决策模式重跑次数（默认 20）。
 *
 * 对每关同时跑【全知版】与【玩家版】（屏蔽未揭示问号色），对比：
 *   - 是否通关（玩家保底必须能通关）
 *   - 最优步数（best）与平均步数（avg）
 *   - 成功率（successRate）
 * 重点关注含【问号 / 捆绑】的关卡——玩家数据将用于反推这两类障碍的难度权重。
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { SS: {}, console, Object };
vm.createContext(ctx);
['colors.js', 'level-loader.js', 'engine.js', 'solver.js', 'analysis.js', 'player-solver.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', f), 'utf8'), ctx, { filename: f });
});
const E = ctx.SS.Engine, L = ctx.SS.LevelLoader, S = ctx.SS.Solver, A = ctx.SS.Analysis, P = ctx.SS.PlayerSolver;
const dir = path.join(__dirname, '..', 'levels（实验1-100关）');

const SUPPORTED = { Surprise: 1, Ice: 1, LinkedCards: 1, FixedColor: 1, Rock: 1, Key: 1, Lock: 1, CoveredColor: 1, Bomb: 1 };
const RUNS = parseInt(process.argv[2], 10) || 20;

function rawObstacleTypes(lvl) {
  const s = {};
  lvl.boards.forEach(b => {
    b.columnFeatures.forEach(cf => cf.forEach(f => s[f.type] = 1));
    (b.links || []).forEach(() => s.LinkedCards = 1);
    b.columns.forEach(c => c.tiles.forEach(t => (t.features || []).forEach(x => s[x] = 1)));
  });
  return Object.keys(s);
}

let total = 0, aiSolved = 0, plSolved = 0, plFail = [];
let sumAiBest = 0, sumPlBest = 0, sumAiAvg = 0, sumPlAvg = 0;
const rows = [];
const t0 = Date.now();

for (let i = 1; i <= 100; i++) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, 'level_' + i + '.json'), 'utf8')); }
  catch (e) { continue; }
  ctx.SS.Colors.reset();
  const lvl = L.parse(raw);
  if (lvl.boards.length !== 1) continue;
  if (rawObstacleTypes(lvl).some(o => !SUPPORTED[o])) continue;
  const st = E.createState(lvl.boards[0], lvl.stepCount);
  if (!S.validateLevel(st).valid) continue;

  const obs = A.obstaclesFromState(st);
  total++;

  const ai = A.multiSolve(st, RUNS);          // 全知版
  const pl = P.multiSolve(st, RUNS);          // 玩家版（屏蔽问号）

  if (ai.best != null) { aiSolved++; sumAiBest += ai.best; sumAiAvg += ai.avg; }
  if (pl.best != null) { plSolved++; sumPlBest += pl.best; sumPlAvg += pl.avg; }
  else plFail.push(i);

  const hasSurprise = obs.indexOf('Surprise') !== -1;
  const hasLink = obs.indexOf('LinkedCards') !== -1;
  const mark = (hasSurprise ? '❓' : '') + (hasLink ? '🔗' : '');
  const dStep = (ai.best != null && pl.best != null) ? ('Δ' + (pl.best - ai.best)) : '-';
  const within = (pl.best != null && pl.best <= lvl.stepCount) ? '' : ' ⚠超上限';

  rows.push(
    'L' + String(i).padEnd(3) +
    ' [' + A.obstacleNamesCN(obs).padEnd(14) + ']' + mark.padEnd(4) +
    ' 全知best=' + String(ai.best != null ? ai.best : '×').padEnd(4) +
    ' 玩家best=' + String(pl.best != null ? pl.best : '×').padEnd(4) +
    ' ' + String(dStep).padEnd(5) +
    ' 全知avg=' + String(ai.avg != null ? ai.avg.toFixed(1) : '-').padEnd(6) +
    ' 玩家avg=' + String(pl.avg != null ? pl.avg.toFixed(1) : '-').padEnd(6) +
    ' 玩家成功率=' + (pl.successRate * 100).toFixed(0) + '%' +
    ' 上限' + lvl.stepCount + within
  );
}

rows.forEach(x => console.log(x));
console.log('================ 汇总 (每模式跑' + RUNS + '遍) ================');
console.log('合法可支持关: ' + total);
console.log('全知版通关: ' + aiSolved + '，玩家版通关: ' + plSolved + '，玩家失败: ' + (plFail.length ? plFail.join(' ') : '无'));
if (aiSolved) console.log('全知版 平均最优步数: ' + (sumAiBest / aiSolved).toFixed(2) + '，平均avg: ' + (sumAiAvg / aiSolved).toFixed(2));
if (plSolved) console.log('玩家版 平均最优步数: ' + (sumPlBest / plSolved).toFixed(2) + '，平均avg: ' + (sumPlAvg / plSolved).toFixed(2));
console.log('总用时: ' + (Date.now() - t0) + 'ms');
