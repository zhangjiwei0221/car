#!/usr/bin/env node
'use strict';

/**
 * TargetStoryAtlas v0
 *
 * Read-only analysis for the story-driven level compiler:
 *   target TXT + capacity scenarios -> region atlas, capacity/board feasibility,
 *   target exposure trace, and preliminary story candidates.
 *
 * This script does not create a level, search random seeds, or modify the generator.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const MODULES = [
  'utils.js',
  'color-libs.js',
  'simulator.js',
  'solver-strategy.js',
  'solver.js',
  'playersim.js',
  'analysis.js',
  'car-sequencer.js',
  'solver-analysis.js',
  'experience-goal.js',
  'capacity-tuner.js',
  'instant-playout.js',
  'generator.js',
  'source-preflight.js'
];

function loadSolver() {
  const sandbox = {
    console,
    WeakMap,
    Map,
    Set,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    isNaN,
    parseInt,
    parseFloat,
    isFinite,
    setTimeout,
    clearTimeout
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  for (const file of MODULES) {
    const full = path.join(BIN, file);
    if (!fs.existsSync(full)) throw new Error('缺少工程模块: ' + full);
    vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: file });
  }
  if (!sandbox.AntSolver || !sandbox.AntSolver.Simulator) {
    throw new Error('AntSolver 模块加载失败');
  }
  return sandbox.AntSolver;
}

function valueAfter(args, flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
}

function positionalTarget(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' || args[i] === '--out' || args[i] === '--caps' ||
        args[i] === '--min-edge' || args[i] === '--max-edge' ||
        args[i] === '--buffer' || args[i] === '--policy') {
      i++;
      continue;
    }
    if (args[i] && !args[i].startsWith('--')) return args[i];
  }
  return '';
}

function parseCapRange(text) {
  const m = String(text || '').trim().match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const min = parseInt(m[1], 10);
  const max = parseInt(m[2], 10);
  if (!(min > 0) || max < min) return null;
  return { min, max };
}

function round2(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const body = Buffer.concat([name, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function writePreviewPng(file, blocks, A) {
  const detection = A.ColorLibs.detect(blocks);
  const lib = A.ColorLibs.get(detection.lib);
  const rows = blocks.length;
  const cols = blocks[0].length;
  const scale = Math.max(1, Math.floor(700 / Math.max(rows, cols)));
  const width = cols * scale;
  const height = rows * scale;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const fallback = [255, 0, 255];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = blocks[r][c];
      const hex = id > 0 ? A.ColorLibs.hexOf(lib, id) : null;
      const rgb = hex ? A.ColorLibs.hexToRgb(hex) : (id > 0 ? fallback : [245, 245, 245]);
      for (let sy = 0; sy < scale; sy++) {
        const outRow = r * scale + sy;
        raw[(stride + 1) * outRow] = 0;
        const base = (stride + 1) * outRow + 1 + c * scale * 4;
        for (let sx = 0; sx < scale; sx++) {
          const at = base + sx * 4;
          raw[at] = rgb[0];
          raw[at + 1] = rgb[1];
          raw[at + 2] = rgb[2];
          raw[at + 3] = 255;
        }
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return {
    file,
    width,
    height,
    scale,
    detectedLibrary: detection
  };
}

function colorTotals(blocks) {
  const totals = {};
  let pixels = 0;
  for (let r = 0; r < blocks.length; r++) {
    for (let c = 0; c < blocks[r].length; c++) {
      const color = blocks[r][c];
      if (color > 0) {
        totals[color] = (totals[color] || 0) + 1;
        pixels++;
      }
    }
  }
  return { pixels, totals };
}

function buildRegions(blocks) {
  const rows = blocks.length;
  const cols = blocks[0] ? blocks[0].length : 0;
  const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const regionOf = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const regions = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (seen[r][c]) continue;
      const color = blocks[r][c];
      const cells = [];
      const queue = [[r, c]];
      seen[r][c] = true;
      while (queue.length) {
        const p = queue.pop();
        const cr = p[0], cc = p[1];
        cells.push([cr, cc]);
        for (const d of dirs) {
          const nr = cr + d[0], nc = cc + d[1];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (seen[nr][nc] || blocks[nr][nc] !== color) continue;
          seen[nr][nc] = true;
          queue.push([nr, nc]);
        }
      }
      const id = 'R' + (regions.length + 1);
      const rr = cells.map(p => p[0]);
      const cc = cells.map(p => p[1]);
      const region = {
        id,
        color,
        area: cells.length,
        bbox: {
          minRow: Math.min(...rr),
          maxRow: Math.max(...rr),
          minCol: Math.min(...cc),
          maxCol: Math.max(...cc)
        },
        center: [
          round2(rr.reduce((a, b) => a + b, 0) / cells.length),
          round2(cc.reduce((a, b) => a + b, 0) / cells.length)
        ],
        touchesBorder: cells.some(p => p[0] === 0 || p[0] === rows - 1 || p[1] === 0 || p[1] === cols - 1),
        cells,
        neighbors: []
      };
      const index = regions.push(region) - 1;
      for (const p of cells) regionOf[p[0]][p[1]] = index;
    }
  }

  const edgeCounts = new Map();
  function addEdge(a, b) {
    if (a == null || b == null || a === b) return;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = lo + ':' + hi;
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = regionOf[r][c];
      if (r + 1 < rows) addEdge(a, regionOf[r + 1][c]);
      if (c + 1 < cols) addEdge(a, regionOf[r][c + 1]);
    }
  }
  for (const [key, sharedEdges] of edgeCounts) {
    const p = key.split(':').map(Number);
    regions[p[0]].neighbors.push({
      region: regions[p[1]].id,
      color: regions[p[1]].color,
      sharedEdges
    });
    regions[p[1]].neighbors.push({
      region: regions[p[0]].id,
      color: regions[p[0]].color,
      sharedEdges
    });
  }
  regions.forEach(x => x.neighbors.sort((a, b) => b.sharedEdges - a.sharedEdges));
  return { rows, cols, regionOf, regions };
}

function analyzeEntryGaps(regionAtlas, exposure) {
  const rows = regionAtlas.rows;
  const cols = regionAtlas.cols;
  const regions = regionAtlas.regions;
  const byId = new Map(regions.map((region, index) => [region.id, index]));
  const boundary = [];
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    const sides = { top: 0, bottom: 0, left: 0, right: 0 };
    let maxDepth = 0;
    for (const p of region.cells) {
      if (p[0] === 0) sides.top++;
      if (p[0] === rows - 1) sides.bottom++;
      if (p[1] === 0) sides.left++;
      if (p[1] === cols - 1) sides.right++;
      const depth = Math.min(p[0], rows - 1 - p[0], p[1], cols - 1 - p[1]);
      maxDepth = Math.max(maxDepth, depth);
    }
    if (region.touchesBorder) boundary.push({ index: i, sides, maxDepth });
  }

  const parents = new Array(regions.length).fill(null);
  const hops = new Array(regions.length).fill(null);
  const queue = [];
  for (const entry of boundary) {
    hops[entry.index] = 0;
    queue.push(entry.index);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const index = queue[qi];
    for (const neighbor of regions[index].neighbors) {
      const ni = byId.get(neighbor.region);
      if (ni == null || hops[ni] != null) continue;
      hops[ni] = hops[index] + 1;
      parents[ni] = index;
      queue.push(ni);
    }
  }

  function pathTo(index) {
    const path = [];
    let cur = index;
    let guard = 0;
    while (cur != null && guard++ < regions.length + 2) {
      path.push({
        region: regions[cur].id,
        color: regions[cur].color,
        area: regions[cur].area,
        touchesBorder: regions[cur].touchesBorder
      });
      cur = parents[cur];
    }
    return path.reverse();
  }

  const entryGapCandidates = boundary.map(entry => {
    const region = regions[entry.index];
    let innerNeighborArea = 0;
    let innerNeighborCount = 0;
    for (const neighbor of region.neighbors) {
      const ni = byId.get(neighbor.region);
      if (ni == null || regions[ni].touchesBorder) continue;
      innerNeighborArea += regions[ni].area;
      innerNeighborCount++;
    }
    return {
      region: region.id,
      color: region.color,
      area: region.area,
      borderSides: entry.sides,
      maxPenetrationDepth: entry.maxDepth,
      innerNeighborCount,
      innerNeighborArea,
      firstReachableStep: exposure.regionExposure.find(x => x.region === region.id)?.firstReachableStep ?? null,
      score: entry.maxDepth * 10 + Math.min(region.area, 100) + Math.min(innerNeighborArea, 200)
    };
  }).sort((a, b) => b.score - a.score);

  const hollowPaths = regions.map((region, index) => {
    if (region.touchesBorder || hops[index] == null) return null;
    const path = pathTo(index);
    return {
      targetRegion: region.id,
      targetColor: region.color,
      targetArea: region.area,
      hopsFromBoundary: hops[index],
      entryRegion: path[0] && path[0].region,
      entryColor: path[0] && path[0].color,
      path
    };
  }).filter(Boolean).sort((a, b) => {
    return (a.hopsFromBoundary - b.hopsFromBoundary) ||
      (b.targetArea - a.targetArea) ||
      a.targetRegion.localeCompare(b.targetRegion);
  });

  return {
    note: '这是目标区域拓扑上的入口/掏路径候选，尚未经过棋盘激活和玩家路线验证。',
    entryGapCandidates: entryGapCandidates.slice(0, 80),
    hollowPaths: hollowPaths.slice(0, 160)
  };
}

function makeTargetState(A, blocks) {
  const rows = blocks.length;
  const cols = blocks[0].length;
  let total = 0;
  for (const row of blocks) for (const v of row) if (v > 0) total++;
  return {
    state: A.Simulator.createState({
      blocks,
      rows,
      cols,
      totalPixels: total,
      totalBoxes: 0,
      bufferLimit: 5,
      board: { rows: 0, cols: 0, cells: [] }
    }, { useSlotStart: true, instantChain: true }),
    total
  };
}

function regionHits(trace, regionOf) {
  const counts = {};
  for (const p of trace) {
    const region = regionOf[p[0]][p[1]];
    if (region != null) counts[region] = (counts[region] || 0) + 1;
  }
  return counts;
}

function markReachableComponents(preview, regionOf, regions, exposureStep) {
  const hit = [];
  for (let r = 0; r < preview.rank.length; r++) {
    for (let c = 0; c < preview.rank[r].length; c++) {
      if (preview.rank[r][c] > 0) {
        const ri = regionOf[r][c];
        if (ri != null && exposureStep[ri] == null) {
          exposureStep[ri] = 0;
          hit.push(regions[ri].id);
        }
      }
    }
  }
  return hit;
}

function traceTargetExposure(A, blocks, regionAtlas) {
  const made = makeTargetState(A, blocks);
  const state = made.state;
  let done = 0;
  let guard = 0;
  const events = [];
  const exposureStep = new Array(regionAtlas.regions.length).fill(null);
  const initialPreview = A.Simulator.previewNextEliminationOrder(state);
  const initiallyReachableRegions = markReachableComponents(
    initialPreview, regionAtlas.regionOf, regionAtlas.regions, exposureStep
  );

  while (done < made.total && guard++ < 400) {
    const preview = A.Simulator.previewNextEliminationOrder(state);
    let bestColor = null;
    let bestReach = 0;
    for (const key of Object.keys(preview.byColor)) {
      const color = Number(key);
      const reachable = preview.byColor[key].reachable || 0;
      if (reachable > bestReach || (reachable === bestReach && bestReach > 0 && color < bestColor)) {
        bestColor = color;
        bestReach = reachable;
      }
    }
    if (bestColor == null || bestReach <= 0) break;
    const trace = [];
    const got = A.Simulator.elimDispatch(state, bestColor, Infinity, trace, preview.start, null);
    if (!(got > 0)) break;
    done += got;
    const hits = regionHits(trace, regionAtlas.regionOf);
    const nextPreview = A.Simulator.previewNextEliminationOrder(state);
    const newlyReachable = [];
    for (let r = 0; r < nextPreview.rank.length; r++) {
      for (let c = 0; c < nextPreview.rank[r].length; c++) {
        if (nextPreview.rank[r][c] > 0) {
          const ri = regionAtlas.regionOf[r][c];
          if (ri != null && exposureStep[ri] == null) {
            exposureStep[ri] = guard;
            newlyReachable.push(regionAtlas.regions[ri].id);
          }
        }
      }
    }
    events.push({
      step: guard,
      progress: round2(done / made.total),
      color: bestColor,
      reachableBefore: bestReach,
      eliminated: got,
      slot: preview.slot,
      start: preview.start,
      regionHits: Object.keys(hits).map(k => ({
        region: regionAtlas.regions[Number(k)].id,
        color: regionAtlas.regions[Number(k)].color,
        pixels: hits[k]
      })).sort((a, b) => b.pixels - a.pixels),
      newlyReachableRegions: Array.from(new Set(newlyReachable))
    });
  }

  const regionExposure = regionAtlas.regions.map((region, i) => ({
    region: region.id,
    color: region.color,
    area: region.area,
    touchesBorder: region.touchesBorder,
    firstReachableStep: exposureStep[i],
    initiallyReachable: exposureStep[i] === 0
  }));

  return {
    completed: done >= made.total,
    coveredPixels: done,
    totalPixels: made.total,
    initiallyReachableRegions,
    regionExposure,
    events
  };
}

function capacityRangeInfo(totals, minCap, maxCap) {
  const colors = Object.keys(totals).map(Number).sort((a, b) => a - b);
  const perColor = [];
  let totalMin = 0;
  let totalMax = 0;
  let exact = true;
  for (const color of colors) {
    const total = totals[color];
    const minCars = Math.max(1, Math.ceil(total / maxCap));
    const maxCars = Math.floor(total / minCap);
    const colorExact = maxCars >= minCars;
    if (!colorExact) exact = false;
    if (colorExact) {
      totalMin += minCars;
      totalMax += maxCars;
    }
    perColor.push({
      color,
      total,
      minCars,
      maxCars: Math.max(minCars, maxCars),
      exact: colorExact
    });
  }
  return {
    minCap,
    maxCap,
    exact,
    totalCarsMin: exact ? totalMin : null,
    totalCarsMax: exact ? totalMax : null,
    colors: perColor
  };
}

function boardCandidates(minEdge, maxEdge, capInfo, blackMaxPct) {
  const out = [];
  for (let rows = minEdge; rows <= maxEdge; rows++) {
    for (let cols = minEdge; cols <= maxEdge; cols++) {
      const cells = rows * cols;
      const inRange = capInfo.exact && cells >= capInfo.totalCarsMin && cells <= capInfo.totalCarsMax;
      const deficitCars = capInfo.exact && cells < capInfo.totalCarsMin ? capInfo.totalCarsMin - cells : 0;
      const unavoidableNonCarCells = capInfo.exact && cells > capInfo.totalCarsMax ? cells - capInfo.totalCarsMax : 0;
      const blackPct = unavoidableNonCarCells ? round2(unavoidableNonCarCells * 100 / cells) : 0;
      out.push({
        rows,
        cols,
        cells,
        minEdge: Math.min(rows, cols),
        preferredSeven: Math.min(rows, cols) >= 7,
        exactZeroBlackZeroPipe: !!inRange,
        deficitCars,
        unavoidableNonCarCells,
        unavoidableNonCarPct: blackPct,
        withinBlackMaxIfFilled: blackPct <= blackMaxPct
      });
    }
  }
  return out;
}

function planReference(A, blocks, capInfo, targetCars, policy, bufferLimit, regionAtlas) {
  const config = {
    boxSizeMin: capInfo.minCap,
    boxSizeMax: capInfo.maxCap,
    bufferLimit,
    ruleMode: 'instantChain',
    instantChain: true,
    instantPlanPolicy: policy,
    targetCarCount: targetCars || 0
  };
  const result = A.InstantPlayout.plan({
    blocks,
    rows: blocks.length,
    cols: blocks[0].length,
    bufferLimit
  }, config);
  const stat = result && result.boxes && result.boxes._instantPlayout;
  const cars = stat && stat.carSequence ? stat.carSequence.map((car, index) => {
    const box = result.boxes[index] || {};
    const hits = regionHits(box.instantPixels || [], regionAtlas.regionOf);
    return Object.assign({}, car, {
      regions: Object.keys(hits).map(k => ({
        region: regionAtlas.regions[Number(k)].id,
        color: regionAtlas.regions[Number(k)].color,
        pixels: hits[k]
      })).sort((a, b) => b.pixels - a.pixels)
    });
  }) : [];
  return {
    ok: !!(result && result.ok),
    reason: result && result.reason || null,
    policy,
    targetCars: targetCars || null,
    stat: stat || null,
    cars
  };
}

function storyCandidatesFromPlan(plan, regionAtlas) {
  const cars = plan && plan.cars || [];
  const debtCars = cars.filter(x => Number(x.debt) > 0);
  const fullCars = cars.filter(x => Number(x.debt) <= 0);
  const groupDebtWindows = [];
  for (let i = 0; i + 2 < cars.length; i++) {
    const window = cars.slice(i, i + 3);
    const debt = window.filter(x => Number(x.debt) > 0).length;
    const full = window.filter(x => Number(x.debt) <= 0).length;
    if (debt === 1 && full === 2) {
      groupDebtWindows.push({
        startIndex: i,
        window: window.map(x => ({
          id: x.id,
          color: x.color,
          capacity: x.cap,
          entryReach: x.entryReach,
          debt: x.debt,
          regions: x.regions || []
        })),
        note: '仅为目标图序列上的候选；必须另做 3 连锁链整组入场模拟'
      });
    }
  }
  return {
    debtCars,
    groupDebtWindows,
    revealCandidates: (regionAtlas.regions || [])
      .filter(r => r.area <= 4)
      .slice(0, 40)
      .map(r => ({
        region: r.id,
        color: r.color,
        area: r.area,
        touchesBorder: r.touchesBorder,
        bbox: r.bbox
      })),
    forcedGateCandidates: []
  };
}

function mdTable(headers, rows) {
  const out = ['| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |'];
  for (const row of rows) out.push('| ' + row.join(' | ') + ' |');
  return out.join('\n');
}

function buildMarkdown(report) {
  const t = report.target;
  const lines = [];
  lines.push('# Target Story Atlas v0');
  lines.push('');
  lines.push('> 只读分析。没有生成关卡，没有搜索随机 seed，没有修改生产代码。');
  lines.push('');
  lines.push('## 目标图');
  lines.push('');
  lines.push('- 文件：`' + t.file + '`');
  lines.push('- 尺寸：' + t.rows + '×' + t.cols);
  lines.push('- 彩色像素：' + t.pixels);
  lines.push('- 颜色：' + t.colorCount);
  lines.push('- 同色连通区域：' + t.regionCount);
  lines.push('- 开局可达区域：' + t.initiallyReachableRegions.length);
  lines.push('');
  lines.push('### 颜色总量');
  lines.push('');
  lines.push(mdTable(['色号', '像素'], Object.keys(t.colorTotals).sort((a, b) => +a - +b).map(c => [c, t.colorTotals[c]])));
  lines.push('');
  lines.push('### 区域概况');
  lines.push('');
  lines.push(mdTable(
    ['区域', '色号', '面积', '边界', '首次可达步骤'],
    t.regionExposure.slice(0, 80).map(r => [
      r.region, r.color, r.area, r.touchesBorder ? '是' : '否', r.firstReachableStep
    ])
  ));
  if (t.regionExposure.length > 80) lines.push('\n（仅展示前 80 个区域，完整数据见 target-atlas.json）');
  lines.push('');
  lines.push('### 缺口与向内掏候选');
  lines.push('');
  lines.push('> 这是目标区域拓扑候选。真正能否从缺口进入，还要经过棋盘激活、曼哈顿起点和车辆依赖验证。');
  lines.push('');
  lines.push(mdTable(
    ['入口区域', '色号', '面积', '向内深度', '内部相邻面积', '首次可达步骤', '评分'],
    (t.entryAnalysis.entryGapCandidates || []).slice(0, 20).map(r => [
      r.region, r.color, r.area, r.maxPenetrationDepth, r.innerNeighborArea,
      r.firstReachableStep, r.score
    ])
  ));
  lines.push('');
  lines.push(mdTable(
    ['目标区域', '色号', '面积', '边界跳数', '入口路径'],
    (t.entryAnalysis.hollowPaths || []).slice(0, 20).map(r => [
      r.targetRegion, r.targetColor, r.targetArea, r.hopsFromBoundary,
      r.path.map(x => x.region + '(' + x.color + ')').join(' → ')
    ])
  ));
  if ((t.entryAnalysis.hollowPaths || []).length > 20) {
    lines.push('\n（以上仅展示前 20 条掏路径，完整数据见 target-atlas.json）');
  }
  lines.push('');
  lines.push('## 容量与棋盘');
  lines.push('');
  for (const r of report.capacityRanges) {
    lines.push('### ' + r.label);
    lines.push('');
    lines.push('- 容量区间：`[' + r.minCap + ',' + r.maxCap + ']`');
    lines.push('- 全部颜色精确可分：' + (r.exact ? '是' : '否'));
    if (r.exact) lines.push('- 总车数：' + r.totalCarsMin + '～' + r.totalCarsMax);
    lines.push('');
    lines.push(mdTable(
      ['棋盘', '格数', '零黑零管道可精确', '至少非车格', '非车占比', '7以上偏好'],
      r.boards.map(b => [
        b.rows + '×' + b.cols, b.cells,
        b.exactZeroBlackZeroPipe ? '是' : '否',
        b.unavoidableNonCarCells,
        b.unavoidableNonCarPct + '%',
        b.preferredSeven ? '是' : '否'
      ])
    ));
    lines.push('');
  }
  lines.push('## 参考目标消除序列');
  lines.push('');
  if (report.referenceExposure) {
    lines.push('- 完成：' + (report.referenceExposure.completed ? '是' : '否'));
    lines.push('- 步数：' + report.referenceExposure.events.length);
    lines.push('- 已覆盖像素：' + report.referenceExposure.coveredPixels + '/' + report.referenceExposure.totalPixels);
  }
  lines.push('');
  lines.push('## 第一轮故事候选');
  lines.push('');
  for (const p of report.storyPlans) {
    lines.push('### ' + p.label);
    lines.push('');
    lines.push('- 规划状态：' + (p.plan.ok ? '可执行' : '失败 ' + (p.plan.reason || '')));
    if (p.plan.stat) {
      lines.push('- 车辆：' + p.plan.stat.cars);
      lines.push('- 最大 buffer：' + p.plan.stat.maxBuffer);
      lines.push('- 债务车：' + p.plan.stat.debtCars);
      lines.push('- 精确容量颜色：' + p.plan.stat.exactCapacityColors);
      lines.push('- 非精确容量颜色：' + p.plan.stat.infeasibleCapacityColors);
    }
    if (p.candidates.groupDebtWindows.length) {
      lines.push('- `groupDebt` 候选窗口：' + p.candidates.groupDebtWindows.length);
    }
    if (p.candidates.debtCars.length) {
      lines.push('- 债务车候选：' + p.candidates.debtCars.length);
    }
    lines.push('');
  }
  lines.push('## 结论');
  lines.push('');
  lines.push('- 该报告只证明目标图存在某些容量/区域候选，不证明棋盘已经可实现；');
  lines.push('- `groupDebt` 窗口仍是待验证候选，必须用 3 连锁链整组入场重新模拟；');
  lines.push('- `forcedGate` 需要棋盘布局后才能判断，本报告不伪造；');
  lines.push('- 下一步应据此选择一条故事主线，再写 `StoryPlan`，不要直接从报告跳到随机生产。');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const targetArg = valueAfter(args, '--target', '') ||
    (args.includes('--input') ? valueAfter(args, '--input', '') : positionalTarget(args));
  if (!targetArg) {
    console.error('用法: node TargetStoryAtlas_v632.js --target <txt> [--out-dir DIR] [--caps auto,31-40,20-40,18-40,16-40] [--min-edge 6] [--max-edge 9] [--buffer 5] [--policy shortDebt]');
    process.exit(2);
  }
  const target = path.resolve(targetArg);
  const outDir = path.resolve(valueAfter(
    args,
    '--out-dir',
    path.join(path.dirname(target), '分析_v632')
  ));
  fs.mkdirSync(outDir, { recursive: true });
  const minEdge = Math.max(1, parseInt(valueAfter(args, '--min-edge', '6'), 10) || 6);
  const maxEdge = Math.max(minEdge, parseInt(valueAfter(args, '--max-edge', '9'), 10) || 9);
  const bufferLimit = Math.max(1, parseInt(valueAfter(args, '--buffer', '5'), 10) || 5);
  const policy = valueAfter(args, '--policy', 'shortDebt');
  const capsText = valueAfter(args, '--caps', 'auto,20-40,18-40,16-40');
  const blackMaxPct = Math.max(0, parseFloat(valueAfter(args, '--black-max-pct', '5')) || 0);

  const A = loadSolver();
  const text = fs.readFileSync(target, 'utf8');
  const blocks = A.Generator.blocksFromTXT(text);
  if (!blocks || !blocks.length) throw new Error('无法从 TXT 读取像素矩阵');
  const rows = blocks.length;
  const cols = blocks[0].length;
  const totalsInfo = colorTotals(blocks);
  const regionAtlas = buildRegions(blocks);
  const sourcePreflight = A.SourcePreflight.analyze(blocks);
  const exposure = traceTargetExposure(A, blocks, regionAtlas);
  const entryAnalysis = analyzeEntryGaps(regionAtlas, exposure);
  const previewFile = path.join(outDir, 'target-preview.png');
  const preview = writePreviewPng(previewFile, blocks, A);

  let vein = null;
  try {
    vein = A.Generator.veinLayers(A.parseLevel({ blocks, bufferLimit }), {});
  } catch (err) {
    vein = { error: String(err && err.message || err) };
  }

  const capSpecs = [];
  const addCapSpec = (label, minCap, maxCap) => {
    if (!(minCap > 0) || maxCap < minCap) return;
    if (capSpecs.some(x => x.minCap === minCap && x.maxCap === maxCap)) return;
    capSpecs.push({ label, minCap, maxCap });
  };
  for (const token of capsText.split(',').map(x => x.trim()).filter(Boolean)) {
    if (token === 'auto') {
      if (sourcePreflight.capacity && sourcePreflight.capacity.band) {
        addCapSpec('auto', sourcePreflight.capacity.band[0], sourcePreflight.capacity.band[1]);
      }
      continue;
    }
    const p = parseCapRange(token);
    if (p) addCapSpec(token, p.min, p.max);
  }
  if (!capSpecs.length) throw new Error('没有可分析的容量区间');

  const capacityRanges = capSpecs.map(spec => {
    const info = capacityRangeInfo(totalsInfo.totals, spec.minCap, spec.maxCap);
    return Object.assign({ label: spec.label }, info, {
      boards: boardCandidates(minEdge, maxEdge, info, blackMaxPct)
    });
  });

  const storyPlans = [];
  for (const range of capacityRanges) {
    const exactBoards = range.boards.filter(b => b.exactZeroBlackZeroPipe);
    const selectedBoards = exactBoards.slice().sort((a, b) => {
      return (Number(b.preferredSeven) - Number(a.preferredSeven)) ||
        (Math.abs(a.rows - a.cols) - Math.abs(b.rows - b.cols)) ||
        (a.cells - b.cells) ||
        (a.rows - b.rows) ||
        (a.cols - b.cols);
    }).slice(0, 6);
    if (!selectedBoards.length) {
      const plan = planReference(A, blocks, range, null, policy, bufferLimit, regionAtlas);
      storyPlans.push({
        label: range.label + ' / 未绑定棋盘',
        plan,
        candidates: storyCandidatesFromPlan(plan, regionAtlas)
      });
      continue;
    }
    for (const board of selectedBoards) {
      const plan = planReference(A, blocks, range, board.cells, policy, bufferLimit, regionAtlas);
      storyPlans.push({
        label: range.label + ' / ' + board.rows + '×' + board.cols,
        board,
        plan,
        candidates: storyCandidatesFromPlan(plan, regionAtlas)
      });
    }
  }

  const report = {
    schema: 'target-story-atlas-v0',
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    input: {
      targetTxt: target,
      ruleMode: 'instantChain',
      capacitySpecs: capSpecs,
      boardRange: { minEdge, maxEdge, blackMaxPct },
      bufferLimit,
      policy
    },
    target: {
      file: target,
      rows,
      cols,
      pixels: totalsInfo.pixels,
      colorCount: Object.keys(totalsInfo.totals).length,
      colorTotals: totalsInfo.totals,
      regionCount: regionAtlas.regions.length,
      regions: regionAtlas.regions,
      regionExposure: exposure.regionExposure,
      initiallyReachableRegions: exposure.initiallyReachableRegions,
      entryAnalysis,
      colorLibrary: preview.detectedLibrary,
      preview,
      veinLayers: vein,
      sourcePreflight
    },
    referenceExposure: {
      completed: exposure.completed,
      coveredPixels: exposure.coveredPixels,
      totalPixels: exposure.totalPixels,
      events: exposure.events
    },
    capacityRanges,
    storyPlans
  };

  // Keep the four promised artifacts separate.
  fs.mkdirSync(outDir, { recursive: true });
  const targetAtlas = {
    schema: report.schema,
    generatedAt: report.generatedAt,
    target: report.target,
    referenceExposure: report.referenceExposure
  };
  const boardReport = {
    schema: 'capacity-board-feasibility-v0',
    generatedAt: report.generatedAt,
    input: report.input,
    capacityRanges: report.capacityRanges
  };
  const storyReport = {
    schema: 'story-candidates-v0',
    generatedAt: report.generatedAt,
    policy,
    storyPlans: report.storyPlans,
    note: 'groupDebt 是目标图序列候选，必须用 3 连锁链整组入场重新验证；forcedGate 需要棋盘布局后才能判断。'
  };
  fs.writeFileSync(path.join(outDir, 'target-atlas.json'), JSON.stringify(targetAtlas, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'capacity-board-feasibility.json'), JSON.stringify(boardReport, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'story-candidates.json'), JSON.stringify(storyReport, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'story-preflight.md'), buildMarkdown(report) + '\n');

  console.log(JSON.stringify({
    ok: true,
    outDir,
    target: report.target.file,
    pixels: report.target.pixels,
    colors: report.target.colorCount,
    regions: report.target.regionCount,
    capacityRanges: report.capacityRanges.map(x => ({
      label: x.label,
      exact: x.exact,
      cars: x.exact ? [x.totalCarsMin, x.totalCarsMax] : null,
      exactBoards: x.boards.filter(b => b.exactZeroBlackZeroPipe).map(b => b.rows + 'x' + b.cols)
    })),
    storyPlans: report.storyPlans.length
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
