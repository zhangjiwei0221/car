#!/usr/bin/env node
'use strict';
/**
 * 关卡体检一行输出（供批量脚本调用）
 * 用法：node Measure006_v714.js <level.json>
 * 输出 JSON：{steps,peak,completed,run,windows,pass,early,late,freeSteps}
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();
const file = process.argv[2];
const game = B.readJson(file);
const level = A.parseLevel(A.fromGameFormat(game));
const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
const picks = B.uniquePicks(solve);
const h = solve.stepBufferHistory || [];
let run = 0, cur = 0;
for (const v of h) { if (v >= 3) { cur++; run = Math.max(run, cur); } else cur = 0; }
const samples = h.map((buf, i) => ({ done: i + 1, buf }));
const au = A.Analysis.chokepointAudit(samples, h.length, game.bufferLimit || 5);
console.log(JSON.stringify({
  steps: picks.length, peak: solve.maxBuffer, completed: !!solve.completed,
  run, windows: B.pressureWindows(h, 3).length,
  pass: au.pass, early: +au.earlyMax.toFixed(2), late: +au.lateMax.toFixed(2),
  freeSteps: null, history: h
}));
