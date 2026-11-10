#!/usr/bin/env node
'use strict';
/**
 * LevelToRecipe_v1 —— 把现有关卡 JSON 反推成 BuildFromRecipe 可读的配方
 *
 * 用途：产线 v3 要修改 G2 2–13 / 旧 v1 关卡时，先把 level 的 spools 拆成
 *       cars / black / obstacles / pipes，再交给 BuildFromRecipe / M5Build 重建。
 *
 * 用法：
 *   node LevelToRecipe_v1.js <关卡.json> --out <配方.json>
 *
 * 映射：
 *   spools[r][c] = {id,type,param,count}
 *     id>0                  → cars {r,c,id,count}
 *     type 11–14            → pipes {r,c,type,param}
 *     type=[...] / type!=0  → obstacles {r,c,type,param[,q]}
 *     id<=0 且非管道        → black [r,c]
 */
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
const outFile = arg('--out', null);
if (!levelFile || !outFile) {
  console.error('用法: node LevelToRecipe_v1.js <关卡.json> --out <配方.json>');
  process.exit(2);
}
const g = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
if (!g || !Array.isArray(g.blocks) || !Array.isArray(g.spools)) throw new Error('不是关卡 JSON');
const recipe = {
  name: g.name || path.basename(levelFile, '.json'),
  blocks: g.blocks,
  toprow: g.toprow,
  maprow: g.maprow,
  mapcol: g.mapcol,
  cars: [],
  black: [],
  obstacles: [],
  pipes: []
};
for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
  const s = g.spools[r][c];
  if (!s) { recipe.black.push([r, c]); continue; }
  const type = s.type;
  if (Array.isArray(type)) {
    if (s.id > 0) recipe.cars.push({ r, c, id: s.id, count: s.count });
    else recipe.black.push([r, c]);
    recipe.obstacles.push({ r, c, type: type.slice(), param: s.param != null ? s.param : 0, ...(s.q ? { q: true } : {}) });
    continue;
  }
  if (type >= 11 && type <= 14) {
    recipe.pipes.push({ r, c, type, param: s.param });
    continue;
  }
  if (s.id > 0) recipe.cars.push({ r, c, id: s.id, count: s.count });
  else recipe.black.push([r, c]);
  if (type !== 0 || s.q) {
    recipe.obstacles.push({ r, c, type, param: s.param != null ? s.param : 0, ...(s.q ? { q: true } : {}) });
  }
}
fs.writeFileSync(outFile, JSON.stringify(recipe, null, 1));
console.log('已写：' + outFile);
console.log('cars ' + recipe.cars.length + '，black ' + recipe.black.length + '，obstacles ' + recipe.obstacles.length + '，pipes ' + recipe.pipes.length);
