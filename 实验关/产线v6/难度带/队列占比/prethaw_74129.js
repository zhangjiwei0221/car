#!/usr/bin/env node
'use strict';
/**
 * prethaw_74129 —— “融冰前可达球数”预检
 *
 * 194 有 6 个 18 球数字冰（type7 param18）和 1 个 10 球冰。数字冰按“全场取走的球数”
 * 倒计时；在 18 球之前，18 冰格不可取。若可达的未锁盒（锁链一格算 2 球）凑不满 18，
 * 关卡会在冰前卡死（实测 Q12 初版 12 步死亡即此）。
 *
 * 本脚本把 18 冰视为墙，只算“从第 0 行起，能通过已清空格/已激活格拿到的盒子数（球数）”。
 * 忽略暂存/消除细节（近似上界，用于选格，不作为合法性结论）。
 *
 * 用法: node prethaw_74129.js <底座.json> --pipe r,c --queue "r,c;..."
 */
const path = require('path');
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const baseFile = process.argv[2];
const P = String(arg('--pipe', '5,3')).split(',').map(Number);
const QUEUE = String(arg('--queue', '')).split(';').filter(Boolean).map(s => s.split(',').map(Number));
const game = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
const sp = game.spools, R = sp.length, C = sp[0].length;
const blackSet = new Set();
for (const [r, c] of QUEUE) { if (!(r === P[0] && c === P[1])) blackSet.add(r + ',' + c); }
blackSet.add(P[0] + ',' + P[1]); // 管身也是永久阻挡

const SPECIAL = (r, c) => {
  const s = sp[r][c];
  if (!s) return null;
  const types = Array.isArray(s.type) ? s.type : [s.type || 0];
  return { id: s.id, count: s.count, numice: types.includes(7) ? (parseInt(s.param, 10) || 0) : 0, chain: types.includes(5) ? (parseInt(s.param, 10) || 0) : 0 };
};

// 激活扩散（18 冰当墙）
const activated = Array.from({ length: R }, () => Array(C).fill(false));
const cleared = Array.from({ length: R }, () => Array(C).fill(false));
for (let c = 0; c < C; c++) if (!blackSet.has('0,' + c)) activated[0][c] = true;
let balls = 0;
const picked = new Set();
const pickedChain = new Set();
let changed = true;
const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
function spread() {
  // 从 cleared 格向外暴露
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (!activated[r][c]) continue;
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
      if (blackSet.has(nr + ',' + nc)) continue;
      activated[nr][nc] = true;
    }
  }
}
spread();
while (true) {
  let found = null;
  for (let r = 0; r < R && !found; r++) for (let c = 0; c < C && !found; c++) {
    if (!activated[r][c] || blackSet.has(r + ',' + c) || cleared[r][c]) continue;
    const info = SPECIAL(r, c);
    if (!info) continue;
    if (info.numice >= 18) continue; // 18 冰墙
    if (info.chain > 0) {
      if (pickedChain.has(info.chain)) { cleared[r][c] = true; continue; }
      // 找同组另一格（param 相同）
      let mate = null;
      for (let rr = 0; rr < R && !mate; rr++) for (let cc = 0; cc < C && !mate; cc++) {
        if (rr === r && cc === c) continue;
        const o = SPECIAL(rr, cc);
        if (o && o.chain === info.chain && !cleared[rr][cc] && !blackSet.has(rr + ',' + cc)) mate = [rr, cc];
      }
      if (!mate || !activated[mate[0]][mate[1]]) continue;
      pickedChain.add(info.chain);
      cleared[r][c] = true; cleared[mate[0]][mate[1]] = true; balls += 2;
      found = [r, c]; break;
    }
    cleared[r][c] = true; balls += 1; found = [r, c];
  }
  if (!found) break;
  spread();
}
console.log(JSON.stringify({
  base: path.basename(baseFile), pipe: P, queueCars: QUEUE.length,
  ballsBeforeThaw: balls, thawed: balls >= 18,
  corridorCells: (() => { const out = []; for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (cleared[r][c]) out.push(r + ',' + c); return out; })(),
  remainingActivatedLocked: (() => {
    const out = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (!activated[r][c] || blackSet.has(r + ',' + c) || cleared[r][c]) continue;
      const info = SPECIAL(r, c);
      if (info && info.numice >= 18) out.push(`${r},${c}`);
    }
    return out;
  })(),
  unreached: (() => {
    const out = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (blackSet.has(r + ',' + c) || cleared[r][c]) continue;
      const info = SPECIAL(r, c);
      if (info && !activated[r][c]) out.push(`${r},${c}`);
    }
    return out;
  })(),
}, null, 1));
