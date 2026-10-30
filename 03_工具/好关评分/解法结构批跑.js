#!/usr/bin/env node
/**
 * 固定题库的多路线预算召回测试（只读，不跑反事实）：
 * node 03_工具/好关评分/解法结构批跑.js \
 *   --manifest 03_工具/好关评分/求解题库_v1.json --out /tmp/solver-bench.jsonl
 * 可选：--tiers quick,standard,deep 或 --only play_A,006_v5
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const BIN = path.join(__dirname, '..', '..', '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'solver-analysis.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set,
  setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, args = process.argv.slice(2);
function opt(name, fallback) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; }
const manifestPath = opt('manifest', path.join(__dirname, '求解题库_v1.json'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const outPath = opt('out', ''), only = opt('only', '').split(',').filter(Boolean);
const tierNames = opt('tiers', 'quick,standard,deep').split(',').filter(Boolean);
const TIERS = {
  quick: { timeBudgetMs: 1000, maxNodes: 1500, beamWidth: 12, branchWidth: 6, maxRoutes: 4 },
  standard: { timeBudgetMs: 3000, maxNodes: 6000, beamWidth: 16, branchWidth: 8, maxRoutes: 6 },
  deep: { timeBudgetMs: 8000, maxNodes: 15000, beamWidth: 24, branchWidth: 8, maxRoutes: 8 },
  deep_b10: { timeBudgetMs: 8000, maxNodes: 15000, beamWidth: 24, branchWidth: 10, maxRoutes: 8 },
  deep_b8: { timeBudgetMs: 8000, maxNodes: 15000, beamWidth: 24, branchWidth: 8, maxRoutes: 8 },
  deep_b6: { timeBudgetMs: 8000, maxNodes: 15000, beamWidth: 24, branchWidth: 6, maxRoutes: 8 },
  adaptive_coverage: { adaptive: true, profile: 'coverage' },
  adaptive_pressure: { adaptive: true, profile: 'pressure' }
};
if (outPath) fs.writeFileSync(outPath, '');
for (const item of manifest.levels) {
  if (only.length && only.indexOf(item.id) < 0) continue;
  const raw = JSON.parse(fs.readFileSync(item.path, 'utf8'));
  const level = A.parseLevel(raw.spools ? A.fromGameFormat(raw) : raw);
  const contentHash = crypto.createHash('sha256').update(JSON.stringify({ blocks: level.blocks, board: level.board, bufferLimit: level.bufferLimit })).digest('hex');
  const t0 = Date.now(), base = A.Solver.solve(level, { timeBudgetMs: 10000 });
  const replay = A.SolverAnalysis.replay(level, base);
  const baseline = { completed: !!base.completed, replayValid: !!replay.completed,
    steps: replay.steps, maxBuffer: replay.completed ? replay.maxBuffer : null, solveMs: Date.now() - t0 };
  for (const name of tierNames) {
    const cfg = TIERS[name]; if (!cfg) throw new Error('未知预算档：' + name);
    const r = cfg.adaptive ? A.SolverAnalysis.findRoutesAdaptive(level, { profile: cfg.profile, baselineMaxBuffer: baseline.replayValid ? baseline.maxBuffer : null }) : A.SolverAnalysis.findRoutes(level, cfg);
    const routes = r.routes.map(x => ({ steps: x.steps, maxBuffer: x.maxBuffer, avgBuffer: x.avgBuffer,
      replayValid: x.replayValid, signature: x.signature }));
    const valid = routes.filter(x => x.replayValid);
    const row = { id: item.id, group: item.group, path: item.path, contentHash, tier: name, config: cfg, baseline,
      status: r.status, budgetExhausted: r.budgetExhausted, nodes: r.nodes, elapsedMs: r.elapsedMs,
      routes: routes.length, distinctRoutes: r.distinctRoutes, replayValid: valid.length, attempts: r.attempts || null,
      bestMaxBuffer: valid.length ? Math.min.apply(null, valid.map(x => x.maxBuffer)) : null,
      worstMaxBuffer: valid.length ? Math.max.apply(null, valid.map(x => x.maxBuffer)) : null,
      routeSummaries: routes };
    if (outPath) fs.appendFileSync(outPath, JSON.stringify(row) + '\n');
    console.log(JSON.stringify({ id: item.id, tier: name, base: baseline.completed ? baseline.maxBuffer : 'X',
      status: r.status, routes: r.routes.length, replay: valid.length, best: row.bestMaxBuffer,
      nodes: r.nodes, ms: r.elapsedMs }));
  }
}
