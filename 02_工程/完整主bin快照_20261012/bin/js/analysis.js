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
  // 【v139】ice 这一档现在统计的是**数字冰(type 7)**——老冰已下线，key/列名保留 `ice`（历史方案与 CSV 兼容）。
  var OBS_CN = {
    ice: '数字冰', black: '黑块', chain: '锁链', question: '问号', pipe: '管道'
  };
  // 障碍分级：软(问号) / 硬(数字冰·黑块·锁链·管道，改变可达拓扑或需前置解锁)
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
            if (cell.numice > 0) counts.ice = (counts.ice || 0) + 1;   // 【v139】数字冰计入「数字冰」档（原 ice 改指数字冰）
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
    // 基线 ~120（55×55 基础参数典型障碍量）；每 ±40 一档，clamp[-3,3]（v139 起 ice 档 = 数字冰）
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

    // f3 基础障碍强度（加权项，低权重）：数字冰/黑/锁链/管道 按基础权重累加
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

  // ===== 难度重标定：多轮玩家路线取「最稳」那条 =====
  // 任务 ANT-SIM-FRONTEND-SYNC-20260828 ④（用户：「多轮批量分析求解，多轮多路线，算出最稳定、
  //   表现最好的那一条玩家路线来标定难度，避免生产审核时的扰动」）。
  //
  // 为什么需要：生产审核与页面分析都只跑【一次】玩家模拟（写死 seed 7）。PlayerSim 的选盒带随机门槛，
  //   同一关不同种子的 revives/峰值/滞留都会变 → 难度分随之抖动。单跑一次等于把一次抽样当成关卡属性。
  //
  // 口径（本函数**不改任何评分公式**，`difficulty()` / DIFF_CAP / DIFF_W 一行不动 ——
  //   重标定是「换一条更有代表性的输入路线」，不是「改怎么算分」）：
  //   ① 只在【通关】的轮次里挑代表（未通关路线不得产出正式排序分，沿用 difficulty 的 rankable 口径）；
  //   ② 先按【复活次数少】——复活是 +8 分的硬加成，一次离群的多复活轮会把分数整体抬高；
  //   ③ 再按【峰值暂存低】——峰值是失败源，低峰值代表这条路线走得稳；
  //   ④ 再按【难度分接近本关多轮中位数】——避免挑到分数离群的那一轮。
  //   全轮皆未通关时：不伪造代表，取「进度最远」的一轮作诊断代表并置 rankable=false。
  //
  // 同时输出多轮离散度（通关率 / 峰值极差 / 难度分极差与中位数 / 不同路线条数），
  //   用来判断**这一关本身稳不稳**：极差大 = 这关对玩家风格敏感，重标定分只是中位代表，不是确定值。
  //
  // ⚠【多轮的扰动源为什么是 pickThreshold 而不是随机种子】——实测结论，必须写在这里：
  //   `PlayerSim.run` 的 `opts.seed` **当前完全无效**：`playersim.js` 里 `rngState`/`rng()` 有定义，
  //   但 `rng()` 在整个文件里**零调用**（实测 6 关 × 6 个种子，结果逐字段完全相同；
  //   `PlayerSim.multiRun` 的 successRate 因此只能是 0 或 1）。即玩家模拟是完全确定性的。
  //   诊断见 `_kiro临时/08.28-前端模拟同步/_诊断-种子无效.js`。
  //   所以若按种子跑 N 轮，会得到 N 条**完全相同**的路线 —— 功能跑通但恒等于单轮，属名额空转。
  //   本函数改用**已有的 `pickThreshold`**（前一个球消到该比例才继续取下一个 = 玩家的激进程度）
  //   作为多轮扰动轴：这只是**换调用方传入的参数**，不触碰玩家模拟的决策与消除逻辑。
  //   实测（110底部-08-27 全 47 关）：窄带 0.50~0.70 平均能产出 4.36/5 条不同路线、0 关退化；
  //   代表轮与单轮(0.6) 的分差中位 0、均值 3.0、最大 20 —— 即多数关与单轮一致，只纠正离群关。
  //   更宽的 0.40~0.90 平均分数极差 34.3、分差均值 7.1，那已是「在挑玩家风格」而非「去噪」，故不取。
  //   `seed` 仍逐轮传入并记录：一旦后续把 `rng()` 接进选盒（需另行批准，属决策逻辑改动），
  //   这里不需要再改结构就能自动获得第二个扰动轴。
  //
  // @param {object} level 已 parseLevel 的关卡
  // @param {object} [opts] { runs=5, thresholds, seeds, bottomOnly, instantChain, omni, useItems }
  // @returns {object} { ok, runs, rankable, difficulty, chosen, samples, stability, note }
  function recalibrateDifficulty(level, opts) {
    opts = opts || {};
    var R = Math.max(1, parseInt(opts.runs, 10) || 5);
    if (!AntSolver.PlayerSim || !AntSolver.Solver) {
      return { ok: false, runs: 0, rankable: false, difficulty: null, chosen: null, samples: [], stability: null, note: '玩家模拟或求解模块未加载' };
    }
    // 全知一遍即可（同一关卡同一模式下 solve 是确定性入口，且 f1/f2 都不取全知值）。
    // 允许外部传入以免重复求解（批量分析里已经算过）。
    var omni = opts.omni || AntSolver.Solver.solve(level, {
      bottomOnly: !!opts.bottomOnly, instantChain: !!opts.instantChain
    });
    // 固定种子表 → 同一关重复重标定结果可复现（不用随机数，否则「重标定」自己就带扰动）。
    var seeds = opts.seeds && opts.seeds.length ? opts.seeds : [7, 131, 277, 431, 613, 811, 997, 1213, 1439, 1657];
    // pickThreshold 取值：默认在 [0.50, 0.70] 窄带内均匀取 R 个点（R=1 时取 PlayerSim 的默认 0.6）。
    // 轮数增加只是把同一窄带取得更密，不外扩 —— 外扩会变成「比风格」而不是「去噪」（见上）。
    var thrs = opts.thresholds && opts.thresholds.length ? opts.thresholds : (function () {
      if (R <= 1) return [0.6];
      var out = [];
      for (var q = 0; q < R; q++) out.push(+(0.50 + 0.20 * q / (R - 1)).toFixed(4));
      return out;
    })();
    var samples = [];
    var routeSigs = {}, routeKinds = 0;
    for (var i = 0; i < R; i++) {
      var seed = seeds[i % seeds.length] + Math.floor(i / seeds.length) * 10007;
      var thr = thrs[i % thrs.length];
      var pl = null;
      try {
        pl = AntSolver.PlayerSim.run(level, {
          seed: seed, pickThreshold: thr, useItems: !!opts.useItems,
          bottomOnly: !!opts.bottomOnly, instantChain: !!opts.instantChain
        });
      } catch (e) { pl = null; }
      if (!pl) { samples.push({ index: i, seed: seed, pickThreshold: thr, ok: false, error: true }); continue; }
      // 不同路线条数：用取盒坐标序列做指纹。这是判断「多轮有没有真的多路线」的唯一硬证据，
      // 只统计不参与选择；退化为 1 条时会在 stability.degenerate 里如实标出。
      var sig = '';
      for (var g = 0; g < (pl.pickOrder || []).length; g++) sig += pl.pickOrder[g].r + '.' + pl.pickOrder[g].c + '|';
      if (!routeSigs[sig]) { routeSigs[sig] = 1; routeKinds++; }
      var ps = {
        won: pl.won, avgBuffer: pl.playerAvgBuffer, peak: pl.bufferPeak,
        revives: pl.revivesUsed || 0, avgResidence: pl.avgResidence,
        effectiveTicks: pl.effectiveTicks, residenceCount: pl.residenceCount
      };
      var d = difficulty(level, omni, ps, opts.diffOpts);
      samples.push({
        index: i, seed: seed, pickThreshold: thr, ok: true, error: false,
        // 【任务 ANT-DIFFICULTY-SYSTEM-V2-20260901，用户 2026-09-01 批准 D3=a】
        //   逐轮路线指纹**只读**输出。此前 sig 只用于内部计数 routeKinds，外部拿不到逐轮路线，
        //   而 2.0 实验（需求 §6.1）要求「各轮实际采用的扰动参数和路线指纹」可逐轮追溯、
        //   并据此证明高轮次样本**嵌套**低轮次（R7 ⊂ R13 ⊂ R25）。
        //   ⚠ 纯新增字段：不参与代表轮选择、不进任何分数、不改本函数任何既有行为。
        routeSig: sig,
        won: !!pl.won, score: d.score, grade: d.grade,
        revives: pl.revivesUsed || 0, peak: pl.bufferPeak,
        avgBuffer: pl.playerAvgBuffer, avgResidence: pl.avgResidence,
        residenceRatio: d.playerResidenceRatio,
        effectiveTicks: pl.effectiveTicks, progress: pl.progress,
        ticks: pl.ticks, picks: pl.picks,
        parts: { f1: d.parts.f1, f2: d.parts.f2, f3: d.parts.f3 },
        difficulty: d
      });
    }
    var valid = samples.filter(function (x) { return x.ok; });
    var wonRuns = valid.filter(function (x) { return x.won; });
    function median(arr) {
      if (!arr.length) return 0;
      var a = arr.slice().sort(function (p, q) { return p - q; });
      var m = a.length >> 1;
      return a.length % 2 ? a[m] : +((a[m - 1] + a[m]) / 2).toFixed(2);
    }
    var pool = wonRuns.length ? wonRuns : valid;
    var scores = pool.map(function (x) { return x.score; });
    var peaks = pool.map(function (x) { return x.peak; });
    var scoreMed = median(scores);
    var chosen = null;
    if (wonRuns.length) {
      // ②③④ 三级排序；同一关多轮里最稳的那条
      chosen = wonRuns.slice().sort(function (a, b) {
        if (a.revives !== b.revives) return a.revives - b.revives;
        if (a.peak !== b.peak) return a.peak - b.peak;
        return Math.abs(a.score - scoreMed) - Math.abs(b.score - scoreMed);
      })[0];
    } else if (valid.length) {
      // 无通关轮：取进度最远的一轮，仅作诊断代表（rankable=false）
      chosen = valid.slice().sort(function (a, b) { return (b.progress || 0) - (a.progress || 0); })[0];
    }
    var stability = {
      runs: samples.length, validRuns: valid.length, wonRuns: wonRuns.length,
      winRate: samples.length ? +(wonRuns.length / samples.length).toFixed(4) : 0,
      scoreMedian: scoreMed,
      scoreMin: scores.length ? Math.min.apply(null, scores) : null,
      scoreMax: scores.length ? Math.max.apply(null, scores) : null,
      scoreRange: scores.length ? (Math.max.apply(null, scores) - Math.min.apply(null, scores)) : 0,
      peakMin: peaks.length ? Math.min.apply(null, peaks) : null,
      peakMax: peaks.length ? Math.max.apply(null, peaks) : null,
      peakRange: peaks.length ? (Math.max.apply(null, peaks) - Math.min.apply(null, peaks)) : 0,
      reviveMin: pool.length ? Math.min.apply(null, pool.map(function (x) { return x.revives; })) : null,
      reviveMax: pool.length ? Math.max.apply(null, pool.map(function (x) { return x.revives; })) : null,
      pool: wonRuns.length ? 'won' : 'all',
      // 多轮有没有真的产出多条路线。degenerate=true 表示「N 轮等于 1 轮」，此时重标定分与单轮同值，
      // 不构成去噪。调用方应把它显示出来，而不是让用户以为跑了 N 轮就更可信。
      distinctRoutes: routeKinds,
      degenerate: routeKinds <= 1 && samples.length > 1,
      perturbation: 'pickThreshold',
      thresholds: thrs.slice()
    };
    return {
      ok: !!chosen,
      runs: samples.length,
      rankable: !!(chosen && chosen.won),
      difficulty: chosen ? chosen.difficulty : null,
      chosen: chosen ? {
        index: chosen.index, seed: chosen.seed, pickThreshold: chosen.pickThreshold,
        score: chosen.score, grade: chosen.grade,
        revives: chosen.revives, peak: chosen.peak, won: chosen.won
      } : null,
      omniCompleted: !!(omni && omni.completed),
      samples: samples,
      stability: stability,
      gateVersion: 'recalibrate-v121',
      note: [
        wonRuns.length ? '' : '多轮玩家模拟全部未通关，代表轮仅作诊断，不产出正式排序分',
        stability.degenerate ? '多轮退化为单一路线（该关对 pickThreshold 不敏感），重标定分等同单轮' : ''
      ].filter(function (x) { return x; }).join('；')
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
  //
  // ===== v118（用户 2026-08-27 裁决「将卡点阈值改为 N-1.8」）=====
  // 卡点线由 L−1.5 改为 **L−1.8**（L=5 时 3.5 → 3.2）。这是**放宽**：卡点更容易达成。
  // 背景：卡点形成率一直是唯一瓶颈（v110 批 17.4%，v117 卡点区收窄到 30~80% 后该批降到 14.9%），
  //   本轮由用户直接下调阈值 + 收窄窗口宽（10%→5%）两手一起放宽，见 chokepointAudit 内说明。
  // ⚠ 与上文 v110 的教训并不冲突：v110 是把阈值一路压到 2.5（= 中压线），导致高压线与中压线重合、
  //   三档层次消失才被回滚。本次 3.2 仍高于中压线 2.5，且 v118 已把「中期」整段移除、
  //   前期改用卡点线判定，不存在 v110 那种「一个常量同时改三条判据」的耦合。
  // ⚠ 与难度分的关系已解耦：DIFF_CAP.f1 仍为 3.5（= 旧 L−1.5），**本轮未改难度分**。
  //   两者从此不再相等 —— f1 的含义是「平均暂存摸到 3.5 即满分」，属难度标定；
  //   卡点线是合格门判据。混为一谈会导致改一个就误动另一个（v110 就吃过这个亏）。
  var CHOKE_OFFSET = 1.8;        // 卡点线相对暂存上限的下偏移（v118：1.5 → 1.8）
  var CHOKE_OFFSET_LEGACY = 1.5; // v104~v117 的旧偏移，仅用于旧口径对照字段
  function highThreshold(bufferLimit) { return (bufferLimit || 5) - CHOKE_OFFSET; }
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
   * 卡点指标（压力图上显示的那个）：在卡点判定区域内用【10%滑动窗口】(步长1%)计算暂存均值，取最大窗口均值；
   * 窗口均值 ≥ 高压阈值(默认=上限−1.5) 记为卡点。
   * **v116 起区域随 chokepointAudit 一起改为 30%~80%**（原为 50%~100%）——
   *   两者必须同一区间，否则压力图显示的卡点位置与审核判定的会对不上，看图排查时会得出错误结论。
   * @param {Array} samples [{done,buf}]（全知或玩家的 pressureSamples）
   * @returns {maxWindowMean, qualified, at(卡点窗口起点%), window, threshold, startMin, startMax}
   */
  function chokepointMetric(samples, totalBoxes, bufferLimit, opts) {
    opts = opts || {};
    var winW = opts.window || 0.1;
    var startMin = opts.startMin != null ? opts.startMin : 0.30;
    var endMax = opts.endMax != null ? opts.endMax : 1.00;   // v119：0.80 → 1.00，随审核区间一起放开
    var thr = opts.threshold != null ? opts.threshold : highThreshold(bufferLimit);
    if (!samples || !samples.length || !totalBoxes) return { maxWindowMean: 0, qualified: false, at: null, window: winW, threshold: thr, startMin: startMin, endMax: endMax };
    var pts = samples.map(function (s) { return { p: s.done / totalBoxes, buf: s.buf }; });
    var sc = scanWindow(pts, startMin, endMax - winW, winW);
    // 把区间一并返回：压力图上要标出"卡点区在哪"，v116 改过区间后不带出来就只能在两处各写一遍常量。
    return { maxWindowMean: sc.max, qualified: sc.max >= thr, at: sc.at, window: winW, threshold: thr,
             startMin: startMin, endMax: endMax };
  }

  /**
   * 生产审核·中后期卡点合格判定（三条件全满足=合格）。阈值随暂存上限动态：
   *   高压阈值 = 上限−1.5；中压阈值 = 上限−2.5（10%滑窗，步长1%）。
   * 三条件（**v116 起窗口区间已改**，见函数内说明）：
   *   ① 卡点存在：**30%~80%** 进度内至少一个 10% 窗口均值 ≥ 高压阈值。
   *      （v104~v115 为「50% 之后」；改动理由：管道藏球使全局进度落后于玩家的视觉进度）
   *   ② 前期低压：前期 0-20% 进度内，无 5% 窗口均值 ≥ 中压阈值。
   *   ③ 中期不早爆：**20%~30%** 进度内，无 5% 窗口均值 ≥ 高压阈值（可中压、不可高压）。
   *      （v104~v115 为 20-50%；卡点区下移到 30% 后必须收缩，否则 30~50% 会自相矛盾）
   *   旧口径的峰窗仍记录在 `lateMaxLegacy`/`lateAtLegacy`/`midMaxLegacy`/`hasChokeLegacy`，只作对照不参与判定。
   * @param {Array} samples [{done,buf}]（审核基准：全知求解 pressureSamples）
   * @returns {pass, hasChoke, earlyOK, midOK, high, mid, lateMax, lateAt, earlyMax, midMax, reasons[]}
   */
  function chokepointAudit(samples, totalBoxes, bufferLimit, opts) {
    opts = opts || {};
    // ===== v118：窗口宽全阶段统一 5%（用户「同时卡点窗口滑动改为5%」）=====
    // 原先前期/中期 5% 窗、卡点区 10% 窗。窗口变窄 → 短促峰值被平均得少 → 峰窗值抬高，
    // 与阈值下调（L−1.8）同向，都是放宽卡点判定。**起点步长仍 1%，未改**（见 scanWindow）。
    var winFront = opts.winFront || 0.05;
    var winLate = opts.winLate || opts.window || 0.05;
    var high = opts.high != null ? opts.high : highThreshold(bufferLimit);
    var mid = opts.mid != null ? opts.mid : midThreshold(bufferLimit);
    var L = bufferLimit || 5;
    var res = { pass: false, hasChoke: false, earlyOK: false, midOK: true, safeEdge: false, high: +high.toFixed(2), mid: +mid.toFixed(2),
                winFront: winFront, winLate: winLate, peakBuf: 0,
                lateMax: 0, lateAt: null, earlyMax: 0, midMax: 0, tailMax: 0, tailAt: null, reasons: [] };
    if (!samples || !samples.length || !totalBoxes) { res.reasons.push('无压力样本'); return res; }
    var pts = samples.map(function (s) { return { p: s.done / totalBoxes, buf: s.buf }; });
    var peak = 0; for (var i = 0; i < pts.length; i++) if (pts[i].buf > peak) peak = pts[i].buf;
    res.peakBuf = peak;
    // ===== 卡点判定区域 v116：50%~100% → 30%~80%（任务 ANT-GEN-USABLE-REPORT-CHOKE-WINDOW-20260827）=====
    // 用户 2026-08-27 裁决：「将卡点区域判定修改为30%-80%的进度区域」。
    // 理由（用户原话要点）：管道会隐藏部分球，这些球也计入全局进度，但玩家的进度感对标的是**棋盘空间**——
    //   盘面被拿掉很多时视觉上像完成了大半，实际全局进度没那么多。实测该批 47 关：管道藏盒占总盒数
    //   中位 7.8%（最大 14.7%），盘面清空时全局进度中位只到 92.2%，用户的判断成立。
    // 于是：全局 30% 对玩家已是「中期」，全局 80% 之后玩家已觉得打完了，那时才出的卡点不构成体验上的卡点。
    //
    // ⚠ 中期窗口必须同步收缩：原中期是 [20%,50%] 且要求 midMax < 高压。卡点区下移到 30% 后，
    //   30%~50% 会被同时要求「必须达高压(卡点)」与「必须低于高压(midOK)」——直接矛盾。
    //   故中期收缩为 [20%,30%]。这是唯一自洽读法；不收缩会让落在 30~50% 的卡点关「有卡点却仍判不合格」。
    //   110底部-08-27 批实测：两种取法结果相同（合格均 7/47），冲突关数 0，故不改变该批结论。
    // 【阈值未改】highThreshold 仍 L−1.5、midThreshold 仍 L−2.5（用户已裁决「恢复 N-1.5」），本轮只改窗口区间。
    // 【已知代价】该批 hasChoke 由 10/47(21.3%) 降到 7/47(14.9%)：4 关的压力峰在全局 80% 之后被剔除，
    //   1 关（峰 3.57@46%）原先被 50% 边界切掉、现在能认。方向是收紧，产能更紧，已如实报告用户。
    // ===== v118 阶段重划为三段，中期整段移除（用户 2026-08-27）=====
    // 用户原话：「中期移除，只保留前期0-30%；中后期30-80%，后期80%-100%。只要求前期压力不出现卡点即可。」
    //   前期   [0, 30%]   ：唯一的「不许过压」段，判据改为【不得出现卡点】（比的是卡点线，不再是中压线）
    //   中后期 [30%, 80%] ：卡点区，hasChoke 就看这一段
    //   后期   [80%, 100%]：**只记录不判定**（用户未给该段判据）
    // 中期段（v104~v117 的 [20,50] → [20,30]）连同 midOK 判据一并删除。
    // ===== v119：后期 80%~100% 也进入卡点判定（用户 2026-08-27「那就给到80-100进入卡点判断」）=====
    // v118 时该段只记录不判定，实测该批有 16 关峰窗达线却被排除。用户裁决纳入，
    // 于是**卡点判定区 = [30%, 100%]**，前期仍 [0,30%]。
    // 【为什么用一次贯通扫描而不是「两段各扫一次取大」】跨 80% 边界的窗口在两段各自扫描里都不完整，
    //   会被漏掉 —— 这正是 v117 修掉的 50% 边界失真同一类问题，不能在 80% 处再造一个。
    //   两个子段仍各自记录（midLateMax / tailMax），供分析「卡点出在哪一段」。
    var EARLY_HI = opts.earlyHi != null ? opts.earlyHi : 0.30;   // 前期终点 = 卡点区起点
    var CHOKE_LO = opts.chokeLo != null ? opts.chokeLo : 0.30;   // 卡点区起点
    var CHOKE_HI = opts.chokeHi != null ? opts.chokeHi : 1.00;   // 卡点区终点（v119：0.80 → 1.00）
    var TAIL_LO = opts.tailLo != null ? opts.tailLo : 0.80;      // 后期子段起点（仅用于分段记录）
    var early = scanWindow(pts, 0, EARLY_HI - winFront, winFront);        // 前期[0,30%]，5%窗
    var late = scanWindow(pts, CHOKE_LO, CHOKE_HI - winLate, winLate);   // 卡点区[30%,100%]，5%窗 ← 判定用
    var midLate = scanWindow(pts, CHOKE_LO, TAIL_LO - winLate, winLate); // 子段·中后期[30%,80%]，仅记录
    var tail = scanWindow(pts, TAIL_LO, 1 - winLate, winLate);           // 子段·后期[80%,100%]，仅记录
    // 【v159】前期门可放宽：opts.earlyCap 默认 = 卡点线 high（**与改动前逐值一致**）。
    //   生成器在"卡点判据 v2"开启时传 earlyCap = 上限 − 0.8（5 → 4.2）：允许前期走到中压(3~4)、
    //   仍禁止爆压与触顶（触顶由 safeEdge 独立把关）。用户 2026-10-16：「允许到 3~4，但仍禁止爆压/触顶」。
    var earlyCap = (opts.earlyCap != null) ? opts.earlyCap : high;
    res.earlyCap = +earlyCap.toFixed(2);
    res.earlyMax = early.max; res.lateMax = late.max; res.lateAt = late.at;
    res.midLateMax = midLate.max; res.midLateAt = midLate.at;
    res.tailMax = tail.max; res.tailAt = tail.at;
    res.earlyLo = 0; res.earlyHi = EARLY_HI;
    res.chokeLo = CHOKE_LO; res.chokeHi = CHOKE_HI; res.tailLo = TAIL_LO;
    // 【midMax 保留但恒为 0】中期阶段已移除。字段不能直接删：generator 的 auditScoreOf 里有
    //   `Math.max(0, a.midMax - high)`，删了会变 NaN → 候选评分全废（静默污染，比报错难查得多）；
    //   `_prodmerge.js`、ZIP 报告与 CSV 也都在读这个字段。恒 0 使那些表达式退化为无操作。
    res.midMax = 0;
    res.midOK = true;   // 判据已移除，恒真（保留字段供旧报告读取，不再有判定含义）
    // 旧口径同时记录，便于新旧批次对照与回溯（不参与任何判定）。
    // 【必须用旧阈值 + 旧窗口宽重算】否则「旧口径」会掺进本轮的新阈值/新窗宽，就不是旧口径了，
    //   跨批次比 hasChoke 率会得出错误结论。旧口径 = [50,100] + 10% 窗 + L−1.5。
    var highLegacy = (bufferLimit || 5) - CHOKE_OFFSET_LEGACY;
    var lateLegacy = scanWindow(pts, 0.5, 1 - 0.1, 0.1);
    res.lateMaxLegacy = lateLegacy.max; res.lateAtLegacy = lateLegacy.at;
    res.midMaxLegacy = scanWindow(pts, 0.2, 0.5 - 0.05, 0.05).max;
    res.highLegacy = +highLegacy.toFixed(2);
    res.hasChokeLegacy = lateLegacy.max >= highLegacy;
    // ==================== 【v295·用户裁决】卡点判定由「尖峰」改「覆盖率」 ====================
    // 用户原话：「把有卡点改成覆盖率，现在要求 20%-80% 的过程中有 70% 突破暂存≥3（也许 70 太多，加一个滑轮）」。
    //
    // 为什么必须改：旧判据 hasChoke = late.max >= high，只要 30%~100% 里**任意一个 5% 窗口**均值摸到
    //   卡点线(3.2) 就算"有卡点"。它不要求持续、也不要求次数 —— 曲线在 35% 尖一下 3.2、
    //   其余全程贴 0~1，照样判"合格"。这与用户要的"20~80% 基本维持 3、最高 4"正好错位：
    //   用户要的是**平台**，旧判据认的是**尖峰**。
    //   实测证据（工作日志 219 节）：同一关审核线 lateMax=3.0 判"无卡点"→简单关，
    //   而 18 局中位 midLate=4.00 —— 两把尺子打架。
    //
    // 新判据：在 [coverLo, coverHi]（默认 20%~80%）区间里，统计"暂存 ≥ coverBuf"的采样点占比，
    //   达到 coverMin(%) 才算"有卡点"。窗口/阈值都可配。
    var COVER_LO = (opts.coverLo != null) ? +opts.coverLo : 0.20;
    var COVER_HI = (opts.coverHi != null) ? +opts.coverHi : 0.80;
    var COVER_BUF = (opts.coverBuf != null) ? +opts.coverBuf : 3;
    var COVER_MIN = (opts.coverMin != null) ? +opts.coverMin : 0;   // 0 = 不启用覆盖率判据（回到旧口径）
    var _cTot = 0, _cHit = 0, _cPeak = 0, _cSum = 0;
    for (var _ci = 0; _ci < pts.length; _ci++) {
      var _cp = pts[_ci].p;
      if (_cp < COVER_LO || _cp > COVER_HI) continue;
      _cTot++;
      if (pts[_ci].buf >= COVER_BUF) _cHit++;
      if (pts[_ci].buf > _cPeak) _cPeak = pts[_ci].buf;
      _cSum += pts[_ci].buf;
    }
    res.coverLo = COVER_LO; res.coverHi = COVER_HI; res.coverBuf = COVER_BUF;
    res.coverPct = _cTot ? Math.round(_cHit / _cTot * 100) : 0;
    res.coverSamples = _cTot;
    res.coverPeak = _cPeak;
    res.coverAvg = _cTot ? +(_cSum / _cTot).toFixed(2) : 0;
    res.coverMin = COVER_MIN;
    // 覆盖率判据：启用时（coverMin > 0）以它为准；未启用时退回旧的尖峰判据（逐值不变）
    res.hasChokePeak = late.max >= high;                 // 旧口径，保留供对照
    res.hasChoke = (COVER_MIN > 0) ? (res.coverPct >= COVER_MIN) : res.hasChokePeak;
    // 【v118】前期判据改为「不得出现卡点」：比的是卡点线 high，不再是中压线 mid。
    //   用户原话「只要求前期压力不出现卡点即可」——前期允许到中压，只是不能形成卡点。
    res.earlyOK = early.max < earlyCap;   // 【v159】默认 earlyCap===high，行为与改动前逐值一致
    // 暂存峰值需【低于上限】(留 ≥1 空位余量)：触达上限=死亡边界=不合格(全知被迫塞满=真人必死的非法卡点)
    // 用户本轮未要求去掉这条，保留 —— 去掉等于把「真人必死」的关也判合格。
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
    // 「前期之后的最高峰」：v119 起卡点区已覆盖 [30%,100%]，late.max 本身就是该区间最大值，
    //   不必再与子段取大（子段是它的子集）。含义与原式一致。
    var bump = late.max;
    res.bump = bump;
    res.trendOK = res.earlyOK && res.safeEdge &&
                  (bump >= mid) && (bump > early.max);   // 诊断用：前期之后达中压且高于前期
    res.easyPass = res.trendOK;                        // 诊断用；v104 起不参与合格判定

    // v118：阈值 L−1.5→L−1.8、窗口宽全阶段 5%、中期段与 midOK 判据移除、前期判据改为「不得出现卡点」。
    // v119：卡点判定区终点 80% → 100%（后期段纳入判定，用户裁决）。
    //   三档语义与命名仍是 v104 那套（合格 / 简单关·趋势过平 / 不合格），难度分未动。
    res.gateVersion = 'audit-gate-v119';
    // 压力曲线【完整合格】：前期不出卡点 + 中后期确有卡点 + 未触死亡边界
    //   （midOK 已随中期段移除，不再是判据）
    res.curveOK = res.hasChoke && res.earlyOK && res.safeEdge;
    // 压力曲线【趋势过平】：趋势没问题、也没过压，但中后期没形成实际卡点。
    //   用户 2026-08-24 纠正：这类【仍然合格】，只是占「简单关名额」，标记为简单关 + 趋势过平。
    res.flatTrend = !res.hasChoke && res.trendOK;
    res.pass = res.curveOK;                 // pass 专指"有实际卡点"的完整合格（含义与旧 pass 一致）
    res.easyQuota = res.flatTrend;          // 占简单关名额（含义与旧 easyPass 一致，改名以免与难度分档混淆）
    res.easyPass = res.flatTrend;           // 兼容旧字段名，值同 easyQuota
    res.usable = res.curveOK || res.flatTrend;   // 【能不能用】的单一判据
    res.tier = res.curveOK ? '合格' : (res.flatTrend ? '简单关·趋势过平' : '不合格');

    var pctLo = Math.round(CHOKE_LO * 100), pctHi = Math.round(CHOKE_HI * 100);
    var pctEarly = Math.round(EARLY_HI * 100);
    if (!res.hasChoke) res.reasons.push(pctLo + '%~' + pctHi + '%无卡点(峰窗' + late.max + '<卡点线' + res.high + ')' +
      '；分段峰窗 中后期' + pctLo + '-' + Math.round(TAIL_LO * 100) + '% ' + midLate.max +
      ' / 后期' + Math.round(TAIL_LO * 100) + '-100% ' + tail.max +
      (res.hasChokeLegacy ? '；按旧口径50%~100%+' + res.highLegacy + '本有卡点(峰窗' + lateLegacy.max + '@' + lateLegacy.at + '%)' : ''));
    // v118：前期判据由「不超中压」改为「不出现卡点」，文案同步，否则会把读者引到错误的阈值上
    if (!res.earlyOK) res.reasons.push('前期0-' + pctEarly + '%出现卡点(峰窗' + early.max + '≥卡点线' + res.high + ')');
    if (!res.safeEdge) res.reasons.push('暂存峰值' + peak + '触达上限' + L + '(死亡边界，需留余量)');
    if (res.flatTrend) {
      res.reasons.push('趋势过平：前期不出卡点但' + pctLo + '%之后未形成实际卡点(峰' + bump.toFixed(1) +
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
    recalibrateDifficulty: recalibrateDifficulty,   // v121：多轮玩家路线取最稳一条标定难度（不改评分公式）
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
