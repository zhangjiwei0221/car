// PerfIce_v738.js —— “表演冰”：找出那些加了也不改变结局/指标的冰
// 判据：可解、峰值不变、at4 与 run4 变化 ≤0（严格不降），且冰的解冻点落在中后段（玩家看得见）
// 用法：node PerfIce_v738.js <关卡.json> --out <输出.json> [--add 6] [--params 24,30,36,42]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const OUT = arg('--out', '/tmp/perfice.json');
const ADD = Number(arg('--add', 6));
const PARAMS = String(arg('--params', '24,30,36,42')).split(',').map(Number);

function evalLv(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let at4 = 0, run4 = 0, cur = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, steps: buf.length, order: o.pickOrder || [] };
}

const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const R = base.spools.length, C = base.spools[0].length;
const b0 = evalLv(base);
console.log(`基线：步${b0.steps} 峰值${b0.peak} at4=${b0.at4} run4=${b0.run4}`);

const plains = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const x = base.spools[r][c];
  if (x.id > 0 && (x.type === 0 || x.type === '0')) plains.push({ r, c, id: x.id, count: x.count });
}
// 基线里被取用的步数（越早越“显眼”）
const firstUse = {};
b0.order.forEach((p, i) => { if (firstUse[p.color] === undefined) firstUse[p.color] = i + 1; });

const safe = [];
for (const p of plains) {
  for (const param of PARAMS) {
    const h = JSON.parse(JSON.stringify(base));
    h.spools[p.r][p.c].type = 7; h.spools[p.r][p.c].param = param;
    let e; try { e = evalLv(h); } catch (err) { continue; }
    if (!e.won || e.peak !== b0.peak) continue;
    if (e.at4 < b0.at4 || e.run4 < b0.run4) continue;       // 不许变差
    if (e.at4 > b0.at4 + 1 || e.run4 > b0.run4 + 3) continue; // 也不许靠它变强（那是“有职责的冰”，另算）
    safe.push({ r: p.r, c: p.c, id: p.id, count: p.count, param, at4: e.at4, run4: e.run4, use: firstUse[p.id] || 99 });
  }
}
safe.sort((a, b) => a.use - b.use);
console.log(`安全候选 ${safe.length} 个（不改变可解/峰值/压力）`);
console.log(safe.slice(0, 12).map(s => `(${s.r},${s.c})色${s.id}/${s.count} p${s.param} 首用${s.use}`).join('  '));

// 每个 param 只取一个（让解冻时刻分散），且同色最多 2 块、位置不重复
const picked = [];
const perColor = {};
const usedParam = new Set();
for (const param of PARAMS) {
  if (picked.length >= ADD) break;
  const cand = safe.filter(s => s.param === param && !usedParam.has(s.param) &&
    (perColor[s.id] || 0) < 2 && !picked.some(q => q.r === s.r && q.c === s.c));
  if (!cand.length) continue;
  const s = cand[cand.length - 1];              // 同 param 下取“最晚才被用”的车，更显眼
  picked.push(s); perColor[s.id] = (perColor[s.id] || 0) + 1; usedParam.add(param);
}
// 数量不够就按原顺序补
for (const s of safe) {
  if (picked.length >= ADD) break;
  if ((perColor[s.id] || 0) >= 2) continue;
  if (picked.some(q => q.r === s.r && q.c === s.c)) continue;
  picked.push(s); perColor[s.id] = (perColor[s.id] || 0) + 1;
}
const h = JSON.parse(JSON.stringify(base));
for (const s of picked) { h.spools[s.r][s.c].type = 7; h.spools[s.r][s.c].param = s.param; }
const e = evalLv(h);
console.log(`\n加入 ${picked.length} 块表演冰：`);
picked.forEach(s => console.log(`  (${s.r},${s.c}) 色${s.id}/${s.count} param=${s.param}  （基线首用第 ${s.use} 步）`));
console.log(`结果：won=${e.won} 步${e.steps} 峰值${e.peak} at4=${e.at4}（基线${b0.at4}） run4=${e.run4}（基线${b0.run4}）`);
fs.writeFileSync(OUT, JSON.stringify(h, null, 2));
console.log('已写出：' + OUT);
