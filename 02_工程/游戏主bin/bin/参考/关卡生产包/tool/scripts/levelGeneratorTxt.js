/**
 * levelGeneratorTxt.js
 * 毛线关卡生成模块 —— TXT 格式输入版
 *
 * 与 levelGenerator.js 的区别：
 *   1. 移除裁剪多余空位逻辑（trimTiledBgCols）
 *   2. 移除更换背景颜色逻辑（applyEdgeBasedBackground / selectBgColor）
 *   3. 导入按钮从 #tiledFileInput 改为 #txtFileInput
 *
 * 用法：
 *   const gen = require('./levelGeneratorTxt');
 *   const result = await gen.generateLevel('/path/to/level.txt', '/output/dir');
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const { levelJSONToTXT } = require('./levelTxtFormat');

const TOOL_PATH       = path.resolve(__dirname, '../dist_new/index.html');
const DEFAULT_COLOR_ID = 32;

// ==================== 棋盘尺寸 ====================
function calculateBoardSize(totalGroups, maxRows, maxCols) {
  const MAX_R = maxRows || 9;
  const MAX_C = maxCols || 9;
  const target = totalGroups * 0.8;
  let minDiff = Infinity;
  for (let r = 1; r <= MAX_R; r++)
    for (let c = 1; c <= MAX_C; c++)
      minDiff = Math.min(minDiff, Math.abs(r * c - target));

  const tolerance = Math.max(2, target * 0.05);

  let bestRows = 1, bestCols = 1, bestDiff = Infinity;
  for (let r = 1; r <= MAX_R; r++) {
    for (let c = 1; c <= MAX_C; c++) {
      const diff = Math.abs(r * c - target);
      if (diff > minDiff + tolerance) continue;
      if (diff < bestDiff) {
        bestRows = r;
        bestCols = c;
        bestDiff = diff;
      }
    }
  }
  return { rows: bestRows, cols: bestCols };
}

// ==================== 管道数量 ====================
function calculatePipeCount(totalGroups, rows, cols) {
  const R = totalGroups - rows * cols;
  if (R <= 0) return 0;
  return Math.ceil(R / 5);
}

function calcPipeDepth(totalGroups, rows, cols, pipeCount) {
  if (pipeCount === 0) return 0;
  return (totalGroups - (rows * cols - pipeCount)) / pipeCount;
}

// ==================== 管道布局 ====================
const PIPE_STRATEGIES = ['symmetric', 'corners', 'hbands', 'vbands', 'zigzag'];
const PIPE_EXIT_OFFSET = { 11: [-1,0], 12: [0,1], 13: [1,0], 14: [0,-1] };

// ==================== 互斥颜色组（2026-04-03 田耿最终版）====================
// 同一组内颜色不得同时出现在同一关卡（txt 原色 + 补充色均须遵守）
const COLOR_FAMILIES = [
  [1,  4,  6],            // 组1：红 / 藏青 / 橄榄绿
  [20, 21, 23],           // 组2：绿系
  [3,  5,  27],           // 组3：浅粉 / 浅橙
  [31, 32],               // 组4：米白系
  [33, 15, 16, 18],       // 组5：蓝灰系
];

function buildSymmetricPipes(rows, cols, pipeCount, blackSet) {
  if (pipeCount === 0) return [];
  const strategy = PIPE_STRATEGIES[Math.floor(Math.random() * PIPE_STRATEGIES.length)];
  return buildPipes(strategy, rows, cols, pipeCount, blackSet);
}

function buildPipes(strategy, rows, cols, pipeCount, blackSet) {
  const bs = blackSet || new Set();
  const maxPerRow = Math.floor(cols * 0.7);
  const pipePosSet = new Set();
  const targetSet  = new Set();
  const rowCount   = {};
  const colCount   = {};
  const pipes      = [];

  function canPlacePipeAt(r, c, type, dr, dc) {
    const tr = r + dr, tc = c + dc;
    const pk = `${r},${c}`;
    const tk = `${tr},${tc}`;
    if (pipePosSet.has(pk) || pipePosSet.has(tk)) return false;
    if (targetSet.has(tk) || targetSet.has(pk)) return false;
    if ((rowCount[r] || 0) >= maxPerRow) return false;
    if ((colCount[c] || 0) >= rows - 1) return false;
    return true;
  }

  function tryAdd(r, c, type, dr, dc) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
    if (bs.has(`${r},${c}`)) return false;
    const tr = r + dr, tc = c + dc;
    if (tr < 0 || tr >= rows || tc < 0 || tc >= cols) return false;
    if (bs.has(`${tr},${tc}`)) return false;
    if (!canPlacePipeAt(r, c, type, dr, dc)) return false;

    const DIRS = [[-1,0],[0,1],[1,0],[0,-1]];
    let hasEntry = false;
    for (const [nr, nc] of DIRS) {
      if (nr === dr && nc === dc) continue;
      const er = r + nr, ec = c + nc;
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
      if (!bs.has(`${er},${ec}`)) { hasEntry = true; break; }
    }
    if (!hasEntry) {
      for (const [nr, nc] of DIRS) {
        if (nr === dr && nc === dc) continue;
        const er = r + nr, ec = c + nc;
        if (er < 0 || er >= rows || ec < 0 || ec >= cols) { hasEntry = true; break; }
      }
    }
    if (!hasEntry) return false;

    let exitHasExit = false;
    for (const [nr, nc] of DIRS) {
      if (nr === -dr && nc === -dc) continue;
      const er = tr + nr, ec = tc + nc;
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) { exitHasExit = true; break; }
      if (!bs.has(`${er},${ec}`)) { exitHasExit = true; break; }
    }
    if (!exitHasExit) return false;

    const pk = r+','+c, tk = tr+','+tc;
    pipes.push({ row: r, col: c, type });
    pipePosSet.add(pk);
    targetSet.add(tk);
    rowCount[r] = (rowCount[r] || 0) + 1;
    colCount[c] = (colCount[c] || 0) + 1;
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
    placeAlongRow(Math.max(1, Math.floor(rows*0.3)),    spread(2, cols-3, n0), 11, -1,  0);
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

// ==================== 颜色序列参数 ====================
/**
 * 随机生成颜色序列参数（在点击补充生成前填入）
 * @param {number[]} txtColors - txt 文件已有颜色 ID 列表
 *
 * 规则：
 * - 总补充颜色 8-9 种
 * - 其中 4 种可从 txtColors 中选取（重叠）
 * - 剩余 4-5 种从未在 txtColors 中出现的颜色选取
 * - 所有选取颜色满足互斥约束（同一 COLOR_FAMILIES 组最多选 1 种）
 * - extraColorGroups: 30-40 组
 */
function generateColorSequenceParams(txtColors = []) {
  const totalCount = 8 + Math.floor(Math.random() * 2); // 8 或 9

  // Fisher-Yates shuffle helper
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 检测 txtColors 是否自身有互斥冲突（仅警告，无法修复）
  const txtConflicts = [];
  for (const fam of COLOR_FAMILIES) {
    const hits = txtColors.filter(c => fam.includes(c));
    if (hits.length >= 2) txtConflicts.push(hits);
  }
  if (txtConflicts.length > 0) {
    console.warn(`⚠️  txt 原有颜色内部互斥冲突: ${JSON.stringify(txtConflicts)}`);
  }

  // 方案B：所有 txtColors 所在的互斥组全部锁定为"已占用"
  // 补充颜色不得与任何 txtColor 所在互斥组冲突
  const txtExcluded = new Set();
  for (const c of txtColors) {
    for (const fam of COLOR_FAMILIES) {
      if (fam.includes(c)) fam.forEach(x => txtExcluded.add(x));
    }
  }

  // Step1：从 txtColors 中选最多 4 种作为"强化色"（同 ID 重复使用，不引入新家族）
  //        内部也要满足互斥（txt 自身冲突时只取其一）
  const overlapPool = shuffle(txtColors);
  const overlapColors = [];
  const overlapExcluded = new Set();
  for (const c of overlapPool) {
    if (overlapExcluded.has(c)) continue;
    overlapColors.push(c);
    for (const fam of COLOR_FAMILIES) {
      if (fam.includes(c)) fam.forEach(x => overlapExcluded.add(x));
    }
    if (overlapColors.length >= Math.min(txtColors.length, totalCount - 1)) break;
  }

  // Step2：从"未被 txtColors 家族占用"且"未被 overlapColors 家族占用"的颜色中选新色
  const newExcluded = new Set([...txtExcluded, ...overlapExcluded]);
  const newPool = shuffle(
    Array.from({ length: 34 }, (_, i) => i + 1).filter(c => !newExcluded.has(c))
  );
  const newColors = [];
  const newPickExcluded = new Set(newExcluded);
  for (const c of newPool) {
    if (newPickExcluded.has(c)) continue;
    newColors.push(c);
    for (const fam of COLOR_FAMILIES) {
      if (fam.includes(c)) fam.forEach(x => newPickExcluded.add(x));
    }
    if (newColors.length >= totalCount - overlapColors.length) break;
  }

  const sequence    = shuffle([...overlapColors, ...newColors]);
  const extraGroups = 30 + Math.floor(Math.random() * 11); // 30-40

  return {
    colorSequence:    sequence.join(','),
    extraColorTypes:  sequence.length,
    extraColorGroups: extraGroups,
  };
}

// ==================== 从文件名或文件头提取颜色 ID ====================
/**
 * 支持三种格式：
 * 1. 旧格式文件名：pattern_001_3_5_11_20_29_30_32_33_34.txt（颜色ID在文件名中）
 * 2. 标准新格式文件头：含 "ID X: #XXXXXX" 行（颜色ID在文件内容中）
 * 3. 空格分隔像素矩阵格式：首行为"像素矩阵"，后续为空格分隔整数（2026-04-03 田耿互赤色替换格式）
 */
function extractTxtColors(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // 格式3：空格分隔像素矩阵（首行为"像素矩阵"，后续为空格分隔整数）
    const firstNonEmpty = lines.find(l => l.trim().length > 0);
    if (firstNonEmpty && firstNonEmpty.trim() === '像素矩阵') {
      const ids = new Set();
      let inMatrix = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '像素矩阵') { inMatrix = true; continue; }
        if (!inMatrix || !trimmed || !/^\d/.test(trimmed)) continue;
        for (const token of trimmed.split(/\s+/)) {
          const id = parseInt(token);
          if (id > 0 && id <= 34) ids.add(id);
        }
      }
      if (ids.size >= 1) return [...ids];
    }

    // 格式2：标准新格式文件头（ID X: #XXXXXX）
    const ids = [];
    for (const line of lines) {
      const m = line.match(/^ID\s+(\d+):/);
      if (m) {
        const id = parseInt(m[1]);
        if (id > 0 && id <= 34) ids.push(id);
      }
      if (line.startsWith('像素矩阵') || /^\d+,/.test(line)) break;
    }
    if (ids.length >= 2) return ids;
  } catch (e) {
    // 文件读取失败，降级到文件名解析
  }
  // 降级：旧格式文件名解析
  const base = path.basename(filePath, '.txt');
  const parts = base.split('_').slice(2).map(Number).filter(n => n > 0 && n <= 34);
  return parts;
}

// ==================== 黑块生成（带可达性校验）====================
function hasNoFullPipeLine(rows, cols, pipeSet) {
  for (let r = 0; r < rows; r++) {
    let full = true;
    for (let c = 0; c < cols; c++) {
      if (!pipeSet.has(`${r},${c}`)) { full = false; break; }
    }
    if (full) return false;
  }
  for (let c = 0; c < cols; c++) {
    let full = true;
    for (let r = 0; r < rows; r++) {
      if (!pipeSet.has(`${r},${c}`)) { full = false; break; }
    }
    if (full) return false;
  }
  return true;
}

function hasPipeRunLimit(rows, cols, pipeSet, maxRun = 3) {
  for (let r = 0; r < rows; r++) {
    let run = 0;
    for (let c = 0; c < cols; c++) {
      if (pipeSet.has(`${r},${c}`)) {
        run++;
        if (run > maxRun) return false;
      } else {
        run = 0;
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    let run = 0;
    for (let r = 0; r < rows; r++) {
      if (pipeSet.has(`${r},${c}`)) {
        run++;
        if (run > maxRun) return false;
      } else {
        run = 0;
      }
    }
  }
  return true;
}

/**
 * 从棋盘顶部 BFS，确认所有非黑块、非管道格均可达
 */
function isAccessibleFromTop(rows, cols, blackSet, pipeSet) {
  const blocked = key => blackSet.has(key) || pipeSet.has(key);
  const visited = new Set();
  const queue   = [];
  for (let c = 0; c < cols; c++) {
    const key = `-1,${c}`;
    visited.add(key);
    queue.push([-1, c]);
  }
  let head = 0;
  while (head < queue.length) {
    const [r, c] = queue[head++];
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (nc < 0 || nc >= cols) continue;
      if (nr < -1 || nr >= rows) continue;
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      if (nr >= 0 && blocked(key)) continue;
      visited.add(key);
      queue.push([nr, nc]);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r},${c}`;
      if (!blocked(key) && !visited.has(key)) return false;
    }
  }
  return true;
}

/**
 * 生成黑块位置列表（随机放置，每放一个都做可达性校验）
 * @param {number} rows
 * @param {number} cols
 * @param {number} targetCount  - 目标黑块数量
 * @param {Set}    pipeSet      - 管道占位 "r,c"
 * @returns {Array<{row,col}>}
 */
function generateBlackBlocks(rows, cols, targetCount, pipeSet) {
  const blackSet = new Set();
  // 候选：非管道格 + 非第一行（row=0 禁放黑块）
  const candidates = [];
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r},${c}`;
      if (!pipeSet.has(key)) candidates.push(key);
    }
  }
  // Fisher-Yates shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const key of candidates) {
    if (blackSet.size >= targetCount) break;
    blackSet.add(key);
    if (!isAccessibleFromTop(rows, cols, blackSet, pipeSet)) {
      blackSet.delete(key); // 会封死格子，回退
    }
  }
  return [...blackSet].map(k => {
    const [r, c] = k.split(',').map(Number);
    return { row: r, col: c };
  });
}

// ==================== 围棋提子：封闭区域检测 ====================
/**
 * BFS 从第一行（row=0）所有可走格出发向内扩散。
 * 凡是普通元素格（id>0 且非管道）未被 BFS 到达 = 被管道+黑块+墙围死 → 重新生成。
 *
 * ⚠️ 修复④（2026-03-20）：原逻辑从四周虚拟边界扩散，会绕过侧边/底部进入角落死区，
 *   导致漏检"管道+黑块+墙"围成的边角封闭区域。
 *   正确逻辑：只从 row=0 出发，模拟玩家从棋盘顶部进入的实际路径。
 */
async function checkNoTrappedGroups(page) {
  return page.evaluate(() => {
    const { elementZoneManager } = window.app;
    const spools = elementZoneManager.getData();
    const rows = spools.length;
    if (rows === 0) return { ok: true, trapped: [] };
    const cols = spools[0].length;

    function isWalkable(r, c) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return false; // 越界不可走
      const cell = spools[r][c];
      if (!cell || cell.id === -1) return false;                   // 黑块（id=-1）
      if (cell.id === 0 && !elementZoneManager.isPipeElement(r, c)) return false; // 黑块（id=0,type=0）
      if (elementZoneManager.isPipeElement(r, c)) return false;    // 管道
      return true;                                                  // 普通元素格
    }

    // 从 row=0 所有可走格出发
    const visited = new Set();
    const queue = [];
    for (let c = 0; c < cols; c++) {
      if (isWalkable(0, c)) {
        const key = '0,' + c;
        visited.add(key);
        queue.push([0, c]);
      }
    }
    const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
    let head = 0;
    while (head < queue.length) {
      const [r, c] = queue[head++];
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        const key = nr + ',' + nc;
        if (visited.has(key)) continue;
        if (!isWalkable(nr, nc)) continue;
        visited.add(key);
        queue.push([nr, nc]);
      }
    }

    // 找出所有未被到达的普通元素格
    const trapped = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isWalkable(r, c)) continue;
        if (!visited.has(r + ',' + c)) {
          const cell = spools[r][c];
          trapped.push({ row: r, col: c, id: cell.id });
        }
      }
    }
    return { ok: trapped.length === 0, trapped };
  });
}

// ==================== 链条死锁检测 ====================
/**
 * 检查所有链条对是否存在死锁
 * 死锁定义：链条对 (A, B) 中，B 只能通过 A 被移走后才能激活，
 * 而 A 又必须等 B 已激活才能拿取 → 互相等待，关卡无解
 *
 * 检测方法：对每个链条对，分别做 BFS：
 *   - 从 row-0 出发，排除 A，看能否激活 B（即到达 B 的某个邻格）
 *   - 从 row-0 出发，排除 B，看能否激活 A
 *   若任一方向不可达，则判定为死锁，需重试
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
      return t.some(x => x >= 11 && x <= 14); // 管道
    }

    // 找出所有链条对（相邻且均含 type=5）
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
            paired.add(key);
            paired.add(nKey);
            break;
          }
        }
      }
    }

    // BFS：从 row-0 出发，排除 (exR,exC)，检查能否激活 (tR,tC)
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
          // 到达 target 的邻格 = 可激活 target
          if (nr === tR && nc === tC) return true;
          if (isBlocking(nr, nc)) continue;
          visited.add(nk);
          queue.push([nr, nc]);
        }
      }
      return false;
    }

    for (const p of chainPairs) {
      const b_ok = canActivateWithout(p.r2, p.c2, p.r1, p.c1);
      const a_ok = canActivateWithout(p.r1, p.c1, p.r2, p.c2);
      if (!b_ok || !a_ok) {
        return { deadlocked: true, pair: p };
      }
    }
    return { deadlocked: false };
  });
}


// ==================== 验证 ====================
async function validateInPage(page) {
  return page.evaluate(() => {
    const { targetZoneManager, elementZoneManager } = window.app;
    const v = new YarnLevel.LevelValidator(
      targetZoneManager.getData(),
      elementZoneManager.getData()
    );
    return v.validate();
  });
}

async function getLevelJSON(page) {
  return page.evaluate(() => {
    const { targetZoneManager, elementZoneManager } = window.app;
    return YarnLevel.serializeLevelJSON({
      toprow: targetZoneManager.getBaseRowCount(),
      blocks: targetZoneManager.getData(),
      maprow: elementZoneManager.getRowCount(),
      mapcol: elementZoneManager.getColCount(),
      spools: elementZoneManager.getData(),
    });
  });
}

// ==================== 核心生成流程（TXT 版）====================
/**
 * @param {Object} page      Playwright page
 * @param {string} txtFilePath  输入 .txt 文件路径
 * @param {Object} opts
 */
async function processLevel(page, txtFilePath, opts = {}) {
  const {
    maxAttempts        = 20,  // 每次重试重新随机管道+颜色序列，增加机会（2026-04-01 从12提升至20，应对链条死锁高频触发）
    passThresholdRatio = 0.7,
    maxRows            = 10,
    maxCols            = 9,
    maxPipeDepth       = 4,
  } = opts;

  const fileName = path.basename(txtFilePath);

  // 加载页面
  await page.goto('file://' + TOOL_PATH);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);

  // 设置 defaultColorId（固定 32，不做背景色计算）
  await page.fill('#defaultColorId', String(DEFAULT_COLOR_ID));

  // 【导入 TXT 文件】—— 使用 txtFileInput，不裁剪，不换背景色
  await page.locator('#txtFileInput').setInputFiles(txtFilePath);
  await page.waitForTimeout(700);

  // 从文件名提取 txt 已有颜色，用于互斥+重叠感知的颜色序列生成
  const txtColors = extractTxtColors(txtFilePath);

  // 补充生成参数（首次）
  const colorParams = generateColorSequenceParams(txtColors);
  await page.fill('#colorSequence',    colorParams.colorSequence);
  await page.fill('#extraColorTypes',  String(colorParams.extraColorTypes));
  await page.fill('#extraColorGroups', String(colorParams.extraColorGroups));

  // 补充生成
  await page.click('#generateSupplementBtn');
  await page.waitForTimeout(400);

  // 读取总颜色组数（补充生成后固定）
  const totalGroupsText = await page.textContent('#targetGroupCount');
  const totalGroups = parseInt((totalGroupsText || '').trim(), 10);
  if (!totalGroups) return { ok: false, fileName, failReason: 'no_groups' };

  // 棋盘尺寸、管道数量
  const { rows, cols } = calculateBoardSize(totalGroups, maxRows, maxCols);
  let pipeCount        = calculatePipeCount(totalGroups, rows, cols);
  let pipeDepth        = calcPipeDepth(totalGroups, rows, cols, pipeCount);
  while (pipeDepth > maxPipeDepth && pipeCount < rows * cols - 1) {
    pipeCount++;
    pipeDepth = calcPipeDepth(totalGroups, rows, cols, pipeCount);
  }

  // 黑块数量：原版工作流按棋盘格数 12% 取整
  const boardCells      = rows * cols;
  const blackBlockCount = Math.floor(boardCells * 0.12);
  const passThreshold   = Math.floor(totalGroups * passThresholdRatio);

  // 冰块 / 问号 / 链条（基于实际可用格数）
  const regularCells  = boardCells - pipeCount - blackBlockCount;
  const iceCount      = Math.floor(boardCells * 0.15);
  const questionCount = Math.floor(boardCells * 0.25);
  const chainCount    = 1 + Math.floor(regularCells / 20);

  let lastResult = null;
  let pipes = [];
  let blacks = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 重新生成棋盘
    await page.fill('#elementRows', String(rows));
    await page.fill('#elementCols', String(cols));
    await page.click('#generateBoardBtn');
    await page.waitForTimeout(400);

    // ★ 修复（2026-03-31 田耿）：先放管道，再以真实管道位置生成黑块
    // 原逻辑用空 pipeSet 生成黑块，导致管道+黑块组合封死格子
    // 新逻辑：管道先行 → 黑块 BFS 校验时同时感知管道位置

    // 第一步：生成管道（此时无黑块，空 blackSet）
    // ★ 增加管道本身的 BFS 可达性校验：管道单独就封死区域则换策略重生成
    let pipeOk = false;
    let pipeRetry = 0;
    let pipeSet = new Set();
    while (!pipeOk && pipeRetry < 20) {
      pipes = buildSymmetricPipes(rows, cols, pipeCount, new Set());
      pipeSet = new Set(pipes.map(p => `${p.row},${p.col}`));
      pipeOk = isAccessibleFromTop(rows, cols, new Set(), pipeSet);
      if (!pipeOk) {
        pipeRetry++;
        console.log(`  ⚠️  [管道约束未通过] 重新随机管道（第${pipeRetry}次）...`);
      }
    }

    // 放置管道
    for (const p of pipes) {
      await page.evaluate(({ r, c, t }) => {
        window.app.elementZoneManager.setCellAsPipe(r, c, t);
      }, { r: p.row, c: p.col, t: p.type });
    }

    // ★ 计算管道出口格（黑块不得放在出口格，否则管道被堵死）
    const PIPE_DR = { 11: -1, 12: 0, 13: 1, 14: 0 };
    const PIPE_DC = { 11: 0, 12: 1, 13: 0, 14: -1 };
    const pipeExitSet = new Set();
    for (const p of pipes) {
      const er = p.row + PIPE_DR[p.type];
      const ec = p.col + PIPE_DC[p.type];
      if (er >= 0 && er < rows && ec >= 0 && ec < cols) {
        pipeExitSet.add(`${er},${ec}`);
      }
    }
    // 合并管道源格 + 出口格 → 黑块不可放置范围
    const pipeAndExitSet = new Set([...pipeSet, ...pipeExitSet]);

    // 第二步：生成黑块（排除管道源格+出口格，BFS 联合校验）
    blacks = generateBlackBlocks(rows, cols, blackBlockCount, pipeAndExitSet);
    const blackSet = new Set(blacks.map(b => `${b.row},${b.col}`));

    for (const b of blacks) {
      await page.evaluate(({ r, c }) => {
        window.app.elementZoneManager.setCellAsBlackBlock(r, c);
      }, { r: b.row, c: b.col });
    }
    if (pipes.length || blacks.length) {
      await page.evaluate(() => window.app.elementZoneUI.render());
      await page.waitForTimeout(200);
    }

    await page.fill('#iceCount',              String(iceCount));
    await page.fill('#elementQuestionCount',  String(questionCount));
    await page.fill('#chainCount',            String(chainCount));

    await page.click('#generateElementsBtn');
    await page.waitForTimeout(700);

    // ★ 围棋提子检测：管道+黑块+墙围死的封闭区域 → 重新生成整张棋盘基础元素
    const groupCheck = await checkNoTrappedGroups(page);
    if (!groupCheck.ok) {
      console.log(`  ⚠️  [孤立格子] ${groupCheck.trapped.length} 个格子封死：${groupCheck.trapped.map(t=>'('+t.row+','+t.col+')').join('，')}，重试...`);
      continue;
    }

    // ★ 独立链条检查门（2026-04-01 田耿要求）：链条不合规则重试，不进入验证
    const chainCheck = await checkChainDeadlock(page);
    if (chainCheck.deadlocked) {
      const p = chainCheck.pair;
      console.log(`  ⚠️  [链条死锁] 链条对(${p.r1},${p.c1})<->(${p.r2},${p.c2}) 死锁，重试...`);
      continue;
    }

    // ★ 底部棋盘合法性检测：最底行不得形成连续三格及以上全堵，否则中间元素无法优先拿取
    const bottomCheck = await page.evaluate(() => {
      const { elementZoneManager } = window.app;
      const spools = elementZoneManager.getData();
      if (!spools || spools.length === 0) return { ok: true };
      
      // 找到最大行索引（底行）
      let maxRow = 0;
      for (const s of spools) {
        if (s.row > maxRow) maxRow = s.row;
      }
      
      // 获取最底行所有元素的列索引
      const bottomRow = spools.filter(s => s.row === maxRow);
      const cols = elementZoneManager.getColCount();
      
      // 检测底行中是否存在连续三格及以上的普通元素段
      // 中间元素会被左右同时堵住，优先视为不合法
      const illegal = [];
      const seg = [];
      for (let c = 0; c < cols; c++) {
        const cell = bottomRow.find(s => s.col === c);
        const blocked = !!cell && !(cell.type >= 11 && cell.type <= 14) && cell.type !== 0;
        if (blocked) {
          seg.push(cell);
        } else {
          if (seg.length >= 3) illegal.push(...seg.slice(1, -1));
          seg.length = 0;
        }
      }
      if (seg.length >= 3) illegal.push(...seg.slice(1, -1));
      return { ok: illegal.length === 0, illegal };
    });
    if (!bottomCheck.ok) {
      console.log(`  ⚠️  [底部封堵] ${bottomCheck.illegal.length} 个底部元素无法拿取：${JSON.stringify(bottomCheck.illegal)}，重试...`);
      continue;
    }

    // ★ 链条通过后立即抓取 JSON（确保与验证结果对应的页面状态一致）
    const candidateLevelJSON = await getLevelJSON(page);

    const result = await validateInPage(page);
    const stepSet = new Set((result.log || []).map(e => e.step));
    const steps   = stepSet.size;
    // 与主流程保持一致：验证 success 或 步数超过阈值，都视为达标
    const passed  = result.success || steps > passThreshold;

    lastResult = { result, steps, passed, levelJSON: candidateLevelJSON };
    if (passed) break;
  }

  // ★ 最终链条独立验证门：只输出链条合规的关卡（防止循环结束后页面状态被污染）
  // levelJSON 来自循环内链条通过时抓取的快照，而非循环后的页面状态
  const levelJSON = lastResult?.levelJSON ?? null;
  if (!levelJSON) {
    return {
      ok: false,
      passed: false,
      fileName,
      levelJSON: '{}',
      failReason: 'chain_deadlock_all_attempts',
      stats: {
        totalGroups, rows, cols, pipeCount,
        pipeDepth: +pipeDepth.toFixed(2),
        blackBlockCount: blacks.length,
        defaultColorId: DEFAULT_COLOR_ID,
        iceCount, questionCount, chainCount,
        colorSequence: colorParams.colorSequence,
        extraColorGroups: colorParams.extraColorGroups,
        txtColors,
        validationSteps: 0,
        validationSuccess: false,
      },
    };
  }
  const passed = lastResult?.passed ?? false;

  return {
    ok: true,          // 始终 ok=true（文件始终生成）
    passed,            // passed=true 表示达标，false 表示不达标但文件完整
    fileName,
    levelJSON,
    stats: {
      totalGroups,
      rows, cols,
      pipeCount,
      pipeDepth: +pipeDepth.toFixed(2),
      blackBlockCount: blacks.length,
      defaultColorId: DEFAULT_COLOR_ID,
      iceCount, questionCount, chainCount,
      colorSequence:   colorParams.colorSequence,
      extraColorGroups: colorParams.extraColorGroups,
      txtColors,
      validationSteps: lastResult?.steps ?? 0,
      validationSuccess: lastResult?.result?.success ?? false,
    },
  };
}

// ==================== 公开 API ====================
async function generateLevel(txtFilePath, outputDir, opts = {}) {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  try {
    const result = await processLevel(page, txtFilePath, opts);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const baseName = path.basename(txtFilePath, '.txt');
    const outName  = opts.outputName || ((result.passed ? baseName : '🔴_' + baseName) + '.txt');
    const outPath  = path.join(outputDir, outName);
    fs.writeFileSync(outPath, levelJSONToTXT(result.levelJSON), 'utf8');
    return { ok: true, passed: result.passed, outputPath: outPath, stats: result.stats };
  } finally {
    await browser.close();
  }
}

async function generateLevels(txtFiles, outputDir, opts = {}) {
  const { count = txtFiles.length, failedLogPath } = opts;
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();

  const generated = [];   // 达标关卡
  const subpar    = [];   // 不达标但已保存关卡
  let idx = 0;

  for (const filePath of txtFiles) {
    if (generated.length + subpar.length >= count) break;
    idx++;
    try {
      const result = await processLevel(page, filePath, opts);
      const baseName = path.basename(filePath, '.txt');

      // ★ 链条全次死锁：不写文件，记录为失败
      if (!result.ok && result.failReason === 'chain_deadlock_all_attempts') {
        subpar.push(path.basename(filePath));
        console.log(`❌ [${idx}] ${baseName}.txt 全部${opts.maxAttempts ?? 20}次尝试均触发链条死锁，跳过不写文件`);
        continue;
      }

      // 达标：正常文件名；不达标：加 🔴 前缀
      const outName = result.passed
        ? `${String(idx).padStart(3, '0')}_${baseName}.txt`
        : `${String(idx).padStart(3, '0')}_🔴_${baseName}.txt`;
      const outPath = path.join(outputDir, outName);
      fs.writeFileSync(outPath, levelJSONToTXT(result.levelJSON), 'utf8');

      if (result.passed) {
        generated.push({ outputPath: outPath, stats: result.stats });
        console.log(`✅ [${idx}] ${outName} | ${result.stats.rows}×${result.stats.cols} | ${result.stats.totalGroups}组 | 黑块:${result.stats.blackBlockCount} | 步数:${result.stats.validationSteps}`);
      } else {
        subpar.push(path.basename(filePath));
        console.log(`🔴 [${idx}] ${outName} | ${result.stats.rows}×${result.stats.cols} | ${result.stats.totalGroups}组 | 黑块:${result.stats.blackBlockCount} | 步数:${result.stats.validationSteps}（已保存）`);
      }
    } catch (err) {
      subpar.push(path.basename(filePath));
      console.error(`❌ [${idx}] ${path.basename(filePath)} 出错: ${err.message}`);
    }
  }

  await browser.close();

  if (failedLogPath && subpar.length > 0) {
    fs.writeFileSync(failedLogPath, subpar.join('\n') + '\n', 'utf8');
  }

  return { generated, subpar };
}

module.exports = {
  calculateBoardSize,
  calculatePipeCount,
  calcPipeDepth,
  buildSymmetricPipes,
  generateColorSequenceParams,
  processLevel,
  generateLevel,
  generateLevels,
};
