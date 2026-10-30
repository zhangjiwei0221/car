/**
 * StackSort - 障碍难度标定（A/B 实验，Node 运行）
 *
 * 用法：node calibrate.js <障碍> [N] [runsPerMode]
 *   <障碍> = ice | covered | rock | fixed | keylock | dual | bomb
 *   默认 N=30, runsPerMode=2（≈每关 5模式×2=10 遍求解）
 *
 * 基底 7×7 / 7 色 / 乱序（实验关卡 100 关行列中位数）。每组合生成 N 个【可解】关卡，
 * 统计求解器表现（最优步 / 成功率 / 离散 / 可解率），相对基线反推该障碍各数值的难度。
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { SS: {}, console, Object, JSON, Math };
vm.createContext(ctx);
['colors.js', 'level-loader.js', 'engine.js', 'solver.js', 'analysis.js', 'generator.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', f), 'utf8'), ctx, { filename: f });
});
const E = ctx.SS.Engine, L = ctx.SS.LevelLoader, S = ctx.SS.Solver, A = ctx.SS.Analysis, G = ctx.SS.Generator;

const H = 7, K = 7, COLORS = 7, CHAOS = 'high';
const OBST = (process.argv[2] || 'ice').toLowerCase();
const N = parseInt(process.argv[3], 10) || 30;
const RUNS = parseInt(process.argv[4], 10) || 2;

function emptyCF() { var a = []; for (var c = 0; c < K; c++) a.push([]); return a; }
function buildRawFrom(lvlObj) {
  var cf = (lvlObj.columnFeatures && lvlObj.columnFeatures.length) ? lvlObj.columnFeatures : emptyCF();
  var obs = { columnFeatures: cf, cellFeatures: lvlObj.cellFeatures || {}, dualCells: lvlObj.dualCells || {}, links: lvlObj.links || [], bombSteps: lvlObj.bombSteps || null };
  return G.buildRaw({ columns: lvlObj.columns }, obs, H, K, 999, 'cal');
}

// 各障碍：组合列表 + 构建函数（返回 {columns, columnFeatures,...}）
function combosFor(obst) {
  var list = [];
  if (obst === 'ice') { for (var c = 1; c <= 3; c++) for (var d = 1; d <= 4; d++) list.push({ label: c + '冰×' + d + '步', build: function (c, d) { return function () { return G.buildIceLevel(H, K, COLORS, CHAOS, c, d); }; }(c, d) }); }
  else if (obst === 'covered') { for (var n = 1; n <= 4; n++) list.push({ label: n + '个保护列', build: function (n) { return function () { return G.buildCoveredLevel(H, K, COLORS, CHAOS, n); }; }(n) }); }
  else if (obst === 'bomb') { [1, 2, 3].forEach(function (n) { [20, 40, 60].forEach(function (s) { list.push({ label: n + '炸弹×' + s + '步', build: function (n, s) { return function () { return G.buildBombLevel(H, K, COLORS, CHAOS, n, s); }; }(n, s) }); }); }); }
  else if (obst === 'rock') { for (var n = 1; n <= 3; n++) list.push({ label: n + '个石墙', build: function (n) { return function () { return G.buildRockLevel(H, K, COLORS, CHAOS, n); }; }(n) }); }
  else if (obst === 'fixed') { for (var n = 1; n <= 3; n++) list.push({ label: n + '个限定色', build: function (n) { return function () { return G.buildFixedLevel(H, K, COLORS, CHAOS, n); }; }(n) }); }
  else if (obst === 'keylock') { for (var n = 1; n <= 3; n++) list.push({ label: n + '个锁定列', build: function (n) { return function () { return G.buildKeyLockLevel(H, K, COLORS, CHAOS, n); }; }(n) }); }
  else if (obst === 'dual') { for (var n = 1; n <= 2; n++) list.push({ label: n + '种底色双色块', build: function (n) { return function () { return G.buildDualLevel(H, K, COLORS, CHAOS, n); }; }(n) }); }
  return list;
}

function baselineBuild() { return { columns: G.buildColorBoard(H, K, COLORS, CHAOS).columns, columnFeatures: [] }; }

function genAndSolve(buildFn) {
  for (var attempt = 0; attempt < 12; attempt++) {
    var lvlObj = buildFn();
    ctx.SS.Colors.reset();
    var lvl = L.parse(buildRawFrom(lvlObj));
    var st = E.createState(lvl.boards[0], 999);
    if (!S.validateLevel(st).valid) continue;
    var r = A.multiSolve(st, RUNS);
    if (r.best == null) continue;
    return { best: r.best, successRate: r.successRate, spread: (r.avg - r.best) };
  }
  return null;
}

function measure(buildFn) {
  var got = 0, tries = 0, sumBest = 0, sumSucc = 0, sumSpread = 0, cap = N * 4;
  while (got < N && tries < cap) { tries++; var m = genAndSolve(buildFn); if (m) { got++; sumBest += m.best; sumSucc += m.successRate; sumSpread += m.spread; } }
  return { solvableRate: tries ? got / tries : 0, samples: got, avgBest: got ? sumBest / got : 0, avgSucc: got ? sumSucc / got : 0, avgSpread: got ? sumSpread / got : 0 };
}

console.log('标定障碍=' + OBST + '，基底 ' + K + '×' + H + ' / ' + COLORS + '色 / 乱序，N=' + N + '，runsPerMode=' + RUNS);
var t0 = Date.now();
var base = measure(baselineBuild);
console.log('\n=== 基线（无障碍）===\n可解率' + (base.solvableRate * 100).toFixed(0) + '% 平均最优' + base.avgBest.toFixed(1) + ' 平均成功率' + (base.avgSucc * 100).toFixed(0) + '% 平均离散' + base.avgSpread.toFixed(1));

var combos = combosFor(OBST);
if (!combos.length) { console.log('未知障碍：' + OBST); process.exit(1); }
console.log('\n=== ' + OBST + ' 组合（相对基线Δ）===\n组合 | 可解率 | 平均最优(Δ) | 平均成功率(Δ) | 平均离散(Δ)');
var rows = [];
combos.forEach(function (cb) {
  var m = measure(cb.build);
  var dBest = m.avgBest - base.avgBest, dSucc = (m.avgSucc - base.avgSucc) * 100, dSpread = m.avgSpread - base.avgSpread;
  rows.push({ label: cb.label, m: m, dBest: dBest, dSucc: dSucc, dSpread: dSpread });
  console.log('  ' + cb.label.padEnd(10) + ' | ' + (m.solvableRate * 100).toFixed(0).padStart(4) + '% | ' +
    m.avgBest.toFixed(1).padStart(5) + '(' + (dBest >= 0 ? '+' : '') + dBest.toFixed(1) + ') | ' +
    (m.avgSucc * 100).toFixed(0).padStart(3) + '%(' + (dSucc >= 0 ? '+' : '') + dSucc.toFixed(0) + ') | ' +
    m.avgSpread.toFixed(1).padStart(4) + '(' + (dSpread >= 0 ? '+' : '') + dSpread.toFixed(1) + ')');
});
console.log('\n总用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
