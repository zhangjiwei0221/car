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
const REAL_COLOR_LIBRARY_PATH = path.resolve(__dirname, '../../config/标准色库毛线真实.txt');
const SOFT_AVOID_EXTRA_COLOR_IDS = new Set([2]);
const MAX_PIPE_DEPTH = 6;
const MAX_ATTEMPTS = 100;

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
  return new YarnLevel.LevelValidator(targetManager.getData(), elementManager.getData()).validate();
}

function generateOne(txtFilePath, workflow) {
  const targetManager = new YarnLevel.TargetZoneManager();
  const elementManager = new YarnLevel.ElementZoneManager();
  const parsed = YarnLevel.parseTXT(fs.readFileSync(txtFilePath, 'utf8'));
  if (YarnLevel.isParseError(parsed)) throw new Error(parsed.message || 'TXT parse failed');
  targetManager.loadRawData(parsed, DEFAULT_COLOR_ID);

  const colorParams = generateColorSequenceParams(extractTxtColors(txtFilePath));
  targetManager.generateSupplementColors({
    extraColorTypes: colorParams.extraColorTypes,
    extraColorGroups: colorParams.extraColorGroups,
    colorSequence: colorParams.colorSequence,
    questionCount: 0,
  });
  const totalGroups = targetManager.getColorGroupStats().totalGroups;
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
  const iceCount = Math.floor(boardCells * 0.15);
  const questionCount = Math.floor(boardCells * 0.25);
  const chainCount = 1 + Math.floor(regularCells / 20);

  let lastResult = null;
  let fallbackResult = null;
  let lastBlacks = [];
  let lastPipes = [];
  let fallbackBlacks = [];
  let fallbackPipes = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    elementManager.generateBaseBoard(rows, cols);

    let pipes = [];
    let pipeSet = new Set();
    let pipeOk = false;
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
    elementManager.generateBaseElements({ targetManager });
    elementManager.autoPlaceIce(iceCount);
    elementManager.autoPlaceChains(chainCount);
    elementManager.autoPlaceQuestionMarks(questionCount);

    const pipeDepthCheck = inspectPipeDepth(elementManager, MAX_PIPE_DEPTH);
    if (!pipeDepthCheck.ok) continue;
    const groupCheck = checkNoTrappedGroups(elementManager);
    if (!groupCheck.ok) continue;
    const chainCheck = checkChainDeadlock(elementManager);
    if (chainCheck.deadlocked) continue;
    const halfBlockedCheck = checkHalfBlockedSpoolRuns(elementManager);
    if (!halfBlockedCheck.ok) continue;
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
  const [,, workflow, inputDir, outputDir, outputFormat = 'txt'] = process.argv;
  if (!['black', 'noblack'].includes(workflow) || !inputDir || !outputDir) {
    console.error('Usage: node scripts/run_batch_txt_node.js <black|noblack> <inputDir> <outputDir> [txt|json]');
    process.exit(1);
  }
  if (!['txt', 'json'].includes(outputFormat)) {
    console.error('Output format must be txt or json');
    process.exit(1);
  }
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
      const result = generateOne(filePath, workflow);
      if (!result.ok) {
        subpar.push(baseName);
        console.log(`ERR [${idx}] ${baseName}.txt ${result.failReason}`);
        return;
      }
      const ext = outputFormat === 'json' ? 'json' : 'txt';
      const outName = result.passed
        ? `${String(idx).padStart(3, '0')}_${baseName}.${ext}`
        : `${String(idx).padStart(3, '0')}_🔴_${baseName}.${ext}`;
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
  console.log(`DONE workflow=${workflow} generated=${generated.length} subpar=${subpar.length} total=${files.length}`);
}

if (require.main === module) main();
