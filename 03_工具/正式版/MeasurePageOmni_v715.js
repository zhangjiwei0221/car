#!/usr/bin/env node
'use strict';
/**
 * 页面同口径测量：用生产页那一次求解（runSolver noise0 seed1 useItems=true, instantChain）
 * 输出 JSON：{steps,peak,stepsAt4,run4,run3,items,won,history}
 * 用法：node MeasurePageOmni_v715.js <level.json>
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();
const file = process.argv[2];
const game = B.readJson(file);
const level = A.parseLevel(A.fromGameFormat(game));
const omni = A.Solver.runSolver(level, 0, 1, true, false, { capturePreviewStats: true, instantChain: true });
const h = (omni.pressureSamples || []).map(s => s.buf);
let run3 = 0, cur3 = 0, run4 = 0, cur4 = 0, stepsAt4 = 0;
for (const v of h) {
  if (v >= 3) { cur3++; run3 = Math.max(run3, cur3); } else cur3 = 0;
  if (v >= 4) { cur4++; stepsAt4++; run4 = Math.max(run4, cur4); } else cur4 = 0;
}
console.log(JSON.stringify({
  steps: h.length, peak: Math.max(0, ...h), stepsAt4, run4, run3,
  items: omni.itemUses || 0, won: !!omni.completed, history: h
}));
