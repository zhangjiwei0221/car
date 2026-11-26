#!/usr/bin/env node
'use strict';
/**
 * SubjectDetect_v800 —— 从目标图里识别「主体」
 *
 * 背景（2026-11-03 用户 + mentor）：
 *   「主体不会很散，知道自己要消除哪个」是目标感的核心。
 *   之前用「象限并行度」当代理是错的——它把背景色也算进去了（食物图 3.98，但视觉上不乱）。
 *
 * 做法：用 `图/蚂蚁图库/拼接图/主体图纸库_*` 的模板（18×18）做滑窗匹配，
 *       颜色号与目标图一致，因此可以直接精确匹配；命中后取其非零像素为「主体区域」。
 *
 * 用法（CLI）：
 *   node SubjectDetect_v800.js <关卡.json 或 图.txt>
 * 用法（模块）：
 *   const { detect } = require('./SubjectDetect_v800');
 *   const subs = detect(blocks2D);   // [{name, cells:Set("y,x"), size, score}]
 */
const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '../../图/蚂蚁图库/拼接图');
const MIN_SCORE = 0.80;
const MIN_DIST = 9;

function readMat(f) {
  const l = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).filter(x => x.trim());
  return l.slice(1).map(r => r.trim().split(/\s+/).map(Number));
}

let _tpls = null;
function loadTemplates() {
  if (_tpls) return _tpls;
  _tpls = [];
  if (!fs.existsSync(BASE)) return _tpls;
  for (const d of fs.readdirSync(BASE)) {
    const dp = path.join(BASE, d);
    if (!fs.statSync(dp).isDirectory()) continue;
    for (const f of fs.readdirSync(dp)) {
      if (!f.endsWith('.txt')) continue;
      try {
        const m = readMat(path.join(dp, f));
        if (m.length === 18 && m[0].length === 18) _tpls.push({ name: d + '/' + f.replace(/\.txt$/, ''), m });
      } catch (e) { /* 跳过坏文件 */ }
    }
  }
  return _tpls;
}

function detect(img) {
  const tpls = loadTemplates();
  if (!tpls.length || !img || !img.length) return [];
  const H = img.length, W = img[0].length;
  if (H < 18 || W < 18) return [];
  const hits = [];
  for (const t of tpls) {
    const T = t.m;
    let best = { score: 0 };
    for (let y = 0; y <= H - 18; y++) {
      for (let x = 0; x <= W - 18; x++) {
        let hit = 0, total = 0;
        for (let ty = 0; ty < 18; ty++) {
          for (let tx = 0; tx < 18; tx++) {
            const tv = T[ty][tx];
            if (tv <= 0) continue;
            total++;
            if (img[y + ty][x + tx] === tv) hit++;
          }
        }
        const s = hit / total;
        if (s > best.score) best = { score: s, y, x };
      }
    }
    if (best.score >= MIN_SCORE) hits.push({ name: t.name, score: best.score, y: best.y, x: best.x });
  }
  hits.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const h of hits) {
    if (kept.some(k => Math.abs(k.y - h.y) < MIN_DIST && Math.abs(k.x - h.x) < MIN_DIST)) continue;
    kept.push(h);
  }
  return kept.map(k => {
    const T = tpls.find(t => t.name === k.name).m;
    const cells = new Set();
    for (let ty = 0; ty < 18; ty++) for (let tx = 0; tx < 18; tx++) if (T[ty][tx] > 0) cells.add((k.y + ty) + ',' + (k.x + tx));
    return { name: k.name, cells: cells, size: cells.size, score: k.score, y: k.y, x: k.x };
  });
}

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error('用法：node SubjectDetect_v800.js <关卡.json 或 图.txt>'); process.exit(2); }
  let img;
  if (f.endsWith('.json')) img = JSON.parse(fs.readFileSync(f, 'utf8')).blocks;
  else img = readMat(f);
  const subs = detect(img);
  console.log('图 ' + img.length + 'x' + img[0].length + '，识别到 ' + subs.length + ' 个主体：');
  subs.forEach(function (s) {
    console.log('  ' + s.name.padEnd(36) + ' (' + s.y + ',' + s.x + ') ' + (100 * s.score).toFixed(0) + '%  ' + s.size + 'px');
  });
  if (!subs.length) console.log('  （图库里没有对应模板——这张图可能不是用图库拼的）');
}

module.exports = { detect, loadTemplates };
