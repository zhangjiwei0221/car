#!/usr/bin/env node
'use strict';
/**
 * ImageLayerMap_v2 —— 目标图的「需求曲线 + 需求峰 + 门候补」（T1，只读分析）
 *
 * 用途
 *   回答「这张图能提供几个需求卡点（门候补）」。只分析目标图本身，与车盘、切车、
 *   摆位、锁链/冰/管道无关：图只能提供“进度到 X% 时正在吃哪些颜色”，不能提供“挡”。
 *
 * v2 口径（替代 v1 的 block-Dijkstra / layerDepth）
 *   1) corner 消融序列（纯图，不含车）：
 *      - 初始“已吃”为空；0 空位视为已经空的格子（与已吃格同样可穿过）。
 *      - 暴露 = 与图四边相邻、或与已吃格/已空 0 格 4 邻接的彩色格。
 *      - 每步在暴露的未吃彩色格中选 D = (行数-1-r) + c 最小的那个吃掉；
 *        平手先 r 大（更靠底），再 c 小。重复到吃完。
 *   2) 每个被吃的格子记录 (进度 = 已吃彩色像素 / 总彩色像素, 颜色)。
 *   3) 需求曲线：进度每 5% 一个窗口，输出每色在该窗口被吃的像素数；
 *      另输出每色 progress 的 10%/50%/90% 分位。
 *   4) 需求峰：窗口 W 里某色占该窗口像素数 ≥30% 且 ≥40px，记为一个峰。
 *      20%–90% 区间有峰、且该色总像素 ≥60，列为门候补（gate candidate）。
 *      额外要求该色“开局不可达”（没有贴边像素、也不能经 0 连通到图边）：
 *      否则它从 0% 就能吃，无法靠后置的门卡住（否则单色/左右两色图会被误判）。
 *   5) verdict 三档：
 *      - ≥2 个不同窗口有门候补 → “图可以”
 *      - 只有 1 个窗口 → “图一般（最多一个门）”
 *      - 0 个 → “图不行”
 *   v1 的 block-Dijkstra 结果保留在 diagnostics.blockModel，仅作参考，不参与 verdict。
 *
 * 为什么 v1 的 layerDepth 不能用于选图
 *   逐格 BFS 的 E = 从图边到 p 必须吃掉的格数 / 总像素；图里没有不可吃的格子，
 *   最短路只能到“最近图边的距离”（40×40 实测 max 1.19%，48×48 0.998%），
 *   数学上永远到不了 30% 进度。也就是说“像素被别的颜色挡住”拖不出 30% 的卡点；
 *   卡点只能靠供给（车/锁链/管道/冰），图能提供的是需求。v1 的 layerDepth 把
 *   “整色块计费”的抽象当成了层次，既会误判大背景图，也不能回答需求在哪。
 *
 * 局限（详见输出目录 说明.md）
 *   - 消融顺序是“无车自由吃”的固定顺序；真人会换顺序，需求峰可能被绕开。
 *   - 峰阈值 30% / 40px、门候补总量 60px 都是暂定值。
 *   - 只依赖图，不含供给；门候补只说明“图上在这个进度需要这个颜色”，
 *     不保证能造出供给卡口。
 *
 * 用法
 *   node 03_工具/正式版/ImageLayerMap_v1.js <目标图.txt|目录> --out <输出目录>
 *   例：
 *   node 03_工具/正式版/ImageLayerMap_v1.js /Users/red/Desktop/正常关卡/23.txt \
 *        --out 实验关/产线v5/A1_图分析
 *   每张图写 <图名>.json，并在控制台打一行摘要。
 *
 * 输出
 *   colors[]、demandCurve[20]、demandPeaks[]、gateCandidates[]、
 *   imageUpperBound{verdict,level,gateWindows,gateBands,...}、diagnostics{eCell,blockModel}。
 */
const fs = require('fs');
const path = require('path');

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const PEAK_SHARE = 0.30;    // 峰：某色占窗口像素比例（暂定）
const PEAK_PX = 40;         // 峰：窗口内最少像素（暂定）
const GATE_TOTAL_PX = 60;   // 门候补：该色总像素下限（暂定）
const GATE_W_FROM = 4;      // 20%（5% 窗口索引 4）
const GATE_W_TO = 17;       // 85–90% 仍算 20–90% 区间

/** 照抄 ImageDebtScan_v1.js：首行中文标题等非数字行跳过。 */
function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || /[^\d\s]/.test(t)) continue;
    rows.push(t.split(/\s+/).map(Number));
  }
  if (!rows.length) throw new Error('没有解析到数字矩阵');
  const W = rows[0].length;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== W) throw new Error(`第 ${i + 1} 个数字行宽度 ${rows[i].length} ≠ 首行 ${W}`);
  }
  return rows;
}

function round(x, n) {
  const p = Math.pow(10, n);
  return Math.round(x * p) / p;
}

/** 线性插值分位数（q ∈ [0,1]）；输入需已升序。 */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 小顶堆（按数值 key）。 */
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(key, id) {
    const a = this.a;
    a.push([key, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * corner 消融序列（v2 主口径）。
 * 返回 { order: [{color, progress}], startExposedPx: {color: n}, totalColored }。
 */
function cornerAblation(grid, H, W) {
  const N = grid.reduce((s, row) => s + row.filter(v => v > 0).length, 0);
  if (!N) throw new Error('图上没有彩色像素');
  const eaten = new Uint8Array(H * W);
  const inHeap = new Uint8Array(H * W);
  const open = new Uint8Array(H * W); // 已吃的彩色格 + 与外界连通的 0 格
  const startExposedPx = {};
  const heap = new MinHeap();
  let initializing = true;

  // D 最小；平手 r 大（H-1-r 小）；再 c 小。编码后字典序等价。
  const keyOf = (r, c) => {
    const D = (H - 1 - r) + c;
    return ((D * H) + (H - 1 - r)) * W + c;
  };
  const expose = (r, c) => {
    const id = r * W + c;
    const col = grid[r][c];
    if (col <= 0 || eaten[id] || inHeap[id]) return;
    inHeap[id] = 1;
    if (initializing) startExposedPx[col] = (startExposedPx[col] || 0) + 1;
    heap.push(keyOf(r, c), id);
  };
  const openZeroRegion = (r0, c0) => {
    const id0 = r0 * W + c0;
    if (open[id0]) return;
    open[id0] = 1;
    const stack = [[r0, c0]];
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
        const id = nr * W + nc;
        if (grid[nr][nc] === 0) {
          if (!open[id]) { open[id] = 1; stack.push([nr, nc]); }
        } else {
          expose(nr, nc);
        }
      }
    }
  };

  // 初始暴露：贴边的彩色格；贴边 0 格所在的 0 连通区（与图边连通 = 外界）
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (r !== 0 && r !== H - 1 && c !== 0 && c !== W - 1) continue;
    if (grid[r][c] > 0) expose(r, c);
    else openZeroRegion(r, c);
  }
  initializing = false;

  const order = [];
  let k = 0;
  while (heap.size) {
    const [, id] = heap.pop();
    if (eaten[id]) continue;
    const r = Math.floor(id / W), c = id % W;
    eaten[id] = 1;
    open[id] = 1;
    k++;
    order.push({ color: grid[r][c], progress: k / N });
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
      if (grid[nr][nc] === 0) openZeroRegion(nr, nc);
      else expose(nr, nc);
    }
  }
  if (k !== N) throw new Error(`消融未吃完：${k}/${N}`);
  return { order, startExposedPx, totalColored: N };
}

/** v2 主分析：需求曲线、需求峰、门候补、三档 verdict。 */
function analyzeDemand(grid, H, W) {
  const { order, startExposedPx, totalColored } = cornerAblation(grid, H, W);
  const totalPx = H * W;

  const windows = Array.from({ length: 20 }, (_, w) => ({
    from: round(w / 20, 4),
    to: round((w + 1) / 20, 4),
    label: `${w * 5}-${(w + 1) * 5}%`,
    total: 0,
    byColor: {},
    peaks: []
  }));
  const progressByColor = new Map();
  for (const x of order) {
    let w = Math.floor(x.progress * 20);
    if (w < 0) w = 0;
    if (w > 19) w = 19;
    windows[w].total++;
    windows[w].byColor[x.color] = (windows[w].byColor[x.color] || 0) + 1;
    if (!progressByColor.has(x.color)) progressByColor.set(x.color, []);
    progressByColor.get(x.color).push(x.progress);
  }

  const colors = [...progressByColor.keys()].sort((a, b) => a - b);
  const colorRows = [];
  const demandPeaks = [];
  for (const c of colors) {
    const arr = progressByColor.get(c).slice().sort((a, b) => a - b);
    colorRows.push({
      color: c,
      px: arr.length,
      startExposedPx: startExposedPx[c] || 0,
      progressQuantiles: {
        p10: round(quantile(arr, 0.10), 6),
        p50: round(quantile(arr, 0.50), 6),
        p90: round(quantile(arr, 0.90), 6)
      },
      firstProgress: round(arr[0], 6),
      lastProgress: round(arr[arr.length - 1], 6),
      peaks: [],
      isGateCandidate: false
    });
  }
  const rowOf = new Map(colorRows.map(r => [r.color, r]));

  for (let wi = 0; wi < windows.length; wi++) {
    const w = windows[wi];
    const entries = Object.entries(w.byColor).map(([c, n]) => ({ color: +c, px: n, share: n / w.total }));
    entries.sort((a, b) => b.px - a.px || a.color - b.color);
    const sortedByColor = {};
    for (const c of Object.keys(w.byColor).map(Number).sort((a, b) => a - b)) sortedByColor[c] = w.byColor[c];
    w.byColor = sortedByColor;
    for (const e of entries) {
      if (e.px < PEAK_PX || e.share < PEAK_SHARE) continue;
      const peak = {
        windowIndex: wi,
        window: w.label,
        from: w.from,
        to: w.to,
        color: e.color,
        pxInWindow: e.px,
        shareInWindow: round(e.share, 4)
      };
      w.peaks.push({ color: e.color, pxInWindow: e.px, shareInWindow: peak.shareInWindow });
      demandPeaks.push(peak);
      const row = rowOf.get(e.color);
      row.peaks.push({
        window: w.label,
        windowIndex: wi,
        from: w.from,
        to: w.to,
        pxInWindow: e.px,
        shareInWindow: peak.shareInWindow
      });
    }
  }

  // 门候补：总像素 ≥60、开局不可达、在 20–90% 有峰
  const gateCandidates = [];
  for (const row of colorRows) {
    if (row.px < GATE_TOTAL_PX) continue;
    if (row.startExposedPx > 0) continue; // 开局就能吃到，门卡不住
    const gatePeaks = row.peaks.filter(p => p.windowIndex >= GATE_W_FROM && p.windowIndex <= GATE_W_TO);
    if (!gatePeaks.length) continue;
    row.isGateCandidate = true;
    gateCandidates.push({
      color: row.color,
      totalPx: row.px,
      startExposedPx: row.startExposedPx,
      peaks: gatePeaks,
      gateWindows: gatePeaks.map(p => p.window)
    });
  }
  gateCandidates.sort((a, b) => b.peaks.length - a.peaks.length || a.color - b.color);

  // 不同窗口 / 不同需求带（同一色的连续窗口算一条带）
  const gateWindowSet = new Set();
  for (const g of gateCandidates) for (const p of g.peaks) gateWindowSet.add(p.window);
  const gateWindows = [...gateWindowSet].sort((a, b) => parseInt(a) - parseInt(b));
  const gateBands = [];
  for (const g of gateCandidates) {
    const idxs = [...new Set(g.peaks.map(p => p.windowIndex))].sort((a, b) => a - b);
    let start = null, prev = null;
    for (const w of idxs) {
      if (start === null) { start = prev = w; continue; }
      if (w === prev + 1) { prev = w; continue; }
      gateBands.push({ color: g.color, from: `${start * 5}%`, to: `${(prev + 1) * 5}%` });
      start = prev = w;
    }
    if (start !== null) gateBands.push({ color: g.color, from: `${start * 5}%`, to: `${(prev + 1) * 5}%` });
  }

  let level, verdict;
  if (gateWindows.length >= 2) { level = 2; verdict = '图可以'; }
  else if (gateWindows.length === 1) { level = 1; verdict = '图一般（最多一个门）'; }
  else { level = 0; verdict = '图不行'; }

  let reason;
  if (level === 0) {
    const midPeaks = demandPeaks.filter(p => p.windowIndex >= GATE_W_FROM && p.windowIndex <= GATE_W_TO);
    reason = midPeaks.length
      ? `20–90% 有 ${midPeaks.length} 个需求峰，但对应颜色开局可达或总像素 <${GATE_TOTAL_PX}，不能作为门候补`
      : '20–90% 区间没有颜色形成需求峰（该色占窗口 ≥30% 且 ≥40px）';
  } else {
    const parts = gateCandidates.map(g =>
      `色${g.color} 在 ${g.peaks.map(p => p.window).join('/')}（${g.peaks.map(p => p.pxInWindow).join('/')}px）`);
    reason = `${gateWindows.length} 个不同窗口有门候补：${parts.join('；')}`;
  }

  const notes = [];
  if (level === 2 && gateBands.length < 2) {
    notes.push(`门候补窗口连在一起（${gateBands.map(b => b.from + '–' + b.to).join(',')}），` +
      '按“不同窗口”算是 ≥2，但实际更像 1 条连续需求带；是否算 2 个门要人工判断。');
  }
  const startReachable = colorRows.filter(r => r.startExposedPx > 0).length;
  if (startReachable) {
    notes.push(`${startReachable} 个颜色开局就有像素可达（贴边或经 0 连通到图边），按规则不作为门候补；` +
      '它们从 0% 就能吃，不能被后置的门整体卡住。');
  }
  notes.push(`峰阈值：窗口内占比 ≥${PEAK_SHARE * 100}% 且 ≥${PEAK_PX}px；门候补总量 ≥${GATE_TOTAL_PX}px（均为暂定值）。`);

  return {
    totalColored,
    totalPx,
    colorCount: colors.length,
    colors: colorRows,
    demandCurve: windows,
    demandPeaks,
    gateCandidates,
    imageUpperBound: {
      verdict,
      level,
      gateWindowCount: gateWindows.length,
      gateWindows,
      gateBands,
      distinctGateBands: gateBands.length,
      reason,
      notes
    }
  };
}

/* ============================ v1 诊断（不参与 verdict） ============================ */

/** v1：同色 4 连通块；彩色块权重=像素数，0 块权重=0。 */
function buildUnits(grid, H, W) {
  const uid = Array.from({ length: H }, () => new Int32Array(W).fill(-1));
  const units = [];
  for (let y0 = 0; y0 < H; y0++) for (let x0 = 0; x0 < W; x0++) {
    if (uid[y0][x0] !== -1) continue;
    const id = units.length;
    const color = grid[y0][x0];
    const stack = [[y0, x0]];
    uid[y0][x0] = id;
    let size = 0, borderPx = 0;
    while (stack.length) {
      const [y, x] = stack.pop();
      size++;
      if (y === 0 || y === H - 1 || x === 0 || x === W - 1) borderPx++;
      for (const [dy, dx] of DIRS) {
        const ny = y + dy, nx = x + dx;
        if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
        if (uid[ny][nx] !== -1 || grid[ny][nx] !== color) continue;
        uid[ny][nx] = id;
        stack.push([ny, nx]);
      }
    }
    units.push({ id, color, size, borderPx, weight: color > 0 ? size : 0, onBorder: borderPx > 0 });
  }
  const adj = units.map(() => new Set());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = uid[y][x];
    if (x + 1 < W) {
      const b = uid[y][x + 1];
      if (a !== b) { adj[a].add(b); adj[b].add(a); }
    }
    if (y + 1 < H) {
      const b = uid[y + 1][x];
      if (a !== b) { adj[a].add(b); adj[b].add(a); }
    }
  }
  return { uid, units, adj };
}

/** v1：色块依赖最短路（源=贴边色块；离开 u 的代价=w(u)）。 */
function unitDijkstra(units, adj) {
  const dist = new Array(units.length).fill(Infinity);
  const heap = new MinHeap();
  for (const u of units) if (u.onBorder) { dist[u.id] = 0; heap.push(0, u.id); }
  while (heap.size) {
    const [d, id] = heap.pop();
    if (d !== dist[id]) continue;
    for (const nid of adj[id]) {
      const nd = d + units[id].weight;
      if (nd < dist[nid]) { dist[nid] = nd; heap.push(nd, nid); }
    }
  }
  return dist;
}

function analyzeBlockModel(grid, H, W) {
  const totalPx = H * W;
  const { uid, units, adj } = buildUnits(grid, H, W);
  const dist = unitDijkstra(units, adj);
  const eOfUnit = units.map(u => dist[u.id] / totalPx);
  const eByColor = new Map();
  const borderByColor = new Map();
  const pxByColor = new Map();
  for (const u of units) {
    if (u.color <= 0) continue;
    pxByColor.set(u.color, (pxByColor.get(u.color) || 0) + u.size);
    borderByColor.set(u.color, (borderByColor.get(u.color) || 0) + u.borderPx);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = grid[y][x];
    if (c <= 0) continue;
    if (!eByColor.has(c)) eByColor.set(c, []);
    eByColor.get(c).push(eOfUnit[uid[y][x]]);
  }
  const colors = [...eByColor.keys()].sort((a, b) => a - b);
  const rows = [];
  const candidateColors = [];
  for (const c of colors) {
    const arr = eByColor.get(c).slice().sort((a, b) => a - b);
    let win = 0;
    for (const e of arr) if (e >= 0.30 - 1e-12 && e <= 0.85 + 1e-12) win++;
    const cand = win >= 30;
    if (cand) candidateColors.push(c);
    rows.push({
      color: c,
      px: arr.length,
      borderPx: borderByColor.get(c) || 0,
      eQuantiles: {
        p10: round(quantile(arr, 0.10), 6),
        p50: round(quantile(arr, 0.50), 6),
        p90: round(quantile(arr, 0.90), 6)
      },
      chokeWindowPx30to85: win,
      isCandidate: cand
    });
  }
  let largest = null;
  for (const u of units) {
    if (u.color <= 0) continue;
    if (!largest || u.size > largest.size) largest = u;
  }
  const layerDepth = candidateColors.length;
  return {
    layerDepth,
    candidateColors,
    maxBorderBlobShare: largest ? round(largest.borderPx / totalPx, 6) : 0,
    largestBorderBlob: largest ? { color: largest.color, size: largest.size, borderPx: largest.borderPx } : null,
    verdict: layerDepth >= 2 ? '图可以' : '图不行',
    colors: rows,
    note: '已被 v2 取代：挡不住的证明见逐格 BFS 的 E 上限（只能到最近图边的距离，40×40 实测 1.19%、48×48 0.998%），永远到不了 30%。v1 layerDepth 不参与 v2 verdict。'
  };
}

/** 诊断：字面“每个彩色格代价 1”的逐格 4 邻接 BFS（离开 u 的代价 = 1/0）。 */
function cellE(grid, H, W) {
  const dist = Array.from({ length: H }, () => new Array(W).fill(Infinity));
  const heap = new MinHeap();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (y === 0 || y === H - 1 || x === 0 || x === W - 1) {
      dist[y][x] = 0;
      heap.push(0, y * W + x);
    }
  }
  while (heap.size) {
    const [d, key] = heap.pop();
    const y = Math.floor(key / W), x = key % W;
    if (d !== dist[y][x]) continue;
    const w = grid[y][x] > 0 ? 1 : 0;
    for (const [dy, dx] of DIRS) {
      const ny = y + dy, nx = x + dx;
      if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
      const nd = d + w;
      if (nd < dist[ny][nx]) { dist[ny][nx] = nd; heap.push(nd, ny * W + nx); }
    }
  }
  return dist;
}

function analyze(file) {
  const grid = parse(file);
  const H = grid.length, W = grid[0].length;
  const totalPx = H * W;
  let coloredPx = 0;
  for (const row of grid) for (const v of row) if (v > 0) coloredPx++;

  const v2 = analyzeDemand(grid, H, W);
  const blockModel = analyzeBlockModel(grid, H, W);

  const dcell = cellE(grid, H, W);
  let cellMax = 0, cellAtLeast30 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (grid[y][x] <= 0) continue;
    const e = dcell[y][x] / totalPx;
    if (e > cellMax) cellMax = e;
    if (e >= 0.30) cellAtLeast30++;
  }

  return {
    tool: 'ImageLayerMap_v2',
    version: 'v2',
    supersedes: 'ImageLayerMap_v1（block-Dijkstra / layerDepth 口径）',
    generatedAt: new Date().toISOString(),
    file: path.basename(file),
    size: `${H}x${W}`,
    totalPx,
    coloredPx,
    colorCount: v2.colorCount,
    model: {
      name: 'corner-ablation-demand',
      caliber: 'corner / 只看目标图 / 无车自由吃',
      sequence: '初始已吃为空；暴露=贴图边或与已吃格/已空0格4邻接；每步吃 D=(H-1-r)+c 最小的暴露彩色格，平手 r 大、c 小；直到吃完。',
      progress: '已吃彩色像素 / 总彩色像素',
      peak: `窗口内某色占该窗口像素 ≥${PEAK_SHARE * 100}% 且 ≥${PEAK_PX}px`,
      gateCandidate: `总像素 ≥${GATE_TOTAL_PX}、开局不可达、且在 20–90% 区间有峰`,
      note: '图只能提供需求；供给（车/锁链/管道/冰）不在本工具内。'
    },
    colors: v2.colors,
    demandCurve: v2.demandCurve,
    demandPeaks: v2.demandPeaks,
    gateCandidates: v2.gateCandidates,
    imageUpperBound: v2.imageUpperBound,
    diagnostics: {
      eCell: {
        model: 'literal-per-cell-bfs',
        maxE: round(cellMax, 6),
        pxAtLeast30Pct: cellAtLeast30,
        note: '任务书字面“每进入一个彩色格计 1”的 4 邻接 BFS。图里没有不可吃格，最短路只能到最近图边，E 上限约 min(H,W)/2 ÷ H×W；40×40 实测 1.19%、48×48 0.998%。仅作“挡不住”的证明，不参与 v2 判定。'
      },
      blockModel
    }
  };
}

function summaryLine(r) {
  const u = r.imageUpperBound;
  const gates = r.gateCandidates.map(g =>
    `${g.color}@${g.peaks.map(p => p.window).join('/')}(${g.peaks.map(p => p.pxInWindow).join('/')}px)`).join(' ');
  return `${r.file} ${r.size} colored=${r.coloredPx} colors=${r.colorCount} ${u.verdict}` +
    ` | gateWindows=${u.gateWindowCount}[${u.gateWindows.join(',') || '无'}]` +
    ` | gates=${gates || '无'} | peaks=${r.demandPeaks.length}`;
}

function main() {
  const args = process.argv.slice(2);
  let target = '', outDir = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') { outDir = args[++i] || ''; continue; }
    if (!args[i].startsWith('--') && !target) target = args[i];
  }
  if (!target || !outDir) {
    console.error('用法: node ImageLayerMap_v1.js <图.txt|目录> --out <输出目录>');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  let files;
  if (fs.statSync(target).isDirectory()) {
    files = fs.readdirSync(target)
      .filter(f => f.toLowerCase().endsWith('.txt'))
      .sort()
      .map(f => path.join(target, f));
  } else {
    files = [target];
  }
  if (!files.length) {
    console.error('没有 .txt 文件：' + target);
    process.exit(2);
  }
  let ok = 0, bad = 0;
  for (const f of files) {
    try {
      const r = analyze(f);
      const outFile = path.join(outDir, path.basename(f).replace(/\.txt$/i, '') + '.json');
      fs.writeFileSync(outFile, JSON.stringify(r, null, 2));
      console.log(summaryLine(r));
      ok++;
    } catch (e) {
      console.log(`${path.basename(f)} ERROR ${e.message}`);
      bad++;
    }
  }
  console.error(`done: ${ok} ok, ${bad} error -> ${outDir}`);
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
