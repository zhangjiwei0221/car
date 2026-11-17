#!/usr/bin/env node
'use strict';
// 只读探针：开局可点、车格清单、颜色像素、solver 前 10 次取色（pid 27995）
const path = require('path');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator;
const f = process.argv[2];
const g = JSON.parse(require('fs').readFileSync(f, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));
const s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
const moves = Sim.listMoves(s).filter(m => !m.blocked);
console.log('opening moves', moves.length, moves.map(m => `${m.r},${m.c}#${m.color}/${m.count}`).join(' '));
const col = {};
for (const row of g.blocks) for (const v of row) if (v) col[v] = (col[v] || 0) + 1;
console.log('colors', JSON.stringify(col));
const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
console.log('pickOrder', (o.pickOrder || []).slice(0, 12).map(p => `${p.r},${p.c}#${p.color}/${p.count}`).join(' '));
