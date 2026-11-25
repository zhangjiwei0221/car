#!/usr/bin/env node
'use strict';
/**
 * ExtractJsonTxt_v1.js —— 从关卡 JSON 的 blocks/pixels/txt 字段提取像素矩阵 TXT
 *
 * 用途：桌面「大图」里的 G1_bq_level_*.json 只存了 blocks 矩阵；本脚本把矩阵还原成
 *       「像素矩阵」+ 逐行数字 的 TXT，之后可直接喂给 SplitLevel_v722 / PrepImage_v1 造关。
 *
 * 用法：
 *   node ExtractJsonTxt_v1.js
 *   node ExtractJsonTxt_v1.js --dir /Users/red/Desktop/大图 --out /Users/red/Desktop/大图_txt
 *   node ExtractJsonTxt_v1.js --force        # 覆盖已存在的 txt
 *   node ExtractJsonTxt_v1.js --no-header    # 不写「像素矩阵」首行
 *   node ExtractJsonTxt_v1.js --no-manifest  # 不写 manifest.json
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(k);

const DIR = arg('--dir', '/Users/red/Desktop/大图');
const OUT = arg('--out', '/Users/red/Desktop/大图_txt');
const FORCE = has('--force');
const HEADER = !has('--no-header');
const MANIFEST = !has('--no-manifest');

function parseMatrixFromText(txt) {
  const lines = String(txt).trim().split(/\r?\n/).filter(l => /^\s*\d/.test(l));
  return lines.map(l => l.trim().split(/\s+/).map(Number));
}

function getMatrix(obj) {
  if (Array.isArray(obj)) return obj;
  for (const key of ['blocks', 'pixels', 'txt', 'map', 'matrix']) {
    const v = obj && obj[key];
    if (!v) continue;
    if (typeof v === 'string') return parseMatrixFromText(v);
    if (Array.isArray(v)) return v;
  }
  return null;
}

function normalizeMatrix(mat) {
  if (!Array.isArray(mat) || !mat.length) return null;
  const rows = mat.map(r => Array.isArray(r) ? r.map(Number) : parseMatrixFromText(r)[0] || []);
  const cols = rows[0].length;
  if (!cols) return null;
  for (const r of rows) if (r.length !== cols) return null;
  return rows;
}

function stats(mat) {
  const cnt = {};
  let zeros = 0;
  for (const row of mat) for (const v of row) {
    if (v > 0) cnt[v] = (cnt[v] || 0) + 1;
    else zeros++;
  }
  const vals = Object.values(cnt);
  const colors = vals.length;
  return {
    rows: mat.length,
    cols: mat[0].length,
    colors,
    zeroPixels: zeros,
    fullSquare: mat.length === mat[0].length && zeros === 0,
    minColorPx: colors ? Math.min(...vals) : 0,
    maxColor: colors ? Math.max(...Object.keys(cnt).map(Number)) : 0,
    has31and32: !!(cnt[31] && cnt[32])
  };
}

function main() {
  if (!fs.existsSync(DIR)) { console.error('目录不存在: ' + DIR); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const manifest = [];
  let ok = 0, skip = 0, bad = 0;

  for (const file of files) {
    const src = path.join(DIR, file);
    let obj;
    try { obj = JSON.parse(fs.readFileSync(src, 'utf8')); }
    catch (e) { console.error('跳过（JSON 解析失败）: ' + file + ' :: ' + e.message); bad++; continue; }

    const mat = normalizeMatrix(getMatrix(obj));
    if (!mat) { console.error('跳过（找不到 blocks/pixels/txt 矩阵）: ' + file); bad++; continue; }

    const outName = file.replace(/\.json$/i, '.txt');
    const dst = path.join(OUT, outName);
    if (fs.existsSync(dst) && !FORCE) { console.log('跳过（已存在，--force 可覆盖）: ' + outName); skip++; continue; }

    const lines = (HEADER ? ['像素矩阵'] : []).concat(mat.map(r => r.join(' ')));
    fs.writeFileSync(dst, lines.join('\n') + '\n');
    const st = stats(mat);
    manifest.push({ file, out: outName, ...st, sourceMap: { maprow: obj.maprow, mapcol: obj.mapcol, toprow: obj.toprow } });
    ok++;
    console.log(`OK ${file} -> ${outName}  ${st.cols}x${st.rows} 色${st.colors} 零${st.zeroPixels} 满格${st.fullSquare}`);
  }

  if (MANIFEST) {
    const mf = path.join(OUT, 'manifest.json');
    fs.writeFileSync(mf, JSON.stringify({ generated: new Date().toISOString(), dir: DIR, count: manifest.length, files: manifest }, null, 1));
    console.log('manifest: ' + mf);
  }
  console.log(`\n完成：成功 ${ok}，跳过 ${skip}，失败 ${bad}，输出目录 ${OUT}`);
}

main();
