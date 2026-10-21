/**
 * 蚂蚁拿块关卡图修改工具 · 核心口径层（core.js）
 * 任务：ANT-ARTTOOL-CLASSIFY-20260729 · 阶段3
 *
 * 本文件只做「工具侧的口径封装」，不复制任何求解器/生成器算法：
 *   求解一律调用正式 AntSolver.Solver.solve / Solver.runSolver（来源：本工具目录的 bin/js/，
 *   那是正式代码的副本，正式来源仍是项目根目录的 bin/，见 bin/来源说明.md）
 *   模拟一律调用正式 AntSolver.Simulator.createState / isPickable / applyPick
 *   TXT 解析一律调用正式 AntSolver.Generator.blocksFromTXT
 *
 * 固定口径（不可随意改动）：
 *   1. 进度 = 已完成盒数 ÷ 总盒数（与审核评分体系一致），盒进度离散，用户区间须吸附到最近可达进度。
 *   2. 冰块耐久 = 3（用户 2026-07-29 确认）。官方关卡本体不保存冰耐久，
 *      AntSolver.fromGameFormat 默认还原为 2，会比生产口径早解冻一步，故导入后显式改写为 3。
 *   3. 区间区域 = 状态B - 状态A 的差集（不保存每步完整目标图副本）。
 *   4. 求解数据定性为「基于正式关卡 JSON 重新求解的标准复核路线」，不声称还原生产原始路线。
 *
 * 本文件同时被主页面与 Web Worker 载入，因此不得在顶层触碰 DOM。
 */
(function (global) {
  'use strict';

  var ICE_DURABILITY = 3;   // 用户确认口径
  var BUFFER_LIMIT = 5;
  var DEFAULT_BUDGET_MS = 180000;

  /* 多路线复核的候选遍次表。
   * 前 6 项与 Solver.solve 的正式六遍编排完全一致（0/g2/tree/tree2/n1/n2），
   * 后 3 项是仅供「多路线」使用的额外扰动遍，用于在正式六遍互相重复时补足第 2、3 条路线。
   * 多路线只用于观察区域稳定性，不改变标准路线，也不参与分类判定。 */
  var ROUTE_PASSES = [
    { tag: '0', mode: 'greedy', noise: 0, seed: 1 },
    { tag: 'g2', mode: 'greedy', noise: 0.6, seed: 53 },
    { tag: 'tree', mode: 'tree', noise: 0, seed: 1 },
    { tag: 'tree2', mode: 'tree', noise: 0.8, seed: 29 },
    { tag: 'n1', mode: 'greedy', noise: 1.0, seed: 211 },
    { tag: 'n2', mode: 'greedy', noise: 1.5, seed: 401 },
    { tag: 'x1', mode: 'greedy', noise: 0.9, seed: 97 },
    { tag: 'x2', mode: 'tree', noise: 0.5, seed: 131 },
    { tag: 'x3', mode: 'greedy', noise: 1.2, seed: 307 }
  ];

  function AS() {
    var A = global.AntSolver;
    if (!A || !A.Solver || !A.Simulator || !A.fromGameFormat || !A.parseLevel) {
      throw new Error('没有载入求解器。请用「一键启动.command」打开本工具；若提示缺少 bin 目录，请按提示重新拷一份。');
    }
    return A;
  }

  /** 重构专用：额外要求 Generator 已载入（本工具目录 bin/js/generator.js）。 */
  function ASGen() {
    var A = AS();
    if (!A.Generator) throw new Error('没有载入生成器，重构功能不可用。请用「一键启动.command」打开本工具。');
    return A.Generator;
  }

  // ==================== TXT / 关卡文件 ====================

  /** TXT 目标图 → 像素矩阵。优先用正式 Generator.blocksFromTXT，缺失时用同口径兜底解析。 */
  function parseTxt(text) {
    var A = global.AntSolver;
    var blocks = null;
    if (A && A.Generator && typeof A.Generator.blocksFromTXT === 'function') {
      blocks = A.Generator.blocksFromTXT(text);
    } else {
      blocks = [];
      var lines = String(text).split(/\r?\n/);
      var start = 0;
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].trim();
        if (t === '' || !/^\d/.test(t)) start = i + 1; else break;
      }
      for (var j = start; j < lines.length; j++) {
        var line = lines[j].trim();
        if (line === '') continue;
        blocks.push(line.split(/[\s,]+/).filter(function (s) { return s !== ''; })
          .map(function (s) { var n = parseInt(s, 10); return isNaN(n) ? 0 : n; }));
      }
    }
    if (!blocks.length) throw new Error('TXT 未解析出像素矩阵');
    var w = blocks[0].length;
    for (var k = 1; k < blocks.length; k++) {
      if (blocks[k].length !== w) throw new Error('TXT 第 ' + (k + 1) + ' 行宽度 ' + blocks[k].length + ' 与首行 ' + w + ' 不一致');
    }
    return blocks;
  }

  /** 像素矩阵 → 标准 TXT（与参考编辑器 serializeTXT 完全同口径：首行「像素矩阵」+ 空格分隔 + 末尾换行）。 */
  function serializeTxt(blocks) {
    var lines = ['像素矩阵'];
    for (var i = 0; i < (blocks || []).length; i++) lines.push((blocks[i] || []).join(' '));
    return lines.join('\n') + '\n';
  }

  /** 识别导入文件类型：txt目标图 / 正式关卡本体 / 求解数据 / 本地调试关卡数据 */
  function detectKind(name, text) {
    var lower = String(name || '').toLowerCase();
    if (/\.txt$/.test(lower)) return 'txt';
    var json = null;
    try { json = JSON.parse(text); } catch (e) { return 'unknown'; }
    if (json && json.meta && json.summary && (json.replay || json.pickOrder)) return 'solve';
    if (json && json.spools && json.blocks) return 'level';
    if (json && json.board && json.blocks) return 'leveldata';
    return 'unknown';
  }

  /** 关卡文件 → 内部 level，并把冰耐久统一改写为 3。 */
  function toInternal(levelFile) {
    var A = AS();
    var lv;
    if (levelFile && levelFile.spools) lv = A.fromGameFormat(levelFile);
    else lv = JSON.parse(JSON.stringify(levelFile));   // 已是内部结构（关卡数据.json）
    lv.bufferLimit = BUFFER_LIMIT;
    var iceBoxes = 0;
    var board = lv.board || { rows: 0, cols: 0, cells: [] };
    for (var r = 0; r < board.rows; r++) {
      for (var c = 0; c < board.cols; c++) {
        var cell = board.cells[r] && board.cells[r][c];
        if (cell && cell.t === 'box' && cell.ice > 0) { cell.ice = ICE_DURABILITY; iceBoxes++; }
      }
    }
    return { level: lv, iceBoxes: iceBoxes };
  }

  // ==================== 求解与回放 ====================

  /** 标准复核求解：正式完整全知入口 Solver.solve（六遍编排，任一遍通关即止）。 */
  function solveStandard(levelFile, budgetMs) {
    var A = AS();
    var lv = toInternal(levelFile).level;
    var parsed = A.parseLevel(lv);
    var res = A.Solver.solve(parsed, {
      capturePreviewStats: true,
      timeBudgetMs: budgetMs != null ? budgetMs : DEFAULT_BUDGET_MS
    });
    return { result: res, parsed: parsed, completed: !!(res && res.completed), pass: res ? res.retryRound : null };
  }

  /** 单遍求解（多路线复核用）：直接调用正式 Solver.runSolver，指定 mode/noise/seed。 */
  function solveOnePass(levelFile, pass) {
    var A = AS();
    var lv = toInternal(levelFile).level;
    var parsed = A.parseLevel(lv);
    var res = A.Solver.runSolver(parsed, pass.noise, pass.seed, false, false,
      { mode: pass.mode, capturePreviewStats: false });
    return { result: res, parsed: parsed, completed: !!(res && res.completed) };
  }

  /**
   * 对一个 Simulator state 做「棋盘 + 暂存」的通用快照（供棋盘区展示 / 暂存前后对比 / 自动演示用）。
   * 用 JSON 深拷贝而非手写逐字段克隆：state.cells / state.buffer / state.frozen 都是纯数据（无函数、无循环引用），
   * 通用序列化即可安全快照，且不依赖 bin/js 内部克隆函数的具体实现（那些是私有函数，未导出）。
   */
  function snapshotBoardBuffer(st) {
    return {
      boardRows: st.boardRows, boardCols: st.boardCols,
      cells: JSON.parse(JSON.stringify(st.cells)),
      frozen: JSON.parse(JSON.stringify(st.frozen || {})),
      buffer: JSON.parse(JSON.stringify(st.buffer || [])),
      bufferLimit: st.bufferLimit,
      completedBoxes: st.completedBoxes || 0,
      totalBoxes: st.totalBoxes || 0
    };
  }

  /** 把暂存数组（稀疏、按 slot 字段标记）铺成按槛位对齐的定长数组，空槛为 null。供暂存区渲染直接按下标取用。 */
  function bufferSlotsArray(buffer, bufferLimit) {
    var arr = [];
    for (var i = 0; i < bufferLimit; i++) arr.push(null);
    for (var j = 0; j < (buffer || []).length; j++) {
      var b = buffer[j];
      if (b.slot != null && b.slot >= 0 && b.slot < bufferLimit) arr[b.slot] = b;
    }
    return arr;
  }

  /**
   * 按真实 pickOrder 回放，逐步采集「本步新增消除的像素」与「本步结束时的完成盒数/暂存数」。
   * 用自建 state + 逐步开关 capture 采集，不改 bin/js：
   *   capture / capOps 是 Simulator state 上的普通字段，applyPick 是公开函数。
   * 每个像素在全程只会出现一次，因此任意区间的消除区域 = 区间内各步 cells 之并 = 状态B − 状态A。
   *
   * opts.captureBoard=true 时额外在「开局」与「每步结束」拍一份棋盘+暂存快照（snapshotBoardBuffer），
   * 供棋盘区展示 / 暂存前后对比 / 自动演示动画使用。默认关闭（批量核验/多路线复核不需要，省内存）。
   */
  function replay(levelFile, pickOrder, opts) {
    var A = AS();
    var captureBoard = !!(opts && opts.captureBoard);
    var lv = toInternal(levelFile).level;
    var parsed = A.parseLevel(lv);
    var st = A.Simulator.createState(parsed, { useSlotStart: true });
    var cols = parsed.cols;
    var steps = [];
    var fail = null;
    var pickNo = 0;                    // 真实 pick 次数（v112：与 pickOrder 下标不再相等）
    var initialBoard = captureBoard ? snapshotBoardBuffer(st) : null;

    for (var i = 0; i < pickOrder.length; i++) {
      var p = pickOrder[i];
      // 主工程 v112 起 pickOrder 改为「一条记录 = 一个盒」：锁链 2/3 连的成员是【同一 step 的多条记录】。
      // 整组在触发盒那一次 applyPick 里就已全部离场，因此同 step 的后续条目必须跳过 ——
      // 否则会走到下面的 isPickable 检查而判「不可取」，整条回放直接中断（那是硬失败，break）。
      // 旧格式（v112 之前）每步只有 1 条记录，本判断恒不命中，行为逐值不变。
      if (i > 0 && pickOrder[i - 1].step != null && p.step === pickOrder[i - 1].step) continue;
      if (!A.Simulator.isPickable(st, p.r, p.c)) {
        fail = '第' + (i + 1) + '步 (' + p.r + ',' + p.c + ') 不可取，回放中断';
        break;
      }
      st.capture = true; st.capOps = [];
      A.Simulator.applyPick(st, p.r, p.c);
      st.capture = false;
      var cells = [];
      for (var k = 0; k < (st.capOps || []).length; k++) {
        var op = st.capOps[k];
        if (op.t === 'eat' && op.cells) {
          for (var m = 0; m < op.cells.length; m++) cells.push(op.cells[m][0] * cols + op.cells[m][1]);
        }
      }
      // 步号用【真实 pick 计数】而不是数组下标 i：v112 起同 step 的锁链成员会被上面 continue 跳过，
      // 用 i+1 会跳号（1,2,3,5…）。旧格式无跳过，pickNo 与 i+1 逐值相同。
      steps.push({
        step: ++pickNo, r: p.r, c: p.c, color: p.color, count: p.count,
        boxes: p.chainSize || 1,          // v112：这一次 pick 实际拿走几个盒（锁链 2/3 连）
        done: st.completedBoxes || 0,
        buf: st.buffer ? st.buffer.length : 0,
        cells: cells,
        board: captureBoard ? snapshotBoardBuffer(st) : null
      });
      if (st.gameOver) break;
    }
    return {
      ok: !fail, fail: fail, steps: steps,
      rows: parsed.rows, cols: parsed.cols,
      totalBoxes: st.totalBoxes, completedBoxes: st.completedBoxes || 0,
      totalPixels: st.totalPixels, eliminatedPixels: st.eliminatedPixels,
      // 完成判据用像素/盒数，不用 st.gameWon：
      // gameWon 只由交互式 pickBox() 内的 checkWinLose() 置位，applyPick 不判胜负，故此处 gameWon 恒 false。
      allEliminated: st.eliminatedPixels >= st.totalPixels,
      allBoxesDone: (st.completedBoxes || 0) >= st.totalBoxes,
      pixelCoding: '扁平下标 = 行 * ' + parsed.cols + ' + 列',
      initialBoard: initialBoard
    };
  }

  /**
   * 时间线上第 idx 步结束时的棋盘+暂存快照（idx=0 表示开局，未执行任何步）。
   * 只有 replay 时传了 opts.captureBoard 才有数据，否则返回 null。
   */
  function boardAtStep(tl, idx) {
    if (!tl) return null;
    if (idx <= 0) return tl.initialBoard || null;
    var s = tl.steps[idx - 1];
    return s ? (s.board || null) : null;
  }

  /** 时间线前 idx 步（0..idx-1）新增消除像素的并集（idx=0 为空集）。用于动画播放时目标图的累计揭示状态。 */
  function pixelsUpTo(steps, idx) {
    var set = {};
    var n = Math.min(idx, steps.length);
    for (var i = 0; i < n; i++) {
      var cells = steps[i].cells;
      for (var k = 0; k < cells.length; k++) set[cells[k]] = 1;
    }
    return Object.keys(set).map(Number);
  }

  // ==================== 进度吸附与区间差值 ====================

  /**
   * 把用户区间 [lo,hi]（0~1）吸附到路线中最接近的实际可达盒进度。
   * 进度口径 = steps[i].done / totalBoxes。
   * 状态A = 第 iLo 步结束时的已消除集合；状态B = 第 iHi 步结束时的已消除集合；区域 = B − A。
   *
   * 边界约定：
   *   - lo 吸附到 0% 时，状态A 取「第 0 步（开局，未消任何像素）」，此时区间含首步消除；
   *   - iLo === iHi 时区间为空（用户上下限吸附到了同一个可达进度），如实返回 0 像素并提示。
   *
   * 并列取舍规则（显式定义，不依赖浮点噪声）：
   *   盒进度离散，用户输入的目标常常正好落在两个可达进度的正中间
   *   （例：51 盒关卡要 50%，25/51=49.02% 与 26/51=50.98% 到 50% 的距离完全相等）。
   *   此时统一取「能把用户要求区间包住」的一侧：
   *     · 下限并列 → 取更低的进度；同一进度有多步时取最早那步；
   *     · 上限并列 → 取更高的进度；同一进度有多步时取最晚那步。
   *   （仅在「等距并列」时按此偏向；非并列时始终取唯一的最近可达进度，
   *     因此不保证吸附结果一定包住用户区间——最近的可达进度可能整体偏高或偏低，
   *     实际采用区间会如实显示出来。）
   *   注：阶段2 求解包写入各 *.solve.json 的示例字段 defaultInterval 没有这条规则，
   *   并列时由浮点误差偶然决定取哪一侧，因此在「恰好等距」的关上会与本工具差一个进度点
   *   （50%–90% 全量 347 关中 76 关属于此类，两者与目标的距离完全相同）。
   *   工具以本规则为准并实时重算，不依赖该示例字段。
   */
  function snapInterval(steps, totalBoxes, lo, hi) {
    if (!steps || !steps.length || !totalBoxes) return null;
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    var EPS = 1e-9;

    // 候选进度点：索引 -1 表示开局（done=0），0..n-1 表示第 i+1 步结束
    function doneAt(i) { return i < 0 ? 0 : steps[i].done; }
    function nearest(target, preferHigher) {
      var best = -1, bestD = Math.abs(0 - target), bestDone = 0;
      for (var i = 0; i < steps.length; i++) {
        var done = steps[i].done;
        var d = Math.abs(done / totalBoxes - target);
        if (d < bestD - EPS) { bestD = d; best = i; bestDone = done; }
        else if (Math.abs(d - bestD) <= EPS) {
          // 等距并列：上限取更高进度/更晚步；下限保持更低进度/更早步（首次命中即最早）
          if (preferHigher ? done >= bestDone : false) { bestD = d; best = i; bestDone = done; }
        }
      }
      return best;
    }
    var iLo = nearest(lo, false), iHi = nearest(hi, true);
    if (iHi < iLo) { var s = iLo; iLo = iHi; iHi = s; }

    var aSet = {}, aCount = 0, diff = [];
    for (var i2 = 0; i2 <= iLo; i2++) {
      if (i2 < 0) continue;
      for (var k = 0; k < steps[i2].cells.length; k++) { aSet[steps[i2].cells[k]] = 1; aCount++; }
    }
    for (var i3 = iLo + 1; i3 <= iHi; i3++) {
      for (var k2 = 0; k2 < steps[i3].cells.length; k2++) diff.push(steps[i3].cells[k2]);
    }
    return {
      requested: { lo: +(lo * 100).toFixed(2), hi: +(hi * 100).toFixed(2) },
      snapped: {
        lo: +(doneAt(iLo) / totalBoxes * 100).toFixed(2),
        hi: +(doneAt(iHi) / totalBoxes * 100).toFixed(2)
      },
      doneBoxes: { lo: doneAt(iLo), hi: doneAt(iHi) },
      stepIndex: { lo: iLo + 1, hi: iHi + 1 },   // 0 表示开局
      totalBoxes: totalBoxes,
      stateAPixels: Object.keys(aSet).map(Number),
      stateAPixelCount: aCount,
      stateBPixelCount: aCount + diff.length,
      diffPixelCount: diff.length,
      diffPixels: diff,
      empty: diff.length === 0
    };
  }

  // ==================== 区域几何：连通块与描边 ====================

  /** 把像素集合切成四连通块（每块单独描边，便于美术按块定位）。 */
  function connectedComponents(pixels, rows, cols) {
    var inSet = {};
    for (var i = 0; i < pixels.length; i++) inSet[pixels[i]] = 1;
    var seen = {}, comps = [];
    for (var j = 0; j < pixels.length; j++) {
      var start = pixels[j];
      if (seen[start]) continue;
      var stack = [start], comp = [];
      seen[start] = 1;
      while (stack.length) {
        var idx = stack.pop();
        comp.push(idx);
        var r = Math.floor(idx / cols), c = idx % cols;
        var nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
        for (var d = 0; d < 4; d++) {
          var nr = nb[d][0], nc = nb[d][1];
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          var ni = nr * cols + nc;
          if (inSet[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
        }
      }
      comps.push(comp);
    }
    comps.sort(function (a, b) { return b.length - a.length; });
    return comps;
  }

  /**
   * 求一个像素集合的外轮廓线段（格线坐标，单位=格）。
   * 只在「集合内像素」与「集合外/越界」的交界处产生线段，因此描边不覆盖任何像素颜色。
   */
  function outlineSegments(pixels, rows, cols) {
    var inSet = {};
    for (var i = 0; i < pixels.length; i++) inSet[pixels[i]] = 1;
    var segs = [];
    for (var j = 0; j < pixels.length; j++) {
      var idx = pixels[j], r = Math.floor(idx / cols), c = idx % cols;
      if (r === 0 || !inSet[(r - 1) * cols + c]) segs.push([c, r, c + 1, r]);           // 上边
      if (r === rows - 1 || !inSet[(r + 1) * cols + c]) segs.push([c, r + 1, c + 1, r + 1]); // 下边
      if (c === 0 || !inSet[r * cols + c - 1]) segs.push([c, r, c, r + 1]);             // 左边
      if (c === cols - 1 || !inSet[r * cols + c + 1]) segs.push([c + 1, r, c + 1, r + 1]); // 右边
    }
    return segs;
  }

  // ==================== 多路线区域稳定性 ====================

  /**
   * 多路线区域归并：
   *   稳定区域 = 全部路线在该区间都消除；
   *   高频区域 = 多数路线（> 半数）消除；
   *   浮动区域 = 仅少数路线消除。
   * 每条路线各自独立吸附上下限（因为不同路线的可达盒进度点不同）。
   */
  function mergeRouteRegions(intervals) {
    var n = intervals.length, count = {};
    for (var i = 0; i < n; i++) {
      var px = intervals[i].diffPixels;
      for (var j = 0; j < px.length; j++) count[px[j]] = (count[px[j]] || 0) + 1;
    }
    var stable = [], frequent = [], floating = [];
    var keys = Object.keys(count);
    for (var k = 0; k < keys.length; k++) {
      var idx = +keys[k], c = count[keys[k]];
      if (c === n) stable.push(idx);
      else if (c * 2 > n) frequent.push(idx);
      else floating.push(idx);
    }
    return { routeCount: n, counts: count, stable: stable, frequent: frequent, floating: floating };
  }

  // ==================== 时间线构造 ====================

  /**
   * 统一时间线：无论来自导入的求解数据还是现场求解，都归一成
   *   { steps:[{step,r,c,done,buf,cells}], rows, cols, totalBoxes, totalPixels, ... }
   * 供 snapInterval 使用。
   */
  /**
   * 从导入求解数据里的【真实 pickOrder】重放出时间线（推荐路径）。
   * 为什么不直接用文件里的 replay.steps：
   *   阶段2 求解包建状态时未传 useSlotStart，而正式求解器 Solver.runSolver 内部是
   *   createState(level, { useSlotStart:true, ... })（solver.js 注明「与手动游玩一致…真机规则下可解」）。
   *   两种设置下同一条 pickOrder 的【逐步消除像素】与【逐步完成盒数】并不相同（总数相同）。
   *   工具必须按真机口径显示区域，所以只采信文件里的 pickOrder（那是求解器真实产出），
   *   逐步轨迹由本函数用真机口径重放，不用文件里旧口径的 replay.steps。
   */
  function timelineFromSolveFilePickOrder(solve, levelFile, opts) {
    if (!solve || !solve.pickOrder || !solve.pickOrder.length || !levelFile) return null;
    var rp = replay(levelFile, solve.pickOrder, opts);
    return {
      source: '导入求解数据的真实 pickOrder + 工具真机口径回放',
      pass: solve.meta ? solve.meta.solverPass : null,
      steps: rp.steps, rows: rp.rows, cols: rp.cols,
      totalBoxes: rp.totalBoxes, totalPixels: rp.totalPixels,
      completed: !!(rp.allEliminated && rp.allBoxesDone && rp.ok),
      steps_count: rp.steps.length,
      replayOk: rp.ok, replayFail: rp.fail,
      initialBoard: rp.initialBoard
    };
  }

  /** 兜底：只有求解数据、没有关卡文件时，只能用文件里旧口径的 replay.steps（须提示口径差异）。 */
  function timelineFromSolveFile(solve) {
    if (!solve || !solve.replay || !solve.replay.steps) return null;
    return {
      source: '导入求解数据的 replay.steps（阶段2 旧回放口径，未带 useSlotStart）',
      steps: solve.replay.steps,
      rows: solve.replay.rows, cols: solve.replay.cols,
      totalBoxes: solve.summary.totalBoxes,
      totalPixels: solve.summary.totalPixels,
      completed: !!solve.summary.completed,
      pass: solve.meta ? solve.meta.solverPass : null,
      steps_count: solve.summary.steps
    };
  }

  function timelineFromReplay(rp, extra) {
    var o = {
      source: '现场求解',
      steps: rp.steps, rows: rp.rows, cols: rp.cols,
      totalBoxes: rp.totalBoxes, totalPixels: rp.totalPixels,
      completed: !!rp.allEliminated, pass: null, steps_count: rp.steps.length,
      initialBoard: rp.initialBoard || null
    };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }

  /** 时间线自检：像素不重复、完成盒数单调、下标不越界。 */
  function verifyTimeline(tl) {
    var seen = {}, dup = 0, oob = 0, prev = -1, mono = true, sum = 0;
    var lim = tl.rows * tl.cols;
    for (var i = 0; i < tl.steps.length; i++) {
      var s = tl.steps[i];
      if (s.done < prev) mono = false;
      prev = s.done;
      for (var j = 0; j < s.cells.length; j++) {
        var px = s.cells[j];
        if (px < 0 || px >= lim) oob++;
        if (seen[px]) dup++; else seen[px] = 1;
        sum++;
      }
    }
    return {
      pixelSum: sum, duplicate: dup, outOfBounds: oob, monotonic: mono,
      coversAll: tl.totalPixels ? sum === tl.totalPixels : null
    };
  }

  // ==================== 暂存压力曲线 ====================

  /**
   * 从时间线构建暂存压力曲线数据（供画布绘制 + 卡点判定）。
   *
   * 口径（需求 07.30 §三.2 明确要求）：
   *   - points（动画曲线）：用 tl.steps 里已有的 done/buf 字段逐步构造，口径等价于求解器的
   *     stepBufferHistory（每步/每次点击后的暂存快照），允许用于画曲线的视觉展示。
   *   - audit（正式压力审核 / 前中后压力 / 卡点位置）：**不再**从上面这条点击时间线反推样本，
   *     必须由调用方显式传入真实求解结果的官方数据，二选一：
   *       opts.officialAuditPrecomputed —— 已经算好的 chokepointAudit 结果（例如导入的
   *         *.solve.json 里现成的 audit 字段），直接使用，不重新计算；
   *       opts.officialSamples —— 真实 pressureSamples 数组（来自 solver.js 求解结果或
   *         PlayerSim 结果），本函数调用正式 Analysis.chokepointAudit 计算，不复制其算法。
   *     两者都没有时 audit 为 null（不伪造、不反推），调用方需要在界面上明确提示「正式压力审核暂无」。
   */
  function pressureCurveFromTl(tl, opts) {
    opts = opts || {};
    if (!tl || !tl.steps || !tl.steps.length || !tl.totalBoxes) {
      return { points: [], peak: 0, avg: 0, totalBoxes: tl ? tl.totalBoxes : 0, bufferLimit: BUFFER_LIMIT, audit: null, officialSource: 'none' };
    }
    var points = [], sum = 0, peak = 0;
    for (var i = 0; i < tl.steps.length; i++) {
      var s = tl.steps[i];
      var p = { step: s.step, done: s.done, buf: s.buf, progress: s.done / tl.totalBoxes };
      points.push(p);
      sum += s.buf;
      if (s.buf > peak) peak = s.buf;
    }
    var avg = +(sum / points.length).toFixed(2);
    var audit = null, officialSource = 'none';
    if (opts.officialAuditPrecomputed) {
      audit = opts.officialAuditPrecomputed;
      officialSource = 'precomputed';
    } else if (opts.officialSamples && opts.officialSamples.length) {
      var A = global.AntSolver;
      if (A && A.Analysis && A.Analysis.chokepointAudit) {
        try { audit = A.Analysis.chokepointAudit(opts.officialSamples, tl.totalBoxes, BUFFER_LIMIT); officialSource = 'samples'; }
        catch (e) { audit = null; officialSource = 'none'; }
      }
    }
    return { points: points, peak: peak, avg: avg, totalBoxes: tl.totalBoxes, bufferLimit: BUFFER_LIMIT, audit: audit, officialSource: officialSource };
  }

  /**
   * 固定种子(7)单次玩家模拟，供原关卡/重构后关卡的正式玩家指标展示用
   * （需求 07.30 §三.3：是否通关/暂存峰值/复活次数，只跑一次，不做多轮平均；
   * 多轮通关率是重构对比表里的附加指标，由 PlayerSim.multiRun 单独提供）。
   * 种子 7 与 临时求解包-348关/求解.js、generator.js 内难度评估玩家兜底模拟同一约定，口径一致。
   */
  function officialPlayerResult(levelFile) {
    var A = AS();
    if (!A.PlayerSim) return null;
    var lv = toInternal(levelFile).level;
    var parsed = A.parseLevel(lv);
    try { return A.PlayerSim.run(parsed, { seed: 7, useItems: false, capturePreviewStats: true }); }
    catch (e) { return null; }
  }

  /**
   * 对【导入的正式关卡文件】跑多轮玩家模拟（需求 08.03 §一.6：导入一份关卡后也要能看玩家轨迹并切换种子）。
   * 与重构后关卡走的是同一个 playerMultiRounds，种子表也是同一张，两边口径一致。
   * 关卡必须先 toInternal → parseLevel 才能交给玩家模拟；直接传官方格式会让模拟空跑。
   */
  function playerMultiFromLevelFile(levelFile, opts) {
    var A = AS();
    if (!A.PlayerSim || !levelFile) return null;
    var parsed = null;
    try { parsed = A.parseLevel(toInternal(levelFile).level); } catch (e) { return null; }
    if (!parsed) return null;
    var multi = playerMultiRounds(parsed, opts || {});
    return { multi: multi, health: playerSimHealthy(parsed, multi) };
  }

  // ==================== 区域对比（原关卡 vs 重构后关卡） ====================

  /**
   * 把区间区域像素下标（扁平编码 = 行*cols+列）还原成 (r,c) 坐标集合的字符串键（"r,c"），
   * 用坐标而不是扁平下标做比较，因为原关卡与重构后关卡的棋盘尺寸/列数可能不同，扁平下标不能直接比。
   */
  function pixelsToCoordKeySet(pixels, cols) {
    var set = {};
    for (var i = 0; i < (pixels || []).length; i++) {
      var idx = pixels[i], r = Math.floor(idx / cols), c = idx % cols;
      set[r + ',' + c] = true;
    }
    return set;
  }

  /**
   * 对比原关卡与重构后关卡「同一进度区间」消除的目标图区域（按坐标比较，不按扁平下标，
   * 因为两者棋盘尺寸可能不同）。
   * @returns {object} { common, onlyBefore, onlyAfter }，每项是 [{r,c}] 坐标数组。
   */
  function regionCompare(pixelsBefore, colsBefore, pixelsAfter, colsAfter) {
    var setBefore = pixelsToCoordKeySet(pixelsBefore, colsBefore);
    var setAfter = pixelsToCoordKeySet(pixelsAfter, colsAfter);
    var common = [], onlyBefore = [], onlyAfter = [];
    Object.keys(setBefore).forEach(function (k) {
      var rc = k.split(',').map(Number);
      if (setAfter[k]) common.push({ r: rc[0], c: rc[1] });
      else onlyBefore.push({ r: rc[0], c: rc[1] });
    });
    Object.keys(setAfter).forEach(function (k) {
      if (!setBefore[k]) { var rc = k.split(',').map(Number); onlyAfter.push({ r: rc[0], c: rc[1] }); }
    });
    return { common: common, onlyBefore: onlyBefore, onlyAfter: onlyAfter };
  }

  /**
   * 从重构结果（reconstructFullRegenerate 的成功返回值）
   * 构建可回放的完整时间线，复用已有的 replay()/timelineFromReplay()，不新增求解逻辑。
   * 重构结果里的 solveResult 已经带 pickOrder，直接按真机口径重放即可。
   */
  function reconstructToTimeline(res) {
    if (!res || !res.ok || !res.level || !res.solveResult || !res.solveResult.pickOrder) return null;
    var rp = replay(res.level, res.solveResult.pickOrder, { captureBoard: true });
    return timelineFromReplay(rp, {
      pass: null, steps_count: res.solveResult.steps,
      totalBoxes: res.solveResult.totalBoxes || rp.totalBoxes,
      totalPixels: res.solveResult.totalPixels || rp.totalPixels,
      completed: true
    });
  }

  // ==================== 美术编辑：颜色统计与守恒对比 ====================

  /** 像素矩阵 → 每色像素数（0 不计）。用于改色前后的颜色守恒对比。 */
  function colorCounts(blocks) {
    var counts = {};
    for (var r = 0; r < (blocks || []).length; r++) {
      var row = blocks[r];
      for (var c = 0; c < row.length; c++) {
        var id = row[c];
        if (id > 0) counts[id] = (counts[id] || 0) + 1;
      }
    }
    return counts;
  }

  /** 只统计给定坐标列表 [{r,c}] 范围内的颜色数量（供框选区域统计用，不遍历全图）。 */
  function colorCountsInCells(blocks, cells) {
    var counts = {};
    for (var i = 0; i < (cells || []).length; i++) {
      var id = blocks[cells[i].r][cells[i].c];
      if (id > 0) counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }

  /**
   * 靠色对（需求 07.30 §四.4 固定表格，沿用参考编辑器 `js/batch.js` 的 `_CLOSE_PAIRS` 手动维护清单，
   * 不自行扩展 RGB 距离规则）。数据来源：`bin/参考/ 毛线色库/靠色色库.md`。
   */
  // 【2026-09-02 统一】本清单与产线审查 `bin/参考/bin/lib/close-color-audit.js` 的 CLOSE_PAIRS
  //   原本各有 5 对且不一致：本工具缺 `15,16`（深棕↔深蓝），产线审查缺 `31,32`（浅灰↔灰色）
  //   → 同一张图在修图工具里显示未命中、到产线却被判「发现靠色」，两边口径打架。
  //   用户 2026-09-02 裁定统一为**并集 6 对**。改动本清单时必须同步改产线审查那一份。
  var CLOSE_COLOR_PAIRS = [[2, 3], [15, 16], [17, 18], [20, 22], [28, 29], [31, 32]];

  /**
   * 检查给定颜色统计（colorCounts 或 colorCountsInCells 的返回值）里是否命中固定靠色对。
   * 命中时返回每对的编号/中文名/数量/占比；不命中的对不出现在结果里。
   */
  function checkClosePairs(counts, totalPixels) {
    var A = global.AntSolver;
    var hits = [];
    CLOSE_COLOR_PAIRS.forEach(function (pair) {
      var a = pair[0], b = pair[1];
      var ca = counts[a] || 0, cb = counts[b] || 0;
      if (ca > 0 && cb > 0) {
        hits.push({
          a: a, b: b,
          nameA: A ? A.getColorName(a) : String(a), nameB: A ? A.getColorName(b) : String(b),
          countA: ca, countB: cb,
          pctA: totalPixels ? +(ca / totalPixels * 100).toFixed(1) : null,
          pctB: totalPixels ? +(cb / totalPixels * 100).toFixed(1) : null
        });
      }
    });
    return hits;
  }

  /**
   * 全局或区域替换颜色：cells 传坐标数组时只替换该范围内的 oldId 像素（区域替换，选区外不受影响，
   * 需求 §四.5 第7点明确要求）；不传 cells 时替换全图（需求 §四.3 全局颜色替换）。
   * 原地修改 blocks，返回替换的像素数与被改动坐标列表（供撤销记录使用）。
   */
  function replaceColorInBlocks(blocks, oldId, newId, cells) {
    var changed = [];
    if (cells) {
      for (var i = 0; i < cells.length; i++) {
        var r = cells[i].r, c = cells[i].c;
        if (blocks[r][c] === oldId) { blocks[r][c] = newId; changed.push({ r: r, c: c }); }
      }
    } else {
      for (var rr = 0; rr < blocks.length; rr++) {
        for (var cc = 0; cc < blocks[rr].length; cc++) {
          if (blocks[rr][cc] === oldId) { blocks[rr][cc] = newId; changed.push({ r: rr, c: cc }); }
        }
      }
    }
    return { count: changed.length, cells: changed };
  }

  /** 矩形选区内的全部坐标 [{r,c}]（r0<=r1, c0<=c1，闭区间，供区域统计/区域替换/区域绘制复用）。 */
  function cellsInRect(r0, c0, r1, c1) {
    var out = [];
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) out.push({ r: r, c: c });
    return out;
  }

  /* ==================== 主体提取：选区掩码层 ====================
   * 任务 ANT-ARTTOOL-SUBJECT-EXTRACT-20260902（用户 2026-09-02 直接下达）
   *
   * 目的（用户原话）：「提取核心部分，去掉边缘杂物」，并且——这是**真正的终点**——
   * 「后续还需要再导入回来，把这些提取出来的主体重新放回来拼接，让不同关卡的不同部件组合，
   *  让之前 1 关 1 主体，拼接成多个主体」。所以本层的坐标口径必须能对齐：
   *   · 剔除**保持原尺寸**（用户裁决⑤），不裁到外接矩形 —— 拼接时行列坐标才对得上；
   *   · 被剔除处写 **0**（用户裁决④），与 `parseLevel` 只统计 `>0` 的口径一致，无需新语义。
   *
   * 为什么要「掩码」这一层而不是各选法各写一套：
   *   四种选法（矩形 / 套索 / 同色连通块 / 按色）产出的形状完全不同，但下游只关心
   *   「哪些格被选中」。统一成掩码后，加/减组合、剔除、统计、描边都只有一份实现。
   *
   * ⚠ 实测结论（`_kiro临时/09.02-修图工具主体提取/_最小样例.js` 七，44 张全量）：
   *   自动选法只能当**加速器**，不能当主力。四角同色连通块一击能剔 ≥25% 的只有 20/44 张，
   *   几乎剔不动（<5%）的有 5 张。原因是边缘形态分三类：①单一背景色铺满外圈（能一击剔）
   *   ②背景色被打断成噪点（108.txt 色25 共168格却切成10块）③根本没有背景、整张密铺纹理
   *   （125.txt）。所以**矩形与套索是主力**，这也正是用户最初说「手动框选」的原因。
   *
   * 掩码表示：`Uint8Array(rows*cols)`，1=选中。下标 = r*cols+c（与 connectedComponents 同一套）。
   */

  /** 建一个全 0 掩码。 */
  function maskNew(rows, cols) {
    return { rows: rows, cols: cols, bits: new Uint8Array(rows * cols) };
  }

  function maskClone(m) {
    return { rows: m.rows, cols: m.cols, bits: new Uint8Array(m.bits) };
  }

  /** 选中格数。 */
  function maskCount(m) {
    var n = 0;
    for (var i = 0; i < m.bits.length; i++) if (m.bits[i]) n++;
    return n;
  }

  function maskHas(m, r, c) {
    if (r < 0 || c < 0 || r >= m.rows || c >= m.cols) return false;
    return !!m.bits[r * m.cols + c];
  }

  /** 掩码 → 扁平下标数组（喂给 connectedComponents / outlineSegments）。 */
  function maskToIndices(m) {
    var out = [];
    for (var i = 0; i < m.bits.length; i++) if (m.bits[i]) out.push(i);
    return out;
  }

  /** 掩码 → [{r,c}]（喂给既有的按坐标操作，如 colorCountsInCells / replaceColorInBlocks）。 */
  function maskToCells(m) {
    var out = [];
    for (var i = 0; i < m.bits.length; i++) {
      if (m.bits[i]) out.push({ r: Math.floor(i / m.cols), c: i % m.cols });
    }
    return out;
  }

  /** 扁平下标数组 → 掩码。 */
  function maskFromIndices(indices, rows, cols) {
    var m = maskNew(rows, cols);
    for (var i = 0; i < (indices || []).length; i++) {
      var idx = indices[i];
      if (idx >= 0 && idx < m.bits.length) m.bits[idx] = 1;
    }
    return m;
  }

  /**
   * 掩码合成。`mode`：
   *   'replace' 用 add 覆盖 base（默认，普通点击/拖拽）
   *   'add'     并集（Shift）
   *   'subtract' 差集 base − add（Alt）
   *   'intersect' 交集
   * 不改入参，返回新掩码。
   */
  function maskCombine(base, add, mode) {
    if (!base) return maskClone(add);
    if (!add) return maskClone(base);
    if (base.rows !== add.rows || base.cols !== add.cols) {
      throw new Error('掩码尺寸不一致：' + base.rows + '×' + base.cols + ' vs ' + add.rows + '×' + add.cols);
    }
    var out = maskNew(base.rows, base.cols);
    for (var i = 0; i < out.bits.length; i++) {
      var b = base.bits[i], a = add.bits[i];
      if (mode === 'add') out.bits[i] = (b || a) ? 1 : 0;
      else if (mode === 'subtract') out.bits[i] = (b && !a) ? 1 : 0;
      else if (mode === 'intersect') out.bits[i] = (b && a) ? 1 : 0;
      else out.bits[i] = a ? 1 : 0;                 // replace
    }
    return out;
  }

  /* ---------- 选法一：矩形 ---------- */
  /** 矩形选区 → 掩码。会自动归正上下界并裁到画布内。 */
  function maskFromRect(rows, cols, r0, c0, r1, c1) {
    var a = Math.max(0, Math.min(r0, r1)), b = Math.min(rows - 1, Math.max(r0, r1));
    var x = Math.max(0, Math.min(c0, c1)), y = Math.min(cols - 1, Math.max(c0, c1));
    var m = maskNew(rows, cols);
    for (var r = a; r <= b; r++) for (var c = x; c <= y; c++) m.bits[r * cols + c] = 1;
    return m;
  }

  /* ---------- 选法二：套索（自由手绘多边形） ---------- */
  /**
   * 多边形选区 → 掩码。`poly` 是鼠标轨迹上的格点 [{r,c},…]，自动首尾闭合。
   *
   * 判定用**射线法**（奇偶规则），取格中心点 (c+0.5, r+0.5) 作为测试点 ——
   * 用格中心而不是格角，避免边界格因为浮点比较落在两边都不算。
   * 另外把多边形顶点自身所在的格也强制选中：手绘轨迹本身就是用户画的边界，
   * 若只按内部判定，细长条选区会因为「内部无格中心」而整条丢掉。
   */
  function maskFromPolygon(rows, cols, poly) {
    var m = maskNew(rows, cols);
    var pts = (poly || []).filter(function (p) { return p && isFinite(p.r) && isFinite(p.c); });
    if (!pts.length) return m;
    // 轨迹经过的格先选上
    for (var k = 0; k < pts.length; k++) {
      var pr = pts[k].r, pc = pts[k].c;
      if (pr >= 0 && pc >= 0 && pr < rows && pc < cols) m.bits[pr * cols + pc] = 1;
    }
    if (pts.length < 3) return m;                    // 不足三点构不成多边形，只留轨迹
    // 射线法填内部
    for (var r = 0; r < rows; r++) {
      var py = r + 0.5;
      for (var c = 0; c < cols; c++) {
        if (m.bits[r * cols + c]) continue;
        var px = c + 0.5, inside = false;
        for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          var xi = pts[i].c + 0.5, yi = pts[i].r + 0.5;
          var xj = pts[j].c + 0.5, yj = pts[j].r + 0.5;
          if (((yi > py) !== (yj > py)) &&
            (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
        }
        if (inside) m.bits[r * cols + c] = 1;
      }
    }
    return m;
  }

  /* ---------- 选法三：同色连通块（「磁吸」在色号矩阵上的实际对应物） ---------- */
  /**
   * 点 (r,c) → 与它同色且四连通的整块 → 掩码。
   *
   * PS 的磁吸靠亮度梯度找边缘，这里是**离散色号**矩阵，没有梯度。等价物就是同色连通块：
   * 点外圈背景，整个外圈连通区被选中，而**主体内部的同色像素不受影响**
   * （实测 108.txt 色 25 共 168 格被切成 10 块，点 (0,0) 只选中其中 5 格的那一块）。
   *
   * `tolerance` 预留但当前只支持 0（严格同色）。色号是离散 id，不是连续色彩，
   * 「相近色」要靠 CLOSE_COLOR_PAIRS 那套人工配对表，不能用数值差，故此处不做近似匹配。
   */
  function maskFromSameColorRegion(blocks, r, c) {
    var rows = blocks.length, cols = blocks[0] ? blocks[0].length : 0;
    var m = maskNew(rows, cols);
    if (r < 0 || c < 0 || r >= rows || c >= cols) return m;
    var target = blocks[r][c];
    var stack = [r * cols + c];
    m.bits[r * cols + c] = 1;
    while (stack.length) {
      var idx = stack.pop();
      var rr = Math.floor(idx / cols), cc = idx % cols;
      var nb = [[rr - 1, cc], [rr + 1, cc], [rr, cc - 1], [rr, cc + 1]];
      for (var d = 0; d < 4; d++) {
        var nr = nb[d][0], nc = nb[d][1];
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        var ni = nr * cols + nc;
        if (m.bits[ni]) continue;
        if (blocks[nr][nc] !== target) continue;
        m.bits[ni] = 1; stack.push(ni);
      }
    }
    return m;
  }

  /* ---------- 选法四：按色全选 ---------- */
  /** 某个色号的全部像素 → 掩码（不管连不连通）。用于「这个色整体是背景」的场合。 */
  function maskFromColor(blocks, color) {
    var rows = blocks.length, cols = blocks[0] ? blocks[0].length : 0;
    var m = maskNew(rows, cols);
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (blocks[r][c] === color) m.bits[r * cols + c] = 1;
    }
    return m;
  }

  /* ---------- 选法五：区域内同色（2026-09-15 需求③）---------- */
  /**
   * 「某个区域里的某个颜色」→ 掩码。区域 `region` 为 null 时退化成 maskFromColor（全图）。
   *
   * **为什么必须有这一档**（用户 2026-09-15 需求③，实测见 `_kiro临时/09.15-去毛边与同色区域选区/`）：
   * 描边黑色既构成边缘杂物、也构成主体轮廓，而它在图上是**碎的**——
   * 熊猫图色 33 共 573 格却切成 94 块、最大块仅 89 格；蜗牛图 267 格切成 73 块、最大块 24 格。
   * 于是原有两档都不够用：
   *   - `maskFromSameColorRegion`（连通同色）：点一下只够 9~16%，够不着整条边缘；
   *   - `maskFromColor`（全图同色）：会把**主体轮廓**一起选中，剔除后主体被毁。
   * 中间这一档「先圈范围、再在范围内取该色」才能做到「只去边缘、保留主体」：
   * 以熊猫左右边缘带为例，带 ∩ 色33 = 68 格，主体描边完全不受影响。
   *
   * 实现上就是 intersect，`maskCombine` 早已支持；这里做成命名函数是为了让调用处的**意图**可读，
   * 并把「region 为空时怎么算」这个边界固定在一处，避免各调用点各写一遍。
   */
  function maskFromColorInRegion(blocks, color, region) {
    var all = maskFromColor(blocks, color);
    if (!region) return all;
    return maskCombine(region, all, 'intersect');
  }

  /**
   * 所有「不超过 maxSize 格」的非 0 连通块 → 掩码。用于一键清掉零碎毛边。
   *
   * 与「只留最大连通块」的区别：后者只保留第 1 块，第 2 大块再有用也会被清掉；
   * 这个按**尺寸阈值**判，能保留次大的有效部件、只清真正的碎渣。
   * 实测熊猫图（已剔过背景）非 0 共 24 块：最大 2206 格是主体，其余 23 块合计仅 103 格、单块最大 37 格，
   * 取 maxSize=40 即可一次清净而不碰主体。
   */
  function maskFromSmallComponents(blocks, maxSize) {
    var rows = blocks.length, cols = blocks[0] ? blocks[0].length : 0;
    var m = maskNew(rows, cols);
    var comps = nonZeroComponents(blocks);
    var lim = Math.max(0, maxSize | 0);
    for (var i = 0; i < comps.length; i++) {
      if (comps[i].length > lim) continue;
      for (var j = 0; j < comps[i].length; j++) m.bits[comps[i][j]] = 1;
    }
    return m;
  }

  /** 非 0 像素的全部连通块（按大小降序），用于「保留最大若干块」这类辅助。 */
  function nonZeroComponents(blocks) {
    var rows = blocks.length, cols = blocks[0] ? blocks[0].length : 0;
    var idx = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (blocks[r][c] > 0) idx.push(r * cols + c);
    }
    return connectedComponents(idx, rows, cols);
  }

  /* ---------- 剔除 ---------- */
  /**
   * 按掩码剔除像素，被剔除处写 **0**，**保持原尺寸**。
   *
   * @param {number[][]} blocks 原图（不改）
   * @param {object} mask 选区掩码
   * @param {string} mode 'outside' = 只保留选区内（剔掉选区外，主用途：提取主体）
   *                      'inside'  = 挖空选区内（剔掉选区内，主用途：删掉杂物）
   * @returns {object} { blocks, removed, kept, before, after, rows, cols, mode }
   */
  function applyExtract(blocks, mask, mode) {
    var rows = blocks.length, cols = blocks[0] ? blocks[0].length : 0;
    if (!mask || mask.rows !== rows || mask.cols !== cols) {
      throw new Error('掩码与图尺寸不一致：图 ' + rows + '×' + cols +
        '，掩码 ' + (mask ? mask.rows + '×' + mask.cols : 'null'));
    }
    var out = [], removed = 0, before = 0, after = 0;
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) {
        var v = blocks[r][c];
        if (v > 0) before++;
        var inSel = !!mask.bits[r * cols + c];
        var kill = (mode === 'inside') ? inSel : !inSel;
        if (kill) {
          if (v > 0) removed++;                     // 只把「原本有像素」的算成剔除
          row.push(0);
        } else {
          row.push(v);
          if (v > 0) after++;
        }
      }
      out.push(row);
    }
    return {
      blocks: out, rows: rows, cols: cols, mode: mode || 'outside',
      removed: removed, kept: after, before: before, after: after
    };
  }

  /** 非 0 像素的外接矩形；全空返回 null。拼接时用它做平移与占位判断。 */
  function bboxOfBlocks(blocks) {
    var rows = blocks.length, cols = blocks[0] ? blocks[0].length : 0;
    var r0 = -1, c0 = -1, r1 = -1, c1 = -1;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (blocks[r][c] > 0) {
        if (r0 < 0 || r < r0) r0 = r;
        if (c0 < 0 || c < c0) c0 = c;
        if (r > r1) r1 = r;
        if (c > c1) c1 = c;
      }
    }
    if (r0 < 0) return null;
    return { r0: r0, c0: c0, r1: r1, c1: c1, rows: r1 - r0 + 1, cols: c1 - c0 + 1 };
  }

  /* ---------- 图纸条目（图纸库，与关卡条目并列的另一类） ---------- */
  var ART_PIECE_TYPE = 'artPiece';

  /**
   * 把一张提取好的图 → 图纸库条目。
   *
   * 只存可复现的事实。**不单独存掩码**：`blocks` 里非 0 的位置就等价于「这个部件占哪些格」，
   * 存两份会漂移。但 `bbox` 要存 —— 拼接时要靠它平移与判断占位，从 blocks 现算也行，
   * 但列表渲染频繁读它，存下来省一次全图扫描。
   *
   * @param {number[][]} blocks 提取后的图（保持原尺寸，非主体处为 0）
   * @param {object} meta { key, sourceName, ops, note }
   */
  function toArtPiece(blocks, meta) {
    meta = meta || {};
    var rows = blocks.length, cols = blocks[0] ? blocks[0].length : 0;
    var counts = {}, pixelCount = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var v = blocks[r][c];
      if (v > 0) { pixelCount++; counts[v] = (counts[v] || 0) + 1; }
    }
    if (!pixelCount) throw new Error('这张图剔完之后一个像素都不剩，不能入库');
    return {
      type: ART_PIECE_TYPE,
      version: 1,
      key: meta.key || (meta.sourceName || 'piece'),
      rows: rows, cols: cols,                    // 原尺寸：拼接坐标口径的基准
      blocks: blocks,
      bbox: bboxOfBlocks(blocks),
      pixelCount: pixelCount,
      colors: counts,
      colorCount: Object.keys(counts).length,
      source: {
        sourceName: meta.sourceName || null,     // 来自哪张图
        ops: meta.ops || [],                     // 怎么选出来的（选法序列），可追溯
        extractedAt: new Date().toISOString()
      },
      note: meta.note || ''
    };
  }

  /** 图纸条目的汇总统计（面板与导出说明用）。 */
  function artPieceStats(list) {
    var n = 0, px = [], sizes = {}, colorUnion = {};
    (list || []).forEach(function (e) {
      if (!e || e.type !== ART_PIECE_TYPE) return;
      n++;
      px.push(e.pixelCount);
      var k = e.rows + '×' + e.cols;
      sizes[k] = (sizes[k] || 0) + 1;
      Object.keys(e.colors || {}).forEach(function (col) { colorUnion[col] = 1; });
    });
    px.sort(function (a, b) { return a - b; });
    return {
      count: n,
      sizes: sizes,
      colorUnion: Object.keys(colorUnion).map(Number).sort(function (a, b) { return a - b; }),
      pixel: px.length ? {
        min: px[0], max: px[px.length - 1],
        median: px[Math.floor(px.length / 2)],
        sum: px.reduce(function (a, b) { return a + b; }, 0)
      } : null
    };
  }

  /* ==================== 图纸拼接：多主体合成 ====================
   * 任务 ANT-ARTTOOL-PIECE-COMPOSE-20260915（用户 2026-09-15 六条需求）。
   *
   * 用户目的：在一张**自定规格**的新画布上摆多个部件，让原本「1 关 1 主体」变成多主体，
   * 用于目标引导趋势。
   *
   * 两条来自用户的硬口径，决定了本层的设计：
   *   1. 部件「默认是单独的主体，互不影响，**可叠加**」；用户 2026-09-18 进一步确认：
   *      重叠不阻止导出，最终只输出最顶层的像素 id。
   *      → 所以**叠加不是错误**，`composeFlatten` 永远能算出最终输出；
   *        `composeConflicts` 只负责提示哪些格会发生覆盖。
   *        两件事分开，编辑期才不会被拦得没法摆。
   *   2. 部件「可以随意拖拽」→ 位置只用偏移 `offR/offC` 表示，**不动部件的像素**。
   *      于是拖来拖去是无损的，拖回原处就完全还原；覆盖提示与出图都由偏移现算。
   *
   * 为什么需要偏移而不是「同尺寸直接叠加」：实测用户真实产出的 3 张图纸
   * （`实验关卡/主体图纸库_3张_20260915-110230/`）尺寸不统一（20×20 与 55×55），
   * 且唯一同尺寸的一对直接叠加会重叠 1132 格（占较小那张 97.1%）。
   * 详见 `_kiro临时/09.15-拼接需求核查/_探拼接可行性.js`。
   */

  function composeLayerType(layer) {
    return (layer && layer.type) || 'subject';
  }

  function composeLayerExportable(layer) {
    return !(layer && layer.exportable === false) && composeLayerType(layer) !== 'guide';
  }

  function composeLayerConflictRole(layer) {
    var t = composeLayerType(layer);
    // 背景、包围、分隔是有意铺在主体下方的规则层，不参与“主体互相抢格”的覆盖提示。
    // 旧图层没有 type，按 subject 处理，保持历史行为。
    return t === 'subject' || t === 'paint';
  }

  function composeSortedLayers(layers) {
    return (layers || []).map(function (L, idx) { return { layer: L, idx: idx }; })
      .sort(function (a, b) {
        // 2026-09-18：最终输出按图层列表真实层序，从底到顶依次合成。
        // 类型只决定自动生成时的默认插入位置，不再在拍平阶段强制重排。
        return a.idx - b.idx;
      });
  }

  /** 新建一张全 0 画布（rows×cols）。0 在本项目里就是「空、不参与」。 */
  function composeNewCanvas(rows, cols) {
    var r, c, out = [];
    rows = Math.max(1, rows | 0); cols = Math.max(1, cols | 0);
    for (r = 0; r < rows; r++) {
      var row = [];
      for (c = 0; c < cols; c++) row.push(0);
      out.push(row);
    }
    return out;
  }

  /**
   * 一个图层在画布上的落点统计（不产生画布，只回答「它落在哪、有没有被切掉」）。
   *
   * `layer`：`{ blocks, offR, offC }`。偏移可以是负数，也可以让部件伸出画布 ——
   * 摆放过程中这很正常，但**伸出去的非 0 像素在出图时会被切掉**，所以这里如实数出来，
   * 让界面能提示「有 N 格被画布边界切掉了」，而不是等导出后才发现少了东西。
   */
  function composeLayerPlacement(layer, rows, cols) {
    var bl = layer.blocks, offR = layer.offR | 0, offC = layer.offC | 0;
    var lr = bl.length, lc = bl[0] ? bl[0].length : 0;
    var inside = 0, clipped = 0;
    var r0 = null, c0 = null, r1 = null, c1 = null;
    for (var r = 0; r < lr; r++) for (var c = 0; c < lc; c++) {
      if (bl[r][c] <= 0) continue;
      var R = r + offR, C = c + offC;
      if (R < 0 || C < 0 || R >= rows || C >= cols) { clipped++; continue; }
      inside++;
      if (r0 === null || R < r0) r0 = R;
      if (r1 === null || R > r1) r1 = R;
      if (c0 === null || C < c0) c0 = C;
      if (c1 === null || C > c1) c1 = C;
    }
    return {
      inside: inside,          // 真正落在画布内的非 0 像素数
      clipped: clipped,        // 被画布边界切掉的非 0 像素数（>0 时界面要提示）
      total: inside + clipped,
      bbox: r0 === null ? null : { r0: r0, c0: c0, r1: r1, c1: c1, rows: r1 - r0 + 1, cols: c1 - c0 + 1 }
    };
  }

  /**
   * 把多个图层拍平成一张画布。
   *
   * 顺序即层序：**后面的图层盖住前面的**（与界面上的图层列表顺序一致）。
   * `visible === false` 的图层跳过。越界部分静默裁切（数量由 composeLayerPlacement 负责报告）。
   *
   * 注意这里**不阻止覆盖**——按用户口径，最终只取最顶层的非 0 像素。
   */
  function composeFlatten(layers, rows, cols) {
    var out = composeNewCanvas(rows, cols);
    composeSortedLayers(layers).forEach(function (entry) {
      var L = entry.layer;
      if (!L || !L.blocks || L.visible === false || !composeLayerExportable(L)) return;
      var bl = L.blocks, offR = L.offR | 0, offC = L.offC | 0;
      for (var r = 0; r < bl.length; r++) {
        var row = bl[r];
        for (var c = 0; c < row.length; c++) {
          if (row[c] <= 0) continue;                 // 0 是空，不参与覆盖
          var R = r + offR, C = c + offC;
          if (R < 0 || C < 0 || R >= rows || C >= cols) continue;
          out[R][C] = row[c];
        }
      }
    });
    return out;
  }

  /**
   * 找出**多个图层抢同一格**的位置。这是「最终输出会发生覆盖」的提示，不再阻止导出。
   *
   * 判据：同一格被 ≥2 个可见图层写入了非 0 值。只有非 0 才算 —— 0 是空，谁都可以是 0。
   * 返回按图层对分组的明细，界面才能说清「是哪两个部件会按最顶层像素输出」，
   * 而不是只报一个总数让用户自己找。
   *
   * `limit` 限制返回的坐标条数（防止几千个覆盖格把界面刷爆），但 `count` 是**全量**计数。
   */
  function composeConflicts(layers, rows, cols, limit) {
    limit = limit == null ? 200 : limit;
    var owner = [];                         // 每格记第一个占用它的图层下标
    var i, r, c;
    for (i = 0; i < rows * cols; i++) owner.push(-1);
    var cells = [], count = 0;
    var pairs = {};                         // 'i-j' → 覆盖格数
    var perLayer = {};                      // 图层下标 → 参与覆盖提示的格数
    var vis = [];
    (layers || []).forEach(function (L, idx) {
      if (L && L.blocks && L.visible !== false && composeLayerExportable(L) && composeLayerConflictRole(L)) vis.push(idx);
    });

    vis.forEach(function (idx) {
      var L = layers[idx], bl = L.blocks, offR = L.offR | 0, offC = L.offC | 0;
      for (var rr = 0; rr < bl.length; rr++) {
        var row = bl[rr];
        for (var cc = 0; cc < row.length; cc++) {
          if (row[cc] <= 0) continue;
          var R = rr + offR, C = cc + offC;
          if (R < 0 || C < 0 || R >= rows || C >= cols) continue;
          var k = R * cols + C;
          if (owner[k] < 0) { owner[k] = idx; continue; }
          // 撞上了：owner[k] 是先占的那个
          count++;
          var a = owner[k], b = idx;
          var pk = a + '-' + b;
          pairs[pk] = (pairs[pk] || 0) + 1;
          perLayer[a] = (perLayer[a] || 0) + 1;
          perLayer[b] = (perLayer[b] || 0) + 1;
          if (cells.length < limit) cells.push({ r: R, c: C, a: a, b: b });
        }
      }
    });
    return {
      count: count,                 // 覆盖格总数（全量，不受 limit 影响）
      cells: cells,                 // 前 limit 个覆盖坐标，含参与的两个图层下标
      truncated: count > cells.length,
      pairs: pairs,                 // 'a-b' → 该对图层的覆盖格数
      perLayer: perLayer,           // 图层下标 → 它参与的覆盖格数
      visibleCount: vis.length
    };
  }

  /**
   * 拼接结果的出图前体检。回答的是「这张图现在能不能当成一份正式图纸交出去」。
   *
   * 用户 2026-09-18 口径：重叠不阻止导出，最终只输出最顶层的像素 id。
   * 所以 ok 不再要求 conflictCount / clipped / layersFullyOutside 为 0；
   * 重叠和越界只作为提示，导出按当前画布裁切。
   */
  function composeAudit(layers, rows, cols) {
    var conflicts = composeConflicts(layers, rows, cols);
    var clippedTotal = 0, placed = 0, visible = 0, empty = [];
    (layers || []).forEach(function (L, idx) {
      if (!L || !L.blocks || L.visible === false) return;
      visible++;
      var p = composeLayerPlacement(L, rows, cols);
      clippedTotal += p.clipped;
      placed += p.inside;
      if (p.inside === 0) empty.push(idx);      // 整个部件都在画布外
    });
    var flat = composeFlatten(layers, rows, cols);
    var nz = 0, holes = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (flat[r][c] > 0) nz++; else holes++;
    }
    return {
      rows: rows, cols: cols,
      visibleLayers: visible,
      conflictCount: conflicts.count,
      conflicts: conflicts,
      clipped: clippedTotal,              // 被画布边界切掉的像素总数
      layersFullyOutside: empty,          // 完全落在画布外的图层（等于没摆上）
      pixelSum: placed,                   // 各图层落在画布内的像素之和（含重复计算的冲突格）
      pixelActual: nz,                    // 拍平后实际非 0 格数
      backgroundHoles: holes,
      // 这两个数不等就说明有覆盖发生：差额 = 被盖掉的像素数
      covered: placed - nz,
      ok: nz > 0
    };
  }

  function composeSubjectCells(layers, rows, cols, ids) {
    var allow = null;
    if (ids && ids.length) {
      allow = {};
      ids.forEach(function (id) { allow[id] = true; });
    }
    var out = [];
    (layers || []).forEach(function (L, idx) {
      if (!L || !L.blocks || L.visible === false || !composeLayerExportable(L)) return;
      if (composeLayerType(L) !== 'subject') return;
      if (allow && !allow[L.id]) return;
      var bl = L.blocks, offR = L.offR | 0, offC = L.offC | 0;
      for (var r = 0; r < bl.length; r++) for (var c = 0; c < bl[r].length; c++) {
        if (bl[r][c] <= 0) continue;
        var R = r + offR, C = c + offC;
        if (R < 0 || C < 0 || R >= rows || C >= cols) continue;
        out.push({ r: R, c: C, id: L.id, layerIndex: idx });
      }
    });
    return out;
  }

  function composeMaskFromCells(cells, rows, cols) {
    var mask = new Uint8Array(rows * cols);
    (cells || []).forEach(function (p) {
      if (p.r < 0 || p.c < 0 || p.r >= rows || p.c >= cols) return;
      mask[p.r * cols + p.c] = 1;
    });
    return mask;
  }

  function composeHaloBlocks(layers, rows, cols, opts) {
    opts = opts || {};
    var radius = Math.max(1, opts.radius | 0);
    var color = Math.max(0, opts.color | 0) || 31;
    var subjects = composeSubjectCells(layers, rows, cols, opts.layerIds);
    var subjectMask = composeMaskFromCells(subjects, rows, cols);
    var out = composeNewCanvas(rows, cols);
    var cells = [];
    subjects.forEach(function (p) {
      for (var dr = -radius; dr <= radius; dr++) for (var dc = -radius; dc <= radius; dc++) {
        var R = p.r + dr, C = p.c + dc;
        if (R < 0 || C < 0 || R >= rows || C >= cols) continue;
        var k = R * cols + C;
        if (subjectMask[k]) continue;
        if (out[R][C] > 0) continue;
        out[R][C] = color;
        cells.push({ r: R, c: C });
      }
    });
    return { blocks: out, cells: cells, subjectPixels: subjects.length, color: color, radius: radius };
  }

  function composeBackgroundBlocks(layers, rows, cols, opts) {
    opts = opts || {};
    var a = Math.max(0, opts.colorA | 0) || 14;
    var b = Math.max(0, opts.colorB | 0) || a;
    var pattern = opts.pattern || 'diagonal';
    var out = composeNewCanvas(rows, cols);
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var v = a;
      if (pattern === 'checker') v = ((r + c) % 2 === 0) ? a : b;
      else if (pattern === 'dots') v = ((r % 5 === 0 && c % 5 === 0) || ((r + 2) % 7 === 0 && (c + 3) % 7 === 0)) ? b : a;
      else if (pattern === 'stripes') v = (Math.floor((r + c) / 3) % 2 === 0) ? a : b;
      else if (pattern === 'diagonal') v = ((r + c) % 6 < 2) ? b : a;
      out[r][c] = v;
    }
    return { blocks: out, colorA: a, colorB: b, pattern: pattern };
  }

  function composeLayerPlacedBBox(layer, rows, cols) {
    var p = composeLayerPlacement(layer, rows, cols);
    return p.bbox;
  }

  function composeRectDist(r, c, b) {
    var dr = r < b.r0 ? b.r0 - r : (r > b.r1 ? r - b.r1 : 0);
    var dc = c < b.c0 ? b.c0 - c : (c > b.c1 ? c - b.c1 : 0);
    return dr + dc;
  }

  function composeSeparatorBlocks(layers, rows, cols, opts) {
    opts = opts || {};
    var color = Math.max(0, opts.color | 0) || 33;
    var width = Math.max(1, opts.width | 0);
    var tolerance = Math.max(0, opts.tolerance | 0);
    if (opts.tolerance == null) tolerance = 1;
    var maxSpan = Math.max(4, opts.maxSpan | 0) || 32;
    var subjects = [];
    (layers || []).forEach(function (L) {
      if (!L || L.visible === false || composeLayerType(L) !== 'subject') return;
      var b = composeLayerPlacedBBox(L, rows, cols);
      if (b) subjects.push({ id: L.id, name: L.name || '', bbox: b });
    });
    var occupied = composeMaskFromCells(composeSubjectCells(layers, rows, cols), rows, cols);
    var out = composeNewCanvas(rows, cols), cells = [];
    if (subjects.length < 2) return { blocks: out, cells: cells, subjectCount: subjects.length };
    function put(r, c) {
      for (var dr = -Math.floor((width - 1) / 2); dr < width - Math.floor((width - 1) / 2); dr++) {
        for (var dc = -Math.floor((width - 1) / 2); dc < width - Math.floor((width - 1) / 2); dc++) {
          var R = r + dr, C = c + dc;
          if (R < 0 || C < 0 || R >= rows || C >= cols) continue;
          var k = R * cols + C;
          if (occupied[k] || out[R][C] > 0) continue;
          out[R][C] = color;
          cells.push({ r: R, c: C });
        }
      }
    }
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (occupied[r * cols + c]) continue;
      var best = Infinity, second = Infinity, bi = -1;
      for (var i = 0; i < subjects.length; i++) {
        var d = composeRectDist(r, c, subjects[i].bbox);
        if (d < best) { second = best; best = d; bi = i; }
        else if (d < second) second = d;
      }
      if (bi < 0 || second === Infinity) continue;
      if (best + second > maxSpan) continue;
      if (second - best <= tolerance) put(r, c);
    }
    return { blocks: out, cells: cells, subjectCount: subjects.length, color: color, width: width, maxSpan: maxSpan };
  }

  /**
   * 把若干图层合并成一个新部件（用户需求⑤「可加选减选不同的主体成为新主体」）。
   *
   * 产出的 blocks 尺寸 = **画布尺寸**（不是各部件的原尺寸），因为合并后它们的相对位置
   * 只有在画布坐标系里才有意义。合并后原先的偏移已经被烘进像素里，新部件偏移归零。
   */
  function composeMergeLayers(layers, indices, rows, cols) {
    var picked = (indices || []).map(function (i) { return layers[i]; })
      .filter(function (L) { return L && L.blocks; });
    if (!picked.length) throw new Error('没有可合并的图层');
    var flat = composeFlatten(picked, rows, cols);
    var nz = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) if (flat[r][c] > 0) nz++;
    if (!nz) throw new Error('合并结果是空图（这些图层可能都在画布外）');
    return { blocks: flat, rows: rows, cols: cols, pixelCount: nz };
  }

  /* ==================== 像素绘制：直线 / 填充 / 边框 ====================
   * 任务 ANT-ARTTOOL-PIECE-COMPOSE-20260915 需求⑥。
   *
   * 全部是**纯像素运算**：输入 blocks 与参数，返回新 blocks 或格坐标集合，不碰 DOM。
   * 一律不修改入参（拼接里图层的 blocks 会被多处引用，原地改会让撤销失效）。
   */

  /**
   * 像素直线上的格子（Bresenham）。`width` 是线宽，单位就是**格**（用户需求⑥：「单位为像素大小」）。
   *
   * 加宽方向：**只沿垂直于线的方向**，端头不向外延伸。
   *   偏水平的线（|dc| ≥ |dr|）往上下加宽，偏垂直的线往左右加宽。
   *
   * 为什么不用「每个中心点铺 width×width 方块」那种笔刷式加宽：那样端头会外扩，
   * 于是线宽 3 的一条从第 2 列到第 9 列的水平线会占到第 1~10 列。后果不只是数字难看 ——
   * 田字格的中间十字就是用本函数画的，端头外扩会让**十字戳出外框**；
   * 用户还要靠 box 精确控制边框范围。所以这里保证：**加宽不会超出起终点定义的范围**。
   */
  function lineCells(r0, c0, r1, c1, width, rows, cols) {
    width = Math.max(1, width | 0);
    var out = [], seen = {};
    var dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
    var sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
    var err = dc - dr, r = r0, c = c0;
    var half = Math.floor((width - 1) / 2);
    var widenRow = dc >= dr;      // 偏水平 → 上下加宽；偏垂直 → 左右加宽
    function put(rr, cc) {
      for (var a = 0; a < width; a++) {
        var R = widenRow ? rr - half + a : rr;
        var C = widenRow ? cc : cc - half + a;
        if (rows != null && (R < 0 || R >= rows)) continue;
        if (cols != null && (C < 0 || C >= cols)) continue;
        var k = R + ',' + C;
        if (seen[k]) continue;
        seen[k] = 1; out.push({ r: R, c: C });
      }
    }
    // 步数上界：防御性写法，避免参数异常时死循环
    var guard = (dr + dc) * 2 + 8;
    while (guard-- > 0) {
      put(r, c);
      if (r === r1 && c === c1) break;
      var e2 = err * 2;
      if (e2 > -dr) { err -= dr; c += sc; }
      if (e2 < dc) { err += dc; r += sr; }
    }
    return out;
  }

  /** 把一组格子涂成某色 → 新 blocks（不改入参）。color=0 就是擦成空。 */
  function paintCells(blocks, cells, color) {
    var out = blocks.map(function (row) { return row.slice(); });
    var rows = out.length, cols = out[0] ? out[0].length : 0;
    var n = 0;
    (cells || []).forEach(function (p) {
      if (p.r < 0 || p.c < 0 || p.r >= rows || p.c >= cols) return;
      if (out[p.r][p.c] === color) return;
      out[p.r][p.c] = color; n++;
    });
    return { blocks: out, changed: n };
  }

  /**
   * 泛光填充（用户需求⑥末段：「选中空区域，填充颜色」）。
   *
   * 从 (r,c) 出发，把**与它同值且四连通**的一片改成 color。
   * 「空区域」就是值为 0 的连通片 —— 这是最常用的场合（拼接后主体之间的空隙）；
   * 但这里不限定只能填 0，点在任何颜色上都能把那一片同色区换成新色，
   * 因为「把这一块红的整片换成蓝的」是同样自然的需求，多加一个限制反而少一种用法。
   *
   * 返回 `{blocks, changed, cells}`；目标色与原色相同时 changed=0（不做无意义的整片改写）。
   */
  function fillRegion(blocks, r, c, color) {
    var rows = blocks.length, cols = blocks[0] ? blocks[0].length : 0;
    if (r < 0 || c < 0 || r >= rows || c >= cols) return { blocks: blocks, changed: 0, cells: [] };
    var from = blocks[r][c];
    if (from === color) return { blocks: blocks, changed: 0, cells: [] };
    var out = blocks.map(function (row) { return row.slice(); });
    var stack = [[r, c]], cells = [];
    var seen = new Uint8Array(rows * cols);
    seen[r * cols + c] = 1;
    while (stack.length) {
      var p = stack.pop(), rr = p[0], cc = p[1];
      out[rr][cc] = color;
      cells.push({ r: rr, c: cc });
      var nb = [[rr - 1, cc], [rr + 1, cc], [rr, cc - 1], [rr, cc + 1]];
      for (var i = 0; i < 4; i++) {
        var nr = nb[i][0], nc = nb[i][1];
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        var k = nr * cols + nc;
        if (seen[k]) continue;
        if (blocks[nr][nc] !== from) continue;
        seen[k] = 1; stack.push([nr, nc]);
      }
    }
    return { blocks: out, changed: cells.length, cells: cells, fromColor: from };
  }

  /* ---------- 边框形态生成器（用户需求⑥中段） ----------
   * 六种基础形态：田字格 / 口字型 / 斜线型 / Z型 / L型 / N型。
   * 统一签名：在一个 rows×cols 的框内生成格坐标，宽度可调。
   *
   * 为什么产出的是**格坐标集合**而不是直接出 blocks：
   *   调用方要用同一批坐标做三件事 —— 涂色、局部替换（田字格的四个小口分别换色）、
   *   以及算「这批格子里有几个落在已有像素上」。产出坐标集合，三件事共用一份实现。
   */

  var BORDER_KINDS = ['田字格', '口字型', '斜线型', 'Z型', 'L型', 'N型'];

  /** 矩形环（口字）：外框往内 width 圈。 */
  function ringCells(r0, c0, r1, c1, width, rows, cols) {
    width = Math.max(1, width | 0);
    var out = [], seen = {};
    function put(r, c) {
      if (r < r0 || r > r1 || c < c0 || c > c1) return;
      if (rows != null && (r < 0 || r >= rows)) return;
      if (cols != null && (c < 0 || c >= cols)) return;
      var k = r + ',' + c;
      if (seen[k]) return;
      seen[k] = 1; out.push({ r: r, c: c });
    }
    for (var w = 0; w < width; w++) {
      for (var c = c0; c <= c1; c++) { put(r0 + w, c); put(r1 - w, c); }
      for (var r = r0; r <= r1; r++) { put(r, c0 + w); put(r, c1 - w); }
    }
    return out;
  }

  /**
   * 生成一种边框形态的格坐标。
   *
   * `kind` 取 BORDER_KINDS 之一；`box` = `{r0,c0,r1,c1}` 是形态的外接范围；
   * `width` 线宽（格）。返回 `{cells, parts}`：
   *   - `cells`：全部格坐标（去重）；
   *   - `parts`：按**语义部件**分组，供「局部替换颜色」用。
   *     用户明确举了例子：「田字格可以看作四个小口，做局部的替换和设计」，
   *     所以田字格的 parts 就是那四个小口（外框另算一组），而不是笼统一坨。
   */
  function borderShape(kind, box, width, rows, cols) {
    width = Math.max(1, width | 0);
    var r0 = Math.min(box.r0, box.r1), r1 = Math.max(box.r0, box.r1);
    var c0 = Math.min(box.c0, box.c1), c1 = Math.max(box.c0, box.c1);
    var parts = [];
    var half = Math.floor((width - 1) / 2);

    /**
     * 画一条**贴着 box 边**的线：把中心线往内侧推 half 格，
     * 这样加宽后正好铺满 width 格且不越界。
     *
     * 为什么需要它：lineCells 是居中加宽的，贴边的线加宽后外侧那圈会落到 box 外、
     * 随后被裁掉，结果「线宽 3」只画出 2 格宽。而口字型走的是 ringCells（往内画），
     * 同样的 width 却是实打实 3 格 —— 两种形态粗细不一致，用户会以为工具算错了。
     * 这里统一成「贴边的线一律向内加宽」，让 width 在所有形态里都是实际粗细。
     */
    function edgeLine(ar, ac, br, bc) {
      var R0 = ar, C0 = ac, R1 = br, C1 = bc;
      if (ar === br) {                       // 水平线
        if (ar === r0) { R0 = R1 = r0 + half; }
        else if (ar === r1) { R0 = R1 = r1 - half; }
      } else if (ac === bc) {                // 垂直线
        if (ac === c0) { C0 = C1 = c0 + half; }
        else if (ac === c1) { C0 = C1 = c1 - half; }
      }
      return lineCells(R0, C0, R1, C1, width, rows, cols);
    }

    switch (kind) {
      case '口字型':
        parts.push({ name: '外框', cells: ringCells(r0, c0, r1, c1, width, rows, cols) });
        break;

      case '田字格': {
        // 外框 + 十字分隔 → 视觉上是四个小口。parts 给出「四个小口各自的环」，
        // 这样用户可以只把左上那一口换色。
        // 中间十字保持**居中**加宽（它不贴边，两侧都该均匀变粗）。
        var mr = Math.floor((r0 + r1) / 2), mc = Math.floor((c0 + c1) / 2);
        parts.push({ name: '外框', cells: ringCells(r0, c0, r1, c1, width, rows, cols) });
        parts.push({
          name: '中间十字',
          cells: lineCells(mr, c0, mr, c1, width, rows, cols)
            .concat(lineCells(r0, mc, r1, mc, width, rows, cols))
        });
        parts.push({ name: '左上口', cells: ringCells(r0, c0, mr, mc, width, rows, cols) });
        parts.push({ name: '右上口', cells: ringCells(r0, mc, mr, c1, width, rows, cols) });
        parts.push({ name: '左下口', cells: ringCells(mr, c0, r1, mc, width, rows, cols) });
        parts.push({ name: '右下口', cells: ringCells(mr, mc, r1, c1, width, rows, cols) });
        break;
      }

      case '斜线型':
        // 主对角线。想要反斜线把 box 的左右反过来传即可，不再单列一种形态。
        parts.push({ name: '斜线', cells: lineCells(r0, c0, r1, c1, width, rows, cols) });
        break;

      case 'Z型':
        parts.push({ name: '上横', cells: edgeLine(r0, c0, r0, c1) });
        parts.push({ name: '斜段', cells: lineCells(r0, c1, r1, c0, width, rows, cols) });
        parts.push({ name: '下横', cells: edgeLine(r1, c0, r1, c1) });
        break;

      case 'L型':
        parts.push({ name: '竖段', cells: edgeLine(r0, c0, r1, c0) });
        parts.push({ name: '下横', cells: edgeLine(r1, c0, r1, c1) });
        break;

      case 'N型':
        parts.push({ name: '左竖', cells: edgeLine(r0, c0, r1, c0) });
        parts.push({ name: '斜段', cells: lineCells(r1, c0, r0, c1, width, rows, cols) });
        parts.push({ name: '右竖', cells: edgeLine(r0, c1, r1, c1) });
        break;

      default:
        throw new Error('未知的边框形态：' + kind + '（可用：' + BORDER_KINDS.join('/') + '）');
    }

    // 统一裁到 box 内。
    // 必须在这里裁而不是指望 lineCells 自己收敛：斜线的端点落在 box 角上时，
    // 垂直方向加宽必然溢出一圈（对角线 (r0,c0)→(r1,c1) 加宽 3 会产生 r0-1 行）。
    // 「边框严格落在你给的框内」是本函数对调用方的承诺 —— 用户要靠 box 精确控制边框范围，
    // 溢出一圈在界面上不显眼，但拼接时会顶到别的部件上。
    function inBox(x) {
      return x.r >= r0 && x.r <= r1 && x.c >= c0 && x.c <= c1;
    }
    parts.forEach(function (p) { p.cells = p.cells.filter(inBox); });

    // 汇总去重
    var seen = {}, cells = [];
    parts.forEach(function (p) {
      p.cells.forEach(function (x) {
        var k = x.r + ',' + x.c;
        if (seen[k]) return;
        seen[k] = 1; cells.push(x);
      });
    });
    return { kind: kind, cells: cells, parts: parts, box: { r0: r0, c0: c0, r1: r1, c1: c1 }, width: width };
  }

  /**
   * 对比两张像素矩阵：总量是否守恒、逐色差异、改动的像素坐标列表。
   * 不判定「是否合法关卡」（那需要调用生成器/求解器重构，属阶段二后续工作），
   * 这里只做最基础的「改了哪里、改成了什么、颜色总量对不对」的事实陈述。
   */
  function diffBlocks(before, after) {
    var rows = before.length, cols = before[0] ? before[0].length : 0;
    var changed = [];
    var sameSize = after.length === rows && (after[0] || []).length === cols;
    if (sameSize) {
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (before[r][c] !== after[r][c]) changed.push({ r: r, c: c, from: before[r][c], to: after[r][c] });
        }
      }
    }
    var cBefore = colorCounts(before), cAfter = colorCounts(after);
    var colors = {};
    Object.keys(cBefore).forEach(function (k) { colors[k] = true; });
    Object.keys(cAfter).forEach(function (k) { colors[k] = true; });
    var perColor = {};
    var totalBefore = 0, totalAfter = 0;
    Object.keys(colors).forEach(function (k) {
      var b = cBefore[k] || 0, a = cAfter[k] || 0;
      perColor[k] = { before: b, after: a, delta: a - b };
      totalBefore += b; totalAfter += a;
    });
    return {
      sameSize: sameSize,
      rows: rows, cols: cols,
      changedPixelCount: changed.length,
      changedPixels: changed,
      totalBefore: totalBefore, totalAfter: totalAfter,
      totalConserved: totalBefore === totalAfter,
      perColor: perColor
    };
  }

  /**
   * 任意来源的 level（可能是导入时已是官方格式——有 spools 无 board；也可能是工具内部格式——有
   * board 无 spools，例如重构结果 rr.level）→ 正式游戏端关卡文件（spools/toprow/maprow/mapcol）。
   * 已经是官方格式时原样返回（不重复转换）；是内部格式时转调正式 AntSolver.toGameFormat，不复制转换逻辑。
   * 用于待导出库/批量导出明确区分「正式游戏端关卡文件」与「工具内部无损数据」（需求 07.30 §七第5点）。
   */
  function toGameFormatLevel(level) {
    if (!level) return level;
    if (level.spools) return level;   // 已是官方格式（如从 348关工具导入包 直接导入的关卡文件）
    var A = AS();
    return A.toGameFormat(level);
  }

  // ==================== 生成器标准参数导入（需求 07.30 §五） ====================

  /**
   * 解析用户导入的生成器参数文件文本。兼容三种已知真实格式（均在项目里找到过实际样本）：
   *   ① 生产批次配置：{ "生成参数": {...} }（如 输出文件/*-07-29/生产文档/批次配置.json）
   *   ② 网页方案文件：{ "type":"antGenScheme", "config": {...} }（如 方案文件夹/方案_v91.json）
   *   ③ 纯参数对象：{ boxSizeMin, boxSizeMax, ... }（如 审核数据 *_审核.json 的 config 字段直接给出）
   * 也兼容 JSONC（允许 // 或 /* *\/ 注释，简单剔除后再 JSON.parse，不引入完整 JSONC 解析器依赖）。
   * 返回 { ok, raw, recognized:{}, unrecognized:[], source } 或 { ok:false, reason, detail }。
   * 字段识别以正式 Generator.DEFAULT_CONFIG 的键集合为白名单——这是「标准参数」的唯一权威定义，
   * 不在工具里另建一份字段清单，避免正式参数改了这里却忘了同步。
   */
  function parseGeneratorParamsFile(text) {
    var Gen = ASGen();
    var stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    var json;
    try { json = JSON.parse(stripped); }
    catch (e) { return { ok: false, reason: 'parseError', detail: 'JSON/JSONC 解析失败：' + (e && e.message) }; }
    var configObj = null, source = null;
    if (json && json['生成参数'] && typeof json['生成参数'] === 'object') { configObj = json['生成参数']; source = '生产批次配置（生成参数字段）'; }
    else if (json && json.config && typeof json.config === 'object') { configObj = json.config; source = '网页方案文件（config字段）'; }
    else if (json && typeof json === 'object' && !Array.isArray(json)) { configObj = json; source = '纯参数对象（顶层字段）'; }
    if (!configObj) return { ok: false, reason: 'noConfig', detail: '文件里找不到可识别的参数对象（既不是{生成参数:{...}}也不是{config:{...}}也不是纯参数对象）' };

    var whitelist = Object.keys(Gen.DEFAULT_CONFIG);
    var recognized = {}, unrecognized = [];
    Object.keys(configObj).forEach(function (k) {
      if (whitelist.indexOf(k) >= 0) recognized[k] = configObj[k];
      else unrecognized.push(k);
    });
    if (!Object.keys(recognized).length) {
      return { ok: false, reason: 'noRecognizedField', detail: '参数对象里没有任何字段匹配正式生成器的标准参数（Generator.DEFAULT_CONFIG）' };
    }
    return { ok: true, raw: configObj, recognized: recognized, unrecognized: unrecognized, source: source };
  }

  // ==================== 阶段6：三种守恒重构策略 ====================
  // 全部只调用正式生成器 bin/js/generator.js 已导出的公开函数（fillStructureFixed / buildConservationBaseline /
  // scanBoardActual / verifyConservation / structuralDeadlockCheck / pickBoxSplit / produceFixed 等），
  // 不复制任何生成算法、不改 bin/js。策略①③共用同一套「保留骨架重新填球」机制，
  // 差异只在【是否要求新旧目标图像素总数相同】；策略②直接调用完整生产总入口。

  // 辅助函数 extractStructFromBoard（从已有棋盘反推「结构骨架」供保骨架重填球用）已于 2026-07-31
  // 随策略①③一并删除：它只服务于那两个策略，删除后全工程零调用，属死代码。
  // 依据 Codex 审查 2026.07.31-03 的 P2-1 与用户裁决「删掉」。

  // 策略①「保障碍布局换色重配」与策略③「保结构重切盒」已于 2026-07-31 按需求
  // 07.31-关卡重构单策略与方案参数纠正 §三 移除：关卡修改完成后只使用「完全重新生成」。
  // 正式生成器 bin/js/generator.js 保留的公共能力未改动，只是本工具不再提供这两个入口与调用。

  /** 多轮玩家验证用的固定种子表（固定下来便于复现；首个仍是 7，与生产端口径一致）。 */
  var PLAYER_SEEDS = [7, 101, 2029, 33333, 65537];

  /**
   * 多轮随机种子玩家求解（需求 07.31 §六.3）。
   * 入参必须是【已 parseLevel 的关卡】——直接传未解析的 level 会让模拟空跑（totalBoxes/picks 全 0）。
   * 逐轮输出种子、是否通关、暂存峰值、复活次数/上限、完成盒数/总盒数，另给总通关率与均值。
   */
  function playerMultiRounds(parsed, opts) {
    var A = AS();
    if (!A.PlayerSim) return null;
    var bottomOnly = !!(opts && opts.bottomOnly);
    var rounds = [], wins = 0, peakSum = 0, revSum = 0;
    for (var i = 0; i < PLAYER_SEEDS.length; i++) {
      var sd = PLAYER_SEEDS[i], r = null;
      try {
        r = A.PlayerSim.run(parsed, { seed: sd, useItems: false, capturePreviewStats: true, bottomOnly: bottomOnly });
      } catch (e) { r = null; }
      if (!r) { rounds.push({ seed: sd, error: true }); continue; }
      if (r.won) wins++;
      peakSum += r.bufferPeak || 0;
      revSum += r.revivesUsed || 0;
      rounds.push({
        seed: sd, won: !!r.won, bufferPeak: r.bufferPeak || 0,
        revivesUsed: r.revivesUsed || 0, reviveCap: r.reviveCap != null ? r.reviveCap : 2,
        completedBoxes: r.completedBoxes || 0, totalBoxes: r.totalBoxes || 0,
        picks: r.picks || 0, ticks: r.ticks || 0,
        // 逐步暂存轨迹（需求 08.03 §一.4「玩家轨迹必须记录每步暂存数量」）。
        // 这两份都是正式玩家模拟【本来就返回】的真实数据，工具不另算：
        //   bufferTimeline —— 每一拍结束时暂存区里的球数，用来画玩家压力曲线；
        //   pressureSamples —— 每有球离场时的 {已完成盒数, 当时暂存数}，用来算玩家自己的卡点审核。
        bufferTimeline: r.bufferTimeline || [],
        pressureSamples: r.pressureSamples || []
      });
    }
    var okRounds = rounds.filter(function (x) { return !x.error; });
    return {
      roundCount: rounds.length, rounds: rounds,
      successRate: okRounds.length ? wins / okRounds.length : 0,
      avgPeak: okRounds.length ? Math.round(peakSum / okRounds.length * 10) / 10 : 0,
      avgRevives: okRounds.length ? Math.round(revSum / okRounds.length * 10) / 10 : 0
    };
  }

  /**
   * 玩家暂存压力曲线（需求 08.03 §一）。
   *
   * 与全知曲线的关系：两者是【两套各自真实的轨迹】，互不代替——
   *   全知曲线来自正式全知求解的消除顺序（pressureCurveFromTl）；
   *   玩家曲线来自正式玩家模拟真实操作过程中每一拍的暂存占用（本函数）。
   * 本函数不做任何模拟，只把玩家模拟已经返回的逐步数据整理成和全知曲线同一形状，便于同一张图复用。
   *
   * 横轴口径：玩家轨迹按【操作步数】（每一拍一个点），归一化到 0~1 便于与全知曲线共用画布；
   *   全知轨迹按【完成进度】。需求 §一.5 允许「操作进度或操作步数」，两者都会在图上标明。
   *
   * 无有效轨迹时返回 valid=false 并带原因，调用方必须显示「无有效玩家轨迹」，
   * 不得用全知数据补图，也不得画成一条 0 压力曲线（需求 §一.4 最后两条）。
   */
  function playerPressureCurve(round) {
    var empty = {
      points: [], peak: 0, avg: 0, totalBoxes: 0, bufferLimit: BUFFER_LIMIT,
      audit: null, officialSource: 'none', kind: 'player', valid: false, reason: '', xKind: 'step', steps: 0
    };
    if (!round) { empty.reason = 'noRound'; return empty; }
    if (round.error) { empty.reason = 'roundError'; empty.seed = round.seed; return empty; }
    var tl = round.bufferTimeline || [];
    if (!tl.length || !(round.picks > 0)) {
      empty.reason = !tl.length ? 'noTimeline' : 'noPicks';
      empty.seed = round.seed;
      return empty;
    }
    var points = [], sum = 0, peak = 0;
    var n = tl.length;
    for (var i = 0; i < n; i++) {
      var buf = tl[i] || 0;
      points.push({ step: i + 1, done: null, buf: buf, progress: n > 1 ? i / (n - 1) : 0 });
      sum += buf;
      if (buf > peak) peak = buf;
    }
    // 玩家自己的卡点审核：用玩家模拟真实产出的 pressureSamples 调正式审核函数，不复制其算法、不反推。
    var audit = null, officialSource = 'none';
    if (round.pressureSamples && round.pressureSamples.length && round.totalBoxes > 0) {
      var A = global.AntSolver;
      if (A && A.Analysis && A.Analysis.chokepointAudit) {
        try {
          audit = A.Analysis.chokepointAudit(round.pressureSamples, round.totalBoxes, BUFFER_LIMIT);
          officialSource = 'samples';
        } catch (e) { audit = null; officialSource = 'none'; }
      }
    }
    return {
      points: points, peak: peak, avg: +(sum / points.length).toFixed(2),
      totalBoxes: round.totalBoxes || 0, bufferLimit: BUFFER_LIMIT,
      audit: audit, officialSource: officialSource,
      kind: 'player', valid: true, reason: '', xKind: 'step', steps: n,
      seed: round.seed, won: !!round.won, picks: round.picks || 0,
      revivesUsed: round.revivesUsed || 0, reviveCap: round.reviveCap != null ? round.reviveCap : 2,
      completedBoxes: round.completedBoxes || 0
    };
  }

  /**
   * 去掉【单次玩家结果】里的大数组，只留待导出库与导出报告真正会读的字段。
   * 任务 ANT-ARTTOOL-FRAGMENT-QUOTA-20260825（用户 2026-08-25 报「攒够 5 个关卡就不能加入」）。
   *
   * 【为什么必须剥】实测：一条待导出库条目 ≈ 505 KB JSON 字符（localStorage 按 UTF-16 计费 ≈ 1.01 MB），
   *   其中 `tickTrajectory` 一项就占 464 KB（1681 条逐 tick 记录，占 92%）。6 条 ≈ 6.1 MB，
   *   越过 Chrome 每源约 5 MB 的 localStorage 上限 → `setItem` 抛 QuotaExceededError。
   *
   * 【这个大数组是哪来的】不是待导出库自己加的：`tickTrajectory` 是 v99 难度评分 v4
   *   （任务 ANT-DIFF-PLAYER-REVIVE-20260805）在 `playersim.js` 新增、由 `generator.js` 挂到
   *   `generationEval.player` 上的逐操作 tick 轨迹；工具的 `bin/js` 副本在 2026-08-12（v100）
   *   同步了那份代码，此后 `reconResult.playerOfficial` 就自带这份轨迹，而入库是原样存的。
   *   原有的 `stripPlayerTraces` 只处理 `playerMulti`，从不处理单次结果，也不认识 `tickTrajectory`。
   *
   * 【剥掉会不会影响导出】不会。批量导出对 `playerBefore`/`playerAfterOfficial` 只经
   *   `normalizePlayerResult` 取 4 个标量（won/peak/revives/reviveCap）；这些大数组唯一的去处是被
   *   整个 JSON.stringify 进 `求解与玩家结果/玩家结果对比.json`，报告与总清单一个字段都没读。
   *   2026-08-05 那批已交付导出里本来就没有 `tickTrajectory`（当时 afterOfficial 仅 6.3 KB）。
   *
   * 保留 `pressureSamples`（约 6 KB，压力曲线要用），剥掉 `tickTrajectory` / `bufferTimeline` /
   * `reviveEvents` / `frames` / `instantEvents` / `itemMarks` 这些逐步大数组。
   *
   * @param {object} p PlayerSim.run 结果 或 generationEval.player（两种字段名都兼容）
   * @returns {object|null} 剥掉大数组后的同结构对象；入参为空时返回 null
   */
  var PLAYER_HEAVY_KEYS = ['tickTrajectory', 'bufferTimeline', 'reviveEvents', 'frames', 'instantEvents', 'itemMarks'];
  function slimPlayerResult(p) {
    if (!p || typeof p !== 'object') return p || null;
    var out = {}, stripped = [];
    Object.keys(p).forEach(function (k) {
      if (PLAYER_HEAVY_KEYS.indexOf(k) >= 0) {
        if (p[k] && p[k].length) stripped.push(k + '(' + p[k].length + ')');
        return;
      }
      out[k] = p[k];
    });
    if (stripped.length) out.tracesStripped = stripped.join(',');
    return out;
  }

  /** 去掉多轮结果里的逐步轨迹，只留摘要——待导出库要存进浏览器本地，不能塞大数组。 */
  function stripPlayerTraces(multi) {
    if (!multi || !multi.rounds) return multi;
    return {
      roundCount: multi.roundCount, successRate: multi.successRate,
      avgPeak: multi.avgPeak, avgRevives: multi.avgRevives,
      tracesStripped: true,
      rounds: multi.rounds.map(function (x) {
        var o = {};
        Object.keys(x).forEach(function (k) {
          if (k === 'bufferTimeline' || k === 'pressureSamples') return;
          o[k] = x[k];
        });
        return o;
      })
    };
  }

  /**
   * 玩家模拟有效性前置检查（需求 07.31 §六.2）。
   * 任一条件不满足就判「玩家验证接口异常」，调用方必须停止并显示异常，
   * 不得把接口异常写成「0% 通关率」。
   */
  function playerSimHealthy(parsed, multi) {
    if (!parsed || !(parsed.totalBoxes > 0)) {
      return { ok: false, reason: 'parsedNoBoxes', detail: '解析后的关卡 totalBoxes = ' + (parsed && parsed.totalBoxes) + '，模拟无法推进' };
    }
    var anyPick = multi && multi.rounds && multi.rounds.some(function (x) { return !x.error && x.picks > 0; });
    if (!anyPick) {
      return { ok: false, reason: 'noPicks', detail: '所有轮次的取球次数均为 0，玩家模拟没有实际推进' };
    }
    return { ok: true };
  }

  /**
   * 唯一保留的重构策略：完全重新生成（需求 07.31 §三）。
   * 统一走正式公开入口 Generator.produce()（v95 默认分发到纠偏版），不再直接调内部 produceFixed，
   * 以保证与生成器网页端的正常生产入口完全一致（含 entryMode 标记与 generatorFlow 回退能力）。
   *
   * 玩家结果口径（需求 §六.1）：
   *   正式单次结果直接复用生成器内部 generationEval.player —— 它是在【已解析】关卡上跑的，本来就正确；
   *   多轮随机种子结果另外用 parseLevel(out.level) 再跑，不用未解析的 level 覆盖生成器的正确结果。
   */
  function reconstructFullRegenerate(newBlocks, config) {
    var Gen = ASGen();
    var A = AS();
    var cfg = Object.assign({}, Gen.DEFAULT_CONFIG, config || {}, { bufferLimit: BUFFER_LIMIT });
    var out = Gen.produce(newBlocks, cfg);
    if (!out || !out.valid) {
      return {
        ok: false, strategy: 'fullRegenerate',
        reason: (out && (out.lastFailReason || (out.structural && out.structural.reason))) || 'no_candidate',
        detail: (out && out.structural && out.structural.reason) || '',
        timedOut: !!(out && out.timedOut), elapsedMs: out && out.elapsedMs,
        effectiveConfig: (out && out.config) || cfg
      };
    }

    // 生成器内部已在 parsed 关卡上算好的正式玩家结果，直接采用（不再自己重跑覆盖）。
    var ge = out.generationEval || null;
    var playerOfficial = ge && ge.player ? ge.player : null;

    // 多轮随机种子：必须先 parseLevel，再交给 PlayerSim。
    var parsed = null;
    try { parsed = A.parseLevel(out.level); } catch (e) { parsed = null; }
    var playerMulti = parsed ? playerMultiRounds(parsed, { bottomOnly: !!cfg.bottomOnly }) : null;
    var health = playerSimHealthy(parsed, playerMulti);

    // 棋盘与最终黑块实况（需求 §五：报告需展示目标黑块 / 实际黑块 / 实际比例）
    var boardInfo = boardStatsOf(out.level);
    // 障碍参数目标 vs 实际 + 用户批准的浮动容差判定（Codex P1-3 → 用户裁决正式化）
    var obstacleInfo = obstacleCheckOf(out.level, out.config || cfg, out.obstacleSlots || null);

    return {
      ok: true, strategy: 'fullRegenerate', level: out.level, solveResult: out.solveResult,
      // out.audit 是生成器内部用真实 solveResult.pressureSamples 算好的 chokepointAudit（正式口径）。
      audit: out.audit || null,
      difficulty: out.difficulty,
      // 正式单次玩家结果（来自生成器内部，口径与生产一致）
      playerOfficial: playerOfficial,
      // 多轮随机种子玩家结果（逐轮明细 + 通关率 + 均值）
      playerMulti: playerMulti,
      // 玩家模拟是否真的跑起来了；ok=false 时调用方必须显示「玩家验证接口异常」而不是 0% 通关率
      playerHealth: health,
      board: boardInfo,
      // 障碍参数核对：逐项 目标/实际/偏差/是否在用户批准的浮动容差内
      obstacleCheck: obstacleInfo,
      entryMode: out.entryMode || null,
      flow: out.flow || null,
      retries: out.retries, elapsedMs: out.elapsedMs,
      effectiveConfig: out.config || cfg
    };
  }

  /**
   * 统计重构后关卡的棋盘实况：尺寸、各类格子数、最终黑块比例、形态是否合规。
   * 棋盘在 level.board = { rows, cols, cells }；注意 parseLevel 的 rows/cols 是【目标图】尺寸，不是棋盘尺寸。
   */
  function boardStatsOf(level) {
    var bd = (level && level.board) || {};
    var rows = bd.rows || 0, cols = bd.cols || 0, cells = bd.cells || [];
    var black = 0, pipe = 0, box = 0, empty = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var ce = cells[r] && cells[r][c];
        if (!ce) { empty++; continue; }
        if (ce.t === 'black') black++;
        else if (ce.t === 'pipe') pipe++;
        else if (ce.t === 'box') box++;
      }
    }
    var cap = rows * cols;
    var diff = cols - rows;
    return {
      rows: rows, cols: cols, capacity: cap,
      boxCells: box, blackCells: black, pipeCells: pipe, emptyCells: empty,
      blackPercent: cap ? Math.round(black / cap * 1000) / 10 : 0,
      shapeDiff: diff, shapeOk: diff >= 1 && diff <= 2
    };
  }

  // ==================== 障碍参数浮动容差（用户 2026-07-31 批准） ====================
  // 来源：Codex 审查 2026.07.31-03 的 P1-3 指出「黑块目标+5 个百分点」是 Kiro 自定容差、未获批准。
  // 用户裁决：「p1-3我批准可以加浮动兜底，包括其他障碍参数也可以浮动5%」。
  // 因此容差不是删除，而是【正式化】：成为用户批准的显式口径，并且必须把目标值、实际值、偏差、
  // 是否在容差内、容差来源一起显示出来，不允许再像以前那样悄悄用 target+5 判合格。
  //
  // 两类参数的换算（Kiro 决定并已在用户审批文件里标注，若与用户原意不符请更正）：
  //   百分比类（blackPercent / icePercent / questionPercent）：允许实际比例偏离目标 ±5 个百分点；
  //   计数类（chainCount 锁链组数）：3 组的 5% 只有 0.15 组，按百分点无意义，改用 ±1 组。
  var OBSTACLE_TOLERANCE_PP = 5;
  // 锁链容差：用户 2026-08-03 明确确认「锁链默认参数为 3，可以 ±1」，
  // 此前「按 5% 换算成 ±1 组」的说法作废，现在是用户直接确认的组数口径。
  var CHAIN_TOLERANCE_GROUPS = 1;
  var OBSTACLE_TOLERANCE_NOTE = '容差口径：百分比类障碍参数允许偏离目标 ±' + OBSTACLE_TOLERANCE_PP +
    ' 个百分点（用户 2026-07-31 批准）；锁链按组数计，目标 3 组时允许 ±' + CHAIN_TOLERANCE_GROUPS +
    ' 组（用户 2026-08-03 确认）。';

  /**
   * 核对重构后关卡的障碍参数「目标 vs 实际」，并按用户批准的浮动容差判定是否在允许范围内。
   *
   * 分母与正式生成器保持一致（bin/js/generator.js）：
   *   黑块 blackCount = floor(棋盘容量 × blackPercent/100)      → 分母 = 棋盘容量 rows×cols
   *   冰块 iceCount   = floor(棋盘盒格数 × icePercent/100)      → 分母 = 棋盘上 t==='box' 的格子数
   *   问号 qCount     = floor(棋盘盒格数 × questionPercent/100) → 同上
   *   锁链 totalChains = chainCount                             → 组数，不是比例
   * 管道队列里的盒只有 {color,count}，不带 ice/chain/q，故不计入冰块/问号分母（与生成器一致）。
   *
   * 锁链有一个必须分开算的口径（2026-07-31 定向核实 bin/js/generator.js 得到）：
   *   config.chainCount 只决定【普通锁链】的组数，组号从 1 递增；
   *   开启窄路时，每个窄路缺口会【额外】再加一组锁链，组号从 90 起（generator.js 里 `var ng = 90`）。
   * 所以窄路锁链不属于 chainCount 的配额。若把两者合起来数，chainCount=3 + 窄路缺口 2 个
   * 就会数出 5 组、看起来像超标，实际是正常设计。这里按组号 90 为界拆开，分别展示。
   */
  var NARROW_CHAIN_GROUP_BASE = 90;
  function obstacleCheckOf(level, cfg, slots) {
    var bd = (level && level.board) || {};
    var rows = bd.rows || 0, cols = bd.cols || 0, cells = bd.cells || [];
    var black = 0, box = 0, iceBox = 0, qBox = 0;
    var chainSet = {};
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var ce = cells[r] && cells[r][c];
        if (!ce) continue;
        if (ce.t === 'black') { black++; continue; }
        if (ce.t !== 'box') continue;
        box++;
        if (ce.ice > 0) iceBox++;
        if (ce.q) qBox++;
        if (ce.chain > 0) chainSet[ce.chain] = true;
      }
    }
    var cap = rows * cols;
    // 普通锁链（组号 < 90）才受 chainCount 约束；组号 ≥ 90 是窄路缺口额外加的，另算。
    var normalChains = 0, narrowChains = 0;
    Object.keys(chainSet).forEach(function (g) {
      if (Number(g) >= NARROW_CHAIN_GROUP_BASE) narrowChains++; else normalChains++;
    });
    cfg = cfg || {};

    // 窄路缺口冰与窄路锁链一样，是开启窄路后【额外】加的，不占 icePercent 配额
    // （generator.js：iceCount 按配额挑出 src='base'，之后另给缺口格加 src='narrowGap' 的冰）。
    // 最终关卡格子上只有 ice:3、没有 src，所以必须靠 produce 返回的 obstacleSlots.ice 来分辨。
    // 拿不到 slots 时不猜，如实标注「无法区分」，把两类冰合在一起报。
    var narrowIce = 0, iceSplitKnown = false;
    var iceSlots = slots && slots.ice;
    if (iceSlots && iceSlots.length) {
      iceSplitKnown = true;
      for (var si = 0; si < iceSlots.length; si++) {
        var s = iceSlots[si];
        if (s.src !== 'narrowGap') continue;
        var sc = cells[s.r] && cells[s.r][s.c];
        if (sc && sc.t === 'box' && sc.ice > 0) narrowIce++;   // 只数真正落地生效的
      }
    }
    var baseIce = Math.max(0, iceBox - narrowIce);

    function pct(n, d) { return d ? Math.round(n / d * 1000) / 10 : 0; }
    // judged=false 表示这一项本次拿不到可靠数据、不做合格判定（既不算通过也不算超标）。
    function percentItem(key, label, count, denom, denomLabel, judged, unjudgedReason) {
      var target = Number(cfg[key] || 0);
      var actual = pct(count, denom);
      var dev = Math.round((actual - target) * 10) / 10;
      return {
        key: key, label: label, kind: 'percent', denomLabel: denomLabel,
        target: target, actual: actual, actualCount: count, denom: denom,
        deviation: dev, tolerance: OBSTACLE_TOLERANCE_PP,
        judged: judged !== false,
        unjudgedReason: judged === false ? (unjudgedReason || '') : '',
        withinTolerance: judged === false ? null : (Math.abs(dev) <= OBSTACLE_TOLERANCE_PP)
      };
    }

    var items = [
      percentItem('blackPercent', '黑块', black, cap, '棋盘容量'),
      percentItem('icePercent',
        iceSplitKnown ? '冰块（按比例设定的部分）' : '冰块（含窄路缺口自带的，未分开）',
        iceSplitKnown ? baseIce : iceBox, box, '棋盘盒格数',
        iceSplitKnown,
        '本次生成结果没带上冰块的来源明细，无法把「按比例设定的冰块」和「窄路缺口自带的冰块」分开，' +
        '因此这一项不做合格判定——既不算通过也不算超标。'),
      percentItem('questionPercent', '问号', qBox, box, '棋盘盒格数')
    ];
    var chainTarget = Number(cfg.chainCount || 0);
    var chainDev = normalChains - chainTarget;
    items.push({
      key: 'chainCount', label: '锁链（不含窄路缺口自带的）', kind: 'count', denomLabel: '组数',
      target: chainTarget, actual: normalChains, actualCount: normalChains, denom: null,
      deviation: chainDev, tolerance: CHAIN_TOLERANCE_GROUPS, judged: true, unjudgedReason: '',
      withinTolerance: Math.abs(chainDev) <= CHAIN_TOLERANCE_GROUPS
    });

    // 实际值【低于】目标且超出容差时，补一句已知的正当原因，避免被当成缺陷误报。
    // 依据（只读核实 bin/js/generator.js）：生成器有一道「前几行障碍密度上限」的收尾约束，
    // 超上限时会按 问号 → 冰块 → 锁链组 的顺序在事后削减前几行的障碍，
    // 因此实际障碍量本来就可能低于按比例算出的目标值。这属于正式生成逻辑，不是本工具的统计错误。
    // 注意：这只是解释，不放宽判定——低于目标超出容差仍然如实判为超出容差。
    items.forEach(function (x) {
      x.belowNote = '';
      if (x.judged && x.withinTolerance === false && x.deviation < 0) {
        x.belowNote = '实际低于目标：生成器有「前几行障碍密度上限」的收尾约束，超上限时会按问号→冰块→锁链的顺序' +
          '削减前几行的障碍，所以实际量可能低于按比例算出的目标。这是正式生成逻辑的既有行为，不是统计错误；' +
          '但偏差确实超出了容差，仍按超出容差如实判定。';
      }
    });

    var out = items.filter(function (x) { return x.judged && x.withinTolerance === false; });
    var unjudged = items.filter(function (x) { return !x.judged; });

    // 整体状态三态（Codex 复审 2026.08.03 的 P1 + 用户 2026-08-03 批准）：
    //   旧行为只看「有没有已确认的超差项」，于是冰块无法判定时整体仍返回「在容差内」，
    //   容易被读成这一关障碍核对已经通过。现在把「存在未判定项」独立成一种状态：
    //   有超差 → 存在超出容差；无超差但有未判定 → 存在未判定项；全判完且都在容差内 → 全部在容差内。
    //   已判定项的结果原样保留，不重算。
    var overall, overallText, complete;
    if (out.length) {
      overall = 'outOfTolerance';
      overallText = '存在超出容差：' + out.map(function (x) { return x.label; }).join('、');
      complete = false;
    } else if (unjudged.length) {
      overall = 'hasUnjudged';
      overallText = '存在未判定项：' + unjudged.map(function (x) { return x.label; }).join('、');
      complete = false;
    } else {
      overall = 'allWithin';
      overallText = '全部在容差内';
      complete = true;
    }

    return {
      items: items,
      unjudged: unjudged.map(function (x) { return x.label; }),
      // 三态整体状态：'allWithin' | 'outOfTolerance' | 'hasUnjudged'
      overall: overall,
      // 中文整体结论，页面与报告直接用这一句，避免三处各写一套措辞
      overallText: overallText,
      // 是否算「完整通过障碍验收」：只有四项全部判定且全部在容差内才为真
      complete: complete,
      // 窄路额外障碍不受配额约束，只如实报数，不参与容差判定
      narrowChainGroups: narrowChains,
      narrowIceBoxes: iceSplitKnown ? narrowIce : null,
      iceSplitKnown: iceSplitKnown,
      totalIceBoxes: iceBox,
      narrowChainNote: '窄路自带的额外障碍（开启窄路后按缺口数量生成，不占你设定的配额，也不参与容差判定）：' +
        '锁链 ' + narrowChains + ' 组' +
        (iceSplitKnown
          ? ('，缺口冰块 ' + narrowIce + ' 个；棋盘上带冰的盒一共 ' + iceBox + ' 个，其中按比例设定的是 ' + baseIce + ' 个。')
          : ('；本次拿不到冰块的来源明细，冰块一项是两者合计，已标为不做判定。')),
      // allWithin 现在的含义已收紧：必须四项全判定且全在容差内。
      // 旧含义（只要没有已确认超差就为真）会让「冰块未判定」被显示成通过，已按 P1 纠正。
      allWithin: complete,
      outOfTolerance: out.map(function (x) { return x.label; }),
      tolerancePP: OBSTACLE_TOLERANCE_PP,
      toleranceChain: CHAIN_TOLERANCE_GROUPS,
      toleranceNote: OBSTACLE_TOLERANCE_NOTE
    };
  }

  global.ArtToolCore = {
    ICE_DURABILITY: ICE_DURABILITY,
    BUFFER_LIMIT: BUFFER_LIMIT,
    DEFAULT_BUDGET_MS: DEFAULT_BUDGET_MS,
    ROUTE_PASSES: ROUTE_PASSES,
    parseTxt: parseTxt,
    serializeTxt: serializeTxt,
    detectKind: detectKind,
    toInternal: toInternal,
    solveStandard: solveStandard,
    solveOnePass: solveOnePass,
    replay: replay,
    snapshotBoardBuffer: snapshotBoardBuffer,
    bufferSlotsArray: bufferSlotsArray,
    boardAtStep: boardAtStep,
    pixelsUpTo: pixelsUpTo,
    snapInterval: snapInterval,
    connectedComponents: connectedComponents,
    outlineSegments: outlineSegments,
    mergeRouteRegions: mergeRouteRegions,
    timelineFromSolveFilePickOrder: timelineFromSolveFilePickOrder,
    timelineFromSolveFile: timelineFromSolveFile,
    timelineFromReplay: timelineFromReplay,
    verifyTimeline: verifyTimeline,
    colorCounts: colorCounts,
    colorCountsInCells: colorCountsInCells,
    CLOSE_COLOR_PAIRS: CLOSE_COLOR_PAIRS,
    checkClosePairs: checkClosePairs,
    replaceColorInBlocks: replaceColorInBlocks,
    cellsInRect: cellsInRect,
    diffBlocks: diffBlocks,
    // ===== 主体提取：选区掩码层（任务 ANT-ARTTOOL-SUBJECT-EXTRACT-20260902）=====
    maskNew: maskNew,
    maskClone: maskClone,
    maskCount: maskCount,
    maskHas: maskHas,
    maskToIndices: maskToIndices,
    maskToCells: maskToCells,
    maskFromIndices: maskFromIndices,
    maskCombine: maskCombine,
    maskFromRect: maskFromRect,
    maskFromPolygon: maskFromPolygon,
    maskFromSameColorRegion: maskFromSameColorRegion,
    maskFromColor: maskFromColor,
    maskFromColorInRegion: maskFromColorInRegion,
    maskFromSmallComponents: maskFromSmallComponents,
    nonZeroComponents: nonZeroComponents,
    applyExtract: applyExtract,
    bboxOfBlocks: bboxOfBlocks,
    ART_PIECE_TYPE: ART_PIECE_TYPE,
    toArtPiece: toArtPiece,
    composeNewCanvas: composeNewCanvas,
    composeLayerType: composeLayerType,
    composeSortedLayers: composeSortedLayers,
    composeLayerPlacement: composeLayerPlacement,
    composeFlatten: composeFlatten,
    composeConflicts: composeConflicts,
    composeAudit: composeAudit,
    composeMergeLayers: composeMergeLayers,
    composeSubjectCells: composeSubjectCells,
    composeHaloBlocks: composeHaloBlocks,
    composeBackgroundBlocks: composeBackgroundBlocks,
    composeSeparatorBlocks: composeSeparatorBlocks,
    lineCells: lineCells,
    paintCells: paintCells,
    fillRegion: fillRegion,
    ringCells: ringCells,
    borderShape: borderShape,
    BORDER_KINDS: BORDER_KINDS,
    artPieceStats: artPieceStats,
    // 策略①③（reconstructKeepObstacles / reconstructKeepStructureResplit）与其专用辅助
    // extractStructFromBoard 已于 2026-07-31 移除，
    // 见需求 07.31-关卡重构单策略与方案参数纠正 §三。正式生成器的公共能力未改动。
    playerMultiRounds: playerMultiRounds,
    playerPressureCurve: playerPressureCurve,
    stripPlayerTraces: stripPlayerTraces,
    slimPlayerResult: slimPlayerResult,     // 单次玩家结果剥大数组（待导出库配额修复）
    PLAYER_HEAVY_KEYS: PLAYER_HEAVY_KEYS,
    playerSimHealthy: playerSimHealthy,
    boardStatsOf: boardStatsOf,
    OBSTACLE_TOLERANCE_PP: OBSTACLE_TOLERANCE_PP,
    CHAIN_TOLERANCE_GROUPS: CHAIN_TOLERANCE_GROUPS,
    OBSTACLE_TOLERANCE_NOTE: OBSTACLE_TOLERANCE_NOTE,
    obstacleCheckOf: obstacleCheckOf,
    reconstructFullRegenerate: reconstructFullRegenerate,
    pressureCurveFromTl: pressureCurveFromTl,
    regionCompare: regionCompare,
    reconstructToTimeline: reconstructToTimeline,
    officialPlayerResult: officialPlayerResult,
    playerMultiFromLevelFile: playerMultiFromLevelFile,
    parseGeneratorParamsFile: parseGeneratorParamsFile,
    toGameFormatLevel: toGameFormatLevel
  };
})(typeof self !== 'undefined' ? self : this);
