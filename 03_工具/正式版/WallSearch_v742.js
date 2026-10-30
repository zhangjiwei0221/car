// WallSearch_v742.js —— 黑块搜索器
// 语义：黑块删的是【棋盘位置】。删掉一辆车后，它的容量并入同色其它车（同色不存在则该候选作废）。
// 目标：at4 提升（或后段变紧），约束：可解、峰值≤4、每色容量不超该色像素数、伤害阶梯不被打散。
// 用法：
//   node WallSearch_v742.js <关卡.json> --out <输出.json> [--ref ring|corner|bottom] [--mode a|b]
//        [--max-walls 2] [--min-at4-gain 3] [--max-span-drop 5] [--ablate]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes(k);
const FILE = process.argv[2];
const OUT = arg('--out', '/tmp/wall742.json');
const REF = String(arg('--ref', 'ring'));
const MODE = String(arg('--mode', 'a'));
const MAX_WALLS = Number(arg('--max-walls', 2));
const MIN_GAIN = Number(arg('--min-at4-gain', 3));
const MAX_SPAN_DROP = Number(arg('--max-span-drop', 5));
const ABLATE = has('--ablate');
const A = B.loadSolver(REF);
const INSTANT = MODE !== 'a';
const Sim = A.Simulator;

function metrics(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: INSTANT });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const n = buf.length;
  let at4 = 0, run4 = 0, cur = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }
  const from = Math.floor(n * 0.75);
  let late4 = 0; for (let i = from; i < n; i++) if (buf[i] >= 4) late4++;
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, steps: n, late4, order: o.pickOrder || [], buf };
}

// 伤害阶梯：每象限“独占色”被消 ≥10% 的首次步数
function ladder(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const R = lv.rows, C = lv.cols;
  const q = (y, x) => (y < R / 2 ? 'S' : 'X') + (x < C / 2 ? 'W' : 'E');   // SW/SE/NW/NE
  const colorQ = {};
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    const c = lv.blocks[y][x]; if (!c || c <= 0) continue;
    (colorQ[c] = colorQ[c] || new Set()).add(q(y, x));
  }
  const excl = {}; const total = {};
  for (const c in colorQ) if (colorQ[c].size === 1) {
    const k = [...colorQ[c]][0]; (excl[k] = excl[k] || new Set()).add(+c);
  }
  for (const k in excl) { total[k] = 0; for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (excl[k].has(lv.blocks[y][x])) total[k]++; }
  const m = metrics(g);
  const st = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: INSTANT });
  const cross = {};
  for (let i = 0; i < m.order.length; i++) {
    Sim.applyPick(st, m.order[i].r, m.order[i].c);
    for (const k in excl) {
      if (cross[k] !== undefined) continue;
      let n = 0; for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (st.eliminated[y][x] && excl[k].has(lv.blocks[y][x])) n++;
      if (total[k] && n / total[k] >= 0.1) cross[k] = i + 1;
    }
  }
  const vals = Object.keys(excl).map(k => cross[k] || 999).sort((a, b) => a - b);
  const real = vals.filter(v => v < 999);
  return { cross, span: real.length >= 2 ? real[real.length - 1] - real[0] : 0 };
}

// 每色像素数（校验容量不超）
function colorPixels(g) {
  const m = {};
  for (const row of g.blocks) for (const v of row) if (v > 0) m[v] = (m[v] || 0) + 1;
  return m;
}
function colorCapacity(g) {
  const m = {};
  for (const row of g.spools) for (const x of row) {
    if (x.id > 0 && (x.type === 0 || x.type === '0' || x.type === undefined)) m[x.id] = (m[x.id] || 0) + x.count;
  }
  return m;
}

const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const b0 = metrics(base);
const b0l = ladder(base);
const cp = colorPixels(base);
console.log(`基线（${REF}/${MODE}）：步${b0.steps} 峰值${b0.peak} at4=${b0.at4} run4=${b0.run4} 后段≥4=${b0.late4} 阶梯跨度=${b0l.span}`);
console.log('阶梯:', JSON.stringify(b0l.cross));

function plainCells(g) {
  const out = [];
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const x = g.spools[r][c];
    if (x.id > 0 && (x.type === 0 || x.type === '0' || x.type === undefined) && x.count > 0) out.push([r, c]);
  }
  return out;
}

// 删掉 (r,c) 的车：容量并入同色其它车（优先容量最小者），并把该格变黑
function makeWall(g, r, c) {
  const h = JSON.parse(JSON.stringify(g));
  const victim = h.spools[r][c];
  const color = victim.id, cnt = victim.count;
  let target = null;
  for (let y = 0; y < h.spools.length; y++) for (let x = 0; x < h.spools[y].length; x++) {
    if (y === r && x === c) continue;
    const o = h.spools[y][x];
    if (o.id === color && (o.type === 0 || o.type === '0' || o.type === undefined) && o.count > 0) {
      if (!target || o.count < target.cell.count) target = { y, x, cell: o };
    }
  }
  if (!target) return null;                       // 同色没有别的车 → 该候选作废
  target.cell.count += cnt;
  const cap = colorCapacity(h), px = colorPixels(h);
  if (cap[color] > (px[color] || 0)) return null; // 该色容量超过可用像素
  h.spools[r][c] = { id: -1, type: 0, param: 0, count: 0 };
  return h;
}

let cur = JSON.parse(JSON.stringify(base));
let curM = b0;
const walls = [];
for (let round = 1; round <= MAX_WALLS; round++) {
  let best = null;
  for (const [r, c] of plainCells(cur)) {
    const victim = cur.spools[r][c];
    const h = makeWall(cur, r, c);
    if (!h) continue;
    let e; try { e = metrics(h); } catch (err) { continue; }
    if (!e.won || e.peak > 4) continue;
    const gainAt4 = e.at4 - curM.at4;
    const gainLate = e.late4 - curM.late4;
    if (gainAt4 < MIN_GAIN && gainLate < MIN_GAIN) continue;
    const score = gainAt4 * 2 + gainLate;
    if (!best || score > best.score) best = { score, r, c, e, g: h, gainAt4, gainLate, color: victim.id, count: victim.count };
  }
  if (!best) { console.log(`第 ${round} 轮：没有黑块能满足“at4 或后段 +${MIN_GAIN}”且可解/峰值≤4，停止`); break; }
  cur = best.g; curM = best.e;
  walls.push({ r: best.r, c: best.c, color: best.color, count: best.count, gainAt4: best.gainAt4, gainLate: best.gainLate });
  console.log(`第 ${round} 轮放黑块 (${best.r},${best.c}) → at4 ${curM.at4}（Δ+${best.gainAt4}） 后段≥4 ${curM.late4}（Δ+${best.gainLate}） run4=${curM.run4} 峰值${curM.peak}`);
}

const curL = ladder(cur);
console.log(`\n最终：黑块 ${walls.length} 块，at4=${curM.at4}（基线${b0.at4}） run4=${curM.run4} 峰值${curM.peak} 后段≥4=${curM.late4}（基线${b0.late4}） 可解=${curM.won}`);
console.log(`阶梯跨度：${b0l.span} → ${curL.span}（下降 ${b0l.span - curL.span}，上限 ${MAX_SPAN_DROP}）`);
if (b0l.span - curL.span > MAX_SPAN_DROP) console.log('⚠ 阶梯被打散超过上限，建议否决这组黑块');

if (ABLATE && walls.length) {
  console.log('\n归因（逐块拿掉）：');
  for (const w of walls) {
    const e = (() => {
      // 直接重建：把该格恢复成一辆车（容量取颜色平均值会破坏守恒，故只做近似：从同色最大车扣回）
      const g2 = JSON.parse(JSON.stringify(cur));
      g2.spools[w.r][w.c] = { id: w.color, type: 0, param: 0, count: w.count };
      let donor = null;
      for (let y = 0; y < g2.spools.length; y++) for (let x = 0; x < g2.spools[y].length; x++) {
        const o = g2.spools[y][x];
        if ((y !== w.r || x !== w.c) && o.id === w.color && o.count >= w.count) {
          if (!donor || o.count > donor.o.count) donor = { y, x, o };
        }
      }
      if (!donor) return null;
      donor.o.count -= w.count;
      return metrics(g2);
    })();
    if (!e) { console.log(`  拿掉 (${w.r},${w.c})：无法还原（找不到同色捐赠车），跳过`); continue; }
    console.log(`  拿掉 (${w.r},${w.c})：at4 ${curM.at4}→${e.at4}（Δ${e.at4 - curM.at4}）、后段 ${curM.late4}→${e.late4}（Δ${e.late4 - curM.late4}）${(curM.at4 - e.at4 >= 3 || curM.late4 - e.late4 >= 3) ? ' ← 有职责' : ' ← 影响很小'}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(cur, null, 2));
console.log('已写出：' + OUT);
