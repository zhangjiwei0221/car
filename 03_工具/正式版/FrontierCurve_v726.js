// FrontierCurve_v726.js —— 可行集曲线 F(t)：每步“能点且能装满”的车数
// 用法：node FrontierCurve_v726.js <关卡.json> [--json 输出.json]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();
const Sim = A.Sim || (A.Simulator);

const args = process.argv.slice(2);
const file = args[0];
const OUT = (() => { const i = args.indexOf('--json'); return i > 0 ? args[i + 1] : null; })();
if (!file || !Sim) { console.error('用法：node FrontierCurve_v726.js <关卡.json>；或 Sim 未导出'); process.exit(1); }

const g = JSON.parse(fs.readFileSync(file, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));
const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
const order = o.pickOrder || [];

// 用 Sim 回放：每步统计可行集
const s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: true });
const rows = [];
for (let i = 0; i < order.length; i++) {
  let pv = null;
  try { pv = Sim.previewNextEliminationOrder(s); } catch (e) { pv = null; }
  const byColor = (pv && pv.byColor) || {};
  let pickable = 0, fillable = 0, locked = 0, needSlots = 0;
  const details = [];
  for (let r = 0; r < s.boardRows; r++) {
    for (let c = 0; c < s.boardCols; c++) {
      if (!Sim.isPickable(s, r, c)) continue;
      pickable++;
      const cell = s.cells[r][c];
      if (!cell || cell.t !== 'box') continue;
      const av = (byColor[cell.color] && byColor[cell.color].reachable) || 0;
      if (cell.numice && Sim.isNumIceLocked && Sim.isNumIceLocked(s, r, c)) { locked++; continue; }
      if (av >= cell.count) { fillable++; details.push(`${cell.color}/${cell.count}`); }
      else needSlots++;
    }
  }
  rows.push({ step: i + 1, pickable, fillable, locked, short: needSlots, colors: details.slice(0, 8) });
  const pick = order[i];
  try { Sim.applyPick(s, pick.r, pick.c); } catch (e) { break; }
}

console.log('步 可点 能装满 冰锁 吃不满  可行集条');
for (const r of rows) {
  const bar = '█'.repeat(Math.min(20, r.fillable)) + '·'.repeat(Math.max(0, 4 - r.fillable));
  console.log(`${String(r.step).padStart(3)} ${String(r.pickable).padStart(4)} ${String(r.fillable).padStart(6)} ${String(r.locked).padStart(4)} ${String(r.short).padStart(6)}  ${bar}`);
}
const f = rows.map(r => r.fillable);
const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
const zero = f.filter(v => v === 0).length, one = f.filter(v => v === 1).length;
console.log(`\n平均可行集 ${avg.toFixed(2)}｜=0 的步 ${zero}｜=1 的步 ${one}｜步数 ${rows.length}`);
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(rows, null, 2)); console.log('写出 ' + OUT); }
