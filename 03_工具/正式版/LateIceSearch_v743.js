// LateIceSearch_v743.js —— 目标化的冰搜索（目标＝后 25% 更紧，而不是 at4 变大）
// 做法：每轮遍历「每辆可点车 × 若干 param」，挑让 late4 涨最多且不伤 at4 的那块，贪心加到上限
// 用法：
//   node LateIceSearch_v743.js <关卡.json> --out <输出.json> [--ref ring|corner|bottom] [--mode a|b]
//        [--params 18,22,26,30,34,38,42,46] [--max-ice 3] [--at4-tol 2] [--ablate]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes(k);
const FILE = process.argv[2];
const OUT = arg('--out', '/tmp/lateice743.json');
const REF = String(arg('--ref', 'ring'));
const MODE = String(arg('--mode', 'a'));            // 默认层号/四边入口（floodFill）
// PARAMS 在 CHAIN_ONLY 之后计算，见下方
const MAX_ICE = Number(arg('--max-ice', 3));
const AT4_TOL = Number(arg('--at4-tol', 2));
const ABLATE = has('--ablate');
const CHAIN_ONLY = has('--chain-only');   // 只给“锁链组成员”上冰（成组债务）
// 链成员默认用更小的 param：冻太久会整组完不成（不可解）
const A = B.loadSolver(REF);
const INSTANT = MODE !== 'a';

const PARAMS2 = String(arg('--params', CHAIN_ONLY ? '8,12,16,20,24' : '18,22,26,30,34,38,42,46')).split(',').map(Number);

function metrics(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: INSTANT });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const n = buf.length;
  let at4 = 0, run4 = 0, cur = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }
  const from = Math.floor(n * 0.75);
  let late4 = 0, late3 = 0;
  for (let i = from; i < n; i++) { if (buf[i] >= 4) late4++; if (buf[i] >= 3) late3++; }
  const a = Math.floor(n * 0.4), e = Math.floor(n * 0.8);
  let mid4 = 0; for (let i = a; i < e; i++) if (buf[i] >= 4) mid4++;
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, steps: n, late4, late3, mid4, midN: e - a, from, buf };
}

const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const R = base.spools.length, C = base.spools[0].length;
const b0 = metrics(base);
console.log(`基线（${REF}/${MODE}）：步${b0.steps} 峰值${b0.peak} at4=${b0.at4} run4=${b0.run4} 后段≥4=${b0.late4} midLate4=${b0.mid4}/${b0.midN}`);

function typeList(t) { return Array.isArray(t) ? t : (t === 0 || t == null ? [] : [t]); }
/** 普通车（没有链/冰/管道） */
function plainCells(g) {
  const out = [];
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const x = g.spools[r][c];
    if (x.id > 0 && (x.type === 0 || x.type === '0' || x.type === undefined)) out.push([r, c]);
  }
  return out;
}
/** 锁链组成员（type 含 5），返回 [r,c,chainId] */
function chainCells(g) {
  const out = [];
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const x = g.spools[r][c];
    const ts = typeList(x.type);
    if (x.id > 0 && ts.includes(5) && !ts.includes(7)) {
      const cid = Array.isArray(x.param) ? x.param[ts.indexOf(5)] : x.param;
      out.push([r, c, cid || 0]);
    }
  }
  return out;
}
/** 给某个格子加冰：链成员 → type [5,7] + param [chainId, N]；普通车 → type 7 + param N */
function withIce(h, cell, param) {
  const x = h.spools[cell[0]][cell[1]];
  const ts = typeList(x.type);
  if (ts.includes(5)) {
    const cid = Array.isArray(x.param) ? x.param[ts.indexOf(5)] : x.param;
    x.type = [5, 7]; x.param = [cid, param];
  } else {
    x.type = 7; x.param = param;
  }
}

let cur = JSON.parse(JSON.stringify(base));
let curM = b0;
const added = [];
for (let round = 1; round <= MAX_ICE; round++) {
  let best = null;
  const rej = { unsolv: 0, peak: 0, at4: 0, nogain: 0, ok: 0 };
  const cands = CHAIN_ONLY ? chainCells(cur) : plainCells(cur).map(([r, c]) => [r, c, 0]);
  if (round === 1) console.log(`  候选来源：${CHAIN_ONLY ? '锁链组成员' : '普通车'}，共 ${cands.length} 个`);
  for (const [r, c, chainId] of cands) {
    for (const param of PARAMS2) {
      const h = JSON.parse(JSON.stringify(cur));
      withIce(h, [r, c], param);
      let e; try { e = metrics(h); } catch (err) { continue; }
      if (!e.won) { rej.unsolv++; continue; }
      if (e.peak > 4) { rej.peak++; continue; }
      if (e.at4 < b0.at4 - AT4_TOL) { rej.at4++; continue; }
      const gain = (e.late4 - curM.late4) * 3 + (e.late3 - curM.late3);
      if (gain <= 0) { rej.nogain++; continue; }
      rej.ok++;
      if (!best || gain > best.gain) best = { gain, r, c, param, e, g: h, chainId };
    }
  }
  console.log(`  第 ${round} 轮筛选统计:`, JSON.stringify(rej));
  if (!best) { console.log(`第 ${round} 轮：没有能进一步改善后段的冰，停止`); break; }
  cur = best.g; curM = best.e;
  added.push({ r: best.r, c: best.c, param: best.param, chainId: best.chainId, late4: best.e.late4, at4: best.e.at4 });
  console.log(`第 ${round} 轮加入冰 (${best.r},${best.c}) param=${best.param} → at4=${best.e.at4} run4=${best.e.run4} 后段≥4=${best.e.late4} midLate4=${best.e.mid4}/${best.e.midN}`);
}

// ── 反向剔除：贪心容易加进“当时有用、后来冗余”的冰，这里逐块尝试拿掉
let pruned = true;
while (pruned) {
  pruned = false;
  for (let i = 0; i < added.length; i++) {
    const ice = added[i];
    const h = JSON.parse(JSON.stringify(cur));
    if (ice.chainId) { h.spools[ice.r][ice.c].type = 5; h.spools[ice.r][ice.c].param = ice.chainId; }
    else { h.spools[ice.r][ice.c].type = 0; h.spools[ice.r][ice.c].param = 0; }
    const e = metrics(h);
    // 去掉后：后段几乎不掉（≤1），且 at4 变好或持平 → 判定为冗余
    if (e.peak <= 4 && e.late4 >= curM.late4 - 1 && e.at4 >= curM.at4) {
      console.log(`剔除冗余冰 (${ice.r},${ice.c}) param=${ice.param}：后段 ${curM.late4}→${e.late4}，at4 ${curM.at4}→${e.at4}`);
      cur = h; curM = e; added.splice(i, 1); pruned = true; break;
    }
  }
}

console.log(`\n最终：加冰 ${added.length} 块，at4=${curM.at4}（基线${b0.at4}） run4=${curM.run4} 峰值${curM.peak} 后段≥4=${curM.late4}（基线${b0.late4}） 可解=${curM.won}`);
console.log('后段曲线:', curM.buf.slice(curM.from).join(','));

if (ABLATE && added.length) {
  console.log('\n归因（逐块拿掉后重测）：');
  for (const ice of added) {
    const h = JSON.parse(JSON.stringify(cur));
    if (ice.chainId) { h.spools[ice.r][ice.c].type = 5; h.spools[ice.r][ice.c].param = ice.chainId; }
    else { h.spools[ice.r][ice.c].type = 0; h.spools[ice.r][ice.c].param = 0; }
    const e = metrics(h);
    const d4 = e.late4 - curM.late4, da = e.at4 - curM.at4;
    console.log(`  拿掉 (${ice.r},${ice.c}) param=${ice.param}：后段≥4 ${curM.late4}→${e.late4}（Δ${d4}）、at4 ${curM.at4}→${e.at4}（Δ${da}）${(d4 <= -2 || da <= -3) ? ' ← 有职责' : ' ← 影响很小'}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(cur, null, 2));
console.log('已写出：' + OUT);
