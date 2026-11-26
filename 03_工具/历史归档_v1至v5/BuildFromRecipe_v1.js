#!/usr/bin/env node
'use strict';
/**
 * BuildFromRecipe_v1 —— 用「关卡配方」重建关卡 JSON（可复现）
 *
 * 配方 = 目标图 + 每辆车的位置/颜色/容量 + 黑格 + 障碍。
 * 不负责设计；只负责把手工改过的关卡固化成可重跑的数据。
 *
 * 用法：
 *   node 03_工具/正式版/BuildFromRecipe_v1.js 配方.json --out 重建.json
 *
 * 配方字段：
 *   {
 *     "name": "...",
 *     "target": "test/00085_四框_门色独占.txt",   // 或 "blocks": [[...]]
 *     "toprow": 40, "maprow": 7, "mapcol": 7,
 *     "cars":   [{"r":0,"c":0,"id":29,"count":80}, ...],
 *     "black":  [[0,2],[0,6], ...],
 *     "obstacles": [{"r":3,"c":5,"types":[{"type":7,"param":20}]}, ...],
 *     "pipes":  [{"r":2,"c":2,"type":11,"param":[{"id":23,"count":23}]}]
 *   }
 *   障碍也支持 {"r":3,"c":0,"type":5,"param":1} 原样覆盖，
 *   以及 {"r":6,"c":2,"type":[0,6],"param":0,"q":true} 问号标记。
 *
 * 校验：
 *   - 格子全部是车/黑格/管道格（无空格）
 *   - 每色容量合计 == 该色像素数（含管道队列里的车）
 *   - 车格/黑格不重复、不越界
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function arg(k, d) {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
}

function readTarget(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  const rows = [];
  for (const line of txt) {
    const t = line.trim();
    if (!t || /[^\d\s]/.test(t)) continue; // 跳过「像素矩阵」标题
    rows.push(t.split(/\s+/).map(Number));
  }
  if (!rows.length) throw new Error('目标图没有读到数字行：' + file);
  const w = rows[0].length;
  for (const r of rows) if (r.length !== w) throw new Error('目标图行宽不一致');
  return rows;
}

function main() {
  const recipeFile = process.argv[2];
  const outFile = arg('--out', '');
  if (!recipeFile || !outFile) {
    console.error('用法: node BuildFromRecipe_v1.js <配方.json> --out <关卡.json>');
    process.exit(2);
  }
  const recipe = JSON.parse(fs.readFileSync(recipeFile, 'utf8'));
  const blocks = recipe.blocks || readTarget(path.resolve(ROOT, recipe.target));
  const H = blocks.length, W = blocks[0].length;
  const rows = recipe.maprow, cols = recipe.mapcol;
  if (!(rows > 0 && cols > 0)) throw new Error('配方缺 maprow/mapcol');
  if (H !== recipe.toprow) throw new Error('toprow 与目标图行数不一致：' + H + ' vs ' + recipe.toprow);

  const spools = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ id: -1, type: 0, param: 0, count: 0 }))
  );
  const used = new Set();
  const put = (r, c, what) => {
    if (!(r >= 0 && r < rows && c >= 0 && c < cols)) throw new Error(what + ' 越界：' + r + ',' + c);
    const key = r + ',' + c;
    if (used.has(key)) throw new Error(what + ' 重复占用：' + key);
    used.add(key);
  };
  for (const [r, c] of recipe.black || []) {
    put(r, c, '黑格');
    spools[r][c] = { id: -1, type: 0, param: 0, count: 0 };
  }
  for (const car of recipe.cars || []) {
    put(car.r, car.c, '车 ' + car.id + ':' + car.count);
    spools[car.r][car.c] = { id: car.id, type: 0, param: 0, count: car.count };
  }
  // 管道格：id=0，type=11–14，param=队列 [{id,count},...]
  for (const pipe of recipe.pipes || []) {
    put(pipe.r, pipe.c, '管道');
    spools[pipe.r][pipe.c] = {
      id: 0,
      type: pipe.type,
      param: pipe.param != null ? pipe.param : 0,
      count: 0
    };
  }
  for (const ob of recipe.obstacles || []) {
    const cell = spools[ob.r] && spools[ob.r][ob.c];
    if (!cell || cell.id <= 0) throw new Error('障碍目标不是车：' + ob.r + ',' + ob.c);
    // 原样覆盖（用于 type=[5,6]、param=1 这类多类型同格）
    if (ob.type != null) {
      cell.type = ob.type;
      cell.param = ob.param != null ? ob.param : 0;
      if (ob.q) cell.q = true;
      continue;
    }
    const types = (ob.types || []).filter(x => x && x.type);
    if (!types.length) continue;
    if (types.length === 1) {
      cell.type = types[0].type;
      cell.param = types[0].param || 0;
    } else {
      cell.type = types.map(x => x.type);
      cell.param = types.map(x => x.param || 0);
    }
    if (ob.q) cell.q = true;
  }

  // 无空格（管道格 id=0 且 type=11–14 算合法）
  let empty = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = spools[r][c];
    const isPipe = s && s.id === 0 && s.type >= 11 && s.type <= 14;
    if (!s || (s.id <= 0 && s.id !== -1 && !isPipe)) empty++;
  }
  // 每色守恒（管道队列里的车也算容量）
  const px = {};
  for (const row of blocks) for (const v of row) if (v > 0) px[v] = (px[v] || 0) + 1;
  const by = {};
  for (const row of spools) for (const s of row) if (s.id > 0) (by[s.id] = by[s.id] || []).push(s.count);
  for (const pipe of recipe.pipes || []) {
    const q = Array.isArray(pipe.param) ? pipe.param : [];
    for (const car of q) if (car && car.id > 0) (by[car.id] = by[car.id] || []).push(car.count);
  }
  const bad = [];
  for (const k of Object.keys(px)) {
    const sum = (by[k] || []).reduce((a, b) => a + b, 0);
    if (sum !== px[k]) bad.push('色' + k + ' 像素' + px[k] + ' 车' + sum);
  }
  const level = { toprow: recipe.toprow, blocks, maprow: rows, mapcol: cols, spools };
  fs.writeFileSync(outFile, JSON.stringify(level));
  const carCount = Object.values(by).reduce((a, b) => a + b.length, 0);
  console.log('已写：' + outFile);
  console.log('车 ' + carCount + '，黑 ' + (recipe.black || []).length + '，空格 ' + empty);
  if (empty) throw new Error('有空格：' + empty);
  if (bad.length) throw new Error('容量不守恒：' + bad.join('；'));
  console.log('守恒 OK');
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
