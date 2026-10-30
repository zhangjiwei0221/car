#!/usr/bin/env node
/**
 * v495 失败关只读归因（B 步）。
 * 输入：产线对比.js --dump-levels 产出的关卡 JSON + 对应 JSONL。
 * 输出：逐关证据表（容量/开局供给/车序时间线）+ 粗分类，写 markdown 与 json。
 *
 * 只读：不生成、不改关卡、不改生成器。用法（仓库根目录）：
 *   node 03_工具/好关评分/归因_v495.js \
 *     --jsonl 03_工具/好关评分/归因重跑_v495.jsonl \
 *     --levels 03_工具/好关评分/失败关_v495 \
 *     --out 03_工具/好关评分/归因_v495
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'solver-analysis.js', 'car-sequencer.js', 'generator.js'];
const sandbox = { console: { log() { }, warn() { }, error() { } }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : def;
}
const JSONL = arg('jsonl', path.join(__dirname, '归因重跑_v495.jsonl'));
const LEVELS = arg('levels', path.join(__dirname, '失败关_v495'));
const OUT = arg('out', path.join(__dirname, '归因_v495'));

function pct(a, b) { return (b > 0) ? Math.round(a / b * 100) : null; }
function median(a) { const s = a.filter(x => x != null).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function colorTotals(blocks) {
  const by = {};
  for (const row of blocks) for (const v of row) if (v > 0) by[v] = (by[v] || 0) + 1;
  return by;
}
function bandInfeasible(by, cmin, cmax) {
  const out = [];
  for (const c in by) {
    const N = by[c];
    if (Math.ceil(N / cmax) > Math.floor(N / cmin)) out.push({ color: +c, px: N });
  }
  return out;
}

function analyze(row) {
  const lf = path.join(ROOT, row.levelFile);
  const raw = JSON.parse(fs.readFileSync(lf, 'utf8'));
  const level = A.parseLevel(raw.spools ? A.fromGameFormat(raw) : raw);
  const blocks = level.blocks;
  const G = A.Generator;
  const band = G.deriveCapacityBand(blocks) || {};
  const by = colorTotals(blocks);
  const colors = Object.keys(by).length;
  const bandLo = (row.band && row.band[0]) || band.band[0], bandHi = (row.band && row.band[1]) || band.band[1];
  const ce = A.Quality.capacityEvidence(level, { boxSizeMin: bandLo, boxSizeMax: bandHi });
  const infeas = bandInfeasible(by, bandLo, bandHi);

  let solved = null, dual = null, dualErr = null;
  try { solved = A.Solver.solve(level, { timeBudgetMs: 10000 }); } catch (e) { dualErr = String(e && e.message || e); }
  if (solved) { try { dual = A.CarSequencer.dualTimeline(level, solved); } catch (e) { dualErr = String(e && e.message || e); } }

  let exp = null;
  try { exp = G.openingExposure(blocks, blocks.length, blocks[0].length, false); } catch (e) { }
  const openingColors = exp && exp.detail ? exp.detail.length : null;
  const openingPx = exp && exp.detail ? exp.detail.reduce((s, d) => s + (d.px || 0), 0) : null;

  const items = (dual && dual.items) || [];
  const activated = items.filter(x => x.activateStep != null).length;
  const sole = items.filter(x => (x.solePickableSupplySteps || []).length).length;
  const opens = items.reduce((s, x) => s + ((x.opens || []).length), 0);
  const earlyAct = items.filter(x => x.activateStep != null && x.activateStep <= 5).length;

  const fc = row.quality || {};
  const reasons = row.gateReasons || [];
  let cls = '待人工看车序/摆位';
  if (ce && (ce.belowMin + ce.aboveMax) >= Math.max(1, Math.round(ce.cars * 0.8))) {
    cls = '容量带不可行（八成以上车出带）';
  } else if (infeas.length >= Math.max(3, Math.round(colors * 0.3))) {
    cls = '容量带部分不可行（多色无整数拆分）';
  } else if ((band.free != null && band.free >= 4) || (row.quality && row.quality.earlyFree10 != null && row.quality.earlyFree10 >= 5)) {
    cls = '开局供给过密（白给车多）';
  }
  return {
    image: row.image, seed: row.seed, levelFile: row.levelFile,
    board: row.board, band: [bandLo, bandHi],
    gateReasons: reasons,
    capacity: {
      cars: ce.cars, min: ce.minCap, max: ce.maxCap, belowMin: ce.belowMin, aboveMax: ce.aboveMax,
      conserved: ce.conserved, row0Cars: ce.row0Cars, row0Colors: ce.row0Colors, row0MaxSame: ce.row0MaxSameColor,
      rangeExactFeasible: ce.rangeExactFeasible, infeasibleColors: infeas.map(x => x.color),
      infeasiblePx: infeas.map(x => x.px)
    },
    supply: {
      colors: colors, openingColors: openingColors, openingPx: openingPx,
      freeCarsAtChosen: band.free == null ? null : band.free,
      medianColorPx: median(Object.values(by)),
      maxColorPx: Math.max.apply(null, Object.values(by)),
      minColorPx: Math.min.apply(null, Object.values(by))
    },
    timeline: {
      solved: !!(solved && solved.completed), cars: items.length, activated: activated,
      activatedByStep5: earlyAct, soleSupplyCars: sole, opensEdges: opens, error: dualErr
    },
    quality: {
      freeLowPct: fc.freeLowPct, freeRunMax: fc.freeRunMax, selectMedian: fc.selectMedian,
      fullMedian2: fc.fullMedian2, forcedPct: fc.forcedPct, earlyFree10: fc.earlyFree10,
      firstPass: fc.playerPassPct, learned: fc.learnedPassPct, look: fc.lookaheadPassPct
    },
    cls: cls
  };
}

function main() {
  const rows = fs.readFileSync(JSONL, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const fails = rows.filter(r => r.gatePass === false && r.levelFile);
  const out = [];
  for (const r of fails) {
    try { out.push(analyze(r)); } catch (e) { out.push({ image: r.image, seed: r.seed, error: String(e && e.message || e) }); }
  }
  fs.writeFileSync(OUT + '.json', JSON.stringify({ generatedAt: new Date().toISOString(), jsonl: path.relative(ROOT, JSONL), count: out.length, rows: out }, null, 2) + '\n');

  const lines = [];
  lines.push('| 图 | seed | 棋盘 | 车数 | 容量 min~max | 出带(低/高) | 不可行色 | 第0行 车/色/同色 | 开局色/px | 白给车 | freeLow | freeRun | 分类 |');
  lines.push('|---|---:|---|---:|---:|---|---:|---|---|---:|---:|---:|---|');
  for (const o of out) {
    if (o.error) { lines.push('| ' + o.image + ' | ' + o.seed + ' | - | - | - | - | - | - | - | - | - | - | 分析失败:' + o.error + ' |'); continue; }
    const c = o.capacity, s = o.supply, t = o.timeline, q = o.quality;
    lines.push('| ' + [o.image, o.seed, o.board.rows + 'x' + o.board.cols, c.cars,
      c.min + '~' + c.max, c.belowMin + '/' + c.aboveMax,
      (c.infeasibleColors.length + (c.infeasibleColors.length ? '(' + c.infeasiblePx.join(',') + 'px)' : '')),
      c.row0Cars + '/' + c.row0Colors + '/' + c.row0MaxSame,
      s.openingColors + '/' + s.openingPx, s.freeCarsAtChosen,
      q.freeLowPct + '%', q.freeRunMax, o.cls].join(' | ') + ' |');
  }
  const md = lines.join('\n');
  fs.writeFileSync(OUT + '.md', '# v495 失败关只读归因\n\n' + md + '\n');
  console.log(md);
  console.log('\n[out] ' + path.relative(ROOT, OUT + '.json') + '\n[out] ' + path.relative(ROOT, OUT + '.md'));
}

main();
