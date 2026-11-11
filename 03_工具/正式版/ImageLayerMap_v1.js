#!/usr/bin/env node
'use strict';
/**
 * ImageLayerMap_v1 —— 目标图的颜色层次 + 图的上限指标（T1，只读分析，不是生成器）
 *
 * 用途
 *   回答「这张图能不能做供给卡口」。只分析目标图本身，与车盘、切车、摆位无关：
 *   - 每色像素数、E 的分位数（10/50/90）、该色 80% 像素可吃时的进度；
 *   - 需求曲线：进度每 5% 一桶，桶内「首次变得可吃」的像素数（按颜色）；
 *   - 卡口候选色：E 落在 [0.30, 0.85] 的像素数 ≥ 30（暂定阈值）；
 *   - 图的上限（v5 README §21.2）：layerDepth、maxBorderBlobShare、verdict。
 *
 * 口径
 *   corner；只依赖目标图。数字=颜色号，0=空位（已经空的格子，穿过代价 0）。
 *   不读关卡 JSON，不看车盘、容量、暂存 5 格。
 *
 * E(p) 的定义（本工具的实现口径）
 *   E(p) = 从图边走到 p、「必须先吃掉」的像素数 ÷ 全图像素数（H×W）。
 *   实现为「色块依赖最短路」：
 *     - 把图切成同色 4 连通块（色块；0 也切块，权重 0）；
 *     - 以贴图边的色块为源，在色块邻接图上做 Dijkstra；
 *     - 进入一个色块要先吃掉它，代价 = 该色块像素数；
 *     - 到 p 所在色块的累计代价（不含 p 自己的色块）= E 的分子。
 *   这与 v5 README §21.2 的「逐层剥离」、工作日志 §83「按色块剥」同一口径；
 *   同色大块内部的像素 E 不变（依赖层算的是「清掉几个别的色块」，见工作日志 §82）。
 *   注意：任务书字面写的「每进入一个彩色格计 1」的逐格 BFS 在 40×40 图上
 *   最大只能到约 min(H,W)/2 格（≈1.2%），永远进不了 30–85% 窗口，阳性对照不可能通过；
 *   因此本工具把「必须先吃掉的像素数」按色块整块计费。逐格口径作为诊断值
 *   diagnostics.eCell 一并输出（不参与候选/结论）。
 *
 * E 是乐观下界（README §21.2 口径）
 *   只依赖图：假定「需要哪个颜色，就一定有一辆该颜色的车可用」，忽略供给、容量、
 *   暂存 5 格、锁链/冰/管道；按最省的一条色块依赖路径计「必须先吃掉的量」。
 *   所以 E 是偏乐观的估计：真实关卡只会因为供给/容量不够而更晚。
 *   注意计费单位是整色块（S0「逐层剥离」口径）；若玩家能在色块里只吃一条隧道，
 *   真实最早进度可能早于 E。这个方向的偏差在输出目录的 说明.md 里写明。
 *   E 大 = 不管玩家怎么走，这部分都得晚吃 → 天然卡口候选。不是对某一关的预测。
 *
 * 用法
 *   node 03_工具/正式版/ImageLayerMap_v1.js <目标图.txt|目录> --out <输出目录>
 *   例：
 *   node 03_工具/正式版/ImageLayerMap_v1.js /Users/red/Desktop/正常关卡/23.txt \
 *        --out 实验关/产线v5/A1_图分析
 *   每张图写 <图名>.json，并在控制台打一行摘要。
 *
 * 判定
 *   layerDepth = 卡口候选色个数；≥2 → 图可以，≤1 → 图不行（任务书阈值）。
 *   只看「图能不能做供给卡口」，不判断整关好坏。
 */
const fs = require('fs');
const path = require('path');

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const WINDOW_LO = 0.30;   // 卡口候选窗口（暂定）
const WINDOW_HI = 0.85;
const MIN_WINDOW_PX = 30; // 一辆门后车的容量下限（暂定）
const PEAK_NEEDED_VERDICT = 2;

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

/** 小顶堆（Dijkstra 用）。 */
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(d, id) {
    const a = this.a;
    a.push([d, id]);
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
 * 同色 4 连通块：彩色块权重=像素数，0 块权重=0（已经空的格子，可自由穿过）。
 * 返回 uid / units / adj。
 */
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
    units.push({
      id, color, size, borderPx,
      weight: color > 0 ? size : 0,
      onBorder: borderPx > 0
    });
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

/**
 * 色块依赖最短路：源=贴边色块（E=0）；离开色块 u 进入 v 的代价 = w(u)。
 * dist(v) = 进入 v 之前必须先吃掉的像素数。
 */
function unitDijkstra(units, adj) {
  const dist = new Array(units.length).fill(Infinity);
  const heap = new MinHeap();
  for (const u of units) {
    if (u.onBorder) { dist[u.id] = 0; heap.push(0, u.id); }
  }
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

/**
 * 诊断：任务书字面的「每个彩色格代价 1」逐格 4 邻接 BFS。
 * 0-1 BFS，离开格子 u 的代价 = 1（彩色）或 0（空位）。
 */
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
  const colorPx = new Map();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = grid[y][x];
    if (c > 0) {
      coloredPx++;
      colorPx.set(c, (colorPx.get(c) || 0) + 1);
    }
  }
  const colors = [...colorPx.keys()].sort((a, b) => a - b);

  const { uid, units, adj } = buildUnits(grid, H, W);
  const dist = unitDijkstra(units, adj);
  const eOfUnit = units.map(u => dist[u.id] / totalPx);

  // 每色像素的 E 列表 + 色块/贴边统计
  const eByColor = new Map(colors.map(c => [c, []]));
  const blocksByColor = new Map(colors.map(c => [c, 0]));
  const borderPxByColor = new Map(colors.map(c => [c, 0]));
  for (const u of units) {
    if (u.color <= 0) continue;
    blocksByColor.set(u.color, blocksByColor.get(u.color) + 1);
    borderPxByColor.set(u.color, borderPxByColor.get(u.color) + u.borderPx);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = grid[y][x];
    if (c > 0) eByColor.get(c).push(eOfUnit[uid[y][x]]);
  }

  const colorRows = [];
  const chokeCandidates = [];
  for (const c of colors) {
    const arr = eByColor.get(c).slice().sort((a, b) => a - b);
    const px = arr.length;
    const p10 = quantile(arr, 0.10);
    const p50 = quantile(arr, 0.50);
    const p90 = quantile(arr, 0.90);
    const p80 = quantile(arr, 0.80);
    const minE = arr[0], maxE = arr[arr.length - 1];
    let windowPx = 0;
    for (const e of arr) {
      if (e >= WINDOW_LO - 1e-12 && e <= WINDOW_HI + 1e-12) windowPx++;
    }
    const isCandidate = windowPx >= MIN_WINDOW_PX;
    let reason;
    if (isCandidate) {
      reason = `E 在 30–85% 的像素 ${windowPx}/${px}，够做门后车（阈值 ${MIN_WINDOW_PX}px，暂定）`;
    } else if (windowPx > 0) {
      reason = `E 在 30–85% 的像素只有 ${windowPx}/${px}（<${MIN_WINDOW_PX}px），厚度不够`;
    } else {
      reason = '没有像素的 E 落在 30–85%（不是被挡在深处）';
    }
    const row = {
      color: c,
      px,
      blocks: blocksByColor.get(c),
      borderPx: borderPxByColor.get(c),
      eMin: round(minE, 6),
      eQuantiles: { p10: round(p10, 6), p50: round(p50, 6), p90: round(p90, 6) },
      progressAt80PctEatable: round(p80, 6),
      eMax: round(maxE, 6),
      chokeWindowPx30to85: windowPx,
      isChokeCandidate: isCandidate,
      reason
    };
    colorRows.push(row);
    if (isCandidate) {
      chokeCandidates.push({
        color: c,
        pxInWindow30to85: windowPx,
        totalPx: px,
        shareInWindow: round(windowPx / px, 4),
        eQuantiles: row.eQuantiles,
        reason
      });
    }
  }
  chokeCandidates.sort((a, b) => b.pxInWindow30to85 - a.pxInWindow30to85 || a.color - b.color);

  // 诊断：候选色按「E 中位数」归到 5% 桶，看它们是不是同一层。
  // layerDepth 是候选色个数（任务书定义）；distinctCandidateBands 才近似「几个卡点层」。
  const bandMap = new Map();
  for (const c of chokeCandidates) {
    const b = Math.max(0, Math.min(19, Math.floor(c.eQuantiles.p50 * 20)));
    if (!bandMap.has(b)) {
      bandMap.set(b, {
        from: round(b / 20, 4),
        to: round((b + 1) / 20, 4),
        label: `${b * 5}-${(b + 1) * 5}%`,
        colors: [],
        pxInWindow: 0
      });
    }
    const band = bandMap.get(b);
    band.colors.push(c.color);
    band.pxInWindow += c.pxInWindow30to85;
  }
  const candidateBands = [...bandMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);

  // 需求曲线：20 个 5% 桶，按颜色分
  const demandCurve = [];
  for (let b = 0; b < 20; b++) {
    demandCurve.push({ from: round(b / 20, 4), to: round((b + 1) / 20, 4), label: `${b * 5}-${(b + 1) * 5}%`, total: 0, byColor: {} });
  }
  for (const c of colors) {
    for (const e of eByColor.get(c)) {
      let b = Math.floor(e * 20);
      if (b < 0) b = 0;
      if (b > 19) b = 19;
      demandCurve[b].total++;
      demandCurve[b].byColor[c] = (demandCurve[b].byColor[c] || 0) + 1;
    }
  }

  // 图的上限：最大的同色 4 连通块
  let largest = null;
  for (const u of units) {
    if (u.color <= 0) continue;
    if (!largest || u.size > largest.size) largest = u;
  }
  const maxBorderBlobShare = largest ? round(largest.borderPx / totalPx, 6) : 0;

  const layerDepth = chokeCandidates.length;
  const verdict = layerDepth >= PEAK_NEEDED_VERDICT ? '图可以' : '图不行';
  let verdictReason;
  if (verdict === '图可以') {
    verdictReason = `有 ${layerDepth} 个颜色在 30–85% 区间可卡：${chokeCandidates.map(x => x.color).join(', ')}`;
  } else if (layerDepth === 1) {
    verdictReason = `只有一个颜色在 30–85% 区间可卡（${chokeCandidates[0].color}），按上限判“图不行”`;
  } else {
    verdictReason = '没有颜色在 30–85% 区间有 ≥30px 可卡；无论怎么切车摆车都做不出供给卡口';
  }

  // 诊断：字面逐格 BFS 的 E 上限（不参与判定）
  const dcell = cellE(grid, H, W);
  let cellMax = 0, cellAtLeast30 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (grid[y][x] <= 0) continue;
    const e = dcell[y][x] / totalPx;
    if (e > cellMax) cellMax = e;
    if (e >= WINDOW_LO) cellAtLeast30++;
  }

  const notes = [];
  if (largest && largest.borderPx > 0 && largest.size / totalPx >= 0.25) {
    notes.push(`最大同色块 ${largest.color} 占全图 ${round(largest.size / totalPx * 100, 1)}%（贴边 ${largest.borderPx}px）：` +
      '这是大块（可能是背景或外圈）；要跨过它才能到的颜色，E 会被“整色块计费”抬高（方向对、绝对进度偏保守）。');
  }
  if (layerDepth >= PEAK_NEEDED_VERDICT && candidateBands.length < 2) {
    notes.push(`${layerDepth} 个候选色的 E 中位数都落在同一 5% 桶（${candidateBands.map(b => b.label).join(',')}），` +
      '它们其实是同一层；layerDepth 按任务书定义是候选色数，不代表这么多个独立卡点。');
  }
  if (candidateBands.some(b => b.from === 0)) {
    notes.push('有候选色的中位 E 在 0–5%（靠窗口内的少量深处像素入选）；这种候选要人工确认是不是真的卡口。');
  }

  return {
    tool: 'ImageLayerMap_v1',
    version: 'v1',
    generatedAt: new Date().toISOString(),
    file: path.basename(file),
    size: `${H}x${W}`,
    totalPx,
    coloredPx,
    colorCount: colors.length,
    model: {
      name: 'block-dependency-shortest-path',
      caliber: 'corner / 只看目标图',
      eDefinition: 'E(p) = 从图边到 p 的最省路径上、必须先吃掉的像素数 ÷ 全图像素数；同色 4 连通块为计费单位，空位 0 不计费。',
      optimisticLowerBound: 'E 是乐观估计：只依赖图，忽略车供给/容量/暂存 5 格/障碍；假定需要哪个颜色就一定有车。计费单位为整色块；若能只吃色块内一条隧道，真实最早进度可能更早。'
    },
    colors: colorRows,
    demandCurve,
    chokeCandidates,
    imageUpperBound: {
      layerDepth,
      candidateColors: chokeCandidates.map(x => x.color),
      candidateBands,
      distinctCandidateBands: candidateBands.length,
      maxBorderBlobShare,
      largestBorderBlob: largest ? { color: largest.color, size: largest.size, borderPx: largest.borderPx } : null,
      verdict,
      reason: verdictReason,
      notes
    },
    diagnostics: {
      eCell: {
        model: 'literal-per-cell-bfs',
        maxE: round(cellMax, 6),
        pxAtLeast30Pct: cellAtLeast30,
        note: '任务书字面“每进入一个彩色格计 1”的 4 邻接 BFS。40×40 图上最大约 min(H,W)/2 格，E 上限 ≈1%，进不了 30–85% 窗口；仅作对照，不参与候选/判定。'
      }
    }
  };
}

function summaryLine(r) {
  const ub = r.imageUpperBound;
  const cand = r.chokeCandidates.map(x => `${x.color}(${x.pxInWindow30to85}/${x.totalPx},p50=${x.eQuantiles.p50})`).join(' ');
  return `${r.file} ${r.size} totalPx=${r.totalPx} colors=${r.colorCount} layerDepth=${ub.layerDepth} bands=${ub.distinctCandidateBands} ${ub.verdict}` +
    ` | choke=${cand || '无'} | maxBorderBlobShare=${ub.maxBorderBlobShare}`;
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
