#!/usr/bin/env node
'use strict';
/**
 * G3_bq_level_2 客户端「二锁链误判」复现序列搜索。
 * - 随机对局：多种子 LCG，遍历非阻塞取盒；
 * - 定向 beam search：按「离链组 2 可点更近」打分保留状态；
 * - 命中条件：点击前 buffer=3 且链组2可点；点击后 bufEnter=5、bufAfter<5。
 * 产出：sequences.json / 序列清单.md
 */
const fs = require('fs');
const path = require('path');
const { loadSolver, readJson } = require(path.resolve(__dirname, '../../03_工具/正式版/Build006Thickness_v688.js'));

const LEVEL_FILE = '/Users/red/Desktop/ParkPassenger.app/Contents/Resources/bin/G3_bq_level_2.json';
const OUT_JSON = path.join(__dirname, 'sequences.json');
const OUT_MD = path.join(__dirname, '序列清单.md');
const TARGET_CELLS = [[4, 6], [5, 6]];
const MAX_STEPS = 90;
// 硬预算（协调者要求，优先于「目标 20–30 条」）：
// 随机对局 ≤ 6000 局、总时长 ≤ 40 分钟，先到先停；到上限时把已找到的全部写出。
const HARD_GAMES = 6000;
const HARD_MS = 40 * 60 * 1000;
const START_MS = Date.now();
function budgetExhausted(games) {
  return games >= HARD_GAMES || (Date.now() - START_MS) >= HARD_MS;
}

const A = loadSolver('corner');
const GAME = readJson(LEVEL_FILE);
const LEVEL = A.parseLevel(A.fromGameFormat(GAME));

function lcg(seed) {
  let v = seed >>> 0;
  return () => { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; return v / 4294967296; };
}

function cloneState(s) {
  return {
    level: s.level,
    useSlotStart: s.useSlotStart,
    bottomOnly: s.bottomOnly,
    instantChain: s.instantChain,
    rows: s.rows, cols: s.cols,
    blocks: s.blocks,
    eliminated: s.eliminated.map(row => row.slice()),
    totalPixels: s.totalPixels,
    eliminatedPixels: s.eliminatedPixels,
    bufferLimit: s.bufferLimit,
    buffer: s.buffer.map(it => Object.assign({}, it)),
    boardRows: s.boardRows, boardCols: s.boardCols,
    cells: s.cells.map(row => row.map(cell => (cell ? Object.assign({}, cell) : null))),
    activated: Object.assign({}, s.activated),
    removed: Object.assign({}, s.removed),
    numice: JSON.parse(JSON.stringify(s.numice)),
    chainGroups: s.chainGroups,
    pressureSamples: [],
    capturePreviewStats: false,
    steps: s.steps,
    totalBoxes: s.totalBoxes,
    completedBoxes: s.completedBoxes,
    _linkSeq: s._linkSeq,
    _keySeq: s._keySeq,
    capture: false,
    capOps: null,
    history: [],
    gameOver: s.gameOver,
    gameWon: s.gameWon,
    overflow: s.overflow,
    resSum: s.resSum,
    resCount: s.resCount,
    lastPick: s.lastPick,
    _enterPeak: s._enterPeak
  };
}

function newState() {
  return A.Simulator.createState(LEVEL, { useSlotStart: true, instantChain: false });
}

function liveMoves(s) {
  return A.Simulator.listMoves(s).filter(m => !m.blocked);
}

function group2Ready(s) {
  const mv = A.Simulator.listMoves(s);
  return TARGET_CELLS.every(([r, c]) => {
    const m = mv.find(x => x.r === r && x.c === c);
    return m && !m.blocked;
  });
}

function stateKey(s) {
  // 棋盘占位 + 已消除像素 + 暂存组成 + 冰剩余（任务指定口径）
  const cells = [];
  for (let r = 0; r < s.boardRows; r++) {
    for (let c = 0; c < s.boardCols; c++) {
      const cell = s.cells[r][c];
      if (!cell) { cells.push('.'); continue; }
      if (cell.t === 'pipe') { cells.push('P:' + cell.dir + ':' + cell.next); continue; }
      if (cell.t === 'black') { cells.push('B'); continue; }
      cells.push(cell.color + '/' + cell.count + '/' + (cell.chain || 0));
    }
  }
  const buf = s.buffer.map(it => it.color + '/' + it.need + '/' + it.progress).join(',');
  const ice = Object.keys(s.numice).sort().map(k => k + '=' + s.numice[k].remaining).join(',');
  return cells.join('|') + '#' + s.eliminatedPixels + '#' + buf + '#' + ice;
}

function snapshotPick(s) {
  return s.buffer.map(it => ({ key: it.key, color: it.color, need: it.need, progress: it.progress, remaining: it.need - it.progress, link: it.link || 0 }));
}

// 结算后哪些车吃满腾出了位置：旧暂存里消失的 key + 整组完成的锁链车。
function completionEvidence(beforeState, afterState) {
  const afterKeys = new Set(afterState.buffer.map(it => it.key));
  const beforeKeys = new Set(beforeState.buffer.map(it => it.key));
  const oldCompleted = beforeState.buffer
    .filter(it => !afterKeys.has(it.key))
    .map(it => ({ source: 'buffer', color: it.color, need: it.need, progress: it.progress }));
  const newLeft = afterState.buffer.filter(it => !beforeKeys.has(it.key));
  const chainCompleted = newLeft.length === 0; // 两辆链车同进同出：都没留下 = 整组吃满
  const completed = oldCompleted.concat(chainCompleted
    ? [{ source: 'chain', color: 32, need: 22 }, { source: 'chain', color: 26, need: 21 }]
    : []);
  return {
    freed: afterState.lastPick ? afterState.lastPick.bufEnter - afterState.lastPick.bufAfter : 0,
    completed,
    chainCompleted,
    chainRemaining: newLeft.map(it => ({ color: it.color, need: it.need, progress: it.progress }))
  };
}

function pickSummary(s, picks, label) {
  return {
    label,
    step: s.steps,
    bufferBefore: snapshotPick(s),
    bufferLen: s.buffer.length,
    eliminatedPixels: s.eliminatedPixels,
    completedBoxes: s.completedBoxes,
    steps: picks.map(p => ({
      step: p.step, r: p.r, c: p.c,
      color: p.color, count: p.count, groupSize: p.groupSize || 1,
      bufAfter: p.bufAfter
    }))
  };
}

// 命中检查：返回记录或 null。会先克隆，不改原状态。
function checkHit(s, prefix, meta, stats) {
  if (s.buffer.length !== 3) return null;
  if (!group2Ready(s)) return null;
  for (const [r, c] of TARGET_CELLS) {
    const clone = cloneState(s);
    const ok = A.Simulator.applyPick(clone, r, c);
    if (!ok || !clone.lastPick) continue;
    if (clone.lastPick.bufEnter === 5) {
      if (stats) {
        stats.enter5Attempts = (stats.enter5Attempts || 0) + 1;
        if (clone.lastPick.bufAfter > 4) stats.after5Rejected = (stats.after5Rejected || 0) + 1;
        else stats.bufAfterDist[clone.lastPick.bufAfter] = (stats.bufAfterDist[clone.lastPick.bufAfter] || 0) + 1;
      }
    }
    // 只保留「点二锁链之后不会输」：结算后 ≤4，且没有判死/死局。
    if (clone.lastPick.bufEnter !== 5 || clone.lastPick.bufAfter > 4) continue;
    if (clone.overflow || clone.gameOver || A.Simulator.isDeadEnd(clone)) continue;
    const evidence = completionEvidence(s, clone);
    return {
      stateKey: stateKey(s),
      trigger: { r, c },
      bufBefore: s.buffer.length,
      bufEnter: clone.lastPick.bufEnter,
      bufAfter: clone.lastPick.bufAfter,
      freed: evidence.freed,
      completedCars: evidence.completed,
      chainCompleted: evidence.chainCompleted,
      chainRemaining: evidence.chainRemaining,
      chainPicked: clone.lastPick.picked,
      bufferBeforeDetail: snapshotPick(s),
      bufferAfterDetail: snapshotPick(clone),
      prefix,
      meta
    };
  }
  return null;
}

function recordPick(list, s, move) {
  const rec = {
    step: s.steps + 1,
    r: move.r, c: move.c,
    color: move.antBox.color,
    count: move.antBox.count,
    groupSize: move.groupSize || 1,
    bufAfter: null // 由调用方在 applyPick 后填
  };
  list.push(rec);
  return rec;
}

// ---------- 随机对局 ----------
function runRandom(games, seed0, hits, stats, seenKeys) {
  for (let gi = 0; gi < games; gi++) {
    if (budgetExhausted(stats.games)) { stats.budgetReached = '随机对局预算上限'; break; }
    const seed = seed0 + gi;
    const rnd = lcg(seed);
    const s = newState();
    const prefix = [];
    let group2Seen = false;
    for (let step = 0; step < MAX_STEPS; step++) {
      const ms = liveMoves(s);
      if (!ms.length) break;
      if (group2Ready(s)) {
        group2Seen = true;
        stats.group2States++;
        if (s.buffer.length === 3) stats.group2Buf3++;
      }
      const hit = checkHit(s, pickSummary(s, prefix, 'random'), { mode: 'random', seed, gameIndex: gi }, stats);
      if (hit) {
        stats.hitsRaw++;
        if (!seenKeys.has(hit.stateKey)) { seenKeys.add(hit.stateKey); hits.push(hit); }
        else stats.dupKeys++;
      }
      const m = ms[Math.floor(rnd() * ms.length)];
      const rec = recordPick(prefix, s, m);
      A.Simulator.applyPick(s, m.r, m.c);
      rec.bufAfter = s.buffer.length;
      if (s.gameOver || s.overflow || s.gameWon) break;
    }
    if (group2Seen) stats.gamesWithGroup2++;
    stats.games++;
  }
}

// ---------- Beam search ----------
function groupProgressScore(s) {
  let score = 0;
  // 链组两格自身
  for (const [r, c] of TARGET_CELLS) {
    const cell = s.cells[r][c];
    if (!cell) { score += 40; continue; } // 已不存在（异常，取走后）
    if (s.activated[r + ',' + c]) score += 25;
    if (s.numice[r + ',' + c]) score -= 15;
  }
  // 两格周围：已清空的邻居越多越近
  const around = [[3, 6], [4, 5], [5, 5], [6, 6], [3, 5], [4, 4], [5, 4], [6, 5]];
  for (const [r, c] of around) {
    if (r < 0 || c < 0 || r >= s.boardRows || c >= s.boardCols) continue;
    if (!s.cells[r][c]) score += 12;
    else if (s.activated[r + ',' + c]) score += 3;
  }
  // 第 6 列、第 5/6 行清空进度
  for (let r = 0; r < s.boardRows; r++) if (!s.cells[r][6]) score += 5;
  for (let c = 0; c < s.boardCols; c++) {
    if (!s.cells[5][c]) score += 2;
    if (!s.cells[6][c]) score += 2;
  }
  // 暂存接近 3：差 1 罚 4，差 2 罚 8；正好 3 给 10（但不能压过“可点”）
  score += 10 - Math.abs(s.buffer.length - 3) * 4;
  if (group2Ready(s)) score += 200;
  if (s.buffer.length === 3 && group2Ready(s)) score += 1000;
  score += s.eliminatedPixels / s.totalPixels * 10;
  return score;
}

function stateDedupeKey(s) {
  let cleared = 0;
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) if (!s.cells[r][c]) cleared++;
  const buf = s.buffer.map(it => it.color + '/' + it.need + '/' + it.progress).join(',');
  return cleared + '#' + s.eliminatedPixels + '#' + buf + '#' + s.buffer.length;
}

function runBeam(opts, hits, stats, seenKeys) {
  const width = opts.width;
  const maxDepth = opts.depth;
  const expandCap = opts.expandCap;
  const roots = [];
  if (opts.roots) {
    // 多根：每个开局可点各起一条 beam，强制首步分化，避免所有序列共享同一前缀。
    const s0 = newState();
    for (const m of liveMoves(s0)) {
      const cs = cloneState(s0);
      const rec = recordPick([], s0, m);
      A.Simulator.applyPick(cs, m.r, m.c);
      rec.bufAfter = cs.buffer.length;
      if (cs.overflow || cs.gameOver) continue;
      const prefix = [rec];
      const rootLabel = m.r + ',' + m.c;
      const hit = checkHit(cs, pickSummary(cs, prefix, 'beam'), { mode: 'beam', root: rootLabel, depth: 1 }, stats);
      if (hit) {
        stats.hitsRaw++;
        if (!seenKeys.has(hit.stateKey)) { seenKeys.add(hit.stateKey); hits.push(hit); }
        else stats.dupKeys++;
      }
      roots.push({ s: cs, prefix, key: stateDedupeKey(cs), score: groupProgressScore(cs), root: rootLabel });
    }
    console.error(`beam roots: ${roots.map(r => r.root).join(' ')}`);
  } else {
    const s = newState();
    roots.push({ s, prefix: [], key: stateDedupeKey(s), score: groupProgressScore(s), root: 'all' });
  }
  let layer = roots;
  for (let depth = 1; depth < maxDepth; depth++) {
    if (budgetExhausted(stats.games)) { stats.budgetReached = '总时长预算上限（beam）'; break; }
    const children = [];
    const seen = new Set();
    for (const node of layer) {
      if (budgetExhausted(stats.games)) { stats.budgetReached = '总时长预算上限（beam）'; break; }
      const ms = liveMoves(node.s);
      if (!ms.length) continue;
      // 随机采样上限，控制分支
      let picks = ms;
      if (ms.length > expandCap) {
        const rnd = lcg(0x9e3779b9 ^ (depth * 131 + children.length));
        picks = ms.slice().sort(() => rnd() - 0.5).slice(0, expandCap);
      }
      for (const m of picks) {
        const cs = cloneState(node.s);
        const rec = recordPick(node.prefix.slice(), node.s, m);
        A.Simulator.applyPick(cs, m.r, m.c);
        rec.bufAfter = cs.buffer.length;
        if (cs.overflow || cs.gameOver) continue; // 死局不保留
        const prefix = node.prefix.concat([rec]);
        const hit = checkHit(cs, pickSummary(cs, prefix, 'beam'), { mode: 'beam', depth: depth + 1 }, stats);
        if (hit) {
          stats.hitsRaw++;
          if (!seenKeys.has(hit.stateKey)) { seenKeys.add(hit.stateKey); hits.push(hit); }
          else stats.dupKeys++;
        }
        const key = stateDedupeKey(cs);
        if (seen.has(key)) continue;
        seen.add(key);
        children.push({ s: cs, prefix, key, score: groupProgressScore(cs), root: node.root });
      }
    }
    children.sort((a, b) => b.score - a.score);
    if (opts.roots) {
      // 每个根各留 width 条，互不挤占，保证首步多样化。
      const byRoot = new Map();
      for (const child of children) {
        if (!byRoot.has(child.root)) byRoot.set(child.root, []);
        const list = byRoot.get(child.root);
        if (list.length < width) list.push(child);
      }
      layer = [];
      for (const list of byRoot.values()) layer = layer.concat(list);
    } else {
      layer = children.slice(0, width);
    }
    if (!layer.length) break;
    if ((depth + 1) % 5 === 0) {
      console.error(`beam depth ${depth + 1}: children=${children.length} layer=${layer.length} best=${layer[0].score.toFixed(1)} hits=${hits.length}`);
    }
  }
}

function main() {
  const t0 = Date.now();
  const hits = [];
  const seenKeys = new Set();
  const stats = { games: 0, gamesWithGroup2: 0, group2States: 0, group2Buf3: 0, hitsRaw: 0, dupKeys: 0, bufAfterDist: { 2: 0, 3: 0, 4: 0 } };

  const randomGames = parseInt(process.env.RANDOM_GAMES || '5000', 10);
  const seed0 = parseInt(process.env.SEED0 || '1000', 10);
  runRandom(randomGames, seed0, hits, stats, seenKeys);
  const randomHits = hits.length;
  const t1 = Date.now();
  console.error(`random: ${stats.games} games in ${((t1 - t0) / 1000).toFixed(1)}s; ` +
    `gamesWithGroup2=${stats.gamesWithGroup2}; group2States=${stats.group2States}; buf3=${stats.group2Buf3}; ` +
    `uniqueHits=${hits.length} (raw=${stats.hitsRaw}, dup=${stats.dupKeys})`);

  if (process.env.BEAM !== '0' && (hits.length < 40 || process.env.BEAM_ALWAYS === '1')) {
    const beam = {
      width: parseInt(process.env.BEAM_WIDTH || '600', 10),
      depth: parseInt(process.env.BEAM_DEPTH || '34', 10),
      expandCap: parseInt(process.env.BEAM_EXPAND || '10', 10),
      roots: process.env.BEAM_ROOTS === '1'
    };
    runBeam(beam, hits, stats, seenKeys);
    console.error(`beam done in ${((Date.now() - t1) / 1000).toFixed(1)}s; uniqueHits=${hits.length}`);
  }

  // 截断到 30 条，优先前缀多样：同样前缀越长越靠后，再做逐步差异最大化筛选。
  hits.sort((a, b) => a.prefix.steps.length - b.prefix.steps.length || (a.meta.seed || 0) - (b.meta.seed || 0));
  const selected = selectDiverse(hits, 30);

  // 复跑验证：从初始状态重放前缀 + 触发点击，核对摘要
  for (let i = 0; i < selected.length; i++) {
    const h = selected[i];
    const s = newState();
    let ok = true;
    for (const st of h.prefix.steps) {
      if (!A.Simulator.applyPick(s, st.r, st.c)) { ok = false; break; }
    }
    const replay = { ok: false };
    if (ok) {
      const before = { buf: s.buffer.length, eliminatedPixels: s.eliminatedPixels };
      const clone = cloneState(s);
      A.Simulator.applyPick(clone, h.trigger.r, h.trigger.c);
      replay.ok = s.buffer.length === h.bufBefore &&
        clone.lastPick && clone.lastPick.bufEnter === h.bufEnter &&
        clone.lastPick.bufAfter === h.bufAfter &&
        h.bufAfter <= 4 &&
        !clone.overflow && !clone.gameOver && !A.Simulator.isDeadEnd(clone);
      replay.bufBefore = before.buf;
      replay.bufEnter = clone.lastPick && clone.lastPick.bufEnter;
      replay.bufAfter = clone.lastPick && clone.lastPick.bufAfter;
      replay.notDead = !clone.overflow && !clone.gameOver && !A.Simulator.isDeadEnd(clone);
    }
    h.replay = replay;
  }

  const json = {
    generatedAt: new Date().toISOString(),
    level: LEVEL_FILE,
    config: { mode: 'a', ref: 'corner', useSlotStart: true, instantChain: false },
    stats: {
      totalGames: stats.games,
      budget: { maxGames: HARD_GAMES, maxMinutes: HARD_MS / 60000, exhausted: stats.budgetReached || null },
      gamesWithGroup2: stats.gamesWithGroup2,
      group2PickableStates: stats.group2States,
      group2PickableAndBuf3: stats.group2Buf3,
      enter5Attempts: stats.enter5Attempts || 0,
      after5Rejected: stats.after5Rejected || 0,
      bufAfterDistribution: stats.bufAfterDist,
      hitsRaw: stats.hitsRaw,
      duplicates: stats.dupKeys,
      uniqueSequences: hits.length,
      selected: selected.length
    },
    target: { cells: TARGET_CELLS, colors: [[4, 6, 32, 22], [5, 6, 26, 21]] },
    sequences: selected
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 2));
  fs.writeFileSync(OUT_MD, renderMarkdown(json));
  console.log(`random games=${stats.games} group2 pickable games=${stats.gamesWithGroup2} ` +
    `group2 states=${stats.group2States} buf3=${stats.group2Buf3} rawHits=${stats.hitsRaw} ` +
    `unique=${hits.length} selected=${selected.length} time=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`wrote ${OUT_JSON}`);
  console.log(`wrote ${OUT_MD}`);
}

function prefixSig(h, k) {
  return h.prefix.steps.slice(0, k).map(s => s.r + ',' + s.c).join('>');
}
// 前缀多样性：先要求前 5 步组合互不相同，不够再逐级放宽到前 4/3/2/1 步。
// 只看「是否分叉」不够——短前缀会全挤在同一条最短路上，必须按前 k 步签名去重。
function selectDiverse(hits, cap) {
  const chosen = [];
  for (const k of [5, 4, 3, 2, 1, 0]) {
    const seen = new Set(chosen.map(c => prefixSig(c, k)));
    for (const h of hits) {
      if (chosen.length >= cap) return chosen;
      if (chosen.includes(h)) continue;
      const sig = prefixSig(h, k);
      if (k === 0 || !seen.has(sig)) { chosen.push(h); seen.add(sig); }
    }
  }
  return chosen;
}

function renderMarkdown(json) {
  const lines = [];
  lines.push('# G3 第 2 关「二锁链误判」复现序列清单');
  lines.push('');
  lines.push(`生成时间：${json.generatedAt}`);
  lines.push('');
  lines.push('关卡：`/Users/red/Desktop/ParkPassenger.app/Contents/Resources/bin/G3_bq_level_2.json`（7×7 棋盘，40×40 目标图，1600 像素）');
  lines.push('');
  lines.push('口径：`loadSolver(\'corner\')`，`createState({ useSlotStart: true, instantChain: false })`，`listMoves` 过滤 `blocked`，`applyPick`。');
  lines.push('');
  lines.push('命中条件：点击前 `buffer.length == 3`；链组 2 的 `(4,6)`、`(5,6)` 在 `listMoves` 中 `blocked == false`；点击后 `bufEnter == 5`、**`bufAfter <= 4` 且未判死（`overflow == false`、`isDeadEnd == false`）**。结算后仍为 5 的一律丢弃（那是真输，不是误判样本）。');
  lines.push('');
  lines.push('## 统计');
  lines.push('');
  if (json.stats.randomPhase) {
    const rp = json.stats.randomPhase;
    lines.push(`- 随机对局：${rp.games} 局（种子 ${rp.seeds}）；其中链组 2 变为可点：${rp.gamesWithGroup2} 局`);
    lines.push(`- 随机轮里链组 2 可点的状态：${rp.group2PickableStates}；点击前 buffer=3 的状态：${rp.group2PickableAndBuf3}；去重命中：${rp.uniqueHits}`);
  } else {
    lines.push(`- 随机对局：${json.stats.totalGames} 局（另含定向 beam search，见说明）`);
    lines.push(`- 链组 2 变为可点的对局：${json.stats.gamesWithGroup2}`);
    lines.push(`- 点击前 buffer=3 且链组 2 可点的状态：${json.stats.group2PickableAndBuf3}`);
  }
  if (json.stats.beamPhase) {
    const bp = json.stats.beamPhase;
    lines.push(`- 定向 beam：${bp.roots} 个开局根、每根宽 ${bp.width}、深度 ${bp.depth}；命中 ${bp.hitsRaw}，去重 ${bp.uniqueHits}`);
    lines.push(`- beam 中入场=5 的尝试：${bp.enter5Attempts}；其中结算后仍为 5（真输、已丢弃）：${bp.after5Rejected}`);
    lines.push(`- beam 结算后 buffer 分布：${JSON.stringify(bp.bufAfterDistribution)}`);
  } else {
    lines.push(`- 入场=5 的尝试：${json.stats.enter5Attempts}；其中结算后仍为 5（真输、已丢弃）：${json.stats.after5Rejected}`);
    lines.push(`- 结算后 buffer 分布：${JSON.stringify(json.stats.bufAfterDistribution)}`);
  }
  lines.push(`- 最终去重后：${json.stats.uniqueSequences}；本清单收录：${json.stats.selected}`);
  if (json.stats.selected < 20) {
    lines.push('');
    lines.push(`> **未达 20 条**：已到预算上限（${json.stats.budget.maxGames} 局 / ${json.stats.budget.maxMinutes} 分钟）${json.stats.budget.exhausted ? '，' + json.stats.budget.exhausted : ''}；已找到的序列全部写出，未放宽条件。`);
  }
  lines.push('');
  lines.push('## 序列');
  for (let i = 0; i < json.sequences.length; i++) {
    const h = json.sequences[i];
    lines.push('');
    lines.push(`### #${i + 1}（前缀 ${h.prefix.steps.length} 步，来源 ${h.meta.mode}${h.meta.seed != null ? ' seed=' + h.meta.seed : ''}）`);
    lines.push('');
    lines.push(`- 点击前 buffer：${h.bufferBeforeDetail.map(b => `${b.color}/${b.need}(剩${b.remaining})`).join('、')}`);
    lines.push(`- 链组 2 位置：\`(4,6) 32/22\`、\`(5,6) 26/21\`；触发点击：\`(${h.trigger.r},${h.trigger.c})\``);
    lines.push(`- 点击后：bufEnter ${h.bufEnter} → bufAfter ${h.bufAfter}（腾出 ${h.freed} 位，未判死）`);
    lines.push(`- 吃满腾位的车：${h.completedCars.map(c => `${c.source === 'chain' ? '链车' : '暂存车'} ${c.color}/${c.need}`).join('、')}${h.chainCompleted ? '（链组整组吃满离场）' : ''}`);
    lines.push(`- 复跑校验：${h.replay.ok ? '通过' : '失败 ' + JSON.stringify(h.replay)}`);
    lines.push('');
    lines.push('| 步 | 点击 (行,列) | 色号/容量 | 类型 | 该步后 buffer |');
    lines.push('|---|---|---|---|---|');
    for (const st of h.prefix.steps) {
      const type = st.groupSize > 1 ? `锁链${st.groupSize}连` : '普通';
      lines.push(`| ${st.step} | (${st.r},${st.c}) | ${st.color}/${st.count} | ${type} | ${st.bufAfter} |`);
    }
    lines.push(`| ${h.prefix.steps.length + 1} | (${h.trigger.r},${h.trigger.c}) | ${h.chainPicked.map(p => p.color + '/' + p.count).join(' + ')} | 锁链2连（触发） | 入场 ${h.bufEnter} → 结算 ${h.bufAfter} |`);
  }
  lines.push('');
  return lines.join('\n');
}

if (require.main === module) {
  main();
}

module.exports = { renderMarkdown, selectDiverse, checkHit, newState, cloneState, liveMoves, group2Ready };
