/**
 * StackSort 求解器 - 核心策略（全知版）
 *
 * 设计依据（与设计者确认的玩家最优策略）：
 *   策略1：为每个颜色找到归属列 —— 先做一次"列↔色"最优指派（二分图最大权匹配）。
 *   策略2：偶尔用一个"最杂乱、未定色"的列当中转，绝不碰接近完成的列。
 *   策略3：同色优先连续放入顶部 —— 点击目标列会把同色压到顶部，增大该列该色的连续段
 *          与完成进度。评分函数据此奖励"顶部同色连续段"。
 *
 * 算法：固定指派后，做"贪心 + N 步前瞻"搜索，每步在可点列中模拟移动、对结果状态评分，
 *      选评分最高路径的第一步；卡死或绕圈时带扰动多轮回溯重试。
 *
 * 信息模型：全知 —— 直接读取问号真实色、冻结列卡片颜色，用于快速算路线。
 *
 * 入口：SS.Solver.solve(state, options)
 *   返回 { solved, moves:[colIdx...], steps, finalState, commit, attempts, reason }
 */
var SS = SS || {};

SS.Solver = (function () {
  var E = null; // 延迟绑定 SS.Engine

  function engine() { return E || (E = SS.Engine); }

  // ---------- 颜色统计 ----------
  function colorKeyOf(cell) {
    if (!cell) return null;
    // 双色块按"当前生效的底层色"参与颜色统计与路由
    if (cell.kind === 'color' || cell.kind === 'dual') return cell.colorKey;
    return null;
  }

  // 卡片是否为未揭示问号（玩家视图里 colorKey 被屏蔽为 null，但保留 Surprise 特性）
  function isSurpriseCell(cell) {
    return !!(cell && cell.features && cell.features.indexOf('Surprise') !== -1);
  }
  // 列顶起的同色连续段长度
  function topRunLen(col, T) {
    var n = 0;
    for (var i = 0; i < col.length; i++) { if (colorKeyOf(col[i]) === T) n++; else break; }
    return n;
  }

  /**
   * 颜色可用性分析（核心：区分"有用颜色"与"事实杂色"）
   *
   * 设计者原则：关键不是"杂色有多少"，而是"有用颜色有几个"。
   *   - 被冻结列(冰块)里的卡片在解冻前【不可达】，不计入可用数量。
   *   - 某颜色"可达副本数 < 列高" → 当前无法凑满一列 → 在解冻前是【事实杂色】。
   *   - "可达副本数 >= 列高" → 是【有用颜色】，能用来完成一列、撬动解锁。
   *
   * 返回 {
   *   reachable: {color: 可达副本数(不含冻结列)},
   *   frozenHidden: {color: 冻结列里的副本数},
   *   useful: Set(可凑满一列的颜色)
   * }
   */
  function analyzeColors(state, opts) {
    var eng = engine();
    var H = state.rowCount;
    var reachable = {};
    var frozenHidden = {};

    for (var c = 0; c < state.colCount; c++) {
      var frozen = eng.isFrozen(state, c);
      var blocked = frozen || (eng.isCovered && eng.isCovered(state, c))   // 保护列同冰块：颜色不可达
                    || (eng.keyLockedCol && eng.keyLockedCol(state, c)); // Key-Lock 锁定列也不可达
      var col = state.columns[c];
      for (var i = 0; i < col.length; i++) {
        var k = colorKeyOf(col[i]);
        if (k === null) continue;
        if (blocked) frozenHidden[k] = (frozenHidden[k] || 0) + 1;
        else reachable[k] = (reachable[k] || 0) + 1;
      }
    }
    var benchK = colorKeyOf(state.bench);
    if (benchK !== null) reachable[benchK] = (reachable[benchK] || 0) + 1;

    var useful = {};
    for (var key in reachable) {
      if (reachable[key] >= H) useful[key] = true;
    }

    // 放宽模式（玩家版）：全知版"可达≥行高"判据成立的前提是它能看见所有副本；玩家被问号挡住
    // 部分副本，常常没有色能达到行高。设计者原则：问号是"软障碍"（临时屏蔽），不改变策略——
    // 含问号的关一律【当作无障碍处理】：每个可见(可达)色都是合法锁列目标，直接贪心锁列；
    // 硬障碍（冰块/石墙/保护列/锁定列）交给常规解法（完成可达色/把钥匙挤到底等）自然解锁。
    // 仅玩家版在【含问号关】传 relaxUseful；非问号关不传 → 严格判据，与全知版零偏差。
    if (opts && opts.relaxUseful) {
      for (var rk0 in reachable) useful[rk0] = true;
    }
    return { reachable: reachable, frozenHidden: frozenHidden, useful: useful, rowCount: H };
  }

  // ---------- 评分函数 ----------
  /**
   * 列完成代价（越小越好）：目标色 T 下，列里非 T 卡片数（含万能牌）。
   * 顶部同色连续段越长越好（策略3）。
   */
  function topRun(col, T) {
    var n = 0;
    for (var i = 0; i < col.length; i++) {
      if (colorKeyOf(col[i]) === T) n++;
      else break;
    }
    return n;
  }

  // ---------- 完成列计数 ----------
  function completedCountOf(state) {
    var n = 0;
    for (var c = 0; c < state.colCount; c++) if (state.completed[c]) n++;
    return n;
  }

  // ========== 手牌驱动 + 预期列 路由策略（主力执行核心） ==========
  //
  // 设计者亲述玩家逻辑：
  //   每步只问"手上这张牌该放哪"。看手牌色 X → 找 X 的目标列：
  //     - 已锁定为 X 的列(预期列) 优先；
  //     - 否则在未锁定列里选 X 最多的；并列时选 X 更靠顶部聚集的，并把它锁定为 X。
  //   点击该列：X 进顶、底牌被挤出成为新手牌，接力路由。
  //   手牌是万能牌/无处安放时 → 走中转列。

  // X 在列中的"顶部聚集度"：越靠顶权重越高（H-index 累加）
  function topConcentration(col, X, H) {
    var s = 0;
    for (var i = 0; i < col.length; i++) {
      if (colorKeyOf(col[i]) === X) s += (H - i);
    }
    return s;
  }
  function countColor(col, X) {
    var n = 0;
    for (var i = 0; i < col.length; i++) if (colorKeyOf(col[i]) === X) n++;
    return n;
  }

  // 列 c 当前是否仍被激活的绳捆住
  function inActiveLink(state, c) {
    if (!state.links) return false;
    for (var i = 0; i < state.links.length; i++) {
      var l = state.links[i];
      if (l.active && (l.col1 === c || l.col2 === c)) return true;
    }
    return false;
  }

  // 完成列 c 是否能解锁某个仍锁定的石墙（c 紧邻一个锁定石墙列）→ 障碍优先级权重
  function unlocksRock(state, c) {
    if (!state.rockLocked) return false;
    var left = c - 1, right = c + 1;
    if (left >= 0 && state.rockLocked[left]) return true;
    if (right < state.colCount && state.rockLocked[right]) return true;
    return false;
  }

  // 场上是否还存在"隐藏颜色供给"的高难度障碍（冰块冻结 / 石墙锁定）。
  // 这类障碍把部分颜色锁住 → 某色此刻可能是"事实杂色"，提前按占比锁列会挖坑。
  // 注：限定颜色列不算（它的 commit 是游戏强制、确定性的，不会导致灌无用色死循环）。
  function hasHiddenObstacle(state) {
    var eng = engine();
    for (var c = 0; c < state.colCount; c++) {
      if (eng.isFrozen(state, c) || eng.isRockLocked(state, c)) return true;
      if (eng.isCovered && eng.isCovered(state, c)) return true;         // 保护列锁住颜色供给 → 高难度障碍
      if (eng.keyLockedCol && eng.keyLockedCol(state, c)) return true; // Key-Lock 锁住颜色供给 → 高难度障碍
    }
    return false;
  }

  /**
   * 有效步评估：把有用色 X 安家到列 c 的"有效进度"价值（设计者"有效步"原则）。
   *   - 顶部同色连续段 topRun：即时有效（已锁定的 X），价值最高；
   *   - 被埋的同色 buried = 该列 X 总数 − topRun：需额外清杂步才能连上，打折/微罚；
   *   - 首次点击会挤出该列底牌：底牌是"别的有用色" → 2-for-1，加成；
   *   - X 总数仍小幅计入（总数多 = 要补的少），但不再像旧版那样 ×100 主导。
   */
  function effectiveStepScore(state, c, X, H, info) {
    var col = state.columns[c];
    var topR = topRun(col, X);
    var cnt = countColor(col, X);
    var buried = cnt - topR;
    var bottomKey = colorKeyOf(col[col.length - 1]);
    var ejectUseful = bottomKey !== null && bottomKey !== X && info.useful[bottomKey];
    var score = topR * 20      // 顶部连续段：即时有效，最高权重
              + cnt * 6        // 总数：要补的少，次要
              - buried * 3     // 被埋同色：需清杂，微罚
              + (ejectUseful ? 8 : 0); // 挤出有用底牌：2-for-1
    return score;
  }

  // 列 c 中"底层=X 的双色块"数量（双色块策略用）
  function dualBottomCount(col, X) {
    var n = 0;
    for (var i = 0; i < col.length; i++) {
      if (col[i] && col[i].kind === 'dual' && col[i].colorKey === X) n++;
    }
    return n;
  }

  /**
   * 选择本步要点击的列。
   * commit[c] = 该列锁定的预期颜色（或 null）。本函数可能写入 commit（锁定新预期列）。
   * 返回列下标，或 -1（无可行）。
   *
   * 冰块关核心（设计者指示）：冰块封锁部分颜色 → 那些颜色变"事实杂色"（凑不满一列）。
   *   - 手牌是【有用色】(可达数≥行高) → 正常路由+锁定预期列，优先完成它去解锁冰块。
   *   - 手牌是【事实杂色】→ 不给它锁列，走中转；但优先丢到"顶部已有同色"的列建立连续性。
   *
   * 捆绑关策略（设计者"二选一"）：给有用色选预期列时回避仍被绳捆住的列，
   *   让有用色集中到自由列、把被捆列当作"被打乱的那条"；等绳断后该列再参与正常路由。
   */
  function chooseRoutingMove(state, commit, rng, opts) {
    opts = opts || {};
    var linkAware = !!opts.linkAware;  // 捆绑"回避被捆列"策略：默认关闭（保留备用）
    var eps = opts.eps || 0;           // 容差：>0 时近最高分的次优步也进入候选（逃生用）
    var dualPriority = !!opts.dualPriority; // 双色块策略：优先把底层色灌进含该双色块的列去触发转换
    var expandTransit = !!opts.expandTransit; // 中转列临时扩展（杂色空转时征用新列破局）
    // 玩家版策略开关（全知版默认全 false，零影响）
    var squeezeUnknown = !!opts.squeezeUnknown; // 问号+障碍：无可用块时降级挤压问号
    var pseudoWild = !!opts.pseudoWild;         // 伪万能中转块：杂色手牌停进纯连色已锁列(自动扶正后免费清除)
    var antiJunkLoop = !!opts.antiJunkLoop;     // 顺手连色防杂色循环
    var eng = engine();
    var H = state.rowCount;
    var X = colorKeyOf(state.bench);
    var info = analyzeColors(state, { relaxUseful: !!opts.relaxUseful });

    var playable = [];
    for (var c = 0; c < state.colCount; c++) {
      if (eng.isColumnPlayable(state, c)) playable.push(c);
    }
    if (!playable.length) return -1;

    var xUseful = (X !== null) && !!info.useful[X];

    if (X !== null && xUseful) {
      // 1) 已锁定为 X 的预期列，且可点 → 用之（多列同色时并列随机挑一个）
      var committedX = [];
      for (var pi = 0; pi < playable.length; pi++) {
        if (commit[playable[pi]] === X) committedX.push({ c: playable[pi], score: 0 });
      }
      if (committedX.length) return pickTie(committedX, rng, 0);

      // 2) 在"未锁定列"里按【有效步】选 X 的归属列（并列分随机挑）
      var cands = [];
      for (var pj = 0; pj < playable.length; pj++) {
        var c2 = playable[pj];
        if (commit[c2] != null) continue;        // 已锁给别的色，跳过
        var score = effectiveStepScore(state, c2, X, H, info);
        if (linkAware && inActiveLink(state, c2)) score -= 40; // 回避被绳捆住的列
        // 双色块策略：优先把底层色灌进"含该底层双色块的列"——完成它触发转换，是高价值进度
        if (dualPriority) score += dualBottomCount(state.columns[c2], X) * 25;
        cands.push({ c: c2, score: score });
      }
      if (cands.length) {
        var best = pickTie(cands, rng, eps);
        if (best >= 0) {
          // commitMode='always' → 一律锁列（旧逻辑，部分关更短，如 L89）；
          // commitMode='gated'(默认) → 仅在无隐藏障碍(冰块/石墙)时锁列，障碍期全场不锁（容错，省步，治 L16）。
          if (opts.commitMode === 'always' || !hasHiddenObstacle(state)) commit[best] = X;
          return best;
        }
      }
      // 3) X 有用但无未锁定归属（其预期列可能被冻结）→ 走中转
      return chooseTransit(state, commit, rng, playable, info, eps, { expandTransit: expandTransit, squeezeUnknown: squeezeUnknown, pseudoWild: pseudoWild, antiJunkLoop: antiJunkLoop });
    }

    // 手牌是万能牌 / 事实杂色 → 中转（chooseTransit 内部会优先建立同色连续性）
    return chooseTransit(state, commit, rng, playable, info, eps, { expandTransit: expandTransit, squeezeUnknown: squeezeUnknown, pseudoWild: pseudoWild, antiJunkLoop: antiJunkLoop });
  }

  // 在候选里取最高分；分数在 [best-eps, best] 内的都算并列候选。
  // rng 存在且并列>1 → 随机挑；否则取第一个（确定性）。eps=0 → 仅严格并列。
  function pickTie(cands, rng, eps) {
    eps = eps || 0;
    var EPS = 1e-9;
    var best = -Infinity;
    for (var i = 0; i < cands.length; i++) if (cands[i].score > best) best = cands[i].score;
    var ties = [];
    for (var j = 0; j < cands.length; j++) if (cands[j].score >= best - eps - EPS) ties.push(cands[j].c);
    if (!ties.length) return -1;
    if (rng && ties.length > 1) return ties[Math.floor(rng() * ties.length) % ties.length];
    return ties[0];
  }

  /**
   * 中转选列：把当前手牌（万能/事实杂色）丢进一个"周转列"，并尽量换出有用底牌。
   * topts（玩家版策略，全知版不传=全关闭）：
   *   expandTransit  : 中转列临时扩展（杂色空转破局）。
   *   squeezeUnknown : 问号+障碍关，无任何≥行高可完成色时，降级挤压问号揭示信息（设计者点②）。
   *   pseudoWild     : 伪万能中转块——中转耗尽时，把杂色手牌停进一个"纯连色已锁列"，
   *                    挤出其底牌(可能有用)、并让该列变成"仅1张异色"，后续喂主色时自动扶正免费清除，
   *                    省一步中转容错（设计者点④）。
   *   antiJunkLoop   : 顺手连色防杂色循环——连色列已全是无用块时不再延长连色（设计者点③）。
   */
  function chooseTransit(state, commit, rng, playable, info, eps, topts) {
    topts = topts || {};
    var expandTransit = !!topts.expandTransit;
    var squeezeUnknown = !!topts.squeezeUnknown;
    var pseudoWild = !!topts.pseudoWild;
    var antiJunkLoop = !!topts.antiJunkLoop;
    info = info || analyzeColors(state);
    var X = colorKeyOf(state.bench);  // 手牌颜色（可能为 null=万能）
    var benchRainbow = state.bench && state.bench.kind === 'rainbow';
    var benchUseful = (X !== null) && !!info.useful[X];  // 手牌本身是否有用色
    var H = state.rowCount;
    var fixedCount = 0;
    if (state.fixedColor) for (var fi = 0; fi < state.colCount; fi++) if (state.fixedColor[fi]) fixedCount++;

    // ===== 设计者点②：问号+障碍关，"无任何≥行高可完成色"时降级挤压问号 =====
    // 仅当场上确实没有可推进障碍的可用块(info.useful 为空)时介入；否则照常走有用块/中转。
    if (squeezeUnknown) {
      var anyUseful = false; for (var uu in info.useful) { anyUseful = true; break; }
      if (!anyUseful) {
        var sq = [];
        for (var sp = 0; sp < playable.length; sp++) {
          var sc = playable[sp], scol = state.columns[sc], m = scol.length, sur = 0;
          for (var si = 0; si < m; si++) if (isSurpriseCell(scol[si])) sur++;
          if (sur === 0) continue;
          var botS = m >= 1 && isSurpriseCell(scol[m - 1]);
          var secS = m >= 2 && isSurpriseCell(scol[m - 2]);
          var tk = colorKeyOf(scol[0]);
          var s2 = 100 + (botS ? 30 : 0) + (secS ? 15 : 0) + sur * 3;
          if (X !== null && tk === X) s2 += 20;       // 顺手连色：边挤边拼
          if (commit[sc] != null) s2 -= 6;
          sq.push({ c: sc, score: s2 });
        }
        if (sq.length) return pickTie(sq, rng, eps || 0);
      }
    }

    // ===== 设计者点④：伪万能中转块（仅中转耗尽 expandTransit 触发 + 手牌杂色时尝试）=====
    // 找一个"已锁列、顶部纯连色、连段≥H/2、连段以下全是非目标色（连段干净）"的列，
    // 把杂色停进去：挤出其底牌、该列只剩这 1 张异色，喂主色时引擎自动扶正会免费清除它。
    if (pseudoWild && expandTransit && X !== null && !benchUseful) {
      var pwBest = -1, pwRun = -1;
      for (var pp = 0; pp < playable.length; pp++) {
        var pc = playable[pp], T = commit[pc];
        if (T == null || T === X) continue;                 // 需已锁列、目标色≠手牌
        var pcol = state.columns[pc];
        if (colorKeyOf(pcol[0]) !== T) continue;            // 顶部必须是目标色（连段起头）
        var run = topRunLen(pcol, T);
        if (run < Math.ceil(H / 2)) continue;               // 连段足够长（近完成、值得保护）
        var clean = true;                                   // 连段以下不得再有 T（保证恰好可被自动扶正清除）
        for (var ti = run; ti < pcol.length; ti++) { if (colorKeyOf(pcol[ti]) === T) { clean = false; break; } }
        if (!clean) continue;
        if (run > pwRun) { pwRun = run; pwBest = pc; }       // 取最接近完成的
      }
      if (pwBest >= 0) return pwBest;
    }

    var cands = [];
    for (var pi = 0; pi < playable.length; pi++) {
      var c = playable[pi];
      var col = state.columns[c];
      var committed = commit[c] != null;

      var seen = {}, distinct = 0, buriedUseful = 0;
      for (var i = 0; i < col.length; i++) {
        var k = colorKeyOf(col[i]);
        if (k !== null && !seen[k]) { seen[k] = 1; distinct++; }
        // 被埋的有用色（非顶部、可解放到流通中的目标色）
        if (k !== null && i > 0 && info.useful[k]) buriedUseful++;
      }
      var bottomKey = colorKeyOf(col[col.length - 1]);
      var bottomUseful = bottomKey !== null && info.useful[bottomKey];
      var topSameAsHand = (X !== null) && colorKeyOf(col[0]) === X;
      var isFixed = state.fixedColor && state.fixedColor[c];

      var score = 0;
      if (topSameAsHand) {
        // 设计者点③：顺手连色，但若该列已是"杂色循环"（手牌无用 + 底牌无用 + 无被埋有用色），
        // 延长连色只会让下一张底牌仍无用 → 空转，故不加连色奖励。
        var junkLoop = antiJunkLoop && !benchUseful && !bottomUseful && buriedUseful === 0;
        if (!junkLoop) score += 12;        // 建立/延长同色连续性
      }
      score += distinct * 3;                 // 越杂越适合当中转
      if (!committed) score += 5;            // 未锁定列优先
      if (bottomUseful) score += 8;          // 底牌有用：换出来下一手能用
      if (committed) score -= 6;             // 已是预期列，尽量别污染
      // 多限定列时，万能牌优先丢进限定列：挤出底部杂色、增加容错，化解互锁死循环
      if (benchRainbow && isFixed && fixedCount >= 2) score += 15;

      // ★中转列临时扩展（设计者触发器）：当原中转列的有效步被挤压完、陷入"杂色→杂色"空转时，
      //   征用一列"埋有较多有用色"的新列作为中转——丢杂色进去把有用色顶出来，恢复挤压目标色的进度。
      //   代价是会打乱这列，但避免在死中转列上空耗步数。仅在 expandTransit 触发时启用。
      if (expandTransit) {
        if (bottomUseful) score += 25;       // 底牌有用：丢一手即可挤出有用色（最直接的扩展收益）
        score += buriedUseful * 4;           // 埋了越多有用色 → 拆开它解放的进度越大
        if (committed) score += 6;           // 抵消上面的 -6：允许打扰已起头的列来破局
      }
      cands.push({ c: c, score: score });
    }
    return pickTie(cands, rng, eps || 0);
  }

  /*
   * 中转列"临时扩展"（设计者触发器，已实现为决策模式 gatedX）：
   *   当中转列的有效步被挤压完、陷入"杂色→杂色"空转（junkStreak≥行高，连续若干步无新完成
   *   且手牌仍是杂色）时，征用一列"埋有较多有用色/底牌有用"的新列作为中转——丢杂色进去把
   *   有用色顶出来，恢复挤压目标色的进度（代价：打乱该列）。见 chooseTransit 的 expandTransit 分支。
   */

  // ---------- 关卡合法性校验 ----------
  /**
   * 合法关卡规则（设计者确认，已放宽）：
   *   - 总卡片数 = 列数 K × 行数 H（棋盘填满）
   *   - 每种颜色数量是【行数 H 的整数倍】（该色可恰好填满整数列；允许一色占多列）
   *   - 各颜色占用列数之和 = 列数 K
   *   - 万能牌恰好 1 张（含初始暂存区那张）
   * 核心：只要保证每列都能被填满同色即合法（不再要求"颜色种类=列数"）。
   * 返回 { valid, reason, colorCount, columnsNeeded, sizeK, sizeH }
   */
  function validateLevel(state) {
    var K = state.colCount, H = state.rowCount;
    // 双色块关：含隐藏顶层(悬浮额外牌)，简单的"每色=行高整数倍"不成立 → 跳过严格校验，由求解验证可解性。
    for (var dc = 0; dc < state.colCount; dc++) {
      var dcol = state.columns[dc];
      for (var di = 0; di < dcol.length; di++) {
        if (dcol[di] && dcol[di].kind === 'dual') {
          return { valid: true, reason: 'dual-level(跳过严格校验)', colorCount: -1, sizeK: K, sizeH: H };
        }
      }
    }
    var colorCnt = {};
    var rainbow = 0;
    for (var c = 0; c < state.colCount; c++) {
      var col = state.columns[c];
      for (var i = 0; i < col.length; i++) {
        var cell = col[i];
        if (!cell || cell.kind === 'empty') continue;
        if (cell.kind === 'rainbow') rainbow++;
        else if (cell.kind === 'color') colorCnt[cell.colorKey] = (colorCnt[cell.colorKey] || 0) + 1;
      }
    }
    if (state.bench) {
      if (state.bench.kind === 'rainbow') rainbow++;
      else if (state.bench.kind === 'color') colorCnt[state.bench.colorKey] = (colorCnt[state.bench.colorKey] || 0) + 1;
    }

    var colors = Object.keys(colorCnt);
    var reasons = [];
    var columnsNeeded = 0;
    for (var k in colorCnt) {
      if (colorCnt[k] % H !== 0) {
        reasons.push('颜色' + k + '数量(' + colorCnt[k] + ')不是行数(' + H + ')的整数倍');
      }
      columnsNeeded += Math.round(colorCnt[k] / H);
    }
    if (columnsNeeded !== K) {
      reasons.push('各色应占列数之和(' + columnsNeeded + ')≠列数(' + K + ')');
    }
    if (rainbow !== 1) reasons.push('万能牌数量(' + rainbow + ')≠1');

    return {
      valid: reasons.length === 0,
      reason: reasons.join('; '),
      colorCount: colors.length,
      columnsNeeded: columnsNeeded,
      sizeK: K, sizeH: H, rainbow: rainbow
    };
  }

  // ---------- 主求解循环（手牌驱动路由 + 多轮回溯）----------
  /**
   * options: { maxRestarts=40, seed=0, linkAware }
   */
  function solve(state, options) {
    options = options || {};
    var maxRestarts = options.maxRestarts != null ? options.maxRestarts : 40;
    var eng = engine();
    var bestPartial = { done: -1, state: null };

    for (var attempt = 0; attempt <= maxRestarts; attempt++) {
      // 第0轮确定性；之后随机化平局探索等价分支；更后段逐步放宽容差(eps)纳入次优步以逃生
      var eps = attempt <= 8 ? 0 : Math.min((attempt - 8) * 6, 60);
      // 两种锁列决策都试（能力取并集）：偶数轮 gated(障碍期不锁,省步治L16)，奇数轮 always(一律锁,治L89)
      var commitMode = (attempt % 2 === 0) ? 'gated' : 'always';
      var run = solveOnce(state, (options.seed || 0) + attempt * 7919 + 1, attempt > 0,
        { linkAware: options.linkAware, eps: eps, commitMode: commitMode });
      if (run.solved) {
        return {
          solved: true, moves: run.moves, steps: run.moves.length,
          finalState: run.finalState, commit: run.commit, attempts: attempt + 1, reason: null
        };
      }
      if (run.done > bestPartial.done) { bestPartial.done = run.done; bestPartial.state = run.finalState; }
    }

    return {
      solved: false, moves: [], steps: 0, finalState: null,
      commit: null, attempts: maxRestarts + 1, reason: 'no-solution-found',
      bestDone: bestPartial.done, bestState: bestPartial.state
    };
  }

  /**
   * 单次完整求解（一条路径跑到底）。
   * randomize=false → 完全确定性（平局取第一个）；true → 用 seed 随机化"分数并列"的选择。
   * 返回 { solved, moves, finalState, commit, done }
   */
  function solveOnce(state, seed, randomize, options) {
    options = options || {};
    var eng = engine();
    var rng = randomize ? makeRng(seed >>> 0 || 1) : null;  // null = 平局取第一个（确定性）
    var eps = options.eps || 0;
    // 玩家版钩子：决策前把真实棋盘变换成"玩家可见视图"（如屏蔽未揭示问号色）。
    // 默认恒等 → 全知版行为完全不变。move() 仍在真实状态上执行。
    var observe = options.observe || function (s) { return s; };
    var cur = eng.cloneState(state);
    var commit = new Array(state.colCount).fill(null);
    if (state.fixedColor) {
      for (var fc = 0; fc < state.colCount; fc++) {
        if (state.fixedColor[fc]) commit[fc] = state.fixedColor[fc];
      }
    }
    for (var c0 = 0; c0 < state.colCount; c0++) {
      if (cur.completed[c0] && commit[c0] == null) commit[c0] = dominantColor(cur.columns[c0]);
    }
    var moveSeq = [];
    var seen = {};
    var guard = state.colCount * state.rowCount * 50 + 300;
    // 中转扩展触发：连续"杂色空转"（手牌仍是杂色 + 无新完成）达到行高 → 下一步允许征用新中转列
    var allowExpand = !!options.expandTransit;
    var junkStreak = 0;
    var prevDone = completedCountOf(cur);

    while (!eng.isWin(cur) && cur.moves > 0 && guard-- > 0) {
      if (eng.bombFailed && eng.bombFailed(cur)) break;   // 炸弹爆炸 → 此路径失败，终止
      var expandNow = allowExpand && junkStreak >= state.rowCount; // 空转够久 → 本步扩展中转
      var view = observe(cur);  // 玩家可见视图（全知版 = cur 本身）
      var mv = -1;
      // 决策覆盖钩子（玩家版用于"全盲态主动翻问号"）：返回 ≥0 则采用，否则回退正常路由。
      if (options.chooseOverride) mv = options.chooseOverride(view, commit, { eps: eps });
      if (mv < 0) mv = chooseRoutingMove(view, commit, rng, { linkAware: !!options.linkAware, eps: eps, commitMode: options.commitMode || 'gated', dualPriority: !!options.dualPriority, expandTransit: expandNow, relaxUseful: !!options.relaxUseful, squeezeUnknown: !!options.squeezeUnknown, pseudoWild: !!options.pseudoWild, antiJunkLoop: !!options.antiJunkLoop });
      if (mv < 0) break;
      var r = eng.move(cur, mv);
      if (!r.ok) break;
      cur = r.state;
      moveSeq.push(mv);
      for (var c1 = 0; c1 < cur.colCount; c1++) {
        if (cur.completed[c1] && commit[c1] == null) commit[c1] = dominantColor(cur.columns[c1]);
      }
      // 更新空转计数：有新完成或手牌变有用色 → 清零；否则累加
      var curDone = completedCountOf(cur);
      var benchK = colorKeyOf(cur.bench);
      var benchUsefulNow = benchK !== null && analyzeColors(observe(cur)).useful[benchK];
      if (curDone > prevDone || benchUsefulNow) junkStreak = 0;
      else junkStreak++;
      prevDone = curDone;
      if (expandNow) junkStreak = 0;  // 已触发一次扩展，重新计数

      var key = stateKey(cur);
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 6) break;
    }
    return {
      solved: eng.isWin(cur) && !(eng.bombFailed && eng.bombFailed(cur)), moves: moveSeq, finalState: cur,
      commit: commit, done: completedCountOf(cur)
    };
  }


  // ====================================================================
  // 决策分发框架：关卡打标签 + 决策模式注册表 + 跑所有模式取最优 + 决策记忆
  // 思路（设计者方案2）：求解很快 → 把每种"决策模式"都跑几遍，取能通关且最短的；
  //   按"障碍组合标签"记住该类型的最优模式，下次同类型优先用。
  //   ★ 后续新障碍若引入共用决策逻辑，在 DECISION_MODES 注册新模式即可，框架不动。
  // ====================================================================

  // 决策模式注册表（可扩展）。每个模式 = 一组 solveOnce 选项。
  var DECISION_MODES = [
    { name: 'gated',  opts: { commitMode: 'gated' } },   // 障碍期不锁列：省步、容错（治 L16 类）
    { name: 'always', opts: { commitMode: 'always' } },  // 一律锁列：个别关更短（治 L89 类）
    { name: 'dual',   opts: { commitMode: 'gated', dualPriority: true } },  // 双色块优先(不锁列)：灌底层色触发转换
    { name: 'dualLk', opts: { commitMode: 'always', dualPriority: true } },  // 双色块优先 + 锁列
    { name: 'gatedX', opts: { commitMode: 'gated', expandTransit: true } }   // 障碍期不锁列 + 中转列临时扩展(杂色空转破局)
    // 后续障碍的新共用决策在此追加，例如 { name:'rockFirst', opts:{...} }
  ];

  // 决策记忆：障碍组合标签 -> 上次胜出的模式名（同类型关卡复用）
  var decisionMemory = {};

  // 关卡打标签：按"障碍组合"（+ 尺寸桶）归类同类型关卡
  function obstacleTag(state) {
    var set = {};
    for (var c = 0; c < state.colCount; c++) {
      if (state.iceReq && state.iceReq[c] > 0) set['Ice'] = 1;
      if (state.rockLocked && state.rockLocked[c]) set['Rock'] = 1;
      if (state.coverReq && state.coverReq[c]) set['Covered'] = 1;
      if (state.fixedColor && state.fixedColor[c]) set['Fixed'] = 1;
      var col = state.columns[c];
      for (var i = 0; i < col.length; i++) {
        if (col[i] && col[i].features && col[i].features.indexOf('Surprise') !== -1) set['Surprise'] = 1;
        if (col[i] && col[i].kind === 'dual') set['Dual'] = 1;
        if (col[i] && col[i].features && col[i].features.indexOf('Lock') !== -1) set['KeyLock'] = 1;
        if (col[i] && col[i].features && col[i].features.indexOf('Key') !== -1) set['KeyLock'] = 1;
        if (col[i] && col[i].bomb != null) set['Bomb'] = 1;
      }
    }
    if (state.links && state.links.length) set['Link'] = 1;
    if (state.bombs && state.bombs.length) set['Bomb'] = 1;
    var obs = Object.keys(set).sort();
    var sizeBucket = state.colCount + 'x' + state.rowCount;
    return (obs.length ? obs.join('+') : 'plain') + '@' + sizeBucket;
  }

  // 用某个决策模式跑 N 遍（首遍确定性，其余随机平局 + 后段放宽 eps 逃生），返回该模式最优解
  function runModeBest(state, modeOpts, runs, seed) {
    var best = null;
    for (var k = 0; k < runs; k++) {
      // 首遍确定性；其余随机平局；约 1/3 之后逐步放宽 eps 纳入次优步以逃生
      var eps = k < Math.ceil(runs / 3) ? 0 : Math.min((k - Math.ceil(runs / 3) + 1) * 6, 66);
      var run = solveOnce(state, (seed || 0) + k * 2654435761 + 1, k > 0,
        { linkAware: modeOpts.linkAware, eps: eps, commitMode: modeOpts.commitMode, dualPriority: modeOpts.dualPriority, expandTransit: modeOpts.expandTransit });
      if (run.solved && (!best || run.moves.length < best.steps)) {
        best = { steps: run.moves.length, moves: run.moves, finalState: run.finalState };
      }
    }
    return best;
  }

  /**
   * 带决策分发与记忆的求解入口。
   * options: { runsPerMode=8, seed=0 }
   * 返回 { solved, steps, moves, mode, tag, byMode:{模式名:最优步数|null}, finalState }
   */
  function solveTagged(state, options) {
    options = options || {};
    var runsPerMode = options.runsPerMode || 40;
    var tag = obstacleTag(state);

    // 记忆里的最优模式排到最前（优先尝试）
    var order = DECISION_MODES.slice();
    if (decisionMemory[tag]) {
      order.sort(function (a, b) {
        return (a.name === decisionMemory[tag] ? -1 : 0) - (b.name === decisionMemory[tag] ? -1 : 0);
      });
    }

    var overall = null, overallMode = null, byMode = {};
    for (var m = 0; m < order.length; m++) {
      var mode = order[m];
      var r = runModeBest(state, mode.opts, runsPerMode, (options.seed || 0) + m * 104729);
      byMode[mode.name] = r ? r.steps : null;
      if (r && (!overall || r.steps < overall.steps)) { overall = r; overallMode = mode.name; }
    }

    if (overall) decisionMemory[tag] = overallMode;  // 记住该类型的胜出模式

    return {
      solved: !!overall,
      steps: overall ? overall.steps : 0,
      moves: overall ? overall.moves : [],
      finalState: overall ? overall.finalState : null,
      mode: overallMode,
      tag: tag,
      byMode: byMode
    };
  }

  // 列的主色（出现最多的普通色），用于锁定已完成列
  function dominantColor(col) {
    var cnt = {}, best = null, bestN = -1;
    for (var i = 0; i < col.length; i++) {
      var k = colorKeyOf(col[i]);
      if (k === null) continue;
      cnt[k] = (cnt[k] || 0) + 1;
      if (cnt[k] > bestN) { bestN = cnt[k]; best = k; }
    }
    return best;
  }

  // ---------- 工具 ----------
  function stateKey(state) {
    var parts = [];
    for (var c = 0; c < state.colCount; c++) {
      var col = state.columns[c];
      var s = '';
      for (var i = 0; i < col.length; i++) {
        var cell = col[i];
        s += cell ? (cell.kind === 'rainbow' ? '*' : (cell.colorKey || '_')) : '.';
        s += '|';
      }
      parts.push(s);
    }
    parts.push('B:' + (state.bench ? (state.bench.kind === 'rainbow' ? '*' : state.bench.colorKey) : '.'));
    return parts.join('#');
  }

  // 确定性伪随机
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return (s >>> 0) / 4294967296;
    };
  }

  return {
    solve: solve,
    solveOnce: solveOnce,
    solveTagged: solveTagged,
    obstacleTag: obstacleTag,
    chooseRoutingMove: chooseRoutingMove,
    analyzeColors: analyzeColors,
    validateLevel: validateLevel
  };
})();
