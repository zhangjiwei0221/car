#!/usr/bin/env node
/**
 * E5：局部单交换（P5 第一个实验，只读，不进生产）。
 *
 * 假设：freeLow 高的关，是"开局就能装满的车"排在了可点位置（第 0 行/可达区）。
 * 做法：只交换一对普通上盘车的 color/count —— 把一辆"开局就能装满"的可点车，
 *       与一辆"不可点、深层"的车对调；容量、障碍、管道、棋盘全部不动（守恒自然不变）。
 *
 * 用法：
 *   node 03_工具/好关评分/E5_换车.js --levels 03_工具/好关评分/E5_基关 --out 03_工具/好关评分/E5_结果
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() { }, warn() { }, error() { } }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, G = A.Generator, S = A.Simulator;

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
const LEVELS = path.resolve(arg('levels', path.join(__dirname, 'E5_基关')));
const OUT = arg('out', path.join(__dirname, 'E5_结果'));
const SOLVE_MS = parseInt(arg('solve-ms', '8000'), 10);
const MAX_PAIRS = parseInt(arg('pairs', '6'), 10);

const clone = o => JSON.parse(JSON.stringify(o));
function capSum(level) {
  let s = 0;
  for (let r = 0; r < level.board.rows; r++) for (let c = 0; c < level.board.cols; c++) {
    const cell = level.board.cells[r] && level.board.cells[r][c];
    if (!cell) continue;
    if (cell.t === 'box') s += cell.count || 0;
    else if (cell.t === 'pipe') for (const q of (cell.queue || [])) s += q.count || 0;
  }
  return s;
}
function evalLevel(level) {
  const solved = A.Solver.solve(level, { timeBudgetMs: SOLVE_MS });
  const cur = G.choiceCurve(level, solved);
  if (!cur) return { ok: false, solved: !!(solved && solved.completed), gate: false, reasons: ['choiceCurve null'] };
  const q = A.Quality.fromGeneration({ level: level, valid: !!(solved && solved.completed), goodV3: { fillCurve: cur, persist: {} } });
  return {
    ok: true, solved: !!(solved && solved.completed), gate: !!q.gatePass, reasons: q.gateReasons || [],
    freeLowPct: cur.freeLowPct, freeRunMax: cur.freeRunMax, fullMedian2: cur.fullMedian2,
    selectMedian: cur.selectMedian, forcedPct: cur.forcedPct, partialStepPct: cur.partialStepPct,
    // 第 0 步的可点车 + 是否"能装满"（choiceCurve 里已算好，避免依赖未导出的 blob API）
    moves0: (cur.steps && cur.steps[0] && cur.steps[0].moves) || []
  };
}
// 初始局面：直接用 choiceCurve 第 0 步的 moves（含 full 标记），不依赖未导出的 blob API
function openingMoves(level, ev0) {
  const moves = (ev0 && ev0.moves0) || [];
  return { moves: moves, pickable: moves.map(m => ({ r: m.r, c: m.c, color: m.color, count: m.count, full: !!m.full })) };
}
function swapPair(base, a, b) {
  const lv = clone(base);
  const ca = lv.board.cells[a.r][a.c], cb = lv.board.cells[b.r][b.c];
  if (!ca || !cb || ca.t !== 'box' || cb.t !== 'box') return null;
  const tc = ca.color, tn = ca.count;
  ca.color = cb.color; ca.count = cb.count;
  cb.color = tc; cb.count = tn;
  return lv;
}

function main() {
  const files = fs.readdirSync(LEVELS).filter(f => f.endsWith('.json')).sort();
  const rows = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(LEVELS, f), 'utf8'));
    const base = A.parseLevel(A.fromGameFormat(raw));
    const sum0 = capSum(base);
    const ev0 = evalLevel(base);
    const rec = { file: f, base: { gate: ev0.gate, reasons: ev0.reasons, freeLowPct: ev0.freeLowPct, freeRunMax: ev0.freeRunMax }, variants: [] };
    let tried = 0;
    try {
      const om = openingMoves(base, ev0);
      // 可点且"能装满"的车（问题来源）
      const hot = om.pickable.filter(x => x.full === true).slice(0, 4);
      // 不可点的车（深层）：用行列判断——不在可点列表里、且不是管道
      const pickKeys = {};
      for (const m of om.moves) pickKeys[m.r + ',' + m.c] = 1;
      const cold = [];
      for (let r = 0; r < base.board.rows; r++) for (let c = 0; c < base.board.cols; c++) {
        const cell = base.board.cells[r][c];
        if (!cell || cell.t !== 'box') continue;
        if (pickKeys[r + ',' + c]) continue;
        if ((cell.chain || 0) > 0 || (cell.numice || 0) > 0) continue;
        cold.push({ r: r, c: c, color: cell.color, count: cell.count });
      }
      for (const h of hot) {
        for (const q of cold) {
          if (tried >= MAX_PAIRS) break;
          tried++;
          const lv = swapPair(base, h, q);
          if (!lv) continue;
          if (capSum(lv) !== sum0) continue;   // 交换不改总量，双保险
          const ev = evalLevel(lv);
          rec.variants.push({
            hot: [h.r, h.c, h.color, h.count], cold: [q.r, q.c, q.color, q.count],
            gate: ev.gate, reasons: ev.reasons, freeLowPct: ev.freeLowPct, freeRunMax: ev.freeRunMax, solved: ev.solved
          });
        }
      }
    } catch (e) { rec.error = String(e && e.message || e); }
    rec.best = rec.variants.filter(v => v.gate && v.solved)
      .sort((a, b) => (a.freeLowPct - b.freeLowPct))[0] || null;
    rows.push(rec);
  }
  const flipped = rows.filter(r => r.best).length;
  fs.writeFileSync(OUT + '.json', JSON.stringify({ generatedAt: new Date().toISOString(), levels: path.relative(ROOT, LEVELS), total: rows.length, flipped: flipped, rows: rows }, null, 2) + '\n');

  const lines = ['| 关 | 基线 gate | 基线 freeLow/连 | 试的交换 | 最好结果 |', '|---|---|---|---|---|'];
  for (const r of rows) {
    const b = r.best ? ('✅ ' + r.best.freeLowPct + '/' + r.best.freeRunMax + '  ' + JSON.stringify(r.best.hot) + ' ↔ ' + JSON.stringify(r.best.cold))
      : ('— 未过（最好 ' + (r.variants.length ? Math.min.apply(null, r.variants.map(v => v.freeLowPct)) : '-') + '）');
    lines.push('| ' + r.file.replace('.json', '') + ' | ' + r.base.gate + ' | ' + r.base.freeLowPct + '/' + r.base.freeRunMax + ' | ' + r.variants.length + ' | ' + b + ' |');
  }
  const md = lines.join('\n');
  fs.writeFileSync(OUT + '.md', '# E5 局部单交换\n\n共 ' + rows.length + ' 关，转化 ' + flipped + '\n\n' + md + '\n');
  console.log(md);
  console.log('\n[result] flipped ' + flipped + '/' + rows.length);
}

main();
