#!/usr/bin/env node
'use strict';
// R1 三面墙：开局暴露面统计（只读，不参与判定）。
// 用法: node opening_analysis.js <仓库根目录> <输出.json>
// 口径：createState({useSlotStart:true, instantChain:false, bottomOnly}) + listMoves 过滤 blocked，
//       逐车 cloneState+applyPick，gain>0 记为“开局可直接消除”；
//       uniqueDirectPixels = 各开局可消车消除的像素并集（同一像素只计一次）。
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '../../..');
const B = require(path.join(REPO, '03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const root = process.argv[2] || REPO;
const outFile = process.argv[3];
const LEVELS = [
  '实验关/产线v5/C1_建造/106_base/关卡_ZC_106_v1.json',
  '实验关/新组_正常关卡/ZC_23/安全版/关卡_ZC_23_safe.json',
  '实验关/产线v5/v5-1_建造/试玩/关卡_ZC_18_v5p.json',
  '实验关/产线v5/v5-1_建造/试玩/关卡_ZC_91_v5p.json'
];

function analyze(file, bottomOnly) {
  const game = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const lv = A.parseLevel(A.fromGameFormat(game));
  const s = Sim.createState(lv, { useSlotStart: true, bottomOnly, instantChain: false });
  const moves = Sim.listMoves(s).filter(m => !m.blocked);
  const byColor = {};
  const union = new Set();
  const moveGains = [];
  for (const m of moves) {
    const t = St.cloneState(s);
    const e0 = t.eliminatedPixels;
    if (!Sim.applyPick(t, m.r, m.c)) continue;
    const gain = t.eliminatedPixels - e0;
    if (gain <= 0) continue;
    moveGains.push(gain);
    const color = (m.antBox && m.antBox.color !== undefined) ? m.antBox.color : '?';
    byColor[color] = (byColor[color] || 0) + gain;
    for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) {
      if (t.eliminated[r][c] && !s.eliminated[r][c]) union.add(r + ',' + c);
    }
  }
  const gainVals = moveGains.slice().sort((a, b) => a - b);
  const med = gainVals.length ? gainVals[Math.floor(gainVals.length / 2)] : 0;
  return {
    level: path.basename(file),
    bottomOnly,
    totalPixels: s.totalPixels,
    totalBoxes: s.totalBoxes,
    pickableMoves: moves.length,
    blockedMoves: Sim.listMoves(s).length - moves.length,
    directMoveCount: moveGains.length,
    directColors: Object.keys(byColor).length,
    directColorGains: byColor,
    uniqueDirectPixels: union.size,
    directGainSum: gainVals.reduce((a, b) => a + b, 0),
    directGainMin: gainVals.length ? gainVals[0] : 0,
    directGainMedian: med,
    directGainMax: gainVals.length ? gainVals[gainVals.length - 1] : 0,
    directGains: gainVals
  };
}

const rows = [];
for (const f of LEVELS) {
  rows.push(analyze(f, false));
  rows.push(analyze(f, true));
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
for (const r of rows) {
  console.log(`${r.level} ${r.bottomOnly ? 'B底边' : 'A四边'} 可点=${r.pickableMoves} 直接可消车=${r.directMoveCount} 颜色=${r.directColors} 唯一像素=${r.uniqueDirectPixels} 单步gain中位=${r.directGainMedian} 最大=${r.directGainMax}`);
}
