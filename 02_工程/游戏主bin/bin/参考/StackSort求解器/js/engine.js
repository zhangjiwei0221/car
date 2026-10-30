/**
 * StackSort 求解器 - 游戏引擎（核心交互逻辑）
 *
 * 实现《Stack Sort.docx》第 3-4 节的核心规则（无障碍部分先做全，障碍逐步接入）：
 *
 * 移动规则(3.1)：点击未完成列 → 暂存卡放入该列顶部 → 整列下移 →
 *               该列最底部卡片移出到暂存区 → 步数 -1
 * 列完成(3.2)：某列所有参与判定的卡片颜色统一 → 该列完成并锁定，不再响应点击
 *              （万能牌 RainbowTile 不参与完成判定）
 * 自动交换(3.3)：单列中仅有一个异色卡且不在最底部，当其它列移动把对应同色卡移出到暂存
 *              时，异色卡与底部同色卡自动交换。
 * 胜利(4.1)：所有列完成。失败(4.2)：步数归零且未完成。
 *
 * 设计为纯函数式状态：state 不可变思路，move() 返回新 state，便于求解器搜索/回溯。
 */
var SS = SS || {};

SS.Engine = (function () {

  // ---- 卡片工具 ----
  function isRainbow(cell) { return cell && cell.kind === 'rainbow'; }
  // 卡片是否带某个字符串特性（Surprise / Key / Lock ...）
  function cellHasFeature(cell, name) {
    return !!(cell && cell.features && cell.features.indexOf(name) !== -1);
  }
  // 从卡片上剥离某个特性（变回普通卡，但保留颜色与其它特性）
  function stripFeature(cell, name) {
    if (cell && cell.features) cell.features = cell.features.filter(function (f) { return f !== name; });
  }
  function cloneCell(cell) {
    if (!cell) return null;
    var nc = { kind: cell.kind, colorKey: cell.colorKey, features: cell.features ? cell.features.slice() : [] };
    if (cell._link != null) nc._link = cell._link;     // 保留捆绑标记
    if (cell.topColorKey != null) nc.topColorKey = cell.topColorKey; // 保留双色块顶层
    if (cell.bomb != null) nc.bomb = cell.bomb;        // 保留炸弹倒计时（静态原值，仅用于建表）
    if (cell.bombTiming != null) nc.bombTiming = cell.bombTiming; // 保留炸弹计时模式(global/afterReveal)
    return nc;
  }

  /**
   * 从内部棋盘模型构建可玩状态
   * state = {
   *   rowCount, colCount,
   *   columns: [ [cell(top)...cell(bottom)], ... ],
   *   completed: [bool,...],
   *   bench: cell,
   *   moves: 剩余步数,
   *   columnFeatures: [...]   // 透传，障碍阶段使用
   * }
   */
  function createState(board, stepCount) {
    var columns = board.columns.map(function (col) {
      return col.tiles.map(cloneCell);
    });
    var cf = board.columnFeatures ? board.columnFeatures.map(function (a) { return a.slice(); }) : [];

    // 冰块：每列记录"需要全场完成多少列才解锁"的原始需求值
    // iceReq[c] = N (>0 表示该列是冰块列，需全场完成 N 列后解锁) 或 0 (无冰块)
    // 是否仍冻结由 completedCount 与 iceReq 实时比较得出（数字随完成数递减）
    var iceReq = columns.map(function (_, c) {
      var feats = cf[c] || [];
      var ice = feats.find(function (f) { return f.type === 'Ice'; });
      return ice ? (ice.durability || 1) : 0;
    });

    // 限定颜色列：fixedColor[c] = 该列只接受的颜色 key（含万能牌），无则 null
    var fixedColor = columns.map(function (_, c) {
      var feats = cf[c] || [];
      var fx = feats.find(function (f) { return f.type === 'FixedColor'; });
      return fx ? (fx.acceptedColor || null) : null;
    });

    // 石墙列：rockLocked[c] = true 表示该列是石墙且仍锁定（左右任一相邻列完成即解锁）
    var rockLocked = columns.map(function (_, c) {
      var feats = cf[c] || [];
      return feats.some(function (f) { return f.type === 'Rock'; });
    });

    // 保护列（CoveredColor）：coverReq[c] = 必须先完成一列该色才解锁本列（类似冰块，按颜色解锁）
    // 特殊：若 requiredColor 在棋盘上根本不存在（哨兵值，如 16_4），视为"通用保护列"，
    //       按最低门槛解锁——完成任意 1 列即解锁，标记为 '__any__'。
    var boardColorSet = {};
    columns.forEach(function (col) {
      col.forEach(function (cell) {
        if (cell && (cell.kind === 'color' || cell.kind === 'dual') && cell.colorKey) boardColorSet[cell.colorKey] = true;
      });
    });
    var coverReq = columns.map(function (_, c) {
      var feats = cf[c] || [];
      var cov = feats.find(function (f) { return f.type === 'CoveredColor'; });
      if (!cov || !cov.requiredColor) return null;
      return boardColorSet[cov.requiredColor] ? cov.requiredColor : '__any__';
    });

    var state = {
      rowCount: board.rowCount,
      colCount: board.colCount,
      columns: columns,
      completed: columns.map(function () { return false; }),
      bench: cloneCell(board.bench),
      moves: (typeof stepCount === 'number') ? stepCount : (board.stepCount || 0),
      columnFeatures: cf,
      iceReq: iceReq,
      fixedColor: fixedColor,
      rockLocked: rockLocked,
      coverReq: coverReq,
      completedColors: {},
      completedCount: 0,
      completionEvents: 0,
      everCompleted: columns.map(function () { return false; }),
      links: [],
      bombs: []
    };

    // 炸弹（Bomb）：附在某色块上，endCondition.stepCount = 倒计时。每走一步 -1；
    // 必须在倒计时归零前完成"该颜色订单"（完成一列该色）→ 拆弹，否则失败。
    // 记录为 {color, remaining, defused, timing, col, armed}（按颜色追踪，与该卡片后续移动/被挤出无关）。
    //   timing='global'(默认)：从开局就倒数；'afterReveal'(隐藏列独立计时)：所在列被揭示/解锁后才倒数。
    //   col=炸弹所在列(用于揭示判定)；armed=是否已开始倒数(global 恒 true；afterReveal 揭示后转 true)。
    for (var bcc = 0; bcc < columns.length; bcc++) {
      var bcol = columns[bcc];
      for (var brr = 0; brr < bcol.length; brr++) {
        var bcell = bcol[brr];
        if (bcell && bcell.bomb != null) {
          var btiming = (bcell.bombTiming === 'afterReveal') ? 'afterReveal' : 'global';
          state.bombs.push({ color: bcell.colorKey, remaining: bcell.bomb, defused: false, timing: btiming, col: bcc, armed: (btiming === 'global') });
        }
      }
    }

    // 捆绑：每条绳给一个 id，给两端的卡片打上 _link 标记
    if (board.links && board.links.length) {
      for (var li = 0; li < board.links.length; li++) {
        var lk = board.links[li];
        var r = lk.rowIndex;
        var a = columns[lk.col1] && columns[lk.col1][r];
        var b = columns[lk.col2] && columns[lk.col2][r];
        if (!a || !b) continue;
        a._link = li; b._link = li;
        state.links.push({ id: li, col1: lk.col1, col2: lk.col2, active: true });
      }
    }
    // 初始就已统一的列也要标记完成（冰块/石墙锁定列不参与，因为被隐藏）
    recomputeCompletion(state);
    syncCompletedCount(state);
    syncRockUnlock(state);
    recomputeCompletion(state);
    revealSurprises(state);  // 初始已在底部的问号直接揭示
    resolveKeyUnlock(state); // 初始已在底部的钥匙直接触发解锁
    syncBombs(state);        // 初始若该色已完成则炸弹直接拆除
    armBombs(state);         // 初始若独立计时炸弹所在列已是揭示状态则立即激活
    return state;
  }

  function cloneState(state) {
    return {
      rowCount: state.rowCount,
      colCount: state.colCount,
      columns: state.columns.map(function (col) { return col.map(cloneCell); }),
      completed: state.completed.slice(),
      bench: cloneCell(state.bench),
      moves: state.moves,
      columnFeatures: state.columnFeatures ? state.columnFeatures.map(function (a) { return a.slice(); }) : [],
      iceReq: state.iceReq ? state.iceReq.slice() : [],
      fixedColor: state.fixedColor ? state.fixedColor.slice() : [],
      rockLocked: state.rockLocked ? state.rockLocked.slice() : [],
      coverReq: state.coverReq ? state.coverReq.slice() : [],
      completedColors: state.completedColors ? Object.assign({}, state.completedColors) : {},
      completedCount: state.completedCount || 0,
      completionEvents: state.completionEvents || 0,
      everCompleted: state.everCompleted ? state.everCompleted.slice() : [],
      links: state.links ? state.links.map(function (l) { return { id: l.id, col1: l.col1, col2: l.col2, active: l.active }; }) : [],
      bombs: state.bombs ? state.bombs.map(function (b) { return { color: b.color, remaining: b.remaining, defused: b.defused, timing: b.timing, col: b.col, armed: b.armed }; }) : []
    };
  }

  /**
   * 判定单列是否完成 = 列里所有卡片为同一种颜色。
   *
   * 关键规则（已与设计者确认）：
   * - 万能牌(rainbow)虽"不参与颜色判定"，但它最终必须被挤进暂存区，
   *   所以只要列中还存在万能牌，该列就【不算完成】。
   * - 同理列中存在任何异色也不算完成。
   * - 空列不算完成。
   */
  function isColumnUniform(col) {
    var colorSeen = null;
    for (var i = 0; i < col.length; i++) {
      var cell = col[i];
      if (!cell || cell.kind === 'empty') return false;
      if (isRainbow(cell)) return false;       // 仍有万能牌 → 未完成
      // ★未交付的钥匙(Key)也阻止完成：否则"整列同色+含钥匙"(尤其限定色列)会被判完成→锁死，
      //   钥匙永远转不到列底、无法解锁对应锁列。钥匙到底被 resolveKeyUnlock 剥离后该列才可完成。
      if (cellHasFeature(cell, 'Key')) return false;
      if (colorSeen === null) colorSeen = cell.colorKey;
      else if (cell.colorKey !== colorSeen) return false;
    }
    return colorSeen !== null;
  }

  function recomputeCompletion(state) {
    for (var c = 0; c < state.colCount; c++) {
      if (isBlocked(state, c)) continue;      // 冰块冻结/石墙锁定/Key-Lock 锁定列不参与完成判定
      if (state.completed[c]) continue;
      if (isColumnUniform(state.columns[c])) {
        var ucolor = uniformColorOf(state.columns[c]); // 该列统一色（双色块取底层色），用于保护列解锁
        if (columnHasDual(state.columns[c])) {
          transformDualColumn(state.columns[c]); // 双色块列：底层达成 → 转换为顶层，不锁列
          registerCompletionEvent(state, c, ucolor); // ★双色块底层完成 = 一次有效完成事件(解锁冰块/石墙/保护列)
          // 转换后变普通乱序列，继续参与后续判定（通常不再 uniform）
          if (isColumnUniform(state.columns[c])) {
            state.completed[c] = true;
            registerCompletionEvent(state, c, uniformColorOf(state.columns[c])); // 极端：转换后恰好统一 → 真完成
          }
        } else {
          state.completed[c] = true;
          registerCompletionEvent(state, c, ucolor);
        }
      }
    }
  }

  // 登记一次"有效完成事件"（真完成 或 双色块底层完成）。用于解锁冰块/石墙/保护列。
  function registerCompletionEvent(state, c, color) {
    if (state.completionEvents == null) state.completionEvents = 0;
    state.completionEvents++;
    if (state.everCompleted) state.everCompleted[c] = true;
    // 记录"已被完成过的颜色"（供保护列 CoveredColor 解锁判定）
    if (color != null && state.completedColors) state.completedColors[color] = true;
  }

  // 列的统一色：列已 uniform 时返回那个颜色（双色块按底层 colorKey）；否则 null
  function uniformColorOf(col) {
    for (var i = 0; i < col.length; i++) {
      var cell = col[i];
      if (cell && (cell.kind === 'color' || cell.kind === 'dual')) return cell.colorKey;
    }
    return null;
  }

  // 列中是否含双色块
  function columnHasDual(col) {
    for (var i = 0; i < col.length; i++) if (col[i] && col[i].kind === 'dual') return true;
    return false;
  }
  // 双色块列转换：每个双色块底层消除、原位变成顶层色的普通卡；非双色块保留
  function transformDualColumn(col) {
    for (var i = 0; i < col.length; i++) {
      var cell = col[i];
      if (cell && cell.kind === 'dual') {
        col[i] = { kind: 'color', colorKey: cell.topColorKey, features: cell.features ? cell.features.slice() : [] };
      }
    }
  }

  // ---- 冰块 ----
  // 是否仍冻结：该列是冰块列(iceReq>0) 且 全场【有效完成事件数】< 需求值
  // （有效完成事件含双色块底层完成，所以双色块达成也能解冻冰块）
  function isFrozen(state, c) {
    return state.iceReq && state.iceReq[c] > 0 && (state.completionEvents || 0) < state.iceReq[c];
  }

  // 冰块上显示的剩余数字（还需多少次有效完成）
  function iceRemaining(state, c) {
    if (!state.iceReq || state.iceReq[c] <= 0) return 0;
    var rem = state.iceReq[c] - (state.completionEvents || 0);
    return rem > 0 ? rem : 0;
  }

  // 维护 completedCount（真正锁定完成的列数，用于胜利/报告）
  function syncCompletedCount(state) {
    var n = 0;
    for (var c = 0; c < state.colCount; c++) {
      if (state.completed[c]) n++;
    }
    state.completedCount = n;
  }

  // ---- 问号（Surprise）----
  // 揭示规则：问号卡到达"最下方"即揭示真实颜色。
  // "最下方"包含两种情形：
  //   1. 卡片处于某列底部（最下行）；
  //   2. 卡片被挤出到暂存区（已离开棋盘、移动到棋盘下方）。
  function revealSurprises(state) {
    function reveal(cell) {
      if (cell && cell.features && cell.features.indexOf('Surprise') !== -1) {
        cell.features = cell.features.filter(function (f) { return f !== 'Surprise'; });
      }
    }
    for (var c = 0; c < state.colCount; c++) {
      var col = state.columns[c];
      if (col.length) reveal(col[col.length - 1]); // 列底部
    }
    reveal(state.bench); // 暂存区
  }

  // ---- 捆绑（Linked Cards）----
  // 连锁传导：点击列 c 会带动【通过激活绳连通的所有列】一起动（连通分量）。
  // 返回该分量里除 c 之外的所有列（这些列做被动旋转）。
  function linkedPartners(state, c) {
    if (!state.links) return [];
    var inComp = {};
    inComp[c] = true;
    var queue = [c];
    while (queue.length) {
      var cur = queue.shift();
      for (var i = 0; i < state.links.length; i++) {
        var l = state.links[i];
        if (!l.active) continue;
        var other = null;
        if (l.col1 === cur) other = l.col2;
        else if (l.col2 === cur) other = l.col1;
        if (other != null && !inComp[other]) {
          inComp[other] = true;
          queue.push(other);
        }
      }
    }
    return Object.keys(inComp).map(Number).filter(function (x) { return x !== c; });
  }

  // 纯旋转一列：底部卡 → 顶部（整列下移一格），不碰暂存
  function rotateColumnDown(col) {
    if (col.length < 2) return;
    col.unshift(col.pop());
  }

  // 检查并断开已满足条件的绳：被绑卡到达所在列最底行，或已离开列（被挤出）
  function updateLinkBreaks(state) {
    if (!state.links) return;
    var H = state.rowCount;
    for (var i = 0; i < state.links.length; i++) {
      var l = state.links[i];
      if (!l.active) continue;
      var posA = findLinkRow(state.columns[l.col1], l.id);
      var posB = findLinkRow(state.columns[l.col2], l.id);
      if (posA === -1 || posB === -1 || posA === H - 1 || posB === H - 1) {
        l.active = false;
        clearLinkTag(state.columns[l.col1], l.id);
        clearLinkTag(state.columns[l.col2], l.id);
        if (state.bench && state.bench._link === l.id) delete state.bench._link;
      }
    }
  }
  function findLinkRow(col, id) {
    for (var i = 0; i < col.length; i++) if (col[i] && col[i]._link === id) return i;
    return -1;
  }
  function clearLinkTag(col, id) {
    for (var i = 0; i < col.length; i++) if (col[i] && col[i]._link === id) delete col[i]._link;
  }

  // ---- 石墙（Stone Wall / Rock）----
  // 仍锁定：该列是石墙 且 左右相邻列都还没完成
  function isRockLocked(state, c) {
    return !!(state.rockLocked && state.rockLocked[c]);
  }
  // 结算时检查石墙解锁：左或右相邻列已完成 → 解锁该石墙
  function syncRockUnlock(state) {
    if (!state.rockLocked) return;
    for (var c = 0; c < state.colCount; c++) {
      if (!state.rockLocked[c]) continue;
      var left = c - 1, right = c + 1;
      // 相邻列"曾完成过"（含双色块底层完成事件）即可解锁
      var leftDone = left >= 0 && state.everCompleted && state.everCompleted[left];
      var rightDone = right < state.colCount && state.everCompleted && state.everCompleted[right];
      if (leftDone || rightDone) state.rockLocked[c] = false;
    }
  }
  // ---- 保护列（CoveredColor）----
  // 仍被保护：该列有 coverReq 且 解锁条件未达成
  //   - 普通：需求色尚未有任意一列被完成过；
  //   - 通用('__any__')：尚未完成任意一列（completionEvents < 1）。
  function isCovered(state, c) {
    var req = state.coverReq && state.coverReq[c];
    if (!req) return false;
    if (req === '__any__') return (state.completionEvents || 0) < 1;
    return !(state.completedColors && state.completedColors[req]);
  }
  // 保护列上显示的"需先完成的颜色"key（通用保护列返回 null）
  function coverRequiredColor(state, c) {
    var req = (state.coverReq && state.coverReq[c]) || null;
    return req === '__any__' ? null : req;
  }

  // 列是否"隐藏/锁死"（冰块冻结 或 石墙锁定 或 保护列）—— 不可点、不参与完成判定、UI 隐藏
  function isLocked(state, c) {
    return isFrozen(state, c) || isRockLocked(state, c) || isCovered(state, c);
  }

  // ---- 锁定列（Key + Lock）----
  // 数据：Key / Lock 都是卡片级特性（cell.features 含 'Key' / 'Lock'）。
  // 机制：列里只要有一张带 'Lock' 的卡 → 整列被锁（不可点、不参与完成判定），但【颜色可见】。
  //       某列里带 'Key' 的卡被转到列底部时 → 剥离该 Key，并把"从左到右第一个被锁列"解锁
  //       （剥离其 Lock 特性，恢复成普通列）。比石墙/冰块宽松：只要 key 到底即解锁。
  function keyLockedCol(state, c) {
    var col = state.columns[c];
    for (var i = 0; i < col.length; i++) if (cellHasFeature(col[i], 'Lock')) return true;
    return false;
  }
  // 扫描：每列底部若是 Key 卡 → 剥离 Key，解锁最左被锁列。可一次处理多把到底的钥匙。
  // ★钥匙被挤出到暂存区(越过出口)也视为"到底"，同样触发解锁——否则"把钥匙挤出列底"那步不会激活锁
  //   （与问号"到列底 或 被挤出暂存 都算揭示"口径一致）。
  function resolveKeyUnlock(state) {
    var changed = false;
    function unlockLeftmost() {   // 解锁从左到右第一个仍被锁的列（剥离其 Lock 特性）
      for (var t = 0; t < state.colCount; t++) {
        if (keyLockedCol(state, t)) {
          var tcol = state.columns[t];
          for (var j = 0; j < tcol.length; j++) {
            if (cellHasFeature(tcol[j], 'Lock')) { stripFeature(tcol[j], 'Lock'); break; }
          }
          break;
        }
      }
    }
    for (var c = 0; c < state.colCount; c++) {
      var col = state.columns[c];
      if (!col.length) continue;
      var bottom = col[col.length - 1];
      if (cellHasFeature(bottom, 'Key')) {     // 钥匙停在列底
        stripFeature(bottom, 'Key');
        unlockLeftmost();
        changed = true;
      }
    }
    // 钥匙被挤出到暂存区（刚越过列底出口）→ 同样触发解锁
    if (state.bench && cellHasFeature(state.bench, 'Key')) {
      stripFeature(state.bench, 'Key');
      unlockLeftmost();
      changed = true;
    }
    return changed;
  }

  // 列是否"被阻塞"：隐藏锁死(冰块/石墙) 或 Key-Lock 锁定。
  // 用于：不可点、不参与完成判定、不参与自动扶正。（与 isLocked 区别：isLocked 仅指需隐藏渲染的障碍）
  function isBlocked(state, c) {
    return isLocked(state, c) || keyLockedCol(state, c);
  }

  /**
   * 是否可点击该列：未完成 且 未被冻结
   */
  // ---- 限定颜色列 ----
  // 该列是否接受当前暂存卡（限定列只收指定色或万能牌；非限定列恒接受）
  function acceptsBench(state, c) {
    var fx = state.fixedColor && state.fixedColor[c];
    if (!fx) return true;                       // 非限定列
    var b = state.bench;
    if (!b) return false;
    if (b.kind === 'rainbow') return true;      // 万能牌可放入限定列
    return b.kind === 'color' && b.colorKey === fx;
  }

  function isColumnPlayable(state, c) {
    if (c < 0 || c >= state.colCount) return false;
    if (state.completed[c]) return false;
    if (isBlocked(state, c)) return false;    // 冰块冻结/石墙锁定/Key-Lock 锁定列不可操作
    if (!acceptsBench(state, c)) return false; // 限定列：暂存色不匹配则不可放入
    return true;
  }

  /**
   * 自动扶正规则(文档 3.3 的本质)
   *
   * 触发条件（已与设计者确认，对"普通异色卡"和"万能牌"都适用）：
   *   1. 暂存区的牌是普通色 C（不是万能牌）；
   *   2. 某未完成列中，除了【恰好 1 张】非 C 的卡（异色 或 万能牌）外，其余全是 C；
   *   3. 这张非 C 的卡【不在列底部】。
   * 满足时系统自动把这张非 C 卡与底部的 C 卡交换 → 非 C 卡被挪到底部。
   *
   * 作用：玩家随后点这一列，暂存的 C 放进顶部、底部那张非 C 卡被挤进暂存区，
   *      该列 1 步即完成，无需手动反复挤压。
   *
   * 说明：该规则在每步"结算阶段"统一处理（move 之后调用）。它依赖当前暂存区的颜色，
   *      因此 benchColorKey 由 move 传入；benchColorKey 为 null（暂存是万能牌）时不触发。
   */
  function resolveAutoSwap(state) {
    var swapped = [];   // 被自动扶正重排的列索引（供 UI 高亮提示）
    var benchKey = (state.bench && !isRainbow(state.bench)) ? state.bench.colorKey : null;
    if (benchKey === null) {
      return swapped; // 暂存区是万能牌或空，不触发自动扶正
    }

    for (var c = 0; c < state.colCount; c++) {
      if (state.completed[c]) continue;
      if (isBlocked(state, c)) continue;   // 冻结/石墙锁定/Key-Lock 锁定列不参与自动扶正
      var col = state.columns[c];
      if (col.length < 2) continue;

      // 列里非 benchKey 的卡片（异色 或 万能牌）位置集合
      var offIdx = [];
      var allElseAreBench = true;
      for (var i = 0; i < col.length; i++) {
        var cell = col[i];
        // 双色块(dual)按【底层色 colorKey】参与同色判定，与 isColumnUniform/uniformColorOf 一致：
        // 这样"同色主体是双色块、中间夹 1 张异色、手牌为该同色"时也能正确触发自动扶正(吸附)。
        var isBenchColor = (cell && (cell.kind === 'color' || cell.kind === 'dual') && cell.colorKey === benchKey);
        if (!isBenchColor) offIdx.push(i);
      }

      // 必须恰好 1 张非 benchKey 卡，其余全是 benchKey
      if (offIdx.length !== 1) continue;

      var oi = offIdx[0];
      var bottom = col.length - 1;
      if (oi === bottom) continue; // 已在底部，无需扶正

      // 交换该非 benchKey 卡与底部（底部此时必为 benchKey）
      var tmp = col[oi];
      col[oi] = col[bottom];
      col[bottom] = tmp;
      swapped.push(c);
    }
    if (swapped.length) recomputeCompletion(state);
    return swapped;
  }

  /**
   * 执行一步移动：点击第 c 列
   * 返回 { state, ok, reason }
   */
  function move(state, c, opts) {
    opts = opts || {};
    if (!isColumnPlayable(state, c)) {
      return { state: state, ok: false, reason: 'column-not-playable' };
    }
    if (state.moves <= 0) {
      return { state: state, ok: false, reason: 'no-moves' };
    }

    var ns = cloneState(state);
    var col = ns.columns[c];

    // 暂存卡放入顶部，整列下移，底部卡移出到暂存
    var benchCard = ns.bench;
    col.unshift(benchCard);          // 放到顶部 (index 0)
    var outgoing = col.pop();        // 底部移出
    ns.bench = outgoing;

    // 捆绑连锁：点击列带动【整个连通分量】的列，被动列各旋转一次（底部→顶部），不耗步
    var partners = linkedPartners(ns, c);
    for (var pi = 0; pi < partners.length; pi++) {
      rotateColumnDown(ns.columns[partners[pi]]);
    }

    ns.moves -= 1;
    tickBombs(ns);               // 炸弹倒计时 -1（每步）

    // 结算顺序：
    //   1. 问号揭示（移动后底部卡若是问号 → 揭示颜色）
    //   2. 断绳判定（被绑卡到达最底行/被挤出 → 断开）
    //   3. 完成判定
    //   4. 自动扶正（依赖暂存颜色）
    //   5. 钥匙解锁（★放在自动扶正之后：自动扶正可能把钥匙送到列底，必须在它之后统一检测，
    //      才能保证"钥匙到达列底的那一步"即激活锁；同时覆盖钥匙被挤出到暂存的情形）
    //   6. 石墙解锁 → 再次完成判定
    revealSurprises(ns);
    updateLinkBreaks(ns);
    recomputeCompletion(ns);
    var autoCols = resolveAutoSwap(ns);
    resolveKeyUnlock(ns);        // Key-Lock：钥匙到列底(含被自动扶正送到底/被挤出暂存) → 解锁最左被锁列
    syncCompletedCount(ns);
    syncRockUnlock(ns);          // 石墙：相邻列完成则解锁
    recomputeCompletion(ns);     // 解锁后的石墙列/钥匙列可能恰好已统一
    syncCompletedCount(ns);
    syncBombs(ns);               // 炸弹：该色订单完成则拆除
    armBombs(ns);                // 独立计时炸弹：所在隐藏列本步被揭示/解锁 → 下一步起开始倒数

    // 联动列(供 UI 提示同一次点击为何会有其他列变化)：捆绑被动列 + 自动扶正列
    return { state: ns, ok: true, reason: null, autoCols: autoCols, linkedCols: partners };
  }

  // ---- 炸弹（Bomb）----
  // 拆弹：该颜色订单已完成（completedColors 含该色）→ defused=true，永久解除。
  // syncBombs 在每次完成判定后调用，刷新 defused 标记。
  function syncBombs(state) {
    if (!state.bombs) return;
    for (var i = 0; i < state.bombs.length; i++) {
      var b = state.bombs[i];
      if (!b.defused && state.completedColors && state.completedColors[b.color]) b.defused = true;
    }
  }
  // 炸弹倒计时步数 -1（每走一步调用一次），仅对未拆除【且已激活(armed)】的炸弹。
  // 独立计时炸弹(timing='afterReveal')在所在列被揭示前 armed=false → 不倒数。
  function tickBombs(state) {
    if (!state.bombs) return;
    for (var i = 0; i < state.bombs.length; i++) {
      var b = state.bombs[i];
      if (b.defused) continue;
      if (b.armed === false) continue;   // 未激活(隐藏列尚未揭示) → 暂不倒数
      b.remaining -= 1;
    }
  }
  // 激活独立计时炸弹：所在列从锁定/隐藏变为可见(!isBlocked) → armed=true，自此开始倒数。
  function armBombs(state) {
    if (!state.bombs) return;
    for (var i = 0; i < state.bombs.length; i++) {
      var b = state.bombs[i];
      if (b.defused || b.armed) continue;
      if (b.timing === 'afterReveal' && !isBlocked(state, b.col)) b.armed = true;
    }
  }
  // 是否有炸弹已爆炸（已激活、未拆除且倒计时已归零/为负）→ 关卡失败
  function bombFailed(state) {
    if (!state.bombs) return false;
    for (var i = 0; i < state.bombs.length; i++) {
      var b = state.bombs[i];
      if (!b.defused && b.armed !== false && b.remaining <= 0) return true;
    }
    return false;
  }
  // 炸弹剩余最小倒计时（UI/求解参考），无活炸弹返回 Infinity
  function minBombRemaining(state) {
    var m = Infinity;
    if (state.bombs) for (var i = 0; i < state.bombs.length; i++) {
      var b = state.bombs[i];
      if (!b.defused && b.remaining < m) m = b.remaining;
    }
    return m;
  }

  function isWin(state) {
    for (var c = 0; c < state.colCount; c++) {
      if (!state.completed[c]) return false;
    }
    return true;
  }

  function isLose(state) {
    if (bombFailed(state)) return true;        // 炸弹爆炸 → 失败
    return !isWin(state) && state.moves <= 0;
  }

  return {
    createState: createState,
    cloneState: cloneState,
    move: move,
    isColumnPlayable: isColumnPlayable,
    isColumnUniform: isColumnUniform,
    recomputeCompletion: recomputeCompletion,
    resolveAutoSwap: resolveAutoSwap,
    isWin: isWin,
    isLose: isLose,
    isRainbow: isRainbow,
    isFrozen: isFrozen,
    isRockLocked: isRockLocked,
    isCovered: isCovered,
    coverRequiredColor: coverRequiredColor,
    isLocked: isLocked,
    keyLockedCol: keyLockedCol,
    isBlocked: isBlocked,
    cellHasFeature: cellHasFeature,
    iceRemaining: iceRemaining,
    acceptsBench: acceptsBench,
    bombFailed: bombFailed,
    minBombRemaining: minBombRemaining
  };
})();
