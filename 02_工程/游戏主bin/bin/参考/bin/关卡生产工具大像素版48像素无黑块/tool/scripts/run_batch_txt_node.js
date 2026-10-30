/**
 * Browserless TXT batch generator.
 *
 * It loads the same dist_new managers and validators in a Node VM, then calls
 * the manager methods directly instead of clicking the HTML UI with Playwright.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { levelJSONToTXT } = require('./levelTxtFormat');

const DEFAULT_COLOR_ID = 32;
const PIPE_STRATEGIES = ['symmetric', 'corners', 'hbands', 'vbands', 'zigzag'];
const FINAL_COLOR_FAMILIES = [
  [1, 4, 6],
  [20, 21, 23],
  [3, 5, 27],
  [31, 32],
  [33, 15, 16, 18],
];
const TOO_CLOSE_COLOR_PAIRS = [
  [8, 10],
  [7, 17],
  [3, 8],
  [14, 23],
  [17, 18],
  [10, 11],
];
const COLOR_TYPE_GROUPS = [
  [1, 2, 3, 4, 5, 6, 12],
  [7, 8, 9, 10, 11, 16, 17, 18],
  [13, 14, 15, 21, 23, 33],
  [19, 20, 22, 24],
  [25, 26, 27, 28, 29, 30],
  [31, 32, 34],
];
const REAL_COLOR_LIBRARY_PATH = '/Users/puzzle/Downloads/标准色库毛线真实.txt';
const SOFT_AVOID_EXTRA_COLOR_IDS = new Set([2]);
const MAX_PIPE_DEPTH = 6;
const MAX_ATTEMPTS = Number.parseInt(process.env.MAX_ATTEMPTS || '100', 10);
const SINGLE_COLOR_EXTRACT_PERCENT = Number.parseFloat(process.env.SINGLE_COLOR_EXTRACT_PERCENT || '5');
const SPOOL_BASE_PIXEL_COUNT = Number.parseFloat(process.env.SPOOL_BASE_PIXEL_COUNT || '48');
const SPOOL_MIN = Number.parseFloat(process.env.SPOOL_MIN || '28');
const SPOOL_MAX = Number.parseFloat(process.env.SPOOL_MAX || '58');
const SPOOL_GAP = Number.parseFloat(process.env.SPOOL_GAP || '1');
const SPOOL_AVG = Number.parseFloat(process.env.SPOOL_AVG || '0');
const FIRST_ROW_RANGE_MULTIPLIER = Number.parseFloat(process.env.FIRST_ROW_RANGE_MULTIPLIER || '1');
const NEXT_ROW_RANGE_MULTIPLIER = Number.parseFloat(process.env.NEXT_ROW_RANGE_MULTIPLIER || '1.1');

function loadYarnLevel() {
  const context = {
    console,
    setTimeout,
    clearTimeout,
    document: {
      createElement() {
        return {
          style: {},
          classList: { add() {}, remove() {} },
          appendChild() {},
          removeChild() {},
          addEventListener() {},
          querySelectorAll() { return []; },
          set textContent(_) {},
          get textContent() { return ''; },
        };
      },
      head: { appendChild() {} },
      body: { appendChild() {}, removeChild() {} },
      getElementById() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
      readyState: 'loading',
    },
    window: {},
  };
  context.window = context;
  vm.createContext(context);
  const jsDir = path.resolve(__dirname, '../dist_new/js');
  const files = [
    'utils.js',
    'parsers.js',
    'managers.js',
    'terrainManager.js',
    'elementManager.js',
    'levelValidator.js',
    'levelValidatorV2.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(jsDir, file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return context.YarnLevel;
}

const YarnLevel = loadYarnLevel();
// 填充重排开关（默认开启；PIPE_FILL_REORDER=0 关闭，用于对照测试"重排是否影响前期"）
YarnLevel._fillReorderEnabled = (process.env.PIPE_FILL_REORDER !== '0');

function loadRealColorLibrary() {
  const map = new Map();
  if (!fs.existsSync(REAL_COLOR_LIBRARY_PATH)) return map;
  const content = fs.readFileSync(REAL_COLOR_LIBRARY_PATH, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = line.trim().match(/^(#[0-9a-fA-F]{6})\s*,\s*(\d+)$/);
    if (!m) continue;
    map.set(Number(m[2]), m[1].toUpperCase());
  }
  return map;
}

const REAL_COLOR_HEX = loadRealColorLibrary();

function calculateBoardSize(totalGroups, maxRows, maxCols) {
  const MAX_R = maxRows || 10;
  const MAX_C = maxCols || 9;
  const target = totalGroups * 0.8;
  let minDiff = Infinity;
  for (let r = 1; r <= MAX_R; r++) {
    for (let c = 1; c <= MAX_C; c++) {
      if (c < r) continue;
      minDiff = Math.min(minDiff, Math.abs(r * c - target));
    }
  }
  const tolerance = Math.max(2, target * 0.05);
  let bestRows = 1;
  let bestCols = 1;
  let bestDiff = Infinity;
  for (let r = 1; r <= MAX_R; r++) {
    for (let c = 1; c <= MAX_C; c++) {
      if (c < r) continue;
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

function calculatePipeCount(totalGroups, rows, cols) {
  const remaining = totalGroups - rows * cols;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / 5);
}

function calcPipeDepth(totalGroups, rows, cols, pipeCount) {
  if (pipeCount === 0) return 0;
  return (totalGroups - (rows * cols - pipeCount)) / pipeCount;
}

function calcPipeDepthWithBlockedCells(totalGroups, rows, cols, pipeCount, blockedCount) {
  if (pipeCount === 0) return 0;
  return (totalGroups - (rows * cols - pipeCount - blockedCount)) / pipeCount;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function colorEntry(colorId) {
  return YarnLevel.getColorEntry(colorId) || null;
}

function colorHex(colorId) {
  const realHex = REAL_COLOR_HEX.get(colorId);
  if (realHex) return realHex;
  const entry = colorEntry(colorId);
  return entry ? entry.cssColor : null;
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHue(rgb) {
  let [r, g, b] = rgb.map(v => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function rgbToSaturation(rgb) {
  let [r, g, b] = rgb.map(v => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return 0;
  return d / (1 - Math.abs(2 * l - 1));
}

function colorHue(colorId) {
  const rgb = hexToRgb(colorHex(colorId));
  return rgb ? rgbToHue(rgb) : 0;
}

function colorSaturation(colorId) {
  const rgb = hexToRgb(colorHex(colorId));
  return rgb ? rgbToSaturation(rgb) : 0;
}

function hueDistance(a, b) {
  const d = Math.abs(colorHue(a) - colorHue(b));
  return Math.min(d, 360 - d);
}

function saturationDistance(a, b) {
  return Math.abs(colorSaturation(a) - colorSaturation(b));
}

function rgbDistance(a, b) {
  const ra = hexToRgb(colorHex(a));
  const rb = hexToRgb(colorHex(b));
  if (!ra || !rb) return 0;
  return Math.sqrt((ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + (ra[2] - rb[2]) ** 2);
}

function minDistanceToSet(colorId, selected, metric) {
  if (!selected.length) return Infinity;
  return Math.min(...selected.map(c => metric(colorId, c)));
}

function targetCellId(cell) {
  return typeof cell === 'number' ? cell : (cell && typeof cell.id === 'number' ? cell.id : 0);
}

function createTargetCell(colorId, type = 0) {
  const sample = YarnLevel.createTargetBlock(0, 0);
  if (typeof sample === 'number') return colorId || 0;
  return YarnLevel.createTargetBlock(colorId || 0, type || 0);
}

function targetDataToValidatorBlocks(blocks) {
  return blocks.map(row => row.map(cell => {
    if (typeof cell === 'number') return { id: cell, type: 0 };
    return {
      id: targetCellId(cell),
      type: cell && typeof cell.type === 'number' ? cell.type : 0,
    };
  }));
}

function getTargetColorGroupStats(targetManager) {
  if (typeof targetManager.getColorGroupStats === 'function') {
    const stats = targetManager.getColorGroupStats();
    if (stats && typeof stats.totalGroups === 'number' && stats.totalGroups > 0) return stats;
  }
  const blocks = targetManager.getData();
  const baseRowCount = targetManager.getBaseRowCount();
  const result = { totalGroups: 0, supplementGroups: 0, rowStats: [] };
  const colorPixelCounts = {};
  const supplementPixelCounts = {};
  for (let rowIndex = 0; rowIndex < blocks.length; rowIndex++) {
    const row = blocks[rowIndex];
    const isBaseRow = rowIndex >= blocks.length - baseRowCount;
    const colorSequence = [];
    for (const cell of row) {
      const colorId = targetCellId(cell);
      if (colorId <= 0) continue;
      colorSequence.push(colorId);
      colorPixelCounts[colorId] = (colorPixelCounts[colorId] || 0) + 1;
      if (!isBaseRow) supplementPixelCounts[colorId] = (supplementPixelCounts[colorId] || 0) + 1;
    }
    result.rowStats.push({ rowIndex, groupCount: 0, colorSequence, isBaseRow });
  }
  for (const count of Object.values(colorPixelCounts)) {
    result.totalGroups += Math.ceil(count / 48);
  }
  for (const count of Object.values(supplementPixelCounts)) {
    result.supplementGroups += Math.ceil(count / 48);
  }
  return result;
}

function generateSupplementColorsCompat(targetManager, params) {
  if (typeof targetManager.generateSupplementColors === 'function') {
    try {
      targetManager.generateSupplementColors(params);
      return;
    } catch (err) {
      if (!/Cannot create property|undefined|\.id/.test(String(err && err.message))) throw err;
    }
  }
  params = params || {};
  const extraColorTypes = params.extraColorTypes || 0;
  const extraColorGroups = params.extraColorGroups || 0;
  const colorSequence = Array.isArray(params.colorSequence) ? params.colorSequence : [];
  const questionCount = params.questionCount || 0;
  let blocks = targetManager.getData();
  const baseRowCount = targetManager.getBaseRowCount();
  if (blocks.length > baseRowCount) blocks = blocks.slice(blocks.length - baseRowCount);
  if (!blocks.length || !baseRowCount) return;
  const colCount = blocks[0].length;
  const colorCounts = {};
  const startRow = Math.max(0, blocks.length - baseRowCount);
  for (let r = startRow; r < blocks.length; r++) {
    for (const cell of blocks[r]) {
      const id = targetCellId(cell);
      if (id > 0) colorCounts[id] = (colorCounts[id] || 0) + 1;
    }
  }
  const supplementColors = [];
  const validColorSequence = colorSequence.filter(id => YarnLevel.isValidColorId(id));
  if (extraColorTypes > 0 && extraColorGroups > 0 && validColorSequence.length > 0) {
    const uniqueColors = [...new Set(validColorSequence)];
    const selectedColors = uniqueColors.length <= extraColorTypes ? uniqueColors : shuffle(uniqueColors).slice(0, extraColorTypes);
    for (let group = 0; group < extraColorGroups; group++) {
      const cid = selectedColors[Math.floor(Math.random() * selectedColors.length)];
      for (let i = 0; i < 48; i++) supplementColors.push(cid);
    }
  }
  if (!supplementColors.length) {
    targetManager._blocks = blocks;
    return;
  }
  const questionIndices = new Set(shuffle([...Array(supplementColors.length).keys()]).slice(0, Math.min(questionCount, supplementColors.length)));
  const supplementBlocks = shuffle(supplementColors.map((id, index) => createTargetCell(id, questionIndices.has(index) ? 1 : 0)));
  const rowCount = Math.ceil(supplementBlocks.length / colCount);
  const newRows = [];
  let blockIndex = 0;
  for (let row = 0; row < rowCount; row++) {
    const newRow = [];
    for (let col = 0; col < colCount; col++) {
      newRow.push(blockIndex < supplementBlocks.length ? supplementBlocks[blockIndex++] : createTargetCell(0, 0));
    }
    newRows.unshift(newRow);
  }
  targetManager._blocks = newRows.concat(blocks);
}

function familyOf(colorId) {
  return FINAL_COLOR_FAMILIES.find(fam => fam.includes(colorId)) || null;
}

function conflictsWithSelected(colorId, selected) {
  const fam = familyOf(colorId);
  return !!fam && selected.some(c => fam.includes(c));
}

function tooCloseWithSelected(colorId, selected) {
  return TOO_CLOSE_COLOR_PAIRS.some(([a, b]) => (
    (colorId === a && selected.includes(b)) || (colorId === b && selected.includes(a))
  ));
}

function hardConflictsWithSelected(colorId, selected) {
  return conflictsWithSelected(colorId, selected) || tooCloseWithSelected(colorId, selected);
}

function colorTypeOf(colorId) {
  const index = COLOR_TYPE_GROUPS.findIndex(group => group.includes(colorId));
  return index === -1 ? `single-${colorId}` : `type-${index}`;
}

function preferNonAvoidedColors(candidates) {
  const preferred = candidates.filter(c => !SOFT_AVOID_EXTRA_COLOR_IDS.has(c));
  return preferred.length ? preferred : candidates;
}

function preferDiverseColorTypes(candidates, selected) {
  const counts = new Map();
  for (const c of selected) {
    const type = colorTypeOf(c);
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  let minCount = Infinity;
  for (const c of candidates) minCount = Math.min(minCount, counts.get(colorTypeOf(c)) || 0);
  return candidates.filter(c => (counts.get(colorTypeOf(c)) || 0) === minCount);
}

function sortBySaturationThenHue(candidates, selected) {
  return candidates.sort((a, b) => {
    const satScoreA = minDistanceToSet(a, selected, saturationDistance);
    const satScoreB = minDistanceToSet(b, selected, saturationDistance);
    const hueScoreA = minDistanceToSet(a, selected, hueDistance);
    const hueScoreB = minDistanceToSet(b, selected, hueDistance);
    const rgbScoreA = minDistanceToSet(a, selected, rgbDistance);
    const rgbScoreB = minDistanceToSet(b, selected, rgbDistance);
    return satScoreB - satScoreA || hueScoreB - hueScoreA || rgbScoreB - rgbScoreA || a - b;
  });
}

function sortTxtCandidatesBySaturationThenHue(candidates, txtColors, selected) {
  return candidates.sort((a, b) => {
    const referenceA = [...selected, ...txtColors.filter(c => c !== a)];
    const referenceB = [...selected, ...txtColors.filter(c => c !== b)];
    const satScoreA = minDistanceToSet(a, referenceA, saturationDistance);
    const satScoreB = minDistanceToSet(b, referenceB, saturationDistance);
    const hueScoreA = minDistanceToSet(a, referenceA, hueDistance);
    const hueScoreB = minDistanceToSet(b, referenceB, hueDistance);
    const rgbScoreA = minDistanceToSet(a, referenceA, rgbDistance);
    const rgbScoreB = minDistanceToSet(b, referenceB, rgbDistance);
    return satScoreB - satScoreA || hueScoreB - hueScoreA || rgbScoreB - rgbScoreA || a - b;
  });
}

function arrangeColorSequenceDiverse(colors) {
  const remaining = colors.slice();
  const sequence = [];
  while (remaining.length) {
    const previousType = sequence.length ? colorTypeOf(sequence[sequence.length - 1]) : null;
    let candidates = remaining.filter(c => colorTypeOf(c) !== previousType);
    if (!candidates.length) candidates = remaining.slice();
    candidates.sort((a, b) => {
      const typeCountA = sequence.filter(c => colorTypeOf(c) === colorTypeOf(a)).length;
      const typeCountB = sequence.filter(c => colorTypeOf(c) === colorTypeOf(b)).length;
      return typeCountA - typeCountB || b - a;
    });
    const next = candidates[0];
    sequence.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return sequence;
}

function pickMostDifferentTxtColors(txtColors, selected, needed) {
  const picked = [];
  while (picked.length < needed) {
    let candidates = txtColors.filter(c => !selected.includes(c) && !picked.includes(c) && !hardConflictsWithSelected(c, [...selected, ...picked]));
    candidates = preferNonAvoidedColors(candidates);
    candidates = preferDiverseColorTypes(candidates, [...selected, ...picked]);
    if (!candidates.length) break;
    sortTxtCandidatesBySaturationThenHue(candidates, txtColors, [...selected, ...picked]);
    picked.push(candidates[0]);
  }
  return picked;
}

function generateColorSequenceParams(txtColors = []) {
  const totalCount = 8 + Math.floor(Math.random() * 2);
  const overlapColors = [];
  const uniqueTxtColors = [...new Set(txtColors)].filter(c => YarnLevel.isValidColorId(c));
  const txtOverlapTarget = uniqueTxtColors.length > 5
    ? Math.floor(uniqueTxtColors.length / 2)
    : Math.min(uniqueTxtColors.length, totalCount - 1, 2);
  const sortedTxtColors = uniqueTxtColors.slice().sort((a, b) => {
    const otherA = uniqueTxtColors.filter(c => c !== a);
    const otherB = uniqueTxtColors.filter(c => c !== b);
    const satScoreA = minDistanceToSet(a, otherA, saturationDistance);
    const satScoreB = minDistanceToSet(b, otherB, saturationDistance);
    const hueScoreA = minDistanceToSet(a, otherA, hueDistance);
    const hueScoreB = minDistanceToSet(b, otherB, hueDistance);
    const rgbScoreA = minDistanceToSet(a, otherA, rgbDistance);
    const rgbScoreB = minDistanceToSet(b, otherB, rgbDistance);
    return satScoreB - satScoreA || hueScoreB - hueScoreA || rgbScoreB - rgbScoreA || a - b;
  });
  while (overlapColors.length < Math.min(sortedTxtColors.length, totalCount - 1, txtOverlapTarget)) {
    let candidates = sortedTxtColors.filter(c => !overlapColors.includes(c) && !hardConflictsWithSelected(c, overlapColors));
    candidates = preferNonAvoidedColors(candidates);
    candidates = preferDiverseColorTypes(candidates, overlapColors);
    if (!candidates.length) break;
    sortTxtCandidatesBySaturationThenHue(candidates, uniqueTxtColors, overlapColors);
    overlapColors.push(candidates[0]);
    if (overlapColors.length >= Math.min(sortedTxtColors.length, totalCount - 1, txtOverlapTarget)) break;
  }

  const newColors = [];
  const allColorIds = YarnLevel.getAllColorIds().filter(c => !uniqueTxtColors.includes(c));
  while (newColors.length < totalCount - overlapColors.length) {
    const selected = [...uniqueTxtColors, ...overlapColors, ...newColors];
    let candidates = allColorIds.filter(c => !newColors.includes(c) && !hardConflictsWithSelected(c, selected));
    candidates = preferNonAvoidedColors(candidates);
    candidates = preferDiverseColorTypes(candidates, [...overlapColors, ...newColors]);
    if (!candidates.length) break;
    sortBySaturationThenHue(candidates, selected);
    newColors.push(candidates[0]);
  }

  if (overlapColors.length + newColors.length < totalCount) {
    const needed = totalCount - overlapColors.length - newColors.length;
    overlapColors.push(...pickMostDifferentTxtColors(uniqueTxtColors, [...overlapColors, ...newColors], needed));
  }

  const sequence = arrangeColorSequenceDiverse([...overlapColors, ...newColors]);
  return {
    colorSequence: sequence,
    extraColorTypes: sequence.length,
    extraColorGroups: 30 + Math.floor(Math.random() * 11),
  };
}

function extractTxtColors(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const matrix = YarnLevel.parseTXT(content);
  const ids = new Set();
  if (YarnLevel.isParseError(matrix)) return [];
  for (const row of matrix) {
    for (const id of row) {
      if (id > 0 && id <= 34) ids.add(id);
    }
  }
  return [...ids];
}

function buildPipes(strategy, rows, cols, pipeCount, blackSet, opts = {}) {
  const bs = blackSet || new Set();
  const maxPerRow = Math.floor(cols * 0.7);
  const pipePosSet = new Set();
  const targetSet = new Set();
  const rowCount = {};
  const colCount = {};
  const pipes = [];

  function canPlacePipeAt(r, c, dr, dc) {
    const tr = r + dr;
    const tc = c + dc;
    const pk = `${r},${c}`;
    const tk = `${tr},${tc}`;
    if (pipePosSet.has(pk) || pipePosSet.has(tk)) return false;
    if (targetSet.has(tk) || targetSet.has(pk)) return false;
    if ((rowCount[r] || 0) >= maxPerRow) return false;
    if ((colCount[c] || 0) >= rows - 1) return false;
    if (!opts.limitPipeRun) return true;

    const temp = new Set(pipePosSet);
    temp.add(pk);
    let run = 1;
    for (let x = c - 1; x >= 0 && temp.has(`${r},${x}`); x--) run++;
    for (let x = c + 1; x < cols && temp.has(`${r},${x}`); x++) run++;
    if (run > 3) return false;
    run = 1;
    for (let y = r - 1; y >= 0 && temp.has(`${y},${c}`); y--) run++;
    for (let y = r + 1; y < rows && temp.has(`${y},${c}`); y++) run++;
    return run <= 3;
  }

  function tryAdd(r, c, type, dr, dc) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
    if (r === 0) return false;
    if (bs.has(`${r},${c}`)) return false;
    const tr = r + dr;
    const tc = c + dc;
    if (tr < 0 || tr >= rows || tc < 0 || tc >= cols) return false;
    if (bs.has(`${tr},${tc}`)) return false;
    if (!canPlacePipeAt(r, c, dr, dc)) return false;

    const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    let hasEntry = false;
    for (const [nr, nc] of DIRS) {
      if (nr === dr && nc === dc) continue;
      const er = r + nr;
      const ec = c + nc;
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
      if (!bs.has(`${er},${ec}`)) { hasEntry = true; break; }
    }
    if (!hasEntry) {
      for (const [nr, nc] of DIRS) {
        if (nr === dr && nc === dc) continue;
        const er = r + nr;
        const ec = c + nc;
        if (er < 0 || er >= rows || ec < 0 || ec >= cols) { hasEntry = true; break; }
      }
    }
    if (!hasEntry) return false;

    let exitHasExit = false;
    for (const [nr, nc] of DIRS) {
      if (nr === -dr && nc === -dc) continue;
      const er = tr + nr;
      const ec = tc + nc;
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) { exitHasExit = true; break; }
      if (!bs.has(`${er},${ec}`)) { exitHasExit = true; break; }
    }
    if (!exitHasExit) return false;

    const pk = `${r},${c}`;
    const tk = `${tr},${tc}`;
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
    for (let i = 0; i < n; i++) res.push(Math.round(lo + i * (hi - lo) / (n - 1)));
    return [...new Set(res)].slice(0, n);
  }
  function placeAlongRow(baseRow, colList, type, dr, dc) {
    for (const c of colList) {
      for (let d = 0; d < rows; d++) {
        if (tryAdd(baseRow + d, c, type, dr, dc)) break;
        if (d > 0 && tryAdd(baseRow - d, c, type, dr, dc)) break;
      }
    }
  }
  function placeAlongCol(baseCol, rowList, type, dr, dc) {
    for (const r of rowList) {
      for (let d = 0; d < cols; d++) {
        if (tryAdd(r, baseCol + d, type, dr, dc)) break;
        if (d > 0 && tryAdd(r, baseCol - d, type, dr, dc)) break;
      }
    }
  }

  const base = Math.floor(pipeCount / 4);
  const extra = pipeCount % 4;
  const n0 = base + (extra > 0 ? 1 : 0);
  const n1 = base + (extra > 1 ? 1 : 0);
  const n2 = base + (extra > 2 ? 1 : 0);
  const n3 = base;

  if (strategy === 'symmetric') {
    placeAlongRow(Math.max(1, Math.floor(rows * 0.3)), spread(2, cols - 3, n0), 11, -1, 0);
    placeAlongRow(Math.min(rows - 2, Math.floor(rows * 0.7)), spread(2, cols - 3, n1), 13, 1, 0);
    placeAlongCol(1, spread(1, rows - 2, n2), 12, 0, 1);
    placeAlongCol(cols - 2, spread(1, rows - 2, n3), 14, 0, -1);
  } else if (strategy === 'corners') {
    const q = Math.max(1, Math.floor(rows / 3));
    for (const r of spread(1, q, Math.ceil(n0 / 2))) { for (let d = 0; d < cols; d++) if (tryAdd(r, d + 1, 13, 1, 0)) break; }
    for (const r of spread(1, q, Math.floor(n0 / 2))) { for (let d = 0; d < cols; d++) if (tryAdd(r, cols - 2 - d, 13, 1, 0)) break; }
    for (const r of spread(rows - 1 - q, rows - 2, Math.ceil(n1 / 2))) { for (let d = 0; d < cols; d++) if (tryAdd(r, d + 1, 11, -1, 0)) break; }
    for (const r of spread(rows - 1 - q, rows - 2, Math.floor(n1 / 2))) { for (let d = 0; d < cols; d++) if (tryAdd(r, cols - 2 - d, 11, -1, 0)) break; }
    placeAlongCol(1, spread(Math.floor(rows * 0.3), Math.floor(rows * 0.7), n2), 12, 0, 1);
    placeAlongCol(cols - 2, spread(Math.floor(rows * 0.3), Math.floor(rows * 0.7), n3), 14, 0, -1);
  } else if (strategy === 'hbands') {
    const bandCount = Math.min(3, Math.max(2, Math.ceil(pipeCount / Math.max(2, cols - 2))));
    let remain = pipeCount;
    spread(1, rows - 2, bandCount).forEach((br, i) => {
      const n = i < bandCount - 1 ? Math.ceil(pipeCount / bandCount) : remain;
      const [type, dr, dc] = [[11, -1, 0], [13, 1, 0], [11, -1, 0]][i % 3];
      placeAlongRow(br, spread(1, cols - 2, n), type, dr, dc);
      remain = Math.max(0, remain - n);
    });
  } else if (strategy === 'vbands') {
    const bandCount = Math.min(3, Math.max(2, Math.ceil(pipeCount / Math.max(2, rows - 2))));
    let remain = pipeCount;
    spread(1, cols - 2, bandCount).forEach((bc, i) => {
      const n = i < bandCount - 1 ? Math.ceil(pipeCount / bandCount) : remain;
      const [type, dr, dc] = [[12, 0, 1], [14, 0, -1], [12, 0, 1]][i % 3];
      placeAlongCol(bc, spread(1, rows - 2, n), type, dr, dc);
      remain = Math.max(0, remain - n);
    });
  } else if (strategy === 'zigzag') {
    spread(1, cols - 2, pipeCount).forEach((c, i) => {
      const isOdd = i % 2 === 1;
      const baseRow = isOdd ? Math.floor(rows * 0.6) : Math.floor(rows * 0.35);
      const type = isOdd ? 13 : 11;
      const dr = isOdd ? 1 : -1;
      for (let d = 0; d < rows; d++) {
        if (tryAdd(baseRow + d, c, type, dr, 0)) break;
        if (d > 0 && tryAdd(baseRow - d, c, type, dr, 0)) break;
      }
    });
  }

  const pipeOptions = [
    [11, -1, 0],
    [12, 0, 1],
    [13, 1, 0],
    [14, 0, -1],
  ];
  for (let tries = 0; pipes.length < pipeCount && tries < rows * cols * 80; tries++) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    const [type, dr, dc] = pipeOptions[Math.floor(Math.random() * pipeOptions.length)];
    tryAdd(r, c, type, dr, dc);
  }
  return pipes;
}

function buildSymmetricPipes(rows, cols, pipeCount, blackSet, opts) {
  if (pipeCount === 0) return [];
  return buildPipes(PIPE_STRATEGIES[Math.floor(Math.random() * PIPE_STRATEGIES.length)], rows, cols, pipeCount, blackSet, opts);
}

// 管道聚集度评分：统计相邻(含斜向，8 邻域)的管道对数，越小越分散。
// 用于减压(RELIEF_STAGE≥1)时在多个可用布局里择优挑"最分散"的，缓解管道扎堆形成的前期窄路。
function pipeClusterScore(pipes) {
  const set = new Set(pipes.map(p => `${p.row},${p.col}`));
  let pairs = 0;
  // 只朝"右/下/右下/左下"4 个方向看，保证每对相邻只计一次
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const p of pipes) {
    for (const [dr, dc] of dirs) {
      if (set.has(`${p.row + dr},${p.col + dc}`)) pairs++;
    }
  }
  return pairs;
}

// 【测试用】后区窄路管道（温和版）：在"原有正常管道布局"基础上，把后区若干管道挪成一小段
// 连续的横向 run（留缺口）形成局部窄路——制造后期强制路线/卡点，而不暴力把全部管道后移、不伤可玩性。
// 管道总数恒为 pipeCount(颜色守恒)。可达性由调用处 isAccessibleFromTop 兜底。
// narrowFrac = 窄路段占行宽的比例(≤0.9，保证留缺口)；frac = 窄路所在行的后区比例。
function buildNarrowPathPipes(rows, cols, pipeCount, blackSet, frac, narrowFrac, limitRun) {
  const pipes = buildSymmetricPipes(rows, cols, pipeCount, blackSet, { limitPipeRun: limitRun });
  if (pipes.length < 2 || cols < 3) return pipes;
  const half = Math.ceil(rows * 0.5);
  const wallRow = Math.max(half, Math.min(rows - 2, Math.floor(rows * (frac > 0 ? frac : 0.6))));
  const nf = Math.max(0.2, Math.min(0.9, narrowFrac > 0 ? narrowFrac : 0.5)); // 上限0.9→不铺满整行(留缺口)
  const wallLen = Math.max(2, Math.min(cols - 1, Math.round(nf * cols)));
  const start = Math.floor(Math.random() * Math.max(1, cols - wallLen)); // 窄路段起列(其余为缺口)
  const target = [];
  for (let k = 0; k < wallLen; k++) target.push({ row: wallRow, col: start + k });
  const tset = new Set(target.map(t => t.row + ',' + t.col));
  const occupied = new Set(pipes.map(p => p.row + ',' + p.col));
  const need = target.filter(t => !occupied.has(t.row + ',' + t.col));
  // 可挪动的管道：不在窄路段、且不在顶行；优先挪后区已有管道(尽量不动前区，保留原分布)
  const movable = pipes.filter(p => !tset.has(p.row + ',' + p.col) && p.row > 0)
    .sort((a, b) => (b.row >= half ? 1 : 0) - (a.row >= half ? 1 : 0));
  let mi = 0;
  for (const t of need) {
    if (mi >= movable.length) break;
    const mv = movable[mi++];
    mv.row = t.row; mv.col = t.col; mv.type = 13; // 挪到窄路段，朝下
  }
  return pipes;
}

function isAccessibleFromTop(rows, cols, blackSet, pipeSet) {
  const blocked = key => blackSet.has(key) || pipeSet.has(key);
  const visited = new Set();
  const queue = [];
  for (let c = 0; c < cols; c++) {
    visited.add(`-1,${c}`);
    queue.push([-1, c]);
  }
  for (let head = 0; head < queue.length; head++) {
    const [r, c] = queue[head];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nc < 0 || nc >= cols || nr < -1 || nr >= rows) continue;
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

function validatePipeConstraints(pipes, rows, cols) {
  const pipeSet = new Set(pipes.map(p => `${p.row},${p.col}`));
  for (let r = 0; r < rows; r++) {
    let allPipe = true;
    let run = 0;
    for (let c = 0; c < cols; c++) {
      if (!pipeSet.has(`${r},${c}`)) allPipe = false;
      run = pipeSet.has(`${r},${c}`) ? run + 1 : 0;
      if (run > 3) return false;
    }
    if (allPipe) return false;
  }
  for (let c = 0; c < cols; c++) {
    let allPipe = true;
    let run = 0;
    for (let r = 0; r < rows; r++) {
      if (!pipeSet.has(`${r},${c}`)) allPipe = false;
      run = pipeSet.has(`${r},${c}`) ? run + 1 : 0;
      if (run > 3) return false;
    }
    if (allPipe) return false;
  }
  return true;
}

function generateBlackBlocks(rows, cols, targetCount, pipeSet) {
  const blackSet = new Set();
  const candidates = [];
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r},${c}`;
      if (!pipeSet.has(key)) candidates.push(key);
    }
  }
  for (const key of shuffle(candidates)) {
    if (blackSet.size >= targetCount) break;
    blackSet.add(key);
    if (!isAccessibleFromTop(rows, cols, blackSet, pipeSet)) blackSet.delete(key);
  }
  return [...blackSet].map(k => {
    const [row, col] = k.split(',').map(Number);
    return { row, col };
  });
}

function checkNoTrappedGroups(elementZoneManager) {
  const spools = elementZoneManager.getData();
  const rows = spools.length;
  if (rows === 0) return { ok: true, trapped: [] };
  const cols = spools[0].length;
  function isWalkable(r, c) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
    const cell = spools[r][c];
    if (!cell || cell.id === -1) return false;
    if (cell.id === 0 && !elementZoneManager.isPipeElement(r, c)) return false;
    if (elementZoneManager.isPipeElement(r, c)) return false;
    return true;
  }
  const visited = new Set();
  const queue = [];
  for (let c = 0; c < cols; c++) {
    if (isWalkable(0, c)) {
      visited.add(`0,${c}`);
      queue.push([0, c]);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const [r, c] = queue[head];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      const key = `${nr},${nc}`;
      if (visited.has(key) || !isWalkable(nr, nc)) continue;
      visited.add(key);
      queue.push([nr, nc]);
    }
  }
  const trapped = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isWalkable(r, c) && !visited.has(`${r},${c}`)) trapped.push({ row: r, col: c, id: spools[r][c].id });
    }
  }
  return { ok: trapped.length === 0, trapped };
}

function checkChainDeadlock(elementZoneManager) {
  const spools = elementZoneManager.getData();
  const rows = spools.length;
  if (rows === 0) return { deadlocked: false };
  const cols = spools[0].length;
  const hasType = (types, t) => Array.isArray(types) ? types.includes(t) : types === t;
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
      const key = `${r},${c}`;
      if (!cell || !hasType(cell.type, 5) || paired.has(key)) continue;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr;
        const nc = c + dc;
        const nb = spools[nr] && spools[nr][nc];
        const nKey = `${nr},${nc}`;
        if (nb && hasType(nb.type, 5) && !paired.has(nKey)) {
          chainPairs.push({ r1: r, c1: c, r2: nr, c2: nc });
          paired.add(key);
          paired.add(nKey);
          break;
        }
      }
    }
  }
  function canActivateWithout(tR, tC, exR, exC) {
    const visited = new Set();
    const queue = [];
    for (let c0 = 0; c0 < cols; c0++) {
      if (exR === 0 && exC === c0) continue;
      if (isBlocking(0, c0)) continue;
      visited.add(`0,${c0}`);
      queue.push([0, c0]);
    }
    for (let head = 0; head < queue.length; head++) {
      const [r, c] = queue[head];
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr === exR && nc === exC) continue;
        if (nr === tR && nc === tC) return true;
        const key = `${nr},${nc}`;
        if (visited.has(key) || isBlocking(nr, nc)) continue;
        visited.add(key);
        queue.push([nr, nc]);
      }
    }
    return false;
  }
  for (const p of chainPairs) {
    if (!canActivateWithout(p.r2, p.c2, p.r1, p.c1) || !canActivateWithout(p.r1, p.c1, p.r2, p.c2)) {
      return { deadlocked: true, pair: p };
    }
  }
  return { deadlocked: false };
}

function checkHalfBlockedSpoolRuns(elementZoneManager) {
  const spools = elementZoneManager.getData();
  const rows = spools.length;
  if (rows === 0) return { ok: true, runs: [] };
  const cols = spools[0].length;
  const hasType = (types, t) => Array.isArray(types) ? types.includes(t) : types === t;
  function isPipeCell(cell) {
    if (!cell) return false;
    return [11, 12, 13, 14].some(t => hasType(cell.type, t));
  }
  function isNormalSpool(r, c) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
    const cell = spools[r] && spools[r][c];
    return !!cell && cell.id > 0 && !isPipeCell(cell);
  }
  function isSolid(r, c) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return true;
    const cell = spools[r] && spools[r][c];
    return !cell || cell.id === -1 || isPipeCell(cell);
  }
  const verticalClamped = new Set();
  const horizontalClamped = new Set();
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isNormalSpool(r, c)) continue;
      if (isSolid(r - 1, c) && isSolid(r + 1, c)) verticalClamped.add(`${r},${c}`);
      if (isSolid(r, c - 1) && isSolid(r, c + 1)) horizontalClamped.add(`${r},${c}`);
    }
  }
  const runs = [];
  for (let r = 1; r < rows; r++) {
    let segment = [];
    for (let c = 0; c < cols; c++) {
      if (verticalClamped.has(`${r},${c}`)) {
        segment.push({ row: r, col: c, id: spools[r][c].id, type: spools[r][c].type });
      } else {
        if (segment.length >= 2) runs.push({ mode: 'vertical_clamp', cells: segment });
        segment = [];
      }
    }
    if (segment.length >= 2) runs.push({ mode: 'vertical_clamp', cells: segment });
  }
  for (let c = 0; c < cols; c++) {
    let segment = [];
    for (let r = 1; r < rows; r++) {
      if (horizontalClamped.has(`${r},${c}`)) {
        segment.push({ row: r, col: c, id: spools[r][c].id, type: spools[r][c].type });
      } else {
        if (segment.length >= 2) runs.push({ mode: 'horizontal_clamp', cells: segment });
        segment = [];
      }
    }
    if (segment.length >= 2) runs.push({ mode: 'horizontal_clamp', cells: segment });
  }
  return { ok: runs.length === 0, runs };
}

function inspectPipeDepth(elementZoneManager, maxDepth) {
  const spools = elementZoneManager.getData();
  const violations = [];
  let actualMax = 0;
  for (let r = 0; r < spools.length; r++) {
    for (let c = 0; c < spools[r].length; c++) {
      const cell = spools[r][c];
      const types = Array.isArray(cell.type) ? cell.type : [cell.type];
      if (!types.some(t => t >= 11 && t <= 14)) continue;
      const depth = Array.isArray(cell.param) ? cell.param.length : 0;
      actualMax = Math.max(actualMax, depth);
      if (depth > maxDepth) violations.push({ row: r, col: c, depth });
    }
  }
  return { ok: violations.length === 0, actualMax, violations };
}

function makeLevelJSON(targetManager, elementManager) {
  return YarnLevel.serializeLevelJSON({
    toprow: targetManager.getBaseRowCount(),
    blocks: targetManager.getData(),
    maprow: elementManager.getRowCount(),
    mapcol: elementManager.getColCount(),
    spools: elementManager.getData(),
  });
}

function validate(targetManager, elementManager) {
  return new YarnLevel.LevelValidator(targetDataToValidatorBlocks(targetManager.getData()), elementManager.getData()).validate();
}

// ===== 动态难度平衡·障碍辅助函数（加压后移 / 减压后移） =====

/**
 * 偏向中后期放置冰块：backFraction 比例放在 row >= rows*threshold 区域，其余全棋盘随机
 * backFraction 缺省 0.5（原行为）；减压时由调用方传 1.0（冰块尽量全后移）
 */
function _placeIceBiased(elementManager, count, rows, threshold, backFraction) {
  backFraction = (typeof backFraction === 'number' && backFraction >= 0 && backFraction <= 1) ? backFraction : 0.5;
  const spools = elementManager.getData();
  const cols = spools[0] ? spools[0].length : 0;
  const midRow = Math.floor(rows * threshold);

  // 收集可放位置
  const backPositions = []; // 后区
  const allPositions = [];  // 全部
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (elementManager.canPlaceIceOrQuestionAt(r, c)) {
        allPositions.push({ row: r, col: c });
        if (r >= midRow) backPositions.push({ row: r, col: c });
      }
    }
  }

  // backFraction 后区 + 其余全区
  const backCount = Math.ceil(count * backFraction);
  const frontCount = count - backCount;

  // shuffle
  for (let i = backPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [backPositions[i], backPositions[j]] = [backPositions[j], backPositions[i]];
  }
  for (let i = allPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allPositions[i], allPositions[j]] = [allPositions[j], allPositions[i]];
  }

  let placed = 0;
  const usedSet = new Set();

  // 先放后区的份额
  for (const pos of backPositions) {
    if (placed >= backCount) break;
    const key = `${pos.row},${pos.col}`;
    if (usedSet.has(key)) continue;
    if (elementManager.canPlaceIceOrQuestionAt(pos.row, pos.col)) {
      if (elementManager.placeSpecialElement(pos.row, pos.col, 4)) {
        placed++;
        usedSet.add(key);
      }
    }
  }

  // 剩余份额全区随机放
  for (const pos of allPositions) {
    if (placed >= count) break;
    const key = `${pos.row},${pos.col}`;
    if (usedSet.has(key)) continue;
    if (elementManager.canPlaceIceOrQuestionAt(pos.row, pos.col)) {
      if (elementManager.placeSpecialElement(pos.row, pos.col, 4)) {
        placed++;
        usedSet.add(key);
      }
    }
  }

  return placed;
}

/**
 * 偏向中后期放置锁链：候选链对中两端都在 row >= rows*threshold 的优先放置，不足再全棋盘补。
 * 用于减压（后移锁链），与 _placeIceBiased 同思路。
 */
function _placeChainsBiased(elementManager, count, rows, threshold) {
  if (!count || count <= 0) return 0;
  const midRow = Math.floor(rows * threshold);
  let placed = 0;
  const all = elementManager._findCandidateChainPairs();
  const back = shuffle(all.filter(p => p.row1 >= midRow && p.row2 >= midRow));
  for (const p of back) {
    if (placed >= count) break;
    if (elementManager.placeChainPair(p.row1, p.col1, p.row2, p.col2)) placed++;
  }
  // 后区不足，全棋盘补足（放置后局面已变，重新取候选）
  if (placed < count) {
    for (const p of shuffle(elementManager._findCandidateChainPairs())) {
      if (placed >= count) break;
      if (elementManager.placeChainPair(p.row1, p.col1, p.row2, p.col2)) placed++;
    }
  }
  return placed;
}

/**
 * 在已放置的锁链格子上覆盖冰块
 * 20%概率两个都覆盖冰块，80%概率只覆盖一个
 */
function _coverChainsWithIce(elementManager, rows) {
  const spools = elementManager.getData();
  const cols = spools[0] ? spools[0].length : 0;

  // 找出所有锁链格（type含5）
  const chainCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = spools[r] && spools[r][c];
      if (!cell || cell.id <= 0) continue;
      const types = Array.isArray(cell.type) ? cell.type : [cell.type];
      if (types.includes(5)) chainCells.push({ row: r, col: c });
    }
  }

  // 配对（相邻的锁链格成对）
  const paired = new Set();
  const pairs = [];
  for (let i = 0; i < chainCells.length; i++) {
    if (paired.has(i)) continue;
    for (let j = i + 1; j < chainCells.length; j++) {
      if (paired.has(j)) continue;
      const dr = Math.abs(chainCells[i].row - chainCells[j].row);
      const dc = Math.abs(chainCells[i].col - chainCells[j].col);
      if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
        pairs.push([chainCells[i], chainCells[j]]);
        paired.add(i);
        paired.add(j);
        break;
      }
    }
  }

  // 对每对锁链覆盖冰块
  for (const [a, b] of pairs) {
    const coverBoth = Math.random() < 0.2;
    // 覆盖第一个
    if (elementManager.canPlaceIceOrQuestionAt(a.row, a.col)) {
      elementManager.placeSpecialElement(a.row, a.col, 4);
    }
    // 20%概率覆盖第二个
    if (coverBoth && elementManager.canPlaceIceOrQuestionAt(b.row, b.col)) {
      elementManager.placeSpecialElement(b.row, b.col, 4);
    }
  }
}

// ===================== 障碍区域预设（功能3：五分区分栏） =====================
// 五分区：左上 / 左下 / 右上 / 右下 / 中（中取行列各约 1/3 的交叠区，范围本就模糊，
// 障碍放置后仍交回求解器反推难度，多轮随机即可逼近目标曲线）。
function loadObstaclePreset() {
  try { if (process.env.OBSTACLE_PRESET_JSON) return JSON.parse(process.env.OBSTACLE_PRESET_JSON); } catch (e) {}
  const candidates = [];
  if (process.env.OBSTACLE_PRESET_FILE) candidates.push(process.env.OBSTACLE_PRESET_FILE);
  candidates.push(path.resolve(__dirname, '../../../..', '障碍区域预设.json'));
  for (const f of candidates) {
    try { if (f && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  }
  return null;
}
const OBSTACLE_PRESET = loadObstaclePreset();

function resolveObstaclePreset(base) {
  const empty = { ice: [], question: [], chain: [], pipeShuffle: [] };
  if (!OBSTACLE_PRESET) return empty;
  const per = (OBSTACLE_PRESET.perTxt && (OBSTACLE_PRESET.perTxt[base] || OBSTACLE_PRESET.perTxt[base + '.txt'])) || null;
  const glob = OBSTACLE_PRESET.global || {};
  const pick = t => (per && per[t]) ? per[t] : (glob[t] || []);
  const norm = arr => Array.isArray(arr)
    ? arr.map(x => {
        if (!x) return null;
        let ratio = 0;
        if (x.ratio != null) ratio = Number(x.ratio);
        else if (x.percent != null) ratio = Number(x.percent) / 100;
        if (ratio > 1) ratio = ratio / 100; // 容错：误写成百分数(如 50) → 0.5
        if (!(ratio > 0)) return null;
        // 相对矩形区域 {x0,y0,x1,y1}（0~1）优先；否则用命名区域（向后兼容）
        if (x.rect && ['x0', 'y0', 'x1', 'y1'].every(k => typeof x.rect[k] === 'number')) {
          const x0 = Math.max(0, Math.min(1, x.rect.x0)), y0 = Math.max(0, Math.min(1, x.rect.y0));
          const x1 = Math.max(0, Math.min(1, x.rect.x1)), y1 = Math.max(0, Math.min(1, x.rect.y1));
          if (x1 > x0 && y1 > y0) return { ratio, rect: { x0, y0, x1, y1 } };
          return null;
        }
        if (x.region) return { ratio, region: String(x.region) };
        return null;
      }).filter(Boolean)
    : [];
  const capSum = arr => {
    let acc = 0; const out = [];
    for (const s of arr) {
      if (acc >= 1) break;
      let rt = s.ratio;
      if (acc + rt > 1) rt = 1 - acc;
      if (rt > 0.0001) { out.push(Object.assign({}, s, { ratio: rt })); acc += rt; }
    }
    return out;
  };
  // 乱序管道区域：只取区域(rect/命名)，不需要 ratio（乱序比例是全局参数，不按区域配额）
  const normRegions = arr => Array.isArray(arr)
    ? arr.map(x => {
        if (!x) return null;
        if (x.rect && ['x0', 'y0', 'x1', 'y1'].every(k => typeof x.rect[k] === 'number')) {
          const x0 = Math.max(0, Math.min(1, x.rect.x0)), y0 = Math.max(0, Math.min(1, x.rect.y0));
          const x1 = Math.max(0, Math.min(1, x.rect.x1)), y1 = Math.max(0, Math.min(1, x.rect.y1));
          if (x1 > x0 && y1 > y0) return { rect: { x0, y0, x1, y1 } };
          return null;
        }
        if (x.region) return { region: String(x.region) };
        return null;
      }).filter(Boolean)
    : [];
  return {
    ice: capSum(norm(pick('ice'))),
    question: capSum(norm(pick('question'))),
    chain: capSum(norm(pick('chain'))),
    pipeShuffle: normRegions(pick('pipeShuffle')),
  };
}

function inRegion(r, c, rows, cols, region) {
  switch (region) {
    case '左上': case 'TL': return r < rows / 2 && c < cols / 2;
    case '右上': case 'TR': return r < rows / 2 && c >= cols / 2;
    case '左下': case 'BL': return r >= rows / 2 && c < cols / 2;
    case '右下': case 'BR': return r >= rows / 2 && c >= cols / 2;
    case '中': case 'C': {
      const r0 = Math.floor(rows / 3), r1 = Math.ceil(rows * 2 / 3);
      const c0 = Math.floor(cols / 3), c1 = Math.ceil(cols * 2 / 3);
      return r >= r0 && r < r1 && c >= c0 && c < c1;
    }
    default: return true; // 未知区域名 → 全局（等同不限制）
  }
}

// 判断格子是否落在某条预设的区域内：相对矩形(用格子中心比例)优先，否则命名区域
function cellInSpec(r, c, rows, cols, spec) {
  if (spec.rect) {
    const fx = (c + 0.5) / cols, fy = (r + 0.5) / rows;
    return fx >= spec.rect.x0 && fx < spec.rect.x1 && fy >= spec.rect.y0 && fy < spec.rect.y1;
  }
  return inRegion(r, c, rows, cols, spec.region);
}

// ===== 管道内乱序（pipe-fill-shuffle）=====
// 在管道填满后，对"按区域+比例选中的管道"的"选定层区间(默认 4-6 层=param[3..5])"按程度随机打乱深层球序。
// 只重排 param 内元素顺序、不增删不跨管道 → 颜色总数与各色计数不变；目标是提升中后段卡点(滞留)而不破坏可解性。
// opts: { ratio(0-1), layerLo, layerHi(1基), intensity('swap2'|'full'), regions([{rect}|{region}]) }
function shufflePipeParams(em, rows, cols, opts) {
  const ratio = opts.ratio;
  if (!(ratio > 0)) return { shuffled: 0, total: 0 };
  const pipes = em.getPipeElements();        // [{row,col,type}]，按 row→col scan 序
  const P = pipes.length;
  if (P === 0) return { shuffled: 0, total: 0 };
  const N = Math.round(ratio * P);           // 目标乱序管道数，基准=全关管道总数 P
  if (N <= 0) return { shuffled: 0, total: P };
  const regions = (opts.regions && opts.regions.length) ? opts.regions : null;
  const inAnyRegion = (r, c) => regions ? regions.some(spec => cellInSpec(r, c, rows, cols, spec)) : true;

  // 候选：区域内管道优先；无区域=全部
  let candidates, others;
  if (regions) {
    candidates = pipes.filter(p => inAnyRegion(p.row, p.col));
    others = pipes.filter(p => !inAnyRegion(p.row, p.col));
  } else {
    candidates = pipes.slice(); others = [];
  }

  // 选 N 个：候选够则随机取 N；不够则全取候选 + 从区域外"由近到远"向边缘补足
  let chosen = shuffle(candidates).slice(0, Math.min(N, candidates.length));
  if (chosen.length < N && others.length) {
    const regionCells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (inAnyRegion(r, c)) regionCells.push([r, c]);
    const distOf = p => {
      let best = Infinity;
      for (const rc of regionCells) { const d = Math.max(Math.abs(p.row - rc[0]), Math.abs(p.col - rc[1])); if (d < best) best = d; }
      return best === Infinity ? 0 : best;
    };
    others.sort((a, b) => distOf(a) - distOf(b));
    for (const p of others) { if (chosen.length >= N) break; chosen.push(p); }
  }

  // 逐管道打乱选定层区间（getData 返回克隆，故改后用 setPipeParam 写回）
  const data = em.getData();
  const loIdx = opts.layerLo - 1, hiIdx = opts.layerHi - 1;
  let shuffled = 0;
  for (const p of chosen) {
    const cell = data[p.row] && data[p.row][p.col];
    const param = cell && cell.param;
    if (!Array.isArray(param)) continue;
    const a = Math.max(0, loIdx);
    const b = Math.min(param.length - 1, hiIdx);
    if (b - a + 1 < 2) continue;             // 区间内不足两个球，无可交换
    if (opts.intensity === 'full') {
      // 子区间整体随机置换（Fisher–Yates，限定 [a,b]）
      for (let i = b; i > a; i--) {
        const j = a + Math.floor(Math.random() * (i - a + 1));
        const t = param[i]; param[i] = param[j]; param[j] = t;
      }
    } else {
      // swap2：随机交换区间内两个不同位置
      let i = a + Math.floor(Math.random() * (b - a + 1));
      let j = a + Math.floor(Math.random() * (b - a + 1));
      let guard = 0;
      while (j === i && guard++ < 16) j = a + Math.floor(Math.random() * (b - a + 1));
      if (j === i) continue;
      const t = param[i]; param[i] = param[j]; param[j] = t;
    }
    em.setPipeParam(p.row, p.col, param);
    shuffled++;
  }
  return { shuffled, total: P };
}

// 区域优先放置 冰块(4)/问号(6)：先按各区配额放，再用剩余名额全盘补齐；不重复占格。
function placeSingleTypeWithRegions(em, type, totalCount, regionsSpec, rows, cols, minRow) {
  const used = new Set();
  let placed = 0;
  const tryPlace = (r, c) => {
    if (placed >= totalCount) return false;
    const key = r + ',' + c;
    if (used.has(key) || r < minRow) return false;
    if (!em.canPlaceIceOrQuestionAt(r, c)) return false;
    if (em.placeSpecialElement(r, c, type)) { used.add(key); placed++; return true; }
    return false;
  };
  for (const spec of regionsSpec) {
    let need = Math.max(0, Math.round((spec.ratio || 0) * totalCount)); // 占比 → 个数
    const cells = [];
    for (let r = minRow; r < rows; r++) for (let c = 0; c < cols; c++) if (cellInSpec(r, c, rows, cols, spec)) cells.push([r, c]);
    for (const [r, c] of shuffle(cells)) { if (need <= 0 || placed >= totalCount) break; if (tryPlace(r, c)) need--; }
  }
  if (placed < totalCount) {
    const all = [];
    for (let r = minRow; r < rows; r++) for (let c = 0; c < cols; c++) all.push([r, c]);
    for (const [r, c] of shuffle(all)) { if (placed >= totalCount) break; tryPlace(r, c); }
  }
  return placed;
}

// 区域优先放置 锁链(5) 对：先放两端都在区域内的候选对，再用剩余名额任意补齐。
function placeChainsWithRegions(em, totalPairs, regionsSpec, rows, cols) {
  let placed = 0;
  for (const spec of regionsSpec) {
    let need = Math.max(0, Math.round((spec.ratio || 0) * totalPairs)); // 占比 → 对数
    const pool = shuffle(em._findCandidateChainPairs().filter(p =>
      cellInSpec(p.row1, p.col1, rows, cols, spec) && cellInSpec(p.row2, p.col2, rows, cols, spec)));
    for (const p of pool) {
      if (need <= 0 || placed >= totalPairs) break;
      if (em.placeChainPair(p.row1, p.col1, p.row2, p.col2)) { need--; placed++; }
    }
  }
  if (placed < totalPairs) {
    for (const p of shuffle(em._findCandidateChainPairs())) {
      if (placed >= totalPairs) break;
      if (em.placeChainPair(p.row1, p.col1, p.row2, p.col2)) placed++;
    }
  }
  return placed;
}

function generateOne(txtFilePath, workflow, options = {}) {
  const diffLevel = options.difficultyLevel || 1; // 1=默认, 2=偏后期, 3=聚集+锁链覆冰, 4+=加量
  const txtBaseName = path.basename(txtFilePath, '.txt');
  const targetManager = new YarnLevel.TargetZoneManager();
  const elementManager = new YarnLevel.ElementZoneManager();
  const parsed = YarnLevel.parseTXT(fs.readFileSync(txtFilePath, 'utf8'));
  if (YarnLevel.isParseError(parsed)) throw new Error(parsed.message || 'TXT parse failed');
  targetManager.loadRawData(parsed, DEFAULT_COLOR_ID);

  const colorParams = options.noSupplement
    ? { colorSequence: [], extraColorTypes: 0, extraColorGroups: 0 }
    : generateColorSequenceParams(extractTxtColors(txtFilePath));
  if (!options.noSupplement) {
    generateSupplementColorsCompat(targetManager, {
      extraColorTypes: colorParams.extraColorTypes,
      extraColorGroups: colorParams.extraColorGroups,
      colorSequence: colorParams.colorSequence,
      questionCount: 0,
    });
  }
  const totalGroups = getTargetColorGroupStats(targetManager).totalGroups;
  if (!totalGroups) throw new Error('no color groups');

  const { rows, cols } = calculateBoardSize(totalGroups, 9, 10);
  const boardCells = rows * cols;
  const blackBlockCount = workflow === 'black' ? Math.floor(boardCells * 0.12) : 0;
  let pipeCount = calculatePipeCount(totalGroups, rows, cols);
  let pipeDepth = calcPipeDepthWithBlockedCells(totalGroups, rows, cols, pipeCount, blackBlockCount);
  while (pipeDepth > MAX_PIPE_DEPTH && pipeCount < rows * cols - 1) {
    pipeCount++;
    pipeDepth = calcPipeDepthWithBlockedCells(totalGroups, rows, cols, pipeCount, blackBlockCount);
  }

  const regularCells = boardCells - pipeCount - blackBlockCount;
  // 障碍数量（可被环境变量覆盖，供网页 UI 同步；缺省即原值）
  const ICE_RATIO = Number.parseFloat(process.env.ICE_RATIO || '0.15');
  const QUESTION_RATIO = Number.parseFloat(process.env.QUESTION_RATIO || '0.25');
  const CHAIN_DIVISOR = Number.parseFloat(process.env.CHAIN_DIVISOR || '20');
  const ICE_BONUS_RATIO = Number.parseFloat(process.env.ICE_BONUS_RATIO || '0.10');
  const baseIce = Math.floor(boardCells * ICE_RATIO);
  const iceBonus = diffLevel >= 4 ? Math.ceil(baseIce * ICE_BONUS_RATIO) : 0;
  const chainBonus = diffLevel >= 4 ? 1 : 0;
  // ===== 动态难度平衡·减压参数（默认关闭；由 run.js 按审核反馈设置）=====
  const RELIEF_STAGE = Number.parseInt(process.env.RELIEF_STAGE || '0', 10);            // 0=无 1=后移冰块/锁链 2=后移+减障碍
  const RELIEF_OBSTACLE_RATIO = Number.parseFloat(process.env.RELIEF_OBSTACLE_RATIO || '0.75'); // 阶段2 冰/链数量缩减系数
  const reliefScale = RELIEF_STAGE >= 2 ? RELIEF_OBSTACLE_RATIO : 1;                    // 仅阶段2缩减（冰/链；问号不动）

  // ===== 管道内乱序参数（pipe-fill-shuffle；默认=推荐值 100%/swap2/层4-6，只动深层故不抬前期）=====
  const PIPE_SHUFFLE_RATIO = Math.max(0, Math.min(1, Number.parseFloat(process.env.PIPE_SHUFFLE_RATIO || '1') || 0));
  let PIPE_SHUFFLE_LO = Number.parseInt(process.env.PIPE_SHUFFLE_LAYER_LO || '4', 10);
  let PIPE_SHUFFLE_HI = Number.parseInt(process.env.PIPE_SHUFFLE_LAYER_HI || '6', 10);
  if (!Number.isFinite(PIPE_SHUFFLE_LO)) PIPE_SHUFFLE_LO = 4;
  if (!Number.isFinite(PIPE_SHUFFLE_HI)) PIPE_SHUFFLE_HI = 6;
  PIPE_SHUFFLE_LO = Math.max(1, Math.min(6, PIPE_SHUFFLE_LO));
  PIPE_SHUFFLE_HI = Math.max(1, Math.min(6, PIPE_SHUFFLE_HI));
  if (PIPE_SHUFFLE_LO > PIPE_SHUFFLE_HI) { const _t = PIPE_SHUFFLE_LO; PIPE_SHUFFLE_LO = PIPE_SHUFFLE_HI; PIPE_SHUFFLE_HI = _t; }
  const PIPE_SHUFFLE_INTENSITY = process.env.PIPE_SHUFFLE_INTENSITY === 'full' ? 'full' : 'swap2';
  // 【测试用】后区窄路管道开关
  const PIPE_NARROW = process.env.PIPE_NARROW === '1';
  const PIPE_NARROW_ROW = Number.parseFloat(process.env.PIPE_NARROW_ROW || '0.6');
  const PIPE_NARROW_FRAC = Number.parseFloat(process.env.PIPE_NARROW_FRAC || '0.5'); // 窄路段占行宽比例(温和)
  const iceCount = Math.max(0, Math.round((baseIce + iceBonus) * reliefScale));
  const questionCount = Math.floor(boardCells * QUESTION_RATIO);
  const baseChain = Number.parseInt(process.env.CHAIN_BASE || '1', 10) + Math.floor(regularCells / CHAIN_DIVISOR) + chainBonus;
  const chainCount = Math.max(0, Math.round(baseChain * reliefScale));

  let lastResult = null;
  let fallbackResult = null;
  let lastBlacks = [];
  let lastPipes = [];
  let fallbackBlacks = [];
  let fallbackPipes = [];
  const failCounts = {};
  const countFail = reason => {
    failCounts[reason] = (failCounts[reason] || 0) + 1;
  };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    elementManager.generateBaseBoard(rows, cols);

    let pipes = [];
    let pipeSet = new Set();
    let pipeOk = false;
    // 【测试用】后区窄路管道：造带单缺口的管道墙，逼唯一路线（不跑 run≤3 约束以允许成墙；仍强制可达性，过不了回退普通）
    if (PIPE_NARROW) {
      for (let retry = 0; retry < 30 && !pipeOk; retry++) {
        const cand = buildNarrowPathPipes(rows, cols, pipeCount, new Set(), PIPE_NARROW_ROW, PIPE_NARROW_FRAC, workflow === 'noblack');
        const cset = new Set(cand.map(p => `${p.row},${p.col}`));
        if (cand.length > 0 && isAccessibleFromTop(rows, cols, new Set(), cset)) { pipes = cand; pipeSet = cset; pipeOk = true; }
      }
    }
    // 减压·分散管道：RELIEF_STAGE≥1 时，在多个可用布局里挑"最分散"的(相邻管道对最少)，
    // 缓解管道扎堆形成的前期窄路；管道数量不变、不刻意后移(避免后期卡死)。
    if (!pipeOk && RELIEF_STAGE >= 1) {
      let best = null, bestScore = Infinity;
      for (let retry = 0; retry < 24; retry++) {
        const cand = buildSymmetricPipes(rows, cols, pipeCount, new Set(), { limitPipeRun: workflow === 'noblack' });
        const cset = new Set(cand.map(p => `${p.row},${p.col}`));
        let ok = isAccessibleFromTop(rows, cols, new Set(), cset);
        if (workflow === 'noblack') ok = ok && validatePipeConstraints(cand, rows, cols);
        if (!ok) continue;
        // 评分越小越分散；优先选放满 pipeCount 的布局(放不满的加重罚分)
        const score = pipeClusterScore(cand) + (cand.length >= pipeCount ? 0 : 1000);
        if (score < bestScore) { bestScore = score; best = cand; }
        if (bestScore === 0) break; // 已完全无相邻管道，提前结束
      }
      if (best) { pipes = best; pipeSet = new Set(best.map(p => `${p.row},${p.col}`)); pipeOk = true; }
    }
    // 正常档，或减压时未挑到可用布局：保持原"取第一个可达布局"行为
    for (let retry = 0; retry < 20 && !pipeOk; retry++) {
      pipes = buildSymmetricPipes(rows, cols, pipeCount, new Set(), { limitPipeRun: workflow === 'noblack' });
      pipeSet = new Set(pipes.map(p => `${p.row},${p.col}`));
      pipeOk = isAccessibleFromTop(rows, cols, new Set(), pipeSet);
      if (workflow === 'noblack') pipeOk = pipeOk && validatePipeConstraints(pipes, rows, cols);
    }
    for (const p of pipes) elementManager.setCellAsPipe(p.row, p.col, p.type);

    const pipeExitSet = new Set();
    const dr = { 11: -1, 12: 0, 13: 1, 14: 0 };
    const dc = { 11: 0, 12: 1, 13: 0, 14: -1 };
    for (const p of pipes) {
      const er = p.row + dr[p.type];
      const ec = p.col + dc[p.type];
      if (er >= 0 && er < rows && ec >= 0 && ec < cols) pipeExitSet.add(`${er},${ec}`);
    }
    const pipeAndExitSet = new Set([...pipeSet, ...pipeExitSet]);
    const blacks = workflow === 'black' ? generateBlackBlocks(rows, cols, blackBlockCount, pipeAndExitSet) : [];
    for (const b of blacks) elementManager.setCellAsBlackBlock(b.row, b.col);

    elementManager.resetElements();
    elementManager.generateBaseElements({
      targetManager,
      singleColorExtractPercent: SINGLE_COLOR_EXTRACT_PERCENT,
      spoolBasePixelCount: SPOOL_BASE_PIXEL_COUNT,
      spoolMin: SPOOL_MIN,
      spoolMax: SPOOL_MAX,
      spoolGap: SPOOL_GAP,
      spoolAvg: SPOOL_AVG,
      firstRowRangeMultiplier: FIRST_ROW_RANGE_MULTIPLIER,
      nextRowRangeMultiplier: NEXT_ROW_RANGE_MULTIPLIER,
    });

    // ===== 障碍策略（动态难度平衡）=====
    // 优先级：减压(RELIEF_STAGE≥1 → 后移冰块/锁链) > 区域预设(未被覆盖时) > 加压阶梯(diffLevel)
    // OVERRIDE_PRESET=1 表示加压/减压已触发（候选连续失败后），可绕过模糊的区域预设。
    const obstaclePreset = resolveObstaclePreset(txtBaseName);
    const OVERRIDE_PRESET = process.env.STRATEGY_OVERRIDE_PRESET === '1';
    const usePreset = !OVERRIDE_PRESET;
    const backRow = Number.parseFloat(process.env.BACK_ROW || '0.4');
    const ICE_BACK_FRACTION = Number.parseFloat(process.env.ICE_BACK_FRACTION || '0.5'); // 减压时由 run.js 设 1.0

    // 冰块
    if (RELIEF_STAGE >= 1) {
      // 减压：冰块强后移
      _placeIceBiased(elementManager, iceCount, rows, backRow, ICE_BACK_FRACTION);
    } else if (usePreset && obstaclePreset.ice.length) {
      placeSingleTypeWithRegions(elementManager, 4, iceCount, obstaclePreset.ice, rows, cols, 0);
    } else if (diffLevel >= 2) {
      // 第2轮+（加压）：冰块偏向中后期（row >= rows*后区起始比例）
      _placeIceBiased(elementManager, iceCount, rows, backRow, ICE_BACK_FRACTION);
    } else {
      elementManager.autoPlaceIce(iceCount);
    }

    // 锁链
    if (RELIEF_STAGE >= 1) {
      // 减压：锁链后移
      _placeChainsBiased(elementManager, chainCount, rows, backRow);
    } else if (usePreset && obstaclePreset.chain.length) {
      placeChainsWithRegions(elementManager, chainCount, obstaclePreset.chain, rows, cols);
      if (diffLevel >= 3) _coverChainsWithIce(elementManager, rows);
    } else if (diffLevel >= 3) {
      // 第3轮+（加压）：锁链放置后，在锁链格上覆盖冰块（20%双覆盖、80%单覆盖）
      elementManager.autoPlaceChains(chainCount);
      _coverChainsWithIce(elementManager, rows);
    } else {
      elementManager.autoPlaceChains(chainCount);
    }

    // 问号（减压不改问号——问号是隐藏色、不直接堆暂存；仅走预设/默认）
    if (usePreset && obstaclePreset.question.length) {
      placeSingleTypeWithRegions(elementManager, 6, questionCount, obstaclePreset.question, rows, cols, 1);
    } else {
      elementManager.autoPlaceQuestionMarks(questionCount);
    }

    // ===== 管道内乱序：按区域+比例选中管道，对选定层区间按程度打乱深层球序（产出关=送审关）=====
    if (PIPE_SHUFFLE_RATIO > 0) {
      shufflePipeParams(elementManager, rows, cols, {
        ratio: PIPE_SHUFFLE_RATIO,
        layerLo: PIPE_SHUFFLE_LO,
        layerHi: PIPE_SHUFFLE_HI,
        intensity: PIPE_SHUFFLE_INTENSITY,
        regions: obstaclePreset.pipeShuffle || [],
      });
    }

    const pipeDepthCheck = inspectPipeDepth(elementManager, MAX_PIPE_DEPTH);
    if (!pipeDepthCheck.ok) { countFail('pipe_depth'); continue; }
    // 后区窄路(测试)模式刻意造"半封闭/窄路"，故跳过这些反窄路的结构预筛；
    // 真正的把关交给 isAccessibleFromTop(已过) + 卡死检验 + 菜鸟求解(在测试harness里)。
    if (!PIPE_NARROW) {
      const groupCheck = checkNoTrappedGroups(elementManager);
      if (!groupCheck.ok) { countFail('trapped_groups'); continue; }
      const chainCheck = checkChainDeadlock(elementManager);
      if (chainCheck.deadlocked) { countFail('chain_deadlock'); continue; }
      const halfBlockedCheck = checkHalfBlockedSpoolRuns(elementManager);
      if (!halfBlockedCheck.ok) { countFail('half_blocked_spool_runs'); continue; }
    }
    fallbackResult = {
      result: { success: false },
      steps: 0,
      passed: false,
      levelJSON: makeLevelJSON(targetManager, elementManager),
    };
    fallbackBlacks = blacks;
    fallbackPipes = pipes;

    const result = validate(targetManager, elementManager);
    const steps = new Set((result.log || []).map(e => e.step)).size;
    const passed = result.success;
    lastResult = { result, steps, passed, levelJSON: makeLevelJSON(targetManager, elementManager) };
    lastBlacks = blacks;
    lastPipes = pipes;
    break;
  }

  if (!lastResult && fallbackResult) {
    lastResult = fallbackResult;
    lastBlacks = fallbackBlacks;
    lastPipes = fallbackPipes;
  }

  if (!lastResult) {
    if (process.env.DEBUG_GENERATE_FAILURES) {
      console.error(`DEBUG_FAIL ${path.basename(txtFilePath)} ${JSON.stringify({ totalGroups, rows, cols, pipeCount, pipeDepth, failCounts })}`);
    }
    return { ok: false, passed: false, failReason: 'all_attempts_failed' };
  }
  return {
    ok: true,
    passed: lastResult.passed,
    levelJSON: lastResult.levelJSON,
    stats: {
      totalGroups,
      rows,
      cols,
      colorSequence: colorParams.colorSequence,
      extraColorTypes: colorParams.extraColorTypes,
      extraColorGroups: colorParams.extraColorGroups,
      pipeCount: lastPipes.length,
      pipeDepth: +pipeDepth.toFixed(2),
      blackBlockCount: lastBlacks.length,
      iceCount,
      questionCount,
      chainCount,
      validationSteps: lastResult.steps,
      validationSuccess: lastResult.result.success,
    },
  };
}

function main() {
  const [,, workflow, inputDir, outputDir, outputFormat = 'txt', colorMode = 'supplement'] = process.argv;
  if (!['black', 'noblack'].includes(workflow) || !inputDir || !outputDir) {
    console.error('Usage: node scripts/run_batch_txt_node.js <black|noblack> <inputDir> <outputDir> [txt|json] [supplement|noextra]');
    process.exit(1);
  }
  if (!['txt', 'json'].includes(outputFormat)) {
    console.error('Output format must be txt or json');
    process.exit(1);
  }
  if (!['supplement', 'noextra'].includes(colorMode)) {
    console.error('Color mode must be supplement or noextra');
    process.exit(1);
  }
  const options = { noSupplement: colorMode === 'noextra', difficultyLevel: Number.parseInt(process.env.DIFFICULTY_LEVEL || '1', 10) };
  fs.mkdirSync(outputDir, { recursive: true });
  const files = fs.readdirSync(inputDir)
    .filter(f => f.endsWith('.txt'))
    .sort((a, b) => parseInt(path.basename(a, '.txt'), 10) - parseInt(path.basename(b, '.txt'), 10))
    .map(f => path.join(inputDir, f));
  const generated = [];
  const subpar = [];
  const colorSelectionSummary = [];
  files.forEach((filePath, index) => {
    const idx = index + 1;
    const baseName = path.basename(filePath, '.txt');
    try {
      const result = generateOne(filePath, workflow, options);
      if (!result.ok) {
        subpar.push(baseName);
        console.log(`ERR [${idx}] ${baseName}.txt ${result.failReason}`);
        return;
      }
      const ext = outputFormat === 'json' ? 'json' : 'txt';
      const outName = `${baseName}.${ext}`;
      const body = outputFormat === 'json' ? result.levelJSON + '\n' : levelJSONToTXT(result.levelJSON);
      fs.writeFileSync(path.join(outputDir, outName), body, 'utf8');
      const line = `${result.passed ? 'OK ' : 'SUB'} [${idx}] ${outName} | ${result.stats.rows}x${result.stats.cols} | ${result.stats.totalGroups}组 | 黑块:${result.stats.blackBlockCount} | 步数:${result.stats.validationSteps}`;
      console.log(line);
      colorSelectionSummary.push({
        source: path.basename(filePath),
        output: outName,
        colorSequence: result.stats.colorSequence,
        extraColorTypes: result.stats.extraColorTypes,
        extraColorGroups: result.stats.extraColorGroups,
      });
      (result.passed ? generated : subpar).push(outName);
    } catch (err) {
      subpar.push(baseName);
      console.log(`ERR [${idx}] ${baseName}.txt ${err.message}`);
    }
  });
  if (subpar.length) fs.writeFileSync(path.join(outputDir, 'failed.txt'), subpar.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(outputDir, 'color_selection_summary.json'), JSON.stringify(colorSelectionSummary, null, 2) + '\n', 'utf8');
  console.log(`DONE workflow=${workflow} colorMode=${colorMode} generated=${generated.length} subpar=${subpar.length} total=${files.length}`);
}

if (require.main === module) main();
