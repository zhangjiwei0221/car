#!/usr/bin/env node
/**
 * E6c：链 + 冰组合的自动放置与验证（P6 第三个机制实验，只读，不进生产）。
 *
 * 规则（与 E6a/E6b 的人工发现一致，但改为自动搜索，不含人工坐标）：
 *   1) 找最长"免费连"窗口（连续 full≥2 且 free≥3）
 *   2) 取窗口起点被取的那辆车 P
 *   3) 对 P 的 4 个邻接盒 N（无链）组成 1 组链，并给 P 加球数冰 k ∈ {10,15,20}
 *   4) 逐个重解 + 重算结构门，取最优；同时算 ablation（只链 / 只冰）
 *
 * 用法：
 *   node 03_工具/好关评分/E6c_组合.js --levels 03_工具/好关评分/E6c_样本 --out 03_工具/好关评分/E6c_结果
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() { }, warn() { }, error() { } }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, G = A.Generator;

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
const LEVELS = path.resolve(arg('levels', path.join(__dirname, 'E6c_样本')));
const OUT = arg('out', path.join(__dirname, 'E6c_结果'));
const SOLVE_MS = parseInt(arg('solve-ms', '8000'), 10);
const DOSES = String(arg('doses', '10,15,20')).split(',').map(Number);
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

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
function maxChain(level) {
  let m = 0;
  for (let r = 0; r < level.board.rows; r++) for (let c = 0; c < level.board.cols; c++) {
    const cell = level.board.cells[r] && level.board.cells[r][c];
    if (cell && cell.t === 'box' && (cell.chain || 0) > m) m = cell.chain;
  }
  return m;
}
function evalLevel(level) {
  const solved = A.Solver.solve(level, { timeBudgetMs: SOLVE_MS });
  const cur = G.choiceCurve(level, solved);
  if (!cur) return { ok: false, solved: !!(solved && solved.completed), gate: false, reasons: ['choiceCurve null'] };
  const q = A.Quality.fromGeneration({ level: level, valid: !!(solved && solved.completed), goodV3: { fillCurve: cur, persist: {} } });
  return {
    ok: true, solved: !!(solved && solved.completed), gate: !!q.gatePass, reasons: q.gateReasons || [],
    distance: q.gateDistance, freeLowPct: cur.freeLowPct, freeRunMax: cur.freeRunMax,
    fullMedian2: cur.fullMedian2, selectMedian: cur.selectMedian, forcedPct: cur.forcedPct, partialStepPct: cur.partialStepPct,
    cur: cur
  };
}
function freeRunWindow(cur) {
  const steps = cur.steps || [];
  let best = null, runStart = -1;
  for (let i = 0; i <= steps.length; i++) {
    const s = steps[i];
    const isFree = s && s.full >= 2 && s.free >= 3;
    if (isFree && runStart < 0) runStart = i;
    if (!isFree && runStart >= 0) {
      const len = i - runStart;
      if (!best || len > best.len) best = { start: runStart, end: i - 1, len: len };
      runStart = -1;
    }
  }
  return best;
}
function withChainAndIce(base, pair, dose) {
  const lv = clone(base);
  const cid = maxChain(lv) + 1;
  for (const [r, c] of pair) { const cell = lv.board.cells[r][c]; if (cell && cell.t === 'box') cell.chain = cid; }
  if (dose > 0) { const cell = lv.board.cells[pair[0][0]][pair[0][1]]; if (cell) cell.numice = (cell.numice || 0) + dose; }
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
    const win = ev0.ok ? freeRunWindow(ev0.cur) : null;
    const rec = { file: f, base: { gate: ev0.gate, reasons: ev0.reasons, freeLowPct: ev0.freeLowPct, freeRunMax: ev0.freeRunMax }, window: win, variants: [] };
    if (win) {
      const pick = ev0.cur.steps[win.start].pick;
      for (const d of DIRS) {
        const nr = pick.r + d[0], nc = pick.c + d[1];
        const cell = base.board.cells[nr] && base.board.cells[nr][nc];
        const pcell = base.board.cells[pick.r] && base.board.cells[pick.r][pick.c];
        if (!cell || cell.t !== 'box' || !pcell || pcell.t !== 'box') continue;
        if ((cell.chain || 0) > 0 || (pcell.chain || 0) > 0) continue;
        for (const dose of DOSES) {
          const lv = withChainAndIce(base, [[pick.r, pick.c], [nr, nc]], dose);
          const sum = capSum(lv);
          const ev = evalLevel(lv);
          rec.variants.push({
            pair: [[pick.r, pick.c], [nr, nc]], dose: dose, conserved: sum === sum0,
            solved: ev.solved, gate: ev.gate, reasons: ev.reasons,
            freeLowPct: ev.freeLowPct, freeRunMax: ev.freeRunMax,
            fullMedian2: ev.fullMedian2, selectMedian: ev.selectMedian, forcedPct: ev.forcedPct
          });
        }
      }
    }
    rec.best = rec.variants.filter(v => v.gate && v.conserved && v.solved)
      .sort((a, b) => (a.freeLowPct - b.freeLowPct) || (a.dose - b.dose))[0] || null;
    // 消融：用最优配对，分别只链 / 只冰
    if (rec.best) {
      const onlyChain = evalLevel(withChainAndIce(base, rec.best.pair, 0));
      const onlyIce = evalLevel(withChainAndIce(base, [[rec.best.pair[0][0], rec.best.pair[0][1]], [rec.best.pair[0][0], rec.best.pair[0][1]]], rec.best.dose));
      rec.ablation = {
        chainOnly: { gate: onlyChain.gate, freeLowPct: onlyChain.freeLowPct, freeRunMax: onlyChain.freeRunMax },
        iceOnly: { gate: onlyIce.gate, freeLowPct: onlyIce.freeLowPct, freeRunMax: onlyIce.freeRunMax }
      };
    }
    rows.push(rec);
  }
  const flipped = rows.filter(r => r.best).length;
  fs.writeFileSync(OUT + '.json', JSON.stringify({ generatedAt: new Date().toISOString(), levels: path.relative(ROOT, LEVELS), total: rows.length, flipped: flipped, rows: rows }, null, 2) + '\n');

  const lines = ['| 关 | 基线 gate | 基线 freeLow/连 | 变体数 | 最优（链+冰） | 消融：只链 | 消融：只冰 |', '|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    const best = r.best ? ('✅ ' + r.best.freeLowPct + '/' + r.best.freeRunMax + ' 冰' + r.best.dose + ' ' + JSON.stringify(r.best.pair)) : '— 未过';
    const ch = r.ablation ? (r.ablation.chainOnly.gate + ' ' + r.ablation.chainOnly.freeLowPct + '/' + r.ablation.chainOnly.freeRunMax) : '-';
    const ic = r.ablation ? (r.ablation.iceOnly.gate + ' ' + r.ablation.iceOnly.freeLowPct + '/' + r.ablation.iceOnly.freeRunMax) : '-';
    lines.push('| ' + r.file.replace('.json', '') + ' | ' + r.base.gate + ' | ' + r.base.freeLowPct + '/' + r.base.freeRunMax + ' | ' + r.variants.length + ' | ' + best + ' | ' + ch + ' | ' + ic + ' |');
  }
  const md = lines.join('\n');
  fs.writeFileSync(OUT + '.md', '# E6c 链+冰自动放置\n\n共 ' + rows.length + ' 关，转化 ' + flipped + '\n\n' + md + '\n');
  console.log(md);
  console.log('\n[result] flipped ' + flipped + '/' + rows.length);
}

main();
