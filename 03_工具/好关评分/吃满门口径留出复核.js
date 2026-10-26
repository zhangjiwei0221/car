#!/usr/bin/env node
/** v520：固定历史UI批次留出复核，使用落库曲线和当时体验标签。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), OUT = path.join(ROOT, '02_工程', '完整主bin快照_20261012', '输出文件');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const sb = { console, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of ['utils.js', 'color-libs.js']) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver;
function opt(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; }
const out = opt('out', '');
function median(a) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; }
const rows = [];
for (const batch of [13, 14, 15, 17, 18]) {
  const dir = path.join(OUT, 'unnamed-10-26-' + batch), jsonl = path.join(dir, '生产文档', '逐关记录.jsonl');
  for (const line of fs.readFileSync(jsonl, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line), exp = rec['体验目标'], debug = rec['输出路径'] && rec['输出路径'].debug;
    if (!exp || typeof exp.pass !== 'boolean' || !debug) throw new Error('留出记录缺体验或debug：' + batch + ' ' + rec['原图名']);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, debug), 'utf8')), q = A.Quality.fromGeneration(raw);
    const fc = raw.generationEval && raw.generationEval.goodV3 && raw.generationEval.goodV3.fillCurve || {}, steps = fc.steps || [];
    const low = steps.filter(s => s.free >= 3), high = steps.filter(s => s.free <= 2), lowMed = median(low.map(s => s.full));
    const otherReasons = (q.gateReasons || []).filter(x => x.indexOf('吃满中位') !== 0), known = low.length >= 3 && lowMed != null;
    const currentStruct = !!q.gatePass, candidateStruct = otherReasons.length === 0 && known && lowMed <= 3;
    rows.push({ batch, image: rec['原图名'], currentStruct, candidateStruct, converted: !currentStruct && candidateStruct,
      experiencePass: exp.pass, experienceMetrics: exp.metrics || null, currentReasons: q.gateReasons || [], otherReasons,
      candidateReason: otherReasons.length ? 'other_gate_failed' : (!known ? 'insufficient_low_pressure_steps' : (lowMed > 3 ? 'low_pressure_full_median>3' : null)),
      curve: { steps: steps.length, fullMedian2: fc.fullMedian2, lowPressureSteps: low.length, lowPressureFullMedian: lowMed,
        highPressureSteps: high.length, highPressureFullMedian: median(high.map(s => s.full)), freeLowPct: fc.freeLowPct, freeRunMax: fc.freeRunMax } });
  }
}
const conversions = rows.filter(r => r.converted), summary = { samples: rows.length,
  currentStructPasses: rows.filter(r => r.currentStruct).length, candidateStructPasses: rows.filter(r => r.candidateStruct).length,
  conversions: conversions.length, rescuedExperiencePass: conversions.filter(r => r.experiencePass).length,
  rescuedExperienceFail: conversions.filter(r => !r.experiencePass).length,
  currentStructChangedToFail: rows.filter(r => r.currentStruct && !r.candidateStruct).map(r => r.batch + ':' + r.image),
  holdoutProtectionPass: !conversions.some(r => !r.experiencePass) && !rows.some(r => r.currentStruct && !r.candidateStruct) };
const result = { schema: 'full-gate-pressure-holdout-v1', date: '2026-10-26', batches: [13, 14, 15, 17, 18], summary, rows };
if (out) fs.writeFileSync(path.resolve(ROOT, out), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ summary, conversions: conversions.map(r => ({ batch: r.batch, image: r.image, experiencePass: r.experiencePass, curve: r.curve })) }, null, 2));
