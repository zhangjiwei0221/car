/**
 * StackSort - 炸弹难度回测/标定脚本（Node 运行，零依赖）
 *
 * 目的：为"重新标定炸弹难度权重"产出数据。生成两批含炸弹关卡，逐关跑全知版/玩家版多轮求解，
 *       记录【紧迫度(urgency)、炸弹数量、位置(明牌/隐藏列)、计时模式、成功率、步数离散、当前难度分】等，
 *       输出 CSV 供分析炸弹参数 → 真实难度的关系，回归出权重。
 *
 *   第一批：纯炸弹关（不同数量/不同倒计时，明牌）
 *   第二批：炸弹 + 混合障碍关（冰块/石墙/保护列/锁定列；炸弹明牌 + 隐藏列·全局 + 隐藏列·独立计时）
 *
 * 用法：node calibrate-bomb.js [纯炸弹关数=100] [混合关数=100] [每关求解轮数=12]
 * 输出：./炸弹回测数据.csv
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = __dirname;
const ctx = { SS: {}, console, Math, Date, JSON, Object, Array };
vm.createContext(ctx);
['colors.js', 'level-loader.js', 'engine.js', 'solver.js', 'player-solver.js', 'analysis.js', 'generator.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
});
const G = ctx.SS.Generator, L = ctx.SS.LevelLoader, E = ctx.SS.Engine, A = ctx.SS.Analysis, P = ctx.SS.PlayerSolver;

const PURE_N = parseInt(process.argv[2], 10) || 100;
const MIXED_N = parseInt(process.argv[3], 10) || 100;
const MEAS_RUNS = parseInt(process.argv[4], 10) || 12;

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// 从 rec.raw 取每弹倒计时/计时模式 + 步数上限
function bombsOf(raw) {
  var data = raw.data || raw;
  var sc = data.endConditions[0].stepCount;
  var grid = data.boards[0].grids[0];
  var bombs = [];
  grid.columns.forEach(function (col, c) {
    (col.layers[0].tiles || []).forEach(function (t, r) {
      (t.features || []).forEach(function (f) {
        if (f.type === 'Bomb') bombs.push({ c: c, r: r, cd: f.endCondition.stepCount, timing: f.timing || 'global' });
      });
    });
  });
  return { sc: sc, bombs: bombs };
}

// 在【真实步数上限 + 真实倒计时】下测量求解表现
function measure(raw) {
  ctx.SS.Colors.reset();
  var lvl = L.parse(raw);
  var st = E.createState(lvl.boards[0], lvl.stepCount);
  var omni = A.multiSolve(st, MEAS_RUNS, 20);
  var player = null;
  try { player = P.multiSolve(st, MEAS_RUNS); } catch (e) { player = null; }
  return { omni: omni, player: player };
}

var rows = [];
var header = ['idx', 'type', 'H', 'K', 'color', 'obstacles', 'bombCount', 'bombHidden', 'bombTiming',
  'sc', 'best', 'minCd', 'avgCd', 'urgencyMin', 'urgencySum', 'curBombDiff',
  'omniSucc', 'omniBest', 'omniAvgSteps', 'omniSpread', 'playerSucc', 'playerBest', 'playerAvgSteps',
  'difficulty', 'level', 'diffObs', 'diffPressure'];
rows.push(header.join(','));

function record(idx, type, params, rec) {
  var raw = rec.raw;
  var bi = bombsOf(raw);
  if (!bi.bombs.length) return false;
  var sc = bi.sc, best = rec.best;
  var cds = bi.bombs.map(function (b) { return b.cd; });
  var minCd = Math.min.apply(null, cds), avgCd = cds.reduce(function (a, b) { return a + b; }, 0) / cds.length;
  var urgencyMin = clamp((best - minCd) / best, 0, 1);
  var urgencySum = bi.bombs.reduce(function (s, b) { return s + clamp((best - b.cd) / best, 0, 1); }, 0);
  var curBombDiff = urgencySum * 12;     // 当前权重公式：每弹 紧迫度×12
  var m = measure(raw);
  var omniSucc = m.omni && m.omni.successRate != null ? m.omni.successRate : '';
  var omniBest = m.omni ? m.omni.best : '';
  var omniAvg = m.omni && m.omni.avg != null ? m.omni.avg : '';
  var omniSpread = (m.omni && m.omni.avg != null && best > 0) ? clamp((m.omni.avg - best) / best, 0, 2) : '';
  var pSucc = m.player && m.player.successRate != null ? m.player.successRate : '';
  var pBest = m.player ? m.player.best : '';
  var pAvg = m.player && m.player.avg != null ? m.player.avg : '';
  var parts = rec.parts || {};
  rows.push([idx, type, params.H, params.K, params.colorCount,
    (rec.obs || []).join('|'), bi.bombs.length,
    params.opts.bombHidden ? 1 : 0, (bi.bombs[0] && bi.bombs[0].timing) || 'global',
    sc, best, minCd, avgCd.toFixed(1), urgencyMin.toFixed(3), urgencySum.toFixed(3), curBombDiff.toFixed(2),
    fmt(omniSucc), omniBest, fmt(omniAvg), fmt(omniSpread), fmt(pSucc), pBest, fmt(pAvg),
    rec.difficulty, rec.level, parts.obs != null ? parts.obs : '', parts.pressure != null ? parts.pressure : ''
  ].join(','));
  return true;
}
function fmt(x) { return (typeof x === 'number') ? (Math.round(x * 1000) / 1000) : x; }

function gen(combo, opts, H, K, colorCount) {
  return G.generateOne({
    H: H, K: K, colorCount: colorCount, chaos: 'high', combo: combo,
    difficultyMin: 0, difficultyMax: 100, minMargin: 0, maxMargin: 20,
    runsPerMode: 6, maxAttempts: 20, name: 'cal', opts: opts
  });
}

var t0 = Date.now();
var sizes = [[5, 5], [6, 6], [6, 7], [7, 7]];
var idx = 0, got = 0, tries = 0;

// 第一批：纯炸弹（明牌），数量 1-3 轮换、尺寸轮换
console.log('生成纯炸弹关 ' + PURE_N + ' 关 ...');
while (got < PURE_N && tries < PURE_N * 6) {
  tries++;
  var sz = sizes[got % sizes.length];
  var cnt = 1 + (got % 3);   // 1,2,3 轮换
  var opts = { bombCountMin: cnt, bombCountMax: cnt, bombHidden: false };
  var rec = gen({ Bomb: true }, opts, sz[0], sz[1], sz[1]);
  if (rec.rec && record(++idx, 'pure', { H: sz[0], K: sz[1], colorCount: sz[1], opts: opts }, rec.rec)) got++;
  if (got % 20 === 0 && got) console.log('  纯炸弹 ' + got + '/' + PURE_N + '  (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
}

// 第二批：混合（炸弹 + 一个硬障碍），明牌 / 隐藏列全局 / 隐藏列独立 轮换
console.log('生成混合炸弹关 ' + MIXED_N + ' 关 ...');
var hardKinds = ['Ice', 'Rock', 'CoveredColor', 'KeyLock'];
var modes = [
  { bombHidden: false },
  { bombHidden: true, bombTiming: 'global' },
  { bombHidden: true, bombTiming: 'independent' }
];
got = 0; tries = 0;
while (got < MIXED_N && tries < MIXED_N * 8) {
  tries++;
  var sz2 = sizes[(got + 1) % sizes.length];
  var hk = hardKinds[got % hardKinds.length];
  var mode = modes[got % modes.length];
  var combo = { Bomb: true }; combo[hk] = 2;
  var opts2 = Object.assign({ bombCountMin: 1, bombCountMax: 2, iceDurMin: 1, iceDurMax: 2 }, mode);
  var rec2 = gen(combo, opts2, sz2[0], sz2[1], sz2[1]);
  if (rec2.rec && record(++idx, 'mixed', { H: sz2[0], K: sz2[1], colorCount: sz2[1], opts: opts2 }, rec2.rec)) got++;
  if (got % 20 === 0 && got) console.log('  混合 ' + got + '/' + MIXED_N + '  (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
}

var out = path.join(ROOT, '炸弹回测数据.csv');
fs.writeFileSync(out, rows.join('\n'), 'utf8');
console.log('\n完成：共 ' + (rows.length - 1) + ' 行，用时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
console.log('CSV 输出：' + out);
