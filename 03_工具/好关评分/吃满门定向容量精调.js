#!/usr/bin/env node
/** v519只读实验：按高吃满步骤定位最小partialdelta，并估计donor新增吃满风险。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js'];
function opt(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; }
const budget = +opt('budget', '20000'), out = opt('out', ''), maxVariants = +opt('variants', '32');
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
let generatorSource = fs.readFileSync(path.join(BIN, 'generator.js'), 'utf8');
generatorSource = generatorSource.replace('evaluateLevel: evaluateLevel, trapPostProcess:', 'choiceCurve: choiceCurve, exposedBlobByColor: exposedBlobByColor, evaluateLevel: evaluateLevel, trapPostProcess:');
vm.runInContext(generatorSource, sb, { filename: 'generator-instrumented.js' });
const A = sb.AntSolver, G = A.Generator, S = A.Simulator;
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function cand(level, ev, cfg) { return { level, valid: !!(ev && ev.valid), solveResult: ev && ev.solveResult, audit: ev && ev.audit, goodV3: ev && ev.goodV3, config: cfg }; }
function measure(level, ev, cfg) {
  const c = cand(level, ev, cfg), q = A.Quality.fromGeneration(c), fc = c.goodV3 && c.goodV3.fillCurve || {}, ca = A.Quality.capacityEvidence(level, cfg);
  return { valid: c.valid, struct: G.goalStructPass(c), gateReasons: q.gateReasons || [], gateDistance: q.gateDistance,
    freeLowPct: fc.freeLowPct, freeRunMax: fc.freeRunMax, selectMedian: fc.selectMedian, fullMedian2: fc.fullMedian2, pressurePct3: fc.pressurePct3,
    capacity: { conserved: ca.conserved, boardFloorPass: ca.boardFloorPass, aboveMax: ca.aboveMax, belowMin: ca.belowMin } };
}
function protectedOk(m, b) { return m.valid && m.capacity.conserved && m.capacity.boardFloorPass && m.capacity.aboveMax === 0 && m.capacity.belowMin <= b.capacity.belowMin; }
function better(a, b) {
  if (!b) return true;
  if (!!a.struct !== !!b.struct) return a.struct;
  if (a.gateReasons.length !== b.gateReasons.length) return a.gateReasons.length < b.gateReasons.length;
  return (a.gateDistance == null ? 1e9 : a.gateDistance) < (b.gateDistance == null ? 1e9 : b.gateDistance);
}
/** 与choiceCurve共用同一状态、同一exposedBlob函数，只增加反事实诊断，不改游戏规则。 */
function diagnose(level, route) {
  const st = S.createState(level, { useSlotStart: true }), order = route.pickOrder.slice().sort((a, b) => (a.step || 0) - (b.step || 0));
  const stats = {}, steps = [];
  function stat(m, exposed, full, stepIndex) {
    const key = m.r + ',' + m.c;
    if (!stats[key]) stats[key] = { r: m.r, c: m.c, color: m.color, count: m.count, highFullHits: 0, minDelta: Infinity, maxDelta: 0, donorRisk: {}, appearances: 0 };
    const x = stats[key]; x.appearances++;
    if (full) {
      const delta = Math.max(1, exposed - m.count + 1);
      if (steps[stepIndex].full >= 4) { x.highFullHits++; x.minDelta = Math.min(x.minDelta, delta); x.maxDelta = Math.max(x.maxDelta, delta); }
    } else {
      // 当前count>exposed；移出超过count-exposed-1才会重新成为full。
      const margin = m.count - exposed;
      for (let d = 1; d <= 4; d++) x.donorRisk[d] = (x.donorRisk[d] || 0) + Math.max(0, d - margin + 1);
    }
  }
  for (let i = 0; i < order.length; i++) {
    const p = order[i]; if (p.chainIndex > 0) continue;
    const blob = G.exposedBlobByColor(st.eliminated, st.blocks, st.rows, st.cols), moves = S.listMoves(st).filter(m => !m.blocked);
    const step = { index: steps.length, full: 0, moves: [] }; steps.push(step);
    for (const m of moves) {
      const cell = st.cells[m.r] && st.cells[m.r][m.c]; if (!cell) continue;
      const exposed = blob[cell.color] || 0, full = exposed >= cell.count;
      if (full) step.full++;
      step.moves.push({ r: m.r, c: m.c, color: cell.color, count: cell.count, exposed, full });
    }
    // stat需要看到本步full总数，因此先收集完整step再记贡献。
    for (const m of step.moves) stat(m, m.exposed, m.full, step.index);
    if (!S.applyPick(st, p.r, p.c) || st.gameOver) break;
  }
  const targets = Object.values(stats).filter(x => x.highFullHits > 0 && isFinite(x.minDelta)).map(x => ({
    r: x.r, c: x.c, color: x.color, count: x.count, highFullHits: x.highFullHits,
    delta: x.minDelta, maxDelta: x.maxDelta, appearances: x.appearances
  })).sort((a, b) => b.highFullHits - a.highFullHits || a.delta - b.delta || a.r - b.r || a.c - b.c);
  return { steps, stats, targets };
}
function makeVariants(level, route, capMin, capMax) {
  const d = diagnose(level, route), variants = [], rejected = [];
  for (const target of d.targets.slice(0, 8)) {
    const delta = target.delta;
    if (!(delta > 0 && delta <= 32)) { rejected.push({ target, reason: 'delta_outside_experiment_bound', delta }); continue; }
    const cell = level.board.cells[target.r][target.c];
    if (cell.count + delta > capMax) { rejected.push({ target, reason: 'target_above_user_max', delta }); continue; }
    const donors = [];
    for (let r = 0; r < level.board.rows; r++) for (let c = 0; c < level.board.cols; c++) {
      if (r === target.r && c === target.c) continue;
      const x = level.board.cells[r][c], key = r + ',' + c, ds = d.stats[key];
      if (!x || x.t !== 'box' || x.q || x.color !== cell.color) continue;
      const slack = x.count - capMin;
      if (slack > 0) donors.push({ r, c, slack, take: 0, appearances: ds && ds.appearances || 0,
        riskAt: function (n) { return n > 0 ? (ds && ds.donorRisk[n] || 0) : 0; } });
    }
    // 与原transfer一样允许多donor；区别仅是逐px选择新增吃满风险最低者。
    for (let moved = 0; moved < delta; moved++) {
      const available = donors.filter(d => d.take < d.slack);
      if (!available.length) break;
      available.sort((a, b) => (a.riskAt(a.take + 1) - a.riskAt(a.take)) - (b.riskAt(b.take + 1) - b.riskAt(b.take)) ||
        b.appearances - a.appearances || b.slack - a.slack || a.r - b.r || a.c - b.c);
      available[0].take++;
    }
    const moved = donors.reduce((n, d) => n + d.take, 0);
    if (moved !== delta) { rejected.push({ target, reason: 'insufficient_multi_donor_slack', delta, available: moved }); continue; }
    const lv = JSON.parse(JSON.stringify(level)), tc = lv.board.cells[target.r][target.c];
    tc.count += delta;
    const donorMeta = [];
    for (const d of donors) if (d.take > 0) {
      lv.board.cells[d.r][d.c].count -= d.take;
      donorMeta.push({ r: d.r, c: d.c, delta: -d.take, estimatedNewFullRisk: d.riskAt(d.take) });
    }
    const v = { level: lv, meta: { strategy: 'full-gate-directed-v1', target: { r: target.r, c: target.c, color: target.color, before: target.count, after: tc.count, delta },
      donors: donorMeta,
      diagnosis: { highFullHits: target.highFullHits, maxDeltaAtOtherSteps: target.maxDelta }, capRange: [capMin, capMax] } };
    if (hash(A.CapacityTuner.sumByColor(lv)) !== hash(A.CapacityTuner.sumByColor(level))) { rejected.push({ target, reason: 'conservation_check_failed' }); continue; }
    variants.push(v);
  }
  return { variants, rejected, targets: d.targets, steps: d.steps.map(s => ({ index: s.index, full: s.full })) };
}
const report = JSON.parse(fs.readFileSync(path.join(__dirname, '独立回归_32677_v516.json'), 'utf8')), rr = report.rows.find(x => x.image === 'recommend');
const level = A.parseLevel(JSON.parse(fs.readFileSync(path.join(__dirname, '推荐32677_近失变体_v518.json'), 'utf8')));
const cfg = Object.assign({}, G.DEFAULT_CONFIG, { trapEvalMs: 1500, boxSizeMin: rr.capacity.boxSizeMin, boxSizeMax: rr.capacity.boxSizeMax, capNormMin: rr.capacity.boxSizeMin, capNormMax: rr.capacity.boxSizeMax });
const t0 = Date.now(), sr = A.Solver.solve(level, { timeBudgetMs: 1500, capturePreviewStats: true }), ev0 = G.evaluateLevel(level, cfg), base = measure(level, ev0, cfg);
const made = makeVariants(level, sr, cfg.boxSizeMin, cfg.boxSizeMax), rec = { id: 'recommend_32677_near', baseHash: hash(level), capRange: [cfg.boxSizeMin, cfg.boxSizeMax], base,
  diagnosticTargets: made.targets, rejected: made.rejected, fullCurve: made.steps, tested: 0, protectedRejected: 0, variants: [], best: null };
for (const v of made.variants) {
  if (rec.tested >= maxVariants || Date.now() - t0 >= budget) { rec.stopped = rec.tested >= maxVariants ? 'variant_cap' : 'budget_exhausted'; break; }
  const t = Date.now(), ev = G.evaluateLevel(v.level, cfg), m = measure(v.level, ev, cfg), row = { meta: v.meta, ms: Date.now() - t, after: m, hash: hash(v.level) };
  rec.tested++; rec.variants.push(row);
  if (!protectedOk(m, base)) { rec.protectedRejected++; continue; }
  if (better(m, rec.best && rec.best.after)) rec.best = row;
  if (m.struct) {
    const full = A.ExperienceGoal.evaluate(v.level, { solveResult: ev.solveResult, decision: true });
    row.experienceFull = full && { pass: full.pass, status: full.status, reasons: full.reasons, metrics: full.metrics, release: full.releaseDecision && full.releaseDecision.status };
    const cc = cand(v.level, ev, cfg); G.attachExperienceRouteEvidence(cc, cfg); row.route = cc.experienceRouteEvidence;
    if (full && full.pass || cc.experienceRouteEvidence && cc.experienceRouteEvidence.pass) { row.converted = true; rec.converted = row; break; }
  }
}
rec.elapsedMs = Date.now() - t0;
const result = { schema: 'full-gate-directed-capacity-v1', date: '2026-10-26', baseCommit: '076629d', budgetMs: budget, maxVariants, summary: {
  tested: rec.tested, generated: made.variants.length, rejected: made.rejected.length, structPasses: rec.variants.filter(v => v.after.struct).length,
  conversions: rec.converted ? 1 : 0, protectedRejected: rec.protectedRejected, elapsedMs: rec.elapsedMs, stopped: rec.stopped || (rec.converted ? 'converted' : 'exhausted') }, rows: [rec] };
if (out) fs.writeFileSync(path.resolve(ROOT, out), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ summary: result.summary, base, targets: made.targets.slice(0, 8), best: rec.best && { meta: rec.best.meta, after: rec.best.after }, converted: rec.converted && { meta: rec.converted.meta, after: rec.converted.after, experience: rec.converted.experienceFull } }, null, 2));
