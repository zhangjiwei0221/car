#!/usr/bin/env node
/**
 * 复用 deep_b8 已验证路线 + baseline，计算13关压力分布（不做反事实搜索）。
 * node 03_工具/好关评分/压力分布批跑.js --out /tmp/pressure.jsonl
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const BIN = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'solver-analysis.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set,
  setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, args = process.argv.slice(2);
function opt(name, fallback) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; }
const outPath = opt('out', ''), only = opt('only', '').split(',').filter(Boolean);
const manifest = JSON.parse(fs.readFileSync(opt('manifest', path.join(__dirname, '求解题库_v1.json')), 'utf8'));
const routeRows = fs.readFileSync(opt('routes', path.join(__dirname, '求解题库分支对照_v486.jsonl')), 'utf8').trim().split(/\n/).map(JSON.parse).filter(r => r.tier === 'deep_b8');
const routeById = {}; for (const r of routeRows) routeById[r.id] = r;
if (outPath) fs.writeFileSync(outPath, '');
for (const item of manifest.levels) {
  if (item.id === '006_v1' || item.id === '006_v4ice' || (only.length && only.indexOf(item.id) < 0)) continue;
  const raw = JSON.parse(fs.readFileSync(item.path, 'utf8')), level = A.parseLevel(raw.spools ? A.fromGameFormat(raw) : raw);
  const base = A.Solver.solve(level, { timeBudgetMs: 10000 }), baseReplay = A.SolverAnalysis.replay(level, base);
  const routes = [], seen = {};
  function add(actions, source, steps) {
    const sig = actions.map(a => a.r + ',' + a.c).join(' ');
    if (!actions.length || seen[sig]) return;
    seen[sig] = true; routes.push({ actions, source, signature: sig, steps: steps || actions.length });
  }
  if (baseReplay.completed) add(A.SolverAnalysis.normalizeActions(base), 'baseline', baseReplay.steps);
  const rr = routeById[item.id];
  if (rr) for (const r of rr.routeSummaries) if (r.replayValid) add(r.signature.split(' ').map(x => { const p = x.split(','); return { r: +p[0], c: +p[1] }; }), 'deep_b8', r.steps);
  const t = Date.now(), profiles = [];
  for (const route of routes) {
    try {
      const p = A.SolverAnalysis.pressureProfile(level, route, {});
      p.source = route.source; p.signature = route.signature; p.steps = route.steps;
      profiles.push(p);
    } catch (e) { profiles.push({ replayValid: false, source: route.source, error: String(e.message || e) }); }
  }
  const valid = profiles.filter(p => p.replayValid);
  valid.sort((a, b) => a.maxBuffer - b.maxBuffer || a.steps - b.steps || (a.source === 'baseline' ? -1 : 1));
  const summary = A.SolverAnalysis.summarizePressure(profiles);
  const best = valid.length ? valid[0] : null;
  const row = { id: item.id, group: item.group, elapsedMs: Date.now() - t,
    baselineCompleted: !!base.completed, baselineReplayValid: !!baseReplay.completed,
    verifiedRoutes: routes.length, profiledRoutes: valid.length, replayErrors: routes.length - valid.length,
    bestKnownMaxBuffer: best ? best.maxBuffer : null, bestKnownSource: best ? best.source : null,
    bestRoutePressure: best, summary, profiles };
  if (outPath) fs.appendFileSync(outPath, JSON.stringify(row) + '\n');
  console.log(JSON.stringify({ id: item.id, routes: valid.length, best: row.bestKnownMaxBuffer,
    high: summary.sustainedHighPressurePct, range: summary.sustainedHighPressureRange,
    cycles: summary.oscillationCount, longest: summary.longestHighRun,
    late: summary.lateHighPressurePct, release: summary.releaseAmplitude,
    bestHigh: best && best.sustainedHighPressurePct, ms: row.elapsedMs }));
}
