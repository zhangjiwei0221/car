#!/usr/bin/env node
'use strict';
/**
 * 陷阱链实验 · 陷阱格校准（2026-11-16）
 *
 * 第 1 步（2s 超时）有 48% 的评估是 timeout——不是“无解”，只是没搜出来。
 * 本脚本用 超时复核.json 的分阶段 q = P(无解 | 2s timeout) 把每个 timeout 折算成
 * 无解概率，重算每格的致命比例：
 *
 *   correctedShare = (致命 + 非法 + Σ_timeout q(该评估的进度段)) / 全部可点评估数
 *
 * 判定：correctedShare ≥ --threshold（默认 0.30）且 n ≥ 5 → 陷阱格。
 * 同时保留三种口径以便对照：primary（timeout 当有解）、strict（timeout 剔除）、loose（timeout 当无解）。
 *
 * 用法：
 *   node 陷阱判定_v2.js <陷阱格.json> <超时复核.json> [--threshold 0.30] [--out 陷阱格_校准.json]
 */
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TRAP = process.argv[2], CAL = process.argv[3];
if (!TRAP || !CAL) { console.error('用法: node 陷阱判定_v2.js <陷阱格.json> <超时复核.json> [--threshold 0.30] [--out 文件]'); process.exit(2); }
const THRESH = Number(arg('--threshold', 0.30));
const OUT = arg('--out', path.join(__dirname, '陷阱格_校准.json'));
const trap = JSON.parse(fs.readFileSync(TRAP, 'utf8'));
const cal = JSON.parse(fs.readFileSync(CAL, 'utf8'));

const q = {};
for (const ph of ['early', 'mid', 'late']) q[ph] = (cal.byPhase[ph] && cal.byPhase[ph].q) || 0;
const qAll = cal.overall ? cal.overall.q : 0;
const phaseOf = (p) => p < 0.2 ? 'early' : (p <= 0.6 ? 'mid' : 'late');

function corrected(cell) {
  // 有逐次样本（第 1 步对 fatal>0 的格都存了样本）：按样本的进度段折算
  if (cell.samples && cell.samples.length) {
    let sum = 0;
    for (const sm of cell.samples) {
      if (sm.verdict === 'fatal' || sm.verdict === 'illegal') sum += 1;
      else if (sm.verdict === 'timeout') sum += q[phaseOf(sm.progress)];
      // solvable → 0
    }
    return sum / cell.n;
  }
  // 没存样本（fatal=0）：全部按总体 q 折算（这类格 corrected ≤ 总体 q，通常远低于阈值）
  return (cell.fatal + (cell.illegal || 0) + qAll * cell.timeout) / cell.n;
}

const sampleMap = new Map();
for (const c of trap.trapCells || []) if (c.samples && c.samples.length) sampleMap.set(c.r + ',' + c.c, c.samples);

const cells = (trap.cells || trap.trapCells).map(c => {
  const samples = (c.samples && c.samples.length) ? c.samples : (sampleMap.get(c.r + ',' + c.c) || []);
  const cc = { ...c, samples };
  const cs = corrected(cc);
  return {
    r: c.r, c: c.c, color: c.color, count: c.count,
    n: c.n, fatal: c.fatal, solvable: c.solvable, timeout: c.timeout, illegal: c.illegal || 0,
    decisive: c.fatal + c.solvable,
    primary: c.fatalShare, strict: c.fatalShareStrict,
    correctedShare: +cs.toFixed(3),
    actMed: c.actMed, firstTakenMed: c.firstTakenMed,
    trap_corrected: c.n >= 5 && cs >= THRESH,
    trap_strict: c.decisive >= 5 && c.fatal / Math.max(1, c.decisive) >= THRESH,
    trap_primary: c.n >= 5 && c.fatalShare >= THRESH
  };
}).sort((a, b) => b.correctedShare - a.correctedShare);

const traps = cells.filter(x => x.trap_corrected);
const out = {
  tool: '陷阱判定_v2', level: trap.level, threshold: THRESH,
  q, qAll, calibration: { sampled: cal.sampled, overall: cal.overall },
  summary: {
    cells: cells.length,
    traps: traps.length,
    strictTraps: cells.filter(x => x.trap_strict).length,
    primaryTraps: cells.filter(x => x.trap_primary).length
  },
  trapCells: traps,
  cells: cells.map(({ ...rest }) => rest)
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`q(early/mid/late)=${q.early}/${q.mid}/${q.late}  qAll=${qAll}`);
console.log(`陷阱格（correctedShare ≥ ${THRESH}, n≥5）: ${traps.length} 个；strict ${out.summary.strictTraps}；primary ${out.summary.primaryTraps}`);
for (const x of cells) {
  if (x.correctedShare < 0.1 && !x.trap_strict) continue;
  console.log(`  (${x.r},${x.c}) color=${x.color} cap=${x.count} corrected=${x.correctedShare} strict=${x.strict} primary=${x.primary} (fatal=${x.fatal}, solv=${x.solvable}, to=${x.timeout}, n=${x.n}) ${x.trap_corrected ? 'TRAP' : ''} actMed=${x.actMed} firstTaken=${x.firstTakenMed}`);
}
console.log('saved', OUT);
