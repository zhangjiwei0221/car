/**
 * StackSort 求解器 - 批量关卡分析工具（Node 运行）
 *
 * 用法：node analyze.js [runsPerMode] [输出CSV路径]
 *   runsPerMode = 每个决策模式重跑次数（默认 30）。
 *
 * 输出（控制台表格 + CSV，障碍中文命名 + 字段备注）：每关
 *   1) 多轮求解最优步数 / 平均步数 / 成功率
 *   2) 关卡难度（评分 + 等级 + 构成）
 *   3) 步数上限 / 容错 / 容错率
 *   4) 障碍情况（中文组合 + 分级）
 *
 * 难度评分体系详见 难度评分体系.md（逻辑集中在 js/analysis.js）。
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
const RUNS = parseInt(process.argv[2], 10) || 30;
const OUT = process.argv[3] || path.join(__dirname, '关卡分析结果.csv');

function rawObstacleTypes(lvl) {
  const s = {};
  lvl.boards.forEach(b => {
    b.columnFeatures.forEach(cf => cf.forEach(f => s[f.type] = 1));
    b.columns.forEach(c => c.tiles.forEach(t => (t.features || []).forEach(x => s[x] = 1)));
  });
  return Object.keys(s);
}

const rows = [['关卡', '尺寸(列x行)', '颜色种类', '障碍组合', '障碍分级', '最优步数', '平均步数', '成功率', '步数上限', '容错', '容错率', '难度分', '难度等级', '难度构成(障/压/为/行/色)']];
const t0 = Date.now();
let analyzed = 0;

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

  analyzed++;
  const obs = A.obstaclesFromState(st);
  const stSolve = E.createState(lvl.boards[0], 999);   // 宽预算求解(与可玩步数上限解耦)
  const r = A.multiSolve(stSolve, RUNS, 20);
  const limit = lvl.stepCount;
  // 玩家版：含问号或混合关 → 跑玩家版取最优模式表现（混合关另取通关率给"混合附加分"）
  let playerSucc = null, pl = null;
  if (obs.length > 1 || P.hasSurprise(st)) {
    pl = P.multiSolve(E.createState(lvl.boards[0], 999), RUNS, 20);
    if (obs.length > 1) playerSucc = pl.bestModeSucc;
  }
  // 真最优步 = 全知/玩家更小者
  let optBest = r.best;
  if (pl && pl.best != null && (optBest == null || pl.best < optBest)) optBest = pl.best;
  const margin = (optBest != null) ? (limit - optBest) : null;
  const ratio = (optBest != null && optBest > 0) ? (margin / optBest) : null;
  const d = A.difficulty(st, obs, optBest, limit, r, playerSucc, pl);

  rows.push([
    'L' + i,
    st.colCount + 'x' + st.rowCount,
    d.colorKinds,
    A.obstacleNamesCN(obs),
    A.obsLevelTag(obs),
    optBest != null ? optBest : '未解',
    r.avg != null ? r.avg.toFixed(1) : '-',
    (r.successRate * 100).toFixed(0) + '%',
    limit,
    margin != null ? margin : '-',
    ratio != null ? (ratio * 100).toFixed(0) + '%' : '-',
    d.score,
    d.level,
    d.parts.obs + '/' + d.parts.pressure + '/' + (d.parts.behavior != null ? d.parts.behavior : '-') + '/' + d.parts.row + '/' + d.parts.color +
      (d.parts.mix ? ('+混' + d.parts.mix) : '')
  ]);
}

// 控制台表格
const w = rows[0].map((_, ci) => Math.max(...rows.map(r => String(r[ci]).length)));
rows.forEach((r, ri) => {
  console.log(r.map((c, ci) => String(c).padEnd(w[ci])).join(' | '));
  if (ri === 0) console.log(w.map(x => '-'.repeat(x)).join('-+-'));
});

const dist = {};
rows.slice(1).forEach(r => { dist[r[12]] = (dist[r[12]] || 0) + 1; });
console.log('\n难度分布：', JSON.stringify(dist));
console.log('已分析关卡：' + analyzed + '，用时 ' + (Date.now() - t0) + 'ms');

// 写 CSV：先写字段备注区，再写表格（BOM + Excel 友好）
let lines = [];
lines.push('【字段说明】');
Object.keys(A.FIELD_NOTES).forEach(k => lines.push(k + ',' + A.FIELD_NOTES[k].replace(/,/g, '，')));
lines.push('');
lines.push('【批量分析结果】');
const body = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(','));
const csv = '\uFEFF' + lines.map(l => l).join('\n') + '\n' + body.join('\n');
fs.writeFileSync(OUT, csv, 'utf8');
console.log('CSV 已写出：' + OUT);
