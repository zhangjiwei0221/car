#!/usr/bin/env node
/* 汇总 解法结构批跑.js JSONL，按真实关卡内容 hash 去重。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const args = process.argv.slice(2), input = args[0], output = args[1];
if (!input) { console.error('用法：node 解法结构汇总.js <输入.jsonl> [汇总.json]'); process.exit(1); }
const BIN = path.join(__dirname, '..', '..', '02_工程', '游戏主bin', 'bin', 'js');
const sandbox = { console, Math, JSON, WeakMap, Map, Set, Date }; vm.createContext(sandbox);
for (const f of ['utils.js', 'color-libs.js', 'simulator.js']) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, rows = fs.readFileSync(input, 'utf8').trim().split(/\n/).map(JSON.parse), byId = {};
function hashOf(row) {
  if (row.contentHash) return row.contentHash;
  const raw = JSON.parse(fs.readFileSync(row.path, 'utf8')), lv = A.parseLevel(raw.spools ? A.fromGameFormat(raw) : raw);
  return crypto.createHash('sha256').update(JSON.stringify({ blocks: lv.blocks, board: lv.board, bufferLimit: lv.bufferLimit })).digest('hex');
}
const aliases = {}, canonical = {};
for (const r of rows) {
  const h = hashOf(r); r.contentHash = h;
  if (!canonical[h]) canonical[h] = r.id;
  if (canonical[h] !== r.id) { aliases[r.id] = canonical[h]; continue; }
  (byId[r.id] || (byId[r.id] = [])).push(r);
}
const ids = Object.keys(byId), tiers = ['quick', 'standard', 'deep'], tierStats = {};
for (const t of tiers) {
  const rs = ids.map(id => byId[id].find(r => r.tier === t)).filter(Boolean);
  tierStats[t] = { levels: rs.length, solved: rs.filter(r => r.routes > 0).length,
    replayValid: rs.reduce((n, r) => n + r.replayValid, 0), routes: rs.reduce((n, r) => n + r.routes, 0),
    nodes: rs.reduce((n, r) => n + r.nodes, 0), elapsedMs: rs.reduce((n, r) => n + r.elapsedMs, 0),
    budgetExhausted: rs.filter(r => r.budgetExhausted).length,
    notFound: rs.filter(r => r.status === 'not_found_within_budget').length };
}
const levels = ids.map(id => {
  const rs = byId[id], base = rs[0].baseline;
  let best = base.replayValid ? base.maxBuffer : null, source = base.replayValid ? 'baseline' : null;
  for (const r of rs) if (r.bestMaxBuffer != null && (best == null || r.bestMaxBuffer < best)) { best = r.bestMaxBuffer; source = r.tier; }
  return { id, group: rs[0].group, contentHash: rs[0].contentHash, baselineCompleted: base.completed,
    baselineReplayValid: base.replayValid, baselineMaxBuffer: base.maxBuffer, bestKnownMaxBuffer: best,
    bestKnownSource: source, improved: base.replayValid && best != null && best < base.maxBuffer,
    deepStatus: (rs.find(r => r.tier === 'deep') || {}).status || null };
});
const out = { uniqueLevels: ids.length, aliases, tiers: tierStats,
  baseline: { solved: levels.filter(x => x.baselineReplayValid).length },
  unionWithBaseline: { solved: levels.filter(x => x.bestKnownMaxBuffer != null).length,
    improvedPressure: levels.filter(x => x.improved).length },
  levels,
  note: 'bestKnownMaxBuffer 只是 baseline+三档搜索中的当前最好，不证明全局最低；未找到不等于无解。' };
if (output) fs.writeFileSync(output, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
