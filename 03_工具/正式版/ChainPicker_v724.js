// ChainPicker_v724.js —— 句型选优：按“解锁表”推荐成链对
// 用法：node ChainPicker_v724.js <关卡.json> [--top 10] [--probe 8] [--apply 输出.json]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();

const args = process.argv.slice(2);
const file = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i > 0 ? Number(args[i + 1]) : d; };
const TOP = opt('--top', 10), PROBE = opt('--probe', 8);
const APPLY = (() => { const i = args.indexOf('--apply'); return i > 0 ? args[i + 1] : null; })();

function evalLv(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let at4 = 0, run4 = 0, cur = 0, lowRun = 0, curLow = 0;
  for (const v of buf) {
    if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); curLow = 0; }
    else { cur = 0; curLow++; lowRun = Math.max(lowRun, curLow); }
  }
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, lowRun, steps: buf.length, order: o.pickOrder || [] };
}

const base = JSON.parse(fs.readFileSync(file, 'utf8'));
const R = base.spools.length, C = base.spools[0].length;
const b0 = evalLv(base);

// 解锁表：每色首次被取用的步数 + 总容量
const firstUse = {}, capOf = {};
for (const row of base.spools) for (const c of row) if (c.id > 0) capOf[c.id] = (capOf[c.id] || 0) + c.count;
b0.order.forEach((p, i) => { if (firstUse[p.color] === undefined) firstUse[p.color] = i + 1; });

console.log(`基线：步${b0.steps} 峰值${b0.peak} at4=${b0.at4} run4=${b0.run4} 最长无压段=${b0.lowRun}`);
console.log('解锁表（颜色: 首用步 / 总容量）:');
const table = Object.keys(firstUse).map(c => ({ c: +c, step: firstUse[c], cap: capOf[c] })).sort((a, b) => a.step - b.step);
console.log('  ' + table.map(t => `${t.c}@${t.step}(${t.cap})`).join(' '));

// 候选：相邻两格、都是普通车、颜色不同（同色也可，但优先不同色）
const isPlain = (x) => x.id > 0 && (x.type === 0 || x.type === '0');
const cands = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const a = base.spools[r][c];
  if (!isPlain(a)) continue;
  for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const nr = r + dr, nc = c + dc;
    if (nr >= R || nc >= C) continue;
    const b = base.spools[nr][nc];
    if (!isPlain(b)) continue;
    // 评分：两色都要“晚且有限”，且都还没被用得太早
    const sa = firstUse[a.id] || 99, sb = firstUse[b.id] || 99;
    const entry = Math.min(sa, sb);
    const late = Math.max(0, 40 - entry);        // 越晚越好
    const scarce = 1000 / Math.max(20, (capOf[a.id] || 0) + (capOf[b.id] || 0)); // 总量越小越稀缺
    cands.push({ cells: [[r, c], [nr, nc]], cols: [a.id, b.id], entry, score: late * 1.0 + scarce * 300 });
  }
}
cands.sort((x, y) => y.score - x.score);
console.log(`\n候选对 ${cands.length}，取前 ${TOP} 做实测（每组单独求解）:`);

const results = [];
for (const cand of cands.slice(0, TOP)) {
  const h = JSON.parse(JSON.stringify(base));
  let maxChain = 0;
  for (const row of h.spools) for (const cell of row) {
    const ts = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
    if (ts.includes(5)) { const ps = Array.isArray(cell.param) ? cell.param : [cell.param]; const v = Number(ps[ts.indexOf(5)]); if (v > maxChain) maxChain = v; }
  }
  for (const [y, x] of cand.cells) { h.spools[y][x].type = 5; h.spools[y][x].param = maxChain + 1; }
  let e; try { e = evalLv(h); } catch (err) { continue; }
  if (!e.won || e.peak > 4) continue;
  results.push({ ...cand, at4: e.at4, run4: e.run4, lowRun: e.lowRun, peak: e.peak });
  console.log(`  ${cand.cells.map(p => p.join(',')).join('+')} 色${cand.cols.join('/')} 入${cand.entry}步 → at4=${e.at4} run4=${e.run4} 无压段=${e.lowRun} 峰值=${e.peak}`);
}

results.sort((x, y) => (y.at4 - x.at4) || (x.lowRun - y.lowRun));
const best = results[0];
if (best) {
  console.log(`\n最佳：${best.cells.map(p => p.join(',')).join('+')}（色${best.cols.join('/')}）→ at4=${best.at4} run4=${best.run4} 无压段=${best.lowRun}`);
  if (APPLY) {
    const h = JSON.parse(JSON.stringify(base));
    let maxChain = 0;
    for (const row of h.spools) for (const cell of row) {
      const ts = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
      if (ts.includes(5)) { const ps = Array.isArray(cell.param) ? cell.param : [cell.param]; const v = Number(ps[ts.indexOf(5)]); if (v > maxChain) maxChain = v; }
    }
    for (const [y, x] of best.cells) { h.spools[y][x].type = 5; h.spools[y][x].param = maxChain + 1; }
    fs.writeFileSync(APPLY, JSON.stringify(h, null, 2));
    console.log(`已写出：${APPLY}`);
  }
} else {
  console.log('\n没有候选能提升（全部不可解或超峰值）。');
}
