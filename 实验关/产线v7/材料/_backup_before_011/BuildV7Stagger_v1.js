#!/usr/bin/env node
'use strict';
/**
 * BuildV7Stagger_v1.js —— v7 真·三面墙端到端一键自动造关与 7 项硬门闭环流水线（2026-11-22 第四刀，日志 §1181–§1183）
 *
 * 全链路零人工干预闭环：
 *   1) 真·三面墙 + 大小车错配切摆：SplitLevel_v722 --bottom-only --stagger-cap
 *      （自底向上摆盘，第一排 5-7 车底边开局直消；同色切成 11-15px 小车与 24-29px 大车，每色总像素 100% 守恒）；
 *   2) 锁链去模板化 + 自动避开全盘唯一车(cars===1) + 第二排留 >=3 个无链无冰畅通口：
 *      在 6 套截然不同的“分对不串排”几何链骨架中按 style 尝试，若某对链碰了唯一车则自动平移避开；
 *   3) 9 块冰错落打散（绝不碰 row 0 和 row 1！行 2-6 按 6 套错落列序选冗余色，带 8/9、13/14、17/18、25/26 自然微差）；
 *   4) 短视真人/随机双口径换位微调（SwapClimb_v7）；
 *   5) 7 项硬门全自动闭环自检（若当前 style 未通过棘轮/早死/可解/排版或难度越界，自动切换下一个 style 重试）：
 *      ① 短视真人口径 (--human-casual)：随意档 + 认真档 >=.90 + 三段暂存区波形 bufWaveMean + 中段紧迫率
 *      ② 旧随机口径：随意档 + 认真档 >=.85
 *      ③ 真·三面墙早死门 (BaitLocator --bottom-only --instant-chain)：< 20%
 *      ④ 真·三面墙棘轮 (ChainRatchetCheck --bottom-only --instant-chain)：PASS (flags=0, traps=0)
 *      ⑤ 真·三面墙逃生阀 (EscapeValveCheck --bottom-only --instant-chain)：PASS
 *      ⑥ 真·三面墙可通关 (Solvable_v1 --bottom-only --instant-chain)：solvable=true (1024/1024)
 *      ⑦ 排版与逐色守恒 (LayoutScore_v1)：hard=0
 *
 * 用法：
 *   node BuildV7Stagger_v1.js --target <34_修正/X.txt> --out <输出.json> [--style 0..5] [--with-pipe]
 *        [--pipe-mode auto|0|1|2|3] [--pipe-mouth auto|big|small|dumbbell] [--report <证书.json>]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const TOOLS = path.join(ROOT, '03_工具/正式版');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(k);

const TARGET = arg('--target', null);
const OUT = arg('--out', null);
const INIT_STYLE = Number(arg('--style', '0'));
const WITH_PIPE = has('--with-pipe');
const PIPE_MODE = arg('--pipe-mode', WITH_PIPE ? '1' : 'auto'); // 'auto' (按大车数与周期自动选0/1/2/3管) | '0' | '1' | '2' | '3'
const PIPE_MOUTH = arg('--pipe-mouth', 'auto'); // 'auto' (自动找平) | 'big' | 'small' | 'dumbbell' (哑铃 [大,小,小,次大])
const PIPE_REPLACE_ICE = !has('--keep-9-ice'); // 有管道时默认开启「管道替深水冰」，传 --keep-9-ice 则保留 9 冰
const LEVEL_IDX = Number(arg('--level-idx', '0'));
const WITH_CHAIN3 = has('--with-3chain'); // 启用「2小1大」安全三锁链
const BLACK_MODE = Number(arg('--black-mode', '0')); // 0 | 2 (腰部对称双黑块) | 3 (品字形三黑块迷宫+自动替掉4块深冰)
const Q_COUNT = Number(arg('--q-count', '0')); // 0 | 2..4 (在第2-3行放问号车遮挡远期视野，绝不放第5-6行终局位)
const SHELL_SINK = !has('--no-shell-sink'); // 【派工#006 消融开关】默认开启隔板色沉底
// 【派工#010】棋盘尺寸自适应：未显式传 --rows/--cols 时，W>=39 的大图自动 7×8（56 格，对齐分组 1 原版）
function detectInputWidth(file) {
  try {
    const ls = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    const body = ls[0].startsWith('像素') ? ls.slice(1) : ls;
    for (const l of body) if (l.trim()) return l.trim().split(/\s+/).length;
  } catch (e) {}
  return 35;
}
const INPUT_W = detectInputWidth(TARGET);
const ROWS = has('--rows') ? Number(arg('--rows')) : 7;
const COLS = has('--cols') ? Number(arg('--cols')) : (INPUT_W >= 39 ? 8 : 7);
// 【派工#009】--tier 档位预设（显式参数优先，100% 向下兼容；不传时沿用旧默认）
const TIER = String(arg('--tier', 'auto') || 'auto').toUpperCase();
const TIER_PRESETS = {
  A: { randLo: 0.65, randHi: 0.85, humMin: 0.58, humMax: 0.88, humMidMin: 0.72, humMidMax: 0.95, fairMin: 0.92 },
  B: { randLo: 0.48, randHi: 0.68, humMin: 0.40, humMax: 0.68, humMidMin: 0.60, humMidMax: 0.84, fairMin: 0.88 },
  C: { randLo: 0.30, randHi: 0.60, humMin: 0.22, humMax: 0.50, humMidMin: 0.45, humMidMax: 0.72, fairMin: 0.85 }
};
const TP = TIER_PRESETS[TIER] || null;
const BC_TIER = (TIER === 'B' || TIER === 'C');
const AUTO_GEAR = !has('--no-auto-gear');
const AUTO_BAND = !has('--no-auto-band');
const RAND_LO = has('--rand-lo') ? Number(arg('--rand-lo')) : (TP ? TP.randLo : 0.55);
const RAND_HI = has('--rand-hi') ? Number(arg('--rand-hi')) : (TP ? TP.randHi : 0.68);
const HUM_MIN = has('--hum-min') ? Number(arg('--hum-min')) : (TP ? TP.humMin : 0.32);
const HUM_MAX = has('--hum-max') ? Number(arg('--hum-max')) : (TP ? TP.humMax : 1.00);
const HUM_MID_MIN = has('--hum-mid-min') ? Number(arg('--hum-mid-min')) : (TP ? TP.humMidMin : 0);
const HUM_MID_MAX = has('--hum-mid-max') ? Number(arg('--hum-mid-max')) : (TP ? TP.humMidMax : 1);
const FAIR_MIN = has('--fair-min') ? Number(arg('--fair-min')) : (TP ? TP.fairMin : 0.90);
const ITERS = Number(arg('--iters', '25'));
const SEED = Number(arg('--seed', '977'));
const REPORT = arg('--report', null);
const MAX_TRIES = Number(arg('--tries', '4'));
// 【派工#009】CLI 锁定标记：未显式传的旋钮允许 gear 自适应覆盖
const LOCK_PIPE_MODE = has('--pipe-mode') || WITH_PIPE;
const LOCK_PIPE_MOUTH = has('--pipe-mouth');
const LOCK_BLACK = has('--black-mode');
const LOCK_Q = has('--q-count');

// 【派工#001】终局挪车机关四定点：第 5 行核心色大车压住第 6 行内壳钥匙车。
// 管道拆分 / 选冰 / 前排唯一车对调都不得占用或替换这 4 格（爬山后再做一次最终落位兜底）。
const CLIMAX_SET = new Set(['5,2', '5,4', '6,2', '6,4']);

// 【2026-11-24 派工#001】三面墙版终局挪车高潮机关：
//   v7 按图的上部 25% 行为 corePx 最顶层核心色、25%~48% 行为 shellPx 次顶层内壳色；
//   把 2 辆 shellPx 车放到 (6,2)/(6,4)，把 2 辆 corePx 大车放到正上方 (5,2)/(5,4)，且与正下方异色、容量尽可能大；
//   只在 r ∈ [4,6] 后三行内部互换，绝不动 row 0..3。
function setupEndgameClimaxV7(game, opts = {}) {
  const Bmat = game.blocks, R = Bmat.length, C = Bmat[0].length;
  const corePx = {}, shellPx = {};
  const coreEnd = Math.floor(R * 0.25), shellEnd = Math.floor(R * 0.48);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = Bmat[r][c]; if (v <= 0) continue;
    if (r < coreEnd) corePx[v] = (corePx[v] || 0) + 1;
    else if (r < shellEnd) shellPx[v] = (shellPx[v] || 0) + 1;
  }

  const S = game.spools, SR = S.length, SC = S[0].length;
  const ROW_LO = 4, ROW_HI = Math.min(6, SR - 1);
  const plain = (r, c) => !!(S[r] && S[r][c] && S[r][c].type === 0 && S[r][c].id > 0 && S[r][c].count > 0);
  const swap = (a, b) => { const t = S[a[0]][a[1]]; S[a[0]][a[1]] = S[b[0]][b[1]]; S[b[0]][b[1]] = t; };
  const report = { shellPlaced: 0, corePlaced: 0 };

  // ① 内壳钥匙车 -> (6,2)/(6,4)
  for (const tc of [2, 4]) {
    if (6 > ROW_HI || tc >= SC) continue;
    if (!plain(6, tc)) continue;
    if (shellPx[S[6][tc].id] > 0) { report.shellPlaced++; continue; }
    const cands = [];
    for (let r = ROW_LO; r <= ROW_HI; r++) for (let c = 0; c < SC; c++) {
      if (!plain(r, c) || CLIMAX_SET.has(`${r},${c}`)) continue;
      const id = S[r][c].id;
      if (!(shellPx[id] > 0)) continue;
      cands.push({ r, c, id, core: corePx[id] || 0, count: S[r][c].count });
    }
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

  // ③ 【派工#006】隔板色沉底：把跑到 row 1..3 的隔板色(shell)普通车，与 row 4..6 的顶盖色(core)普通车对调，
  //    最多 2 辆、前排至少保留 1 辆（防棘轮死锁），让隔板色主力被扣在最后两排，
  //    玩家不挖穿到终局就剥不开顶盖色 → 70% 进度后仍有高潮。
  const shellIds = new Set();
  for (const tc of [2, 4]) { if (6 <= ROW_HI && tc < SC && plain(6, tc)) shellIds.add(S[6][tc].id); }
  let sunk = 0;
  if (SHELL_SINK && shellIds.size) {
    const front = [];
    for (let r = 1; r <= 3; r++) for (let c = 0; c < SC; c++) {
      if (plain(r, c) && shellIds.has(S[r][c].id)) front.push([r, c]);
    }
    for (const [fr, fc] of front) {
      if (sunk >= (opts.maxSink ?? 2) || front.length - sunk <= 1) break;
      let best = null;
      for (let rr = 6; rr >= 4; rr--) for (let cc = 0; cc < SC; cc++) {
        if (!plain(rr, cc) || CLIMAX_SET.has(`${rr},${cc}`)) continue;
        const id = S[rr][cc].id;
        if (shellIds.has(id) || !(corePx[id] > 0)) continue;
        if (!best || S[rr][cc].count > best.count) best = { r: rr, c: cc, count: S[rr][cc].count };
      }
      if (!best) continue;
      swap([fr, fc], [best.r, best.c]);
      sunk++;
    }
  }
  report.shellSunk = sunk;
  return report;
}

if (!TARGET || !OUT) {
  console.error('用法: node BuildV7Stagger_v1.js --target <图.txt> --out <输出.json> [--style 0..5] [--with-pipe] [--report 证书.json]');
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

function buildWithStyle(baseLv, styleIdx, workDir, gearOpts = {}) {
  // 【派工#009】动态配方：未显式锁定的旋钮由 gear 覆盖
  const gPipeMode = gearOpts.pipeMode !== undefined ? gearOpts.pipeMode : PIPE_MODE;
  const gPipeMouth = gearOpts.pipeMouth !== undefined ? gearOpts.pipeMouth : PIPE_MOUTH;
  const gBlackMode = gearOpts.blackMode !== undefined ? gearOpts.blackMode : BLACK_MODE;
  const gQCount = gearOpts.qCount !== undefined ? gearOpts.qCount : Q_COUNT;
  const gMaxSink = gearOpts.maxSink !== undefined ? gearOpts.maxSink : 2;
  const gIceScale = gearOpts.iceScale !== undefined ? gearOpts.iceScale : 1.0;
  const gWithChain3 = gearOpts.withChain3 !== undefined ? gearOpts.withChain3 : WITH_CHAIN3;
  const gChainPairs = gearOpts.chainPairs !== undefined ? gearOpts.chainPairs : 5;
  const gIters = gearOpts.iters !== undefined ? gearOpts.iters : ITERS;
  const lv0 = JSON.parse(fs.readFileSync(baseLv, 'utf8'));
  const colorCars = {};
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const id = lv0.spools[r][c].id;
    if (id > 0) colorCars[id] = (colorCars[id] || 0) + 1;
  }
  const isUnique = (r, c) => (colorCars[lv0.spools[r][c].id] || 0) <= 1;

  // 自动把 row 0..1 的唯一车(cars===1)以及当前 style 所有预设链格上“链外剩余车 < 2 辆”的紧缺色，与 row 3..6 非链格上的充裕色对调！
  // 从源头杜绝：① 唯一车被绑；② 只有2辆车的颜色被两条链全部锁光导致 buffer=4 时触发棘轮陷阱(ChainRatchet trap)！
  let curLv = JSON.parse(JSON.stringify(lv0));
  // 【派工#001】开头先摆终局挪车机关（爬山后再做一次最终落位兜底）
  const climax = setupEndgameClimaxV7(curLv, { maxSink: gMaxSink });
  const pairs = CHAIN_STYLES[styleIdx % CHAIN_STYLES.length].slice(0, Math.max(2, Math.min(5, gChainPairs)));
  const planChainSet = new Set();
  pairs.forEach(([a, b]) => { planChainSet.add(`${a[0]},${a[1]}`); planChainSet.add(`${b[0]},${b[1]}`); });
  const chainColorUsed = {};
  for (const [a, b] of pairs) {
    for (let idx = 0; idx < 2; idx++) {
      const [r, c] = idx === 0 ? a : b;
      const peerId = idx === 1 ? curLv.spools[a[0]][a[1]].id : -1;
      const id = curLv.spools[r][c].id;
      const used = chainColorUsed[id] || 0;
      // 锁链铁律：① 链内两格必须异色(id !== peerId)；② 同色最多进2个链格且链外至少留2辆普通车
      if (id === peerId || used >= 2 || (colorCars[id] || 0) - used <= 2) {
        let swapped = false;
        for (let rr = 5; rr >= 2 && !swapped; rr--) for (let cc = 0; cc < COLS && !swapped; cc++) {
          if (planChainSet.has(`${rr},${cc}`) || CLIMAX_SET.has(`${rr},${cc}`)) continue;
          const id2 = curLv.spools[rr][cc].id;
          const u2 = chainColorUsed[id2] || 0;
          if (id2 !== peerId && u2 < 2 && ((colorCars[id2] || 0) - u2 >= 3)) {
            const tmp = curLv.spools[r][c]; curLv.spools[r][c] = curLv.spools[rr][cc]; curLv.spools[rr][cc] = tmp;
            swapped = true;
          }
        }
      }
      const finalId = curLv.spools[r][c].id;
      chainColorUsed[finalId] = (chainColorUsed[finalId] || 0) + 1;
    }
  }
  for (let r = 0; r <= 1; r++) {
    for (let c = 0; c < COLS; c++) {
      const id = curLv.spools[r][c].id;
      if (!planChainSet.has(`${r},${c}`) && (colorCars[id] || 0) <= 1) {
        let swapped = false;
        for (let rr = 6; rr >= 3 && !swapped; rr--) for (let cc = 0; cc < COLS && !swapped; cc++) {
          const id2 = curLv.spools[rr][cc].id;
          if (!planChainSet.has(`${rr},${cc}`) && !CLIMAX_SET.has(`${rr},${cc}`) && (colorCars[id2] || 0) >= 3) {
            const tmp = curLv.spools[r][c]; curLv.spools[r][c] = curLv.spools[rr][cc]; curLv.spools[rr][cc] = tmp;
            swapped = true;
          }
        }
      }
    }
  }
  let cur = path.join(workDir, `s${styleIdx}_base.json`);
  fs.writeFileSync(cur, JSON.stringify(curLv, null, 1));

  const chainUsed = new Set();
  const builtPairs = [];
  for (let i = 0; i < pairs.length; i++) {
    const [a0, b0] = pairs[i];
    const nxt = path.join(workDir, `s${styleIdx}_c${i + 1}.json`);
    for (const dc of [0, -1, 1]) {
      const a = [a0[0], a0[1] + dc], b = [b0[0], b0[1] + dc];
      if (a[1] < 0 || a[1] >= COLS || b[1] < 0 || b[1] >= COLS) continue;
      if (chainUsed.has(`${a[0]},${a[1]}`) || chainUsed.has(`${b[0]},${b[1]}`)) continue;
      try {
        execFileSync('node', [
          path.join(ROOT, '实验关/产线v6/加链/建B_v1.js'),
          cur, `${a[0]},${a[1]}`, `${b[0]},${b[1]}`, nxt,
          '--gid', String(i + 1), '--max-row', '5', '--allow-valve'
        ], { stdio: 'ignore' });
        chainUsed.add(a[0] + ',' + a[1]);
        chainUsed.add(b[0] + ',' + b[1]);
        builtPairs.push([a, b]);
        cur = nxt;
        break;
      } catch (e) {}
    }
  }

  // 2.5 可选「2小1大」安全三锁链 (--with-3chain，日志 §1188/§1190)：
  //     严禁 3 大车同绑（实测会让短视真人从 .567 崩到 .233）；只准把 1 辆紧邻的冗余小车(<=16px)并入已有二连链，构成 [小+大+小] 三连链！
  if (gWithChain3 && builtPairs.length > 0) {
    const d3c = JSON.parse(fs.readFileSync(cur, 'utf8'));
    let merged3 = false;
    for (let gi = 0; gi < builtPairs.length && !merged3; gi++) {
      const gid = gi + 1;
      const [[r1, c1], [r2, c2]] = builtPairs[gi];
      const cap1 = d3c.spools[r1][c1].count, cap2 = d3c.spools[r2][c2].count;
      if (Math.min(cap1, cap2) > 20) continue;
      for (const [br, bc] of [[r1, c1], [r2, c2]]) {
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0]]) {
          const nr = br + dr, nc = bc + dc;
          if (nr < 1 || nr > 4 || nc < 0 || nc >= COLS) continue;
          const key = `${nr},${nc}`;
          if (chainUsed.has(key)) continue;
          const cell = d3c.spools[nr][nc];
          if (cell && cell.id > 0 && cell.type === 0 && cell.count <= 16 && (colorCars[cell.id] || 0) >= 3) {
            const nxt = path.join(workDir, `s${styleIdx}_chain3.json`);
            cell.type = 5; cell.param = gid;
            fs.writeFileSync(nxt, JSON.stringify(d3c, null, 1));
            chainUsed.add(key);
            builtPairs[gi].push([nr, nc]);
            cur = nxt;
            merged3 = true;
            break;
          }
        }
        if (merged3) break;
      }
    }
  }

  // 3. 产线管道自治决策树 (--pipe-mode auto|0|1|2|3，日志 §1189/§1190)
  const dPrePipe = JSON.parse(fs.readFileSync(cur, 'utf8'));
  let giantCnt = 0;
  for (let rr = 2; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
    const x = dPrePipe.spools[rr][cc];
    if (x && x.id > 0 && x.type === 0 && x.count >= 30 && (colorCars[x.id] || 0) >= 3) giantCnt++;
  }
  let targetPipes = 0;
  if (gPipeMode === 'auto') {
    if (LEVEL_IDX > 0 && LEVEL_IDX % 9 === 0) targetPipes = 3;
    else if (giantCnt >= 5 || (LEVEL_IDX > 0 && LEVEL_IDX % 5 === 0)) targetPipes = 2;
    else if (giantCnt >= 3 || (LEVEL_IDX > 0 && LEVEL_IDX % 3 === 0)) targetPipes = 1;
    else targetPipes = 0;
  } else {
    targetPipes = Math.max(0, Math.min(3, Number(gPipeMode) || 0));
  }

  const pipeUsed = new Set();
  const pipeColsUsed = [];
  const pipeQueues = [];
  if (targetPipes > 0) {
    const pipeCols = targetPipes === 1
      ? [(2 + styleIdx) % 5 + 1]
      : (targetPipes === 2 ? [1, 5] : [1, 3, 5]);
    const splitsPerPipe = targetPipes === 3 ? 2 : 3;
    for (let pi = 0; pi < pipeCols.length; pi++) {
      let pCol = pipeCols[pi];
      if (chainUsed.has(`4,${pCol}`) || pipeUsed.has(`4,${pCol}`)) {
        for (const altC of [3, 2, 4, 1, 5]) {
          if (!chainUsed.has(`4,${altC}`) && !pipeUsed.has(`4,${altC}`)) { pCol = altC; break; }
        }
      }
      const pipeCell = `4,${pCol}`;
      if (chainUsed.has(pipeCell) || pipeUsed.has(pipeCell)) continue;
      const dNow = JSON.parse(fs.readFileSync(cur, 'utf8'));
      const mouthMode = gPipeMouth === 'auto'
        ? (targetPipes === 3 && pi === 1 ? 'small' : 'big')
        : gPipeMouth;
      if (mouthMode === 'big') {
        let bestRC = null, bestCap = dNow.spools[4][pCol].count;
        for (let rr = 3; rr <= 5; rr++) for (let cc = 0; cc < COLS; cc++) {
          const k = `${rr},${cc}`;
          if (chainUsed.has(k) || pipeUsed.has(k) || CLIMAX_SET.has(k) || (pipeCols.includes(cc) && rr === 4)) continue;
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
      for (let rr = 3; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
        const k = `${rr},${cc}`;
        if ((rr === 4 && pipeCols.includes(cc)) || chainUsed.has(k) || pipeUsed.has(k) || CLIMAX_SET.has(k)) continue;
        const cell = dNow.spools[rr][cc];
        if (cell && cell.id > 0 && cell.type === 0 && cell.count >= 22 && (colorCars[cell.id] || 0) >= 3) {
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
          // 【派工#007 真·哑铃管】[大, 小, 小, 大]：先按容量排成 [最大,最小,最小,次大]；
          // 管口/管底任一端 <门槛（口 24px / 底 22px）时，就从盘面 row 3..6 找一辆 >=24px 的现成整车，
          // 与该端 {id,count} 整体互换 —— 管道变成真哑铃，且全盘逐色总像素 100% 守恒。
          if (mouthMode === 'dumbbell') {
            const pObj = JSON.parse(fs.readFileSync(nxt, 'utf8'));
            const q = pObj.spools[4][pCol].param;
            if (Array.isArray(q) && q.length === 4) {
              const byCap = q.slice().sort((a, b) => a.count - b.count);
              const newQ = [byCap[3], byCap[0], byCap[1], byCap[2]];
              const pickBoardCar = (minCap, excludeId) => {
                let bestRC = null, bestCap = minCap - 1;
                for (let rr = 3; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
                  const k = `${rr},${cc}`;
                  if ((rr === 4 && cc === pCol) || chainUsed.has(k) || pipeUsed.has(k) || CLIMAX_SET.has(k)) continue;
                  const cell = pObj.spools[rr][cc];
                  if (cell && cell.id > 0 && cell.type === 0 && cell.id !== excludeId && cell.count > bestCap) {
                    bestCap = cell.count; bestRC = [rr, cc];
                  }
                }
                return bestRC;
              };
              const swapInto = (slot, rc) => {
                const boardCell = pObj.spools[rc[0]][rc[1]];
                const tmp = { id: newQ[slot].id, count: newQ[slot].count };
                newQ[slot] = { id: boardCell.id, count: boardCell.count };
                boardCell.id = tmp.id; boardCell.count = tmp.count;
              };
              // 管口：拆半管的 max 常常只有 14–16px，也要换成 >=24px 整车，否则哑铃只剩一头大。
              if (newQ[0].count < 24) {
                const rc = pickBoardCar(24, newQ[3].id);
                if (rc) swapInto(0, rc);
              }
              // 管底：换一辆 >=24px 整车，保证 70% 后从管底吐出的大车顶后段波峰。
              if (newQ[3].count < 22) {
                const rc = pickBoardCar(24, newQ[0].id);
                if (rc) swapInto(3, rc);
              }
              pObj.spools[4][pCol].param = newQ;
              fs.writeFileSync(nxt, JSON.stringify(pObj, null, 1));
            }
          }
          try { pipeQueues.push({ r: 4, c: pCol, mode: mouthMode, param: JSON.parse(fs.readFileSync(nxt, 'utf8')).spools[4][pCol].param.map(q => q.count) }); } catch (e) {}
          pipeUsed.add(pipeCell);
          pipeColsUsed.push(pCol);
          splits.forEach(s => pipeUsed.add(s));
          cur = nxt;
        } catch (e) {}
      }
    }
  }

  // 【派工#003 A2】真黑块先于选冰：黑块落位/并车后立即重算盘面颜色计数，冰再按黑后计数选色
  const blackCoords = [];
  if (gBlackMode >= 2) {
    const preBlackObj = JSON.parse(fs.readFileSync(cur, 'utf8'));
    const preBoardCars = {};
    for (const row of preBlackObj.spools) for (const x of row) if (x && x.id > 0) preBoardCars[x.id] = (preBoardCars[x.id] || 0) + 1;
    const wantBlacks = gBlackMode >= 3 ? [[1, 2], [3, 1], [3, 4]] : [[2, 2], [2, 5]];
    for (const [br, bc] of wantBlacks) {
      let pickedRC = null;
      for (const dc of [0, 1, -1, 2, -2]) {
        const cc = bc + dc;
        if (cc < 0 || cc >= COLS) continue;
        const x = preBlackObj.spools[br][cc];
        if (x && x.id > 0 && x.type === 0 && (preBoardCars[x.id] || 0) >= 3) { pickedRC = [br, cc]; break; }
      }
      if (pickedRC) {
        const [pr, pc] = pickedRC;
        const cid = preBlackObj.spools[pr][pc].id, cap = preBlackObj.spools[pr][pc].count;
        let target = null;
        for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++) {
          if (r === pr && c === pc) continue;
          const y = preBlackObj.spools[r][c];
          if (y && y.id === cid && y.count > 0) {
            if (!target || y.count < target.count) target = y;
          }
        }
        if (target) {
          target.count += cap;
          preBlackObj.spools[pr][pc] = { id: -1, type: 0, param: 0, count: 0 };
          blackCoords.push([pr, pc]);
        }
      }
    }
    if (blackCoords.length) fs.writeFileSync(cur, JSON.stringify(preBlackObj, null, 1));
  }

  const lvData = JSON.parse(fs.readFileSync(cur, 'utf8'));
  const boardColorCars = {};
  for (const row of lvData.spools) for (const x of row) if (x && x.id > 0) boardColorCars[x.id] = (boardColorCars[x.id] || 0) + 1;
  const actualPipes = pipeColsUsed.length;
  // 【派工#009】解耦管道与冰：按棋盘真实槽位预算给阶梯冰，不再搞“3管0冰 / 2管只留2冰”一刀切。
  const iceScale = gearOpts.iceScale || 1.0;
  const scaleIce = (p) => Math.max(6, Math.min(33, Math.round(p * iceScale)));
  const fullLadder = (!PIPE_REPLACE_ICE || (actualPipes === 0 && gBlackMode < 2))
    ? [[2, 2, 10], [3, 2, 15], [4, 2, 21], [5, 1, 27], [6, 2, 32]]
    : (actualPipes >= 3
      ? [[2, 2, 10], [3, 1, 15], [4, 1, 21]]
      : (actualPipes === 2
        ? [[2, 2, 10], [3, 2, 15], [4, 1, 21], [5, 1, 27]]
        : [[2, 2, 10], [3, 2, 15], [4, 1, 21], [5, 1, 27], [6, 1, 32]]));
  const rowNeeds = fullLadder.map(([r, n, p]) => [r, n, scaleIce(p)]);
  // 【派工#009】图层深度靶向冰：分「底边前 30% 开门色」与「图中腰 30~70% 承接色」两段权重。
  const earlyBottomShare = {}, midWaistShare = {};
  {
    const B = lvData.blocks, BR = B.length, BC = B[0].length;
    const totalPx = {}, earlyPx = {}, midPx = {};
    const earlyStart = Math.floor(BR * 0.70);
    const midStart = Math.floor(BR * 0.30), midEnd = Math.floor(BR * 0.70);
    for (let r = 0; r < BR; r++) for (let c = 0; c < BC; c++) {
      const v = B[r][c]; if (v <= 0) continue;
      totalPx[v] = (totalPx[v] || 0) + 1;
      if (r >= earlyStart) earlyPx[v] = (earlyPx[v] || 0) + 1;
      if (r >= midStart && r < midEnd) midPx[v] = (midPx[v] || 0) + 1;
    }
    for (const id of Object.keys(totalPx)) {
      earlyBottomShare[id] = (earlyPx[id] || 0) / totalPx[id];
      midWaistShare[id] = (midPx[id] || 0) / totalPx[id];
    }
  }
  const iceCells = [];
  // 后排（r>=4）深水冰只冻充裕冗余色（>=3 辆），绝不冻只剩 2 辆的紧缺色；也绝不占用终局挪车 4 定点
  const minCarsForRow = (r) => (r >= 4 ? 3 : 2);
  const iceOk = (r, c) => {
    const key = `${r},${c}`;
    if (chainUsed.has(key) || pipeUsed.has(key) || CLIMAX_SET.has(key)) return false;
    const cell = lvData.spools[r][c];
    return !!(cell && cell.id > 0 && cell.type === 0 && (boardColorCars[cell.id] || 0) >= minCarsForRow(r));
  };
  for (let idx = 0; idx < rowNeeds.length; idx++) {
    const [r, need, baseParam] = rowNeeds[idx];
    const availCols = [];
    for (let c = 0; c < COLS; c++) if (iceOk(r, c)) availCols.push(c);
    // 【派工#009】分层靶向：前排浅冰冻「底边开门顺手色」，后排深冰冻「中腰主力承接色」
    const targetScore = (id) => (r <= 3
      ? (earlyBottomShare[id] || 0)
      : (midWaistShare[id] || 0) * 1.2 + (earlyBottomShare[id] || 0) * 0.5);
    availCols.sort((c1, c2) => {
      const s1 = targetScore(lvData.spools[r][c1].id);
      const s2 = targetScore(lvData.spools[r][c2].id);
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

  const icedObj = JSON.parse(fs.readFileSync(icedLv, 'utf8'));
  const qCoords = [];
  if (gQCount > 0) {
    for (let r = 2; r <= 3 && qCoords.length < gQCount; r++) {
      for (const c of COL_ORDERS[styleIdx % COL_ORDERS.length][r - 2]) {
        if (qCoords.length >= gQCount) break;
        const x = icedObj.spools[r][c];
        if (x && x.id > 0 && x.type === 0) {
          x.type = 6; x.param = 0;
          qCoords.push([r, c]);
        }
      }
    }
  }
  if (blackCoords.length > 0 || qCoords.length > 0) {
    fs.writeFileSync(icedLv, JSON.stringify(icedObj, null, 1));
  }

  const climbedLv = path.join(workDir, `s${styleIdx}_climbed.json`);
  const climbGames = INPUT_W >= 39 ? '6' : '12';
  const effIters = INPUT_W >= 39 ? String(Math.min(14, Number(gIters) || 14)) : String(gIters);
  execFileSync('node', [
    path.join(ROOT, '实验关/产线v7/材料/SwapClimb_v7.js'),
    icedLv, climbedLv, '--iters', effIters, '--games', climbGames, '--seed', String(SEED), '--hum-mid-min', String(HUM_MID_MIN), '--hum-mid-max', String(HUM_MID_MAX),
    '--lo', String(+(RAND_LO + 0.01).toFixed(3)), '--hi', String(+(RAND_HI - 0.02).toFixed(3)),
    '--hum-lo', String(HUM_MIN), '--hum-hi', String(+(HUM_MAX - 0.02).toFixed(3))
  ], { stdio: 'ignore' });

  return { file: climbedLv, style: styleIdx, chains: builtPairs, pipes: actualPipes, blacks: blackCoords, questions: qCoords, ice: iceCells, climax, pipeQueues };
}

function fullVerify(lvFile, workDir, tag) {
  const vGames = INPUT_W >= 39 ? '20' : '40';
  // 1) 旧随机三段
  const qRand = path.join(workDir, `qr_${tag}`);
  execFileSync('node', [
    path.join(ROOT, '实验关/产线v5/C9_插值玩家/PInterpPlayer.js'),
    lvFile, '--bottom-only', '--instant-chain', '--p', '0,0.1,0.2,0.8,0.9,1', '--games', vGames, '--seeds', String(SEED), '--out', qRand
  ], { stdio: 'ignore' });
  const sr = JSON.parse(fs.readFileSync(path.join(qRand, 'summary_all.json'), 'utf8'));
  const mr = {}; sr.forEach(x => { mr[x.p.toFixed(1)] = x; });
  const randCasual = +((mr['0.0'].winRate + mr['0.1'].winRate + mr['0.2'].winRate) / 3).toFixed(3);
  const randFair   = +((mr['0.8'].winRate + mr['0.9'].winRate + mr['1.0'].winRate) / 3).toFixed(3);

  // 2) 短视真人三段 + 三段暂存区波形
  const qHum = path.join(workDir, `qh_${tag}`);
  execFileSync('node', [
    path.join(ROOT, '实验关/产线v5/C9_插值玩家/PInterpPlayer.js'),
    lvFile, '--bottom-only', '--instant-chain', '--human-casual', '--p', '0,0.1,0.2,0.5,0.8,0.9,1', '--games', vGames, '--seeds', String(SEED), '--out', qHum
  ], { stdio: 'ignore' });
  const sh = JSON.parse(fs.readFileSync(path.join(qHum, 'summary_all.json'), 'utf8'));
  const mh = {}; sh.forEach(x => { mh[x.p.toFixed(1)] = x; });
  const humCasual = +((mh['0.0'].winRate + mh['0.1'].winRate + mh['0.2'].winRate) / 3).toFixed(3);
  const humMid = +mh['0.5'].winRate.toFixed(3);
  const humFair   = +((mh['0.8'].winRate + mh['0.9'].winRate + mh['1.0'].winRate) / 3).toFixed(3);
  const bufWave   = mh['0.1'].bufWaveMean;
  const midTight  = mh['0.1'].midTightRate;

  // 3) 棘轮
  const fRat = path.join(workDir, `rat_${tag}.json`);
  execFileSync('node', [
    path.join(TOOLS, 'ChainRatchetCheck_v1.js'),
    lvFile, '--bottom-only', '--instant-chain', '--out', fRat
  ], { stdio: 'ignore' });
  const rat = JSON.parse(fs.readFileSync(fRat, 'utf8')).rows[0] || {};
  const ratPass = !!rat.pass && (rat.flags || []).length === 0 && (rat.traps || []).length === 0;

  // 4) 早死
  const fBait = path.join(workDir, `bait_${tag}.json`);
  execFileSync('node', [
    path.join(TOOLS, 'BaitLocator_v1.js'),
    lvFile, '--early', '0.1', '--games', '40', '--bottom-only', '--instant-chain', '--out', fBait
  ], { stdio: 'ignore' });
  const bait = JSON.parse(fs.readFileSync(fBait, 'utf8'));
  const earlyShare = (bait.earlyDeaths >= 3) ? +(bait.earlyShare || 0).toFixed(3) : 0;

  // 5) 真三面墙可解性
  const solOut = execFileSync('node', [
    path.join(TOOLS, 'Solvable_v1.js'),
    lvFile, '--width', '8', '--bottom-only', '--instant-chain'
  ], { encoding: 'utf8' }).trim().split('\n').pop();
  const sol = JSON.parse(solOut);

  // 6) 排版
  const layOut = execFileSync('node', [
    path.join(TOOLS, 'LayoutScore_v1.js'), lvFile
  ], { encoding: 'utf8' }).trim().split('\n').pop();
  const hard0 = /hard=0\b/.test(layOut);

  // 7) 第二排畅通单车口计数（无链无冰）
  const d = JSON.parse(fs.readFileSync(lvFile, 'utf8'));
  const row1Open = d.spools[1].filter(c => c && c.id > 0 && c.type === 0).length;
  const caps = new Set();
  d.spools.forEach(r => r.forEach(c => { if (c && c.id > 0) caps.add(c.count); }));

  const allPass = sol.solvable && hard0 && ratPass && earlyShare < 0.20 && row1Open >= 3 &&
    humFair >= FAIR_MIN && randFair >= FAIR_MIN && randCasual >= RAND_LO && randCasual <= RAND_HI && humCasual >= HUM_MIN && humCasual <= HUM_MAX && humMid >= HUM_MID_MIN && humMid <= HUM_MID_MAX;

  return {
    allPass, randCasual, randFair, humCasual, humMid, humFair, bufWave, midTight,
    earlyShare, ratPass, solvable: sol.solvable, steps: sol.steps, hard0, row1Open, distinctCaps: caps.size
  };
}

// 【2026-11-25 选图硬红线守卫】强制校验输入目标图必须是 W === H 标准正方形且 0 空位（zeros === 0，除非显式传 --allow-empty-px）
let INPUT_MAT = null;
{
  const rawLines = fs.readFileSync(TARGET, 'utf8').trim().split(/\r?\n/);
  const body = rawLines[0].startsWith('像素') ? rawLines.slice(1) : rawLines;
  const mat = body.filter(l => l.trim()).map(l => l.trim().split(/\s+/).map(Number));
  const H = mat.length, W = mat[0] ? mat[0].length : 0;
  let zeros = 0;
  for (const r of mat) for (const v of r) if (!v || v <= 0) zeros++;
  if (H !== W) {
    console.error(`❌ [选图红线拒绝] 目标图 ${TARGET} 不是标准正方形 (${W}x${H})！v7 严禁使用长方形图。`);
    process.exit(2);
  }
  if (zeros > 0 && !has('--allow-empty-px')) {
    console.error(`❌ [选图红线拒绝] 目标图 ${TARGET} 含有 ${zeros} 个空像素(0)（顶部或边缘缺块，非满格正方形）！请换 100% 满格正方形图。`);
    process.exit(2);
  }
  INPUT_MAT = mat;
}

const work = fs.mkdtempSync('/tmp/v7pipeline_');

// ===== 【派工#009】诊图定方器：4 个物理指纹 → 初始配方 =====
function diagnoseImageAndRecipe(mat) {
  const H = mat.length, W = mat[0].length;
  const totalPx = H * W;
  const isLargeMap = W >= 39;
  const giantCompThr = Math.max(65, Math.round(totalPx * 0.065));
  const autoBandMaxComp = Math.max(110, Math.round(totalPx * 0.11));
  const cnt = {};
  for (const row of mat) for (const v of row) if (v > 0) cnt[v] = (cnt[v] || 0) + 1;
  const seen = mat.map(r => r.map(() => false));
  let maxComp = 0, giantSpanCount = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (seen[y][x]) continue;
    const col = mat[y][x], st = [[y, x]];
    seen[y][x] = true;
    const cells = [];
    while (st.length) {
      const [a, b] = st.pop(); cells.push([a, b]);
      for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const na = a + da, nb = b + db;
        if (na >= 0 && nb >= 0 && na < H && nb < W && !seen[na][nb] && mat[na][nb] === col) { seen[na][nb] = true; st.push([na, nb]); }
      }
    }
    if (cells.length > maxComp) maxComp = cells.length;
    const ys = cells.map(p => p[0]);
    if (cells.length >= giantCompThr && Math.max(...ys) - Math.min(...ys) >= 6) giantSpanCount++;
  }
  let changes = 0;
  for (let x = 0; x < W; x++) for (let y = 0; y < H - 1; y++) if (mat[y][x] !== mat[y + 1][x]) changes++;
  const avgColChanges = +(changes / W).toFixed(2);
  const colorCount = Object.keys(cnt).length;
  const easyImage = colorCount <= 10 || avgColChanges < 8.5;
  const recipe = {
    pipeMode: LOCK_PIPE_MODE ? PIPE_MODE : (isLargeMap ? 2 : (BC_TIER && easyImage ? 1 : 'auto')),
    pipeMouth: LOCK_PIPE_MOUTH ? PIPE_MOUTH : (BC_TIER && easyImage ? 'dumbbell' : 'auto'),
    blackMode: LOCK_BLACK ? BLACK_MODE : 0,
    qCount: LOCK_Q ? Q_COUNT : (BC_TIER && easyImage ? 3 : 0),
    maxSink: BC_TIER ? 3 : 2,
    iceScale: 1.0,
    withChain3: WITH_CHAIN3,
    iters: ITERS
  };
  return { colorCount, maxComp, giantSpanCount, avgColChanges, easyImage, totalPx, isLargeMap, giantCompThr, autoBandMaxComp, recipe };
}
const imageDiag = diagnoseImageAndRecipe(INPUT_MAT);

// 智能动作 A：千层饼旧图自动微创（只在 maxComp>=95 且 avgColChanges<7 的单调大块图上触发）
let effectiveTarget = TARGET;
// 注：11.txt 的 avgColChanges 实测 10.44（33 号黑条纹拉高换色次数），单用 <7.0 会让“千层饼旗舰样例”永不触发；
// 这里补一个“超巨块 maxComp>=110”分支，既让 11.txt 触发，又保证 #008 的 comp_02（maxComp=95, avg=13）不被误改。
const autoBandMaxComp = Math.max(110, Math.round(INPUT_MAT.length * INPUT_MAT[0].length * 0.11));
const monotonePie = imageDiag.maxComp >= autoBandMaxComp && imageDiag.giantSpanCount >= 1;
if (AUTO_BAND && monotonePie) {
  const bandOut = path.join(work, 'auto_band.txt');
  execFileSync('node', [path.join(TOOLS, 'PrepImage_v1.js'), '--target', TARGET, '--out', bandOut, '--wall-band', '--giant-comp', '65'], { stdio: 'ignore' });
  effectiveTarget = bandOut;
  console.log(`[AutoBand] 千层饼图触发微创: maxComp=${imageDiag.maxComp} avgColChanges=${imageDiag.avgColChanges} giantSpan=${imageDiag.giantSpanCount} -> ${bandOut}`);
}

const baseLv = path.join(work, 'base.json');
execFileSync('node', [
  path.join(TOOLS, 'SplitLevel_v722.js'),
  '--target', effectiveTarget, '--out', baseLv,
  '--rows', String(ROWS), '--cols', String(COLS), '--bottom-only', '--stagger-cap', '--no-first-test'
], { stdio: 'ignore' });

const baseGear = imageDiag.recipe;
const TARGET_MID = (RAND_LO + RAND_HI) / 2;
const HMID_TARGET = (HUM_MID_MIN > 0 || HUM_MID_MAX < 1) ? (HUM_MID_MIN + HUM_MID_MAX) / 2 : 0.60;
// 【派工#007】分层词典序：allPass → 结构/棘轮 → 公平 → 距带中心
function rankRec(r) {
  const v = r.verify;
  const structOk = (v.solvable && v.hard0 && v.ratPass && v.earlyShare < 0.20 && v.row1Open >= 3) ? 1 : 0;
  const fairOk = (v.humFair >= FAIR_MIN && v.randFair >= FAIR_MIN) ? 1 : 0;
  const dist = Math.abs(v.randCasual - TARGET_MID) + 0.8 * Math.abs((v.humMid ?? HMID_TARGET) - HMID_TARGET);
  return { all: v.allPass ? 1 : 0, structOk, fairOk, dist };
}
function betterRec(a, b) {
  if (!b) return true;
  const ra = rankRec(a), rb = rankRec(b);
  if (ra.all !== rb.all) return ra.all > rb.all;
  if (ra.structOk !== rb.structOk) return ra.structOk > rb.structOk;
  if (ra.fairOk !== rb.fairOk) return ra.fairOk > rb.fairOk;
  return ra.dist < rb.dist;
}
// 【派工#009】升降挡配方（已按实机体感封顶 blackMode<=2 严禁品字3黑块夹管道，降挡支持拆链 chainPairs=3）
function gearOptsFor(shift, base) {
  const g = { ...base };
  if (shift >= 1) {
    g.pipeMode = Math.max(1, Number(g.pipeMode) || 0);
    g.pipeMouth = 'dumbbell';
    g.maxSink = 3;
    g.qCount = Math.max(2, Number(g.qCount) || 0);
    g.blackMode = Math.min(2, Math.max(1, Number(g.blackMode) || 0));
    g.chainPairs = 5;
    g.iters = ITERS + 15;
  }
  if (shift >= 2) {
    g.blackMode = 2; // 永久封顶 2 黑块（严禁 3 黑块夹死 (4,3) 管道）
    g.maxSink = 3;
    g.qCount = 3;
    g.withChain3 = false;
    g.iceScale = 1.06;
  }
  if (shift <= -1) {
    g.blackMode = Math.max(0, Number(g.blackMode) - 1);
    g.pipeMouth = 'big';
    g.maxSink = 1;
    g.chainPairs = 3; // 过紧时自动拆减锁链至 3 对
    g.iceScale = 0.80;
  }
  if (shift <= -2) {
    // 【派工#010】大图过紧急救：0 黑块 + 双管拆巨车 + 管口小车上活路 + 只留 2 对链 + 冰降到 65%
    g.blackMode = 0;
    g.pipeMode = Math.max(2, Number(base.pipeMode) || 2);
    g.pipeMouth = 'small';
    g.chainPairs = 2;
    g.iceScale = 0.65;
  }
  return g;
}

let best = null;
let snapSeq = 0;
const allTried = [];
const gearHistory = [];
function runRound(gearOpts, gearTag, styles) {
  let passed = false;
  for (const st of styles) {
    try {
      const built = buildWithStyle(baseLv, st, work, gearOpts);
      const ver = fullVerify(built.file, work, `${gearTag}_s${st}`);
      const rec = { ...built, verify: ver, gear: gearTag };
      allTried.push(rec);
      console.log(`[try ${gearTag} style=${st}] allPass=${ver.allPass} | 短视真人=${ver.humCasual}/mid${ver.humMid}/${ver.humFair} 波形=${JSON.stringify(ver.bufWave)} | 旧随机=${ver.randCasual}/${ver.randFair} | 早死=${(ver.earlyShare * 100).toFixed(1)}% | 棘轮=${ver.ratPass} | 二排畅口=${ver.row1Open} | queues=${JSON.stringify(built.pipeQueues)} | climax=${JSON.stringify(built.climax)}`);
      if (betterRec(rec, best)) {
        const snap = path.join(work, `best_${snapSeq++}.json`);
        fs.copyFileSync(rec.file, snap);
        best = { ...rec, file: snap };
      }
      if (ver.allPass) { passed = true; break; }
    } catch (e) {
      console.error(`[try ${gearTag} style=${st}] error:`, e.message);
    }
  }
  return passed;
}

gearHistory.push({ round: 0, gear: 0, tag: 'gear0', recipe: baseGear, reason: 'base-recipe' });
const styles0 = Array.from({ length: MAX_TRIES }, (_, t) => (INIT_STYLE + t) % CHAIN_STYLES.length);
let done = runRound(baseGear, 'gear0', styles0);

if (!done && AUTO_GEAR && best) {
  const sorted = allTried.slice().sort((a, b) => (betterRec(a, b) ? -1 : 1));
  const topStyles = [];
  for (const r of sorted) { if (!topStyles.includes(r.style)) topStyles.push(r.style); if (topStyles.length >= 2) break; }
  const v = best.verify;
  const tight = !v.ratPass || v.humFair < FAIR_MIN || v.humCasual < HUM_MIN || v.humMid < HUM_MID_MIN || v.randCasual < RAND_LO;
  const loose = !tight && v.ratPass && (v.humMid > HUM_MID_MAX || v.humCasual > HUM_MAX || v.randCasual > RAND_HI);
  const shift = tight ? -1 : (loose ? 1 : 0);
  const reason = tight
    ? `过紧/卡死 rat=${v.ratPass} humFair=${v.humFair} hum=${v.humCasual} mid=${v.humMid} rand=${v.randCasual}`
    : (loose ? `偏松 rand=${v.randCasual}(>${RAND_HI}) hum=${v.humCasual}(>${HUM_MAX}) mid=${v.humMid}(>${HUM_MID_MAX})` : '既不算偏松也不算过紧（被 randFair/fair 等卡住）');
  console.log(`[AutoGear] 触发判定: ${reason} => shift=${shift > 0 ? '+' + shift : shift} topStyles=${topStyles.join(',')}`);
  let gear = shift;
  for (let round = 1; round <= 2 && !done && shift !== 0; round++) {
    const opts = gearOptsFor(gear, baseGear);
    const tag = gear > 0 ? `gearP${gear}` : `gearM${Math.abs(gear)}`;
    gearHistory.push({ round, gear, tag, reason, recipe: opts, styles: topStyles.slice() });
    console.log(`[AutoGear shift -> ${gear > 0 ? '+' + gear : gear}] reason=${reason} recipe=${JSON.stringify(opts)} styles=${topStyles.join(',')}`);
    done = runRound(opts, tag, topStyles);
    if (done) break;
    const v2 = best.verify;
    const stillLoose = v2.ratPass && (v2.randCasual > RAND_HI || v2.humCasual > HUM_MAX || v2.humMid > HUM_MID_MAX);
    if (gear > 0 && stillLoose) { gear = 2; continue; }
    if (gear < 0) {
      const stillTight = !v2.ratPass || v2.humFair < FAIR_MIN || v2.humMid < HUM_MID_MIN;
      if (stillTight) { gear = -2; continue; }
    }
    break;
  }
}

if (!best) { console.error('所有 style 尝试均失败'); process.exit(1); }
fs.copyFileSync(best.file, OUT);
const reportObj = { ...best, imageDiag, tier: TIER, effectiveTarget, autoBand: effectiveTarget !== TARGET, gearHistory };
if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(reportObj, null, 2));
console.log(JSON.stringify({
  ok: true, out: OUT, chosenStyle: best.style, chosenGear: best.gear,
  imageDiag, autoBand: effectiveTarget !== TARGET, gearHistory, verify: best.verify
}));
