#!/usr/bin/env node
'use strict';
/**
 * TxtBase36ToNum_v1 —— 把 base36 符号网格（0-9A-Z）转成数字矩阵（2026-11-22）
 *
 * 背景：《借鉴关卡》原图是 34 色库的 base36 符号网格（B=11、S=28…），
 *       我们的切车/选图工具只认数字矩阵，转换口径固定为 parseInt(ch, 36)。
 *       17 色版同样符号网格，只是符号范围缩小（1-8A-I）。
 *
 * 用法：
 *   node TxtBase36ToNum_v1.js <目录|单个txt> --outdir <目录>
 *
 * 输出：每张图一个 .txt，首行“像素矩阵”，其余每行空格分隔的数字。
 *       输出目录已存在时直接覆盖同名文件。
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const input = argv[0];
const OUTDIR = arg('--outdir', '');
if (!input || !OUTDIR) { console.error('用法: node TxtBase36ToNum_v1.js <目录|单个txt> --outdir <目录>'); process.exit(2); }
fs.mkdirSync(OUTDIR, { recursive: true });

const files = fs.statSync(input).isDirectory()
  ? fs.readdirSync(input).filter(f => f.endsWith('.txt')).map(f => path.join(input, f))
  : [input];

let ok = 0, bad = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').replace(/\r/g, '').trim().split('\n');
  const body = /像素矩阵/.test(lines[0]) ? lines.slice(1) : lines;
  const rows = [];
  let failed = false;
  for (const l of body) {
    const t = l.trim();
    if (!t) continue;
    const row = [];
    for (const ch of t) {
      if (ch === ' ' || ch === ',' || ch === '\t') continue;
      const v = parseInt(ch, 36);
      if (Number.isNaN(v)) { failed = true; break; }
      row.push(v);
    }
    if (failed) break;
    rows.push(row);
  }
  const W = rows.length ? rows[0].length : 0;
  if (failed || !rows.length || rows.some(r => r.length !== W)) {
    console.log('FAIL', path.basename(f), failed ? '非法符号' : '行宽不一致');
    bad++; continue;
  }
  const dst = path.join(OUTDIR, path.basename(f));
  fs.writeFileSync(dst, '像素矩阵\n' + rows.map(r => r.join(' ')).join('\n') + '\n');
  console.log('OK  ', path.basename(f), `${W}x${rows.length}`);
  ok++;
}
console.log(`转换 ${ok} 张，失败 ${bad} 张 -> ${OUTDIR}`);
process.exit(bad ? 1 : 0);
