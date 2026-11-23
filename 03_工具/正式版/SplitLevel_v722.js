#!/usr/bin/env node
'use strict';
/**
 * 自写切块器 v722
 * 目标：把目标图按颜色切成“车”，保证 sum(容量) == 目标像素（不丢余量），
 * 再按棋盘摆放成关卡 JSON，并用求解器给出首测数字。
 *
 * 为什么要自己切：GenAnchorCut 的锚点切对“细框 + 小点缀”的图会丢余量
 * （实测 40×40 的拼接图丢 60~130px），容量对不上就没法用。
 *
 * 用法：
 *   node SplitLevel_v722.js --target <目标图.txt> --out <关卡.json> [--rows 7 --cols 7]
 *                            [--box-min 20 --box-max 40] [--seed 1001]
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const target = arg('--target', '实验关/目标图_拼接/拼接_四主体v14_40x40.txt');
const out = arg('--out', '实验关/关卡拼接/v14_self/关卡_自切_v722.json');
const rows = Number(arg('--rows', 7));
const cols = Number(arg('--cols', 7));
const boxMin = Number(arg('--box-min', 18));
// 【2026-11-03】--by-order：按消除顺序（corner 的 D 值）切车，容量递减
// 动机：现在每辆车都切 25，但中后段各色只剩 4~25 像素 → 永远吃不满 → 「没得选」
const BY_ORDER = process.argv.includes('--by-order');
// 【2026-11-03 用户定】边框放「吃不满的大车」：开局牌面上能吃满的少，玩家才被迫犹豫。
// 吃满比 = 车容量 / 该色在图边框上的像素数；>1 表示开局吃不满。
const EDGE_BIG = !process.argv.includes('--no-edge-big');
// 【2026-11-04 用户定】按色号指定切法（剧本化切车）：
//   --color-plan "22:small,32:small,1:door30,30:tag5"
//   small  = 切成多辆 5–10px 的小车（免费过渡车）
//   doorN  = 第一辆切 N px（门：吃不满但占位少）
//   tagN   = 第一辆切 N px（被锁链带着走的"签"）
const COLOR_PLAN = {};
String(arg('--color-plan', '')).split(',').filter(Boolean).forEach(function (x) {
  const kv = x.split(':');
  if (kv.length === 2) COLOR_PLAN[Number(kv[0])] = kv[1];
});
const ORDER_RATIO = Number(arg('--order-ratio', '0.75'));
const boxMax = Number(arg('--box-max', 46));
const seed = Number(arg('--seed', 1001));
const debtColors = Number(arg('--debt-colors', 0));
const guideColor = Number(arg('--guide-color', 0));
const lockOthers = Number(arg('--lock-others', 0));   // 给“非引导色”的车加冰锁，param=该值
const guideOnly = argv.includes('--guide-only');       // 外圈只放引导色 + 开局暴露色
const buryColors = String(arg('--bury-colors', '')).split(',').map(Number).filter(n => n > 0); // 埋到棋盘最里面
const noSplit = String(arg('--no-split-colors', '')).split(',').map(Number).filter(n => n > 0);   // 这些颜色不拆车（整色一辆）
const iceColors = String(arg('--ice-colors', '')).split(',').map(Number).filter(n => n > 0);
const iceParam = Number(arg('--ice-param', 12));   // 想让玩家先开的主体边框色
const debtFactor = Number(arg('--debt-factor', 1.5));

// ---------- 读目标图 ----------
function loadTarget(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const body = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return body.filter(l => l.trim()).map(l => l.trim().split(/\s+/).map(Number));
}
const g = loadTarget(target);
const R = g.length, C = g[0].length;
const cells = R * C;

// ---------- 颜色 -> 连通区 ----------
function regions() {
  const seen = Array.from({ length: R }, () => new Array(C).fill(false));
  const out = {};
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    if (seen[y][x]) continue;
    const col = g[y][x];
    const st = [[y, x]]; seen[y][x] = true; const list = [];
    while (st.length) {
      const [cy, cx] = st.pop(); list.push([cy, cx]);
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = cy + dy, nx = cx + dx;
        if (ny >= 0 && nx >= 0 && ny < R && nx < C && !seen[ny][nx] && g[ny][nx] === col) {
          seen[ny][nx] = true; st.push([ny, nx]);
        }
      }
    }
    (out[col] = out[col] || []).push(list);
  }
  return out;
}
const reg = regions();
const totals = {};
// 【2026-11-03】图边框（开局可达）每色像素数——陷阱大车不能超过这个的 1.3 倍，
// 否则 167 这种车会又大又没用（玩家一看就知道吃不满，直接懵）
const BOTTOM_ONLY = process.argv.includes('--bottom-only');
const edgeReach = {};
for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
  if (BOTTOM_ONLY ? (y === R - 1) : (y === 0 || x === 0 || y === R - 1 || x === C - 1)) {
    edgeReach[g[y][x]] = (edgeReach[g[y][x]] || 0) + 1;
  }
}
for (const col of Object.keys(reg)) totals[col] = reg[col].reduce((a, r) => a + r.length, 0);

// ---------- 债注入计划（可选） ----------
const debtPlan = {};
if (debtColors > 0) {
  const order = Object.keys(reg).sort((a, b) => totals[b] - totals[a]).slice(0, debtColors);
  for (const col of order) {
    const maxRegion = Math.max(...reg[col].map(r => r.length));
    const want = Math.min(Math.floor(totals[col] * 0.6), Math.ceil(maxRegion * debtFactor) + 2);
    const need = Math.max(want, Math.min(boxMax, totals[col] - boxMin));
    if (need > maxRegion && totals[col] - need >= boxMin) debtPlan[col] = need;
  }
}
// ---------- 开局暴露色（贴边界的颜色） ----------
const exposed = new Set();
if (BOTTOM_ONLY) {
  for (let x = 0; x < C; x++) exposed.add(g[R - 1][x]);
} else {
  for (let x = 0; x < C; x++) { exposed.add(g[0][x]); exposed.add(g[R - 1][x]); }
  for (let y = 0; y < R; y++) { exposed.add(g[y][0]); exposed.add(g[y][C - 1]); }
}
// ---------- 每色切成块（精确划分，不丢像素） ----------
// 通过调整 targetSize 让块数 <= 格子数；只允许同色相邻块合并
let _trapDbg = { calls: 0, pushes: {} };
function splitAll(targetSize) {
  const out = [];
  for (const col of Object.keys(reg)) {
    if (noSplit.includes(Number(col))) {
      const pool0 = [];
      for (const region of reg[col]) for (const p of region) pool0.push(p);
      out.push({ color: Number(col), cells: pool0, count: pool0.length, first: pool0[0] });
      continue;
    }
    const debtNeed = debtPlan[col];
    const pool = [];
    for (const region of reg[col]) for (const p of region) pool.push(p);
    if (BY_ORDER) {
      // D 值 = (最后一行-行) + 列，升序 = 先被消的在前
      pool.sort((a, b) => (((R - 1 - a[0]) + a[1]) - ((R - 1 - b[0]) + b[1])) || (a[0] - b[0]));
    } else if (BOTTOM_ONLY) {
      // 三面墙（仅底边入口）：自底向上剥离，行号大（靠近底边 R-1）的像素先被消！
      pool.sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));
    } else {
      pool.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    }
    let idx = 0;
    // ---- 剧本化切车（优先于 by-order / trap）----
    if (process.env.PLAN_DEBUG) console.error('[plan] 色'+col+' 命中='+!!COLOR_PLAN[Number(col)]+' 全表='+JSON.stringify(COLOR_PLAN));
    if (COLOR_PLAN[Number(col)]) {
      const rule = COLOR_PLAN[Number(col)];
      const T = pool.length;
      let counts = [];
      if (rule === 'small') {
        // 小车要"多但别太多"：每色最多 5 辆，每辆 10–16px（再多就会被车数上限合并回去）
        const maxN = Math.max(2, Math.min(5, Math.round(T / 12)));
        let left = T;
        for (let i = 0; i < maxN && left > 0; i++) {
          const take = i === maxN - 1 ? left : Math.round(left / (maxN - i));
          if (take > 0) counts.push(take);
          left -= take;
        }
      } else {
        const m = rule.match(/^(door|tag)(\d+)$/);
        if (m) {
          const n = Math.max(4, Math.min(T - 4, Number(m[2])));
          counts = [n];
          let left = T - n;
          // 剩下的切成 2–3 辆
          const k = Math.max(1, Math.min(3, Math.ceil(left / Math.max(20, targetSize))));
          for (let i = 0; i < k && left > 0; i++) {
            const take = i === k - 1 ? left : Math.round(left / (k - i));
            if (take > 0) counts.push(take);
            left -= take;
          }
        }
      }
      if (process.env.PLAN_DEBUG) console.error('[plan]   色'+col+' rule='+rule+' T='+T+' counts='+counts.join(','));
      if (counts.length) {
        let idx3 = 0;
        for (const cnt of counts) {
          if (idx3 >= pool.length) break;
          const take = Math.min(cnt, pool.length - idx3);
          const chunk = pool.slice(idx3, idx3 + take);
          idx3 += take;
          if (chunk.length) out.push({ color: Number(col), cells: chunk, count: chunk.length, first: chunk[0] });
        }
        continue;
      }
    }
    if (BY_ORDER) {
      // 固定车数，容量按几何级数递减：前面的车大（开局像素多），最后一辆很小（只剩几个）
      // 【2026-11-03 用户选 C′】顺序陷阱：部分颜色切成「1 大 + N 小」。
      // 先取大车 → 开局可达量不够 → 吃不满占格；后面小车把像素抢光 → 大车永远差一点 → 死。
      // 但先取小车则大车最终能吃满（总量守恒），所以最优路线仍然可通。
      const TRAP_RATIO = Number(arg('--trap-ratio', '0.3'));
      // 陷阱色取「最大的几个颜色」——小色设陷阱玩家根本碰不到，等于没设
      // 陷阱色改选「开局可达量小」的颜色：陷阱车只要略大于可达量就有效，
      // 选大色会逼出 94/167 这种大得离谱的车（用户：太巨大了）
      const _sortedCols = Object.keys(reg).filter(c2 => (edgeReach[c2] || 0) > 0)
        .sort((a, b) => (edgeReach[a] || 0) - (edgeReach[b] || 0));
      const _trapN = Math.max(1, Math.round(_sortedCols.length * TRAP_RATIO));
      const _rank = _sortedCols.indexOf(String(col));
      const isTrap = (pool.length >= Math.max(40, targetSize * 2)) && _rank >= 0 && _rank < _trapN;
      if (isTrap) {
        const _reach = edgeReach[col] || 0;
        const _capBig = _reach > 0 ? Math.round(_reach * 1.3) : Math.round(pool.length * 0.55);
        // 必须小于该色像素数，否则超切 → 像素丢失（实测色24 只有6像素却要切25）
        const bigN = Math.min(pool.length - 4, Math.max(targetSize, Math.min(Math.round(pool.length * 0.55), _capBig)));
        const restN = pool.length - bigN;
        const k = Math.max(2, Math.round(restN / targetSize));
        const counts2 = [bigN];
        let acc = 0;
        for (let i = 0; i < k; i++) {
          const take = i === k - 1 ? restN - acc : Math.round(restN / k);
          if (take > 0) counts2.push(take);   // 不能 Math.max(4,…)：会把容量放大，破坏守恒
          acc += take;
        }
        _trapDbg.calls++; _trapDbg.pushes[col] = (_trapDbg.pushes[col]||0) + counts2.length;
        if (process.env.SPLIT_DEBUG) console.error('[trap] 色'+col, '像素'+pool.length, 'targetSize'+targetSize, 'counts2='+counts2.join(','), '第'+_trapDbg.calls+'次');
        let idx2 = 0;
        for (const cnt of counts2) {
          if (idx2 >= pool.length) break;
          const take = Math.min(cnt, pool.length - idx2);
          const chunk = pool.slice(idx2, idx2 + take);
          idx2 += take;
          if (chunk.length) out.push({ color: Number(col), cells: chunk, count: chunk.length, first: chunk[0] });
        }
        continue;
      }
      const N = Math.max(1, Math.ceil(pool.length / targetSize));
      const w = []; for (let i = 0; i < N; i++) w.push(Math.pow(ORDER_RATIO, i));
      const ws = w.reduce((a, b) => a + b, 0);
      // 【2026-11-03 用户指出】必须限幅：否则小色（1~2 辆车）会出现 210 这种吃不满的死车。
      // 溢出/缺口匀给还没到边界的那几辆，而不是全塞给第一辆。
      const CAP_LO = Number(arg('--cap-low', '8'));
      // 【2026-11-03 用户指出】写死 60 会抹掉设计意图：开局白色可达 76，车只有 60 → 怎么点都吃满 → 白送 11 步。
      // 上限改为跟着该色总像素走（取 60 与 该色像素×0.6 的较大者，再封顶 120），
      // 这样前几辆车会大于"开局可达量"，注定吃不满 → 才有开局压力。
      const CAP_HI = Math.min(Number(arg('--cap-high', '120')),
        Math.max(60, Math.round(pool.length * 0.6)));
      // 下限不能超过该色像素数：色24 只有 6 像素，CAP_LO=8 会把容量切多（实测 1219 vs 1225）
      const LO = Math.min(CAP_LO, pool.length);
      const counts = w.map(x => Math.min(CAP_HI, Math.max(LO, Math.round(pool.length * x / ws))));
      let diff = pool.length - counts.reduce((a, b) => a + b, 0);
      let guard2 = 0;
      while (diff !== 0 && guard2++ < 5000) {
        let moved = false;
        if (diff > 0) {
          for (let i = 0; i < counts.length && diff > 0; i++) if (counts[i] < CAP_HI) { counts[i]++; diff--; moved = true; }
        } else {
          for (let i = counts.length - 1; i >= 0 && diff < 0; i--) if (counts[i] > LO) { counts[i]--; diff++; moved = true; }
        }
        if (!moved) break;
      }
      let idx2 = 0;
      for (const cnt of counts) {
        if (idx2 >= pool.length) break;
        const take = Math.min(cnt, pool.length - idx2);
        const chunk = pool.slice(idx2, idx2 + take);
        idx2 += take;
        if (chunk.length) out.push({ color: Number(col), cells: chunk, count: chunk.length, first: chunk[0] });
      }
      if (idx2 < pool.length) {
        const rest = pool.slice(idx2);
        if (out.length && out[out.length - 1].color === Number(col)) { out[out.length - 1].count += rest.length; out[out.length - 1].cells = out[out.length - 1].cells.concat(rest); }
        else out.push({ color: Number(col), cells: rest, count: rest.length, first: rest[0] });
      }
      continue;
    }
    if (debtNeed && debtNeed > 0) {
      const chunk = pool.slice(0, debtNeed);
      out.push({ color: Number(col), cells: chunk, count: chunk.length, first: chunk[0] });
      idx = debtNeed;
    }
    while (idx < pool.length) {
      const remain = pool.length - idx;
      let take = Math.min(targetSize, remain);
      if (remain - take > 0 && remain - take < boxMin) take = remain;
      const chunk = pool.slice(idx, idx + take);
      idx += take;
      out.push({ color: Number(col), cells: chunk, count: chunk.length, first: chunk[0] });
    }
  }
  return out;
}
let targetSize = Math.max(boxMin, Math.min(boxMax, Math.round(cells / (rows * cols))));
let boxes = splitAll(targetSize);
let guard = 0;
while (boxes.length > rows * cols && targetSize < boxMax && guard++ < 200) {
  targetSize++;
  boxes = splitAll(targetSize);
}
// 【2026-11-03】陷阱会减少车数（大车吸收更多像素）→ 车数不足会留空格，反向缩小切块
while (boxes.length < rows * cols && targetSize > boxMin && guard++ < 400) {
  targetSize--;
  boxes = splitAll(targetSize);
}
// 若仍超出，只能同色合并（绝不跨色）
while (boxes.length > rows * cols) {
  boxes.sort((a, b) => a.count - b.count);
  // 不能直接 shift 最小车：它可能独苗（如露营的色24 只有 1 辆）→ 无法合并 → break → 整车丢失
  let pick = -1;
  for (let i = 0; i < boxes.length; i++) {
    if (boxes.some((b, j) => j !== i && b.color === boxes[i].color)) { pick = i; break; }
  }
  if (pick < 0) break;
  const small = boxes.splice(pick, 1)[0];
  const sameIdx = boxes.findIndex(b => b.color === small.color);
  boxes[sameIdx].count += small.count;
  boxes[sameIdx].cells = boxes[sameIdx].cells.concat(small.cells);
}
// 摆放顺序：按颜色聚在一起（同色相邻，方便成链）
const order = String(arg('--order', 'pos'));
if (order === 'color') {
  boxes.sort((a, b) => (a.color - b.color) || (a.first[0] - b.first[0]) || (a.first[1] - b.first[1]));
} else if (order === 'rand') {
  let rs = seed >>> 0 || 1;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  for (let i = boxes.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [boxes[i], boxes[j]] = [boxes[j], boxes[i]]; }
} else if (BOTTOM_ONLY) {
  // 三面墙：靠近底边（first[0] 大）的车排在前面（spools row 0），顶边（first[0] 小）的车排在深行（spools row 6）！
  boxes.sort((a, b) => (b.first[0] - a.first[0]) || (a.first[1] - b.first[1]));
} else {
  boxes.sort((a, b) => (a.first[0] - b.first[0]) || (a.first[1] - b.first[1]));
}

// ---------- 摆盘 ----------
// 引导模式：外圈优先放“引导色”，其次放“开局未暴露的颜色”（拿不动→形成债），
// 其余“开局暴露的其他边框色”压到内圈，玩家不会一上来就开别的壳。
let placed;
if (buryColors.length > 0) {
  // 把指定颜色的车埋到棋盘中心，其它（入口色+背景色）放外圈
  const ring = [], inner = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) ring.push([r, c]); else inner.push([r, c]);
  }
  // 内圈按“离中心距离”排序，越深越先放要埋的颜色
  const cy = (rows - 1) / 2, cx = (cols - 1) / 2;
  inner.sort((a, b) => {
    const da = Math.abs(a[0] - cy) + Math.abs(a[1] - cx);
    const db = Math.abs(b[0] - cy) + Math.abs(b[1] - cx);
    return da - db;
  });
  const buried = boxes.filter(b => buryColors.includes(b.color));
  const others2 = boxes.filter(b => !buryColors.includes(b.color));
  placed = new Array(rows * cols).fill(null);
  const slots = ring.concat(inner);
  let i = 0;
  // 先填外圈：入口色优先，其余按原顺序
  const guideFirst = others2.filter(b => b.color === guideColor).concat(others2.filter(b => b.color !== guideColor));
  for (const b of guideFirst) { if (i >= ring.length) break; const [sr, sc] = slots[i++]; placed[sr * cols + sc] = b; }
  // 再填内圈：普通色在外，埋的颜色最里面
  const innerSlots = slots.slice(ring.length);
  const ordered = others2.filter(b => guideFirst.indexOf(b) < 0).concat(buried);
  let j = 0;
  for (const b of ordered) { if (j >= innerSlots.length) break; const [sr, sc] = innerSlots[j++]; placed[sr * cols + sc] = b; }
} else if (guideColor > 0) {
  const ring = [], inner = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) ring.push([r, c]); else inner.push([r, c]);
  }
  const guide = boxes.filter(b => b.color === guideColor);
  const hidden = guideOnly ? [] : boxes.filter(b => b.color !== guideColor && !exposed.has(b.color));
  const others = boxes.filter(b => b.color !== guideColor && (guideOnly ? exposed.has(b.color) : exposed.has(b.color)));
  const rest = boxes.filter(b => b.color !== guideColor && !others.includes(b) && !hidden.includes(b));
  placed = new Array(rows * cols).fill(null);
  const slots = ring.concat(inner);
  let i = 0;
  for (const b of guide.concat(hidden).concat(others).concat(rest)) {
    if (i >= slots.length) break;
    const [sr, sc] = slots[i++];
    placed[sr * cols + sc] = b;
  }
} else if (BOTTOM_ONLY) {
  // 【2026-11-22 真·三面墙摆盘】上/左/右三面被墙封死，目标图严格从底边 (y = R-1) 自下往上逐层溶解！
  // 若沿用四边 EDGE_BIG 按全图最大车塞 row 0，会把顶边大色车塞进 row 0 导致开局第一排无车可消当场死锁。
  // 正确做法：按每辆车所辖像素块在目标图中的【最底行 max(y) 降序（越靠底边越先暴露）+ 容量适中】排入 7x7 棋盘！
  // 且对每辆车记录 maxRow = max(cell[0]) 与 meanRow，让 row 0..6 顺应自底向上的剥离层序，同时加入可控交错。
  for (const b of boxes) {
    let maxY = -1, sumY = 0;
    for (const [cy, cx] of b.cells) { if (cy > maxY) maxY = cy; sumY += cy; }
    b.maxY = maxY;
    b.meanY = sumY / Math.max(1, b.cells.length);
  }
  // 【2026-11-22 改进点1：--stagger-cap 同色大小车错配】
  // 对同色 >=2 辆车的颜色，在保持该色总像素 100% 守恒且每车 >=10px (不触发 LayoutScore <8px) 的前提下，
  // 将均等豆腐块 (19,19,19) 改造为阶梯容量 (如 27,19,11 或 26,12)，让玩家必须看车上数字评估暴露像素量！
  if (process.argv.includes('--stagger-cap')) {
    const byCol = {};
    for (const b of boxes) (byCol[b.color] = byCol[b.color] || []).push(b);
    for (const cid of Object.keys(byCol)) {
      const arr = byCol[cid];
      if (arr.length < 2) continue;
      // 按靠近底边排序：浅层车与中层车做大小错配
      arr.sort((a, b) => (b.maxY - a.maxY) || (b.meanY - a.meanY));
      const n = arr.length;
      const pairs = Math.floor(n / 2);
      for (let k = 0; k < pairs; k++) {
        // 交替把第 k 辆做大/做小，使前排既有大车（诱饵：点早了卡槽需异色车剥层救）又有小车（活路：直接吃满退场）
        const bigFirst = ((Number(cid) + k) % 2 === 0);
        const hi = bigFirst ? arr[k] : arr[n - 1 - k];
        const lo = bigFirst ? arr[n - 1 - k] : arr[k];
        const delta = Math.min(8, Math.max(0, lo.count - 11), Math.max(0, 34 - hi.count));
        if (delta >= 3) {
          hi.count += delta;
          lo.count -= delta;
        }
      }
    }
  }
  // 按 (maxY 降序, meanY 降序) 排列，使得底边暴露的车自然排在 row 0..2，顶边深处的车排在 row 4..6
  boxes.sort((a, b) => (b.maxY - a.maxY) || (b.meanY - a.meanY) || (a.count - b.count));
  placed = boxes.slice();
} else if (process.argv.includes('--stagger-cap')) {
  // 【2026-11-23 v6 升级：四边无墙按洋葱圈层深摆盘 + 同色大小车错配 + 终局中心层沉底】
  // 计算每辆车所辖像素距四边的最小外圈距离 minRing（0=贴四边外框开局直消，越大越靠近目标图中心洋葱心！）
  for (const b of boxes) {
    let minD = 999, sumD = 0;
    for (const [cy, cx] of b.cells) {
      const d = Math.min(cy, R - 1 - cy, cx, C - 1 - cx);
      if (d < minD) minD = d;
      sumD += d;
    }
    b.minRing = minD;
    b.meanRing = sumD / Math.max(1, b.cells.length);
  }
  const byCol = {};
  for (const b of boxes) (byCol[b.color] = byCol[b.color] || []).push(b);
  for (const cid of Object.keys(byCol)) {
    const arr = byCol[cid];
    if (arr.length < 2) continue;
    arr.sort((a, b) => (a.minRing - b.minRing) || (a.meanRing - b.meanRing));
    const n = arr.length;
    const pairs = Math.floor(n / 2);
    for (let k = 0; k < pairs; k++) {
      // 前小后大 + 交错：前排给 14-20px 亲民车防开局死锁，中后段给 28-38px 大车造拉扯
      const lo = arr[k], hi = arr[n - 1 - k];
      const delta = Math.min(7, Math.max(0, lo.count - 14), Math.max(0, 42 - hi.count));
      if (delta >= 3) {
        lo.count -= delta;
        hi.count += delta;
      }
    }
  }
  // 按 (minRing 升序, meanRing 升序) 排入 row 0..6：
  //   row 0..1 100% 是贴四边外框(minRing=0)开局直消的车；
  //   row 5..6 则是目标图最中心(minRing最大)最后 25% 才剥到的洋葱心车！
  boxes.sort((a, b) => (a.minRing - b.minRing) || (a.meanRing - b.meanRing) || (a.count - b.count));
  placed = boxes.slice();
} else if (EDGE_BIG) {
  // 边框（开局可见）放大车 → 开局没几个能一口吃满的；内部放小车当后段奖励
  const edge = [], inner2 = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) edge.push([r, c]); else inner2.push([r, c]);
  }
  const reach = {};
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    if (y === 0 || x === 0 || y === R - 1 || x === C - 1) reach[g[y][x]] = (reach[g[y][x]] || 0) + 1;
  }
  const ratio = b => (b.count || 1) / Math.max(1, reach[b.color] || 1);
  // 按「容量本身」降序：大车放边框、小车进内部。
  // 用 ratio 排序是错的——79 的车对白色(可达76) ratio 只有 1.04，反而被排到内部（用户看到边缘全是小车）
  const sorted = boxes.slice().sort((a, b) => (b.count || 0) - (a.count || 0));
  // 边框上只放一部分大车（比例可调）：全放 → 太脆（实测容错掉到 30%）
  const BIG_RATIO = Number(arg('--edge-big-ratio', '0.6'));
  const edgeBigN = Math.max(0, Math.min(edge.length, Math.round(edge.length * BIG_RATIO)));
  // 【2026-11-03 修】原来的 bigCars/restCars 是连续切两段，拼起来永远是 sorted 的前 24 个
  // → --edge-big-ratio 设 0.3 还是 0.9，边框完全一样（参数从没生效过）。
  // 正确：边框 = 最大的 N 个 + 最小的 (24-N) 个；中间那批放内部。
  const edgeSmallN = Math.max(0, edge.length - edgeBigN);
  const edgeCars = sorted.slice(0, edgeBigN)
    .concat(edgeSmallN > 0 ? sorted.slice(sorted.length - edgeSmallN) : []);
  const innerCars = sorted.slice(edgeBigN, sorted.length - edgeSmallN);
  if (process.env.EDGE_DEBUG) console.error('[edge] cars='+boxes.length+' edge='+edge.length+' 边框大'+edgeBigN+' 边框小'+edgeSmallN+' 内部'+innerCars.length);
  placed = new Array(rows * cols).fill(null);
  let idx = 0;
  for (const [sr, sc] of edge) { const b = edgeCars[idx]; if (b) placed[sr * cols + sc] = b; idx++; }
  for (const [sr, sc] of inner2) { const b = innerCars[idx - edge.length]; if (b) placed[sr * cols + sc] = b; idx++; }
} else {
  placed = boxes;
}
const spools = [];
for (let r = 0; r < rows; r++) {
  const row = [];
  for (let c = 0; c < cols; c++) {
    const b = placed[r * cols + c];
    if (b && iceColors.includes(b.color)) {
      row.push({ id: b.color, type: 7, param: iceParam, count: b.count });
    } else if (b && guideColor > 0 && lockOthers > 0 && b.color !== guideColor) {
      row.push({ id: b.color, type: 7, param: lockOthers, count: b.count });
    } else {
      row.push(b ? { id: b.color, type: 0, param: 0, count: b.count } : { id: -1, type: 0, param: 0, count: 0 });
    }
  }
  spools.push(row);
}
// ---------- 自动成链：把相邻的同色车两两捆起来（造组债务） ----------
const autoChain = Number(arg('--auto-chain', 0));
if (autoChain > 0) {
  let made = 0, cid = 50;
  for (let r = 0; r < rows && made < autoChain; r++) {
    for (let c = 0; c < cols && made < autoChain; c++) {
      const a = spools[r][c];
      if (!(a.id > 0) || a.type !== 0) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= rows || nc >= cols) continue;
        const b = spools[nr][nc];
        if (!(b.id > 0) || b.type !== 0 || b.id !== a.id) continue;
        a.type = 5; a.param = cid; b.type = 5; b.param = cid;
        made++; cid++;
        break;
      }
    }
  }
  console.log(`自动成链 ${made} 组`);
}
const level = { toprow: R, blocks: g, maprow: rows, mapcol: cols, spools };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(level, null, 2));

// ---------- 校验与首测 ----------
const sum = spools.flat().filter(c => c.id > 0).reduce((a, c) => a + c.count, 0);
const perColor = {};
spools.flat().filter(c => c.id > 0).forEach(c => { perColor[c.id] = (perColor[c.id] || 0) + c.count; });
const bad = Object.keys(totals).filter(col => (perColor[col] || 0) !== totals[col]);

const lv = A.parseLevel(A.fromGameFormat(level));
const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
const buf = (o.pressureSamples || []).map(s => s.buf || 0);
let at4 = 0, run4 = 0, cur = 0;
for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }

console.log(`棋盘 ${rows}×${cols} / 车 ${boxes.length} / 容量和 ${sum} / 目标 ${cells}`);
console.log(`每色核对：${bad.length ? '❌ 不一致 ' + bad.map(c => `${c}:${perColor[c] || 0}/${totals[c]}`).join(' ') : '✅ 全部吻合'}`);
console.log(`首测：步 ${buf.length} / 峰值 ${Math.max(0, ...buf)} / at4 ${at4} / run4 ${run4} / 通关 ${!!o.completed}`);
console.log(`已写：${out}`);

if (process.env.SPLIT_DEBUG) console.error('[trap 汇总] 调用次数', _trapDbg.calls, JSON.stringify(_trapDbg.pushes));
