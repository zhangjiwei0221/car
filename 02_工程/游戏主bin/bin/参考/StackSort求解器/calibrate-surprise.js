/**
 * StackSort - 问号(Surprise)难度标定（玩家版 A/B，Node 运行）
 *
 * 用法：node calibrate-surprise.js [N] [runsPerMode]
 *   默认 N=20（每密度档生成的可解棋盘数）, runsPerMode=4。
 *
 * 思路（与设计者确认）：问号是"软障碍"——不改变棋盘可解性，只屏蔽玩家可见颜色。
 *   全知版读真色 → 问号对它毫无影响（best 不变）；玩家版被屏蔽 → 成功率下降 + 步数膨胀。
 *   所以问号难度 = 在【同一批棋盘】上，玩家版相对全知版的退化，按"问号密度"纵向标定。
 *
 * 基底 7×7 / 7 色 / 乱序。每档密度生成 N 个可解棋盘，每个棋盘同时跑全知版与玩家版多轮，统计：
 *   全知best | 玩家best | 玩家平均步 | 玩家成功率 | 步数膨胀(玩家avg/全知best) | 关卡级通关率
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { SS: {}, console, Object, JSON, Math };
vm.createContext(ctx);
['colors.js', 'level-loader.js', 'engine.js', 'solver.js', 'analysis.js', 'generator.js', 'player-solver.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', f), 'utf8'), ctx, { filename: f });
});
const E = ctx.SS.Engine, L = ctx.SS.LevelLoader, S = ctx.SS.Solver, A = ctx.SS.Analysis, G = ctx.SS.Generator, P = ctx.SS.PlayerSolver;

const H = 7, K = 7, COLORS = 7, CHAOS = 'high';
const N = parseInt(process.argv[2], 10) || 20;
const RUNS = parseInt(process.argv[3], 10) || 4;
const DENSITIES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];

function emptyCF() { var a = []; for (var c = 0; c < K; c++) a.push([]); return a; }

// 生成一个"指定问号密度"的可解棋盘并同时求解全知/玩家
// 玩家在【真实紧余量】预算下求解（步数上限 = 全知best × (1+marginRatio)），以暴露问号在紧预算下的失败。
function genAndSolve(density, marginRatio) {
  for (var attempt = 0; attempt < 12; attempt++) {
    var board = G.buildColorBoard(H, K, COLORS, CHAOS);
    var nSur = Math.round(density * H * K);
    var cells = [];
    for (var c = 0; c < K; c++) for (var r = 0; r < H; r++) cells.push(c + '_' + r);
    for (var i = cells.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = cells[i]; cells[i] = cells[j]; cells[j] = t; }
    var cellFeatures = {};
    for (var s = 0; s < nSur; s++) cellFeatures[cells[s]] = ['Surprise'];

    var raw = G.buildRaw({ columns: board.columns }, { columnFeatures: emptyCF(), cellFeatures: cellFeatures, dualCells: {}, links: [], bombSteps: null }, H, K, 999, 'surp');
    ctx.SS.Colors.reset();
    var lvl = L.parse(raw);
    var stFree = E.createState(lvl.boards[0], 999);
    if (!S.validateLevel(stFree).valid) continue;

    var ai = A.multiSolve(stFree, RUNS);     // 全知版：求理论最优步（问号不影响）
    if (ai.best == null) continue;

    // 给玩家一个真实紧预算：上限 = 全知best × (1+marginRatio)
    var limit = Math.round(ai.best * (1 + marginRatio));
    var stTight = E.createState(lvl.boards[0], limit);
    var pl = P.multiSolve(stTight, RUNS);    // 玩家版：在紧预算下求解
    return { omniBest: ai.best, limit: limit, plBest: pl.best, plAvg: pl.avg, plSucc: pl.bestModeSucc };
  }
  return null;
}

function measure(density, marginRatio) {
  var got = 0, tries = 0, cap = N * 5;
  var sumOmni = 0, sumPlBest = 0, sumPlAvg = 0, sumPlSucc = 0, plClears = 0, sumInfl = 0, inflN = 0;
  while (got < N && tries < cap) {
    tries++;
    var m = genAndSolve(density, marginRatio);
    if (!m) continue;
    got++;
    sumOmni += m.omniBest;
    sumPlSucc += m.plSucc;
    if (m.plBest != null) {
      plClears++;
      sumPlBest += m.plBest;
      sumPlAvg += m.plAvg;
      sumInfl += m.plAvg / m.omniBest;
      inflN++;
    }
  }
  return {
    samples: got,
    omniBest: got ? sumOmni / got : 0,
    plClearRate: got ? plClears / got : 0,        // 关卡级：玩家版能在紧预算下解出的棋盘比例
    plBest: plClears ? sumPlBest / plClears : 0,
    plAvg: plClears ? sumPlAvg / plClears : 0,
    plSucc: got ? sumPlSucc / got : 0,            // 轮次级平均成功率（紧预算下）
    inflation: inflN ? sumInfl / inflN : 0        // 步数膨胀 = 玩家avg / 全知best
  };
}

const MARGIN = parseFloat(process.argv[4]) || 0.12;  // 玩家步数预算余量 = 全知best × (1+MARGIN)

console.log('问号难度标定（玩家版 A/B）  基底 ' + K + '×' + H + ' / ' + COLORS + '色 / 乱序，N=' + N + '/档，runsPerMode=' + RUNS);
console.log('密度 = 问号格数 / 总格数(' + (H * K) + ')；玩家步数上限 = 全知best × ' + (1 + MARGIN).toFixed(2) + '（真实紧余量）\n');
console.log('密度  | 样本 | 全知best | 玩家best | 玩家avg | 步数膨胀 | 最优模式成功率 | 关卡通关率');
console.log('------|------|----------|----------|---------|----------|----------------|-----------');
var t0 = Date.now();
var rows = [];
DENSITIES.forEach(function (d) {
  var m = measure(d, MARGIN);
  rows.push({ d: d, m: m });
  console.log(
    (d * 100).toFixed(0).padStart(4) + '% | ' +
    String(m.samples).padStart(4) + ' | ' +
    m.omniBest.toFixed(1).padStart(8) + ' | ' +
    (m.plClearRate > 0 ? m.plBest.toFixed(1) : '×').padStart(8) + ' | ' +
    (m.plClearRate > 0 ? m.plAvg.toFixed(1) : '×').padStart(7) + ' | ' +
    (m.inflation > 0 ? (m.inflation.toFixed(2) + '×') : '×').padStart(8) + ' | ' +
    (m.plSucc * 100).toFixed(0).padStart(9) + '% | ' +
    (m.plClearRate * 100).toFixed(0).padStart(9) + '%'
  );
});
console.log('\n总用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

// ---- 难度信号：随密度的成功率下降（紧余量下问号的真实施压）----
console.log('\n=== 问号难度信号（相对 0% 基线，紧余量 +' + (MARGIN * 100).toFixed(0) + '%）===');
var base = rows[0].m;
console.log('密度  | 最优模式成功率下降Δ | 步数膨胀Δ');
rows.forEach(function (row) {
  var dSucc = (base.plSucc - row.m.plSucc) * 100;
  var dInfl = row.m.inflation - (base.inflation || 1);
  console.log(
    (row.d * 100).toFixed(0).padStart(4) + '% | ' +
    (dSucc >= 0 ? '-' : '+') + Math.abs(dSucc).toFixed(0).padStart(3) + ' 分点      | ' +
    (dInfl >= 0 ? '+' : '') + dInfl.toFixed(2)
  );
});
