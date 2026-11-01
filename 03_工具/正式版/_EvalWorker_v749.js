// _EvalWorker_v749.js —— 求解评估的 worker（供 EvalPool 使用）
'use strict';
const { parentPort, workerData } = require('worker_threads');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver(workerData.ref || 'ring');
const GUIDE_STEPS = workerData.guideSteps || 3;
const NO_EARLY = workerData.noEarly || 0;
const MODE = workerData.mode || 'a';
const SHELL = workerData.shellColors || [];   // 外框壳颜色（按开口顺序）

function evalLevel(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: MODE !== 'a' });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let run4 = 0, cur = 0, at4 = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }
  const cls = buf.map(v => v >= 4 ? 'H' : v >= 2 ? 'M' : 'L');
  const beats = []; let i = 0;
  while (i < buf.length) { let j = i; while (j + 1 < buf.length && cls[j + 1] === cls[i]) j++; beats.push({ k: cls[i], from: i + 1, to: j + 1 }); i = j + 1; }
  let gapTotal = 0, gapMax = 0;
  for (let k = 0; k < beats.length; k++) {
    if (beats[k].k !== 'H') continue;
    let m = k + 1; while (m < beats.length && beats[m].k !== 'H') m++;
    if (m >= beats.length) break;
    let low = 0;
    for (let s2 = beats[k].to + 1; s2 <= beats[m].from - 1; s2++) if (buf[s2 - 1] < 3) low++;
    if (low >= 2) { gapTotal += low; gapMax = Math.max(gapMax, low); }
  }
  let lowTotal = 0; for (const v of buf) if (v < 3) lowTotal++;
  let lowRun = 0, curLow = 0;
  for (const v of buf) { if (v < 3) { curLow++; lowRun = Math.max(lowRun, curLow); } else curLow = 0; }
  const firstHigh = buf.findIndex(v => v >= 4);
  let leadFree = 0;
  if (firstHigh > 0) for (let s4 = 0; s4 < firstHigh; s4++) if (buf[s4] < 3) leadFree++;
  const tailFrom = Math.max(0, Math.floor(buf.length * 0.75));
  let tailFree = 0, late4 = 0, late3 = 0;
  for (let s3 = tailFrom; s3 < buf.length; s3++) {
    if (buf[s3] < 3) tailFree++;
    if (buf[s3] >= 4) late4++;
    if (buf[s3] >= 3) late3++;
  }
  // 【分段口径】前 20% 的 4 步数、后 20% 的最长连续 4
  const earlyN = Math.max(1, Math.round(buf.length * 0.2));
  const early4 = buf.slice(0, earlyN).filter(v => v >= 4).length;
  let late4run = 0, rTmp = 0;
  for (let s8 = tailFrom; s8 < buf.length; s8++) { if (buf[s8] >= 4) { rTmp++; late4run = Math.max(late4run, rTmp); } else rTmp = 0; }
  const midA = Math.floor(buf.length * 0.4), midB = Math.floor(buf.length * 0.8);
  let mid4 = 0; for (let s7 = midA; s7 < midB; s7++) if (buf[s7] >= 4) mid4++;
  const firstColor = (o.pickOrder && o.pickOrder[0]) ? o.pickOrder[0].color : null;
  const firstUse = {};
  (o.pickOrder || []).forEach((p, i) => { if (firstUse[p.color] === undefined) firstUse[p.color] = i + 1; });
  const firstK = (o.pickOrder || []).slice(0, GUIDE_STEPS).map(p => p.color);
  const earlyHigh = NO_EARLY > 0 ? buf.slice(0, NO_EARLY).some(v => v >= 4) : false;
  // 开壳步：某外框色的像素被全部取走时的第几手
  let shellDone = null;
  if (SHELL.length) {
    const tot = {};
    for (let yy = 0; yy < g.blocks.length; yy++) for (let xx = 0; xx < g.blocks[yy].length; xx++) { const c = g.blocks[yy][xx]; tot[c] = (tot[c] || 0) + 1; }
    const acc2 = {}, done2 = {}; let ii = 0;
    for (const pp of (o.pickOrder || [])) {
      ii++;
      acc2[pp.color] = (acc2[pp.color] || 0) + (pp.count || 0);
      if (!done2[pp.color] && acc2[pp.color] >= (tot[pp.color] || 0)) done2[pp.color] = ii;
    }
    shellDone = SHELL.map(c => done2[c] || null);
  }
  return { shellDone, early4, late4run, won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, late4, late3, mid4, midN: midB - midA, gapTotal, gapMax, tailFree, leadFree, lowTotal, lowRun, firstColor, firstK, firstUse, earlyHigh, steps: buf.length, itemUses: o.itemUses || 0, buf };
}

parentPort.on('message', (msg) => {
  try { parentPort.postMessage({ id: msg.id, m: evalLevel(msg.g) }); }
  catch (e) { parentPort.postMessage({ id: msg.id, error: String(e && e.message || e) }); }
});
