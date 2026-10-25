#!/usr/bin/env node
/**
 * E6a：数字冰定点注入（P6 第一个机制实验，只读实验工具，不进生产）。
 *
 * 做法：拿一个结构门失败的关 → 找最长"免费连"窗口 → 只给窗口里被取的车加数字冰 →
 *       重新求解 + 重算 choiceCurve → 比较 gate。加冰不改容量与守恒（只加 numice）。
 *
 * 用法（仓库根目录）：
 *   node 03_工具/好关评分/E6a_冰注入.js --levels 03_工具/好关评分/E6a_基关 --out 03_工具/好关评分/E6a_结果
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
const OUT = arg('out', path.join(__dirname, 'E6a_结果'));
// 数字冰的数值单位是“球数”，每步会扣掉一次取走的球数（5~8），所以按步数的 3/6 等于没加。
const ICE_SET = String(arg('ice', '15,20,25')).split(',').map(Number);
const GROUP_K = String(arg('group', '1,2')).split(',').map(Number);
const SOLVE_MS = parseInt(arg('solve-ms', '10000'), 10);

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
function evalLevel(level) {
  const solved = A.Solver.solve(level, { timeBudgetMs: SOLVE_MS });
  const cur = G.choiceCurve(level, solved);
  if (!cur) return { ok: false, reason: 'choiceCurve null', solved: !!(solved && solved.completed) };
  // persist 必须存在，否则 Quality 会判“结构指标未测、不通过”（见 utils.js fromGeneration）
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
// 候选单元 = 免费连窗口起点“当前能装满”的那几辆车（full=1）。
// 为什么不冻结窗口里被取的那辆：实测只冻 1 辆，求解器直接从别的车取，freeLow 反而升高。
function candidatesOf(cur, win) {
  if (!win) return [];
  const step = cur.steps[win.start];
  const mv = (step.moves || []).filter(m => m.full);
  return mv.map(m => ({ r: m.r, c: m.c, color: m.color, count: m.count, step: win.start }));
}

function main() {
  const files = fs.readdirSync(LEVELS).filter(f => f.endsWith('.json'));
  const rows = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(LEVELS, f), 'utf8'));
    const base = A.parseLevel(A.fromGameFormat(raw));
    const baseSum = capSum(base);
    const ev0 = evalLevel(base);
    const win = ev0.ok ? freeRunWindow(ev0.cur) : null;
    const cands = ev0.ok ? candidatesOf(ev0.cur, win) : [];
    const rec = { file: f, base: { gate: ev0.gate, reasons: ev0.reasons, freeLowPct: ev0.freeLowPct, freeRunMax: ev0.freeRunMax, steps: ev0.steps }, window: win, variants: [] };
    for (const kOf of GROUP_K) {
      const group = cands.slice(0, kOf);
      if (group.length < kOf) continue;
      for (const ice of ICE_SET) {
        const lv = clone(base);
        let okCells = true;
        for (const cd of group) {
          const cell = lv.board.cells[cd.r] && lv.board.cells[cd.r][cd.c];
          if (!cell || cell.t !== 'box') { okCells = false; break; }
          cell.numice = (cell.numice || 0) + ice;
        }
        if (!okCells) continue;
        const sum = capSum(lv);
        const ev = evalLevel(lv);
        rec.variants.push({
          k: kOf, cells: group.map(g => [g.r, g.c]), colors: group.map(g => g.color), ice: ice,
          conserved: sum === baseSum,
          solved: ev.solved, gate: ev.gate, reasons: ev.reasons, distance: ev.distance,
          freeLowPct: ev.freeLowPct, freeRunMax: ev.freeRunMax
        });
      }
    }
    rec.best = rec.variants.filter(v => v.gate && v.conserved && v.solved)
      .sort((a, b) => (a.ice - b.ice) || (a.freeRunMax - b.freeRunMax))[0] || null;
    rows.push(rec);
  }
  fs.writeFileSync(OUT + '.json', JSON.stringify({ generatedAt: new Date().toISOString(), levels: path.relative(ROOT, LEVELS), rows: rows }, null, 2) + '\n');

  const lines = ['| 关 | 基线 gate | 基线 freeLow/freeRun | 最长免费连窗口 | 试的变体 | 最优变体 |', '|---|---|---|---|---|---|'];
  for (const r of rows) {
    const w = r.window ? ('步 ' + r.window.start + '~' + r.window.end + '（' + r.window.len + '）') : '无';
    const b = r.best ? ('冰+' + r.best.ice + ' ×' + r.best.k + '辆 → ' + r.best.freeLowPct + '/' + r.best.freeRunMax + ' gate=' + r.best.gate) : '无（全部未过）';
    lines.push('| ' + r.file.replace('.json', '') + ' | ' + r.base.gate + ' | ' + r.base.freeLowPct + '/' + r.base.freeRunMax + ' | ' + w + ' | ' + r.variants.length + ' | ' + b + ' |');
  }
  const md = lines.join('\n');
  fs.writeFileSync(OUT + '.md', '# E6a 数字冰定点注入\n\n' + md + '\n');
  console.log(md);
  console.log('\n[out] ' + path.relative(ROOT, OUT + '.json'));
}

main();
