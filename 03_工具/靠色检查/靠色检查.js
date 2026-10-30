#!/usr/bin/env node
/**
 * 靠色检查（口径来源：`靠色检查说明.md`）
 *
 * 判定规则（说明 §二）：
 *   - 一关里某一组「靠色对」的两种颜色都出现（各 ≥ minPixels 次，默认 1 即出现即算）→ 命中；
 *   - 命中任意一对即判该关命中，可同时命中多对，报告全部列出；
 *   - 判定不依赖 RGB 距离，只认 DEFAULT_PAIRS / --pairs 的固定靠色对表。
 *
 * 统计范围（说明 §四）：
 *   - 目标图 blocks（纯数字或 {id}）——txt 像素矩阵 / JSON 的 blocks；
 *   - 棋盘 spools 的 cell.id（或纯数字 cell）；
 *   - 管道 cell.param 内元素（数组内的 {id} 或纯数字）；
 *   - 只统计正整数颜色编号，忽略 0（空位）/ -1（黑块）。
 *
 * 用法：
 *   node 03_工具/靠色检查/靠色检查.js                     # 默认扫 仓库根/关卡
 *   node 03_工具/靠色检查/靠色检查.js 关卡 实验关
 *   node 03_工具/靠色检查/靠色检查.js --csv 结果.csv --list 命中.txt --json 结果.json
 *   node 03_工具/靠色检查/靠色检查.js --pairs "1,4;2,3" --min-pixels 2
 *   node 03_工具/靠色检查/靠色检查.js --copy-hit 输出/命中关卡
 *   node 03_工具/靠色检查/靠色检查.js --copy-clean 关卡_无靠色
 *   node 03_工具/靠色检查/靠色检查.js --fail-on-hit   # 有命中时退出码 2（给 CI 用）
 *
 * 零依赖，Node 14+。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/* ==================== 默认靠色对（2026-10-26 用户指定 14 对） ====================
 * 1-6 · 1-4 · 4-6 · 2-3 · 2-5 · 3-5 · 2-8 · 3-8
 * 9-10 · 9-11 · 10-11 · 19-22 · 25-29 · 28-29 · 20-22 · 21-23
 *
 * 旧的「靠色检查说明.md §三」7 对（1-4 1-6 2-3 17-18 20-22 28-29 31-32）
 * 不再默认，需要时用 --pairs 显式指定。
 * 色名以主 bin 色表 bin/js/utils.js 的 AntSolver.COLORS 为准。
 */
const DEFAULT_PAIRS = [
  [1, 6], [1, 4], [4, 6], [2, 3], [2, 5], [3, 5], [2, 8],
  [3, 8], [9, 10], [9, 11], [10, 11], [19, 22], [25, 29], [28, 29],
  [20, 22], [21, 23],
];

const COLOR_MAP = {
  1: { name: '红色', hex: '#FF3240' },
  2: { name: '浅红', hex: '#FF269F' },
  3: { name: '粉红', hex: '#FF5294' },
  4: { name: '暗粉', hex: '#DF2455' },
  5: { name: '浅粉', hex: '#FF98A3' },
  6: { name: '深红', hex: '#F63C3F' },
  8: { name: '浅紫粉', hex: '#E749B6' },
  9: { name: '玫红', hex: '#AD00AC' },
  10: { name: '灰紫', hex: '#C538C3' },
  11: { name: '深紫', hex: '#A032DC' },
  19: { name: '浅黄', hex: '#95E502' },
  20: { name: '绿色', hex: '#01CC64' },
  21: { name: '橄榄绿', hex: '#00AEAD' },
  22: { name: '青蓝', hex: '#04DB01' },
  23: { name: '浅绿', hex: '#02CBA9' },
  25: { name: '黄色', hex: '#FFB900' },
  28: { name: '橙色', hex: '#FF8002' },
  29: { name: '深棕2', hex: '#F69602' },
};

function colorName(id) {
  return (COLOR_MAP[id] && COLOR_MAP[id].name) || ('色' + id);
}

/* ==================== 参数 ==================== */

function printHelp() {
  const out = [
    '靠色检查 —— 按《靠色检查说明.md》筛选含靠色对的关卡',
    '',
    '用法：node 靠色检查.js [目录或文件...] [选项]',
    '',
    '选项：',
    '  --min-pixels N     每种颜色至少出现 N 次才算数（默认 1）',
    '  --pairs "a,b;c,d"  覆盖靠色对（默认 2026-10-26 指定的 14 对）',
    '  --out DIR          输出目录（默认 03_工具/靠色检查/输出）',
    '  --csv FILE         另存 CSV 到指定路径（含未命中的关）',
    '  --list FILE        另存命中关文件名清单',
    '  --json FILE        另存机器可读结果',
    '  --no-clean         CSV 里不包含未命中的关',
    '  --copy-hit DIR     把命中的关复制到 DIR（不移动、不改源文件）',
    '  --copy-clean DIR   把未命中的关复制到 DIR（不移动、不改源文件）',
    '  --fail-on-hit      有命中时退出码 2',
    '  --quiet            只在最后打印汇总',
    '  -h, --help         显示本帮助',
  ];
  console.log(out.join('\n'));
}

function parsePairs(text) {
  const list = [];
  const seen = new Set();
  String(text).split(/[;\s]+/).filter(Boolean).forEach(function (item) {
    const m = item.match(/^(\d+)\s*[,\-]\s*(\d+)$/);
    if (!m) throw new Error('靠色对格式不对：' + item + '（应形如 1,4;2,3）');
    let a = Number(m[1]), b = Number(m[2]);
    if (a <= 0 || b <= 0 || a === b) throw new Error('靠色对编号不合法：' + item);
    if (a > b) { const t = a; a = b; b = t; }
    const key = a + ',' + b;
    if (!seen.has(key)) { seen.add(key); list.push([a, b]); }
  });
  if (!list.length) throw new Error('--pairs 没有解析出任何靠色对');
  return list;
}

function parseArgs(argv) {
  const opts = {
    inputs: [],
    pairs: DEFAULT_PAIRS.map(function (p) { return p.slice(); }),
    minPixels: 1,
    outDir: path.join(__dirname, '输出'),
    csv: null,
    list: null,
    json: null,
    copyHit: null,
    copyClean: null,
    includeClean: true,
    quiet: false,
    failOnHit: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else if (a === '--min-pixels') opts.minPixels = Number(argv[++i]);
    else if (a === '--pairs') opts.pairs = parsePairs(argv[++i]);
    else if (a === '--out') opts.outDir = path.resolve(argv[++i]);
    else if (a === '--csv') opts.csv = path.resolve(argv[++i]);
    else if (a === '--list') opts.list = path.resolve(argv[++i]);
    else if (a === '--json') opts.json = path.resolve(argv[++i]);
    else if (a === '--copy-hit') opts.copyHit = path.resolve(argv[++i]);
    else if (a === '--copy-clean') opts.copyClean = path.resolve(argv[++i]);
    else if (a === '--no-clean') opts.includeClean = false;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--fail-on-hit') opts.failOnHit = true;
    else if (a === '--') { opts.inputs = opts.inputs.concat(argv.slice(i + 1)); break; }
    else if (a.charAt(0) === '-') { throw new Error('未知参数：' + a + '（-h 看帮助）'); }
    else opts.inputs.push(a);
  }
  if (!(opts.minPixels >= 1) || !Number.isFinite(opts.minPixels)) {
    throw new Error('--min-pixels 必须是 ≥1 的整数');
  }
  opts.minPixels = Math.floor(opts.minPixels);
  if (!opts.inputs.length) opts.inputs = [path.join(REPO_ROOT, '关卡')];
  opts.inputs = opts.inputs.map(function (p) { return path.resolve(process.cwd(), p); });
  return opts;
}

/* ==================== 读取与解析 ==================== */

function listLevelFiles(inputs) {
  const files = [];
  const exts = /\.(txt|json)$/i;
  inputs.forEach(function (input) {
    const st = fs.existsSync(input) ? fs.statSync(input) : null;
    if (!st) throw new Error('路径不存在：' + input);
    if (st.isFile()) {
      if (!exts.test(input)) throw new Error('只支持 .txt / .json：' + input);
      files.push(input);
      return;
    }
    if (!st.isDirectory()) throw new Error('既不是文件也不是目录：' + input);
    fs.readdirSync(input).forEach(function (name) {
      if (name.charAt(0) === '.') return;
      if (!exts.test(name)) return;
      const full = path.join(input, name);
      if (fs.statSync(full).isFile()) files.push(full);
    });
  });
  const uniq = Array.from(new Set(files));
  uniq.sort(function (a, b) {
    return path.basename(a).localeCompare(path.basename(b), 'zh-Hans-CN', { numeric: true });
  });
  return uniq;
}

function parseMatrixTxt(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  raw.split(/\r?\n/).forEach(function (line) {
    const t = line.trim();
    if (!t) return;
    const parts = t.split(/\s+/);
    if (!parts.every(function (p) { return /^-?\d+$/.test(p); })) return; // 跳过「像素矩阵」等表头
    rows.push(parts.map(Number));
  });
  if (!rows.length) throw new Error('没读到数字行（不是像素矩阵 txt？）');
  // 兼容「38 38」这类尺寸行
  if (rows.length > 2 && rows[0].length <= 2 && rows[1].length > 2) rows.shift();
  const width = rows[0].length;
  if (width < 2) throw new Error('第一行只有 ' + width + ' 个数字，不像像素矩阵');
  rows.forEach(function (r, i) {
    if (r.length !== width) {
      throw new Error('第 ' + (i + 1) + ' 行有 ' + r.length + ' 个数字，与首行 ' + width + ' 不一致');
    }
  });
  return { blocks: rows, spools: null };
}

function parseJsonLevel(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error('JSON 解析失败：' + e.message);
  }
  if (Array.isArray(data)) return { blocks: data, spools: null };
  if (data && Array.isArray(data.blocks)) return data;
  if (data && data.level && Array.isArray(data.level.blocks)) return data.level;
  throw new Error('JSON 里找不到 blocks 数组');
}

function loadLevel(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === '.json' ? parseJsonLevel(file) : parseMatrixTxt(file);
}

/* ==================== 统计与判定 ==================== */

function collectColorCounts(level) {
  const counts = {};
  const add = function (v) {
    let id = null;
    if (typeof v === 'number') id = v;
    else if (v && typeof v === 'object' && typeof v.id === 'number') id = v.id;
    if (id !== null && id > 0 && Number.isFinite(id)) counts[id] = (counts[id] || 0) + 1;
  };

  if (!level) return counts;

  if (Array.isArray(level.blocks)) {
    level.blocks.forEach(function (row) {
      if (!Array.isArray(row)) return;
      row.forEach(function (cell) {
        if (Array.isArray(cell)) cell.forEach(add); // 个别导出把一格写成数组
        else add(cell);
      });
    });
  }

  if (Array.isArray(level.spools)) {
    level.spools.forEach(function (row) {
      if (!Array.isArray(row)) return;
      row.forEach(function (cell) {
        if (cell === null || cell === undefined) return;
        if (typeof cell === 'number') { add(cell); return; }
        add(cell.id);
        if (Array.isArray(cell.param)) cell.param.forEach(add); // 管道内元素
      });
    });
  }

  return counts;
}

function auditCounts(counts, pairs, minPixels) {
  const hits = [];
  pairs.forEach(function (pair) {
    const a = pair[0], b = pair[1];
    const ca = counts[a] || 0, cb = counts[b] || 0;
    if (ca >= minPixels && cb >= minPixels) {
      hits.push({
        a: a, b: b,
        nameA: colorName(a), nameB: colorName(b),
        countA: ca, countB: cb,
        pair: a + ',' + b,
      });
    }
  });
  return hits;
}

/* ==================== 输出 ==================== */

function rel(file) {
  const r = path.relative(REPO_ROOT, file);
  return r && r.charAt(0) !== '.' ? r : file;
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeCsv(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n', 'utf8');
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function describeHit(h) {
  return h.a + ' ' + h.nameA + '(' + h.countA + ') ↔ ' + h.b + ' ' + h.nameB + '(' + h.countB + ')';
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = listLevelFiles(opts.inputs);

  const levels = [];
  files.forEach(function (file) {
    let level;
    try {
      level = loadLevel(file);
    } catch (e) {
      console.error('[跳过] ' + rel(file) + '：' + e.message);
      return;
    }
    const counts = collectColorCounts(level);
    const hits = auditCounts(counts, opts.pairs, opts.minPixels);
    const rows = Array.isArray(level.blocks) ? level.blocks.length : 0;
    const cols = rows ? level.blocks[0].length : 0;
    levels.push({
      file: file,
      name: path.basename(file),
      size: rows ? rows + 'x' + cols : '-',
      hit: hits.length > 0,
      pairs: hits,
      counts: counts,
    });
  });

  const hitLevels = levels.filter(function (l) { return l.hit; });
  const cleanLevels = levels.filter(function (l) { return !l.hit; });

  const pairFreq = opts.pairs.map(function (p) {
    const key = p[0] + ',' + p[1];
    return {
      pair: key,
      label: p[0] + ' ' + colorName(p[0]) + ' ↔ ' + p[1] + ' ' + colorName(p[1]),
      levels: hitLevels.filter(function (l) {
        return l.pairs.some(function (h) { return h.pair === key; });
      }).length,
    };
  });

  if (!opts.quiet) {
    console.log('=== 靠色检查 ===');
    console.log('口径：' + opts.pairs.length + ' 对靠色对（默认 2026-10-26 指定）；minPixels=' + opts.minPixels);
    console.log('输入：' + opts.inputs.map(rel).join('，') + '（' + levels.length + ' 个关卡文件）');
    console.log('');
    if (hitLevels.length) {
      console.log('[命中] ' + hitLevels.length + ' / ' + levels.length + ' 关');
      hitLevels.forEach(function (l, i) {
        console.log(pad(i + 1) + '. ' + l.name + '  ' + l.size + '  ' + l.pairs.length + ' 对：' +
          l.pairs.map(describeHit).join('；'));
      });
    } else {
      console.log('[命中] 0 / ' + levels.length + ' 关');
    }
    console.log('');
    console.log('[未命中] ' + cleanLevels.length + ' / ' + levels.length + ' 关');
    if (cleanLevels.length) console.log(cleanLevels.map(function (l) { return l.name; }).join('\n'));
    console.log('');
    console.log('[各靠色对命中关数]');
    pairFreq.forEach(function (p) {
      console.log('  ' + pad(String(p.levels), 4) + ' 关  ' + p.label);
    });
  }

  // 默认落盘：CSV + 命中清单 + JSON
  const stamp = new Date();
  const csvRows = [['关卡文件', '尺寸', '命中靠色', '命中对数', '靠色对明细']];
  levels.forEach(function (l) {
    if (!l.hit && !opts.includeClean) return;
    csvRows.push([
      l.name,
      l.size,
      l.hit ? '是' : '否',
      String(l.pairs.length),
      l.pairs.map(describeHit).join('；'),
    ]);
  });
  const csvPath = opts.csv || path.join(opts.outDir, '靠色检查结果.csv');
  const listPath = opts.list || path.join(opts.outDir, '命中关卡.txt');
  const jsonPath = opts.json || path.join(opts.outDir, '靠色检查结果.json');

  writeCsv(csvPath, csvRows);
  writeText(listPath, hitLevels.map(function (l) { return l.name; }).join('\n') + (hitLevels.length ? '\n' : ''));
  const jsonOut = {
    generatedAt: stamp.toISOString(),
    rule: { source: '2026-10-26 用户指定 14 对（可用 --pairs 覆盖）', pairs: opts.pairs, minPixels: opts.minPixels },
    inputs: opts.inputs.map(rel),
    summary: {
      total: levels.length,
      hit: hitLevels.length,
      clean: cleanLevels.length,
      pairHits: pairFreq,
    },
    levels: levels.map(function (l) {
      return {
        file: rel(l.file),
        size: l.size,
        hit: l.hit,
        pairs: l.pairs,
        colorCounts: l.counts,
      };
    }),
  };
  writeText(jsonPath, JSON.stringify(jsonOut, null, 2) + '\n');

  if (opts.quiet) {
    console.log('靠色检查：' + levels.length + ' 关，命中 ' + hitLevels.length + '，未命中 ' + cleanLevels.length);
  }
  console.log('');
  console.log('CSV：' + rel(csvPath));
  console.log('命中清单：' + rel(listPath));
  console.log('JSON：' + rel(jsonPath));

  function copyLevels(list, dir, label) {
    fs.mkdirSync(dir, { recursive: true });
    list.forEach(function (l) {
      fs.copyFileSync(l.file, path.join(dir, l.name));
    });
    console.log('已复制 ' + list.length + ' 个' + label + '到：' + rel(dir));
  }

  if (opts.copyHit) copyLevels(hitLevels, opts.copyHit, '命中关');
  if (opts.copyClean) copyLevels(cleanLevels, opts.copyClean, '未命中关');

  if (opts.failOnHit && hitLevels.length) process.exit(2);
}

function pad(v, n) {
  let s = String(v);
  while (s.length < (n || 3)) s = ' ' + s;
  return s;
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('错误：' + e.message);
    process.exit(1);
  }
}

// 供别的脚本/校验引用（require 时不会执行 main）
module.exports = {
  DEFAULT_PAIRS: DEFAULT_PAIRS,
  COLOR_MAP: COLOR_MAP,
  colorName: colorName,
  parsePairs: parsePairs,
  parseMatrixTxt: parseMatrixTxt,
  parseJsonLevel: parseJsonLevel,
  loadLevel: loadLevel,
  collectColorCounts: collectColorCounts,
  auditCounts: auditCounts,
  listLevelFiles: listLevelFiles,
};
