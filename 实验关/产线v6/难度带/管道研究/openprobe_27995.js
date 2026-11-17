#!/usr/bin/env node
'use strict';
// 只读探针：管道出口格在 solver 路线里第几步被拿走（= 管道开管步）；pid 27995
const path = require('path');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const f = process.argv[2];
const g = JSON.parse(require('fs').readFileSync(f, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));
const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
const picks = o.pickOrder || [];
const total = picks.length;
for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
  const s = g.spools[r][c];
  const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
  const dir = t.find(x => x >= 11 && x <= 14);
  if (!dir) continue;
  const dy = { 11: -1, 12: 0, 13: 1, 14: 0 }[dir], dx = { 11: 0, 12: 1, 13: 0, 14: -1 }[dir];
  const er = r + dy, ec = c + dx;
  const idx = picks.findIndex(p => p.r === er && p.c === ec);
  const step = idx >= 0 ? idx + 1 : null;
  console.log(JSON.stringify({ pipe: [r, c], dir, queue: s.param, exit: [er, ec], exitStep: step, exitProgress: step ? +(step / total).toFixed(3) : null, totalSteps: total, won: !!o.completed }));
}
