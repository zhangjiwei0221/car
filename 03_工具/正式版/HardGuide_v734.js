// HardGuide_v734.js —— 硬引导：把“别的入口色”的车全部塞进管道，让它们物理上很晚才出现
// 原理：管道只在正前方格空出来时才吐球；被塞进管道的颜色在棋盘上没有像素 → 根本吃不到。
// 用法：node HardGuide_v734.js <关卡.json> --out <输出.json> [--lock 28,19,16] [--auto]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const OUT = arg('--out', '/tmp/hardguide.json');
const MODE = arg('--mode', 'pipe');     // pipe=塞管道 / ice=上冰
const ICE_PARAM = Number(arg('--param', 25));

function evalLv(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let at4 = 0, run4 = 0, cur = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }
  const first = {};
  (o.pickOrder || []).forEach((p, i) => { if (first[p.color] === undefined) first[p.color] = i + 1; });
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, steps: buf.length, first, order: o.pickOrder || [] };
}

const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const R = base.spools.length, C = base.spools[0].length;
const b0 = evalLv(base);
const sum0 = base.spools.flat().filter(c => c.id > 0).reduce((a, c) => a + c.count, 0)
  + base.spools.flat().filter(c => Array.isArray(c.param)).reduce((a, c) => a + c.param.reduce((x, p) => x + p.count, 0), 0);
console.log(`基线：步${b0.steps} 峰值${b0.peak} at4=${b0.at4} 容量和=${sum0}`);

// 锁定色：默认取“除第一个被吃的颜色以外，最早出现的 3 个颜色”
let lock = String(arg('--lock', '')).split(',').map(Number).filter(n => n > 0);
if (!lock.length) {
  const order = Object.entries(b0.first).sort((a, b) => a[1] - b[1]).map(([c]) => +c);
  lock = order.slice(1, 4);
}
console.log('入口色（不经处理）：', Object.entries(b0.first).sort((a, b) => a[1] - b[1])[0]);
console.log('锁定色：', lock.join(','));

// 每个被锁色的“普通车”改造成管道（队列=它自己的球），方向朝画布外/朝最近边
const DIRS = [[-1, 0, 11], [1, 0, 12], [0, -1, 13], [0, 1, 14]];
// 早期会被取走的普通车（按基线取用顺序的前 40%）
const earlyCut = Math.max(3, Math.floor(b0.order.length * 0.4));
const earlyKey = new Set(b0.order.slice(0, earlyCut).map(p => p.r + ',' + p.c));
const h = JSON.parse(JSON.stringify(base));
let moved = 0, skipped = 0;
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const cell = h.spools[r][c];
  if (!(cell.id > 0) || !(cell.type === 0 || cell.type === '0')) continue;
  if (!lock.includes(cell.id)) continue;
  // 只朝“早期会被取走”的邻格，保证管道最终能吐球
  let t = null;
  for (const [dy, dx, tt] of DIRS) {
    const nr = r + dy, nc = c + dx;
    if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
    if (earlyKey.has(nr + ',' + nc)) { t = tt; break; }
  }
  if (t === null) { skipped++; continue; }
  h.spools[r][c] = { id: 0, type: t, param: [{ id: cell.id, count: cell.count }], count: 0 };
  moved++;
}
if (skipped) console.log(`跳过 ${skipped} 辆（没有早期邻格）`);
if (MODE === 'ice') {
  // 冰模式：把这些颜色的车全部上冰（param 之后才可点）
  let iced = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const cell = h.spools[r][c];
    if (!(cell.id > 0) || !(cell.type === 0 || cell.type === '0')) continue;
    if (!lock.includes(cell.id)) continue;
    cell.type = 7; cell.param = ICE_PARAM; iced++;
  }
  console.log(`冰模式：${iced} 辆上冰，param=${ICE_PARAM}`);
  moved = iced;
}
const sum1 = h.spools.flat().filter(c => c.id > 0).reduce((a, c) => a + (c.count || 0), 0)
  + h.spools.flat().filter(c => Array.isArray(c.param)).reduce((a, c) => a + c.param.reduce((x, p) => x + p.count, 0), 0);
console.log(`改造 ${moved} 辆为管道；容量和 ${sum1}（原 ${sum0}）守恒=${sum1 === sum0}`);

let e; try { e = evalLv(h); } catch (err) { console.log('求解异常:', err.message.slice(0, 60)); process.exit(1); }
console.log(`改造后：won=${e.won} 步${e.steps} 峰值${e.peak} at4=${e.at4} run4=${e.run4}`);
const shown = lock.map(c => `${c}@${e.first[c] || '未用'}`).join(' ');
console.log('锁定色首用：', shown);
const entryColor = +Object.entries(b0.first).sort((a, b) => a[1] - b[1])[0][0];
console.log(`入口色 ${entryColor} 首用：@${e.first[entryColor] || '未用'}`);
if (!e.won) console.log('⚠️ 改造后不可解');
fs.writeFileSync(OUT, JSON.stringify(h, null, 2));
console.log('已写出：' + OUT);
