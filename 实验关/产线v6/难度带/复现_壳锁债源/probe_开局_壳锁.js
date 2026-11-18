'use strict';
// 壳锁债源复现：打印开局可点格 + corner 口径贪心前 15 步（r,c#color/count）。
// 用法: node probe_开局_壳锁.js <关卡.json>
const fs = require('fs');
const B = require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;
const game = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));
const isDead = s => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const moves = Sim.listMoves(s).filter(m => !m.blocked);
const cellAt = (r, c) => s.cells[r][c];
console.log('opening moves', moves.length, moves.map(m => {
  const b = cellAt(m.r, m.c);
  return `${m.r},${m.c}#${b.color}/${b.count}${b.chain ? 'c' + b.chain : ''}${b.numice ? 'i' + b.numice : ''}${b.q ? '?' : ''}`;
}).join(' '));
const order = [];
for (let i = 0; i < 15; i++) {
  if (s.eliminatedPixels >= s.totalPixels) break;
  const ms = Sim.listMoves(s).filter(m => !m.blocked);
  let pick = null, best = -Infinity;
  for (const m of ms) {
    const t = St.cloneState(s);
    const e0 = t.eliminatedPixels;
    if (!Sim.applyPick(t, m.r, m.c)) continue;
    if (isDead(t) && t.eliminatedPixels < t.totalPixels) continue;
    const gain = t.eliminatedPixels - e0;
    if (gain > best) { best = gain; pick = { m, t }; }
  }
  if (!pick) break;
  const b = cellAt(pick.m.r, pick.m.c);
  order.push(`${pick.m.r},${pick.m.c}#${b.color}/${b.count}`);
  s = pick.t;
}
console.log('pickOrder', order.join(' '));
