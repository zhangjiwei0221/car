#!/usr/bin/env node
/**
 * 同一 bestKnown 路线上的反事实策略对照（只读）：
 * node 03_工具/好关评分/反事实预算批跑.js --policy uniform --out /tmp/cf.jsonl
 * --policy value 为 v487 价值导向；--only play_A,006_v5 可缩小范围。
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
const policy = opt('policy', 'balanced'), outPath = opt('out', ''), only = opt('only', '').split(',').filter(Boolean);
const manifest = JSON.parse(fs.readFileSync(opt('manifest', path.join(__dirname, '求解题库_v1.json')), 'utf8'));
const routeRows = fs.readFileSync(opt('routes', path.join(__dirname, '求解题库分支对照_v486.jsonl')), 'utf8').trim().split(/\n/).map(JSON.parse).filter(r => r.tier === 'deep_b8');
const routeById = {}; for (const r of routeRows) routeById[r.id] = r;
if (outPath) fs.writeFileSync(outPath, '');
for (const item of manifest.levels) {
  if (item.id === '006_v1' || item.id === '006_v4ice' || (only.length && only.indexOf(item.id) < 0)) continue;
  const raw = JSON.parse(fs.readFileSync(item.path, 'utf8')), level = A.parseLevel(raw.spools ? A.fromGameFormat(raw) : raw);
  const base = A.Solver.solve(level, { timeBudgetMs: 10000 }), baseReplay = A.SolverAnalysis.replay(level, base);
  const rr = routeById[item.id], validRoutes = rr ? rr.routeSummaries.filter(r => r.replayValid) : [];
  validRoutes.sort((a, b) => a.maxBuffer - b.maxBuffer || a.steps - b.steps);
  let route = null, source = null, maxBuffer = null;
  if (validRoutes.length) { route = validRoutes[0].signature.split(' ').map(x => { const p = x.split(','); return { r: +p[0], c: +p[1] }; }); source = 'deep_b8'; maxBuffer = validRoutes[0].maxBuffer; }
  if (baseReplay.completed && (!route || baseReplay.maxBuffer < maxBuffer)) {
    route = A.SolverAnalysis.normalizeActions(base); source = 'baseline'; maxBuffer = baseReplay.maxBuffer;
  }
  const t = Date.now();
  const result = route ? A.SolverAnalysis.counterfactual(level, { actions: route }, {
    decisionPolicy: policy, maxDecisionPoints: 4, maxAlternatives: 2,
    timePerAlternativeMs: 1000, maxNodesPerAlternative: 2200,
    beamWidth: 12, branchWidth: 6
  }) : { decisions: [], reason: 'no_verified_route' };
  const outcomes = {}, features = { mixed: 0, partial: 0, highBuffer: 0 };
  let alternatives = 0, solved = 0, replayValid = 0;
  for (const d of result.decisions) {
    if (d.features) {
      if (d.features.fullCount > 0 && d.features.partialCount > 0) features.mixed++;
      if (d.features.partialCount > 0) features.partial++;
      if (d.features.bufferPct >= 0.6) features.highBuffer++;
    }
    for (const a of d.alternatives) {
      outcomes[a.outcome] = (outcomes[a.outcome] || 0) + 1;
      alternatives++; if (a.outcome === 'solved') solved++; if (a.replayValid && a.outcome === 'solved') replayValid++;
    }
  }
  const row = { id: item.id, group: item.group, policy, routeSource: source, routeMaxBuffer: maxBuffer,
    elapsedMs: Date.now() - t, candidateDecisionPoints: result.candidateDecisionPoints || 0,
    decisions: result.decisions.length, alternatives, solved, replayValid, outcomes, features,
    decisionDetails: result.decisions };
  if (outPath) fs.appendFileSync(outPath, JSON.stringify(row) + '\n');
  console.log(JSON.stringify({ id: item.id, policy, source, elapsedMs: row.elapsedMs,
    decisions: row.decisions, alternatives, solved, outcomes, features }));
}
