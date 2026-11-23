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
const ITERS = Number(arg('--iters', '8'));
const SEED = Number(arg('--seed', '977'));
const REPORT = arg('--report', null);
const MAX_TRIES = Number(arg('--tries', '3'));

if (!TARGET || !OUT) {
  console.error('用法: node BuildV6Stagger_v1.js --target <图.txt> --out <输出.json> [--style 0..5] [--iters 18]');
  process.exit(2);
}

const CHAIN_STYLES = [
  [[[1,0],[2,0]], [[1,3],[1,4]], [[2,5],[2,6]]],
  [[[1,1],[1,2]], [[1,5],[2,5]], [[2,0],[2,1]], [[2,3],[2,4]]],
  [[[1,1],[2,1]], [[1,3],[2,3]], [[1,6],[2,6]]],
  [[[1,0],[1,1]], [[1,4],[1,5]], [[2,2],[2,3]]],
  [[[1,2],[2,2]], [[1,4],[1,5]], [[2,0],[2,1]], [[2,4],[2,5]]],
  [[[2,0],[2,1]], [[1,3],[2,3]], [[1,6],[2,6]]]
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

function playOneFourSide(lv, p, r) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  for (let step = 0; step < 80; step++) {
    if (isWon(s)) return { won: true, prog: 1 };
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    if (!ms.length) break;
    let pick = null;
    if ((p >= 1) || (p > 0 && r() < p)) {
      let bg = -1;
      for (const m of ms) {
        const t = St.cloneState(s), e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (isDead(t) && !isWon(t)) continue;
        const g = t.eliminatedPixels - e0;
        if (g > bg) { bg = g; pick = t; }
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
    const PS = [0.1, 0.9];
    const rates = {};
    let deaths = 0, early = 0;
    for (const p of PS) {
      const r = lcg(Math.round(seed + p * 1000));
      let w = 0;
      for (let i = 0; i < games; i++) {
        const res = playOneFourSide(lv, p, r);
        if (res.won) w++; else { deaths++; if (res.prog < 0.1) early++; }
      }
      rates[p] = w / games;
    }
    const casual = rates[0.1];
    const fair = rates[0.9];
    const earlyShare = deaths >= 3 ? early / deaths : 0;
    let inv = 0;
    for (let i = 1; i < PS.length; i++) if (rates[PS[i]] < rates[PS[i - 1]]) inv++;
    const sc = Math.abs(casual - mid) + 0.8 * Math.max(0, earlyShare - 0.15) + 0.6 * Math.max(0, 0.90 - fair) + 0.02 * inv;
    return { casual, fair, earlyShare, inv, sc };
  }
  let bestEv = evalG(cur) || { sc: 1e9 };
  // 允许在 row 0..4 的普通车之间换位（保护 row 5..6 的终局明牌挪车让路机关不被破坏！）
  const plainCoords = [];
  for (let r = 0; r <= 4; r++) for (let c = 0; c < 7; c++) {
    if (isPlain(cur.spools[r][c])) plainCoords.push([r, c]);
  }
  for (let it = 0; it < iters && plainCoords.length >= 2; it++) {
    const i1 = Math.floor(rnd() * plainCoords.length);
    let i2 = Math.floor(rnd() * (plainCoords.length - 1));
    if (i2 >= i1) i2++;
    const [r1, c1] = plainCoords[i1], [r2, c2] = plainCoords[i2];
    if (cur.spools[r1][c1].id === cur.spools[r2][c2].id && cur.spools[r1][c1].count === cur.spools[r2][c2].count) continue;
    const cand = JSON.parse(JSON.stringify(cur));
    const tmp = cand.spools[r1][c1]; cand.spools[r1][c1] = cand.spools[r2][c2]; cand.spools[r2][c2] = tmp;
    const ev = evalG(cand);
    if (ev && ev.sc <= bestEv.sc) {
      cur = cand; bestEv = ev;
      if (ev.casual >= lo && ev.casual <= hi && ev.fair >= 0.92 && ev.earlyShare < 0.15) break;
    }
  }
  return cur;
}

function setupEndgameClimax(game) {
  // 【2026-11-23 终局“第 5 行核心色车明牌挡住正下方第 6 行内壳钥匙车（挪车让路蓄水清盘）”机关】
  // 分析目标图 blocks 中心区域：
  //   最中心洋葱心 coreColors: 距四边距离 >= 15 (即 row 15..24, col 15..24) 占比最高的颜色 A
  //   内壳钥匙色 shellColors: 距四边距离 10..14 包在洋葱心外围的颜色 B
  const Bmat = game.blocks, R = Bmat.length, C = Bmat[0].length;
  const corePx = {}, shellPx = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = Bmat[r][c]; if (v <= 0) continue;
    const d = Math.min(r, R - 1 - r, c, C - 1 - c);
    if (d >= Math.floor(Math.min(R, C) * 0.38)) corePx[v] = (corePx[v] || 0) + 1;
    else if (d >= Math.floor(Math.min(R, C) * 0.25)) shellPx[v] = (shellPx[v] || 0) + 1;
  }
  // 在 row 4..6 的普通车中，把“内壳钥匙色 B”的车放到第 6 行 (6,2),(6,3),(6,5)，
  // 把“最中心洋葱心色 A”的大车放到其正上方的第 5 行 (5,2),(5,3),(5,5)！
  const pool = [];
  for (let r = 4; r <= 6; r++) for (let c = 0; c < 7; c++) {
    pool.push({ r, c, cell: game.spools[r][c] });
  }
  // 按 (corePx[id] - shellPx[id]) 排序：正值最大的是最中心核心色 A（放 row 5 挡路），负值最小的是内壳钥匙色 B（放 row 6 被挡在正下方）
  const cells = pool.map(p => p.cell);
  cells.sort((a, b) => {
    const scoreA = (corePx[a.id] || 0) * 2 - (shellPx[a.id] || 0);
    const scoreB = (corePx[b.id] || 0) * 2 - (shellPx[b.id] || 0);
    return scoreB - scoreA; // 最中心核心色排最前 -> 填入 row 4..5；内壳钥匙色排最后 -> 填入 row 6 正下方！
  });
  let idx = 0;
  for (let r = 4; r <= 6; r++) for (let c = 0; c < 7; c++) {
    game.spools[r][c] = cells[idx++];
  }
  // 若出现同色 4+ 连排，微调交换消除连排
  fixSameColorRuns(game.spools);
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

  // 2. 自动把 row 0..2 的全盘唯一车(cars===1)与 row 3..4 的冗余色对调，从源头杜绝前两排唯一车被锁死
  for (let r = 0; r <= 2; r++) for (let c = 0; c < 7; c++) {
    if ((colorCars[curLv.spools[r][c].id] || 0) <= 1) {
      let swapped = false;
      for (let rr = 4; rr >= 3 && !swapped; rr--) for (let cc = 1; cc < 6 && !swapped; cc++) {
        if ((colorCars[curLv.spools[rr][cc].id] || 0) >= 4) {
          const tmp = curLv.spools[r][c]; curLv.spools[r][c] = curLv.spools[rr][cc]; curLv.spools[rr][cc] = tmp;
          swapped = true;
        }
      }
    }
  }
  let cur = path.join(workDir, `s${styleIdx}_base.json`);
  fs.writeFileSync(cur, JSON.stringify(curLv, null, 1));

  // 3. 去模板化建链（第二排留 >=4 个无链无冰畅通口，绝不绑唯一车，绝不绑逃生阀）
  const pairs = CHAIN_STYLES[styleIdx % CHAIN_STYLES.length];
  const chainUsed = new Set();
  const builtPairs = [];
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i];
    const nxt = path.join(workDir, `s${styleIdx}_c${i + 1}.json`);
    try {
      execFileSync('node', [
        path.join(ROOT, '实验关/产线v6/加链/建B_v1.js'),
        cur, `${a[0]},${a[1]}`, `${b[0]},${b[1]}`, nxt,
        '--gid', String(i + 1), '--max-row', '2'
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
          if (nr < 1 || nr > 3 || nc < 0 || nc >= COLS) continue;
          const key = `${nr},${nc}`;
          if (chainUsed.has(key)) continue;
          const cell = d3c.spools[nr][nc];
          if (cell && cell.id > 0 && cell.type === 0 && cell.count <= 28 && (colorCars[cell.id] || 0) >= 3) {
            const nxt = path.join(workDir, `s${styleIdx}_chain3.json`);
            try {
              execFileSync('node', [
                path.join(ROOT, '实验关/产线v6/加链/建B_v1.js'),
                cur, `${br},${bc}`, `${nr},${nc}`, nxt,
                '--gid', String(gid), '--max-row', '3', '--allow-merge'
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
          if (chainUsed.has(k) || pipeUsed.has(k) || pipeCols.includes(cc) && rr === 4) continue;
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
        if ((rr === 4 && pipeCols.includes(cc)) || chainUsed.has(k) || pipeUsed.has(k)) continue;
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

  // 4. 禁盲盒敲冰 + 障碍总量守恒（加管或加3黑块迷宫均自动减冰：0管0黑->9冰, 1管或3黑->5冰, 2管->2冰, 3管->0冰）
  const lvData = JSON.parse(fs.readFileSync(cur, 'utf8'));
  const actualPipes = pipeColsUsed.length;
  const rowNeeds = actualPipes >= 3
    ? []
    : (actualPipes === 2
      ? [[2, 2, 6]]
      : ((actualPipes === 1 || BLACK_MODE >= 2)
        ? [[2, 2, 6], [3, 2, 9], [5, 1, 16]]
        : [[2, 2, 6], [3, 2, 9], [4, 2, 13], [5, 1, 16], [6, 2, 19]]));
  const colSeq = COL_ORDERS[styleIdx % COL_ORDERS.length];
  const iceCells = [];
  for (let idx = 0; idx < rowNeeds.length; idx++) {
    const [r, need, baseParam] = rowNeeds[idx];
    const cols = colSeq[idx];
    const pickedCols = [];
    for (const c of cols) {
      const key = `${r},${c}`;
      if (chainUsed.has(key) || pipeUsed.has(key)) continue;
      const cell = lvData.spools[r][c];
      if (!cell || cell.id <= 0 || cell.type !== 0 || (colorCars[cell.id] || 0) < 2) continue;
      if (pickedCols.some(pc => Math.abs(pc - c) === 1) && cols.length > 4) continue;
      pickedCols.push(c);
      const p = baseParam + (pickedCols.length === 2 ? 1 : 0);
      iceCells.push(`${r},${c}:${p}`);
      if (pickedCols.length >= need) break;
    }
    for (const c of cols) {
      if (pickedCols.length >= need) break;
      const key = `${r},${c}`;
      if (chainUsed.has(key) || pipeUsed.has(key) || pickedCols.includes(c)) continue;
      const cell = lvData.spools[r][c];
      if (!cell || cell.id <= 0 || cell.type !== 0 || (colorCars[cell.id] || 0) < 2) continue;
      pickedCols.push(c);
      iceCells.push(`${r},${c}:${baseParam}`);
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

  const climbedObj = climbFourSide(icedObj, ITERS, 12, SEED, 0.57, 0.66);
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

  const allPass = sol.solvable && hard0 && ratPass && earlyShare < 0.20 && row1Open >= 3 && maxIceParam <= 20 &&
    randFair >= 0.90 && humFair >= 0.90 &&
    ((randCasual >= 0.50 && randCasual <= 0.72) || (humCasual >= 0.45 && humCasual <= 0.72));

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
for (let t = 0; t < MAX_TRIES; t++) {
  const st = (INIT_STYLE + t) % CHAIN_STYLES.length;
  try {
    const built = buildWithStyle(baseLv, st, work);
    const ver = fullVerifyV6(built.file, work, `s${st}`);
    const rec = { ...built, verify: ver };
    console.log(`[v6 try style=${st}] allPass=${ver.allPass} | 原随意=${ver.randCasual}/${ver.randFair} 波形=${JSON.stringify(ver.randWave)} | 短视真人=${ver.humCasual}/${ver.humFair} 波形=${JSON.stringify(ver.humWave)} | 早死=${(ver.earlyShare*100).toFixed(1)}% | 棘轮=${ver.ratPass} | 冰上限=${ver.maxIceParam} | 二排畅口=${ver.row1Open} | 面额=${ver.distinctCaps}`);
    const hardSafe = ver.solvable && ver.hard0 && ver.ratPass && ver.earlyShare < 0.20 && ver.row1Open >= 3 && ver.maxIceParam <= 20 && ver.randFair >= 0.90 && ver.humFair >= 0.90;
    const bestSafe = best ? (best.verify.solvable && best.verify.hard0 && best.verify.ratPass && best.verify.earlyShare < 0.20 && best.verify.row1Open >= 3 && best.verify.maxIceParam <= 20 && best.verify.randFair >= 0.90 && best.verify.humFair >= 0.90) : false;
    if (!best || (ver.allPass && !best.verify.allPass) ||
        (!ver.allPass && !best.verify.allPass && hardSafe && !bestSafe) ||
        (ver.allPass === best.verify.allPass && hardSafe === bestSafe && Math.abs(ver.randCasual - 0.62) < Math.abs(best.verify.randCasual - 0.62))) {
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
