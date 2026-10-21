/**
 * 蚂蚁拿块 · 难度评分体系 2.0（实验版，与 1.0 长期并行）
 * 任务 `ANT-DIFFICULTY-SYSTEM-V2-20260901`，需求
 *   `codex助理/codex需求文档/09.01-需求文档/2026.09.01-01-难度评分体系2.0并行与卡点效果验证.md`
 *
 * ⚠ 三条硬约束，改本文件前必读：
 *   ① **1.0 一行不动**。本文件不 require、不复制、不改写 `analysis.js` 的
 *      `difficulty()` / `DIFF_CAP` / `DIFF_W` / `gradeOf` —— 只**调用**它们。
 *      f1/f2 的原始值与 cap 逐值沿用 1.0（用 `Analysis.DIFF_CAP`），不另立一套。
 *   ② **2.0 的全部权重与标定都是实验初值**，未经用户裁决**不得**宣布为正式评分、
 *      不得覆盖 1.0 字段、不得用于默认生产或分组。`CALIBRATION_VERSION` 必须随分数一起落库。
 *   ③ **结构指标一律从「最终交付棋盘」现场重数**。禁止用方案目标值 / 计划数 / 抽签数
 *      （`rolls` / `chokePlan`）冒充落地值 —— 这是需求 §四/§五 的红线。
 *
 * 与合格门无关：本文件不读不写 `chokepointAudit`，2.0 分数不参与合格判定。
 */

var AntSolver = AntSolver || {};

AntSolver.AnalysisV2 = (function () {

  /**
   * 标定版本号 —— 任何权重/区间/档位调整都必须同步 bump，否则历史分不可追溯。
   * 版本沿革：
   *   v2-exp1-20260901  首版实验初值。问号已按用户 q2 用 0%~15%；冰块用需求原始 10%~25%。
   *   v2-exp2-20260901  冰块 10%~25% → 5%~20%（用户 2026-09-01「冰块调整为5%-20%」）。**已被 exp3 取代**。
   *                     依据：批次01 实测 A 组 33.3% 的关冰比例 ≤10% → 归一恒 0（B 组 11.6%），下限须下压。
   *                     但实测上限 20% 恰好切在冰比例 p75(20.5%) 上 → **30.6% 的关归一封顶**、
   *                     有区分度反而从 75.8% 掉到 65.3%（比原 10%~25% 还差）。故上限退回 25%。
   *   v2-exp3-20260901  **冰块 5%~25%**（用户 2026-09-01「调整为5-25%吧」）= exp2 的下限 + exp1 的上限。
   *                     批次01 919 关实测：归一恒 0 **4.1%**、封顶 **4.9%**、有区分度 **91.0%** —— 三档里覆盖最好。
   *                     其余权重与区间未动。批次01 落库的 exp1 记录**保留不覆盖**，exp2/exp3 另存对照。
   */
  /**
   * 标定版本号。**每一项影响分数的改动都必须体现在版本号或本注释里**，否则历史分数无法追溯口径。
   * 沿革（用户 2026-09-02 要求把多次改动区分开）：
   *   v2-exp1-20260901              首版实验初值（问号 0~15%、冰块 10~25%）
   *   v2-exp2-20260901              冰块 10~25% → 5~20%
   *   v2-exp3-20260901              冰块 5~20% → 5~25%
   *   v2-exp4-iceGamma-20260902     ① 冰块强度偏移曲线 γ=3.5（原线性）
   *                                 ② 权重再分配：锁链 8%→9.5%、冰块 3.5%→2.0%
   *                                 ③ 冰问号内部改非等权 ice=2.0/5.5、question=3.5/5.5
   *                                 ⚠ 该版号只写了 ①，②③ 未体现 —— 本次已并入下一版号修正
   *   v2-exp5-iceGamma-w-form-20260902（当前）
   *                                 承接 exp4 的 ①②③，并新增
   *                                 ④ 冰块形态系数：同一冰量下按实测簇形态调整得分
   *                                    （用户：「不一定冰块多就越难，而是对应数量和对应难度表现正相关对应分数」）
   *   命名约定：iceGamma=含强度偏移曲线、w=含权重调整、form=含形态系数。
   */
  var CALIBRATION_VERSION = 'v2-exp5-iceGamma-w-form-20260902';

  // ===== 权重（需求 §三 实验初值，合计 1.00）=====
  //   f1 30% + f2 20% + f3 30%(可用空间15 + 锁链8 + 冰问号7) + f4 20%(卡点类型数)
  var W_V2 = {
    f1: 0.30,            // 玩家平均暂存（沿用 1.0 原始值与 cap）
    f2: 0.20,            // 玩家滞留占比（沿用 1.0 原始值与 cap）
    usableSpace: 0.15,   // ↓ f3 结构分共 30%
    // 【2026-09-02 用户裁定】把冰块的 1.5% 划给锁链：锁链 8%→9.5%、冰块 3.5%→2.0%。
    //   依据（本任务实测，非推测）：
    //     锁链 端到端 +18.6 分、相邻档 5/5 段全部显著、玩家侧贡献 57.5%、复活 5.6 倍、通关率 −12.1pp；
    //     冰块占比 端到端 +4.0 分（86% 为定义性上涨）、5 段里 4 段不显著、
    //             结构项对真实难度 r=+0.165（解释 2.7% 方差）、玩家侧贡献约 14%。
    //   问号维持 3.5% 不动（尚未做批次05，无据可调）。
    chain: 0.095,
    iceQuestion: 0.055,  // = 冰块 2.0% + 问号 3.5%
    chokeType: 0.20      // f4
  };

  // ===== 标定区间 =====
  var CAL_V2 = {
    // §4.1 可用空间 U = (总格 − 黑块 − 管道)/总格。**反向**归一：U 越小越难。
    //   U ≥ hi → 本项 0 分；U ≤ lo → 满分；mid 为中间基准（线性下 84% ≈ 50 分）。
    usableSpace: { lo: 0.78, mid: 0.84, hi: 0.90 },
    // §4.3 冰块比例（分母 = 最终盘面盒格数）。
    //   **用户 2026-09-01 两步裁定：10%~25%(exp1) → 5%~20%(exp2) → 最终 5%~25%(exp3)**。
    //   批次01 919 关实测冰比例分位：p05 5.9% / p25 11.1% / 中位 16.3% / p75 20.5% / p90 22.9% / max 30.8%。
    //   三档覆盖对照（恒0 / 封顶 / 有区分度）：
    //     10%~25%  19.3% / 4.9%  / 75.8%   ← 下限太高，A 组 1/3 的关贴地板
    //     5%~20%   4.1%  / 30.6% / 65.3%   ← 上限切在 p75 上，反而三成封顶、覆盖最差
    //     5%~25%   4.1%  / 4.9%  / 91.0%   ← **采用**：地板与天花板同时压住
    // §4.3 冰块比例。区间 5%~25%（用户 2026-09-01 两步裁定，见 §4.1）。
    //   gamma = 强度偏移指数（用户 2026-09-02）：由批次04E 实测真实难度拟合，见 difficultyV2 内注释。
    //   gamma=1 退回线性口径。
    //   useForm=false 可关掉形态系数、退回纯数量口径（用于与历史分数对照）。
    ice: { lo: 0.05, hi: 0.25, gamma: 3.5, useForm: true },
    // §4.3 问号比例。**用户 2026-09-01 裁定改为 0%~15%**（原需求 8%~18%：方案上限 16% 致 18% 不可达、
    //   且 49.1% 的关 ≤8% 归一恒 0；改后恒 0 降到 4.0%、有区分度 94.8%）。
    question: { lo: 0.00, hi: 0.15 },
    // §4.2 锁链组合。**用户 2026-09-01 裁定**：总组封顶 5、3连 最多 3 组、5 组为满分端。
    chain: { maxGroups: 5, max3: 3 },
    // §5.1 卡点类型数。full=8 是需求原锚点，**实测不可达**（普通关 rollsNormal=3 → 上限 3 种，
    //   BOSS rollsBoss=5 → 上限 5 种；且仅 8/12 类有观测）。保留原锚点先出基线，
    //   由批次01 实测分布按用户 q1 反推新锚点后再 bump 版本号。
    chokeType: { full: 8 }
  };

  /**
   * 冰块与问号在合并的 iceQuestion 权重里的内部拆分。
   * 【2026-09-02 用户裁定】冰块 1.5% 划给锁链后：冰块占 2.0%、问号占 3.5%，合计 5.5%。
   *   故内部比例不再等权：ice = 2.0/5.5 = 0.363636…、question = 3.5/5.5 = 0.636364…
   *   这样 iceQuestionNorm × W_V2.iceQuestion 展开后，冰块与问号各自对总分的最大贡献
   *   恰好是 2.0 分与 3.5 分（自检见文件末 SELF_CHECK）。
   */
  var ICE_Q_SPLIT = { ice: 2.0 / 5.5, question: 3.5 / 5.5 };

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  /** 懒解析 1.0 模块 —— 浏览器下受 <script> 顺序影响，不能在闭包初始化时就取。 */
  function A1() { return AntSolver.Analysis; }

  // ============================================================
  // 一、锁链有序档位表（需求 §4.2 + 用户 2026-09-01 裁定的新边界）
  // ============================================================
  /**
   * 按用户给的原 15 档表**推导出的排序规则**生成档位：
   *   先按【总组数升序】，同总组内按【3连组数升序】（3连比2连强 → 排后面）。
   *   原表逐档验证过该规则：1个2连 → 1个3连；2个2连 → 1个2连+1个3连 → 2个3连；… 完全一致。
   * 新边界（用户裁定）：总组 ≤ 5、3连 ≤ 3 → 共 **18 档**，满分端 = 档18「2个2连+3个3连」。
   * 原表的 (0,4)/(1,4)/(0,5) 因 3连>3 被排除。
   */
  function buildChainTiers(maxGroups, max3) {
    var out = [];
    for (var tot = 0; tot <= maxGroups; tot++) {
      var g3Hi = Math.min(tot, max3);
      for (var g3 = 0; g3 <= g3Hi; g3++) out.push({ g2: tot - g3, g3: g3, total: tot });
    }
    return out;
  }
  var CHAIN_TIERS = buildChainTiers(CAL_V2.chain.maxGroups, CAL_V2.chain.max3);

  function chainTierLabel(g2, g3) {
    var s = (g2 ? g2 + '个2连' : '') + (g2 && g3 ? '＋' : '') + (g3 ? g3 + '个3连' : '');
    return s || '0组';
  }

  /**
   * 查档位。越界（总组 > maxGroups 或 3连 > max3 或存在非 2/3 连的组）时：
   *   **封顶到满分端，但 overflow=true 必须另报** —— 需求 §4.2「不得静默当成正常配置」。
   */
  function chainTierOf(g2, g3, gOther) {
    for (var i = 0; i < CHAIN_TIERS.length; i++) {
      if (CHAIN_TIERS[i].g2 === g2 && CHAIN_TIERS[i].g3 === g3) {
        return { tier: i + 1, label: chainTierLabel(g2, g3), overflow: !!gOther, capped: false };
      }
    }
    return {
      tier: CHAIN_TIERS.length, label: chainTierLabel(g2, g3) + (gOther ? '＋' + gOther + '个异常组' : ''),
      overflow: true, capped: true
    };
  }

  // ============================================================
  // 二、最终棋盘结构特征提取（需求 §四：一律现场重数）
  // ============================================================
  /**
   * @param {object} level 已 parseLevel 的关卡（必须是**最终交付**的那一份）
   * @returns {object} 原始结构值 + 警告清单；算不出的项给 null 并进 warnings，**不填 0 冒充**
   */
  /**
   * 【冰块形态提取】四方向连通块统计 + 区域覆盖。
   * @returns {{冰格数,簇数,最大簇,平均簇大小,簇大小分布,区域覆盖数}}
   */
  function iceFormOf(iceGrid, rows, cols) {
    if (!iceGrid) return null;
    var cells = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (iceGrid[r] && iceGrid[r][c]) cells.push({ r: r, c: c });
    }
    if (!cells.length) return { 冰格数: 0, 簇数: 0, 最大簇: 0, 平均簇大小: 0, 簇大小分布: [], 区域覆盖数: 0 };
    var seen = {}, sizes = [];
    for (var i = 0; i < cells.length; i++) {
      var k0 = cells[i].r + ',' + cells[i].c;
      if (seen[k0]) continue;
      var n = 0, st = [cells[i]];
      seen[k0] = 1;
      while (st.length) {
        var p = st.pop(); n++;
        var d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var j = 0; j < 4; j++) {
          var nr = p.r + d[j][0], nc = p.c + d[j][1], kk = nr + ',' + nc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && iceGrid[nr] && iceGrid[nr][nc] && !seen[kk]) {
            seen[kk] = 1; st.push({ r: nr, c: nc });
          }
        }
      }
      sizes.push(n);
    }
    var zone = {};
    for (var z = 0; z < cells.length; z++) {
      zone[Math.min(2, Math.floor(cells[z].r * 3 / rows)) + ',' + Math.min(2, Math.floor(cells[z].c * 3 / cols))] = 1;
    }
    sizes.sort(function (a, b) { return b - a; });
    return {
      冰格数: cells.length, 簇数: sizes.length, 最大簇: sizes[0],
      平均簇大小: +(cells.length / sizes.length).toFixed(3),
      簇大小分布: sizes, 区域覆盖数: Object.keys(zone).length
    };
  }

  /**
   * 【冰块形态系数】用户 2026-09-02：「给冰块本身的权重分要附带不同形态不同难度效力的评分，
   *   不一定冰块多就越难，而是对应数量和对应难度表现正相关对应分数」。
   *
   * 标定来源 = 批次04D 实测真实难度（30 基板同板对照，冰量固定、只改簇大小×簇数），
   *   指标为 Δ需复活轮占比（玩家 13 轮），以**簇2**（实测最优可投产配置、0% 不可解）为 1.00 归一：
   *     簇1 +13.9% → 0.61      簇2 +22.8% → 1.00      簇3 +28.0% → 1.23
   *     簇4 +37.6% → 1.65      簇6 +39.1% → 1.71      簇8 +5.6%  → 0.25      簇12 +10.9% → 0.48
   *   簇 4~6 是难度峰值、簇 8 以上断崖垮掉（一整片冰只需推理一次、可绕行）——
   *   这正是「不一定冰块多就越难」的实证形状，倒 U 形，不能用线性系数表达。
   *   簇 5 与 7 无实测点，按相邻档线性插值；>12 沿用 12 的值。
   *
   * @param {object} form iceFormOf 的返回
   * @returns {{系数:number, 依据:string, 平均簇大小:number}|null}
   */
  function iceFormFactor(form) {
    if (!form || !form.冰格数) return null;
    var KNOTS = [
      { s: 1, k: 0.61 }, { s: 2, k: 1.00 }, { s: 3, k: 1.23 }, { s: 4, k: 1.65 },
      { s: 5, k: 1.68 }, { s: 6, k: 1.71 }, { s: 7, k: 0.98 }, { s: 8, k: 0.25 },
      { s: 12, k: 0.48 }
    ];
    var m = form.平均簇大小;
    var k;
    if (m <= KNOTS[0].s) k = KNOTS[0].k;
    else if (m >= KNOTS[KNOTS.length - 1].s) k = KNOTS[KNOTS.length - 1].k;
    else {
      for (var i = 0; i < KNOTS.length - 1; i++) {
        if (m >= KNOTS[i].s && m <= KNOTS[i + 1].s) {
          var t = (m - KNOTS[i].s) / (KNOTS[i + 1].s - KNOTS[i].s);
          k = KNOTS[i].k + t * (KNOTS[i + 1].k - KNOTS[i].k);
          break;
        }
      }
    }
    return {
      系数: +k.toFixed(4), 平均簇大小: m,
      依据: '批次04D 实测 Δ需复活轮占比，以簇2 为 1.00 归一；簇4~6 为峰值、簇8+ 垮掉（倒 U 形）'
    };
  }

  function extractStructFeatures(level) {
    var warn = [];
    var b = level && level.board;
    if (!b || !b.cells || !b.rows || !b.cols) {
      return { ok: false, warnings: ['缺 board/cells，结构特征无法提取'] };
    }
    var R = b.rows, C = b.cols, total = R * C;
    var black = 0, pipe = 0, boxCells = 0, iceCells = 0, qCells = 0, iceSum = 0;
    var groups = {};                                  // chainId -> 成员坐标
    var iceGrid = [], chainGrid = [];
    var r, c, cl;
    for (r = 0; r < R; r++) {
      iceGrid.push([]); chainGrid.push([]);
      for (c = 0; c < C; c++) {
        cl = b.cells[r] && b.cells[r][c];
        iceGrid[r].push(false); chainGrid[r].push(0);
        if (!cl) continue;
        if (cl.t === 'black') { black++; continue; }
        if (cl.t === 'pipe') { pipe++; continue; }
        if (cl.t !== 'box') continue;
        boxCells++;
        if (cl.ice > 0) { iceCells++; iceSum += cl.ice; iceGrid[r][c] = true; }
        if (cl.q) qCells++;
        if (cl.chain > 0) {
          chainGrid[r][c] = cl.chain;
          (groups[cl.chain] = groups[cl.chain] || []).push({ r: r, c: c });
        }
      }
    }

    // 锁链：只算**成员完整**的 2 连/3 连组（需求 §4.2 明确要求）
    var g2 = 0, g3 = 0, gOther = 0, gOtherSizes = [];
    Object.keys(groups).forEach(function (k) {
      var n = groups[k].length;
      if (n === 2) g2++; else if (n === 3) g3++; else { gOther++; gOtherSizes.push(n); }
    });
    var gTotal = g2 + g3 + gOther;
    var tier = chainTierOf(g2, g3, gOther);
    if (tier.overflow) {
      warn.push('锁链组合越界：2连=' + g2 + ' 3连=' + g3 +
        (gOther ? ' 异常成员数组=' + gOtherSizes.join('/') : '') +
        '（边界 总组≤' + CAL_V2.chain.maxGroups + ' 且 3连≤' + CAL_V2.chain.max3 + '），已封顶到档' + tier.tier);
    }

    var U = total > 0 ? (total - black - pipe) / total : null;
    if (boxCells === 0) warn.push('盒格数为 0，冰/问号比例无分母');
    var icePct = boxCells ? iceCells / boxCells : null;
    var qPct = boxCells ? qCells / boxCells : null;

    return {
      ok: true,
      rows: R, cols: C, totalCells: total, blackCells: black, pipeCells: pipe, boxCells: boxCells,
      usableSpace: U,
      iceCells: iceCells, iceDurabilitySum: iceSum, icePct: icePct,
      // 【冰块形态】用户 2026-09-02：「不一定冰块多就越难，而是对应数量和对应难度表现正相关对应分数」。
      //   批次04D 实测（30 基板同板对照、固定冰量穷举簇大小×簇数）：真实难度对簇大小是**倒 U 形**，
      //   峰值在簇 4~6，簇 8 以上断崖垮掉。故必须把形态作为独立观测量提取出来参与评分。
      iceForm: iceFormOf(iceGrid, R, C),
      questionCells: qCells, questionPct: qPct,
      chain: {
        g2: g2, g3: g3, other: gOther, otherSizes: gOtherSizes, totalGroups: gTotal,
        tier: tier.tier, tierLabel: tier.label, tierCount: CHAIN_TIERS.length,
        overflow: tier.overflow, capped: tier.capped
      },
      // 供卡点结构化检出复用，避免二次遍历
      _grids: { iceGrid: iceGrid, chainGrid: chainGrid, groups: groups },
      warnings: warn
    };
  }

  // ============================================================
  // 三、落地卡点类型（需求 §5.1：只算**实际成功落地**的不同类型数）
  // ============================================================
  /** 12 类清单与可观测性。`observable` = 生成器是否会写 `chokeMarks`。 */
  var CHOKE_TYPES_V2 = [
    { key: 'narrowPath', cn: '窄路墙缺口', observable: true, detect: 'weak' },
    { key: 'iceCluster', cn: '冰块簇聚集', observable: true, detect: 'strong' },
    { key: 'chainCluster', cn: '锁链簇聚集', observable: true, detect: 'strong' },
    { key: 'questionCluster', cn: '问号聚集', observable: true, detect: 'moderate' },
    { key: 'chainIce', cn: '冰叠锁链', observable: true, detect: 'exact' },
    { key: 'pipeChain', cn: '管道口叠锁链', observable: true, detect: 'strong' },
    { key: 'narrowGapIce', cn: '窄路口叠冰', observable: true, detect: 'weak' },
    { key: 'narrowGapChain', cn: '窄路口叠锁链', observable: true, detect: 'weak' },
    // ⚠ 以下 4 类 `stage:'post'`，生成器**一次 mark() 都没有**、`chokeStat` 里也没有
    //    → 无论新产还是已上线批次都拿不到落地记录。用户 2026-09-01 裁定「先不补 mark()」。
    { key: 'bigBox', cn: '超大盒', observable: false, detect: 'ambiguous' },
    { key: 'rareColorKey', cn: '稀有色占关键位', observable: false, detect: 'unavailable' },
    { key: 'swap', cn: '换球/藏管道', observable: false, detect: 'unavailable' },
    { key: 'inflate', cn: '增容', observable: false, detect: 'ambiguous' }
  ];
  var OBSERVABLE_COUNT = CHOKE_TYPES_V2.filter(function (t) { return t.observable; }).length; // = 8

  /**
   * 【首选口径】从生产侧 `chokeMarks` 取精确落地类型（B 组：新生产的关卡）。
   * `chokeMarks` 一条 = 一个落地位置，含 `type`；去重即落地类型集合。
   */
  function landedChokeTypesFromMarks(chokeMarks) {
    var set = {}, n = 0;
    (chokeMarks || []).forEach(function (m) {
      if (m && m.type && !set[m.type]) { set[m.type] = 1; n++; }
    });
    return {
      source: 'chokeMarks', exact: true, count: n, types: Object.keys(set),
      coverage: OBSERVABLE_COUNT, note: '仅覆盖有 mark() 的 ' + OBSERVABLE_COUNT + '/12 类'
    };
  }

  /**
   * 【备用口径】从最终棋盘**结构化反推**落地类型（A 组：已上线批次没存 chokeMarks）。
   * 只认有明确局部特征的类型，其余一律不猜。返回值必须当作**下界**使用。
   * 阈值与 `generator.js` DEFAULT_CONFIG 对齐（iceClusterSizeMin=4、questionClusterRadius=2）。
   */
  function detectChokeTypesFromBoard(level, feat, config) {
    config = config || {};
    var f = feat || extractStructFeatures(level);
    if (!f.ok) return { source: 'board', exact: false, count: 0, types: [], warnings: f.warnings };
    var b = level.board, R = f.rows, C = f.cols;
    var iceGrid = f._grids.iceGrid, chainGrid = f._grids.chainGrid, groups = f._grids.groups;
    var hit = {}, evidence = {};
    var D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var r, c, i;

    // ① chainIce 冰叠锁链 —— 同格 ice>0 且 chain>0。**唯一无歧义**的特征
    var chainIceCells = 0;
    for (r = 0; r < R; r++) for (c = 0; c < C; c++) if (iceGrid[r][c] && chainGrid[r][c] > 0) chainIceCells++;
    if (chainIceCells > 0) { hit.chainIce = 1; evidence.chainIce = { cells: chainIceCells }; }

    // ② iceCluster 冰块簇 —— 冰的 4-连通块 ≥ iceClusterSizeMin
    var icMin = config.iceClusterSizeMin != null ? config.iceClusterSizeMin : 4;
    var seen = [], maxIceComp = 0;
    for (r = 0; r < R; r++) { seen.push([]); for (c = 0; c < C; c++) seen[r].push(false); }
    for (r = 0; r < R; r++) for (c = 0; c < C; c++) {
      if (!iceGrid[r][c] || seen[r][c]) continue;
      var st = [[r, c]], sz = 0; seen[r][c] = true;
      while (st.length) {
        var p = st.pop(); sz++;
        for (i = 0; i < 4; i++) {
          var nr = p[0] + D4[i][0], nc = p[1] + D4[i][1];
          if (nr < 0 || nc < 0 || nr >= R || nc >= C) continue;
          if (!iceGrid[nr][nc] || seen[nr][nc]) continue;
          seen[nr][nc] = true; st.push([nr, nc]);
        }
      }
      if (sz > maxIceComp) maxIceComp = sz;
    }
    if (maxIceComp >= icMin) { hit.iceCluster = 1; evidence.iceCluster = { maxComponent: maxIceComp, threshold: icMin }; }

    // ③ chainCluster 锁链簇 —— 存在两个不同锁链组彼此 8-邻接（生成器规划期按 8-邻接放开）
    var adjPairs = 0;
    for (r = 0; r < R; r++) for (c = 0; c < C; c++) {
      var g = chainGrid[r][c]; if (!g) continue;
      for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        var ar = r + dr, ac = c + dc;
        if (ar < 0 || ac < 0 || ar >= R || ac >= C) continue;
        var g2v = chainGrid[ar][ac];
        if (g2v && g2v !== g) adjPairs++;
      }
    }
    if (adjPairs > 0) { hit.chainCluster = 1; evidence.chainCluster = { adjacentCellPairs: adjPairs }; }

    // ④ pipeChain 管道口叠锁链 —— 锁链格与管道格 4-邻接
    var pipeAdjChain = 0;
    for (r = 0; r < R; r++) for (c = 0; c < C; c++) {
      if (!chainGrid[r][c]) continue;
      for (i = 0; i < 4; i++) {
        var pr = r + D4[i][0], pc = c + D4[i][1];
        if (pr < 0 || pc < 0 || pr >= R || pc >= C) continue;
        var pcl = b.cells[pr] && b.cells[pr][pc];
        if (pcl && pcl.t === 'pipe') pipeAdjChain++;
      }
    }
    if (pipeAdjChain > 0) { hit.pipeChain = 1; evidence.pipeChain = { chainCellsNextToPipe: pipeAdjChain }; }

    // ⑤ questionCluster 问号聚集 —— 存在 ≥3 个问号格落在半径 questionClusterRadius 的曼哈顿邻域内
    var qRad = config.questionClusterRadius != null ? config.questionClusterRadius : 2;
    var qs = [];
    for (r = 0; r < R; r++) for (c = 0; c < C; c++) {
      var qc = b.cells[r] && b.cells[r][c];
      if (qc && qc.t === 'box' && qc.q) qs.push({ r: r, c: c });
    }
    var bestQ = 0;
    for (i = 0; i < qs.length; i++) {
      var cnt = 0;
      for (var j = 0; j < qs.length; j++) {
        if (Math.abs(qs[i].r - qs[j].r) + Math.abs(qs[i].c - qs[j].c) <= qRad) cnt++;
      }
      if (cnt > bestQ) bestQ = cnt;
    }
    if (bestQ >= 3) { hit.questionCluster = 1; evidence.questionCluster = { maxInRadius: bestQ, radius: qRad }; }

    // ⑥ narrowPath 窄路墙 —— 存在某一行黑块占比 ≥60% 且缺口 ≤4（生成器缺口 narrowPathGapsMin/Max=2~3）。
    //    ⚠ 弱判据：斜向/楼梯形窄路墙不落在单行上，会漏判；分散黑块极端聚集时会误判。仅作下界。
    var wallRow = null, wallGaps = null;
    for (r = 0; r < R; r++) {
      var blk = 0;
      for (c = 0; c < C; c++) { var wc = b.cells[r] && b.cells[r][c]; if (wc && wc.t === 'black') blk++; }
      var gaps = C - blk;
      if (blk >= Math.ceil(C * 0.6) && gaps <= 4) { wallRow = r; wallGaps = gaps; break; }
    }
    if (wallRow !== null) {
      hit.narrowPath = 1; evidence.narrowPath = { row: wallRow, gaps: wallGaps, confidence: 'weak' };
      // ⑦⑧ 窄路口叠冰 / 叠锁链 —— 只在识别出窄路行时，看该行缺口所在列的上下相邻盒
      var gapIce = 0, gapChain = 0;
      for (c = 0; c < C; c++) {
        var g0 = b.cells[wallRow] && b.cells[wallRow][c];
        if (g0 && g0.t === 'black') continue;                 // 不是缺口
        [[-1, 0], [1, 0], [0, 0]].forEach(function (d) {
          var gr = wallRow + d[0], gc = c + d[1];
          if (gr < 0 || gc < 0 || gr >= R || gc >= C) return;
          if (iceGrid[gr][gc]) gapIce++;
          if (chainGrid[gr][gc]) gapChain++;
        });
      }
      if (gapIce > 0) { hit.narrowGapIce = 1; evidence.narrowGapIce = { cells: gapIce, confidence: 'weak' }; }
      if (gapChain > 0) { hit.narrowGapChain = 1; evidence.narrowGapChain = { cells: gapChain, confidence: 'weak' }; }
    }

    var types = Object.keys(hit);
    return {
      source: 'board', exact: false, count: types.length, types: types, evidence: evidence,
      coverage: OBSERVABLE_COUNT,
      note: '结构化反推**下界**：仅覆盖 ' + OBSERVABLE_COUNT + '/12 类（4 个 post 类型无任何观测）；' +
            'narrowPath/narrowGapIce/narrowGapChain 为弱判据（斜向窄路墙会漏判）',
      warnings: (groups && Object.keys(groups).length === 0 && hit.chainCluster) ? ['无锁链组却判出锁链簇，逻辑异常'] : []
    };
  }

  // ============================================================
  // 四、2.0 评分
  // ============================================================
  /**
   * 计算 2.0 分数。**必须与 1.0 用同一条最终关卡、同一玩法、同一全知结果、同一条代表玩家路线**
   * （需求 §2.2 / §6.3-7）—— 因此 f1/f2 直接用传入的同一份 `playerStats` 经 1.0 的 cap 归一，
   * 而不是自己再跑一遍玩家模拟。
   *
   * @param {object} level      已 parseLevel 的**最终**关卡
   * @param {object} omni       全知求解结果（同一份，只求一次）
   * @param {object} playerStats 代表路线的玩家统计 { won, avgBuffer, peak, revives, avgResidence, effectiveTicks, residenceCount }
   * @param {object} [opts] {
   *     struct        已提取的结构特征（省一次遍历）
   *     choke         落地卡点结果（landedChokeTypesFromMarks / detectChokeTypesFromBoard 的返回）
   *     config        生成参数（供结构化检出的阈值对齐）
   *     diffOpts      透传给 1.0 difficulty 的 opts
   *   }
   * @returns {object} 2.0 结果 + 同源的 1.0 结果 + 逐项归一/加权明细 + 警告
   */
  function difficultyV2(level, omni, playerStats, opts) {
    opts = opts || {};
    var A = A1();
    if (!A || typeof A.difficulty !== 'function') {
      return { ok: false, warnings: ['analysis.js(1.0) 未加载，2.0 拒绝独立出分'] };
    }
    var warn = [];

    // ---- 1.0 同源分（权威，一行不改，只调用）----
    var d1 = A.difficulty(level, omni, playerStats, opts.diffOpts);

    // ---- 结构特征 ----
    var f = opts.struct || extractStructFeatures(level);
    if (!f.ok) return { ok: false, warnings: (f.warnings || []).concat(['结构特征缺失，2.0 不出分']) };
    warn = warn.concat(f.warnings || []);

    // ---- 落地卡点类型 ----
    var ck = opts.choke || detectChokeTypesFromBoard(level, f, opts.config);
    if (ck.warnings && ck.warnings.length) warn = warn.concat(ck.warnings);

    // ---- f1 / f2：沿用 1.0 的原始值与 cap（不另立标定）----
    var cap = (opts.diffOpts && opts.diffOpts.cap) || A.DIFF_CAP;
    var pAvg = playerStats ? (playerStats.avgBuffer || 0) : 0;
    var effT = playerStats ? (playerStats.effectiveTicks || 0) : 0;
    var pRes = playerStats ? (playerStats.avgResidence || 0) : 0;
    var resRatio = effT > 0 ? (pRes / effT) : 0;
    var f1Norm = clamp(pAvg / cap.f1 * 100, 0, 100);
    var f2Norm = clamp(resRatio / cap.f2 * 100, 0, 100);
    // 一致性自检：与 1.0 自己报的 parts 应只差取整
    if (d1 && d1.parts) {
      if (Math.abs(Math.round(f1Norm) - d1.parts.f1) > 1) warn.push('f1 归一与 1.0 不一致(' + Math.round(f1Norm) + ' vs ' + d1.parts.f1 + ')');
      if (Math.abs(Math.round(f2Norm) - d1.parts.f2) > 1) warn.push('f2 归一与 1.0 不一致(' + Math.round(f2Norm) + ' vs ' + d1.parts.f2 + ')');
    }

    // ---- f3-a 可用空间（反向归一：U 越小越难）----
    var cu = CAL_V2.usableSpace, U = f.usableSpace;
    var usableSpaceNorm = (U == null) ? null : clamp((cu.hi - U) / (cu.hi - cu.lo) * 100, 0, 100);
    if (U == null) warn.push('可用空间 U 算不出');
    else if (U >= cu.hi) warn.push('可用空间 U=' + (U * 100).toFixed(1) + '% ≥ 上限 ' + (cu.hi * 100) + '% → 本项恒 0 分');
    else if (U <= cu.lo) warn.push('可用空间 U=' + (U * 100).toFixed(1) + '% ≤ 下限 ' + (cu.lo * 100) + '% → 本项封顶');

    // ---- f3-b 锁链档位（首轮**等距映射**，需求 §4.2 明确要求不得作为最终曲线）----
    var chainNorm = (f.chain.tierCount > 1)
      ? (f.chain.tier - 1) / (f.chain.tierCount - 1) * 100 : 0;

    // ---- f3-c 冰块 + 问号（首轮等权，需求 §4.3 要求分别报独立影响）----
    var ci = CAL_V2.ice, cq = CAL_V2.question;
    // 【冰块强度偏移曲线 · 用户 2026-09-02 裁定】
    //   原口径是线性映射：5%→0、25%→100，每个百分点均摊 5 分。
    //   但批次04E 的同板对照实测（用户预算方案 A，24 块基板 × 5 个占比档）显示
    //   **真实难度在 5%~15% 区间不上升、甚至略负**，到 20% 才转正、25% 才明显：
    //       5%: −2.9%   10%: −1.3%   15%: −3.7%   20%: +6.4%   25%: +17.5%（Δ需复活轮占比）
    //   线性映射会在真实难度不涨的低冰区照样给分（10%→25 分、15%→50 分），造成分数虚高。
    //   用户裁定：「将冰块本身的分数权重做强度偏移即可，5% 以下都只给基础分或者 0 分，
    //             多余的分数给到后面有强度的位置」。
    //   实现：幂曲线 iceNorm = 100 × ((icePct − lo) / (hi − lo)) ^ gamma
    //   gamma 由上面 5 个锚点的实测真实难度拟合而来（地板归零后按最大值归一）：
    //       gamma=3.0 RMSE 0.0615 / 3.5 RMSE 0.0397 / 4.0 RMSE 0.0359 / 4.5 RMSE 0.0459
    //   取 gamma=3.5：与 4.0 在统计上分不出高下（仅 5 个锚点），但在 20% 这个转折点几乎精确命中
    //   （36.5 对实测目标 36.7），且不会把 10%~15% 压成完全死区、仍保留基础分。
    //   落地后各档得分：5%→0、10%→0.8、15%→8.8、20%→36.5、25%→100。
    //   gamma=1 即退回原线性口径，便于回溯对照。
    var iceGamma = (ci.gamma != null) ? ci.gamma : 1;
    // 数量分：占比经强度偏移曲线
    var iceCountNorm = (f.icePct == null) ? null
      : clamp(Math.pow(clamp((f.icePct - ci.lo) / (ci.hi - ci.lo), 0, 1), iceGamma) * 100, 0, 100);
    // 【形态系数 · 用户 2026-09-02】同一冰量下，簇形态决定实际难度效力（批次04D 实测倒 U 形，
    //   簇4~6 峰值、簇8+ 垮掉）。故冰块得分 = 数量分 × 形态系数，再封顶 100。
    //   形态缺失（老数据无 iceForm）时系数取 1，退回纯数量口径，不静默改变历史分数的量级。
    var iceFF = (ci.useForm === false) ? null : iceFormFactor(f.iceForm);
    var iceFormK = iceFF ? iceFF.系数 : 1;
    var iceNorm = (iceCountNorm == null) ? null : clamp(iceCountNorm * iceFormK, 0, 100);
    var questionNorm = (f.questionPct == null) ? null : clamp((f.questionPct - cq.lo) / (cq.hi - cq.lo) * 100, 0, 100);
    if (f.icePct != null && f.icePct <= ci.lo) warn.push('冰块比例 ' + (f.icePct * 100).toFixed(1) + '% ≤ 下限 ' + (ci.lo * 100) + '% → 归一恒 0');
    if (f.questionPct != null && f.questionPct >= cq.hi) warn.push('问号比例 ' + (f.questionPct * 100).toFixed(1) + '% ≥ 上限 ' + (cq.hi * 100) + '% → 归一封顶');
    var iceQuestionNorm = (iceNorm == null && questionNorm == null) ? null
      : (iceNorm == null ? questionNorm : (questionNorm == null ? iceNorm
        : iceNorm * ICE_Q_SPLIT.ice + questionNorm * ICE_Q_SPLIT.question));

    // ---- f4 卡点类型数 ----
    var ctFull = CAL_V2.chokeType.full;
    var chokeTypeNorm = clamp(ck.count / ctFull * 100, 0, 100);
    if (ck.count > ctFull) warn.push('落地卡点类型 ' + ck.count + ' > 满分端 ' + ctFull + ' → 封顶（保留实际数量）');
    if (ck.count === 0) warn.push('落地卡点类型数为 0（名额空转或无观测）→ f4 恒 0');
    if (!ck.exact) warn.push('f4 来自结构化反推，是**下界**不是精确值');

    // ---- 合成 ----
    var missing = [];
    if (usableSpaceNorm == null) missing.push('usableSpace');
    if (iceQuestionNorm == null) missing.push('iceQuestion');
    if (missing.length) {
      // 缺字段**不静默记 0**（需求 §二 明令禁止），直接拒绝出分
      return {
        ok: false, calibrationVersion: CALIBRATION_VERSION, oneZero: d1,
        warnings: warn.concat(['缺字段 ' + missing.join('/') + ' → 2.0 不出分，标记为「未计算/缺字段」'])
      };
    }
    var coreV2 = f1Norm * W_V2.f1 + f2Norm * W_V2.f2
      + usableSpaceNorm * W_V2.usableSpace + chainNorm * W_V2.chain
      + iceQuestionNorm * W_V2.iceQuestion + chokeTypeNorm * W_V2.chokeType;
    var revives = playerStats ? (playerStats.revives || 0) : 0;
    var reviveBonus = revives * 8;                       // 沿用 1.0，本轮不改
    var scoreV2 = clamp(Math.round(coreV2 + reviveBonus), 0, 100);
    var playerWon = !!(playerStats && playerStats.won);
    if (scoreV2 >= 100) warn.push('2.0 总分封顶 100');

    return {
      ok: true,
      scoreSystemVersion: '2.0',
      calibrationVersion: CALIBRATION_VERSION,
      score: scoreV2,
      grade: A.gradeOf(scoreV2),                          // 沿用 1.0 等级边界
      rankable: playerWon,                                // 沿用 1.0：未通关不得进正式排序
      playerWon: playerWon,
      core: +coreV2.toFixed(2),
      reviveBonus: reviveBonus,
      parts: {
        f1: { raw: pAvg, cap: cap.f1, norm: +f1Norm.toFixed(2), weight: W_V2.f1, weighted: +(f1Norm * W_V2.f1).toFixed(2) },
        f2: { raw: resRatio, cap: cap.f2, norm: +f2Norm.toFixed(2), weight: W_V2.f2, weighted: +(f2Norm * W_V2.f2).toFixed(2) },
        usableSpace: { raw: U, cal: cu, norm: +usableSpaceNorm.toFixed(2), weight: W_V2.usableSpace, weighted: +(usableSpaceNorm * W_V2.usableSpace).toFixed(2) },
        chain: {
          g2: f.chain.g2, g3: f.chain.g3, totalGroups: f.chain.totalGroups,
          tier: f.chain.tier, tierLabel: f.chain.tierLabel, tierCount: f.chain.tierCount,
          mapping: 'equidistant-exp1', overflow: f.chain.overflow,
          norm: +chainNorm.toFixed(2), weight: W_V2.chain, weighted: +(chainNorm * W_V2.chain).toFixed(2)
        },
        iceQuestion: {
          icePct: f.icePct, iceNorm: iceNorm == null ? null : +iceNorm.toFixed(2),
          iceCountNorm: iceCountNorm == null ? null : +iceCountNorm.toFixed(2),
          iceForm: f.iceForm || null, iceFormFactor: iceFF,
          iceGamma: iceGamma, iceCurve: '100×((icePct−' + ci.lo + ')/(' + (ci.hi - ci.lo) + '))^' + iceGamma,
          questionPct: f.questionPct, questionNorm: questionNorm == null ? null : +questionNorm.toFixed(2),
          split: ICE_Q_SPLIT, norm: +iceQuestionNorm.toFixed(2),
          weight: W_V2.iceQuestion, weighted: +(iceQuestionNorm * W_V2.iceQuestion).toFixed(2)
        },
        chokeType: {
          count: ck.count, types: ck.types, source: ck.source, exact: !!ck.exact,
          full: ctFull, coverage: ck.coverage, evidence: ck.evidence || null,
          norm: +chokeTypeNorm.toFixed(2), weight: W_V2.chokeType, weighted: +(chokeTypeNorm * W_V2.chokeType).toFixed(2)
        }
      },
      struct: {
        rows: f.rows, cols: f.cols, totalCells: f.totalCells, boxCells: f.boxCells,
        blackCells: f.blackCells, pipeCells: f.pipeCells,
        iceCells: f.iceCells, questionCells: f.questionCells
      },
      // 同源的 1.0 分（**不覆盖、不改写**，只并列输出便于对照）
      oneZero: {
        scoreSystemVersion: '1.0', score: d1.score, grade: d1.grade,
        rankable: d1.rankable, scoreVersion: d1.scoreVersion, parts: d1.parts
      },
      delta: { score: scoreV2 - d1.score, gradeChanged: A.gradeOf(scoreV2) !== d1.grade },
      warnings: warn
    };
  }

  var FIELD_NOTES_V2 = {
    '版本并行': '1.0 与 2.0 长期并行。2.0 不得覆盖 1.0 字段、不得因 2.0 重算或重排已上线关卡；' +
      '缺 2.0 结构数据的旧关卡保留其 1.0 分并标「未计算/缺字段」，不记 0。',
    'f1/f2': '沿用 1.0 原始值与 DIFF_CAP，权重降为 30%/20%。必须与 1.0 用同一条代表玩家路线。',
    'f3 结构分 30%': '可用空间 15%（反向：U 越小越难）+ 锁链档位 8% + 冰块问号 7%（首轮等权）。',
    'f4 卡点类型数 20%': '只算实际落地的不同类型数。⚠ 生成器仅 8/12 类写 chokeMarks，' +
      '另 4 类(bigBox/rareColorKey/swap/inflate)无任何观测；满分端 8 在现行方案下不可达' +
      '(普通关 rollsNormal=3 → 上限 3 种)。锚点待批次01 实测后按用户 q1 反推。',
    '锁链档位': '用户 2026-09-01 裁定：总组≤5、3连≤3 → 18 档，满分端「2个2连+3个3连」。' +
      '首轮等距映射到 0~100 仅用于观察分布，正式间距须按实测压力影响调整。',
    '问号区间': '用户 2026-09-01 裁定改为 0%~15%（原 8%~18% 致 49.1% 的关归一恒 0、上限不可达）。',
    '与合格门': '完全解耦。2.0 不参与 audit.pass 判定，本文件不读写 chokepointAudit。'
  };

  return {
    CALIBRATION_VERSION: CALIBRATION_VERSION,
    W_V2: W_V2, CAL_V2: CAL_V2, ICE_Q_SPLIT: ICE_Q_SPLIT,
    CHAIN_TIERS: CHAIN_TIERS, CHOKE_TYPES_V2: CHOKE_TYPES_V2, OBSERVABLE_COUNT: OBSERVABLE_COUNT,
    buildChainTiers: buildChainTiers,
    chainTierLabel: chainTierLabel,
    chainTierOf: chainTierOf,
    extractStructFeatures: extractStructFeatures,
    iceFormOf: iceFormOf,               // 冰块形态提取（用户 2026-09-02）
    iceFormFactor: iceFormFactor,       // 冰块形态系数（标定自批次04D 实测）
    landedChokeTypesFromMarks: landedChokeTypesFromMarks,
    detectChokeTypesFromBoard: detectChokeTypesFromBoard,
    difficultyV2: difficultyV2,
    FIELD_NOTES_V2: FIELD_NOTES_V2
  };
})();

// Node 环境导出（供批量实验脚本复用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AntSolver.AnalysisV2;
}
