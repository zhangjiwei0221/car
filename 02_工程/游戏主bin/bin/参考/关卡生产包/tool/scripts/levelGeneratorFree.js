/**
 * levelGeneratorFree.js
 * 毛线关卡生成模块 —— 无需 TXT/Tiled 文件版 v2
 *
 * 与 levelGeneratorTxt.js 的区别：
 *   1. 无需导入任何外部文件（TXT / Tiled JSON）
 *   2. 新增 targetWidth 参数（目标区宽度，即列数）
 *   3. colorSequence / colorRange / extraColorGroups 由调用方显式指定，不传走随机逻辑
 *
 * v2 新增：
 *   4. 颜色组数支持 30-60（默认随机）
 *   5. 黑块随机布置（连通性校验，黑块+管道不封死格子）
 *   6. 颜色选取排除靠色（每色系最多取 1 种）
 *
 * 用法：
 *   const gen = require('./levelGeneratorFree');
 *
 *   // 生成单个关卡
 *   const result = await gen.generateLevel({
 *     targetWidth:      4,            // 目标区宽度（列数）
 *     colorSequence:    '1,13,19,25,7,31', // 颜色序列（可选，不传自动排色系随机）
 *     colorRange:       6,            // 颜色范围：从序列中取多少种颜色
 *     extraColorGroups: 40,           // 颜色组数（30-60 推荐）
 *     blackBlockRatio:  0.12,         // 黑块占比（默认 12%）
 *   }, '/output/dir');
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const { levelJSONToTXT } = require('./levelTxtFormat');

const TOOL_PATH        = path.resolve(__dirname, '../dist5_preview/dist 5/index.html');
const DEFAULT_COLOR_ID = 32;

// ==================== 色系分组（排除靠色用）====================
// 每组内颜色视觉相近，随机选色时每组最多取 1 种
// ==================== 颜色互斥组（由田耿指定）====================
// 同一组内颜色视觉相近，不可同时出现在同一关卡。
// 选色采用约束满足：选定某颜色后，同组其他颜色全部排除（支持跨组重叠约束）。
// 未被任何组覆盖的颜色视为独立，可自由选取。
const COLOR_FAMILIES = [
  [15, 16, 17, 18, 33],   // 蓝/灰蓝系
  [7,  8,  9, 10],        // 紫系
  [1,  2,  3],            // 红/粉红系
  [20, 21, 22, 23],       // 绿系
  [26, 28, 29],           // 橙/砖红系
  [4,  6,  9, 11, 12, 24],// 暗色系互斥（补充；9 兼属紫系，两个约束均生效）
  [25, 30],               // 黄系（视觉相近）
  [31, 32],               // 米白/奶油系
  // ── 新增 4 组 ──
  [5, 25, 27, 29],        // 组1：浅粉/黄/浅橙/深黄
  [1,  2,  3,  4,  6],   // 组2：红粉系扩展含暗红/深红
  [10, 17],               // 组3：紫×蓝紫跨系互斥
  [4,  6,  9, 12],        // 组4：暗色系核心
];

// ==================== 有效配色方案列表（来自 valid_palettes.md）====================
// 从 3000 个候选中过滤出 423 个无互斥冲突的方案，每次随机选一个。
// 如需更新，重新解析 valid_palettes.md 并替换 VALID_PALETTES 数组。
const VALID_PALETTES = (() => {
  const fs = require('fs');
const { levelJSONToTXT } = require('./levelTxtFormat');
  const path = require('path');
  const palettesPath = path.resolve(__dirname, '../valid_palettes.md');
  try {
    const content = fs.readFileSync(palettesPath, 'utf8');
    const palettes = [];
    for (const line of content.split('\n')) {
      const m = line.match(/\*\*方案 \d+\*\*（\d+色）：(.+)/);
      if (!m) continue;
      const ids = [...m[1].matchAll(/`(\d+)`/g)].map(x => parseInt(x[1]));
      if (ids.length >= 7) palettes.push(ids);
    }
    return palettes;
  } catch (e) {
    console.warn('[VALID_PALETTES] 无法读取 valid_palettes.md，回退到约束随机选色:', e.message);
    return null;
  }
})();

/**
 * 随机生成颜色参数
 *   优先从 valid_palettes.md 列表中随机选取一个方案（423个经过验证的配色）。
 *   若文件不可用，回退到原有的约束满足随机选色逻辑。
 */
function randomColorParams(groupCount) {
  const groups = groupCount || (40 + Math.floor(Math.random() * 21)); // 40-60

  // 优先使用预验证配色方案列表
  if (VALID_PALETTES && VALID_PALETTES.length > 0) {
    const palette = VALID_PALETTES[Math.floor(Math.random() * VALID_PALETTES.length)];
    return {
      colorSequence:    palette.join(','),
      colorRange:       palette.length,
      extraColorGroups: groups,
    };
  }

  // 回退：约束满足随机选色（原有逻辑）
  const numColors = 7 + Math.floor(Math.random() * 2); // 7-8 种
  const allColors = Array.from({ length: 34 }, (_, i) => i + 1);
  for (let i = allColors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allColors[i], allColors[j]] = [allColors[j], allColors[i]];
  }
  const selected = [];
  const excluded = new Set();
  for (const color of allColors) {
    if (selected.length >= numColors) break;
    if (excluded.has(color)) continue;
    selected.push(color);
    for (const group of COLOR_FAMILIES) {
      if (group.includes(color)) {
        for (const mate of group) {
          if (mate !== color) excluded.add(mate);
        }
      }
    }
  }
  return {
    colorSequence:    selected.join(','),
    colorRange:       selected.length,
    extraColorGroups: groups,
  };
}

// ==================== 结构化目标区构建 ====================
/**
 * 直接构建目标区数据（不依赖 generateSupplementColors）
 *
 * 策略：把每种颜色的格子集中成连续块排列（横向条纹），
 * 避免随机洗牌导致各行颜色过于分散、缓冲区塞满不同色卡死。
 *
 * @param {number}   totalGroups  颜色组数（每组3格）
 * @param {number}   targetWidth  目标区宽度（列数）
 * @param {number[]} colorIds     颜色ID列表（已排除靠色）
 * @returns {Array<Array<number>>} 二维颜色ID数组（顶行在前）
 */
function buildStructuredTargetData(totalGroups, targetWidth, colorIds) {
  const n = colorIds.length;
  const groupsPerColor = Math.floor(totalGroups / n);
  const extras         = totalGroups % n;

  // 按颜色连续填入格子（groups×3 个格子连在一起）
  const cells = [];
  for (let i = 0; i < n; i++) {
    const g = groupsPerColor + (i < extras ? 1 : 0);
    for (let k = 0; k < g * 3; k++) cells.push(colorIds[i]);
  }

  // 切成 targetWidth 宽的行
  const rows = [];
  let idx = 0;
  while (idx < cells.length) {
    const row = [];
    for (let c = 0; c < targetWidth && idx < cells.length; c++) {
      row.push(cells[idx++]);
    }
    while (row.length < targetWidth) row.push(0); // 末行不足时补 0
    rows.push(row);
  }

  // 翻转使底行（游戏第一行）对应第一种颜色的连续块
  rows.reverse();
  return rows;
}

// ==================== 棋盘尺寸 ====================
/**
 * 综合管道约束计算棋盘最小面积，再选近正方形（rows >= cols）尺寸
 *
 * 约束逻辑：
 *   最大溢出容量 = maxPipeCount × (maxPipeDepth - 1)
 *   最小有效格数 = totalGroups - 最大溢出容量
 *   最小棋盘格数 = ceil(最小有效格数 / (1 - blackBlockRatio))
 */
function calculateBoardSize(totalGroups, {
  maxPipeCount    = 4,
  maxPipeDepth    = 3,
  blackBlockRatio = 0.12,
} = {}) {
  const maxOverflow  = maxPipeCount * (maxPipeDepth - 1); // 管道可承接的最大溢出量
  const minEffective = Math.max(totalGroups - maxOverflow, Math.ceil(totalGroups * 0.5));
  const minCells     = Math.ceil(minEffective / (1 - blackBlockRatio));

  // 优先选近正方形（rows >= cols），面积 >= minCells，最接近 minCells
  let bestRows = 4, bestCols = 4, bestScore = -Infinity;
  for (let r = 2; r <= 12; r++) {
    for (let c = 2; c <= r; c++) {     // rows >= cols，不过宽
      const area = r * c;
      if (area < minCells) continue;   // 必须满足最小面积
      const distFromMin  = area - minCells;        // 尽量小（不浪费空间）
      const squareness   = -Math.abs(r - c);       // 越方越好
      const score = squareness * 3 - distFromMin;  // 综合打分
      if (score > bestScore) {
        bestScore = score;
        bestRows  = r;
        bestCols  = c;
      }
    }
  }
  return { rows: bestRows, cols: bestCols };
}

// ==================== 管道数量（支持有效格子数 + 最大深度限制）====================
/**
 * @param {number} totalGroups
 * @param {number} effectiveCells  可用格数（去掉黑块后）
 * @param {number} [maxPipeDepth]  管道最大深度（默认 3）
 * @param {number} [maxPipeCount]  管道最大总数（默认 4）
 */
function calculatePipeCount(totalGroups, effectiveCells, maxPipeDepth = 3, maxPipeCount = 4) {
  const R = totalGroups - effectiveCells;
  if (R <= 0) return 0;
  // depth = 1 + R/pipeCount ≤ maxPipeDepth → pipeCount ≥ R/(maxPipeDepth-1)
  const minByDepth = (maxPipeDepth > 1) ? Math.ceil(R / (maxPipeDepth - 1)) : R;
  return Math.min(maxPipeCount, Math.max(minByDepth, 1));
}

function calcPipeDepth(totalGroups, effectiveCells, pipeCount) {
  if (pipeCount === 0) return 0;
  return (totalGroups - (effectiveCells - pipeCount)) / pipeCount;
}

// ==================== 可达性校验（顶部入射 Flood Fill）====================
/**
 * 新规则：左/右/下边缘 + 黑块 + 管道格 均视为"封死"。
 * 从棋盘顶部（虚拟行 -1）向下 flood fill，
 * 确保所有非黑、非管道格都能被玩家"手"触达。
 *
 * @param {number} rows
 * @param {number} cols
 * @param {Set<string>} blackSet   - "r,c" 格式
 * @param {Set<string>} pipeSet    - "r,c" 格式（管道入口）
 */
function isAccessibleFromTop(rows, cols, blackSet, pipeSet) {
  const blocked = key => blackSet.has(key) || pipeSet.has(key);

  // 从顶部虚拟行 (-1, 0..cols-1) 开始 BFS
  const visited = new Set();
  const queue   = [];
  for (let c = 0; c < cols; c++) {
    const key = `-1,${c}`;
    visited.add(key);
    queue.push([-1, c]);
  }

  while (queue.length > 0) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (nc < 0 || nc >= cols) continue;   // 左/右边缘封死
      if (nr >= rows)           continue;   // 下边缘封死
      if (nr < -1)              continue;   // 顶部以上不存在
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      if (nr >= 0 && blocked(key)) continue; // 黑块/管道封死
      visited.add(key);
      queue.push([nr, nc]);
    }
  }

  // 检查所有"可用格"（非黑、非管道）都被访问到
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r},${c}`;
      if (blocked(key)) continue;
      if (!visited.has(key)) return false; // 有格子被封死了
    }
  }
  return true;
}

/**
 * 生成黑块位置（顶部可达性安全）
 *  - pipeSet: 管道位置（也视为"封死"，不可放黑块也不可跨越）
 *  - 确保放置后所有非黑、非管道格仍可从顶部到达
 */
function buildBlackBlocksAccessible(rows, cols, targetCount, pipeSet) {
  if (targetCount <= 0) return [];
  const blackSet = new Set();

  // 候选格子：不是管道格，且不在第一行（row 0 禁放黑块）
  const candidates = [];
  for (let r = 1; r < rows; r++)   // r 从 1 开始，跳过第一行
    for (let c = 0; c < cols; c++) {
      const key = `${r},${c}`;
      if (!pipeSet.has(key)) candidates.push(key);
    }

  // Fisher-Yates shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  let placed = 0;
  for (const key of candidates) {
    if (placed >= targetCount) break;
    blackSet.add(key);
    if (!isAccessibleFromTop(rows, cols, blackSet, pipeSet)) {
      blackSet.delete(key); // 会封死某个格，回退
    } else {
      placed++;
    }
  }

  return [...blackSet].map(k => {
    const [r, c] = k.split(',').map(Number);
    return { row: r, col: c };
  });
}

// 保留旧名兼容（内部已改为 accessible 版本）
function buildBlackBlocks(rows, cols, targetCount, excludeSet) {
  return buildBlackBlocksAccessible(rows, cols, targetCount, excludeSet || new Set());
}

// 保留 isConnected 接口（对外 export 用）
function isConnected(rows, cols, blackSet) {
  return isAccessibleFromTop(rows, cols, blackSet, new Set());
}

// ==================== 管道布局 ====================
const PIPE_STRATEGIES = ['symmetric', 'corners', 'hbands', 'vbands', 'zigzag'];

function buildSymmetricPipes(rows, cols, pipeCount, blackSet) {
  if (pipeCount === 0) return [];
  const bs = blackSet || new Set();
  const strategy = PIPE_STRATEGIES[Math.floor(Math.random() * PIPE_STRATEGIES.length)];
  return buildPipes(strategy, rows, cols, pipeCount, bs);
}

function buildPipes(strategy, rows, cols, pipeCount, blackSet) {
  const bs         = blackSet || new Set();
  const maxPerRow  = Math.floor(cols * 0.7);
  const pipePosSet = new Set();
  const targetSet  = new Set();
  const rowCount   = {};
  const pipes      = [];

  function tryAdd(r, c, type, dr, dc) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
    const tr = r + dr, tc = c + dc;
    if (tr < 0 || tr >= rows || tc < 0 || tc >= cols) return false;
    const pk = `${r},${c}`, tk = `${tr},${tc}`;
    if (pipePosSet.has(pk) || pipePosSet.has(tk)) return false;
    if (targetSet.has(tk) || targetSet.has(pk)) return false;
    if (bs.has(pk) || bs.has(tk)) return false;          // 跳过黑块

    // ★ 管道本格至少有一个非出口方向的非黑块邻格（玩家入口）
    const DIRS = [[-1,0],[0,1],[1,0],[0,-1]];
    let hasEntry = false;
    for (const [nr, nc] of DIRS) {
      if (nr === dr && nc === dc) continue; // 跳过出口方向
      const er = r + nr, ec = c + nc;
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) { hasEntry = true; break; } // 边界外=可入
      if (!bs.has(`${er},${ec}`)) { hasEntry = true; break; }
    }
    if (!hasEntry) return false;

    // ★ 出口格至少有一个方向（排除回头）不是黑块
    let exitHasExit = false;
    for (const [nr, nc] of DIRS) {
      if (nr === -dr && nc === -dc) continue; // 跳过指向管道本格的方向
      const er = tr + nr, ec = tc + nc;
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) { exitHasExit = true; break; }
      if (!bs.has(`${er},${ec}`)) { exitHasExit = true; break; }
    }
    if (!exitHasExit) return false;

    if ((rowCount[r] || 0) >= maxPerRow) return false;
    pipes.push({ row: r, col: c, type });
    pipePosSet.add(pk);
    targetSet.add(tk);
    rowCount[r] = (rowCount[r] || 0) + 1;
    return true;
  }

  function spread(lo, hi, n) {
    if (n <= 0 || hi < lo) return [];
    if (n === 1) return [Math.round((lo + hi) / 2)];
    const res = [];
    for (let i = 0; i < n; i++)
      res.push(Math.round(lo + i * (hi - lo) / (n - 1)));
    return [...new Set(res)].slice(0, n);
  }

  // ---- 特殊情况：单行棋盘（只能放水平管道）----
  if (rows === 1) {
    const colList = spread(1, cols - 2, pipeCount);
    for (const c of colList) {
      if (!tryAdd(0, c, 12, 0, 1)) tryAdd(0, c, 14, 0, -1);
    }
    return pipes;
  }

  // ---- 特殊情况：单列棋盘（只能放垂直管道）----
  if (cols === 1) {
    const rowList = spread(1, rows - 2, pipeCount);
    for (const r of rowList) {
      if (!tryAdd(r, 0, 13, 1, 0)) tryAdd(r, 0, 11, -1, 0);
    }
    return pipes;
  }

  function placeAlongRow(baseRow, colList, type, dr, dc) {
    for (const c of colList)
      for (let d = 0; d < rows; d++) {
        if (tryAdd(baseRow + d, c, type, dr, dc)) break;
        if (d > 0 && tryAdd(baseRow - d, c, type, dr, dc)) break;
      }
  }

  function placeAlongCol(baseCol, rowList, type, dr, dc) {
    for (const r of rowList)
      for (let d = 0; d < cols; d++) {
        if (tryAdd(r, baseCol + d, type, dr, dc)) break;
        if (d > 0 && tryAdd(r, baseCol - d, type, dr, dc)) break;
      }
  }

  const base = Math.floor(pipeCount / 4), extra = pipeCount % 4;
  const n0 = base + (extra > 0 ? 1 : 0);
  const n1 = base + (extra > 1 ? 1 : 0);
  const n2 = base + (extra > 2 ? 1 : 0);
  const n3 = base;

  if (strategy === 'symmetric') {
    placeAlongRow(Math.max(1, Math.floor(rows*0.3)),      spread(2, cols-3, n0), 11, -1,  0);
    placeAlongRow(Math.min(rows-2, Math.floor(rows*0.7)), spread(2, cols-3, n1), 13,  1,  0);
    placeAlongCol(1,        spread(1, rows-2, n2), 12,  0,  1);
    placeAlongCol(cols - 2, spread(1, rows-2, n3), 14,  0, -1);
  } else if (strategy === 'corners') {
    const q = Math.max(1, Math.floor(rows / 3));
    const nwRows = spread(1, q, Math.ceil(n0/2));
    const neRows = spread(1, q, Math.floor(n0/2));
    const swRows = spread(rows-1-q, rows-2, Math.ceil(n1/2));
    const seRows = spread(rows-1-q, rows-2, Math.floor(n1/2));
    for (const r of nwRows) { for(let d=0;d<cols;d++) if(tryAdd(r,d+1,13,1,0)) break; }
    for (const r of neRows) { for(let d=0;d<cols;d++) if(tryAdd(r,cols-2-d,13,1,0)) break; }
    for (const r of swRows) { for(let d=0;d<cols;d++) if(tryAdd(r,d+1,11,-1,0)) break; }
    for (const r of seRows) { for(let d=0;d<cols;d++) if(tryAdd(r,cols-2-d,11,-1,0)) break; }
    placeAlongCol(1,        spread(Math.floor(rows*0.3), Math.floor(rows*0.7), n2), 12, 0, 1);
    placeAlongCol(cols - 2, spread(Math.floor(rows*0.3), Math.floor(rows*0.7), n3), 14, 0, -1);
  } else if (strategy === 'hbands') {
    const bandCount = Math.min(3, Math.max(2, Math.ceil(pipeCount / Math.max(2, cols-2))));
    const bandRows  = spread(1, rows-2, bandCount);
    const dirCycle  = [[11,-1,0],[13,1,0],[11,-1,0]];
    let remain = pipeCount;
    bandRows.forEach((br, i) => {
      const n = i < bandCount-1 ? Math.ceil(pipeCount / bandCount) : remain;
      const [type, dr, dc] = dirCycle[i % dirCycle.length];
      placeAlongRow(br, spread(1, cols-2, n), type, dr, dc);
      remain = Math.max(0, remain - n);
    });
  } else if (strategy === 'vbands') {
    const bandCount = Math.min(3, Math.max(2, Math.ceil(pipeCount / Math.max(2, rows-2))));
    const bandCols  = spread(1, cols-2, bandCount);
    const dirCycle  = [[12,0,1],[14,0,-1],[12,0,1]];
    let remain = pipeCount;
    bandCols.forEach((bc, i) => {
      const n = i < bandCount-1 ? Math.ceil(pipeCount / bandCount) : remain;
      const [type, dr, dc] = dirCycle[i % dirCycle.length];
      placeAlongCol(bc, spread(1, rows-2, n), type, dr, dc);
      remain = Math.max(0, remain - n);
    });
  } else if (strategy === 'zigzag') {
    const colList = spread(1, cols-2, pipeCount);
    colList.forEach((c, i) => {
      const isOdd  = i % 2 === 1;
      const baseRow = isOdd ? Math.floor(rows*0.6) : Math.floor(rows*0.35);
      const type = isOdd ? 13 : 11;
      const dr   = isOdd ? 1 : -1;
      for (let d = 0; d < rows; d++) {
        if (tryAdd(baseRow + d, c, type, dr, 0)) break;
        if (d > 0 && tryAdd(baseRow - d, c, type, dr, 0)) break;
      }
    });
  }

  return pipes;
}

// ==================== 链条死锁检测 ====================
/**
 * 固定点BFS：检查是否存在链条对两端无法同时激活的死锁
 * 死锁场景：链条格A可达，但伙伴B被黑块+管道+墙封死（唯一出路是链条自身→死循环）
 * 修复（2026-04-01 田耿反馈）
 */
async function checkChainDeadlock(page) {
  return page.evaluate(() => {
    const { elementZoneManager } = window.app;
    const spools = elementZoneManager.getData();
    const rows = spools.length;
    if (rows === 0) return { ok: true, deadlocked: [] };
    const cols = spools[0].length;

    function isPipe(elem) {
      const t = Array.isArray(elem.type) ? elem.type : [elem.type];
      return t.some(x => x >= 11 && x <= 14);
    }
    function isChain(elem) {
      const t = Array.isArray(elem.type) ? elem.type : [elem.type];
      return t.includes(5);
    }
    function isRemovable(elem) {
      return elem && elem.id > 0 && elem.id !== -1 && !isPipe(elem);
    }

    const chainPairOf = {};
    const chainPaired = {};
    const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const elem = spools[r] && spools[r][c];
        if (!elem || !isChain(elem)) continue;
        const key = r + ',' + c;
        if (chainPaired[key]) continue;
        for (const [dr, dc] of DIRS) {
          const nr = r+dr, nc = c+dc;
          if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
          const nkey = nr + ',' + nc;
          const nelem = spools[nr][nc];
          if (nelem && isChain(nelem) && !chainPaired[nkey]) {
            chainPairOf[key] = nkey;
            chainPairOf[nkey] = key;
            chainPaired[key] = chainPaired[nkey] = true;
            break;
          }
        }
      }
    }

    const S = {};
    const queue = [];
    for (let c = 0; c < cols; c++) {
      const elem = spools[0] && spools[0][c];
      if (elem && isRemovable(elem)) {
        S['0,' + c] = true;
        queue.push([0, c]);
      }
    }

    function trySpread(r, c) {
      const elem = spools[r] && spools[r][c];
      if (!isRemovable(elem)) return;
      const key = r + ',' + c;
      if (isChain(elem)) {
        const partnerKey = chainPairOf[key];
        if (partnerKey && !S[partnerKey]) return;
      }
      for (const [dr, dc] of DIRS) {
        const nr = r+dr, nc = c+dc;
        if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
        const nkey = nr + ',' + nc;
        if (S[nkey]) continue;
        const nelem = spools[nr][nc];
        if (!nelem || nelem.id <= 0 || nelem.id === -1) continue;
        if (isPipe(nelem)) continue;
        S[nkey] = true;
        queue.push([nr, nc]);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const [r, c] = queue[head++];
      trySpread(r, c);
    }
    let changed = true;
    while (changed) {
      changed = false;
      const before = Object.keys(S).length;
      for (const key of Object.keys(S)) {
        const [r, c] = key.split(',').map(Number);
        trySpread(r, c);
      }
      if (Object.keys(S).length > before) changed = true;
    }

    const deadlocked = [];
    const seenPairs = {};
    for (const key of Object.keys(chainPairOf)) {
      const partnerKey = chainPairOf[key];
      const pairKey = [key, partnerKey].sort().join('|');
      if (seenPairs[pairKey]) continue;
      seenPairs[pairKey] = true;
      if (!S[key] || !S[partnerKey]) {
        const [r1,c1] = key.split(',').map(Number);
        const [r2,c2] = partnerKey.split(',').map(Number);
        deadlocked.push({ r1, c1, r2, c2, reach1: !!S[key], reach2: !!S[partnerKey] });
      }
    }
    return { ok: deadlocked.length === 0, deadlocked };
  });
}

// ==================== 链条死锁检测 ====================
/**
 * 检查所有链条对是否存在死锁
 * 死锁定义：链条对 (A, B) 中，B 只能通过 A 被移走后才能激活，
 * 而 A 又必须等 B 已激活才能拿取 → 互相等待，关卡无解
 *
 * ★ 2026-04-01 田耿报告第8关左下角链条死锁，补充此检测
 */
async function checkChainDeadlock(page) {
  return page.evaluate(() => {
    const { elementZoneManager } = window.app;
    const spools = elementZoneManager.getData();
    const rows = spools.length;
    if (rows === 0) return { deadlocked: false };
    const cols = spools[0].length;

    function hasType(types, t) {
      if (Array.isArray(types)) return types.includes(t);
      return types === t;
    }
    function isBlocking(r, c) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return true;
      const cell = spools[r] && spools[r][c];
      if (!cell || cell.id === -1 || cell.id === 0) return true;
      const t = Array.isArray(cell.type) ? cell.type : [cell.type];
      return t.some(x => x >= 11 && x <= 14);
    }

    const paired = new Set();
    const chainPairs = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = spools[r] && spools[r][c];
        const key = r + ',' + c;
        if (!cell || !hasType(cell.type, 5) || paired.has(key)) continue;
        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const nb = spools[nr] && spools[nr][nc];
          const nKey = nr + ',' + nc;
          if (nb && hasType(nb.type, 5) && !paired.has(nKey)) {
            chainPairs.push({ r1: r, c1: c, r2: nr, c2: nc });
            paired.add(key); paired.add(nKey); break;
          }
        }
      }
    }

    function canActivateWithout(tR, tC, exR, exC) {
      const visited = new Set();
      const queue = [];
      for (let c0 = 0; c0 < cols; c0++) {
        if (0 === exR && c0 === exC) continue;
        if (isBlocking(0, c0)) continue;
        const k = '0,' + c0;
        if (!visited.has(k)) { visited.add(k); queue.push([0, c0]); }
      }
      let head = 0;
      while (head < queue.length) {
        const [r, c] = queue[head++];
        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr === exR && nc === exC) continue;
          const nk = nr + ',' + nc;
          if (visited.has(nk)) continue;
          if (nr === tR && nc === tC) return true;
          if (isBlocking(nr, nc)) continue;
          visited.add(nk); queue.push([nr, nc]);
        }
      }
      return false;
    }

    for (const p of chainPairs) {
      const b_ok = canActivateWithout(p.r2, p.c2, p.r1, p.c1);
      const a_ok = canActivateWithout(p.r1, p.c1, p.r2, p.c2);
      if (!b_ok || !a_ok) return { deadlocked: true, pair: p };
    }
    return { deadlocked: false };
  });
}

// ==================== 验证 ====================
async function validateInPage(page, totalGroups) {
  return page.evaluate((tg) => {
    const { targetZoneManager, elementZoneManager } = window.app;
    const v = new YarnLevel.LevelValidator(
      targetZoneManager.getData(),
      elementZoneManager.getData()
    );
    const r = v.validate();
    // 计算已清除比例：1 - 剩余目标格 / 全部目标格
    const totalTargetCells = tg * 3;
    const remaining = (r.details && r.details.remainingTarget >= 0)
      ? r.details.remainingTarget
      : totalTargetCells;
    r.clearRatio = (totalTargetCells - remaining) / totalTargetCells;
    return r;
  }, totalGroups);
}

/**
 * @param {object} page
 * @param {number|null} [toprowOverride]  不为 null 时强制覆盖 toprow 值（如 4 行棋盘固定为 6）
 */
async function getLevelJSON(page, toprowOverride = null) {
  return page.evaluate((override) => {
    const { targetZoneManager, elementZoneManager } = window.app;
    return YarnLevel.serializeLevelJSON({
      toprow: (override != null) ? override : targetZoneManager.getBaseRowCount(),
      blocks: targetZoneManager.getData(),
      maprow: elementZoneManager.getRowCount(),
      mapcol: elementZoneManager.getColCount(),
      spools: elementZoneManager.getData(),
    });
  }, toprowOverride);
}

// ==================== 核心生成流程 ====================
/**
 * @param {Object} page       Playwright page
 * @param {Object} opts
 *   - targetWidth        {number}  目标区宽度（列数），默认 4
 *   - boardRows          {number}  棋盘行数（不传则自动计算）
 *   - boardCols          {number}  棋盘列数（不传则自动计算）
 *   - boardSize          {number}  正方形棋盘边长（boardRows=boardCols=boardSize，优先级低于分别指定）
 *   - colorSequence      {string}  颜色序列，逗号分隔（不传则按色系随机）
 *   - colorRange         {number}  从序列中取多少种颜色（extraColorTypes）
 *   - extraColorGroups   {number}  颜色组数（建议 30-60）
 *   - blackBlockRatio    {number}  黑块占比（默认 0.12）
 *   - maxAttempts        {number}  最大重试次数，默认 12
 *   - passThresholdRatio {number}  通过阈值（默认 0.3，即 30% 线轴完成即视为成功）
 */
async function processLevel(page, opts = {}) {
  const {
    targetWidth        = 4,
    boardRows:         boardRowsOpt,
    boardCols:         boardColsOpt,
    boardSize:         boardSizeOpt,
    colorSequence:     colorSequenceRaw,
    colorRange:        colorRangeRaw,
    extraColorGroups:  extraColorGroupsRaw,
    blackBlockRatio    = 0.12,
    maxPipeDepth       = 3,    // 管道最大深度（每管道最多 3 层）
    maxPipeCount       = 4,    // 管道最多总数
    maxAttempts        = 12,
    passThresholdRatio = 0.3,
    label              = 'level',
  } = opts;

  // ---- 颜色参数（未指定时按色系随机，确保排除靠色）----
  const random = randomColorParams(extraColorGroupsRaw);
  const colorSequence    = colorSequenceRaw   ?? random.colorSequence;
  const colorRange       = colorRangeRaw      ?? random.colorRange;
  const extraColorGroups = extraColorGroupsRaw ?? random.extraColorGroups;

  // ---- 加载页面 ----
  await page.goto('file://' + TOOL_PATH);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);

  await page.fill('#defaultColorId', String(DEFAULT_COLOR_ID));

  // ---- 初始化空目标区（宽度 = targetWidth，1 行全 0 占位）----
  await page.evaluate(({ width }) => {
    const emptyRow = Array(width).fill(0);
    window.app.targetZoneManager.loadRawData([emptyRow], 0);
    window.app.targetZoneManager.setBaseRowCount(1);
    window.app.targetZoneUI.render();
  }, { width: targetWidth });
  await page.waitForTimeout(200);

  // ---- 补充生成目标区 ----
  await page.fill('#colorSequence',    String(colorSequence));
  await page.fill('#extraColorTypes',  String(colorRange));
  await page.fill('#extraColorGroups', String(extraColorGroups));
  await page.click('#generateSupplementBtn');
  await page.waitForTimeout(400);

  // 去掉初始化时的空占位行（全0行）
  await page.evaluate(() => {
    const mgr = window.app.targetZoneManager;
    mgr._blocks = mgr._blocks.filter(row => row.some(cell => cell.id > 0));
    mgr._baseRowCount = mgr._blocks.length;
    window.app.targetZoneUI.render();
  });
  await page.waitForTimeout(100);

  // 读取总颜色组数
  const totalGroupsText = await page.textContent('#targetGroupCount');
  const totalGroups = parseInt((totalGroupsText || '').trim(), 10);
  if (!totalGroups) return { ok: false, label, failReason: 'no_groups' };

  // ---- 棋盘尺寸（优先使用显式指定，否则综合管道约束自动计算）----
  let rows, cols;
  if (boardRowsOpt && boardColsOpt) {
    rows = boardRowsOpt;
    cols = boardColsOpt;
  } else if (boardSizeOpt) {
    rows = boardSizeOpt;
    cols = boardSizeOpt;
  } else {
    ({ rows, cols } = calculateBoardSize(totalGroups, { maxPipeCount, maxPipeDepth, blackBlockRatio }));
  }
  const totalCells = rows * cols;

  // 黑块数量：最多占 blackBlockRatio
  // 只要有效格 >= totalGroups * 0.5，超出部分由管道承接（管道可堆叠多组）
  const minEffectiveCells = Math.ceil(totalGroups * 0.5);
  const maxBlackSafe      = Math.max(0, totalCells - minEffectiveCells);
  const blackCount        = Math.min(Math.floor(totalCells * blackBlockRatio), maxBlackSafe);

  // 冰块/问号/链条（固定值）
  const iceCount      = Math.floor(totalCells * 0.1);
  const questionCount = Math.floor(totalCells * 0.15);
  const chainCount    = 1 + Math.floor((totalCells - blackCount) / 25);

  let bestResult   = null;  // 满足所有约束（含 row0 无问号）且清除率最高
  let fallbackResult = null; // 不管 row0 约束的最高清除率（最坏情况兜底）
  let pipes = [];
  let blacks = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 生成新棋盘（清空上次所有状态）
    await page.fill('#elementRows', String(rows));
    await page.fill('#elementCols', String(cols));
    await page.click('#generateBoardBtn');
    await page.waitForTimeout(400);

    // ---- 第一步：先算初步管道位置（不含黑块），用于可达性参考 ----
    const roughPipeCount = calculatePipeCount(totalGroups, totalCells, maxPipeDepth, maxPipeCount);
    const roughPipes     = buildSymmetricPipes(rows, cols, roughPipeCount, new Set());
    const roughPipeSet   = new Set(roughPipes.map(p => `${p.row},${p.col}`));

    // ---- 第二步：放置黑块（以管道位置为"封死墙"做顶部可达性校验）----
    blacks = buildBlackBlocksAccessible(rows, cols, blackCount, roughPipeSet);
    const blackSet = new Set(blacks.map(b => `${b.row},${b.col}`));
    for (const b of blacks) {
      await page.evaluate(({ r, c }) => {
        window.app.elementZoneManager.setCellAsBlackBlock(r, c);
      }, { r: b.row, c: b.col });
    }

    // ---- 第三步：重算管道（避开黑块，基于有效格数，限制总数+深度）----
    const effectiveCells = totalCells - blacks.length;
    const pipeCount      = calculatePipeCount(totalGroups, effectiveCells, maxPipeDepth, maxPipeCount);
    pipes = buildSymmetricPipes(rows, cols, pipeCount, blackSet);
    for (const p of pipes) {
      await page.evaluate(({ r, c, t }) => {
        window.app.elementZoneManager.setCellAsPipe(r, c, t);
      }, { r: p.row, c: p.col, t: p.type });
    }
    if (pipes.length || blacks.length) {
      await page.evaluate(() => window.app.elementZoneUI.render());
      await page.waitForTimeout(200);
    }

    // ---- 生成元素 ----
    await page.fill('#iceCount',             String(iceCount));
    await page.fill('#elementQuestionCount', String(questionCount));
    await page.fill('#chainCount',           String(chainCount));
    await page.click('#generateElementsBtn');
    await page.waitForTimeout(700);

    // ---- 修复第一行问号（直接操作 _spools，把 row0 的问号移到非 row0 的普通格）----
    await page.evaluate(() => {
      const mgr    = window.app.elementZoneManager;
      const spools = mgr._spools;
      if (!spools || !spools[0]) return;
      const totalRows = spools.length;
      const totalCols = spools[0].length;

      const isSpecialCell = (cell) => {
        if (!cell || cell.id === -1) return true;
        const t = Array.isArray(cell.type) ? cell.type : [cell.type];
        return t.some(x => x >= 4 && x !== 0); // 4=冰, 5=链, 6=问号, 11-14=管道
      };

      for (let c = 0; c < totalCols; c++) {
        const cell0 = spools[0][c];
        const t0 = Array.isArray(cell0.type) ? cell0.type : [cell0.type];
        if (!t0.includes(6)) continue;

        // 找最后一行往上找可以放问号的普通格
        for (let r = totalRows - 1; r >= 1; r--) {
          const target = spools[r][c];
          if (isSpecialCell(target)) continue;
          // 目标格加 type=6
          target.type = 6;
          // row0 清除问号
          mgr.clearSpecialElement(0, c);
          break;
        }
      }
      window.app.elementZoneUI.render();
    });

    // ---- 链条封死检查（3面及以上为墙则重试）----
    // 墙 = 左/右/下边缘 + 黑块(id=-1) + 管道(type 11-14)；上边缘不算墙
    const chainTrapCheck = await page.evaluate(({ r: rows2, c: cols2 }) => {
      const data = window.app.elementZoneManager.getData();
      function isWall(r, c) {
        if (c < 0 || c >= cols2) return true;    // 左/右边缘
        if (r >= rows2)          return true;    // 下边缘
        if (r < 0)               return false;   // 上边缘开放
        const cell = data[r] && data[r][c];
        if (!cell)               return true;
        if (cell.id === -1)      return true;    // 黑块
        const t = Array.isArray(cell.type) ? cell.type : [cell.type];
        return t.some(x => x >= 11 && x <= 14);  // 管道
      }
      for (let r = 0; r < data.length; r++) {
        for (let c = 0; c < (data[r] ? data[r].length : 0); c++) {
          const cell = data[r][c];
          const types = Array.isArray(cell.type) ? cell.type : [cell.type];
          if (!types.includes(5)) continue;       // 只看链条格(type=5)
          const walls = [isWall(r-1,c), isWall(r+1,c), isWall(r,c-1), isWall(r,c+1)]
                          .filter(Boolean).length;
          if (walls >= 3) return { trapped: true, r, c, walls };
        }
      }
      return { trapped: false };
    }, { r: rows, c: cols });

    if (chainTrapCheck.trapped) continue; // 链条被封死，重试

    // ---- 孤立格子检查（围棋提子规则：BFS 从四面扩散，管道+黑块+墙构成封闭区域即判定提走）----
    const isolationCheck = await page.evaluate(({ rows: rows2, cols: cols2 }) => {
      const data = window.app.elementZoneManager.getData();
      function isOpen(r, c) {
        if (r < 0 || r >= rows2 || c < 0 || c >= cols2) return true; // 棋盘外 = 开放
        const cell = data[r] && data[r][c];
        if (!cell || cell.id <= 0) return false; // 黑块
        const t = Array.isArray(cell.type) ? cell.type : [cell.type];
        if (t.some(x => x >= 11 && x <= 14)) return false; // 管道
        return true;
      }
      // 初始化：棋盘四周虚拟格全部入队
      const visited = new Set();
      const queue = [];
      for (let r = -1; r <= rows2; r++) {
        for (let c = -1; c <= cols2; c++) {
          if (r > -1 && r < rows2 && c > -1 && c < cols2) continue;
          const key = r + ',' + c;
          visited.add(key);
          queue.push([r, c]);
        }
      }
      const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
      let qi = 0;
      while (qi < queue.length) {
        const [r, c] = queue[qi++];
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (nr < -1 || nr > rows2 || nc < -1 || nc > cols2) continue;
          const key = nr + ',' + nc;
          if (visited.has(key)) continue;
          if (!isOpen(nr, nc)) continue;
          visited.add(key);
          queue.push([nr, nc]);
        }
      }
      // 找出未到达的普通元素格
      const isolated = [];
      for (let r = 0; r < rows2; r++) {
        for (let c = 0; c < cols2; c++) {
          const cell = data[r] && data[r][c];
          if (!cell || cell.id <= 0) continue;
          const t = Array.isArray(cell.type) ? cell.type : [cell.type];
          if (t.some(x => x >= 11 && x <= 14)) continue; // 管道跳过
          if (!visited.has(r + ',' + c)) isolated.push({ r, c, id: cell.id });
        }
      }
      return { isolated };
    }, { rows, cols });

    if (isolationCheck.isolated.length > 0) {
      const cells = isolationCheck.isolated.map(x => `(${x.r},${x.c})`).join(' ');
      console.log(`  ⚠️  [孤立格子] ${isolationCheck.isolated.length} 个格子封死：${cells}，重试...`);
      continue;  // 有孤立格子，直接重试
    }

    // ---- 链条死锁检测（2026-04-01）----
    const chainDeadlock = await checkChainDeadlock(page);
    if (chainDeadlock.deadlocked) {
      const p = chainDeadlock.pair;
      console.log(`  ⚠️  [链条死锁] 链条对(${p.r1},${p.c1})<->(${p.r2},${p.c2}) 死锁，重试...`);
      continue;
    }

    // ---- 验证 ----
    const result = await validateInPage(page, totalGroups);
    const stepSet   = new Set((result.log || []).map(e => e.step));
    const steps     = stepSet.size;
    // 用"清除比例"判断达标（更准确反映"挪出线轴"进度）
    const clearRatio = result.clearRatio ?? 0;
    const passed  = result.success || clearRatio >= passThresholdRatio;

    // 目标区 4 或 5 列时 toprow 固定 6（在每次尝试时就确定）
    const toprowOverride = (targetWidth === 4 || targetWidth === 5) ? 6 : null;
    // 立即截取本次 JSON（保证保存的内容和本次验证结果严格对应）
    const attemptJSON = await getLevelJSON(page, toprowOverride);
    const attempt_record = { result, steps, clearRatio, passed, pipes: [...pipes], blacks: [...blacks], levelJSON: attemptJSON };
    // 满足所有约束（含 row0 无问号）中取最佳
    if (!bestResult || clearRatio > bestResult.clearRatio) {
      bestResult = attempt_record;
    }
    // 不限 row0 的全局最佳（兜底用）
    if (!fallbackResult || clearRatio > fallbackResult.clearRatio) {
      fallbackResult = attempt_record;
    }
    if (passed) break;
  }

  // bestResult 优先（满足 row0 无问号约束）；极端情况下退到 fallbackResult
  const _chosen  = bestResult ?? fallbackResult;
  const toprowOverride = (targetWidth === 4 || targetWidth === 5) ? 6 : null;
  const levelJSON = _chosen?.levelJSON ?? await getLevelJSON(page, toprowOverride);
  const passed = _chosen?.passed ?? false;

  const effectiveCells = totalCells - (_chosen?.blacks?.length ?? 0);
  const pipeCount      = _chosen?.pipes?.length ?? 0;

  return {
    ok: true,
    passed,
    label,
    levelJSON,
    stats: {
      totalGroups,
      targetWidth,
      rows, cols,
      blackCount:  blacks.length,
      effectiveCells,
      pipeCount,
      pipeDepth:   +calcPipeDepth(totalGroups, effectiveCells, pipeCount).toFixed(2),
      defaultColorId: DEFAULT_COLOR_ID,
      colorSequence,
      colorRange,
      extraColorGroups,
      iceCount, questionCount, chainCount,
      validationSteps:     _chosen?.steps ?? 0,
      validationClearPct:  Math.round((_chosen?.clearRatio ?? 0) * 100),
      validationSuccess:   _chosen?.result?.success ?? false,
    },
  };
}

// ==================== 公开 API ====================

/**
 * 生成单个关卡
 * @param {Object} opts      生成参数（见 processLevel）
 * @param {string} outputDir 输出目录
 */
async function generateLevel(opts = {}, outputDir) {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  try {
    const result = await processLevel(page, opts);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const baseName = opts.outputName || result.label || 'level';
    const outName  = (result.passed ? baseName : '🔴_' + baseName) + '.txt';
    const outPath  = path.join(outputDir, outName);
    fs.writeFileSync(outPath, levelJSONToTXT(result.levelJSON), 'utf8');
    return { ok: true, passed: result.passed, outputPath: outPath, stats: result.stats };
  } finally {
    await browser.close();
  }
}

/**
 * 批量生成关卡（共用 page，高效）
 * @param {number} count         要生成的数量
 * @param {Object} opts          生成参数
 * @param {string} outputDir     输出目录
 * @param {Object} batchOpts
 *   - failedLogPath  {string}  不达标记录文件路径（可选）
 *   - startIndex     {number}  输出编号起始值（默认 1）
 *   - appendFailedLog {boolean} 是否追加写入 failedLog（默认 false）
 */
async function generateLevels(count, opts = {}, outputDir, batchOpts = {}) {
  const {
    failedLogPath,
    startIndex = 1,
    appendFailedLog = false,
  } = batchOpts;
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();

  const generated = [];
  const subpar    = [];

  for (let idx = 1; idx <= count; idx++) {
    const serial = startIndex + idx - 1;
    try {
      // 如果 opts.paletteList 存在，按顺序为每关分配配色（覆盖 colorSequence/colorRange）
      let levelOpts = { ...opts, label: `level_${String(serial).padStart(3, '0')}` };
      if (opts.paletteList && opts.paletteList.length > 0) {
        const palette = opts.paletteList[(serial - 1) % opts.paletteList.length];
        levelOpts.colorSequence = palette.join(',');
        levelOpts.colorRange    = palette.length;
      }
      const result = await processLevel(page, levelOpts);

      const baseName = `${String(serial).padStart(3, '0')}_level`;
      const outName  = result.passed ? `${baseName}.txt` : `${baseName}_🔴.txt`;
      const outPath  = path.join(outputDir, outName);
      fs.writeFileSync(outPath, levelJSONToTXT(result.levelJSON), 'utf8');

      const s = result.stats;
      if (result.passed) {
        generated.push({ outputPath: outPath, stats: s });
        console.log(`✅ [${serial}/${startIndex + count - 1}] ${outName} | w${s.targetWidth} | ${s.rows}×${s.cols} | ${s.totalGroups}组 | 黑块:${s.blackCount} | 管道:${s.pipeCount} | 清除:${s.validationClearPct}%`);
      } else {
        subpar.push(outName);
        console.log(`🔴 [${serial}/${startIndex + count - 1}] ${outName} | 清除:${s.validationClearPct}%（不达标，文件已保存）`);
      }
    } catch (err) {
      const fallback = `${String(serial).padStart(3, '0')}_level_❌.txt`;
      subpar.push(fallback);
      console.error(`❌ [${serial}/${startIndex + count - 1}] 出错: ${err.message}`);
    }
  }

  await browser.close();

  if (failedLogPath && subpar.length > 0) {
    const content = subpar.join('\n') + '\n';
    if (appendFailedLog && fs.existsSync(failedLogPath)) {
      fs.appendFileSync(failedLogPath, content, 'utf8');
    } else {
      fs.writeFileSync(failedLogPath, content, 'utf8');
    }
  }

  return { generated, subpar };
}

module.exports = {
  COLOR_FAMILIES,
  calculateBoardSize,
  calculatePipeCount,
  calcPipeDepth,
  buildSymmetricPipes,
  buildBlackBlocks,
  buildBlackBlocksAccessible,
  isConnected,
  isAccessibleFromTop,
  randomColorParams,
  generateLevel,
  generateLevels,
};
