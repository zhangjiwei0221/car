/**
 * 蚂蚁拿块求解器 - 难度评分与批量分析模块
 *
 * 复用 StackSort《难度评分体系.md》的口径，适配蚂蚁拿块的核心机制：
 * - StackSort 的"步数压力"→ 蚂蚁拿块的"暂存区压力"（buffer 是本作唯一的失败源，等价于步数容错）。
 * - StackSort 的"行数项"→ 蚂蚁拿块的"规模/消除深度"（棋盘越大、消除层数越深，容错越低）。
 * - "障碍项 / 求解表现项 / 问号加分 / 混合附加分" 与 StackSort 保持同一设计。
 *
 * 难度分 = 障碍×0.30 + 暂存压力×0.28 + 求解表现×0.20 + 规模深度×0.22
 * （无求解表现数据时按三项归一：障碍×0.42 + 暂存压力×0.36 + 规模深度×0.22）
 *
 * 问号(软障碍)：不改变可解性（求解器全知真实颜色），只屏蔽玩家可见颜色 → 按【数量分档】单独加分。
 * 混合障碍关(障碍种类>1)：用多轮求解成功率追加"混合附加分"（组合难度无法纯解析加权）。
 */

var AntSolver = AntSolver || {};

AntSolver.Analysis = (function() {

  // ---- 障碍中文命名 ----
  var OBS_CN = {
    ice: '冰块', black: '黑块', chain: '锁链', question: '问号', pipe: '管道'
  };
  // 障碍分级：软(问号) / 硬(冰块·黑块·锁链·管道，改变可达拓扑或需前置解锁)
  var OBS_HARD = { ice: 1, black: 1, chain: 1, pipe: 1 };
  var OBS_SOFT = { question: 1 };

  // 障碍基础权重（每单位；锁链按"对"计）
  var OBS_W = { ice: 6, black: 5, chain: 9, pipe: 7 };

  // ===== 难度评分体系 v4（f1玩家平均暂存 / f2玩家平均滞留 / f3障碍低权重 + 复活加成；玩家须通关才出正式排序分）=====
  // 归一化上限：本轮【暂不调整】（需求 2026-08-05 §2.2 明确保留），先取得新公式下的完整数据分布，
  //   是否改 cap 由用户按 348 关实验报告另行决定。f1≤2.5、f2≤7、f3≤200 沿用 55×55 批的旧标定。
  // ⚠ 已知风险（如实记录，待数据裁决）：
  //   ① f2 由【全知滞留】换成【玩家滞留】，玩家非最优、滞留普遍更长，cap 仍为 7 可能大面积封顶而失去分辨力；
  //   ② f1 权重升到 0.65 而 cap 仍为 2.5，v99 瞬时连锁本身压低暂存，分数可能整体偏低。
  //   两项均在需求 §8.8 要求的封顶比例报告中体现。
  // v5（2026-08-05，任务 ANT-DIFF-V5-SCALEFREE-20260805）重标定：
  //   f1: 2.5 → 3.5 —— 3.5 就是高压阈值(bufferLimit−1.5)，含义是「平均暂存摸到高压线即满分」。
  //       v4 的 2.5 只等于暂存上限的一半，把正常运行区间当成了天花板：四方向实测平均暂存
  //       1.69~3.26（中位 2.56、占上限 51%），在 cap=2.5 下 54% 的关直接封顶。
  //   f2: 7 → 0.06，且**语义从「原始滞留步数」改为「无量纲占比 = 滞留 ÷ 有效操作步」**。
  //       根因：「操作 tick」在不同玩法下不是同一量级——四方向一个 tick 是「各球各吃 1 像素的一轮」
  //       (有效操作步中位 1743)，瞬时连锁一个 tick 是「取盒 + 完整结算」(26~87)。
  //       原始滞留两批中位相差 63 倍（80.3 vs 1.27），单一 cap 不可能同时服务，
  //       实测 v4 下四方向 f2 封顶 63/63、恒吃满 25 分，完全丧失分辨力。
  //       改占比后两批中位只差 2.03 倍，口径统一（「÷盒数」实测仍差 63.81 倍，已排除）。
  //       cap=0.06 ≈ 两批合并 411 关占比分布的 p99(0.0592)，封顶合计 5/411 = 1.2%。
  //   f3: **不变**。用户裁定 f3 表现正常——该批障碍参数一致，f3 近似常数是预期结果而非缺陷。
  var DIFF_CAP = { f1: 3.5, f2: 0.06, f3: 200 };
  // v4 历史上限（仅供回溯，不参与计算）：{ f1:2.5, f2:7(原始滞留步数), f3:200 }
  var DIFF_CAP_V4 = { f1: 2.5, f2: 7, f3: 200 };
  // 三因子权重（求和=1）：f1玩家平均暂存 · f2玩家平均滞留 · f3基础障碍(低权重)
  // v4 变更：删除 f4（全知-玩家偏移），其原 0.20 权重【全部】转给 f1（0.45 → 0.65）。
  var DIFF_W = { f1: 0.65, f2: 0.25, f3: 0.10 };
  // v3 历史权重（仅供对照/回溯，不参与计算）：{ f1:0.45, f2:0.25, f3:0.10, f4:0.20 }，f4 cap 曾为 1.5。
  var DIFF_W_V3 = { f1: 0.45, f2: 0.25, f3: 0.10, f4: 0.20 };

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // 规范化障碍类型（数字/字符串 → 统一 key）
  function normObsType(t) {
    if (t === 4 || t === 'ice') return 'ice';
    if (t === -1 || t === 'black') return 'black';
    if (t === 5 || t === 'chain') return 'chain';
    if (t === 6 || t === 'question') return 'question';
    if (t === 'pipe') return 'pipe';
    return String(t);
  }

  /**
   * 统计关卡障碍数量（从棋盘 cells 读取）。锁链两格算一对（÷2）。
   * @returns {object} { ice, black, chain(对数), question, pipe }
   */
  function obstacleStats(level) {
    var counts = {};
    var board = level.board;
    if (board && board.cells) {
      var chainIds = {};
      for (var r = 0; r < board.rows; r++) {
        for (var c = 0; c < board.cols; c++) {
          var cell = board.cells[r][c];
          if (!cell) continue;
          if (cell.t === 'black') counts.black = (counts.black || 0) + 1;
          else if (cell.t === 'pipe') counts.pipe = (counts.pipe || 0) + 1;
          else if (cell.t === 'box') {
            if (cell.ice > 0) counts.ice = (counts.ice || 0) + 1;
            if (cell.q) counts.question = (counts.question || 0) + 1;
            if (cell.chain > 0) chainIds[cell.chain] = 1;
          }
        }
      }
      var ng = Object.keys(chainIds).length;
      if (ng > 0) counts.chain = ng; // 锁链组数(每组2或3连)
    } else if (level.obstacles) {
      // 兼容旧格式（障碍在 obstacles 数组）
      for (var i = 0; i < level.obstacles.length; i++) {
        var t = normObsType(level.obstacles[i].type);
        counts[t] = (counts[t] || 0) + 1;
      }
      if (counts.chain) counts.chain = Math.round(counts.chain / 2);
    }
    return counts;
  }

  // 出现的障碍种类 key 列表（数量>0）
  function obstacleKinds(counts) {
    return Object.keys(counts).filter(function(k) { return counts[k] > 0; });
  }

  function obstacleNamesCN(counts) {
    var keys = obstacleKinds(counts);
    if (!keys.length) return '无';
    return keys.map(function(k) { return (OBS_CN[k] || k) + '×' + counts[k]; }).join(' ');
  }

  // 障碍分级标签（硬/软 · 单一/组合）
  function obsLevelTag(counts) {
    var keys = obstacleKinds(counts);
    if (!keys.length) return '无';
    var hard = keys.some(function(k) { return OBS_HARD[k]; });
    var tier = hard ? '硬' : '软';
    var combo = keys.length > 1 ? '组合' : '单一';
    return tier + '·' + combo;
  }

  function gradeOf(s) {
    if (s < 31) return '简单';   // 0-30
    if (s < 61) return '普通';   // 31-60
    if (s < 81) return '困难';   // 61-80
    return '极难';               // 81-100
  }

  /**
   * 计算消除层数（从边界向内BFS分层），反映消除深度。
   */
  function eliminationLayers(level) {
    if (AntSolver.Generator && AntSolver.Generator.analyzeEliminationLayers) {
      var info = AntSolver.Generator.analyzeEliminationLayers(level.blocks, level.rows, level.cols);
      return info.maxLayer;
    }
    return 0;
  }

  // 障碍强度 → 三级(±5%/级)标定档：轻/中/重/极重 相对基线的有符号档 tier∈[-3,+3]。
  // f3 低权重：只对主分做 ±5%×tier 的"增压/减压"微调（不占主权重）。
  function obstacleTier(counts) {
    var raw = 0;
    ['ice','black','chain','pipe'].forEach(function(k){ raw += (OBS_W[k]||4) * (counts[k]||0); });
    // 基线 ~120（55×55 基础参数典型障碍量）；每 ±40 一档，clamp[-3,3]
    var tier = Math.round((raw - 120) / 40);
    return Math.max(-3, Math.min(3, tier));
  }

  /**
   * 难度评分 v3（f1玩家平均暂存 · f2全知平均滞留 · f3障碍低权重 · f4全知-玩家偏移 + 复活加成；玩家须通关才合格）
   *   f1 = 玩家平均暂存 / 2.5   (占位 65%；玩家版、按【有效操作 tick】的结算后暂存平均)
   *   f2 = 玩家平均滞留 / 7     (占位 25%；v4 起由全知滞留改为【玩家】滞留：离场操作步 − 入场操作步)
   *   f3 = 障碍强度 / 200       (占位 10%；低权重)
   *   f4 = 【v4 已删除】原「全知-玩家偏移」，其 20% 权重全部转给 f1。返回值仍带 f4 字段但恒为 null/已停用标记。
   *   复活加成：玩家每用一次复活道具 +8 分（≤2 次 → 最多 +16），叠加到主分后再截断到 100。
   *   通关状态：玩家未通关时如实标记 playerWon:false 且 rankable:false（需求 §4.5：不得用失败路线生成正式排序分）。
   * @param {object} level 解析后的关卡
   * @param {object} omni  全知求解结果（仅用于保留对照字段，v4 起【不参与】主分计算）
   * @param {object} [playerStats] 玩家版：{ won, avgBuffer, peak, revives, avgResidence, effectiveTicks, residenceCount }
   */
  function difficulty(level, omni, playerStats, opts) {
    opts = opts || {};
    var cap = opts.cap || DIFF_CAP, W = opts.weights || DIFF_W;
    var counts = obstacleStats(level);
    var bufferLimit = level.bufferLimit || 5;

    // 全知数据仅作对照保留（v4 起不进主分）
    var oAvg = omni ? parseFloat(omni.avgBuffer || 0) : 0;
    var oRes = omni ? (omni.avgResidence || 0) : 0;
    var playerWon = !!(playerStats && playerStats.won);
    var pAvg = playerStats ? (playerStats.avgBuffer || 0) : 0;
    var revives = playerStats ? (playerStats.revives || 0) : 0;
    // f2 数据源（需求 §4）：玩家平均滞留。playerStats.avgResidence 由 PlayerSim 按
    // 「离场操作 tick − enterTick」逐盒统计后给出（普通盒/锁链盒/复活从暂存释放的盒都计入）。
    var pRes = playerStats ? (playerStats.avgResidence || 0) : 0;
    var effTicks = playerStats ? (playerStats.effectiveTicks || 0) : 0;
    // v5：f2 用【无量纲占比】= 平均滞留 ÷ 有效操作步。
    // 含义：一个盒平均占掉了本关操作总量的多大比例。分子分母同为「操作 tick」，单位相消，
    // 因此不同玩法（四方向 / 仅底部 / 瞬时连锁）之间可以直接比较，也可跨批次比较。
    // 在 analysis.js 内计算而不改 playersim：所需的两项 playersim 已经产出，不必改动模拟器。
    // effTicks 为 0（异常或空局）时占比记 0，不做除零。
    var pResRatio = effTicks > 0 ? (pRes / effTicks) : 0;
    var resCount = playerStats ? (playerStats.residenceCount || 0) : 0;
    var offset = Math.max(0, pAvg - oAvg);   // 仅保留为诊断字段，不再参与主分

    // f3 基础障碍强度（加权项，低权重）：冰/黑/锁链/管道 按基础权重累加
    var obsRaw = 0;
    ['ice','black','chain','pipe'].forEach(function(k){ obsRaw += (OBS_W[k]||4) * (counts[k]||0); });

    var f1 = clamp(pAvg / cap.f1 * 100, 0, 100);   // 平均暂存(玩家版，有效操作 tick 轴)
    var f2 = clamp(pResRatio / cap.f2 * 100, 0, 100);   // 平均滞留占比(玩家版) ← v5 改为无量纲
    var f3 = clamp(obsRaw / cap.f3 * 100, 0, 100); // 基础障碍强度

    var core = f1 * W.f1 + f2 * W.f2 + f3 * W.f3;
    var reviveBonus = revives * 8;                 // 复活加成：每次 +8（≤2 次 → ≤16）
    var total = clamp(Math.round(core + reviveBonus), 0, 100);

    return {
      score: total,
      grade: gradeOf(total),
      playerWon: playerWon,
      // 需求 §4.5：未通关的路线不得用于正式难度排序分组。分数仍算出以便诊断，但明确标记不可排序。
      rankable: playerWon,
      scoreVersion: 'diff-v5-scalefree',
      parts: {
        f1: Math.round(f1), f2: Math.round(f2), f3: Math.round(f3),
        f4: null,                                  // v4 已停用
        reviveBonus: reviveBonus, tier: obstacleTier(counts)
      },
      // 明细（需求 §七）：原始值 / 归一化值 / 加权结果 三者齐全，便于复核总分
      detail: {
        f1: { raw: +pAvg.toFixed(4), cap: cap.f1, norm: +f1.toFixed(2), weight: W.f1, weighted: +(f1 * W.f1).toFixed(2), capped: pAvg >= cap.f1 },
        // f2 的 raw 是【占比】（无量纲）；同时保留 residenceTicks/effectiveTicks 便于回溯口径
        f2: {
          raw: +pResRatio.toFixed(6), cap: cap.f2, norm: +f2.toFixed(2), weight: W.f2,
          weighted: +(f2 * W.f2).toFixed(2), capped: pResRatio >= cap.f2,
          unit: '占比（平均滞留 ÷ 有效操作步）',
          residenceTicks: +pRes.toFixed(4), effectiveTicks: effTicks
        },
        f3: { raw: obsRaw, cap: cap.f3, norm: +f3.toFixed(2), weight: W.f3, weighted: +(f3 * W.f3).toFixed(2), capped: obsRaw >= cap.f3 },
        f4: { status: '已停用', note: 'v4 删除全知-玩家偏移，其 0.20 权重已全部转入 f1', legacyRaw: +offset.toFixed(2) },
        core: +core.toFixed(2), reviveBonus: reviveBonus, total: total
      },
      omniAvgBuffer: +oAvg.toFixed(2),
      omniAvgResidence: +oRes.toFixed(2),          // 保留对照，不参与计算
      playerAvgBuffer: +pAvg.toFixed(2),
      playerAvgResidence: +pRes.toFixed(4),            // 原始滞留步数（诊断用，v5 起不直接进 f2）
      playerResidenceRatio: +pResRatio.toFixed(6),     // v5 的 f2 源：滞留 ÷ 有效操作步
      playerBufferPeak: playerStats ? (playerStats.peak || 0) : 0,
      playerEffectiveTicks: effTicks,
      playerResidenceCount: resCount,
      playerRevives: revives,
      offset: +offset.toFixed(2),
      obstacles: counts,
      obstacleNames: obstacleNamesCN(counts),
      obsTag: obsLevelTag(counts),
      bufferHistory: omni ? (omni.stepBufferHistory || []) : []
    };
  }

  /**
   * 多轮求解统计：用不同噪声/种子跑 runs 轮，统计成功率与暂存离散。
   * 反映障碍数量/参数的真实施压（障碍越狠 → 成功率越低、暂存越离散）。
   * @returns {object} { best, successRate, solvedRuns, totalRuns, avgBuffer, maxBufferAvg, avgSteps }
   */
  function multiSolve(level, runs) {
    var R = runs || 10;
    if (!AntSolver.Solver || !AntSolver.Solver.runSolver) {
      return { totalRuns: 0, successRate: 0 };
    }
    var solved = 0, total = 0;
    var bestSteps = Infinity;
    var maxBufSum = 0, avgBufSum = 0, stepSum = 0, cnt = 0;
    // 第一轮无噪声确定性，其余带递增噪声
    var seeds = [1, 17, 53, 101, 211, 307, 401, 599, 733, 887, 977, 1201];
    for (var i = 0; i < R; i++) {
      var noise = i === 0 ? 0 : Math.min(0.3 + (i - 1) * 0.25, 2.0);
      var seed = seeds[i % seeds.length] + i * 131;
      var r = AntSolver.Solver.runSolver(level, noise, seed);
      total++;
      if (r.completed) {
        solved++;
        cnt++;
        maxBufSum += r.maxBuffer || 0;
        avgBufSum += parseFloat(r.avgBuffer || 0);
        stepSum += r.steps || 0;
        if (r.steps < bestSteps) bestSteps = r.steps;
      }
    }
    return {
      best: solved ? bestSteps : null,
      successRate: total ? solved / total : 0,
      solvedRuns: solved,
      totalRuns: total,
      avgBuffer: cnt ? (avgBufSum / cnt) : 0,
      maxBufferAvg: cnt ? (maxBufSum / cnt) : 0,
      avgSteps: cnt ? (stepSum / cnt) : 0
    };
  }

  /**
   * 暂存压力指标：跑 runs 次求解，取每次"每完成一个球时的暂存数"样本，算：
   *  avgAll=全程均暂存；avg50=50%进度后均暂存；maxWin=50%后各10%窗口的最高均暂存。
   * 压力档：暂存 1-3 轻 / 4 中 / 5 高。
   * @returns {avgAll, avg50, maxWin, completedRate, runs}
   */
  function pressureMetrics(level, runs) {
    var R = runs || 3;
    if (!AntSolver.Solver || !AntSolver.Solver.runSolver) return { avgAll: 0, avg50: 0, maxWin: 0, completedRate: 0 };
    var accAll = 0, accAllN = 0, per = [];
    for (var i = 0; i < R; i++) {
      var res = AntSolver.Solver.runSolver(level, i === 0 ? 0 : (0.4 + i * 0.3), 17 + i * 131);
      var s = res.pressureSamples || [], N = res.totalBoxes || 1;
      if (!s.length) { per.push({ avgAll: 0, avg50: 0, maxWin: 0, completed: res.completed }); continue; }
      var bufs = s.map(function(x) { return x.buf; });
      var avgAll = bufs.reduce(function(a, b) { return a + b; }, 0) / bufs.length;
      var s50 = s.filter(function(x) { return x.done / N >= 0.5; }).map(function(x) { return x.buf; });
      var avg50 = s50.length ? s50.reduce(function(a, b) { return a + b; }, 0) / s50.length : 0;
      var maxWin = 0;
      for (var w = 0.5; w < 0.999; w += 0.1) {
        var ws = s.filter(function(x) { var pr = x.done / N; return pr >= w && pr < w + 0.1; }).map(function(x) { return x.buf; });
        if (ws.length) { var a = ws.reduce(function(p, q) { return p + q; }, 0) / ws.length; if (a > maxWin) maxWin = a; }
      }
      per.push({ avgAll: avgAll, avg50: avg50, maxWin: maxWin, completed: res.completed });
    }
    var mean = function(k) { return per.reduce(function(a, m) { return a + m[k]; }, 0) / per.length; };
    var comp = per.filter(function(m) { return m.completed; }).length / per.length;
    return {
      avgAll: +mean('avgAll').toFixed(2), avg50: +mean('avg50').toFixed(2),
      maxWin: +mean('maxWin').toFixed(2), completedRate: +comp.toFixed(2), runs: R
    };
  }

  /**
   * 动态槽位预览诊断：汇总压力样本中的“下一盒可消/封锁”快照。
   * 只做观测，不参与 difficulty() 的现有权重；生成器可用它评估尺寸、障碍、换球、管道和墙的闭合强度。
   * 旧关卡包的样本没有 lockRatio 时返回 sampleCount=0，调用方可无缝回退到普通压力图。
   */
  function dynamicPreviewMetrics(samples, totalBoxes) {
    var valid = [], sumRatio = 0, sumReachable = 0, sumLocked = 0;
    var maxRatio = -1, maxLocked = 0, peakAt = null, remainingAtPeak = 0;
    var phase = {
      early: { sum: 0, n: 0, max: 0 },
      mid: { sum: 0, n: 0, max: 0 },
      late: { sum: 0, n: 0, max: 0 }
    };
    for (var i = 0; i < (samples || []).length; i++) {
      var s = samples[i];
      if (!s || typeof s.lockRatio !== 'number' || isNaN(s.lockRatio)) continue;
      valid.push(s);
      sumRatio += s.lockRatio;
      sumReachable += s.reachable || 0;
      sumLocked += s.locked || 0;
      if (s.locked > maxLocked) maxLocked = s.locked;
      var progress = totalBoxes ? (s.done || 0) / totalBoxes : 0;
      var bucket = progress < 0.2 ? phase.early : (progress < 0.5 ? phase.mid : phase.late);
      bucket.sum += s.lockRatio; bucket.n++;
      if (s.lockRatio > bucket.max) bucket.max = s.lockRatio;
      if (s.lockRatio > maxRatio) {
        maxRatio = s.lockRatio;
        peakAt = totalBoxes ? Math.round(progress * 100) : null;
        remainingAtPeak = s.remaining || 0;
      }
    }
    function phaseAvg(p) { return p.n ? +(p.sum / p.n).toFixed(4) : 0; }
    if (!valid.length) {
      return {
        sampleCount: 0, avgLockRatio: 0, maxLockRatio: 0, peakAt: null, maxLocked: 0,
        avgLocked: 0, avgReachable: 0, remainingAtPeak: 0,
        earlyAvgLockRatio: 0, midAvgLockRatio: 0, lateAvgLockRatio: 0,
        earlyMaxLockRatio: 0, midMaxLockRatio: 0, lateMaxLockRatio: 0
      };
    }
    return {
      sampleCount: valid.length,
      avgLockRatio: +(sumRatio / valid.length).toFixed(4),
      maxLockRatio: +maxRatio.toFixed(4),
      peakAt: peakAt,
      maxLocked: maxLocked,
      avgLocked: +(sumLocked / valid.length).toFixed(2),
      avgReachable: +(sumReachable / valid.length).toFixed(2),
      remainingAtPeak: remainingAtPeak,
      earlyAvgLockRatio: phaseAvg(phase.early),
      midAvgLockRatio: phaseAvg(phase.mid),
      lateAvgLockRatio: phaseAvg(phase.late),
      earlyMaxLockRatio: +phase.early.max.toFixed(4),
      midMaxLockRatio: +phase.mid.max.toFixed(4),
      lateMaxLockRatio: +phase.late.max.toFixed(4)
    };
  }

  // 高压/中压阈值（随暂存上限动态）：
  //  高压阈值 = 上限 − 1.5（上限−1 为高压线门槛；额外 −0.5 中和 10% 窗口内的压力释放滑点）
  //  中压阈值 = 上限 − 2.5（同口径：中压线 上限−2，额外 −0.5 滑点）
  // 高压阈值 = 上限 − 1.5（上限−1 为高压线门槛；额外 −0.5 中和 10% 窗口内的压力释放滑点）。
  //
  // ── 一次已回滚的改动，留档以免重复踩 ──
  // v110（2026-08-26）曾按用户裁决把它下调为 N−2.5，**v111 同日按用户裁决「恢复 N-1.5」回滚**。
  // 当时下调的起因与实测数据（都成立，供日后再决策时参考）：
  //   · 底部消除参数下【后期 10% 窗口均值中位仅 2.25~2.33】，高压线 3.5 几乎不可达 → 卡点 0/12。
  //   · 隔离变量实测（同一批压力曲线只换阈值、不重跑生产）：
  //       老盒切分 high=3.5 → 有卡点 0/12、合格 0；high=2.5 → 有卡点 7/12、合格 7
  //       并行盒切分 high=3.5 → 有卡点 1/12、合格 1；high=2.5 → 有卡点 6/12、合格 5
  // 下调同时带来的两处副作用（很可能正是回滚的原因）：
  //   ① midThreshold 本就是 N−2.5，下调后【高压线 == 中压线】，合格门退化为单一压力线 2.5，
  //      三档（前期中压线 / 中期高压线 / 后期卡点线）的层次消失。
  //   ② midOK 判据是「中期峰 < 高压线」，故中期上限被动收紧 3.5→2.5（实测 midOK 10/10→7/10）。
  // 结论：卡点难形成是**真问题**，但下调这条共用阈值不是干净的解法——它同时改了三条判据。
  //      若要再解决，方向是给「卡点线」独立参数、与「中期爆压线」解耦，而不是动 highThreshold 本身。
  //
  // 与难度分的关系：DIFF_CAP.f1 = 3.5 **就是**本阈值在 L=5 时的值（见文件头 f1 说明），
  // 回滚后两者重新一致；v110 期间曾短暂解耦，现已恢复。
  // 临时对照口径：调用方可传 opts.high 覆盖，不必改本函数。
  function highThreshold(bufferLimit) { return (bufferLimit || 5) - 1.5; }
  function midThreshold(bufferLimit) { return (bufferLimit || 5) - 2.5; }

  // 扫描起点 t∈[startLo,startHi] 的 winW 宽滑动窗口(步长1%)，返回窗口内暂存均值最大者 {max, at(起点%)}。
  function scanWindow(pts, startLo, startHi, winW) {
    var best = -1, at = null;
    for (var t = startLo; t <= startHi + 1e-9; t += 0.01) {
      var lo = t, hi = t + winW, sum = 0, n = 0;
      for (var i = 0; i < pts.length; i++) if (pts[i].p >= lo && pts[i].p < hi) { sum += pts[i].buf; n++; }
      if (n > 0) { var m = sum / n; if (m > best) { best = m; at = lo; } }
    }
    return { max: best < 0 ? 0 : +best.toFixed(2), at: at != null ? Math.round(at * 100) : null };
  }

  /**
   * 卡点判定：50%进度后，用【10%滑动窗口】(步长1%)计算暂存均值，取最大窗口均值；
   * 窗口均值 ≥ 高压阈值(默认=上限−1.5) 记为卡点；至少1个卡点=合格。
   * @param {Array} samples [{done,buf}]（全知或玩家的 pressureSamples）
   * @returns {maxWindowMean, qualified, at(卡点窗口起点%), window, threshold}
   */
  function chokepointMetric(samples, totalBoxes, bufferLimit, opts) {
    opts = opts || {};
    var winW = opts.window || 0.1, startMin = opts.startMin != null ? opts.startMin : 0.5;
    var thr = opts.threshold != null ? opts.threshold : highThreshold(bufferLimit);
    if (!samples || !samples.length || !totalBoxes) return { maxWindowMean: 0, qualified: false, at: null, window: winW, threshold: thr };
    var pts = samples.map(function (s) { return { p: s.done / totalBoxes, buf: s.buf }; });
    var sc = scanWindow(pts, startMin, 1 - winW, winW);
    return { maxWindowMean: sc.max, qualified: sc.max >= thr, at: sc.at, window: winW, threshold: thr };
  }

  /**
   * 生产审核·中后期卡点合格判定（三条件全满足=合格）。阈值随暂存上限动态：
   *   高压阈值 = 上限−1.5；中压阈值 = 上限−2.5（10%滑窗，步长1%）。
   * 三条件：
   *   ① 卡点存在：50%进度后至少一个 10% 窗口均值 ≥ 高压阈值。
   *   ② 前期低压：前期 0-20% 进度内，无 10% 窗口均值 ≥ 中压阈值。
   *   ③ 中期不早爆：20-50% 进度内，无 10% 窗口均值 ≥ 高压阈值（可中压、不可高压）。
   * @param {Array} samples [{done,buf}]（审核基准：全知求解 pressureSamples）
   * @returns {pass, hasChoke, earlyOK, midOK, high, mid, lateMax, lateAt, earlyMax, midMax, reasons[]}
   */
  function chokepointAudit(samples, totalBoxes, bufferLimit, opts) {
    opts = opts || {};
    // 前50%(前期0-20% + 中期20-50%)用【5%】窗口收紧判定；中后期50%+仍用【10%】窗口。
    var winFront = opts.winFront || 0.05;
    var winLate = opts.winLate || opts.window || 0.1;
    var high = opts.high != null ? opts.high : highThreshold(bufferLimit);
    var mid = opts.mid != null ? opts.mid : midThreshold(bufferLimit);
    var L = bufferLimit || 5;
    var res = { pass: false, hasChoke: false, earlyOK: false, midOK: false, safeEdge: false, high: +high.toFixed(2), mid: +mid.toFixed(2),
                winFront: winFront, winLate: winLate, peakBuf: 0,
                lateMax: 0, lateAt: null, earlyMax: 0, midMax: 0, reasons: [] };
    if (!samples || !samples.length || !totalBoxes) { res.reasons.push('无压力样本'); return res; }
    var pts = samples.map(function (s) { return { p: s.done / totalBoxes, buf: s.buf }; });
    var peak = 0; for (var i = 0; i < pts.length; i++) if (pts[i].buf > peak) peak = pts[i].buf;
    res.peakBuf = peak;
    var early = scanWindow(pts, 0, 0.2 - winFront, winFront);  // 前期[0,20%]，5%窗
    var midB = scanWindow(pts, 0.2, 0.5 - winFront, winFront); // 中期[20%,50%]，5%窗
    var late = scanWindow(pts, 0.5, 1 - winLate, winLate);     // 后期[50%,100%]，10%窗
    res.earlyMax = early.max; res.midMax = midB.max; res.lateMax = late.max; res.lateAt = late.at;
    res.hasChoke = late.max >= high;
    res.earlyOK = early.max < mid;
    res.midOK = midB.max < high;
    // 暂存峰值需【低于上限】(留 ≥1 空位余量)：触达上限=死亡边界=不合格(全知被迫塞满=真人必死的非法卡点)
    res.safeEdge = peak < L;

    // ==================== 合格门语义重置（v104，任务 ANT-GEN-AUDIT-RESET-20260824） ====================
    // 用户 2026-08-24 裁决 + 同日纠正：
    //   「合格门负责控制：全知可解，趋势不过压力，中后期有卡点；难度分体系控制是否简单/普通/困难/极难。」
    //   纠正：「现行的简单合格作为简单关名额出现即可。只不过直接标记为简单关和趋势过平即可。」
    //
    // 因此本轮改的是【命名与职责划分】，不是收紧门槛：
    //   · 旧「困难合格」→ 改称 **合格**（curveOK：趋势不过压 且 中后期有实际卡点）
    //   · 旧「简单合格」→ 改称 **简单关·趋势过平**（flatTrend：趋势不过压但没形成卡点）。
    //     它【仍然可用】，占「简单关名额」，只是如实标出"趋势过平、无实际卡点"。
    //   · 两者都不满足 → 不合格
    // 「简单/普通/困难/极难」不再由审核给，全部交给难度分 gradeOf(简单0-30/普通31-60/困难61-80/极难81+)——
    //   这才是用户所说的"重置"：审核只管【能不能用 + 是否形成卡点】，难易分档归难度分。
    //
    // 产能不受影响：usable = curveOK || flatTrend，与旧 (pass || easyPass) 等价。
    //   上线 344 关实测对照：旧困难合格 120 → 新"合格"120；旧简单合格 224 → 新"简单关·趋势过平"224。
    //
    // 「全知可解」不在本函数职责内——本函数只看压力曲线；可解性由调用方
    //   (generator.evaluateGeneration 的 omni.won / player.won) 合并判定。
    var endW = scanWindow(pts, 0.85, 0.999, Math.min(0.15, winLate));
    res.endMax = endW.max;
    var bump = Math.max(midB.max, late.max);           // 中后期峰
    res.bump = bump;
    res.trendOK = res.earlyOK && res.midOK && res.safeEdge &&
                  (bump >= mid) && (bump > early.max);   // 诊断用：中后期达中压且高于前期
    res.easyPass = res.trendOK;                        // 诊断用；v104 起不参与合格判定

    res.gateVersion = 'audit-gate-v104';
    // 压力曲线【完整合格】：趋势不过压 + 中后期确有卡点
    res.curveOK = res.hasChoke && res.earlyOK && res.midOK && res.safeEdge;
    // 压力曲线【趋势过平】：趋势没问题、也没过压，但中后期没形成实际卡点。
    //   用户 2026-08-24 纠正：这类【仍然合格】，只是占「简单关名额」，标记为简单关 + 趋势过平。
    res.flatTrend = !res.hasChoke && res.trendOK;
    res.pass = res.curveOK;                 // pass 专指"有实际卡点"的完整合格（含义与旧 pass 一致）
    res.easyQuota = res.flatTrend;          // 占简单关名额（含义与旧 easyPass 一致，改名以免与难度分档混淆）
    res.easyPass = res.flatTrend;           // 兼容旧字段名，值同 easyQuota
    res.usable = res.curveOK || res.flatTrend;   // 【能不能用】的单一判据
    res.tier = res.curveOK ? '合格' : (res.flatTrend ? '简单关·趋势过平' : '不合格');

    if (!res.hasChoke) res.reasons.push('50%后无高压卡点(峰窗' + late.max + '<高压' + res.high + ')');
    if (!res.earlyOK) res.reasons.push('前期0-20%超中压(峰窗' + early.max + '≥中压' + res.mid + ')');
    if (!res.midOK) res.reasons.push('中期20-50%超高压(峰窗' + midB.max + '≥高压' + res.high + ')');
    if (!res.safeEdge) res.reasons.push('暂存峰值' + peak + '触达上限' + L + '(死亡边界，需留余量)');
    if (res.flatTrend) {
      res.reasons.push('趋势过平：前中期不过压但中后期未形成实际卡点(中后期峰' + bump.toFixed(1) +
        ')，判为【简单关】占简单关名额，仍可用');
    }
    return res;
  }

  // ==================== BOSS 判定（v104，任务 ANT-GEN-AUDIT-RESET-20260824） ====================
  // 用户 2026-08-24 定义：「boss 是指：难度分大于60，且包含有效卡点的关卡」。
  //
  // 关键性质：BOSS 是**派生标签**，不是生产参数——难度分要等生产完、跑完玩家模拟才有，
  //   所以只能在难度算完之后判定。这与生产期的 `isBossSlot`（"按 BOSS 规格生产"，给更多卡点类型，
  //   见 generator 的卡点类型体系）是**两个不同的东西**，必须同时记录、不可互相替代：
  //   · isBossSlot = 生产时的意图（想让它成为 BOSS）
  //   · isBoss     = 生产后的事实（难度分与卡点都达标了）
  //   二者可能不一致（想做成 BOSS 但难度没上去 / 没打算做 BOSS 但恰好达标），这本身是有用的信息。
  //
  // 「有效卡点」取 audit.pass（curveOK：趋势不过压 且 中后期确有高压卡点）。
  //   「简单关·趋势过平」不算有效卡点，故不可能成为 BOSS。
  var BOSS_MIN_SCORE = 60;   // 难度分【大于】此值；即 >60，不含 60

  /**
   * @param {object} diff  Analysis.difficulty() 的返回（取 diff.score）
   * @param {object} audit chokepointAudit() 的返回（取 audit.pass）
   * @param {object} [opts] { minScore } 覆盖阈值
   * @returns {object} { isBoss, score, minScore, hasEffectiveChoke, reason }
   */
  function isBossLevel(diff, audit, opts) {
    opts = opts || {};
    var minScore = opts.minScore != null ? opts.minScore : BOSS_MIN_SCORE;
    var score = diff && typeof diff.score === 'number' ? diff.score : (typeof diff === 'number' ? diff : 0);
    var choke = !!(audit && audit.pass);
    var ok = score > minScore && choke;
    var why = [];
    if (!(score > minScore)) why.push('难度分 ' + score + ' 未超过 ' + minScore);
    if (!choke) why.push('无有效卡点(' + ((audit && audit.tier) || '未审核') + ')');
    return {
      isBoss: ok, score: score, minScore: minScore, hasEffectiveChoke: choke,
      reason: ok ? ('难度分 ' + score + ' > ' + minScore + ' 且有有效卡点') : why.join('；')
    };
  }

  // 字段备注（展示用）
  var FIELD_NOTES = {
    '难度分(v2)': '0~100 = f1平均暂存×0.45 + f2平均滞留×0.25 + f3基础障碍×0.10 + f4全知玩家偏移×0.20。',
    '难度等级': '简单 0-30 · 普通 31-60 · 困难 61-80 · 极难 81-100。',
    'f1 平均暂存': '全知求解全程平均暂存占用 ÷ 1.2(标定上限)。',
    'f2 平均滞留': '每个球从入场暂存到被消除停留的步数，取平均 ÷ 7(标定上限)。',
    'f3 基础障碍': '低权重：按障碍强度分档，对主分做 ±5%/级(±15%内)的增压/减压标定。',
    'f4 全知-玩家偏移': '(玩家平均暂存 − 全知平均暂存) ÷ 1.5；偏移越大越难。',
    '合格门槛': '玩家版必须通关(playerWon)才合格；否则真人打不通=不合格。',
    '合格门(v104)': '审核只管【能不能用 + 有没有卡点】：合格(趋势不过压且中后期有实际卡点) / ' +
      '简单关·趋势过平(不过压但无卡点，仍可用、占简单关名额) / 不合格。' +
      '「简单/普通/困难/极难」不再由审核给，全部交给难度分(简单0-30/普通31-60/困难61-80/极难81+)。',
    'BOSS(v104)': '派生标签，非生产参数：难度分>60 且 audit.pass(有有效卡点)。难度算完后才能判定。' +
      '与生产期的 isBossSlot(按BOSS规格生产的意图)是两回事，两者都记录。'
  };

  return {
    OBS_CN: OBS_CN, OBS_W: OBS_W, DIFF_W: DIFF_W, DIFF_CAP: DIFF_CAP,
    clamp: clamp,
    normObsType: normObsType,
    obstacleStats: obstacleStats,
    obstacleKinds: obstacleKinds,
    obstacleNamesCN: obstacleNamesCN,
    obsLevelTag: obsLevelTag,
    gradeOf: gradeOf,
    eliminationLayers: eliminationLayers,
    difficulty: difficulty,
    multiSolve: multiSolve,
    pressureMetrics: pressureMetrics,
    dynamicPreviewMetrics: dynamicPreviewMetrics,
    chokepointMetric: chokepointMetric,
    chokepointAudit: chokepointAudit,
    isBossLevel: isBossLevel,
    BOSS_MIN_SCORE: BOSS_MIN_SCORE,
    highThreshold: highThreshold,
    midThreshold: midThreshold,
    FIELD_NOTES: FIELD_NOTES
  };
})();

// Node 环境导出（供批量脚本/测试复用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AntSolver.Analysis;
}
