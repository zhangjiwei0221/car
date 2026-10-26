#!/usr/bin/env node
/** v566：只读比较同一容量带的原始/1.45/1.15臂对InstantPlayout三策略的可行性。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const OUT = path.join(__dirname, '生产容量臂计划探针_v566.json');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const IMAGES = {
  '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
  '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt'
};
const SCALES = [1, 1.45, 1.15];
const POLICIES = ['supply', 'targetBuffer', 'shortDebt'];

function load() {
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  }
  return sb.AntSolver;
}

function main() {
  const A = load();
  const rows = [];
  for (const image of Object.keys(IMAGES)) {
    const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGES[image]), 'utf8'));
    const band = A.Generator.deriveCapacityBand(blocks);
    const capMin = band.band[0], capMax = band.band[1];
    for (const scale of SCALES) {
      const scaledMin = Math.max(1, Math.round(capMin * scale));
      const scaledMax = Math.max(scaledMin, Math.round(capMax * scale));
      for (const policy of POLICIES) {
        const cfg = {
          boxSizeMin: scaledMin,
          boxSizeMax: scaledMax,
          capNormMin: scaledMin,
          capNormMax: scaledMax,
          bufferLimit: 5,
          instantPlanPolicy: policy,
          instantPlanTargetBuffer: 4,
          instantPlanMaxDebt: 40,
          instantPlanDebtEvery: 2,
          targetCarCount: null
        };
        const t0 = Date.now();
        let p = null;
        try { p = A.InstantPlayout.plan({ blocks, bufferLimit: 5 }, cfg); }
        catch (e) { p = { ok: false, reason: 'error:' + String((e && e.message) || e) }; }
        const stat = p && p.boxes && p.boxes._instantPlayout || null;
        rows.push({
          image,
          originalBand: [capMin, capMax],
          scale,
          testedBand: [scaledMin, scaledMax],
          policy,
          ok: !!(p && p.ok),
          reason: p && p.reason || null,
          cars: stat && stat.cars,
          debtCars: stat && stat.debtCars,
          maxBuffer: stat && stat.maxBuffer,
          covered: stat && stat.covered,
          total: stat && stat.total,
          aboveMax: stat && stat.audit && stat.audit.aboveMax,
          belowMin: stat && stat.audit && stat.audit.belowMin,
          milliseconds: Date.now() - t0
        });
      }
    }
  }
  const summary = {
    rows: rows.length,
    ok: rows.filter(x => x.ok).length,
    byImageScale: {}
  };
  for (const image of Object.keys(IMAGES)) {
    summary.byImageScale[image] = {};
    for (const scale of SCALES) {
      const a = rows.filter(x => x.image === image && x.scale === scale);
      summary.byImageScale[image][String(scale)] = {
        originalBand: a[0] && a[0].originalBand,
        testedBand: a[0] && a[0].testedBand,
        okPolicies: a.filter(x => x.ok).map(x => x.policy),
        failures: a.filter(x => !x.ok).map(x => ({ policy: x.policy, reason: x.reason })),
        target: a.find(x => x.policy === 'targetBuffer')
      };
    }
  }
  const report = {
    schema: 'production-cap-scale-instant-plan-probe-v566',
    date: '2026-10-26',
    note: '只验证InstantPlayout可行性；1.45/1.15是UI现有capeScalePlan实验臂，不是建议放宽用户容量。',
    summary,
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main();
