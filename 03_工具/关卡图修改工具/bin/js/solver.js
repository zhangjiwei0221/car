/**
 * 蚂蚁拿块求解器 - 核心模拟循环 + 多轮重试编排
 *
 * 本文件只负责【求解流程骨架】：建状态 → 逐步取盒(调用策略选步) → 判胜负/暂存溢出/道具救场 → 汇总结果，
 * 以及 solve() 的【多轮带噪声重试 + 时间预算封顶】编排。
 *
 * 【搜索策略已拆分】到 `solver-strategy.js`(AntSolver.SolverStrategy)：前瞻深度、N 步前瞻树、
 *   evaluateMove 启发式评分、cloneState 均在那里，便于单独检查与重写(替换成更贴合蚂蚁拿块的策略)。
 *   本文件通过 SolverStrategy.chooseLookahead / pickBestMove 两个接口对接，不关心策略内部实现。
 *
 * 消除匹配：四方向 flood-fill 扩展(见 simulator.floodFillEliminate)。
 */

var AntSolver = AntSolver || {};

AntSolver.Solver = (function() {

  /* ── 性能埋点(阶段1，只计数不改策略) ─────────────────────────────
   * 记录真实发生的求解开销，供生产性能报告回答"慢在哪"。
   * 纯累加计数器 + 计时，不参与任何选盒/胜负/预算判定，行为完全等价。
   * 用法：外部(generator.produce)先 resetPerf()，跑完 getPerf() 取快照。
   */
  var PERF = { solveCalls: 0, greedyRuns: 0, treeRuns: 0, solveMs: 0 };
  function resetPerf() { PERF = { solveCalls: 0, greedyRuns: 0, treeRuns: 0, solveMs: 0 }; }
  function getPerf() { return { solveCalls: PERF.solveCalls, greedyRuns: PERF.greedyRuns, treeRuns: PERF.treeRuns, solveMs: PERF.solveMs }; }

  /**
   * 主求解入口
   * @param {object} level - 解析后的关卡数据
   * @returns {object} 求解结果
   */
  /**
   * 求解编排（6 遍，任一遍通关即停）：【贪心×2 → 分支(3步树)×2 → 噪声(贪心)×2】。
   * - 前 2 遍贪心快、抓易解（第1遍确定性）；不行再 2 遍确定性/扰动的 3 步前瞻树(强)；仍不行 2 遍噪声随机重启兜底。
   * - 三类策略互补：贪心快、树能解贪心+噪声解不出的关、噪声能救树差一点的关 → 命中最大化。
   * - opts.greedyOnly=true：跳过 2 遍树（只贪心×2 + 噪声×2，共4遍）；opts.timeBudgetMs：总时间预算封顶；opts.lookahead：树深度覆盖。
   * retryRound 语义：0/'g2'=贪心；'tree'/'tree2'=3步树；'n1'/'n2'=噪声；未通关不设。
   */
  function solve(level, opts) {
    opts = opts || {};
    var startTime = Date.now();
    var bottomOnly = !!opts.bottomOnly;
    // 第三种玩法模式：四方向瞬时连锁消除（需求 08.03）。与 bottomOnly 互斥，固定四方向可达。
    // 必须与本关的候选筛选、卡点重求解、玩家模拟、审核取同一值，否则出现口径分裂。
    var instantChain = !!opts.instantChain;
    var greedyOnly = !!opts.greedyOnly;
    var timeBudgetMs = opts.timeBudgetMs != null ? opts.timeBudgetMs : Infinity;
    var baseOpts = { capturePreviewStats: !!opts.capturePreviewStats, lookahead: opts.lookahead, instantChain: instantChain };
    PERF.solveCalls++;                                   // 埋点：solve() 调用次数
    function greedyRun(noise, seed) { PERF.greedyRuns++; var o = {}; for (var k in baseOpts) o[k] = baseOpts[k]; o.mode = 'greedy'; return runSolver(level, noise, seed, false, bottomOnly, o); }
    function treeRun(noise, seed) { PERF.treeRuns++; var o = {}; for (var k in baseOpts) o[k] = baseOpts[k]; o.mode = 'tree'; return runSolver(level, noise, seed, false, bottomOnly, o); }
    function fin(r, tag) { r.time = Date.now() - startTime; r.retryRound = tag; PERF.solveMs += r.time; return r; }
    var best = null;
    function consider(r) { if (!best || r.eliminatedPixels > best.eliminatedPixels) best = r; }
    function budgetLeft() { return Date.now() - startTime < timeBudgetMs; }

    // ① 贪心×2（第1遍确定性，第2遍轻噪声重启）
    var r = greedyRun(0, 1); if (r.completed) return fin(r, 0); consider(r);
    r = greedyRun(0.6, 53); if (r.completed) return fin(r, 'g2'); consider(r);
    // ② 分支(3步前瞻树)×2（第1遍确定性，第2遍扰动）——greedyOnly 跳过
    if (!greedyOnly && budgetLeft()) { r = treeRun(0, 1); if (r.completed) return fin(r, 'tree'); consider(r); }
    if (!greedyOnly && budgetLeft()) { r = treeRun(0.8, 29); if (r.completed) return fin(r, 'tree2'); consider(r); }
    // ③ 噪声(贪心随机重启)×2
    if (budgetLeft()) { r = greedyRun(1.0, 211); if (r.completed) return fin(r, 'n1'); consider(r); }
    if (budgetLeft()) { r = greedyRun(1.5, 401); if (r.completed) return fin(r, 'n2'); consider(r); }

    best.time = Date.now() - startTime;
    PERF.solveMs += best.time;                           // 埋点：累计求解耗时(未通关分支)
    return best;
  }

  /**
   * 底部专用求解模块：只能从底部开始拿块（上/左/右三面封闭），其余逻辑不变。
   * 蚂蚁只从底部进入向上挖 → 可达从底部行播种、底部行盒天然暴露。
   */
  function solveBottom(level) { return solve(level, { bottomOnly: true }); }

  /**
   * 四方向瞬时连锁消除专用求解入口（第三种玩法模式，需求 08.03）。
   * 与 solve() 的区别只在消除结算口径：每轮快照当前可达同色全集 → 按离订单起点距离近优先 →
   * 消到订单剩余容量为止 → 目标图整体刷新后再重扫。选盒策略、前瞻深度、噪声重启轮次完全复用。
   */
  function solveInstantChain(level, opts) {
    var o = {};
    for (var k in (opts || {})) o[k] = opts[k];
    o.instantChain = true;
    o.bottomOnly = false;   // 本模式固定四方向，不接受底部单入口
    return solve(level, o);
  }

  /**
   * 单轮求解器（3步前瞻）
   */
  function runSolver(level, noise, seed, useItems, bottomOnly, opts) {
    opts = opts || {};
    // 前瞻深度由【策略模块】决定(自适应 3/2/1，opts.lookahead 可覆盖)。
    var LOOKAHEAD = AntSolver.SolverStrategy.chooseLookahead(level, opts);

    var BUFFER_LIMIT = level.bufferLimit || 5;

    // 伪随机数生成器
    var _rngState = (seed || 1) >>> 0;
    function rng() {
      _rngState = (_rngState * 1664525 + 1013904223) & 0xFFFFFFFF;
      return (_rngState >>> 0) / 4294967296;
    }

    // 初始化状态
    // 与手动游玩一致：用"起点距离优先"消除口径搜索，保证 valid = 真机规则下可解。
    var state = AntSolver.Simulator.createState(level, {
      useSlotStart: true,
      bottomOnly: !!bottomOnly,
      // 瞬时连锁模式：结算改走快照批次口径（createState 内部会强制关掉 bottomOnly）。
      // 起点逻辑本来就有（useSlotStart:true → 槽位映射起点），本模式沿用同一套，不新造第二种起点定义。
      instantChain: !!opts.instantChain,
      capturePreviewStats: !!opts.capturePreviewStats
    });

    var pickOrder = [];
    var stepStats = [];              // v112：每 pick 一条，见下方 push 处注释
    var stepBufferHistory = [];
    var maxSteps = state.totalBoxes + 50; // 安全上限
    var itemUses = 0, itemMarks = [], itemCap = (state.totalBoxes || 0) + 5;

    // 道具绕过常规 process/autoRelease 时，仍与普通完成样本采用同一封锁快照口径。
    function recordItemPressure() {
      if (!state.pressureSamples) return;
      var sample = { done: state.completedBoxes, buf: state.buffer.length };
      if (state.capturePreviewStats) {
        var preview = AntSolver.Simulator.previewNextEliminationOrder(state);
        sample.nextSlot = preview.slot;
        sample.reachable = preview.reachable;
        sample.locked = preview.lockedCount;
        sample.remaining = preview.remaining;
        sample.lockRatio = preview.stats.lockRatio;
      }
      state.pressureSamples.push(sample);
    }

    // 消除道具救场(opt-in)：选进度最低的暂存球，忽略可达性、按最底最左直取其色剩余像素并离场。
    function useItemOmni() {
      if (!state.buffer.length) return false;
      var ti = 0;
      for (var i = 1; i < state.buffer.length; i++) {
        var a = state.buffer[i], b = state.buffer[ti];
        if (a.progress < b.progress || (a.progress === b.progress && a.progress / a.need < b.progress / b.need)) ti = i;
      }
      var t = state.buffer[ti], remaining = t.need - t.progress, got = 0;
      for (var r = state.rows - 1; r >= 0 && got < remaining; r--)
        for (var c = 0; c < state.cols && got < remaining; c++)
          if (!state.eliminated[r][c] && state.blocks[r][c] === t.color) { state.eliminated[r][c] = true; state.eliminatedPixels++; got++; }
      state.buffer.splice(ti, 1); state.completedBoxes++;
      recordItemPressure();
      itemUses++; itemMarks.push({ done: state.completedBoxes });
      return true;
    }

    // 主循环
    while (!state.gameOver && state.steps < maxSteps) {
      var moves = AntSolver.Simulator.listMoves(state);
      if (moves.length === 0) {
        if (useItems && itemUses < itemCap && useItemOmni()) {
          if (state.eliminatedPixels >= state.totalPixels) { state.gameWon = true; state.gameOver = true; }
          continue;
        }
        break;
      }

      // 选步交给【策略模块】：mode='greedy'(快·单步) 或 'tree'(3步前瞻)；noise 供随机重启。
      var bestMove = AntSolver.SolverStrategy.pickBestMove(state, moves, { mode: opts.mode, lookahead: LOOKAHEAD, noise: noise, rng: rng });

      if (!bestMove) {
        // 策略未选出(通常=全被暂存阻塞)：兜底选第一个未blocked的
        for (var m = 0; m < moves.length; m++) {
          if (!moves[m].blocked) { bestMove = moves[m]; break; }
        }
        if (!bestMove) {
          // 全被暂存阻塞 → 道具救场(opt-in)：消掉进度最低的球腾位，否则无路可走
          if (useItems && itemUses < itemCap && useItemOmni()) {
            if (state.eliminatedPixels >= state.totalPixels) { state.gameWon = true; state.gameOver = true; }
            continue;
          }
          break;
        }
      }

      // 执行选中的操作
      AntSolver.Simulator.applyPick(state, bestMove.r, bestMove.c);
      // ===== 求解路线记录（v112，任务 ANT-SOLVER-CHAIN-PICKORDER-20260827）=====
      // 用户 2026-08-27 裁决「方案A」：**一条记录 = 一个盒**，同一次 pick 的成员共享同一 step。
      //
      // 改前的缺陷：这里只 push 一条（用 bestMove.r/c 与 bestMove.antBox），而锁链 2/3 连是
      // 整组一起离场、一起进暂存的，另外 1~2 个成员**零记录**，且该步 count 只记触发盒球数。
      // 实测 v110 底部 49 关批次：127 组里 126 组只有 1 个成员有步号，缺 168 条；
      // 3 连组实际 139 球只记 47。并且 app.js 的「pickOrder.length === totalBoxes」门槛
      // 对含锁链的关卡恒为假 → 消除序号视图静默退回机械左→右序（46/46 关中招）。
      //
      // applyPick 已把本步实际离场的格子记进 state.lastPick.picked（[0] 必为触发盒），
      // 这里逐盒展开。于此 pickOrder.length === totalBoxes 重新成立。
      // 【回放注意】同 step 的第 2/3 条不要再调 pickBox —— 整组在触发盒那次就已离场。
      var lp = state.lastPick;
      if (lp && lp.picked && lp.picked.length) {
        for (var bx = 0; bx < lp.picked.length; bx++) {
          var pk = lp.picked[bx];
          pickOrder.push({
            step: state.steps,
            r: pk.r, c: pk.c,
            color: pk.color, count: pk.count,
            chain: lp.chain || 0,          // 锁链组 ID（0 = 非锁链）
            chainSize: lp.boxes,           // 这一步共取几盒（1/2/3）
            chainIndex: bx                 // 组内序号，0 = 触发盒（回放按它调 pickBox）
          });
        }
        // 每 pick 一条：盒数与暂存三态。用户第 1 点要的「暂存初始进入状态」= bufEnter，
        // 它是整组入场后、autoRelease 结算前的占用（例：暂存 2 + 2 连盒 → bufEnter=4）。
        // 该值在内核里正是 overflow 的判定依据，以前判完即被结算抹掉、从未记录。
        stepStats.push({
          step: state.steps,
          boxes: lp.boxes,                 // 用户第 2 点：步数是 pick，盒数含锁链 → 1 步可 2/3 盒
          bufBefore: lp.bufBefore,
          bufEnter: lp.bufEnter,
          bufAfter: lp.bufAfter,
          isChain: !!lp.isChain
        });
      } else {
        // 兜底：拿不到快照时退回旧口径的单条记录，不静默丢步
        pickOrder.push({
          step: state.steps, r: bestMove.r, c: bestMove.c,
          color: bestMove.antBox.color, count: bestMove.antBox.count,
          chain: 0, chainSize: 1, chainIndex: 0
        });
        stepStats.push({
          step: state.steps, boxes: 1,
          bufBefore: null, bufEnter: null, bufAfter: state.buffer.length, isChain: false
        });
      }
      stepBufferHistory.push(state.buffer.length);   // 口径不变：结算后的占用

      // 检查胜负
      if (state.eliminatedPixels >= state.totalPixels) {
        state.gameWon = true;
        state.gameOver = true;
      }
      // 暂存瞬时超上限（含锁链整组入场即超）→ 死亡。严格执行，不可通关。道具也救不了瞬时溢出。
      if (!state.gameWon && state.overflow) {
        state.gameOver = true;
        state.gameWon = false;
      }
      if (!state.gameWon && !state.gameOver && state.buffer.length > BUFFER_LIMIT) {
        AntSolver.Simulator.autoReleaseBuffer(state);
        // 溢出 → 道具救场(opt-in)：连续消掉进度最低的球直到不超上限
        while (state.buffer.length > BUFFER_LIMIT && useItems && itemUses < itemCap && useItemOmni()) {
          AntSolver.Simulator.autoReleaseBuffer(state);
        }
        if (state.buffer.length > BUFFER_LIMIT) {
          state.gameOver = true;
          state.gameWon = false;
        }
      }
    }

    var progress = state.totalPixels > 0 ? Math.round(state.eliminatedPixels / state.totalPixels * 100) : 0;

    return {
      completed: state.gameWon,
      steps: state.steps,
      eliminatedPixels: state.eliminatedPixels,
      totalPixels: state.totalPixels,
      completedBoxes: state.completedBoxes,
      totalBoxes: state.totalBoxes,
      maxBuffer: Math.max.apply(null, stepBufferHistory.concat([0])),
      avgBuffer: stepBufferHistory.length > 0 ? (stepBufferHistory.reduce(function(a,b){return a+b;},0) / stepBufferHistory.length).toFixed(2) : 0,
      avgResidence: state.resCount > 0 ? +(state.resSum / state.resCount).toFixed(2) : 0, // 平均滞留(球入场→消除的步数)
      progress: progress,
      pickOrder: pickOrder,                          // v112：一条 = 一个盒，同 pick 共享 step
      stepStats: stepStats,                          // v112：每 pick 一条 {step,boxes,bufBefore,bufEnter,bufAfter,isChain}
      stepBufferHistory: stepBufferHistory,          // 口径不变：每 pick 结算后的暂存占用
      pressureSamples: state.pressureSamples || [], // 每完成一个球的暂存压力样本
      itemUses: itemUses, itemMarks: itemMarks       // 消除道具使用次数与位置(opt-in)
    };
  }

  return {
    solve: solve,
    runSolver: runSolver,
    solveBottom: solveBottom,
    solveInstantChain: solveInstantChain,   // 第三种玩法模式：四方向瞬时连锁消除（需求 08.03）
    resetPerf: resetPerf,      // 性能埋点(阶段1)：外部重置/读取，不影响求解行为
    getPerf: getPerf
  };
})();
