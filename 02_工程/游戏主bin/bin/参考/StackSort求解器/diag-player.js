/**
 * 诊断脚本：针对指定关卡，高次重跑玩家版，观察是否仅是低概率 vs 结构性死点。
 * 用法：node diag-player.js [runsPerMode] L1 L2 ...
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { SS: {}, console, Object };
vm.createContext(ctx);
['colors.js', 'level-loader.js', 'engine.js', 'solver.js', 'analysis.js', 'player-solver.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', f), 'utf8'), ctx, { filename: f });
});
const E = ctx.SS.Engine, L = ctx.SS.LevelLoader, S = ctx.SS.Solver, A = ctx.SS.Analysis, P = ctx.SS.PlayerSolver;
const dir = path.join(__dirname, '..', 'levels（实验1-100关）');

const RUNS = parseInt(process.argv[2], 10) || 100;
const targets = process.argv.slice(3).map(x => parseInt(x.replace(/\D/g, ''), 10));

targets.forEach(i => {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'level_' + i + '.json'), 'utf8'));
  ctx.SS.Colors.reset();
  const lvl = L.parse(raw);
  const st = E.createState(lvl.boards[0], lvl.stepCount);
  const obs = A.obstaclesFromState(st);
  const pl = P.multiSolve(st, RUNS);
  const modeStr = Object.keys(pl.byMode || {}).map(function (nm) {
    var b = pl.byMode[nm];
    return nm + ':' + (b.succ * 100).toFixed(0) + '%(best' + (b.best != null ? b.best : '×') + ')';
  }).join('  ');
  console.log('L' + i + ' [' + A.obstacleNamesCN(obs) + '] 尺寸' + st.colCount + 'x' + st.rowCount +
    ' 上限' + lvl.stepCount +
    ' → 玩家best=' + (pl.best != null ? pl.best : '×') +
    ' 最优模式成功率=' + (pl.bestModeSucc * 100).toFixed(0) + '%(' + pl.bestModeName + ')' +
    ' 全模式均=' + (pl.successRate * 100).toFixed(0) + '%');
  console.log('    各模式: ' + modeStr);
});
