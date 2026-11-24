#!/usr/bin/env node
'use strict';
/**
 * BuildV6Stagger_v1.js —— 融合 v7 全套思想的 v6（四边无墙+corner）端到端一键闭环建造器（2026-11-23，日志 §1187）
 *
 * 合入 v6 的 5 大 v7 核心思想：
 *   1) 四边洋葱圈层深切摆 + 同色大小车错配：SplitLevel_v722 --stagger-cap
 *      （外圈 minRing=0 的车排在 row 0..1 保证开局高容错直消；同色切成 14-20px 小车与 28-38px 大车，每关 11-15 种面额）；
 *   2) 源头扫雷 + 去模板化 + 第二排留 >=3 个无链无冰畅通口：
 *      自动将前两排的全盘唯一车(cars===1)移至中深行；6 套去模板化“分对不串排”锁链骨架（只用二连链，绝不用三连链）；
 *   3) 禁盲盒敲冰（冰块数字 <=20 提前化开全明牌）：
 *      实机冰块盖住车颜色，因此行 2-6 的 9 块错落散点冰数字严格锁定在 p=6..20（行2 p6/7, 行3 p9/10, 行4 p13/14, 行5 p16, 行6 p19/20），
 *      确保第 20 辆车（约 40% 进度）前冰块全部碎光，进入后半场时第 5、第 6 行所有车的颜色 100% 明牌可见！
 *   4) 终局“第 5 行明牌挡住第 6 行钥匙车（挪车让路蓄水 3-4 槽高潮收尾）”机关：
 *      在目标图中心区域（row 14..25, col 14..25）识别“内壳钥匙色 B（距中心圈深度 11-14）”与“最中心洋葱心色 A（距中心圈深度 15-19）”：
 *      将“内壳钥匙色 B”的最后 2 辆车明牌放入第 6 行 (6,2) 与 (6,4)，将“最中心核心色 A”的车明牌放在其正上方第 5 行 (5,2) 与 (5,4)！
 *      玩家在终局（75% 进度）肉眼看清第 6 行的钥匙车，主动把挡在头顶第 5 行的核心色车挪进暂存区让路（暂存区推到 3-4 格），
 *      随后点出第 6 行钥匙车剥开内壳，暂存区 3-4 辆车瞬间连消清盘！
 *   5) 7 项硬门全自动闭环自检（原随意档 .55-.68 + 短视真人档 + 三段暂存区波形 bufWaveMean + 早死 <20% + 棘轮 PASS(0) + 可解 + 排版 hard=0 & maxRun<=3）。
 *
 * 用法：
 *   node BuildV6Stagger_v1.js --target <正常关卡/X.txt> --out <输出.json> [--style 0..5] [--iters 16] [--report 证书.json]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TOOLS = path.join(ROOT, '03_工具/正式版');
const B = require(path.join(TOOLS, 'Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(k);
const TARGET = arg('--target', null);
const OUT = arg('--out', null);
const INIT_STYLE = Number(arg('--style', '0'));
const WITH_PIPE = has('--with-pipe');
const PIPE_MODE = arg('--pipe-mode', WITH_PIPE ? '1' : 'auto'); // 'auto' (按巨车数与周期自动选0/1/2/3管) | '0' | '1' | '2' | '3'
const PIPE_MOUTH = arg('--pipe-mouth', 'auto'); // 'auto' (自动找平) | 'big' | 'small'
const LEVEL_IDX = Number(arg('--level-idx', '0')); // 批量序号(用于周期排班: 每4关1管, 每9关2-3管)
const WITH_CHAIN3 = has('--with-3chain'); // 启用「2小1大」安全三锁链
const BLACK_MODE = Number(arg('--black-mode', '0')); // 0 | 2 (腰部对称双黑块) | 3 (品字形三黑块迷宫+自动替掉4块深冰)
const Q_COUNT = Number(arg('--q-count', '0')); // 0 | 2..4 (在第2-3行放问号车遮挡远期视野，绝不放第5-6行终局位)
const ROWS = Number(arg('--rows', '7'));
const COLS = Number(arg('--cols', '7'));
const RAND_LO = Number(arg('--rand-lo', '0.55'));   // 主尺下限（B 档 = .45）
const RAND_HI = Number(arg('--rand-hi', '0.68'));   // 主尺上限（B 档 = .58）
const HUM_MIN = Number(arg('--hum-min', '0.32'));   // 短视真人下限（防 <.30 坑真人死局）
const HUM_MAX = Number(arg('--hum-max', '1.00'));   // 短视真人上限（B 档 = .75）
const FAIR_MIN = Number(arg('--fair-min', '0.90')); // 认真档下限（B 档 = .85）
const ITERS = Number(arg('--iters', '8'));
const SEED = Number(arg('--seed', '977'));
const REPORT = arg('--report', null);
const MAX_TRIES = Number(arg('--tries', '3'));
const MAX_ICE_CAP = Number(arg('--max-ice', '28')); // 【派工#001】中后期封路冰恢复后，冰数字上限从写死 20 提为可配（默认 28）

// 【派工#001】终局挪车机关四定点：第 5 行核心色大车压住第 6 行内壳钥匙车。
// 管道拆分 / 选冰 / 前排唯一车对调都不得占用或替换这 4 格（爬山后再做一次最终落位兜底）。
const CLIMAX_SET = new Set(['5,2', '5,4', '6,2', '6,4']);

if (!TARGET || !OUT) {
  console.error('用法: node BuildV6Stagger_v1.js --target <图.txt> --out <输出.json> [--style 0..5] [--iters 18]');
  process.exit(2);
}

// 【2026-11-24 派工#002：5 对四层阶梯链（行1-2 两对破口 + 行2-3 一对承接 + 行3-4 一对中腰 + 行4-5 一对后段），row 1 留 4 个畅通单车口】
const CHAIN_STYLES = [
  [[[1,0],[2,0]], [[1,4],[1,5]], [[2,2],[3,2]], [[3,6],[4,6]], [[4,1],[4,2]]],
  [[[1,1],[1,2]], [[1,5],[2,5]], [[2,0],[3,0]], [[3,3],[3,4]], [[4,5],[4,6]]],
  [[[1,1],[2,1]], [[1,4],[2,4]], [[2,6],[3,6]], [[3,2],[4,2]], [[4,0],[5,0]]],
  [[[1,0],[1,1]], [[1,5],[2,5]], [[2,3],[2,4]], [[3,1],[4,1]], [[4,5],[5,5]]],
  [[[1,2],[2,2]], [[1,5],[1,6]], [[2,0],[2,1]], [[3,4],[4,4]], [[4,0],[4,1]]],
  [[[1,3],[2,3]], [[2,0],[2,1]], [[1,5],[2,5]], [[3,4],[3,5]], [[4,1],[5,1]]]
];

const COL_ORDERS = [
  [[2,4,1,5,3,0,6], [1,4,2,5,0,3,6], [0,3,5,2,4,1,6], [3,1,4,2,5,0,6], [1,4,2,5,0,3,6]],
  [[1,5,3,2,6,0,4], [2,6,0,4,1,5,3], [1,4,6,2,0,3,5], [4,2,5,1,3,0,6], [2,5,1,4,0,3,6]],
  [[0,4,2,5,3,1,6], [2,5,1,4,3,0,6], [3,6,1,4,0,2,5], [1,5,2,4,3,0,6], [0,3,5,1,4,2,6]],
  [[3,6,0,4,2,5,1], [0,4,2,6,1,3,5], [2,5,0,3,6,1,4], [2,4,1,5,3,0,6], [1,5,3,0,4,2,6]],
  [[1,3,6,2,5,0,4], [0,3,5,1,4,2,6], [1,4,2,6,0,3,5], [5,2,4,1,3,0,6], [2,4,1,5,0,3,6]],
  [[2,4,0,5,3,1,6], [1,3,5,2,4,0,6], [1,4,0,5,2,3,6], [2,5,1,4,3,0,6], [1,4,2,5,0,3,6]]
];

const lcg = (s) => { let x = s; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; };
const isWon = (st) => st.eliminatedPixels >= st.totalPixels;
const isDead = (st) => !!(st.overflow || st.buffer.length > st.bufferLimit || Sim.isDeadEnd(st));

function playOneFourSide(lv, p, r, isHum = false) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  for (let step = 0; step < 80; step++) {
    if (isWon(s)) return { won: true, prog: 1 };
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    if (!ms.length) break;
    let pick = null;
    const useG = (p >= 1) || (p > 0 && r() < p);
    if (isHum) {
      const allMoves = [];
      for (const m of ms) {
        const t = St.cloneState(s), e0 = t.eliminatedPixels, c0 = t.completedBoxes;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        allMoves.push({
          t, alive: !isDead(t) || isWon(t),
          gain: t.eliminatedPixels - e0,
          bufAfter: t.buffer.length,
          cleared: t.completedBoxes > c0 ? 1 : 0
        });
      }
      const aliveList = allMoves.filter(o => o.alive);
      if (useG) {
        if (aliveList.length) {
          aliveList.sort((a, b) => (b.cleared - a.cleared) || (a.bufAfter - b.bufAfter) || (b.gain - a.gain));
          const top = aliveList[0];
          const tied = aliveList.filter(o => o.cleared === top.cleared && o.bufAfter === top.bufAfter && o.gain === top.gain);
          pick = tied[Math.floor(r() * tied.length)].t;
        }
      } else if (s.buffer.length <= 2) {
        const chunkVis = aliveList.filter(o => o.gain >= 6);
        const anyVis   = aliveList.filter(o => o.gain > 0);
        const pool = chunkVis.length ? chunkVis : (anyVis.length ? anyVis : aliveList);
        if (pool.length) pick = pool[Math.floor(r() * pool.length)].t;
      } else {
        const fatalVis = allMoves.filter(o => !o.alive && o.gain >= 8);
        const safeChunk = aliveList.filter(o => o.gain >= 6);
        const safeVis = safeChunk.length ? safeChunk : aliveList.filter(o => o.gain > 0);
        if (fatalVis.length > 0 && r() < 0.20) pick = null;
        else if (safeVis.length) pick = safeVis[Math.floor(r() * safeVis.length)].t;
        else if (aliveList.length) pick = aliveList[Math.floor(r() * aliveList.length)].t;
      }
    } else if (useG) {
      const cand = [];
      let bg = -Infinity;
      for (const m of ms) {
        const t = St.cloneState(s), e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (isDead(t) && !isWon(t)) continue;
        const g = t.eliminatedPixels - e0;
        if (g > bg) bg = g;
        cand.push({ t, g });
      }
      if (cand.length) {
        const tied = cand.filter(o => o.g === bg);
        pick = tied[Math.floor(r() * tied.length)].t;
      }
    } else {
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      for (const i of idx) {
        const m = ms[i], t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!isDead(t) || isWon(t)) { pick = t; break; }
      }
    }
    if (!pick) break;
    s = pick;
  }
  return { won: isWon(s), prog: s.eliminatedPixels / s.totalPixels };
}

function maxSameColorRun(spools) {
  let mr = 1;
  const R = spools.length, C = spools[0].length;
  for (let r = 0; r < R; r++) {
    let run = 1;
    for (let c = 1; c < C; c++) {
      if (spools[r][c].id > 0 && spools[r][c].id === spools[r][c - 1].id) { run++; if (run > mr) mr = run; }
      else run = 1;
    }
  }
  for (let c = 0; c < C; c++) {
    let run = 1;
    for (let r = 1; r < R; r++) {
      if (spools[r][c].id > 0 && spools[r][c].id === spools[r - 1][c].id) { run++; if (run > mr) mr = run; }
      else run = 1;
    }
  }
  return mr;
}

function fixSameColorRuns(spools) {
  const R = spools.length, C = spools[0].length;
  const isPlain = (x) => x && x.id > 0 && x.count > 0 && x.type === 0;
  for (let pass = 0; pass < 40 && maxSameColorRun(spools) > 3; pass++) {
    for (let r = 0; r < R; r++) {
      let run = 1;
      for (let c = 1; c < C; c++) {
        if (spools[r][c].id > 0 && spools[r][c].id === spools[r][c - 1].id) {
          run++;
          if (run > 3) {
            // 搜索全盘 (0..R-1) 任意不同色的普通车对调（优先邻行，其次全盘）
            let swapped = false;
            const rowOrder = [];
            for (let rr = 0; rr < R; rr++) if (rr !== r) rowOrder.push(rr);
            rowOrder.sort((a, b) => Math.abs(a - r) - Math.abs(b - r));
            for (const rr of rowOrder) {
              for (let cc = 0; cc < C && !swapped; cc++) {
                if (spools[rr][cc].id > 0 && spools[rr][cc].id !== spools[r][c].id && isPlain(spools[r][c]) && isPlain(spools[rr][cc])) {
                  const tmp = spools[r][c]; spools[r][c] = spools[rr][cc]; spools[rr][cc] = tmp;
                  swapped = true;
                }
              }
              if (swapped) break;
            }
          }
        } else run = 1;
      }
    }
    for (let c = 0; c < C; c++) {
      let run = 1;
      for (let r = 1; r < R; r++) {
        if (spools[r][c].id > 0 && spools[r][c].id === spools[r - 1][c].id) {
          run++;
          if (run > 3) {
            let swapped = false;
            for (let rr = 0; rr < R && !swapped; rr++) {
              for (let cc = 0; cc < C && !swapped; cc++) {
                if (cc !== c && spools[rr][cc].id > 0 && spools[rr][cc].id !== spools[r][c].id && isPlain(spools[r][c]) && isPlain(spools[rr][cc])) {
                  const tmp = spools[r][c]; spools[r][c] = spools[rr][cc]; spools[rr][cc] = tmp;
                  swapped = true;
                }
              }
            }
          }
        } else run = 1;
      }
    }
  }
}

function climbFourSide(gameIn, iters, games, seed, lo, hi) {
  const rnd = lcg(seed);
  const mid = (lo + hi) / 2;
  let cur = JSON.parse(JSON.stringify(gameIn));
  const isPlain = (x) => x && x.id > 0 && x.count > 0 && x.type === 0;
  function evalG(g) {
    if (maxSameColorRun(g.spools) > 3) return null;
    const lv = A.parseLevel(A.fromGameFormat(g));
    const PS = [0, 0.1, 0.2, 0.8, 0.9, 1.0];
    const rates = {};
    let deaths = 0, early = 0;
    for (const p of PS) {
      const r = lcg(seed);
      let w = 0;
      for (let i = 0; i < games; i++) {
        const res = playOneFourSide(lv, p, r);
        if (res.won) w++; else { deaths++; if (res.prog < 0.1) early++; }
      }
      rates[p] = w / games;
    }
    const casual = (rates[0] + rates[0.1] + rates[0.2]) / 3;
    const fair = (rates[0.8] + rates[0.9] + rates[1]) / 3;
    const earlyShare = deaths ? early / deaths : 0;
    let inv = 0;
    for (let i = 1; i < PS.length; i++) if (rates[PS[i]] < rates[PS[i - 1]]) inv++;
    // 【2026-11-24 惰性双目标联合爬山】只在主尺 casual 接近目标带 [lo-0.10, hi+0.10] 且 fair>=0.85 时才测慢4倍的短视真人，兼顾速度与双尺命中！
    const humMid = (HUM_MIN + Math.min(0.75, HUM_MAX)) / 2;
    let humCasual = humMid, humFair = 1.0, humPen = 0;
    if (casual >= lo - 0.10 && casual <= hi + 0.10 && fair >= 0.85 && earlyShare <= 0.18) {
      const hGames = Math.min(games, 8);
      const rh = lcg(seed), rhF = lcg(seed);
      let hw = 0, hfw = 0;
      for (let i = 0; i < hGames; i++) {
        if (playOneFourSide(lv, 0.1, rh, true).won) hw++;
        if (playOneFourSide(lv, 0.9, rhF, true).won) hfw++;
      }
      humCasual = hw / hGames;
      humFair = hfw / hGames;
      const humOver = Math.max(0, humCasual - HUM_MAX);
      const humUnder = Math.max(0, HUM_MIN - humCasual);
      humPen = 0.85 * (humOver + humUnder) + 0.6 * Math.max(0, 0.88 - humFair);
    }
    const sc = Math.abs(casual - mid) + humPen + 2.5 * Math.max(0, earlyShare - 0.15) + 0.6 * Math.max(0, 0.90 - fair) + 0.02 * inv;
    return { casual, fair, humCasual, humFair, earlyShare, inv, sc };
  }
  let bestEv = evalG(cur) || { sc: 1e9 };
  // 【2026-11-23 修复】必须允许「前排(0..2) ↔ 深层(3..6)」跨行对调（把外圈色压到后排、把深层色提到前排），才能在四边模式下把原随意档从 1.00 压进 .55-.68！
  for (let it = 0; it < iters; it++) {
    const front = [], deep = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!isPlain(cur.spools[r][c]) || CLIMAX_SET.has(`${r},${c}`)) continue;
      if (r <= 2) front.push([r, c]);
      if (r >= 3) deep.push([r, c]);
    }
    if (!front.length || !deep.length) break;
    const [r1, c1] = front[Math.floor(rnd() * front.length)];
    const [r2, c2] = deep[Math.floor(rnd() * deep.length)];
    if (cur.spools[r1][c1].id === cur.spools[r2][c2].id && cur.spools[r1][c1].count === cur.spools[r2][c2].count) continue;
    const cand = JSON.parse(JSON.stringify(cur));
    const tmp = cand.spools[r1][c1]; cand.spools[r1][c1] = cand.spools[r2][c2]; cand.spools[r2][c2] = tmp;
    const ev = evalG(cand);
    const fairOk = ev && (ev.fair >= 0.88 || ev.fair >= (bestEv.fair || 0)) && ((ev.humFair ?? 1) >= 0.88 || (ev.humFair ?? 1) >= (bestEv.humFair ?? 0));
    const earlyOk = ev && (ev.earlyShare <= 0.15 || ev.earlyShare <= (bestEv.earlyShare || 1));
    const casBoundOk = ev && (ev.casual <= Math.max(bestEv.casual ?? 1, hi) && ev.casual >= Math.min(bestEv.casual ?? 0, lo));
    const humBoundOk = ev && (ev.humCasual <= Math.max(bestEv.humCasual ?? 1, HUM_MAX) && ev.humCasual >= Math.min(bestEv.humCasual ?? 0, HUM_MIN));
    if (ev && fairOk && earlyOk && casBoundOk && humBoundOk && ev.sc <= bestEv.sc) {
      cur = cand; bestEv = ev;
      if (ev.casual >= lo && ev.casual <= hi && ev.humCasual >= HUM_MIN && ev.humCasual <= HUM_MAX && ev.fair >= 0.90 && (ev.humFair ?? 1) >= 0.88 && ev.earlyShare < 0.15) break;
    }
  }
  return cur;
}

function setupEndgameClimax(game, opts = {}) {
  // 【2026-11-24 派工#001 补实：原实现只有 corePx/shellPx 统计，是空壳，没有任何车位交换】
  // 终局“第 5 行核心色大车明牌挡住正下方第 6 行内壳钥匙车（挪车让路蓄水清盘）”机关：
  //   ① 2 辆 shellPx 内壳色车 -> 第 6 行 (6,2)/(6,4)；
  //   ② 2 辆 corePx 核心色大车 -> 正上方第 5 行 (5,2)/(5,4)，且与正下方 (6,col) 异色、容量尽可能大；
  //   ③ 只在 r ∈ [4,6] 内部互换，绝不动 row 0..3 的前中段交错。
  const Bmat = game.blocks, R = Bmat.length, C = Bmat[0].length;
  const corePx = {}, shellPx = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = Bmat[r][c]; if (v <= 0) continue;
    const d = Math.min(r, R - 1 - r, c, C - 1 - c);
    if (d >= Math.floor(Math.min(R, C) * 0.38)) corePx[v] = (corePx[v] || 0) + 1;
    else if (d >= Math.floor(Math.min(R, C) * 0.25)) shellPx[v] = (shellPx[v] || 0) + 1;
  }
  // 先修横向同色长串，再做定点换位，避免 fixSameColorRuns 把刚摆好的 2x2 机关又洗掉
  if (!opts.skipFix) fixSameColorRuns(game.spools);

  const S = game.spools, SR = S.length, SC = S[0].length;
  const ROW_LO = 4, ROW_HI = Math.min(6, SR - 1);
  const plain = (r, c) => !!(S[r] && S[r][c] && S[r][c].type === 0 && S[r][c].id > 0 && S[r][c].count > 0);
  const swap = (a, b) => { const t = S[a[0]][a[1]]; S[a[0]][a[1]] = S[b[0]][b[1]]; S[b[0]][b[1]] = t; };
  const report = { shellPlaced: 0, corePlaced: 0 };

  // ① 内壳钥匙车 -> (6,2)/(6,4)
  for (const tc of [2, 4]) {
    if (6 > ROW_HI || tc >= SC) continue;
    if (!plain(6, tc)) continue; // 不碰管道/冰块/黑块/锁链，只换普通车位
    if (shellPx[S[6][tc].id] > 0) { report.shellPlaced++; continue; }
    const cands = [];
    for (let r = ROW_LO; r <= ROW_HI; r++) for (let c = 0; c < SC; c++) {
      if (!plain(r, c) || CLIMAX_SET.has(`${r},${c}`)) continue;
      const id = S[r][c].id;
      if (!(shellPx[id] > 0)) continue;
      cands.push({ r, c, id, core: corePx[id] || 0, count: S[r][c].count });
    }
    // 纯内壳色优先（不把核心色沉到第 6 行）；同色次之；离目标列近、容量小的优先，把大车留给第 5 行核心位
    cands.sort((a, b) => (a.core - b.core) || (Math.abs(a.c - tc) - Math.abs(b.c - tc)) || (a.count - b.count));
    if (!cands.length) continue;
    swap([6, tc], [cands[0].r, cands[0].c]);
    report.shellPlaced++;
  }

  // ② 核心色大车 -> (5,2)/(5,4)，必须与正下方 (6,col) 异色
  for (const tc of [2, 4]) {
    if (5 > ROW_HI || tc >= SC) continue;
    if (!plain(5, tc)) continue;
    const belowId = plain(6, tc) ? S[6][tc].id : -1;
    if ((corePx[S[5][tc].id] > 0) && S[5][tc].id !== belowId) { report.corePlaced++; continue; }
    const cands = [];
    for (let r = ROW_LO; r <= ROW_HI; r++) for (let c = 0; c < SC; c++) {
      if (!plain(r, c) || CLIMAX_SET.has(`${r},${c}`)) continue;
      const id = S[r][c].id;
      if (!(corePx[id] > 0) || id === belowId) continue;
      cands.push({ r, c, id, count: S[r][c].count });
    }
    cands.sort((a, b) => (b.count - a.count) || (Math.abs(a.c - tc) - Math.abs(b.c - tc)));
    if (!cands.length) continue;
    swap([5, tc], [cands[0].r, cands[0].c]);
    report.corePlaced++;
  }
  return report;
}

function buildWithStyle(baseLv, styleIdx, workDir) {
  const lv0 = JSON.parse(fs.readFileSync(baseLv, 'utf8'));
  const colorCars = {};
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    const id = lv0.spools[r][c].id;
    if (id > 0) colorCars[id] = (colorCars[id] || 0) + 1;
  }

  let curLv = JSON.parse(JSON.stringify(lv0));
  // 1. 布置终局“第 5 行核心色车明牌挡住正下方第 6 行内壳钥匙车”机关
  setupEndgameClimax(curLv);

  // 2. 自动把 row 0..2 以及当前 style 所有预设链格上的全盘唯一车(cars===1)与 row 3..5 的非链冗余色对调，并确保每对链两格异色！
  const pairs = CHAIN_STYLES[styleIdx % CHAIN_STYLES.length];
  const planChainSet = new Set();
  pairs.forEach(([a, b]) => { planChainSet.add(`${a[0]},${a[1]}`); planChainSet.add(`${b[0]},${b[1]}`); });
  for (let r = 0; r <= 4; r++) for (let c = 0; c < 7; c++) {
    if ((r <= 2 || planChainSet.has(`${r},${c}`)) && (colorCars[curLv.spools[r][c].id] || 0) <= 1) {
      let swapped = false;
      for (let rr = 5; rr >= 3 && !swapped; rr--) for (let cc = 1; cc < 6 && !swapped; cc++) {
        if (!planChainSet.has(`${rr},${cc}`) && !CLIMAX_SET.has(`${rr},${cc}`) && (colorCars[curLv.spools[rr][cc].id] || 0) >= 4) {
          const tmp = curLv.spools[r][c]; curLv.spools[r][c] = curLv.spools[rr][cc]; curLv.spools[rr][cc] = tmp;
          swapped = true;
        }
      }
    }
  }
  for (const [a, b] of pairs) {
    if (curLv.spools[a[0]][a[1]].id === curLv.spools[b[0]][b[1]].id) {
      let swapped = false;
      for (let rr = 4; rr >= 2 && !swapped; rr--) for (let cc = 0; cc < 7 && !swapped; cc++) {
        if (!planChainSet.has(`${rr},${cc}`) && curLv.spools[rr][cc].id !== curLv.spools[a[0]][a[1]].id && (colorCars[curLv.spools[rr][cc].id] || 0) >= 3) {
          const tmp = curLv.spools[b[0]][b[1]]; curLv.spools[b[0]][b[1]] = curLv.spools[rr][cc]; curLv.spools[rr][cc] = tmp;
          swapped = true;
        }
      }
    }
  }
  let cur = path.join(workDir, `s${styleIdx}_base.json`);
  fs.writeFileSync(cur, JSON.stringify(curLv, null, 1));

  // 3. 去模板化建链（第二排留 >=4 个无链无冰畅通口，绝不绑唯一车，绝不绑逃生阀）
  const chainUsed = new Set();
  const builtPairs = [];
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i];
    const nxt = path.join(workDir, `s${styleIdx}_c${i + 1}.json`);
    try {
      execFileSync('node', [
        path.join(ROOT, '实验关/产线v6/加链/建B_v1.js'),
        cur, `${a[0]},${a[1]}`, `${b[0]},${b[1]}`, nxt,
        '--gid', String(i + 1), '--max-row', '5'
      ], { stdio: 'ignore' });
      chainUsed.add(a[0] + ',' + a[1]);
      chainUsed.add(b[0] + ',' + b[1]);
      builtPairs.push([a, b]);
      cur = nxt;
    } catch (e) {}
  }

  // 3.2 可选「2小1大」安全三锁链 (--with-3chain，日志 §1188/§1190)：
  //     严禁 3 大车同绑（会让短视真人崩到 .233）；只准把 1 个紧邻的冗余小车(<=24px)并入已有二连链，或在中层 row 2-3 建 [小+小+中/大] 三连链！
  if (WITH_CHAIN3 && builtPairs.length > 0) {
    const d3c = JSON.parse(fs.readFileSync(cur, 'utf8'));
    let merged3 = false;
    for (let gi = 0; gi < builtPairs.length && !merged3; gi++) {
      const gid = gi + 1;
      const [[r1, c1], [r2, c2]] = builtPairs[gi];
      const cap1 = d3c.spools[r1][c1].count, cap2 = d3c.spools[r2][c2].count;
      // 要求已有两格中至少有一格 <=30px，且新并入的第3格必须是冗余小/中车(<=28px)，保证“2小1大”
      if (Math.min(cap1, cap2) > 32) continue;
      for (const [br, bc] of [[r1, c1], [r2, c2]]) {
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0]]) {
          const nr = br + dr, nc = bc + dc;
          if (nr < 1 || nr > 4 || nc < 0 || nc >= COLS) continue;
          const key = `${nr},${nc}`;
          if (chainUsed.has(key)) continue;
          const cell = d3c.spools[nr][nc];
          if (cell && cell.id > 0 && cell.type === 0 && cell.count <= 28 && (colorCars[cell.id] || 0) >= 3) {
            const nxt = path.join(workDir, `s${styleIdx}_chain3.json`);
            try {
              execFileSync('node', [
                path.join(ROOT, '实验关/产线v6/加链/建B_v1.js'),
                cur, `${br},${bc}`, `${nr},${nc}`, nxt,
                '--gid', String(gid), '--max-row', '5', '--allow-merge'
              ], { stdio: 'ignore' });
            } catch (e) {
              // 建B_v1 若因首格已是锁链拦截，直接安全写入合并格并过 LayoutScore L4 连通校验
              cell.type = 5; cell.param = gid;
              fs.writeFileSync(nxt, JSON.stringify(d3c, null, 1));
            }
            if (fs.existsSync(nxt)) {
              chainUsed.add(key);
              builtPairs[gi].push([nr, nc]);
              cur = nxt;
              merged3 = true;
              break;
            }
          }
        }
        if (merged3) break;
      }
    }
  }

  // 3.5 产线管道自治决策树 (--pipe-mode auto|0|1|2|3，日志 §1189/§1190)：
  //     1) auto 模式：统计 row 2..6 中 count>=45px 的冗余巨车数 giantCnt；
  //        - 若 LEVEL_IDX > 0 且 LEVEL_IDX % 9 === 0 -> 3 管主题关 (3根3辆管 + 0冰)
  //        - 若 giantCnt >= 6 或 (LEVEL_IDX > 0 && LEVEL_IDX % 5 === 0) -> 2 管门神关 (2根4辆管 + 2冰)
  //        - 若 giantCnt >= 3 或 (LEVEL_IDX > 0 && LEVEL_IDX % 3 === 0) -> 1 管替深冰关 (1根4辆管 + 5冰)
  //        - 其余 -> 0 管主力明牌关 (0管 + 9冰)
  const dPrePipe = JSON.parse(fs.readFileSync(cur, 'utf8'));
  let giantCnt = 0;
  for (let rr = 2; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
    const x = dPrePipe.spools[rr][cc];
    if (x && x.id > 0 && x.type === 0 && x.count >= 45 && (colorCars[x.id] || 0) >= 3) giantCnt++;
  }
  let targetPipes = 0;
  if (PIPE_MODE === 'auto') {
    if (LEVEL_IDX > 0 && LEVEL_IDX % 9 === 0) targetPipes = 3;
    else if (giantCnt >= 6 || (LEVEL_IDX > 0 && LEVEL_IDX % 5 === 0)) targetPipes = 2;
    else if (giantCnt >= 3 || (LEVEL_IDX > 0 && LEVEL_IDX % 3 === 0)) targetPipes = 1;
    else targetPipes = 0;
  } else {
    targetPipes = Math.max(0, Math.min(3, Number(PIPE_MODE) || 0));
  }

  const pipeUsed = new Set();
  const pipeColsUsed = [];
  if (targetPipes > 0) {
    const pipeCols = targetPipes === 1
      ? [(2 + styleIdx) % 5 + 1]
      : (targetPipes === 2 ? [1, 5] : [1, 3, 5]);
    const splitsPerPipe = targetPipes === 3 ? 2 : 3; // 3管用3辆队列(1整+2拆半)防拆光大车；1-2管用4辆队列(1整+3拆半)
    for (let pi = 0; pi < pipeCols.length; pi++) {
      const pCol = pipeCols[pi];
      const pipeCell = `4,${pCol}`;
      if (chainUsed.has(pipeCell) || pipeUsed.has(pipeCell)) continue;
      const dNow = JSON.parse(fs.readFileSync(cur, 'utf8'));
      const mouthMode = PIPE_MOUTH === 'auto'
        ? (targetPipes === 3 && pi === 1 ? 'small' : 'big') // 3管时中间管口放小车当突破口、两侧放大车当门神！
        : PIPE_MOUTH;
      if (mouthMode === 'big') {
        let bestRC = null, bestCap = dNow.spools[4][pCol].count;
        for (let rr = 3; rr <= 5; rr++) for (let cc = 0; cc < COLS; cc++) {
          const k = `${rr},${cc}`;
          if (chainUsed.has(k) || pipeUsed.has(k) || CLIMAX_SET.has(k) || pipeCols.includes(cc) && rr === 4) continue;
          const x = dNow.spools[rr][cc];
          if (x && x.type === 0 && (colorCars[x.id] || 0) >= 3 && x.count > bestCap) {
            bestCap = x.count; bestRC = [rr, cc];
          }
        }
        if (bestRC) {
          const [br, bc] = bestRC;
          const tmp = dNow.spools[4][pCol]; dNow.spools[4][pCol] = dNow.spools[br][bc]; dNow.spools[br][bc] = tmp;
          fs.writeFileSync(cur, JSON.stringify(dNow, null, 1));
        }
      }
      const pColor = dNow.spools[4][pCol].id;
      const seenCol = new Set([pColor]);
      const cands = [];
      for (let rr = 2; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
        const k = `${rr},${cc}`;
        if ((rr === 4 && pipeCols.includes(cc)) || chainUsed.has(k) || pipeUsed.has(k) || CLIMAX_SET.has(k)) continue;
        const cell = dNow.spools[rr][cc];
        if (cell && cell.id > 0 && cell.type === 0 && cell.count >= 24 && (colorCars[cell.id] || 0) >= 3) {
          cands.push({ r: rr, c: cc, id: cell.id, count: cell.count });
        }
      }
      cands.sort((a, b) => b.count - a.count);
      const splits = [];
      for (const cd of cands) {
        if (splits.length >= splitsPerPipe) break;
        if (!seenCol.has(cd.id)) { seenCol.add(cd.id); splits.push(`${cd.r},${cd.c}`); }
      }
      for (const cd of cands) {
        if (splits.length >= splitsPerPipe) break;
        const k = `${cd.r},${cd.c}`;
        if (!splits.includes(k)) splits.push(k);
      }
      if (splits.length === splitsPerPipe) {
        const nxt = path.join(workDir, `s${styleIdx}_pipe${pi + 1}.json`);
        try {
          execFileSync('node', [
            path.join(ROOT, '实验关/产线v6/难度带/四辆管/split_pipe_v1.js'),
            cur, nxt, '--pipe', pipeCell, '--dir', '11', '--split', splits.join(';')
          ], { stdio: 'ignore' });
          if (mouthMode === 'small') {
            const pObj = JSON.parse(fs.readFileSync(nxt, 'utf8'));
            pObj.spools[4][pCol].param = [...pObj.spools[4][pCol].param].reverse();
            fs.writeFileSync(nxt, JSON.stringify(pObj, null, 1));
          }
          pipeUsed.add(pipeCell);
          pipeColsUsed.push(pCol);
          splits.forEach(s => pipeUsed.add(s));
          cur = nxt;
        } catch (e) {}
      }
    }
  }

  // 4. 禁盲盒敲冰 + 障碍总量守恒（加管或加3黑块迷宫均自动减冰：0管0黑->9冰, 1管或黑块->7冰, 2管->1冰, 3管->0冰）
  const lvData = JSON.parse(fs.readFileSync(cur, 'utf8'));
  const actualPipes = pipeColsUsed.length;
  // 【派工#001】中后期封路冰恢复：哪怕 1 根管道或黑块，也保留 7 块冰（覆盖行 2/3/4/5/6），
  // 冰数字回到真实到达步数窗口（行4 18/19、行5 23、行6 27/28）；无管无黑块时 9 块。
  const rowNeeds = actualPipes >= 3
    ? []
    : (actualPipes === 2
      ? [[2, 2, 6]]
      : ((actualPipes === 1 || BLACK_MODE >= 2)
        ? [[2, 2, 7], [3, 2, 12], [4, 1, 18], [5, 1, 23], [6, 1, 27]]
        : [[2, 2, 7], [3, 2, 12], [4, 2, 18], [5, 1, 23], [6, 2, 27]]));
  // 【派工#002】靶向断供冰：预计算每色在四边外圈 3 层（深度<=2）的像素占比。
  // easyShare 越大 = 越容易在浅层/外圈被顺手消掉，是玩家的“救援顺手色”；
  // 选冰时优先冻这些色（断供），把内芯深色大债车裸露在冰外让玩家踩。
  const easyShare = {};
  {
    const B = lvData.blocks, BR = B.length, BC = B[0].length;
    const outerPx = {}, totalPx = {};
    for (let r = 0; r < BR; r++) for (let c = 0; c < BC; c++) {
      const v = B[r][c]; if (v <= 0) continue;
      totalPx[v] = (totalPx[v] || 0) + 1;
      if (Math.min(r, BR - 1 - r, c, BC - 1 - c) <= 2) outerPx[v] = (outerPx[v] || 0) + 1;
    }
    for (const id of Object.keys(totalPx)) easyShare[id] = (outerPx[id] || 0) / totalPx[id];
  }
  const iceCells = [];
  // 后排（r>=4）深水冰只冻充裕冗余色（>=3 辆），绝不冻只剩 2 辆的紧缺色；也绝不占用终局挪车 4 定点
  const minCarsForRow = (r) => (r >= 4 ? 3 : 2);
  const iceOk = (r, c) => {
    const key = `${r},${c}`;
    if (chainUsed.has(key) || pipeUsed.has(key) || CLIMAX_SET.has(key)) return false;
    const cell = lvData.spools[r][c];
    return !!(cell && cell.id > 0 && cell.type === 0 && (colorCars[cell.id] || 0) >= minCarsForRow(r));
  };
  for (let idx = 0; idx < rowNeeds.length; idx++) {
    const [r, need, baseParam] = rowNeeds[idx];
    const availCols = [];
    for (let c = 0; c < COLS; c++) if (iceOk(r, c)) availCols.push(c);
    // 救援价值从高到低：外圈顺手色优先；同价值时优先容量小的救援车，把内芯大债车露给玩家
    availCols.sort((c1, c2) => {
      const s1 = easyShare[lvData.spools[r][c1].id] || 0;
      const s2 = easyShare[lvData.spools[r][c2].id] || 0;
      return (s2 - s1) || (lvData.spools[r][c1].count - lvData.spools[r][c2].count);
    });
    const picked = [];
    for (const c of availCols) {
      if (picked.length >= need) break;
      if (need === 2 && picked.length === 1 && Math.abs(picked[0] - c) === 1) continue;
      picked.push(c);
    }
    // 无不相邻列时允许相邻，补足 need
    for (const c of availCols) {
      if (picked.length >= need) break;
      if (!picked.includes(c)) picked.push(c);
    }
    for (let i = 0; i < picked.length; i++) {
      iceCells.push(`${r},${picked[i]}:${baseParam + (i === 1 ? 1 : 0)}`);
    }
  }

  const icedLv = path.join(workDir, `s${styleIdx}_iced.json`);
  if (iceCells.length > 0) {
    execFileSync('node', [
      path.join(ROOT, '实验关/产线v6/难度带/冰剂量/add_ice_662.js'),
      cur, '--cells', iceCells.join(';'), '--out', icedLv
    ], { stdio: 'ignore' });
  } else {
    fs.copyFileSync(cur, icedLv);
  }

  // 5. 四边 corner 换位爬山（保护 row 5..6 的终局明牌挪车机关）
  const icedObj = JSON.parse(fs.readFileSync(icedLv, 'utf8'));

  // 4.5 可选「真黑块 (id: -1 永久实心墙) 改变棋盘拓扑」与「第2-3行问号车 (type: 6 远期迷雾)」(2026-11-23 日志 §1191)
  const blackCoords = [];
  if (BLACK_MODE >= 2) {
    const wantBlacks = BLACK_MODE >= 3 ? [[1, 3], [3, 1], [3, 5]] : [[2, 1], [2, 5]];
    for (const [br, bc] of wantBlacks) {
      let pickedRC = null;
      for (const dc of [0, 1, -1, 2, -2]) {
        const cc = bc + dc;
        if (cc < 0 || cc >= COLS) continue;
        const x = icedObj.spools[br][cc];
        if (x && x.id > 0 && x.type === 0 && (colorCars[x.id] || 0) >= 3) { pickedRC = [br, cc]; break; }
      }
      if (pickedRC) {
        const [pr, pc] = pickedRC;
        const cid = icedObj.spools[pr][pc].id, cap = icedObj.spools[pr][pc].count;
        let target = null;
        for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++) {
          if (r === pr && c === pc) continue;
          const y = icedObj.spools[r][c];
          if (y && y.id === cid && y.count > 0) {
            if (!target || y.count < target.count) target = y;
          }
        }
        if (target) {
          target.count += cap;
          icedObj.spools[pr][pc] = { id: -1, type: 0, param: 0, count: 0 };
          blackCoords.push([pr, pc]);
        }
      }
    }
  }
  const qCoords = [];
  if (Q_COUNT > 0) {
    // 严格只放在 row 2..3 的非链非冰普通车格（绝不放 row 0，也绝不放 row 5..6 终局明牌位！）
    for (let r = 2; r <= 3 && qCoords.length < Q_COUNT; r++) {
      for (const c of COL_ORDERS[styleIdx % COL_ORDERS.length][r - 2]) {
        if (qCoords.length >= Q_COUNT) break;
        const x = icedObj.spools[r][c];
        if (x && x.id > 0 && x.type === 0) {
          x.type = 6; x.param = 0;
          qCoords.push([r, c]);
        }
      }
    }
  }

  // 5. 四边 corner 换位爬山（允许前排0..2与深层3..6跨行错位，CLIMAX_SET 四定点已在 climbFourSide 内保护，爬山后严禁二次盲换破坏胜率！）
  const climbedObj = climbFourSide(icedObj, ITERS, 12, SEED, RAND_LO + 0.01, RAND_HI - 0.01);
  fixSameColorRuns(climbedObj.spools);
  const climbedLv = path.join(workDir, `s${styleIdx}_climbed.json`);
  fs.writeFileSync(climbedLv, JSON.stringify(climbedObj, null, 1));

  return { file: climbedLv, style: styleIdx, chains: builtPairs, pipes: actualPipes, blacks: blackCoords, questions: qCoords, ice: iceCells };
}

function fullVerifyV6(lvFile, workDir, tag) {
  // 1) 原三段口径（四边 + corner，默认口径）
  const qRand = path.join(workDir, `qr_${tag}`);
  execFileSync('node', [
    path.join(ROOT, '实验关/产线v5/C9_插值玩家/PInterpPlayer.js'),
    lvFile, '--p', '0,0.1,0.2,0.8,0.9,1', '--games', '25', '--seeds', String(SEED), '--out', qRand
  ], { stdio: 'ignore' });
  const sr = JSON.parse(fs.readFileSync(path.join(qRand, 'summary_all.json'), 'utf8'));
  const mr = {}; sr.forEach(x => { mr[x.p.toFixed(1)] = x; });
  const randCasual = +((mr['0.0'].winRate + mr['0.1'].winRate + mr['0.2'].winRate) / 3).toFixed(3);
  const randFair   = +((mr['0.8'].winRate + mr['0.9'].winRate + mr['1.0'].winRate) / 3).toFixed(3);
  const randWave   = mr['0.1'].bufWaveMean;

  // 2) 短视真人口径 + 三段暂存区波形
  const qHum = path.join(workDir, `qh_${tag}`);
  execFileSync('node', [
    path.join(ROOT, '实验关/产线v5/C9_插值玩家/PInterpPlayer.js'),
    lvFile, '--human-casual', '--p', '0,0.1,0.2,0.8,0.9,1', '--games', '25', '--seeds', String(SEED), '--out', qHum
  ], { stdio: 'ignore' });
  const sh = JSON.parse(fs.readFileSync(path.join(qHum, 'summary_all.json'), 'utf8'));
  const mh = {}; sh.forEach(x => { mh[x.p.toFixed(1)] = x; });
  const humCasual = +((mh['0.0'].winRate + mh['0.1'].winRate + mh['0.2'].winRate) / 3).toFixed(3);
  const humFair   = +((mh['0.8'].winRate + mh['0.9'].winRate + mh['1.0'].winRate) / 3).toFixed(3);
  const humWave   = mh['0.1'].bufWaveMean;

  // 3) 棘轮（四边 corner）
  const fRat = path.join(workDir, `rat_${tag}.json`);
  execFileSync('node', [
    path.join(TOOLS, 'ChainRatchetCheck_v1.js'), lvFile, '--out', fRat
  ], { stdio: 'ignore' });
  const rat = JSON.parse(fs.readFileSync(fRat, 'utf8')).rows[0] || {};
  const ratPass = !!rat.pass && (rat.flags || []).length === 0 && (rat.traps || []).length === 0;

  // 4) 早死（四边 corner）
  const fBait = path.join(workDir, `bait_${tag}.json`);
  execFileSync('node', [
    path.join(TOOLS, 'BaitLocator_v1.js'), lvFile, '--early', '0.1', '--games', '25', '--out', fBait
  ], { stdio: 'ignore' });
  const bait = JSON.parse(fs.readFileSync(fBait, 'utf8'));
  const earlyShare = (bait.earlyDeaths >= 3) ? +(bait.earlyShare || 0).toFixed(3) : 0;

  // 5) 可解性（四边 corner）
  const solOut = execFileSync('node', [
    path.join(TOOLS, 'Solvable_v1.js'), lvFile, '--width', '8'
  ], { encoding: 'utf8' }).trim().split('\n').pop();
  const sol = JSON.parse(solOut);

  // 6) 排版
  const layOut = execFileSync('node', [
    path.join(TOOLS, 'LayoutScore_v1.js'), lvFile
  ], { encoding: 'utf8' }).trim().split('\n').pop();
  const hard0 = /hard=0\b/.test(layOut) && /warn=0\b/.test(layOut);

  const d = JSON.parse(fs.readFileSync(lvFile, 'utf8'));
  const row1Open = d.spools[1].filter(c => c && c.id > 0 && c.type === 0).length;
  const maxIceParam = Math.max(0, ...d.spools.flat().map(c => c.type === 7 ? c.param : 0));
  const caps = new Set();
  d.spools.forEach(r => r.forEach(c => { if (c && c.id > 0) caps.add(c.count); }));

  const allPass = sol.solvable && hard0 && ratPass && earlyShare < 0.20 && row1Open >= 3 && maxIceParam <= MAX_ICE_CAP &&
    randFair >= FAIR_MIN && humFair >= FAIR_MIN && randCasual >= RAND_LO && randCasual <= RAND_HI && humCasual >= HUM_MIN && humCasual <= HUM_MAX;

  return {
    allPass, randCasual, randFair, randWave, humCasual, humFair, humWave,
    earlyShare, ratPass, solvable: sol.solvable, steps: sol.steps, hard0, row1Open, maxIceParam, distinctCaps: caps.size
  };
}

const work = fs.mkdtempSync('/tmp/v6pipeline_');
const baseLv = path.join(work, 'base.json');
execFileSync('node', [
  path.join(TOOLS, 'SplitLevel_v722.js'),
  '--target', TARGET, '--out', baseLv,
  '--rows', String(ROWS), '--cols', String(COLS), '--stagger-cap', '--no-first-test'
], { stdio: 'ignore' });

let best = null;
const TARGET_MID = (RAND_LO + RAND_HI) / 2;
for (let t = 0; t < MAX_TRIES; t++) {
  const st = (INIT_STYLE + t) % CHAIN_STYLES.length;
  try {
    const built = buildWithStyle(baseLv, st, work);
    const ver = fullVerifyV6(built.file, work, `s${st}`);
    const rec = { ...built, verify: ver };
    console.log(`[v6 try style=${st}] allPass=${ver.allPass} | 原随意=${ver.randCasual}/${ver.randFair} 波形=${JSON.stringify(ver.randWave)} | 短视真人=${ver.humCasual}/${ver.humFair} 波形=${JSON.stringify(ver.humWave)} | 早死=${(ver.earlyShare*100).toFixed(1)}% | 棘轮=${ver.ratPass} | 冰上限=${ver.maxIceParam} | 二排畅口=${ver.row1Open} | 面额=${ver.distinctCaps}`);
    const hardSafe = ver.solvable && ver.hard0 && ver.ratPass && ver.earlyShare < 0.20 && ver.row1Open >= 3 && ver.maxIceParam <= MAX_ICE_CAP && ver.randFair >= FAIR_MIN && ver.humFair >= FAIR_MIN;
    const bestSafe = best ? (best.verify.solvable && best.verify.hard0 && best.verify.ratPass && best.verify.earlyShare < 0.20 && best.verify.row1Open >= 3 && best.verify.maxIceParam <= MAX_ICE_CAP && best.verify.randFair >= FAIR_MIN && best.verify.humFair >= FAIR_MIN) : false;
    if (!best || (ver.allPass && !best.verify.allPass) ||
        (!ver.allPass && !best.verify.allPass && hardSafe && !bestSafe) ||
        (ver.allPass === best.verify.allPass && hardSafe === bestSafe && Math.abs(ver.randCasual - TARGET_MID) < Math.abs(best.verify.randCasual - TARGET_MID))) {
      best = rec;
    }
    if (ver.allPass) break;
  } catch (e) {
    console.error(`[v6 try style=${st}] error:`, e.message);
  }
}

if (!best) { console.error('所有 style 尝试均失败'); process.exit(1); }
fs.copyFileSync(best.file, OUT);
if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(best, null, 2));
console.log(JSON.stringify({ ok: true, out: OUT, chosenStyle: best.style, chains: best.chains, ice: best.ice, verify: best.verify }));
