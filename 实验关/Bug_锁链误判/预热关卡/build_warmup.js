#!/usr/bin/env node
'use strict';
/**
 * 生成「预热关卡」：把 sequences.json 的复现序列烤成可导入客户端的关卡 JSON。
 *
 * 两种重建方式（每条序列自动选能达到的最高保真度）：
 *  A. 精确法（优先）：把暂存车已吃掉的 progress 个像素退回目标图，车辆按 need 放回原格；
 *     数字冰 remaining+3 补偿 3 次预热点击。预热后棋盘/暂存/数字冰与序列 S 完全一致。
 *  B. 任务书法（兜底）：count 用 remaining、已吃像素在 blocks 里保持 0、数字冰 remaining+3。
 *     预热后棋盘/数字冰一致，暂存颜色一致；need/progress 按 remaining 重建。
 *
 * 只有「预热后点击 (4,6) => bufEnter==5、bufAfter<=4、未判死」的才输出。
 * 守恒校验：逐色 sum(count)（含管道队列）== blocks 里该色剩余像素。
 *
 * 用法：node build_warmup.js [--dry] [--max-N 10]
 * 中间文件带 pid；不改任何现有文件、不 commit。
 */
const fs = require('fs');
const path = require('path');
const { loadSolver, readJson } = require(path.resolve(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));

const LEVEL_FILE = '/Users/red/Desktop/ParkPassenger.app/Contents/Resources/bin/G3_bq_level_2.json';
const SEQ_FILE = path.join(__dirname, '..', 'sequences.json');
const OUT_DIR = __dirname;
const TARGET = { r: 4, c: 6 };
const DRY = process.argv.includes('--dry');
const MAX_N = (() => {
  const i = process.argv.indexOf('--max-N');
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : 10;
})();
const A = loadSolver('corner');
const GAME = readJson(LEVEL_FILE);
const LEVEL = A.parseLevel(A.fromGameFormat(GAME));

function newState() { return A.Simulator.createState(LEVEL, { useSlotStart: true, instantChain: false }); }
function cloneState(s) {
  return {
    level: s.level, useSlotStart: s.useSlotStart, bottomOnly: s.bottomOnly, instantChain: s.instantChain,
    rows: s.rows, cols: s.cols, blocks: s.blocks,
    eliminated: s.eliminated.map(row => row.slice()),
    totalPixels: s.totalPixels, eliminatedPixels: s.eliminatedPixels, bufferLimit: s.bufferLimit,
    buffer: s.buffer.map(it => Object.assign({}, it)),
    boardRows: s.boardRows, boardCols: s.boardCols,
    cells: s.cells.map(row => row.map(cell => (cell ? Object.assign({}, cell) : null))),
    activated: Object.assign({}, s.activated), removed: Object.assign({}, s.removed),
    numice: JSON.parse(JSON.stringify(s.numice)), chainGroups: s.chainGroups,
    pressureSamples: [], capturePreviewStats: false, steps: s.steps, totalBoxes: s.totalBoxes,
    completedBoxes: s.completedBoxes, _linkSeq: s._linkSeq, _keySeq: s._keySeq,
    capture: false, capOps: null, history: [],
    gameOver: s.gameOver, gameWon: s.gameWon, overflow: s.overflow,
    resSum: s.resSum, resCount: s.resCount, lastPick: s.lastPick, _enterPeak: s._enterPeak
  };
}
function pipeRemain(cell) { return (cell.queue || []).slice(cell.next || 0).map(x => x.color + '/' + x.count).join(','); }
// 面向 stateKey 对比的棋盘串：管道只比剩余队列（next 只是已释放计数，队列空时语义相同）。
function cellsStr(s) {
  const out = [];
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const cell = s.cells[r][c];
    if (!cell) { out.push('.'); continue; }
    if (cell.t === 'pipe') { out.push('P:' + cell.dir + ':' + pipeRemain(cell)); continue; }
    if (cell.t === 'black') { out.push('B'); continue; }
    out.push(cell.color + '/' + cell.count + '/' + (cell.chain || 0));
  }
  return out.join('|');
}
function bufStr(s) { return s.buffer.map(it => it.color + '/' + it.need + '/' + it.progress).join(','); }
function iceStr(s) { return Object.keys(s.numice).sort().map(k => k + '=' + s.numice[k].remaining).join(','); }
function stateKey(s) { return cellsStr(s) + '#' + s.eliminatedPixels + '#' + bufStr(s) + '#' + iceStr(s); }

function replayPrefix(seq) {
  const s = newState();
  const origins = new Map(), eatenByKey = new Map();
  const seen = new Set();
  s.capture = true;
  for (const st of seq.prefix.steps) {
    s.capOps = [];
    if (!A.Simulator.applyPick(s, st.r, st.c)) throw new Error('prefix step not pickable: ' + JSON.stringify(st));
    for (const op of s.capOps) {
      if (op.t === 'eat' && op.cells) {
        if (!eatenByKey.has(op.key)) eatenByKey.set(op.key, []);
        for (const cell of op.cells) eatenByKey.get(op.key).push(cell);
      }
    }
    for (const it of s.buffer) if (!seen.has(it.key)) { seen.add(it.key); origins.set(it.key, { r: st.r, c: st.c }); }
  }
  s.capture = false;
  return { s, origins, eatenByKey };
}

function cellToSpool(cell, sk, r, c, iceAdd) {
  if (!cell) return { id: 0, type: 0, param: 0, count: 0 };
  if (cell.t === 'black') return { id: -1, type: 0, param: 0, count: 0 };
  if (cell.t === 'pipe') {
    const q = (cell.queue || []).slice(cell.next || 0).map(x => ({ id: x.color, count: x.count }));
    return { id: 0, type: cell.dir || 11, param: q, count: 0 };
  }
  const types = [];
  if (cell.chain) types.push(5);
  if (cell.q) types.push(6);
  const ice = sk.numice[r + ',' + c];
  const iceRemain = ice && ice.remaining > 0 ? ice.remaining + iceAdd : 0;
  if (iceRemain > 0) types.push(7);
  const type = types.length === 0 ? 0 : (types.length === 1 ? types[0] : types);
  let param;
  if (types.length === 0) param = 0;
  else if (types.length === 1) param = types[0] === 5 ? (cell.chain || 0) : types[0] === 7 ? iceRemain : 0;
  else param = types.map(t => t === 5 ? (cell.chain || 0) : t === 7 ? iceRemain : 0);
  return { id: cell.color, type, param, count: cell.count || 0 };
}

// method: 'exact' | 'remaining'
function buildGame(s, bufItems, origins, eatenByKey, method) {
  const restoredCells = new Set();
  if (method === 'exact') for (const it of bufItems) for (const p of eatenByKey.get(it.key) || []) restoredCells.add(p[0] + ',' + p[1]);
  const blocks = s.blocks.map(row => row.slice());
  let preElim = 0;
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
    if (!s.eliminated[r][c]) continue;
    if (restoredCells.has(r + ',' + c)) continue; // 精确法：退回目标图
    if (blocks[r][c] > 0) preElim++;
    blocks[r][c] = 0;
  }
  const spools = [];
  for (let r = 0; r < s.boardRows; r++) {
    const row = [];
    for (let c = 0; c < s.boardCols; c++) row.push(cellToSpool(s.cells[r][c], s, r, c, bufItems.length));
    spools.push(row);
  }
  const placed = [];
  for (const it of bufItems) {
    const o = origins.get(it.key);
    const existing = spools[o.r][o.c];
    if (existing.id !== 0 || existing.type !== 0) throw new Error('origin occupied: ' + JSON.stringify({ o, existing }));
    const count = method === 'exact' ? it.need : (it.need - it.progress);
    spools[o.r][o.c] = { id: it.color, type: 0, param: 0, count };
    placed.push({ r: o.r, c: o.c, color: it.color, count, need: it.need, progress: it.progress, key: it.key });
  }
  return { game: { toprow: blocks.length, blocks, maprow: spools.length, mapcol: spools[0].length, spools }, placed, preElim };
}

function conservation(game) {
  const lvl = A.parseLevel(A.fromGameFormat(game));
  const remain = {}, sum = {};
  for (let r = 0; r < lvl.rows; r++) for (let c = 0; c < lvl.cols; c++) { const id = lvl.blocks[r][c]; if (id > 0) remain[id] = (remain[id] || 0) + 1; }
  for (let r = 0; r < lvl.board.rows; r++) for (let c = 0; c < lvl.board.cols; c++) {
    const cell = lvl.board.cells[r][c]; if (!cell) continue;
    if (cell.t === 'box') sum[cell.color] = (sum[cell.color] || 0) + (cell.count || 0);
    else if (cell.t === 'pipe') for (const b of cell.queue || []) sum[b.color] = (sum[b.color] || 0) + (b.count || 0);
  }
  const colors = new Set(Object.keys(remain).concat(Object.keys(sum)));
  const bad = [];
  for (const k of colors) if ((remain[k] || 0) !== (sum[k] || 0)) bad.push({ color: Number(k), pixels: remain[k] || 0, boxes: sum[k] || 0 });
  return { ok: bad.length === 0, bad };
}
function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i++) for (const p of permutations(arr.slice(0, i).concat(arr.slice(i + 1)))) out.push([arr[i]].concat(p));
  return out;
}

// 试所有预热顺序；返回通过项（method 决定是否要求精确对齐 S）
function evaluate(seq, method) {
  let ctx;
  try { ctx = replayPrefix(seq); } catch (e) { return { i: null, skip: e.message }; }
  const { s, origins, eatenByKey } = ctx;
  const bufItems = s.buffer.map(it => Object.assign({}, it));
  const sourceKey = stateKey(s);
  const sourceParts = { cells: cellsStr(s), buf: bufStr(s), ice: iceStr(s) };
  let build;
  try { build = buildGame(s, bufItems, origins, eatenByKey, method); }
  catch (e) { return { skip: e.message }; }
  const cons = conservation(build.game);
  if (!cons.ok) return { skip: 'conservation failed: ' + JSON.stringify(cons.bad) };
  const lvl2 = A.parseLevel(A.fromGameFormat(build.game));
  const orders = permutations(build.placed);
  const attempts = [];
  for (const order of orders) {
    let st;
    try { st = A.Simulator.createState(lvl2, { useSlotStart: true, instantChain: false }); }
    catch (e) { attempts.push({ order, ok: false, why: 'create: ' + e.message }); continue; }
    let bad = null;
    const log = [];
    for (const p of order) {
      if (!A.Simulator.applyPick(st, p.r, p.c)) { bad = `preheat not pickable (${p.r},${p.c})`; break; }
      log.push({ r: p.r, c: p.c, bufAfter: st.buffer.length });
      if (st.overflow || st.gameOver) { bad = 'preheat dead'; break; }
    }
    if (bad) { attempts.push({ order, ok: false, why: bad }); continue; }
    if (st.buffer.length !== 3) { attempts.push({ order, ok: false, why: 'buf=' + st.buffer.length }); continue; }
    const mv = A.Simulator.listMoves(st);
    const m46 = mv.find(m => m.r === 4 && m.c === 6), m56 = mv.find(m => m.r === 5 && m.c === 6);
    if (!m46 || m46.blocked || !m56 || m56.blocked) { attempts.push({ order, ok: false, why: 'chain blocked' }); continue; }
    const pre = { cells: cellsStr(st), buf: bufStr(st), ice: iceStr(st), elimNorm: build.preElim + st.eliminatedPixels };
    const preMatch = {
      cells: pre.cells === sourceParts.cells,
      buf: pre.buf === sourceParts.buf,
      ice: pre.ice === sourceParts.ice,
      elim: pre.elimNorm === s.eliminatedPixels
    };
    const cl = cloneState(st);
    A.Simulator.applyPick(cl, TARGET.r, TARGET.c);
    const record = {
      order: order.map(p => ({ r: p.r, c: p.c, color: p.color, count: p.count })),
      log,
      preMatch,
      bufEnter: cl.lastPick && cl.lastPick.bufEnter,
      bufAfter: cl.lastPick && cl.lastPick.bufAfter,
      overflow: !!cl.overflow, gameOver: !!cl.gameOver,
      deadEnd: A.Simulator.isDeadEnd(cl)
    };
    const pass = record.bufEnter === 5 && record.bufAfter <= 4 && !record.overflow && !record.gameOver && !record.deadEnd;
    attempts.push(Object.assign({ ok: pass }, record));
    if (pass && method === 'exact' && !(preMatch.cells && preMatch.buf && preMatch.ice && preMatch.elim)) continue;
    if (pass) {
      // 找到可用顺序即停（按 permutations 生成顺序，首批通常为暂存进入顺序）
      return { build, cons, sourceKey, sourceElim: s.eliminatedPixels, sourceParts, chosen: attempts[attempts.length - 1], attempts, bufItems };
    }
  }
  return { build, cons, sourceKey, sourceElim: s.eliminatedPixels, sourceParts, chosen: null, attempts, bufItems };
}

function colorSig(placed) {
  return placed.map(p => p.color).sort((a, b) => a - b).join('-');
}
function bufSig(bufItems) {
  // 暂存组合：色号 + 剩余容量（预热点击后的 need 口径）
  return bufItems.map(it => it.color + ':' + (it.need - it.progress)).sort().join(',');
}

function main() {
  const data = readJson(SEQ_FILE);
  const seqs = data.sequences;
  const exactPass = [], remainPass = [], skipped = [];
  for (let i = 0; i < seqs.length; i++) {
    let rA = evaluate(seqs[i], 'exact');
    if (rA.skip) { skipped.push({ i: i + 1, method: 'exact', why: rA.skip }); }
    else if (rA.chosen) {
      rA.i = i + 1; exactPass.push(rA);
      console.log(`#${i + 1} exact ✓  preheat=${rA.chosen.order.map(p => `(${p.r},${p.c})${p.color}/${p.count}`).join(' ')}  ${rA.chosen.bufEnter}>${rA.chosen.bufAfter}`);
      continue;
    }
    let rB = evaluate(seqs[i], 'remaining');
    if (rB.skip) { skipped.push({ i: i + 1, method: 'remaining', why: rB.skip }); console.log(`#${i + 1} remaining ✗ ${rB.skip}`); continue; }
    if (rB.chosen) {
      rB.i = i + 1; remainPass.push(rB);
      console.log(`#${i + 1} remain ✓ preheat=${rB.chosen.order.map(p => `(${p.r},${p.c})${p.color}/${p.count}`).join(' ')}  ${rB.chosen.bufEnter}>${rB.chosen.bufAfter}  match=${JSON.stringify(rB.chosen.preMatch)}`);
    } else {
      skipped.push({ i: i + 1, method: 'remaining', why: 'no passing order' });
      console.log(`#${i + 1} remaining ✗ no passing order`);
    }
  }

  // 选取：精确法优先（同色组合先去重，再补重复组合），再用兜底法补足不同暂存组合
  const selected = [];
  const seenGame = new Set();
  const seenSig = new Set();
  const exactSorted = exactPass.slice().sort((a, b) => a.i - b.i);
  for (const r of exactSorted) {
    if (selected.length >= MAX_N) break;
    const sig = JSON.stringify(r.build.game);
    if (seenGame.has(sig)) continue;
    seenGame.add(sig);
    selected.push({ tier: 'exact', r });
    seenSig.add(colorSig(r.build.placed));
  }
  // 兜底：贪心优先补未覆盖的色组合，再补未覆盖的「色+容量」组合，最后按序列号
  const pool = remainPass.slice().sort((a, b) => a.i - b.i);
  const used = new Set();
  const fullSig = (placed) => placed.map(p => p.color + ':' + p.count).sort().join(',');
  const seenFull = new Set(exactPass.map(r => fullSig(r.build.placed)));
  while (selected.length < MAX_N) {
    const avail = [];
    for (let j = 0; j < pool.length; j++) {
      if (used.has(j)) continue;
      if (seenGame.has(JSON.stringify(pool[j].build.game))) { used.add(j); continue; }
      avail.push(j);
    }
    if (!avail.length) break;
    let pick = avail.find(j => !seenSig.has(colorSig(pool[j].build.placed)));
    if (pick == null) pick = avail.find(j => !seenFull.has(fullSig(pool[j].build.placed)));
    if (pick == null) pick = avail[0];
    used.add(pick);
    const r = pool[pick];
    seenGame.add(JSON.stringify(r.build.game));
    seenSig.add(colorSig(r.build.placed));
    seenFull.add(fullSig(r.build.placed));
    selected.push({ tier: 'remaining', r });
  }

  console.log(`\nselected ${selected.length} (exact ${selected.filter(x => x.tier === 'exact').length}, remaining ${selected.filter(x => x.tier === 'remaining').length})`);
  if (DRY) return;

  const verify = [];
  selected.forEach((entry, idx) => {
    const n = idx + 1;
    const { tier, r } = entry;
    const file = `BUG_${n}_G3-2.json`;
    fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(r.build.game, null, 2));
    const pre = r.chosen.preMatch;
    verify.push({
      file,
      sourceSequence: r.i,
      tier: tier === 'exact' ? '精确法（count=need，已吃像素退回目标图）' : '任务书法（count=remaining）',
      preheatClickOrder: r.chosen.order.map(p => ({ row: p.r, col: p.c, color: p.color, count: p.count })),
      triggerClick: { row: 4, col: 6, note: '二锁链 (4,6) 32/22' },
      bufAfterEachPreheat: r.chosen.log.map(x => x.bufAfter),
      bufEnter: r.chosen.bufEnter,
      bufAfter: r.chosen.bufAfter,
      overflow: r.chosen.overflow,
      gameOver: r.chosen.gameOver,
      deadEnd: r.chosen.deadEnd,
      stateKey: {
        source: r.sourceKey,
        sourceEliminatedPixels: r.sourceElim,
        rebuildPreEliminatedPixels: r.build.preElim,
        matches: {
          cells: pre.cells,
          buffer: pre.buf,
          numice: pre.ice,
          eliminatedPixelsNormalized: pre.elim
        },
        note: '关卡格式无法预置 eliminatedPixels；重建后 eliminatedPixels + preEliminated 与源状态一致。管道按剩余队列比较（next 仅表示已释放数，队列空时等价）。'
      },
      conservation: { ok: r.cons.ok, violations: r.cons.bad },
      bufferBeforeDetail: r.bufItems.map(it => ({ color: it.color, need: it.need, progress: it.progress, remaining: it.need - it.progress }))
    });
  });
  const summary = {
    count: verify.length,
    exactStateMatch: verify.filter(v => v.tier.startsWith('精确法')).length,
    triggerOnlyMatch: verify.filter(v => !v.tier.startsWith('精确法')).length,
    preheatClicks: verify.reduce((m, v) => { const n = v.preheatClickOrder.length; m[n] = (m[n] || 0) + 1; return m; }, {}),
    allPass: verify.every(v => v.bufEnter === 5 && v.bufAfter <= 4 && !v.overflow && !v.gameOver && !v.deadEnd && v.conservation.ok),
    note: 'exactStateMatch：预热后棋盘/暂存/数字冰/已消像素（归一）均与源序列的点击前状态一致；triggerOnlyMatch：棋盘/数字冰/已消像素（归一）一致，暂存按 remaining 重建（need/progress 不同），触发数字一致。'
  };
  fs.writeFileSync(path.join(OUT_DIR, '验证记录.json'), JSON.stringify({ generatedAt: new Date().toISOString(), level: LEVEL_FILE, config: { mode: 'a', ref: 'corner', useSlotStart: true, instantChain: false }, summary, entries: verify }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, '预热说明.md'), renderMd(verify));
  console.log(`wrote ${verify.length} levels + 验证记录.json + 预热说明.md`);
}

function renderMd(verify) {
  const L = [];
  L.push('# G3 第 2 关「二锁链误判」预热关卡说明');
  L.push('');
  L.push('目标：导入关卡后，先点若干格把暂存区填到 3，再点二锁链 `(4,6)`（32/22），');
  L.push('客户端会立刻弹「失败，存储区域已满」，但像素继续消除、实际没输。');
  L.push('');
  L.push('## 导入方法');
  L.push('');
  L.push('1. 备份客户端里的关卡文件（以下以第 2 关为例）：');
  L.push('   ```bash');
  L.push('   cp "/Users/red/Desktop/ParkPassenger.app/Contents/Resources/bin/G3_bq_level_2.json" \\');
  L.push('      "/Users/red/Desktop/ParkPassenger.app/Contents/Resources/bin/G3_bq_level_2.json.bak"');
  L.push('   ```');
  L.push('2. 把本目录的 `BUG_<n>_G3-2.json` 内容覆盖进去（保留文件名 `G3_bq_level_2.json`）：');
  L.push('   ```bash');
  L.push('   cp "实验关/Bug_锁链误判/预热关卡/BUG_1_G3-2.json" \\');
  L.push('      "/Users/red/Desktop/ParkPassenger.app/Contents/Resources/bin/G3_bq_level_2.json"');
  L.push('   ```');
  L.push('3. 重开客户端 → 分组 3 第 2 关 → 按每张的「预热点击」顺序点，再点 `(4,6)`。');
  L.push('4. 测完用 `.bak` 还原。');
  L.push('');
  L.push('> 坐标口径与 `序列清单.md` 一致（行 r、列 c 均从 0 开始；`(4,6)` 即二锁链的触发格）。');
  L.push('> 每张都附色号/容量，若行列方向在客户端里相反，按色号/容量找同样的格子即可。');
  L.push('');
  L.push('## 各关卡');
  for (const v of verify) {
    L.push('');
    L.push(`### ${v.file}（源序列 #${v.sourceSequence}，${v.tier}）`);
    L.push('');
    L.push('1. **预热点击（按顺序）**：');
    v.preheatClickOrder.forEach((p, k) => {
      L.push(`   ${k + 1}. 点 \`(${p.row},${p.col})\` —— 色号 ${p.color} / 容量 ${p.count}（点后暂存 ${v.bufAfterEachPreheat[k]} 辆）`);
    });
    L.push(`2. **触发**：点 \`(4,6)\` —— 二锁链 32/22（与 (5,6) 26/21 同组）。`);
    L.push(`3. **预期**：入场瞬间暂存 ${v.bufEnter} 辆 → 客户端弹「存储区域已满」；随后结算腾位到 ${v.bufAfter} 辆，`);
    L.push('   像素继续消除，**没有真正失败**。');
    L.push('');
    L.push(`- 源状态 stateKey：\`${v.stateKey.source}\``);
    L.push(`- 重建预热后与源状态对齐：棋盘 ${v.stateKey.matches.cells ? '✓' : '✗'}、暂存 ${v.stateKey.matches.buffer ? '✓' : '✗'}、数字冰 ${v.stateKey.matches.numice ? '✓' : '✗'}、已消像素（归一）${v.stateKey.matches.eliminatedPixelsNormalized ? '✓' : '✗'}`);
    L.push(`- 守恒：${v.conservation.ok ? '✓ sum(count) == blocks 剩余像素（逐色）' : '✗ ' + JSON.stringify(v.conservation.violations)}`);
    L.push(`- 暂存点击前明细：${v.bufferBeforeDetail.map(b => `${b.color}/${b.need}（已消 ${b.progress}，剩 ${b.remaining}）`).join('、')}`);
  }
  L.push('');
  L.push('## 说明');
  L.push('');
  L.push('- 关卡格式不能预置暂存区，所以每张都要先点「预热点击」把暂存填到 3。');
  L.push('- 精确法：把暂存车已吃掉的像素退回目标图、车辆按完整容量放回原格，预热后棋盘/暂存/数字冰与复现序列的点击前状态完全一致。');
  L.push('- 任务书法：`count` 用 `remaining`，已吃像素在 `blocks` 里保持 0；预热后棋盘/数字冰一致、暂存颜色一致，`need/progress` 按 `remaining` 重建。');
  L.push('- 数字冰统一写 `remaining + 预热点击数`：预热点击会让所有数字冰倒计时，这样点完预热后正好回到源状态的剩余值。');
  L.push('- 所有关卡都经过模拟器验证：`bufEnter==5`、`bufAfter<=4`、未溢出/未判死；逐色 `sum(count)`（含管道队列）等于 `blocks` 剩余像素。');
  L.push('');
  L.push('## 复跑 / 复核');
  L.push('');
  L.push('```bash');
  L.push('cd /Users/red/Desktop/毛线汽车');
  L.push('node --check 实验关/Bug_锁链误判/预热关卡/build_warmup.js');
  L.push('node --check 实验关/Bug_锁链误判/预热关卡/verify_outputs.js');
  L.push('node 实验关/Bug_锁链误判/预热关卡/build_warmup.js   # 重新生成 10 张 + 验证记录');
  L.push('node 实验关/Bug_锁链误判/预热关卡/verify_outputs.js  # 从磁盘重读并对每张复跑预热+触发');
  L.push('```');
  L.push('');
  return L.join('\n');
}

main();
