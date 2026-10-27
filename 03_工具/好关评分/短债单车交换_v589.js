#!/usr/bin/env node
/** v589：shortDebt基底最长免费连内的单对color/count交换。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const LEVEL = path.join(__dirname, '债务策略AB_v588_shortDebt.levels', '1001.json');
const ROUTE = path.join(__dirname, '债务策略AB_v588_shortDebt.levels', '1001.route.json');
const OUT = path.join(__dirname, '短债单车交换_v589.json');
const LEVEL_DIR = path.join(__dirname, '短债单车交换_v589.levels');
const MAX_PAIRS = Number(process.env.MAX_PAIRS || 12);
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];

function load() {
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}

const A = load();
const base = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
const route = JSON.parse(fs.readFileSync(ROUTE, 'utf8'));
const parsed = A.parseLevel(base);
const baseCurve = A.Generator.choiceCurve(parsed, { completed: true, pickOrder: route },
  { instantChain: true, bottomOnly: false });
const steps = baseCurve.steps;

const runs = [];
let start = null;
for (let i = 0; i <= steps.length; i++) {
  const s = steps[i], free = s && s.full >= 2 && s.free >= 3;
  if (free && start == null) start = i;
  if (!free && start != null) { runs.push({ start, end: i - 1, len: i - start }); start = null; }
}
runs.sort((a, b) => b.len - a.len);
const longest = runs[0];
const hotSteps = [14, 20, 30, 37].map(n => steps[n - 1]).filter(Boolean);
const donorSteps = steps.slice(longest.end + 1).filter(s => s && s.pick);

const pairs = [];
for (const hot of hotSteps) {
  for (const donor of donorSteps) {
    if (!hot.pick || !donor.pick || hot.pick.color === donor.pick.color) continue;
    const hc = base.board.cells[hot.pick.r] && base.board.cells[hot.pick.r][hot.pick.c];
    const dc = base.board.cells[donor.pick.r] && base.board.cells[donor.pick.r][donor.pick.c];
    if (!hc || hc.t !== 'box' || !dc || dc.t !== 'box') continue;
    if (hc.color !== hot.pick.color || dc.color !== donor.pick.color) continue;
    const score = Math.abs((hot.full || 0) - 2) * 20 +
      Math.abs((hc.count || 0) - (dc.count || 0)) +
      donor.prog * 10 - hot.prog * 5;
    pairs.push({
      id: hot.pick.r + '_' + hot.pick.c + '__' + donor.pick.r + '_' + donor.pick.c,
      hot: { step: steps.indexOf(hot) + 1, prog: hot.prog, full: hot.full, free: hot.free,
        r: hot.pick.r, c: hot.pick.c, color: hc.color, count: hc.count },
      donor: { step: steps.indexOf(donor) + 1, prog: donor.prog,
        r: donor.pick.r, c: donor.pick.c, color: dc.color, count: dc.count },
      score
    });
  }
}
pairs.sort((a, b) => a.score - b.score);
const selected = pairs.slice(0, MAX_PAIRS);

function swap(level, p) {
  const lv = A.deepClone(level);
  const a = lv.board.cells[p.hot.r] && lv.board.cells[p.hot.r][p.hot.c];
  const b = lv.board.cells[p.donor.r] && lv.board.cells[p.donor.r][p.donor.c];
  if (!a || a.t !== 'box' || !b || b.t !== 'box') return null;
  const ac = a.color, an = a.count;
  a.color = b.color; a.count = b.count;
  b.color = ac; b.count = an;
  return lv;
}

const cfg = {
  seed: 1001, ruleMode: 'instantChain', instantChain: true, bottomOnly: false,
  elimOrder: 'instant', boxSizeMin: 6, boxSizeMax: 40,
  capNormMin: 6, capNormMax: 40, boardRowsMin: 7, boardRowsMax: 7,
  boardColsMin: 7, boardColsMax: 7, boardHardRange: true, boardAuto: false,
  p7Repair: false, trapPost: false, localSwapRepair: false, experienceGoal: false,
  maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
};

const rows = [];
for (const p of selected) {
  const lv = swap(base, p);
  if (!lv) continue;
  const t0 = Date.now();
  const ev = A.Generator.evaluateLevel(lv, cfg);
  const q = ev && ev.valid ? A.Quality.fromGeneration(ev) : null;
  const curve = ev && ev.goodV3 && ev.goodV3.fillCurve || null;
  let exp = null;
  if (ev && ev.valid && ev.solveResult) {
    try {
      exp = A.ExperienceGoal.evaluate(ev.level, {
        solveResult: ev.solveResult, decision: true, instantChain: true,
        maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
      });
    } catch (e) { exp = { error: String(e && e.message || e) }; }
  }
  const rec = {
    id: p.id, pair: p, valid: !!(ev && ev.valid),
    quality: q ? { gatePass: !!q.gatePass, gateReasons: q.gateReasons || [], label: q.label } : null,
    curve: curve ? {
      freeLowPct: curve.freeLowPct, freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2, selectMedian: curve.selectMedian,
      pressurePct3: curve.pressurePct3, pressurePeak: curve.pressurePeak
    } : null,
    maxBuffer: exp && exp.metrics ? exp.metrics.maxBuffer : null,
    experiencePass: !!(exp && exp.pass), elapsedMs: Date.now() - t0
  };
  rows.push(rec);
  if (ev && ev.level) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    fs.writeFileSync(path.join(LEVEL_DIR, rec.id + '.json'), JSON.stringify(ev.level, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, rec.id + '.route.json'),
      JSON.stringify(ev.solveResult && ev.solveResult.pickOrder || [], null, 2) + '\n');
  }
  console.log('[v589]', rec.id, 'valid=' + rec.valid,
    'freeRun=' + (curve && curve.freeRunMax),
    'freeLow=' + (curve && curve.freeLowPct),
    'full=' + (curve && curve.fullMedian2),
    'maxBuffer=' + rec.maxBuffer,
    'qGate=' + (q && q.gatePass),
    'ms=' + rec.elapsedMs);
}

const report = {
  schema: 'short-debt-local-swap-v589', date: '2026-10-27',
  base: path.relative(ROOT, LEVEL),
  longestRun: { start: longest.start + 1, end: longest.end + 1, len: longest.len },
  candidateCount: pairs.length, selectedCount: selected.length,
  candidates: selected, rows,
  summary: {
    valid: rows.filter(x => x.valid).length,
    freeRunDrop2: rows.filter(x => x.curve && x.curve.freeRunMax <= baseCurve.freeRunMax - 2).length,
    maxBuffer3: rows.filter(x => x.maxBuffer >= 3).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    experience: rows.filter(x => x.experiencePass).length,
    bestFreeRun: rows.length ? Math.min(...rows.map(x => x.curve && x.curve.freeRunMax)) : null
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
