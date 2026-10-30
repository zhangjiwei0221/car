// PipePair_v744.js —— 最小“两色串行”管道构造
// 语义：管道占一个棋盘格；【前方格变空】时吐下一个队列球（球=车，颜色+容量）。
//       队列耗尽后管道永久占位（等同黑块）。
// 做法：选一辆“挡在管道前面”的车 Q（它被取走后，前方空出来 → 管道吐球），
//       把另一个颜色 B 的全部车塞进队列（棋盘上不再有 B），从而把 B 推迟到 Q 之后。
// 用法：
//   node PipePair_v744.js <关卡.json> --out <输出.json> [--ref ring|corner|bottom] [--mode a|b]
//        [--max-depth 6] [--min-gain 3] [--ablate]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes(k);
const FILE = process.argv[2];
const OUT = arg('--out', '/tmp/pipe744.json');
const REF = String(arg('--ref', 'ring'));
const MODE = String(arg('--mode', 'a'));
const MAX_DEPTH = Number(arg('--max-depth', 6));
const MIN_GAIN = Number(arg('--min-gain', 3));
const ABLATE = has('--ablate');
const NO_EMPTY = has('--no-empty');   // 搬空的车格直接涂黑（不允许棋盘上出现空格）
const A = B.loadSolver(REF);
const { createPool } = require('./EvalPool_v749');
const INSTANT = MODE !== 'a';

const DIRS = { 11: [-1, 0], 12: [0, 1], 13: [1, 0], 14: [0, -1] };

function metrics(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: INSTANT });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const n = buf.length;
  let at4 = 0, run4 = 0, cur = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }
  const from = Math.floor(n * 0.75);
  let late4 = 0; for (let i = from; i < n; i++) if (buf[i] >= 4) late4++;
  const firstUse = {};
  (o.pickOrder || []).forEach((p, i) => { if (firstUse[p.color] === undefined) firstUse[p.color] = i + 1; });
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, steps: n, late4, firstUse };
}

(async () => {
const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const R = base.spools.length, C = base.spools[0].length;
const b0 = metrics(base);
console.log(`基线（${REF}/${MODE}）：步${b0.steps} 峰值${b0.peak} at4=${b0.at4} run4=${b0.run4} 后段≥4=${b0.late4}`);

const isPlain = x => x && x.id > 0 && (x.type === 0 || x.type === '0' || x.type === undefined) && x.count > 0;
const plainCells = g => {
  const out = [];
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) if (isPlain(g.spools[r][c])) out.push([r, c]);
  return out;
};
const colorCars = g => {
  const m = {};
  for (const [r, c] of plainCells(g)) { const x = g.spools[r][c]; (m[x.id] = m[x.id] || []).push({ r, c, count: x.count }); }
  return m;
};

// 候选 B：有 ≥2 辆普通车的颜色，按基线里“首次可用步数”倒序（越晚越好）
const cars = colorCars(base);
const bCands = Object.keys(cars).map(Number)
  .filter(id => cars[id].length >= 2 && cars[id].length <= MAX_DEPTH)
  .sort((a, b) => (b0.firstUse[b] || 999) - (b0.firstUse[a] || 999))
  .slice(0, 3);
console.log('候选 B（被藏起来的颜色）:', bCands.map(id => `${id}×${cars[id].length}辆`).join(' '));

function build(g, Bcolor, pipeR, pipeC, dir, frontR, frontC) {
  const h = JSON.parse(JSON.stringify(g));
  const pipeCell = h.spools[pipeR][pipeC];
  if (pipeCell.id === -1) return null;                       // 黑块不能放管道
  // 1) B 的容量全部入队（每辆一球），格子清空
  const q = cars[Bcolor].map(x => ({ id: Bcolor, count: x.count }));
  for (const x of cars[Bcolor]) h.spools[x.r][x.c] = { id: 0, type: 0, param: 0, count: 0 };
  // 2) 管道格：若原本有车（非 B），把它的容量也塞进队列末尾（该色一起被藏起来）
  if (isPlain(pipeCell) && pipeCell.id !== Bcolor) {
    q.push({ id: pipeCell.id, count: pipeCell.count });
  } else if (!(pipeCell.id === 0 || pipeCell.id === undefined || pipeCell.id === -1)) {
    return null;                                             // 链/冰/管道格：不动
  }
  if (q.length > MAX_DEPTH) return null;
  h.spools[pipeR][pipeC] = { id: 0, type: dir, param: q, count: 0 };
  if (NO_EMPTY) {
    // 被搬空的车格 → 黑块（保证棋盘上没有空格）
    for (const x of cars[Bcolor]) {
      if (x.r === pipeR && x.c === pipeC) continue;
      h.spools[x.r][x.c] = { id: -1, type: 0, param: 0, count: 0 };
    }
  }
  return h;
}

const batch = [];
let best = null;
const rej = { noSlot: 0, unsolv: 0, peak: 0, nogain: 0, noserial: 0, ok: 0 };
for (const Bcolor of bCands) {
  for (const [fr, fc] of plainCells(base)) {          // 挡在管道前面的车 Q
    for (const dir of [11, 12, 13, 14]) {
      const [dr, dc] = DIRS[dir];
      const pr = fr - dr, pc = fc - dc;                // 管道在 Q 的反方向一格
      if (pr < 0 || pr >= R || pc < 0 || pc >= C) continue;
      const h = build(base, Bcolor, pr, pc, dir, fr, fc);
      if (!h) { rej.noSlot++; continue; }
      batch.push({ Bcolor, pr, pc, dir, fr, fc, h });
    }
  }
}

// 并行评估全部候选
{
  const pool = createPool({ workers: Number(process.env.EVAL_WORKERS || 6), ref: REF, mode: MODE });
  const evals = await pool.evalAll(batch.map(b => b.h));
  await pool.close();
  for (let i = 0; i < batch.length; i++) {
    const b = batch[i], e = evals[i];
    if (!e || e.error) continue;
    if (!e.won) { rej.unsolv++; continue; }
    if (e.peak > 4) { rej.peak++; continue; }
    const gainAt4 = e.at4 - b0.at4, gainLate = e.late4 - b0.late4;
    if (gainAt4 < MIN_GAIN && gainLate < MIN_GAIN) { rej.nogain++; continue; }
    const bFirst = e.firstUse[BcolorOf(b)] || 999;
    const qFirst = e.firstUse[base.spools[b.fr][b.fc].id] || 0;
    if (bFirst < qFirst + 3) { rej.noserial++; continue; }
    const score = gainAt4 * 2 + gainLate;
    if (!best || score > best.score) best = { score, Bcolor: b.Bcolor, pr: b.pr, pc: b.pc, dir: b.dir, fr: b.fr, fc: b.fc, e, g: b.h, bFirst, qFirst, gainAt4, gainLate };
  }
}
function BcolorOf(b) { return b.Bcolor; }

console.log('筛选统计:', JSON.stringify(rej));
if (!best) { console.log('没有管道候选能同时满足：可解 / 峰值≤4 / at4或后段 +' + MIN_GAIN + ' / 串行', '→ 本关失败'); process.exit(0); }
console.log(`\n最佳管道：色${best.Bcolor} 入队 ${cars[best.Bcolor].length} 球，管道 (${best.pr},${best.pc}) dir=${best.dir}，前方挡车 (${best.fr},${best.fc})`);
console.log(`结果：at4 ${b0.at4}→${best.e.at4}（Δ+${best.gainAt4}） run4=${best.e.run4} 后段≥4 ${b0.late4}→${best.e.late4} 峰值${best.e.peak} 可解=${best.e.won}`);
console.log(`串行：色${best.Bcolor} 首次可用第 ${best.bFirst} 步；挡车色首次第 ${best.qFirst} 步`);

if (ABLATE) {
  // 管道的唯一改动就是“这个构造”，所以归因 = 与基线对比（不再尝试逐格还原，避免还原不全）
  const dAt4 = best.e.at4 - b0.at4, dLate = best.e.late4 - b0.late4;
  console.log(`\n归因（等价于拿掉管道、回到基线）：at4 ${b0.at4}→${best.e.at4}（Δ+${dAt4}）、后段 ${b0.late4}→${best.e.late4}（Δ+${dLate}）${(dAt4 >= 3 || dLate >= 3) ? ' ← 有职责' : ' ← 影响很小'}`);
}

fs.writeFileSync(OUT, JSON.stringify(best.g, null, 2));
console.log('已写出：' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
