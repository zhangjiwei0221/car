#!/usr/bin/env node
'use strict';
/**
 * opening_stats —— C7 开局网格：开局（step 0）实际可点数、第 0 行救援车数、逐车首点 ratio
 * C7_开局网格（2026-11-12）
 *
 * 用法：node opening_stats.js <关卡.json> --out <结果.json>
 *
 * 口径（与 PopulationSim_v1 / measure.js 一致）：
 *   createState(lv, {useSlotStart:true, instantChain:false})
 *   合法可点 = Sim.listMoves(s).filter(m => !m.blocked)（数字冰锁着的车 isPickable=false，不在列表里）
 *   首点 gain = cloneState + applyPick 后的 eliminatedPixels 增量
 *   ratio = gain / count；救援车 = ratio >= 1
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
if (!levelFile || levelFile.startsWith('--')) {
  console.error('用法: node opening_stats.js <关卡.json> --out <结果.json>');
  process.exit(2);
}
const OUT = arg('--out', `/tmp/c7_open_${process.pid}.json`);
const game = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));
const s = Sim.createState(lv, { useSlotStart: true, instantChain: false });

// 冰锁着的格（step0）
const frozen = [];
for (const row of game.spools) for (const sp of row) {
  if (!sp || !(sp.id > 0)) continue;
  const types = Array.isArray(sp.type) ? sp.type : [sp.type];
  if (types.includes(7)) frozen.push({ r: game.spools.indexOf(row), c: row.indexOf(sp), color: sp.id, count: sp.count, n: sp.param });
}

const moves = Sim.listMoves(s).filter(m => !m.blocked);
const cells = moves.map(m => {
  const box = m.antBox;
  const count = box.count || 0;
  if (frozen.some(f => f.r === m.r && f.c === m.c && f.color === box.color && f.count === count)) {
    // 理论上不会出现：冰锁着的不该在 listMoves 里
    throw new Error(`r${m.r}c${m.c} 被冰锁着却出现在合法可点列表`);
  }
  const t = St.cloneState(s);
  const e0 = t.eliminatedPixels;
  const ok = Sim.applyPick(t, m.r, m.c);
  const gain = ok ? t.eliminatedPixels - e0 : 0;
  return { r: m.r, c: m.c, color: box.color, count, gain, ratio: count ? Math.round(gain / count * 1e4) / 1e4 : 0, rescue: count > 0 && gain >= count };
});
const row0 = cells.filter(x => x.r === 0);
const out = {
  level: path.resolve(levelFile),
  openingLegalMoves: cells.length,
  openingRow0Moves: row0.length,
  rescueCars: cells.filter(x => x.rescue).length,
  row0RescueCars: row0.filter(x => x.rescue).length,
  frozen,
  cells
};
console.log(`${path.basename(levelFile)}  开局可点=${out.openingLegalMoves}  第0行可点=${out.openingRow0Moves}  救援车=${out.rescueCars}（第0行 ${out.row0RescueCars}）  冰=${frozen.length}`);
for (const x of cells) console.log(`  r${x.r}c${x.c} ${String(x.color).padStart(2)}/${String(x.count).padEnd(3)} gain=${String(x.gain).padEnd(3)} ratio=${x.ratio.toFixed(3)}${x.rescue ? '  救援' : ''}`);
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('结果: ' + path.resolve(OUT));
