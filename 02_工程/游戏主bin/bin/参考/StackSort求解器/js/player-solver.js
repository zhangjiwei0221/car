/**
 * StackSort 求解器 - 玩家版（模拟真实玩家表现）
 *
 * 设计依据（与设计者确认的最终模型）：
 *   玩家**复用全知版的全部策略**（手牌路由 / 有效步 / 中转 / 5 个决策模式 / 分发），
 *   唯一区别 = 决策时**未揭示的问号(Surprise)色被屏蔽**（玩家看不见）。
 *
 *   · 问号 = "软障碍"：只是临时屏蔽颜色，不改变策略。
 *   · 硬障碍（冰块/石墙/保护列/锁定列）= 真正的目标与优先级，由全知版既有解法处理
 *     （完成可达色解冻冰块、把钥匙挤到列底解锁等）。
 *   · 因此【含问号的关一律把问号当作"无障碍"处理】：用 relaxUseful 放宽判据——所有可见(可达)色
 *     都是合法锁列目标，直接贪心锁列；问号只是让玩家偶尔看不见、降低成功率（这正是问号的难度信号），
 *     绝不为问号设计专门的"探路/挤压"动作。
 *   · 隐藏列（冰块/石墙/保护列）本就不可达、不参与路由 → 全知版行为已与玩家一致。
 *   · 双色块底层+顶层、锁定钥匙列、捆绑、限定色都是明牌，玩家可见。
 *   · 玩家不记牌、不推断隐藏色、不试错回溯：未知就是未知，直到卡被挤到列底/暂存区揭示
 *     （引擎自动剥离 Surprise）。多轮 multiSolve 仅用于统计成功率/平均步数，每轮内部都是单程推理。
 *
 * 实现：给 Solver.solveOnce 注入两个开关——
 *   observe=maskSurprise（每步把真实棋盘克隆成"玩家可见视图"，未揭示问号色置空）；
 *   relaxUseful=hasSurprise（含问号关放宽有用色判据）。move() 仍在真实棋盘执行。
 *
 * 入口：
 *   SS.PlayerSolver.solveOnce(state, seed, randomize, opts)  单次玩家通关模拟
 *   SS.PlayerSolver.multiSolve(state, runsPerMode)           多模式多轮 → {best, avg, successRate,...}
 */
var SS = SS || {};

SS.PlayerSolver = (function () {

  // 与 analysis.js / solver.js 的 DECISION_MODES 对齐（玩家同样会尝试不同打法找最优线）
  var MODES = [
    { name: 'gated', opts: { commitMode: 'gated' } },
    { name: 'always', opts: { commitMode: 'always' } },
    { name: 'dual', opts: { commitMode: 'gated', dualPriority: true } },
    { name: 'dualLk', opts: { commitMode: 'always', dualPriority: true } },
    { name: 'gatedX', opts: { commitMode: 'gated', expandTransit: true } }
  ];

  /**
   * 玩家可见视图：克隆真实状态，把【仍带 Surprise 特性（未揭示）】的卡片颜色置空。
   * 置空后 colorKeyOf 返回 null → 该卡不归属任何颜色（玩家只知道"那有张牌，但不知是什么色"），
   * 既不会被算进某色的"可达副本数"，也不会让某列被误判为接近完成。
   */
  function maskSurprise(state) {
    var ms = SS.Engine.cloneState(state);
    for (var c = 0; c < ms.colCount; c++) {
      var col = ms.columns[c];
      for (var i = 0; i < col.length; i++) {
        var cell = col[i];
        if (cell && cell.features && cell.features.indexOf('Surprise') !== -1) {
          cell.colorKey = null;      // 未知色
          cell.topColorKey = null;   // 双色块顶层（若有）一并屏蔽，保险
        }
      }
    }
    // 暂存区(手牌)在引擎里到达即揭示，正常不会带 Surprise；保险起见同样处理
    if (ms.bench && ms.bench.features && ms.bench.features.indexOf('Surprise') !== -1) {
      ms.bench.colorKey = null;
      ms.bench.topColorKey = null;
    }
    return ms;
  }

  // 是否存在高难度（锁颜色供给）的隐藏障碍：冰块/石墙/保护列/锁定列。与 solver.hasHiddenObstacle 一致。
  function hasHiddenObstacle(view) {
    var eng = SS.Engine;
    for (var c = 0; c < view.colCount; c++) {
      if (eng.isFrozen(view, c) || eng.isRockLocked(view, c)) return true;
      if (eng.isCovered && eng.isCovered(view, c)) return true;
      if (eng.keyLockedCol && eng.keyLockedCol(view, c)) return true;
    }
    return false;
  }

  // 关卡是否含问号（未揭示 Surprise 卡）
  function hasSurprise(state) {
    for (var c = 0; c < state.colCount; c++) {
      var col = state.columns[c];
      for (var i = 0; i < col.length; i++) {
        if (col[i] && col[i].features && col[i].features.indexOf('Surprise') !== -1) return true;
      }
    }
    return !!(state.bench && state.bench.features && state.bench.features.indexOf('Surprise') !== -1);
  }

  function assign(a, b) { for (var k in b) a[k] = b[k]; return a; }

  /**
   * 玩家版决策模式（按关卡类型生成；multiSolve 跑全量取最优 = 设计者"全量决策树取更好结果"）。
   *   · 非问号关 → 原 5 个全知模式，与全知版零偏差。
   *   · 含问号关 → 公共增强 pseudoWild(④)+antiJunkLoop(③)+expandTransit 全开（仅条件满足才触发，安全）：
   *       - 纯问号(无硬障碍) → 贪心锁列 relaxUseful（设计者①）。
   *       - 问号+硬障碍 → 障碍优先 squeezeUnknown（设计者②，严格判据+无块时挤压问号），
   *                       并附带贪心/双色块兜底，取最优。
   */
  function playerModes(state) {
    if (!hasSurprise(state)) return MODES;
    var hidden = hasHiddenObstacle(state);
    var base = { pseudoWild: true, antiJunkLoop: true, expandTransit: true };
    var modes = [];
    if (!hidden) {
      modes.push({ name: 'greedyG', opts: assign({ relaxUseful: true, commitMode: 'gated' }, base) });
      modes.push({ name: 'greedyA', opts: assign({ relaxUseful: true, commitMode: 'always' }, base) });
    } else {
      modes.push({ name: 'obstG', opts: assign({ squeezeUnknown: true, commitMode: 'gated' }, base) });
      modes.push({ name: 'obstA', opts: assign({ squeezeUnknown: true, commitMode: 'always' }, base) });
      modes.push({ name: 'greedyG', opts: assign({ relaxUseful: true, commitMode: 'gated' }, base) });
      modes.push({ name: 'greedyA', opts: assign({ relaxUseful: true, commitMode: 'always' }, base) });
      modes.push({ name: 'dualG', opts: assign({ relaxUseful: true, commitMode: 'gated', dualPriority: true }, base) });
    }
    return modes;
  }

  // 单次玩家通关模拟：复用全知版 solveOnce，注入屏蔽问号视图；策略开关由 opts(决策模式)携带。
  function solveOnce(state, seed, randomize, opts) {
    opts = opts || {};
    var merged = {};
    for (var k in opts) merged[k] = opts[k];
    merged.observe = maskSurprise;
    return SS.Solver.solveOnce(state, seed, randomize, merged);
  }

  /**
   * 多模式多轮玩家求解（口径与 SS.Analysis.multiSolve 一致，便于和全知版对比）。
   * 返回 { best, avg, successRate, solvedRuns, totalRuns }
   *   best        = 玩家能跑出的最少步数（熟练玩家最佳线的近似）
   *   avg         = 所有成功轮次平均步数（玩家实际效率）
   *   successRate = 成功通关轮次 / 总轮次（受问号不确定性拖累，是问号难度的核心信号）
   */
  function multiSolve(state, runsPerMode, maxMargin) {
    var R = runsPerMode || 12;
    var modes = playerModes(state);   // 按关卡类型取决策模式集（全量跑取最优）
    var best = Infinity, ok = 0, total = 0, allSteps = [];
    var byMode = {};
    // 平均步数剔除脏数据（对标余量步数 best+maxMargin）：优先用 Analysis.cleanAvg，缺失则回退普通均值
    function avgClean(steps, b) {
      if (!steps.length) return null;
      if (SS.Analysis && SS.Analysis.cleanAvg) return SS.Analysis.cleanAvg(steps, b, maxMargin).avg;
      var s = 0; for (var i = 0; i < steps.length; i++) s += steps[i]; return s / steps.length;
    }
    for (var m = 0; m < modes.length; m++) {
      var mOk = 0, mTotal = 0, mBest = Infinity, mSolved = [];
      for (var k = 0; k < R; k++) {
        var eps = k < Math.ceil(R / 3) ? 0 : Math.min((k - Math.ceil(R / 3) + 1) * 6, 66);
        var opt = { eps: eps };
        for (var key in modes[m].opts) opt[key] = modes[m].opts[key];
        var run = solveOnce(state, m * 104729 + k * 2654435761 + 1, k > 0, opt);
        total++; mTotal++;
        if (run.solved) {
          ok++; allSteps.push(run.moves.length);
          mOk++;
          mSolved.push(run.moves.length);     // 记录该成功线步数（供按步数阈值查通关率）
          if (run.moves.length < best) best = run.moves.length;
          if (run.moves.length < mBest) mBest = run.moves.length;
        }
      }
      byMode[modes[m].name] = {
        succ: mTotal ? mOk / mTotal : 0,
        best: mOk ? mBest : null,
        avg: mOk ? avgClean(mSolved, mBest) : null,   // 剔除脏数据后的均值
        solved: mSolved,                        // 各成功线步数数组（原始，供按步数阈值查通关率）
        total: mTotal
      };
    }
    // 最优模式成功率 = 熟练玩家选定最佳策略后的一次过率（难度信号用这个，而非全模式平均）
    var bestModeSucc = 0, bestModeName = null, bestModeAvg = null;
    var viableSum = 0, viableN = 0;
    for (var nm in byMode) {
      var bm = byMode[nm];
      if (bm.succ > 0) { viableSum += bm.succ; viableN++; }
      var better = bm.succ > bestModeSucc ||
        (bm.succ === bestModeSucc && bm.avg != null && (bestModeAvg == null || bm.avg < bestModeAvg));
      if (better) { bestModeSucc = bm.succ; bestModeName = nm; bestModeAvg = bm.avg; }
    }
    return {
      best: ok ? best : null,
      avg: ok ? avgClean(allSteps, best) : null,
      successRate: ok / total,
      solvedRuns: ok, totalRuns: total,
      byMode: byMode,
      bestModeSucc: bestModeSucc,
      bestModeName: bestModeName,
      bestModeAvg: bestModeAvg,
      meanModeSucc: viableN ? viableSum / viableN : 0
    };
  }

  /**
   * 玩家版"最优回放路径"：跑全量决策模式×多轮，返回最短通关的点击序列。
   * 用于模拟界面回放玩家真实通关过程（问号会随推进逐步揭示）。
   * 返回 { solved, moves:[colIdx...], steps, mode, successRate }
   */
  function solveBest(state, runsPerMode) {
    var R = runsPerMode || 12;
    var modes = playerModes(state);
    var best = null, ok = 0, total = 0;
    for (var m = 0; m < modes.length; m++) {
      for (var k = 0; k < R; k++) {
        var eps = k < Math.ceil(R / 3) ? 0 : Math.min((k - Math.ceil(R / 3) + 1) * 6, 66);
        var opt = { eps: eps };
        for (var key in modes[m].opts) opt[key] = modes[m].opts[key];
        var run = solveOnce(state, m * 104729 + k * 2654435761 + 1, k > 0, opt);
        total++;
        if (run.solved) {
          ok++;
          if (!best || run.moves.length < best.moves.length) {
            best = { moves: run.moves, steps: run.moves.length, mode: modes[m].name };
          }
        }
      }
    }
    return best
      ? { solved: true, moves: best.moves, steps: best.steps, mode: best.mode, successRate: ok / total }
      : { solved: false, moves: [], steps: 0, mode: null, successRate: 0 };
  }

  /**
   * 按步数阈值查"最优模式通关率"。
   * 关键性质：玩家决策不依赖剩余步数（路由只看牌面），所以"宽步数下跑出的成功线步数 N"是固定的；
   *   在步数上限 C 下的通关率 = 这些成功线里 N≤C 的比例。于是用一次 multiSolve(宽步数) 的结果(含 byMode.solved)，
   *   即可对任意候选步数 C 查出与"在 C 预算下重跑"完全一致的通关率（无需每个 C 都重跑玩家版）。
   * 用途：关卡生成器扫步数定难度时，廉价获得与审核端一致的"混合附加分"。
   */
  function bestModeSuccAt(multiResult, C) {
    var best = 0;
    var bm = multiResult && multiResult.byMode;
    for (var nm in bm) {
      var mb = bm[nm];
      if (!mb.total) continue;
      var cnt = 0;
      for (var i = 0; i < mb.solved.length; i++) if (mb.solved[i] <= C) cnt++;
      var rate = cnt / mb.total;
      if (rate > best) best = rate;
    }
    return best;
  }

  return {
    MODES: MODES,
    maskSurprise: maskSurprise,
    hasHiddenObstacle: hasHiddenObstacle,
    hasSurprise: hasSurprise,
    bestModeSuccAt: bestModeSuccAt,
    solveOnce: solveOnce,
    solveBest: solveBest,
    multiSolve: multiSolve
  };
})();
