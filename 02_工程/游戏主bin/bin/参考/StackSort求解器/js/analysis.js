/**
 * StackSort 求解器 - 分析模块（难度评分 + 障碍中文命名 + 多轮求解统计）
 *
 * Node(bench/analyze) 与 网页(app) 共用同一套逻辑，保证两边口径一致。
 * 详细难度体系见 难度评分体系.md。
 */
var SS = SS || {};

SS.Analysis = (function () {

  // ---- 障碍中文命名 ----
  var OBS_CN = {
    Surprise: '问号', Ice: '冰块', LinkedCards: '捆绑', Link: '捆绑',
    FixedColor: '限定色', Fixed: '限定色', Rock: '石墙',
    Dual: '双色块', KeyLock: '锁定列', CoveredColor: '指定颜色消除', Covered: '指定颜色消除',
    Bomb: '炸弹'
  };

  // 障碍分级
  var OBS_SIMPLE = { Surprise: 1, LinkedCards: 1, Bomb: 1 };          // 简单：推理/时间压力
  var OBS_MED = { FixedColor: 1, Dual: 1 };                          // 中等：限定色 / 双色块
  var OBS_HARD = { Ice: 1, Rock: 1, CoveredColor: 1, KeyLock: 1 };   // 困难：遮挡列，需前置条件
  // 各障碍基础难度权重
  var OBS_W = {
    Surprise: 3, LinkedCards: 5, Bomb: 6,
    FixedColor: 6, Dual: 14,
    Ice: 12, Rock: 13, CoveredColor: 12, KeyLock: 13
  };

  // 难度分项权重：含求解表现时 / 不含时（不含则按旧四项归一）
  // ★颜色项已移除（绝大多数关是满色平衡盘 → 颜色项恒满分=无意义地板分；少数"一色多列"降难度的影响有限）。
  //   原 0.10 颜色权重分给 障碍 / 步数压力 / 求解表现（行数不变）。
  // 障碍 > 步数压力 > 求解表现 > 行数
  var WEIGHTS = { obs: 0.34, pressure: 0.28, behavior: 0.21, row: 0.17 };
  var WEIGHTS_NB = { obs: 0.41, pressure: 0.34, row: 0.25 }; // 无求解表现时（颜色已移除）

  // 决策模式（与 solver 的 DECISION_MODES 对齐）
  var MODES = [
    { name: 'gated', opts: { commitMode: 'gated' } },
    { name: 'always', opts: { commitMode: 'always' } },
    { name: 'dual', opts: { commitMode: 'gated', dualPriority: true } },
    { name: 'dualLk', opts: { commitMode: 'always', dualPriority: true } },
    { name: 'gatedX', opts: { commitMode: 'gated', expandTransit: true } }
  ];

  // ---- 从引擎 state 提取障碍类型（规范化 key）----
  function obstaclesFromState(state) {
    var s = {};
    for (var c = 0; c < state.colCount; c++) {
      if (state.iceReq && state.iceReq[c] > 0) s['Ice'] = 1;
      if (state.rockLocked && state.rockLocked[c]) s['Rock'] = 1;
      if (state.coverReq && state.coverReq[c]) s['CoveredColor'] = 1;
      if (state.fixedColor && state.fixedColor[c]) s['FixedColor'] = 1;
      var col = state.columns[c];
      for (var i = 0; i < col.length; i++) {
        var cell = col[i];
        if (!cell) continue;
        if (cell.kind === 'dual') s['Dual'] = 1;
        if (cell.bomb != null) s['Bomb'] = 1;
        if (cell.features) {
          if (cell.features.indexOf('Surprise') !== -1) s['Surprise'] = 1;
          if (cell.features.indexOf('Lock') !== -1 || cell.features.indexOf('Key') !== -1) s['KeyLock'] = 1;
        }
      }
    }
    if (state.links && state.links.length) s['LinkedCards'] = 1;
    if (state.bombs && state.bombs.length) s['Bomb'] = 1;
    return Object.keys(s);
  }

  // 障碍中文组合串
  function obstacleNamesCN(obsKeys) {
    if (!obsKeys.length) return '无';
    return obsKeys.map(function (o) { return OBS_CN[o] || o; }).join('+');
  }

  // 障碍分级标签（困难/中等/简单 · 单一/组合）
  function obsLevelTag(obsKeys) {
    if (!obsKeys.length) return '无';
    var hard = obsKeys.some(function (o) { return OBS_HARD[o]; });
    var med = obsKeys.some(function (o) { return OBS_MED[o]; });
    var tier = hard ? '困难' : (med ? '中等' : '简单');
    var combo = obsKeys.length > 1 ? '组合' : '单一';
    return tier + '·' + combo;
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function countColorKinds(state) {
    var set = {};
    for (var c = 0; c < state.colCount; c++) {
      var col = state.columns[c];
      for (var i = 0; i < col.length; i++) {
        var cell = col[i];
        if (cell && (cell.kind === 'color' || cell.kind === 'dual') && cell.colorKey) set[cell.colorKey] = 1;
      }
    }
    return Object.keys(set).length;
  }

  function gradeOf(s) {
    if (s < 31) return '简单';   // 0-30
    if (s < 61) return '普通';   // 31-60
    if (s < 81) return '困难';   // 61-80
    return '极难';               // 81-100
  }

  // ---- 难度评分 ----
  // solveStats（可选）：{ successRate, avg } —— 求解器表现，反映障碍数量/参数的真实影响
  // playerSucc（可选，0~1）：玩家版在该关【真实步数上限】下的最优模式通关率；仅【混合障碍关(种类>1)】
  //   用它在基础分上追加"混合附加分"——混合难度无法纯解析加权(组合爆炸)，用玩家真实通关率最贴近体感。
  function difficulty(state, obsKeys, best, stepLimit, solveStats, playerSucc, playerStats) {
    var H = state.rowCount, K = state.colCount;

    // 1) 行数项（容错低=难），列数小幅并入
    var rowScore = clamp(((H - 3) / 5) * 90 + ((K - 3) / 5) * 20, 0, 100);

    // 2) 障碍项：权重累加 + 组合加成（冰块按"数量×步数"内部权重，已用 A/B 标定）
    var obsRaw = 0, kinds = obsKeys.length;
    var surpriseN = 0;   // 问号格数（难度按数量分档单独加分，见下）
    obsKeys.forEach(function (o) {
      if (o === 'Ice') {
        // 冰块内部权重（A/B 标定）：步数是主导，每个冰块列 4 分 + 每多 1 步解锁 +6
        // （标定：1步仅−8%成功率，2步起骤降至−20%；数量影响远小于步数）
        var iceContrib = 0;
        if (state.iceReq) for (var ic = 0; ic < state.colCount; ic++) if (state.iceReq[ic] > 0) iceContrib += 4 + (state.iceReq[ic] - 1) * 6;
        obsRaw += iceContrib || (OBS_W.Ice || 12);
      } else if (o === 'CoveredColor') {
        // 保护列内部权重（A/B 标定）：每个保护列 7；3+列饱和由"求解表现"项自动回落
        var covN = 0;
        if (state.coverReq) for (var cc = 0; cc < state.colCount; cc++) if (state.coverReq[cc]) covN++;
        var covContrib = (covN * 7) || (OBS_W.CoveredColor || 12);
        // 嵌套依赖链：某保护列需求色 = 另一保护列持有的色 → 必须按序解锁，认知难度加成
        var coveredContent = {};
        if (state.coverReq) for (var c3 = 0; c3 < state.colCount; c3++) {
          if (!state.coverReq[c3]) continue;
          var dom = null, cnt = {}, bn = -1;
          for (var r3 = 0; r3 < state.columns[c3].length; r3++) {
            var cell3 = state.columns[c3][r3];
            var k3 = cell3 && (cell3.kind === 'color' || cell3.kind === 'dual') ? cell3.colorKey : null;
            if (k3) { cnt[k3] = (cnt[k3] || 0) + 1; if (cnt[k3] > bn) { bn = cnt[k3]; dom = k3; } }
          }
          if (dom) coveredContent[dom] = 1;
        }
        var nestedCov = false;
        if (state.coverReq) for (var c4 = 0; c4 < state.colCount; c4++) if (state.coverReq[c4] && coveredContent[state.coverReq[c4]]) nestedCov = true;
        if (nestedCov) covContrib += 10;
        obsRaw += covContrib;
      } else if (o === 'Rock') {
        // 石墙内部权重（A/B 标定）：石墙是最难单障碍（1个就−44%成功率）。14 + (数量-1)×4，
        // 轻微递减；3+个的"饱和回落"是生成边界现象，由"求解表现"项自动修正。
        var rockN = 0;
        if (state.rockLocked) for (var rk = 0; rk < state.colCount; rk++) if (state.rockLocked[rk]) rockN++;
        obsRaw += rockN ? (14 + (rockN - 1) * 4) : (OBS_W.Rock || 13);
      } else if (o === 'FixedColor') {
        // 限定色内部权重（A/B 标定）：对求解器几乎不加难（成功率±0）→ 极低，每列 2
        var fxN = 0;
        if (state.fixedColor) for (var fx = 0; fx < state.colCount; fx++) if (state.fixedColor[fx]) fxN++;
        obsRaw += (fxN * 2) || (OBS_W.FixedColor || 6);
      } else if (o === 'KeyLock') {
        // 锁定列内部权重（A/B 标定）：随数量上升（1→−9%,2→−22%,3→−21%成功率）。每个锁列 7
        var lkN = 0;
        for (var lc2 = 0; lc2 < state.colCount; lc2++) {
          var colc = state.columns[lc2], hasLock = false;
          for (var rr2 = 0; rr2 < colc.length; rr2++) if (colc[rr2] && colc[rr2].features && colc[rr2].features.indexOf('Lock') !== -1) hasLock = true;
          if (hasLock) lkN++;
        }
        obsRaw += (lkN * 7) || (OBS_W.KeyLock || 13);
      } else if (o === 'Bomb') {
        // 炸弹内部权重（回测标定，见 难度评分体系.md）：两部分相加——
        //   ① 紧迫度项：每弹 clamp((最优−倒计时)/最优,0,1) × 12（倒计时越紧越高，松炸弹≈0）；
        //   ② 数量项：每个炸弹 +5（回测：纯炸弹关成功率随数量显著下降 1个0.54/2个0.38/3个0.24，
        //      但纯炸弹单障碍关不计求解表现项 → 数量难度必须在此显式计入）。
        if (state.bombs && best) {
          state.bombs.forEach(function (b) {
            obsRaw += clamp((best - b.remaining) / best, 0, 1) * 12;  // ① 紧迫度 0~1 × 12
          });
          obsRaw += state.bombs.length * 5;                          // ② 数量项 每弹 +5
        } else {
          obsRaw += (state.bombs ? state.bombs.length : 1) * (OBS_W.Bomb || 6);
        }
      } else if (o === 'Dual') {
        // 双色块内部权重：求解器(全知)测出≈0(顶层可见)，按设计认知难度给权重：每种底色 12。
        // 局部难度：链式双色块（某双色块顶层=另一双色块底色，形成消除依赖）额外 +10。
        var dualBottoms = {}, dualTops = {};
        for (var dc2 = 0; dc2 < state.colCount; dc2++) {
          var dcol = state.columns[dc2];
          for (var dr = 0; dr < dcol.length; dr++) {
            var dcell = dcol[dr];
            if (dcell && dcell.kind === 'dual' && dcell.colorKey) {
              dualBottoms[dcell.colorKey] = 1;
              if (dcell.topColorKey) dualTops[dcell.topColorKey] = 1;
            }
          }
        }
        var dualN = Object.keys(dualBottoms).length;
        var contrib = dualN ? dualN * 12 : (OBS_W.Dual || 14);
        // 链式：有双色块顶层色 = 另一双色块底色
        var chained = Object.keys(dualTops).some(function (t) { return dualBottoms[t]; });
        if (chained) contrib += 10;
        obsRaw += contrib;
      } else if (o === 'Surprise') {
        // 问号难度【按数量分档】计分（设计者：不再用密度内部回测，避免高难需 70% 密度的过量问号）：
        // 数量统计存入 surpriseN，加分在后面单独算（纯问号 bonus≈数量；混合关额外×1.5）。问号必须偶数生成。
        for (var sc2 = 0; sc2 < state.colCount; sc2++) {
          var scol2 = state.columns[sc2];
          for (var sr2 = 0; sr2 < scol2.length; sr2++) {
            var scell2 = scol2[sr2];
            if (scell2 && scell2.features && scell2.features.indexOf('Surprise') !== -1) surpriseN++;
          }
        }
      } else if (o === 'LinkedCards') {
        // 捆绑内部权重：按绳数计（每条绳 5；1 条时与旧固定值一致）。捆绑全可见、玩家版无遮蔽，
        // 难度主要来自连锁旋转的认知/操作复杂度，随绳数线性增加。
        var linkN = state.links ? state.links.length : 0;
        obsRaw += (linkN ? linkN * 5 : (OBS_W.LinkedCards || 5));
      } else {
        obsRaw += (OBS_W[o] || 4);
      }
    });
    if (kinds > 1) obsRaw += (kinds - 1) * 8;
    var obsScore = clamp(obsRaw * 2.4, 0, 100);

    // 3) 步数压力项：绝对容错 / 容错率 取更施压者
    var pressureScore = 30;
    if (best != null && stepLimit != null && best > 0) {
      var margin = stepLimit - best;
      var ratio = margin / best;
      var absP = clamp(100 - (margin - 2) * 7, 0, 100);
      var ratP = clamp(100 - (ratio - 0.05) / 0.55 * 100, 0, 100);
      pressureScore = Math.max(absP, ratP);
    }

    // 4) 颜色项：仅作信息展示（已不计入难度总分）。比值=颜色种类/列数（一色多列→比值<1）。
    var colorKinds = countColorKinds(state);
    var ratioCK = K > 0 ? (colorKinds / K) : 1;
    var colorScore = clamp(ratioCK * 100, 0, 100);   // 不参与加权，仅 parts.color 展示

    // 5) 求解表现项：【全知版最优解表现 + 玩家版最优解表现】的均值，均以最优步 best 为基线。
    //    · 每方"表现"= 失败率×65 + 步数离散×90，用各自【最优模式】(succ最高的策略)避免失配脏数据；
    //    · 失败率含"略差"插值：最优模式成功率向【可行模式平均成功率】靠 ALPHA，体现真实玩家不总选最优策略/会失误；
    //    · 离散用最优模式的清洗后均值(已剔除>best+余量的失配解)。
    //    玩家未跑(非问号单障碍关，玩家≈全知) → 玩家表现 = 全知表现。
    var ALPHA = 0.3;
    function perfOf(ss) {
      if (!ss || ss.bestModeSucc == null || best == null || best <= 0) return null;
      var succEff = ss.bestModeSucc * (1 - ALPHA) + (ss.meanModeSucc != null ? ss.meanModeSucc : ss.bestModeSucc) * ALPHA;
      var failRate = clamp(1 - succEff, 0, 1);
      var spread = (ss.bestModeAvg != null && best > 0) ? clamp((ss.bestModeAvg - best) / best, 0, 1) : 0;
      return clamp(failRate * 65 + spread * 90, 0, 100);
    }
    var perfOmni = perfOf(solveStats);
    var hasBeh = perfOmni != null;
    var behaviorScore = 0;
    if (hasBeh) {
      var perfPlayer = perfOf(playerStats);
      if (perfPlayer == null) perfPlayer = perfOmni;   // 玩家未跑 → 取全知表现
      behaviorScore = (perfOmni + perfPlayer) / 2;
    }

    var total, parts;
    if (hasBeh) {
      var W = WEIGHTS;
      total = obsScore * W.obs + pressureScore * W.pressure + behaviorScore * W.behavior + rowScore * W.row;
      parts = { obs: Math.round(obsScore), pressure: Math.round(pressureScore), behavior: Math.round(behaviorScore), row: Math.round(rowScore), color: Math.round(colorScore) };
    } else {
      var Wn = WEIGHTS_NB;
      total = obsScore * Wn.obs + pressureScore * Wn.pressure + rowScore * Wn.row;
      parts = { obs: Math.round(obsScore), pressure: Math.round(pressureScore), behavior: null, row: Math.round(rowScore), color: Math.round(colorScore) };
    }

    // ★混合障碍附加分（设计者）：障碍种类>1 时，混合难度无法纯解析加权 → 用玩家版在该关真实步数上限下
    //   的最优模式通关率追加难度。通关率越低 → 加得越多（最高 +20）。单一/无障碍关不加（playerSucc 不传亦不加）。
    var mixBonus = 0;
    if (kinds > 1 && playerSucc != null) {
      mixBonus = Math.round(clamp((1 - playerSucc) * 20, 0, 20));
      total = clamp(total + mixBonus, 0, 100);
    }
    parts.mix = mixBonus;

    // ★问号加分（按【数量】分档，非密度）：纯问号 bonus≈数量(2-8低/10-14中/14-18高，上限18)；
    //   混合障碍关【额外加分】(+60%，上限30)——是加难度分，不是加问号数量。问号必须偶数生成。
    var surpriseBonus = 0;
    if (surpriseN > 0) {
      var hardSet = { Ice: 1, Rock: 1, CoveredColor: 1, KeyLock: 1 };
      var withHard = obsKeys.some(function (k) { return hardSet[k]; });
      var base = clamp(surpriseN, 2, 18);
      surpriseBonus = withHard ? clamp(base + Math.round(base * 0.6), 2, 30) : base;
      total = clamp(total + surpriseBonus, 0, 100);
    }
    parts.surprise = surpriseBonus;

    return { score: Math.round(total), level: gradeOf(total), parts: parts, colorKinds: colorKinds, mixBonus: mixBonus, surpriseBonus: surpriseBonus };
  }

  // ---- 多模式多轮求解：返回 {best, avg, successRate, solvedRuns, totalRuns, dirtyRemoved} ----
  // ★平均步数剔除脏数据（逻辑清洗，非比例清洗）：以最优步 best 为基线、步数余量上限 maxMargin 为标尺。
  //   任何一轮解步数 > best + maxMargin，意味着该策略连"最大步数预算"都无法在内解出 → 是策略树失配
  //   产生的失效解（如 best 48、maxMargin 20、阈值 68，则 72/80/90 步全是脏数据），剔除后再求均值。
  //   （根因：当前对不同障碍组合复用同一组决策模式，未做"按组合记忆命中策略"的调用优化 → 见 难度评分体系.md
  //    待优化方向；内存/速度充裕暂未做，故在统计端剔除这类脏数据。）
  function cleanAvg(steps, best, maxMargin) {
    if (!steps.length) return { avg: null, kept: 0, removed: 0 };
    var b = (best != null) ? best : Math.min.apply(null, steps);
    var cap = b + (maxMargin != null ? maxMargin : 20);   // 余量上限内才算命中策略的合理表现
    var clean = steps.filter(function (x) { return x <= cap; });
    if (!clean.length) clean = [b];
    var s = 0; for (var i = 0; i < clean.length; i++) s += clean[i];
    return { avg: s / clean.length, kept: clean.length, removed: steps.length - clean.length };
  }

  function multiSolve(state, runsPerMode, maxMargin) {
    var R = runsPerMode || 12;
    var best = Infinity, ok = 0, total = 0, steps = [];
    var byMode = {};
    for (var m = 0; m < MODES.length; m++) {
      var mOk = 0, mTotal = 0, mBest = Infinity, mSteps = [];
      for (var k = 0; k < R; k++) {
        var eps = k < Math.ceil(R / 3) ? 0 : Math.min((k - Math.ceil(R / 3) + 1) * 6, 66);
        var opt = Object.assign({ eps: eps }, MODES[m].opts);
        var run = SS.Solver.solveOnce(state, m * 104729 + k * 2654435761 + 1, k > 0, opt);
        total++; mTotal++;
        if (run.solved) {
          ok++; steps.push(run.moves.length);
          mOk++; mSteps.push(run.moves.length);
          if (run.moves.length < best) best = run.moves.length;
          if (run.moves.length < mBest) mBest = run.moves.length;
        }
      }
      byMode[MODES[m].name] = {
        succ: mTotal ? mOk / mTotal : 0,
        best: mOk ? mBest : null,
        avg: mOk ? cleanAvg(mSteps, mBest, maxMargin).avg : null,
        solvedCount: mOk
      };
    }
    var prof = bestModeProfile(byMode);
    var ca = ok ? cleanAvg(steps, best, maxMargin) : { avg: null, removed: 0 };
    return {
      best: ok ? best : null,
      avg: ca.avg,
      successRate: ok / total,
      solvedRuns: ok, totalRuns: total,
      dirtyRemoved: ca.removed,
      byMode: byMode,
      bestModeSucc: prof.bestModeSucc,
      bestModeName: prof.bestModeName,
      bestModeAvg: prof.bestModeAvg,
      meanModeSucc: prof.meanModeSucc
    };
  }

  // 从分模式统计选"最优模式"(成功率最高，并列取均值步数更优)，并算可行模式(succ>0)平均成功率。
  function bestModeProfile(byMode) {
    var bestModeSucc = 0, bestModeName = null, bestModeAvg = null;
    var viableSum = 0, viableN = 0;
    for (var nm in byMode) {
      var b = byMode[nm];
      if (b.succ > 0) { viableSum += b.succ; viableN++; }
      var better = b.succ > bestModeSucc ||
        (b.succ === bestModeSucc && b.avg != null && (bestModeAvg == null || b.avg < bestModeAvg));
      if (better) { bestModeSucc = b.succ; bestModeName = nm; bestModeAvg = b.avg; }
    }
    return {
      bestModeSucc: bestModeSucc, bestModeName: bestModeName, bestModeAvg: bestModeAvg,
      meanModeSucc: viableN ? viableSum / viableN : 0
    };
  }

  // 字段备注（展示用，解释每个指标的含义/算法）
  var FIELD_NOTES = {
    '最优步数': '5 个决策模式各跑多轮，取能通关的最少步数（理论最优解的近似）。',
    '平均步数': '所有成功求解轮次的步数平均值。越接近最优=路线稳定；偏大=分支多、易绕路。',
    '成功率': '成功通关轮次 / 总轮次。越低说明越难稳定解出，侧面反映难度。',
    '步数上限': '关卡给定的最大步数（StepCount），用尽未通关即失败。',
    '容错': '步数上限 − 最优步数。绝对可犯错空间，越小越紧张。',
    '容错率': '容错 / 最优步数。相对宽松度，体现"同样容错在长关/短关压迫感不同"。',
    '难度分': '0~100 综合分 = 障碍×0.34 + 步数压力×0.28 + 求解表现×0.21 + 行数×0.17（颜色项已移除：满色平衡盘恒满分=无意义地板分）。',
    '难度等级': '简单 0-30 · 普通 31-60 · 困难 61-80 · 极难 81-100（阈值可调）。',
    '难度构成': '分项得分(障/压/为/行)，各 0~100；"色"仅信息展示不计分。"为"=求解表现(成功率低+步数离散→高)。混合障碍关(种类>1)末尾的"+混N"=混合附加分(按玩家版真实通关率追加，最高+20)。',
    '障碍分级': '简单(问号/捆绑/炸弹) · 中等(限定色/双色块) · 困难(冰块/石墙/指定颜色消除/锁定列)；单一/组合。'
  };

  return {
    OBS_CN: OBS_CN, WEIGHTS: WEIGHTS, OBS_W: OBS_W, MODES: MODES,
    obstaclesFromState: obstaclesFromState,
    obstacleNamesCN: obstacleNamesCN,
    obsLevelTag: obsLevelTag,
    difficulty: difficulty,
    multiSolve: multiSolve,
    cleanAvg: cleanAvg,
    countColorKinds: countColorKinds,
    gradeOf: gradeOf,
    FIELD_NOTES: FIELD_NOTES
  };
})();
