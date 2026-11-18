#!/usr/bin/env node
'use strict';
/**
 * maxdesign_74129 —— 贪心找 194 上“最大可行队列格集合”（近似）
 *
 * 约束（全部近似/必要条件，最终以真工具为准）：
 *  a) 队列格必须是普通车、非唯一色、非 P 格、非第 0 行（(0,2) 例外）
 *  b) 开局可点 ≥5（引擎口径）
 *  c) 静态连通：无永久阻挡围出的不可达格
 *  d) 融冰前可达球数 ≥18（194 的 18 球数字冰税）
 *  e) 每种色至少留 1 辆车在盘上
 *
 * 用法: node maxdesign_74129.js <底座.json> --pipe 5,3 --seed 0,2 [--order dead|row]
 */
const path = require('path');
const fs = require('fs');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const baseFile = process.argv[2];
const P = String(arg('--pipe', '5,3')).split(',').map(Number);
const seed = String(arg('--seed', '0,2')).split(';').filter(Boolean).map(s => s.split(',').map(Number));
const orderMode = arg('--order', 'dead');
const maxBlacks = parseInt(arg('--max-blacks', '999'), 10);
const game = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
const sp = game.spools, R = sp.length, C = sp[0].length;
const DIR = 13, dy = 1, dx = 0, exit = [P[0] + dy, P[1] + dx];

const info = [];
const colorTotals = {}, colorCars = {};
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = sp[r][c];
  if (!s || !(s.id > 0)) continue;
  colorTotals[s.id] = (colorTotals[s.id] || 0) + s.count;
  colorCars[s.id] = (colorCars[s.id] || 0) + 1;
}
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = sp[r][c];
  if (!s || !(s.id > 0) || (s.type || 0) !== 0) continue;
  if (colorCars[s.id] < 2) continue;
  if (r === P[0] && c === P[1]) continue;
  if (r === 0 && !(r === 0 && c === 2)) continue;
  info.push({ r, c, id: s.id, count: s.count });
}
const key = (r, c) => r + ',' + c;
const priority = (a) => orderMode === 'row' ? a.r * 100 + a.c : (a.r * 10 + a.c);
// dead 顺序：先 (0,2)，然后按“首拿早/行号小”
const cand = info.slice().sort((a, b) => {
  if (a.r === 0 && a.c === 2) return -1;
  if (b.r === 0 && b.c === 2) return 1;
  return priority(a) - priority(b);
});

function applyBlacks(blacks) {
  const blackSet = new Set(blacks.map(([r, c]) => key(r, c)));
  blackSet.add(key(P[0], P[1]));
  return blackSet;
}
function staticCheck(blackSet) {
  const blocked = (r, c) => blackSet.has(key(r, c));
  const seen = Array.from({ length: R }, () => Array(C).fill(false));
  const q = [];
  for (let c = 0; c < C; c++) if (!blocked(0, c)) { seen[0][c] = true; q.push([0, c]); }
  if (!blocked(exit[0], exit[1])) { seen[exit[0]][exit[1]] = true; q.push(exit); }
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let h = 0; h < q.length; h++) for (const [dr, dc] of dirs) {
    const nr = q[h][0] + dr, nc = q[h][1] + dc;
    if (nr < 0 || nr >= R || nc < 0 || nc >= C || seen[nr][nc] || blocked(nr, nc)) continue;
    seen[nr][nc] = true; q.push([nr, nc]);
  }
  const bad = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (!blocked(r, c) && !seen[r][c]) bad.push(key(r, c));
  return bad;
}
function prethawBalls(blackSet) {
  const spec = (r, c) => {
    const s = sp[r][c];
    if (!s) return null;
    const ts = Array.isArray(s.type) ? s.type : [s.type || 0];
    return { numice: ts.includes(7) ? (parseInt(s.param, 10) || 0) : 0, chain: ts.includes(5) ? (parseInt(s.param, 10) || 0) : 0 };
  };
  const act = Array.from({ length: R }, () => Array(C).fill(false));
  const cleared = Array.from({ length: R }, () => Array(C).fill(false));
  for (let c = 0; c < C; c++) if (!blackSet.has(key(0, c))) act[0][c] = true;
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const spread = () => {
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (!act[r][c]) continue;
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
        if (blackSet.has(key(nr, nc))) continue;
        act[nr][nc] = true;
      }
    }
  };
  spread();
  let balls = 0;
  const chainDone = new Set();
  for (let step = 0; step < 80; step++) {
    let found = null;
    for (let r = 0; r < R && !found; r++) for (let c = 0; c < C && !found; c++) {
      if (!act[r][c] || blackSet.has(key(r, c)) || cleared[r][c]) continue;
      const it = spec(r, c);
      if (!it || it.numice >= 18) continue;
      if (it.chain > 0) {
        if (chainDone.has(it.chain)) { cleared[r][c] = true; found = [r, c]; break; }
        let mate = null;
        for (let rr = 0; rr < R && !mate; rr++) for (let cc = 0; cc < C && !mate; cc++) {
          if (rr === r && cc === c) continue;
          const o = spec(rr, cc);
          if (o && o.chain === it.chain && !cleared[rr][cc] && !blackSet.has(key(rr, cc))) mate = [rr, cc];
        }
        if (!mate || !act[mate[0]][mate[1]]) continue;
        chainDone.add(it.chain);
        cleared[r][c] = cleared[mate[0]][mate[1]] = true; balls += 2; found = [r, c]; break;
      }
      cleared[r][c] = true; balls += 1; found = [r, c];
    }
    if (!found) break;
    spread();
  }
  return balls;
}
function openingOf(blacks) {
  const next = JSON.parse(JSON.stringify(game));
  next.spools[P[0]][P[1]] = { id: 0, type: DIR, param: blacks.map(([r, c]) => ({ id: sp[r][c].id, count: sp[r][c].count })).concat([{ id: sp[P[0]][P[1]].id, count: sp[P[0]][P[1]].count }]), count: 0 };
  for (const [r, c] of blacks) next.spools[r][c] = { id: -1, type: 0, param: 0, count: 0 };
  const lv = A.parseLevel(A.fromGameFormat(next));
  const st = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  return Sim.listMoves(st).filter(m => !m.blocked).length;
}
function lastColorCheck(blacks) {
  const hidden = {};
  for (const [r, c] of blacks) hidden[sp[r][c].id] = (hidden[sp[r][c].id] || 0) + 1;
  const bad = [];
  for (const k of Object.keys(colorCars)) {
    const left = colorCars[k] - (hidden[k] || 0) - ((sp[P[0]][P[1]].id === Number(k)) ? 1 : 0);
    if (left < 1) bad.push(`${k}:${left}`);
  }
  return bad;
}

let chosen = seed.slice();
// seed 也在候选里时保留；去重
chosen = chosen.filter(([r, c], i, arr) => arr.findIndex(([rr, cc]) => rr === r && cc === c) === i);
let pass = 0;
while (true) {
  pass++;
  let added = false;
  for (const cell of cand) {
    if (chosen.length >= maxBlacks) break;
    if (chosen.some(([r, c]) => r === cell.r && c === cell.c)) continue;
    const trial = chosen.concat([[cell.r, cell.c]]);
    const blackSet = applyBlacks(trial);
    if (staticCheck(blackSet).length) continue;
    if (prethawBalls(blackSet) < 18) continue;
    if (lastColorCheck(trial).length) continue;
    let opening;
    try { opening = openingOf(trial); } catch (e) { continue; }
    if (opening < 5) continue;
    chosen = trial; added = true;
  }
  if (!added) break;
  if (pass > 40) break;
}
const blackSet = applyBlacks(chosen);
const hidden = {};
for (const [r, c] of chosen) hidden[sp[r][c].id] = (hidden[sp[r][c].id] || 0) + ((sp[r][c].count) || 0);
const perColor = Object.keys(colorTotals).sort((a, b) => a - b).map(k => ({
  color: Number(k), hiddenPx: hidden[k] || 0, totalPx: colorTotals[k], share: +((hidden[k] || 0) / colorTotals[k]).toFixed(3),
}));
console.log(JSON.stringify({
  queueCars: chosen.length + 1, blacks: chosen.length,
  ratio: +((chosen.length + 1) / 49).toFixed(4),
  opening: openingOf(chosen), staticBad: staticCheck(blackSet), prethawBalls: prethawBalls(blackSet),
  queue: chosen.map(([r, c]) => `${r},${c}:${sp[r][c].id}/${sp[r][c].count}`).concat([`${P[0]},${P[1]}:${sp[P[0]][P[1]].id}/${sp[P[0]][P[1]].count}(P)`]),
  perColor: perColor.filter(x => x.hiddenPx > 0),
}, null, 1));
