#!/usr/bin/env node
/**
 * E6b：锁链定点注入（P6 第二个机制实验，只读，不进生产）。
 *
 * 做法：拿结构门失败的关 → 找最长"免费连"窗口 → 在窗口起点被取的那辆车旁边，
 *       与 4-邻接的一辆车组成 1 组锁链（取一端 → 两端同时进场，直接吃缓冲）→ 重解 + 重算 choiceCurve。
 *
 * 用法（仓库根目录）：
 *   node 03_工具/好关评分/E6b_锁链.js --levels 03_工具/好关评分/E6a_基关 --out 03_工具/好关评分/E6b_结果
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
const LEVELS = path.resolve(arg('levels', path.join(__dirname, 'E6a_基关')));
const OUT = arg('out', path.join(__dirname, 'E6b_结果'));
const SOLVE_MS = parseInt(arg('solve-ms', '10000'), 10);
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function clone(o) { return JSON.parse(JSON.stringify(o)); }
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
  if (!cur) return { ok: false, solved: !!(solved && solved.completed) };
  const q = A.Quality.fromGeneration({ level: level, valid: !!(solved && solved.completed), goodV3: { fillCurve: cur, persist: {} } });
  return {
    ok: true, solved: !!(solved && solved.completed),
    gate: !!q.gatePass, reasons: q.gateReasons || [], distance: q.gateDistance,
    freeLowPct: cur.freeLowPct, freeRunMax: cur.freeRunMax, fullMedian2: cur.fullMedian2,
    selectMedian: cur.selectMedian, forcedPct: cur.forcedPct, partialStepPct: cur.partialStepPct,
    freePct: cur.freePct, steps: cur.n, cur: cur
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

function main() {
  const files = fs.readdirSync(LEVELS).filter(f => f.endsWith('.json')).sort();
  const rows = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(LEVELS, f), 'utf8'));
    const base = A.parseLevel(A.fromGameFormat(raw));
    const baseSum = capSum(base);
    const ev0 = evalLevel(base);
    const win = ev0.ok ? freeRunWindow(ev0.cur) : null;
    const rec = {
      file: f,
      base: { gate: ev0.gate, reasons: ev0.reasons, freeLowPct: ev0.freeLowPct, freeRunMax: ev0.freeRunMax, steps: ev0.steps },
      window: win, variants: []
    };
    if (win) {
      const pick = ev0.cur.steps[win.start].pick;
      const cid = maxChain(base) + 1;
      for (const d of DIRS) {
        const nr = pick.r + d[0], nc = pick.c + d[1];
        const lv = clone(base);
        const a = lv.board.cells[pick.r] && lv.board.cells[pick.r][pick.c];
        const b = lv.board.cells[nr] && lv.board.cells[nr][nc];
        if (!a || !b || a.t !== 'box' || b.t !== 'box') continue;
        if ((a.chain || 0) > 0 || (b.chain || 0) > 0) continue;   // 不叠加已有链
        a.chain = cid; b.chain = cid;
        const sum = capSum(lv);
        const ev = evalLevel(lv);
        rec.variants.push({
          chainId: cid, pair: [[pick.r, pick.c], [nr, nc]],
          colors: [a.color, b.color], counts: [a.count, b.count],
          conserved: sum === baseSum,
          solved: ev.solved, gate: ev.gate, reasons: ev.reasons, distance: ev.distance,
          freeLowPct: ev.freeLowPct, freeRunMax: ev.freeRunMax
        });
      }
    }
    rec.best = rec.variants.filter(v => v.gate && v.conserved && v.solved)
      .sort((a, b) => (a.freeLowPct - b.freeLowPct) || (a.freeRunMax - b.freeRunMax))[0] || null;
    rows.push(rec);
  }
  fs.writeFileSync(OUT + '.json', JSON.stringify({ generatedAt: new Date().toISOString(), levels: path.relative(ROOT, LEVELS), rows: rows }, null, 2) + '\n');

  const lines = ['| 关 | 基线 gate | 基线 freeLow/freeRun | 免费连窗口 | 链变体 | 最好变体 |', '|---|---|---|---|---|---|'];
  for (const r of rows) {
    const w = r.window ? ('步 ' + r.window.start + '~' + r.window.end + '（' + r.window.len + '）') : '无';
    const b = r.best ? ('freeLow ' + r.best.freeLowPct + ' / 连 ' + r.best.freeRunMax + '，配对 ' + JSON.stringify(r.best.pair))
      : ('无可过变体（best freeLow ' + (r.variants.length ? Math.min.apply(null, r.variants.map(v => v.freeLowPct)) : '-') + '）');
    lines.push('| ' + r.file.replace('.json', '') + ' | ' + r.base.gate + ' | ' + r.base.freeLowPct + '/' + r.base.freeRunMax + ' | ' + w + ' | ' + r.variants.length + ' | ' + b + ' |');
  }
  const md = lines.join('\n');
  fs.writeFileSync(OUT + '.md', '# E6b 锁链定点注入\n\n' + md + '\n');
  console.log(md);
  console.log('\n[out] ' + path.relative(ROOT, OUT + '.json'));
}

main();
