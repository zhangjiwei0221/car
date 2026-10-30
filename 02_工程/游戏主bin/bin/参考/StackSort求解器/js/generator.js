/**
 * StackSort 求解器 - 关卡生成器（纯逻辑，无 DOM）
 *
 * 生成流程：
 *   1) 规格 H×K
 *   2) 按颜色种类分配列、填色，按"混乱度"打乱（乱序/中乱序/微有序）
 *   3) 放障碍（遵守障碍生成规则）
 *   4) 合法性校验（每色=行高整数倍、列数和=K、万能牌=1）
 *   5) 求解 + 难度阈值校验
 *   6) 通过则输出关卡 raw JSON，否则重试
 *
 * 依赖：SS.Engine / SS.Solver / SS.Analysis / SS.Colors。
 */
var SS = SS || {};

SS.Generator = (function () {

  function rint(n) { return Math.floor(Math.random() * n); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = rint(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // ---- 棋盘乱序：列同色约束（每列任一颜色 ≤ cap）----
  // 生成过程中收集的板级警告（如"列同色过多")。generateOne 每次尝试前清空、之后并入 obs.warnings。
  var genBoardWarnings = [];
  function genBoardWarn(m) { if (genBoardWarnings.indexOf(m) < 0) genBoardWarnings.push(m); }

  // 区域内 cap-aware 重分配：把 colIdxs 这些列持有的所有格子，按"每列任一颜色出现 ≤ cap"重新分配；
  //   ★只在区域内部重排，不改变该区域持有的【颜色多重集】→ 不破坏障碍可达性(钥匙色仍完整留在本区)。
  //   多次随机尝试取"无溢出"的结果；返回 true 表示溢出(该区列太少、某色太集中，被迫 >cap)。
  function fillRegionCapped(columns, H, colIdxs, cap) {
    var basePool = {};
    colIdxs.forEach(function (c) { columns[c].forEach(function (k) { basePool[k] = (basePool[k] || 0) + 1; }); });
    var keys = Object.keys(basePool);
    var best = null, bestOverflow = true;
    for (var attempt = 0; attempt < 12; attempt++) {
      var pool = {}; keys.forEach(function (k) { pool[k] = basePool[k]; });
      var order = colIdxs.slice(); shuffle(order);
      var assign = {}; var overflow = false;
      order.forEach(function (c) {
        var col = [], per = {};
        for (var slot = 0; slot < H; slot++) {
          var cands = keys.filter(function (k) { return pool[k] > 0 && (per[k] || 0) < cap; });
          var pick;
          if (cands.length) {
            cands.sort(function (a, b) { return pool[b] - pool[a]; });   // 剩余最多优先(均摊)
            var top = pool[cands[0]];
            var ties = cands.filter(function (k) { return pool[k] === top; });
            pick = ties[rint(ties.length)];
          } else {
            var any = keys.filter(function (k) { return pool[k] > 0; });
            any.sort(function (a, b) { return pool[b] - pool[a]; });
            pick = any[0]; overflow = true;                              // 无满足cap的候选 → 被迫溢出
          }
          col.push(pick); pool[pick]--; per[pick] = (per[pick] || 0) + 1;
        }
        shuffle(col);                                                    // 行内随机
        assign[c] = col;
      });
      if (!overflow) { best = assign; bestOverflow = false; break; }
      if (!best) best = assign;   // 记住一个(溢出)结果兜底
    }
    colIdxs.forEach(function (c) { for (var r = 0; r < H; r++) columns[c][r] = best[c][r]; });
    return bestOverflow;
  }

  // 对一组列施加"每列同色≤3"约束；3 溢出→放宽到 4；4 仍溢出→警告⚠️列同色过多。返回最终生效 cap。
  function capColumns(columns, H, colIdxs, label) {
    if (!colIdxs || !colIdxs.length) return 3;
    if (!fillRegionCapped(columns, H, colIdxs, 3)) return 3;
    if (!fillRegionCapped(columns, H, colIdxs, 4)) return 4;
    genBoardWarn('⚠️ ' + (label || '某区域') + '列同色过多(可达列太少，无法压到≤4)');
    return 5;
  }

  // ---- 可达性轻量检查（完成列粒度 BFS，挡"死锁盘"；真实可解仍由 multiSolve 兜底）----
  // 模型：可达列(未隐藏)里某色总数≥H → 可完成1列(events++、该色记完成) → 据此解锁硬障碍(冰块 events≥dur /
  //   石墙 相邻列已解锁 / 指定色消除 完成其需求色 / 钥匙锁 已解锁列里有钥匙可转到底) → 解锁列并入可达 → 循环。
  //   只要存在"每步≥1列可完成 或 ≥1障碍可解锁"的推进链直到所有障碍解锁 → 通过；中途死锁 → 失败。
  function reachabilityCheck(state) {
    var K = state.colCount, H = state.rowCount;
    var E = SS.Engine;
    // ★含双色块的关跳过本检查：双色块会从可达区"借走"颜色格变底色(使钥匙色暂不满列)，
    //   但完成底色→转换→补回借走的色，BFS 建模不了这个"转换补色"机制，硬判会误杀 → 交给 multiSolve 严格裁定。
    for (var dc = 0; dc < K; dc++) for (var dr = 0; dr < state.columns[dc].length; dr++) {
      if (state.columns[dc][dr] && state.columns[dc][dr].kind === 'dual') return true;
    }
    function colColorCount(c) {
      var m = {};
      state.columns[c].forEach(function (cell) {
        if (cell && (cell.kind === 'color' || cell.kind === 'dual') && cell.colorKey) m[cell.colorKey] = (m[cell.colorKey] || 0) + 1;
      });
      return m;
    }
    var unlocked = {}, pool = {};
    function addToPool(c) { var m = colColorCount(c); for (var k in m) pool[k] = (pool[k] || 0) + m[k]; }
    for (var c = 0; c < K; c++) if (!E.isBlocked(state, c)) { unlocked[c] = 1; addToPool(c); }
    function hasKeyInUnlocked() {
      for (var k in unlocked) { var col = state.columns[+k]; for (var i = 0; i < col.length; i++) if (col[i] && col[i].features && col[i].features.indexOf('Key') >= 0) return true; }
      return false;
    }
    function canUnlock(c, events, doneColors) {
      if (state.iceReq && state.iceReq[c] > 0) return events >= state.iceReq[c];
      if (state.rockLocked && state.rockLocked[c]) return (c - 1 >= 0 && unlocked[c - 1]) || (c + 1 < K && unlocked[c + 1]);
      if (state.coverReq && state.coverReq[c]) { var rq = state.coverReq[c]; return rq === '__any__' ? (events >= 1) : !!doneColors[rq]; }
      if (E.keyLockedCol(state, c)) return hasKeyInUnlocked();
      return false;
    }
    var events = 0, doneColors = {}, doneCols = 0, guard = K * 4;
    function allUnlocked() { for (var c2 = 0; c2 < K; c2++) if (!unlocked[c2]) return false; return true; }
    while (guard-- > 0) {
      var progress = false;
      for (var col in pool) { if (pool[col] >= H) { pool[col] -= H; events++; doneColors[col] = 1; doneCols++; progress = true; break; } }
      for (var c3 = 0; c3 < K; c3++) {
        if (unlocked[c3]) continue;
        if (canUnlock(c3, events, doneColors)) { unlocked[c3] = 1; addToPool(c3); progress = true; }
      }
      if (allUnlocked()) return true;   // 所有障碍可解锁 → 剩余是平衡盘普通可解(交给 multiSolve)
      if (!progress) return false;      // 死锁：既不能完成列也不能解锁障碍
    }
    return allUnlocked();
  }

  // ---- 冰块颜色拆分依赖（默认开）----
  // 把某"依赖色 C"(非钥匙、全盘恰 H 个=一列订单)的副本，从可达区温和搬到 ≥2 个不同 durability 的冰块列里，
  // 于是"完成 C 订单"必须先按 durability 顺序解冻这些冰块。每冰块列放 ≤perIce(≤3) 个 → 不破坏列同色≤3。
  // 可解性由 reachabilityCheck + multiSolve 兜底（可达区仍保留完整钥匙色驱动逐级解冻）。
  // 返回 true 表示成功形成跨冰块依赖。
  function splitIceColorDependency(columns, H, K, iceColsSorted, keyColors) {
    if (!iceColsSorted || iceColsSorted.length < 2) return false;   // 需 ≥2 冰块才有"跨冰块顺序"
    var keySet = {}; (keyColors || []).forEach(function (k) { keySet[k] = 1; });
    var total = {};
    for (var c = 0; c < K; c++) columns[c].forEach(function (k) { total[k] = (total[k] || 0) + 1; });
    var cands = Object.keys(total).filter(function (k) { return !keySet[k] && total[k] === H; });
    if (!cands.length) return false;
    var C = cands[rint(cands.length)];
    var perIce = Math.max(1, Math.min(3, Math.floor(H / (iceColsSorted.length + 1))));
    function findCOutsideIce() {   // 只从【非冰块列】(可达区/其它锁定列)取 C，搬进冰块列
      for (var c = 0; c < K; c++) { if (iceColsSorted.indexOf(c) >= 0) continue; for (var r = 0; r < H; r++) if (columns[c][r] === C) return [c, r]; }
      return null;
    }
    var touched = 0;
    iceColsSorted.forEach(function (ic) {
      var placed = 0; for (var r0 = 0; r0 < H; r0++) if (columns[ic][r0] === C) placed++;
      for (var r = 0; r < H && placed < perIce; r++) {
        if (columns[ic][r] === C) continue;
        var pos = findCOutsideIce(); if (!pos) break;
        var tmp = columns[ic][r]; columns[ic][r] = columns[pos[0]][pos[1]]; columns[pos[0]][pos[1]] = tmp;
        placed++;
      }
      if (placed > 0) touched++;
    });
    return touched >= 2;
  }


  // ---- 炸弹倒计时/数量/放置（统一）----
  // 倒计时 = frac × 步数上限 sc（在 buildRaw 落地）。frac 区间按位置/计时模式：
  //   明牌(可见列) 0.40~0.90；隐藏列·全局共享步数 0.80~0.90；隐藏列·独立计时(揭示后才扣) 0.40~0.60。
  function bombFracRange(hidden, timing) {
    if (!hidden) return [0.40, 0.90];
    return (timing === 'independent') ? [0.40, 0.60] : [0.80, 0.90];
  }
  function randFrac(range) { return range[0] + Math.random() * (range[1] - range[0]); }
  // 从 gopts 解析本关炸弹数量（[min,max] 随机，≤ K）
  function bombCountFromOpts(gopts, K) {
    gopts = gopts || {};
    var mn = Math.max(1, Math.min(8, gopts.bombCountMin || 1));
    var mx = Math.max(mn, Math.min(8, gopts.bombCountMax || mn));
    return Math.max(1, Math.min(mn + rint(mx - mn + 1), K));
  }
  // 统一炸弹放置：写入 obs.cellFeatures['c_r']+='Bomb'、obs.bombFrac['c_r']=frac、obs.bombTiming(级别统一)。
  //   meta(可选,来自混合关)={keyColors,reachList,lockedCols}：
  //     · 明牌炸弹(约束2)：只放在【可达完整色 keyColors】的格上(可达列)，避开被锁在后期的颜色；
  //     · 隐藏列炸弹：放进锁定列(顶部区)，炸弹色=该锁定列色，由计时模式(独立/全局)承担压力。
  //   无 meta(无障碍/软障碍关) → 明牌、任意列顶部、所有色皆可达。
  function placeBombs(boardWrap, obs, H, K, gopts, meta) {
    meta = meta || {}; gopts = gopts || {};
    var cols = boardWrap.columns;
    var count = bombCountFromOpts(gopts, K);
    var lockedCols = meta.lockedCols || [];
    var hidden = !!gopts.bombHidden && lockedCols.length > 0;
    var timing = (hidden && gopts.bombTiming === 'independent') ? 'afterReveal' : 'global';
    var range = bombFracRange(hidden, gopts.bombTiming);
    obs.bombFrac = obs.bombFrac || {};
    obs.bombTiming = timing;
    function colorOf(cr) { var p = cr.split('_'); return cols[+p[0]] ? cols[+p[0]][+p[1]] : null; }
    function occupied(cr) {
      if (obs.dualCells && obs.dualCells[cr]) return true;
      var f = obs.cellFeatures[cr] || [];
      return f.indexOf('Bomb') >= 0 || f.indexOf('Lock') >= 0 || f.indexOf('Key') >= 0;
    }
    var usedColors = {};   // ★炸弹颜色互不相同：已被某炸弹占用的颜色不再放第二个炸弹
    function addBomb(cr) {
      obs.cellFeatures[cr] = (obs.cellFeatures[cr] || []).filter(function (x) { return x !== 'Surprise'; });
      obs.cellFeatures[cr].push('Bomb');
      obs.bombFrac[cr] = randFrac(range);
      var col = colorOf(cr); if (col) usedColors[col] = 1;
    }
    function usable(cr) { return !occupied(cr) && !usedColors[colorOf(cr)]; }   // 未占用 且 颜色未被其它炸弹用
    var placed = 0;
    if (hidden) {
      var lcs = lockedCols.slice(); shuffle(lcs);
      for (var i = 0; i < lcs.length && placed < count; i++) {
        for (var r = 0; r < H; r++) {
          var cr = lcs[i] + '_' + r;
          if (!usable(cr)) continue;
          addBomb(cr); placed++; break;   // 每锁定列放 1 个(颜色不重复)
        }
      }
    }
    if (placed < count) {
      var keySet = null;
      if (meta.keyColors && meta.keyColors.length) { keySet = {}; meta.keyColors.forEach(function (k) { keySet[k] = 1; }); }
      var cand = (meta.reachList && meta.reachList.length) ? meta.reachList.slice() : [];
      if (!cand.length) { for (var c = 0; c < K; c++) cand.push(c); }
      shuffle(cand);
      for (var ci = 0; ci < cand.length && placed < count; ci++) {
        for (var rr = 0; rr < H; rr++) {
          var cr2 = cand[ci] + '_' + rr;
          if (!usable(cr2)) continue;
          if (keySet && !keySet[cols[cand[ci]][rr]]) continue;   // 约束2：明牌炸弹色必须是可达完整色
          addBomb(cr2); placed++; break;
        }
      }
      // 兜底：keyColors 限制下没放够 → 放宽到任意可达列(仍保证颜色不重复)
      if (placed < count && keySet) {
        for (var cj = 0; cj < cand.length && placed < count; cj++) {
          for (var r3 = 0; r3 < H; r3++) {
            var cr3 = cand[cj] + '_' + r3;
            if (!usable(cr3)) continue;
            addBomb(cr3); placed++; break;
          }
        }
      }
    }
    if (placed < count) {
      obs.warnings = obs.warnings || [];
      obs.warnings.push('炸弹数量减为 ' + placed + '/' + count + ' 个(可用的不同颜色不足，炸弹颜色须互不相同)');
    }
    return placed;
  }

  // 列障碍分布模式：返回 count 个列下标。
  //   adjacent 并列 / spaced 隔列 / edges 左右边缘 / symmetric 对称
  function pickColumns(K, count, mode) {
    count = Math.max(0, Math.min(count, K));
    var cols = [];
    if (mode === 'adjacent') {
      var start = rint(Math.max(1, K - count + 1));
      for (var i = 0; i < count; i++) cols.push(start + i);
    } else if (mode === 'edges') {
      var l = 0, r = K - 1;
      while (cols.length < count && l <= r) { cols.push(l++); if (cols.length < count && r >= l) cols.push(r--); }
    } else if (mode === 'symmetric') {
      var a = Math.floor((K - 1) / 2), b = Math.ceil((K - 1) / 2);
      if (a === b) { cols.push(a); a--; b++; }
      while (cols.length < count) { if (a >= 0) cols.push(a); if (cols.length < count && b < K && b !== a) cols.push(b); a--; b++; if (a < 0 && b >= K) break; }
    } else { // spaced 隔列（默认）
      for (var c = 0; c < K && cols.length < count; c += 2) cols.push(c);
      for (var c2 = 1; c2 < K && cols.length < count; c2 += 2) cols.push(c2);
    }
    var seen = {}, out = [];
    cols.forEach(function (c) { if (c >= 0 && c < K && !seen[c]) { seen[c] = 1; out.push(c); } });
    return out.slice(0, count).sort(function (x, y) { return x - y; });
  }
  // 钥匙行：上部，且距底 ≥4（H-1-r ≥4），保证解锁需多步。H 太小则取 0(顶)。
  function keyRowUpper(H) {
    var maxR = H - 5;
    if (maxR <= 0) return 0;
    return rint(maxR + 1);
  }
  // 冰块步数数组：多个冰块【步数严格互不相同】。可区分的不同值个数 = max-min+1；
  // 请求超过可区分数 → 只返回可区分数个(调用方据此减少冰块数量，不生成同步数的多余冰块)。
  // 返回的步数互不相同（min..max 的一个随机排列截取）。
  function iceDurArray(count, min, max) {
    min = Math.max(1, Math.min(4, min || 1)); max = Math.max(min, Math.min(4, max || min));
    var range = max - min + 1;
    count = Math.max(1, Math.floor(count));
    if (count === 1) return [min + rint(range)];
    var vals = []; for (var v = min; v <= max; v++) vals.push(v);   // [min..max] 互不相同
    shuffle(vals);
    return vals.slice(0, Math.min(count, range));                   // 最多 range 个不同步数
  }

  // 问号规律布局（多种数学规律，不强制偶数成对）：随机选一种模式生成"候选格序列"，按序取可用格直到达到 count。
  //   模式：① 横向成对 ② 间隔成对(对间空1列) ③ 交错齿轮(奇偶行左右交替) ④ 棋盘格((r+c)同奇偶) ⑤ 对角线
  // 数量上限 = 可达空格（排除最底行 + blocked 占用格）。返回数组，并挂 .relaxed / .placed：
  //   relaxed=true 表示"未能完全按规律"（被其它障碍挤占而跳格 或 可达空格不足以达到 count）→ 由上层打 ⚠️。
  function surprisePattern(K, H, count, blocked) {
    count = Math.max(0, Math.floor(count));
    var maxRow = H - 2;   // 排除最底行(初始在列底会被立即揭示)
    var out = []; out.relaxed = false; out.placed = 0; out.requested = count;
    if (count <= 0 || maxRow < 0 || K < 1) return out;
    blocked = blocked || {};
    var used = {};
    function freeCell(c, r) { var k = c + '_' + r; return c >= 0 && c < K && r >= 0 && r <= maxRow && !used[k] && !blocked[k]; }
    // 按模式生成候选 (c,r) 序列（覆盖全盘，作为铺放顺序 → 既呈规律又能在受阻时继续）
    var cand = [], r, c;
    var mode = rint(5);
    if (mode === 0) {                 // 横向成对
      for (r = 0; r <= maxRow; r++) for (c = 0; c + 1 < K; c += 2) { cand.push([c, r]); cand.push([c + 1, r]); }
    } else if (mode === 1) {          // 间隔成对（每对之间空 1 列）
      for (r = 0; r <= maxRow; r++) for (c = 0; c + 1 < K; c += 3) { cand.push([c, r]); cand.push([c + 1, r]); }
    } else if (mode === 2) {          // 交错齿轮（奇偶行从左/右扫）
      for (r = 0; r <= maxRow; r++) for (var s = 0; s < K; s++) { var cc = (r % 2 === 0) ? s : (K - 1 - s); cand.push([cc, r]); }
    } else if (mode === 3) {          // 棋盘格（先 (r+c) 偶，再奇 兜底）
      for (r = 0; r <= maxRow; r++) for (c = 0; c < K; c++) if ((r + c) % 2 === 0) cand.push([c, r]);
      for (r = 0; r <= maxRow; r++) for (c = 0; c < K; c++) if ((r + c) % 2 === 1) cand.push([c, r]);
    } else {                          // 对角线（逐条反对角线）
      for (var d = 0; d < K + maxRow; d++) for (r = 0; r <= maxRow; r++) { c = d - r; if (c >= 0 && c < K) cand.push([c, r]); }
    }
    // 按候选序取 count 个可用格；记录"被阻挡而跳过"的次数（规律被打断的信号）
    var skippedBlocked = 0;
    for (var i = 0; i < cand.length && out.length < count; i++) {
      var cx = cand[i][0], cy = cand[i][1], key = cx + '_' + cy;
      if (used[key]) continue;
      if (blocked[key]) { skippedBlocked++; continue; }
      if (cy > maxRow) continue;
      used[key] = 1; out.push(key);
    }
    out.placed = out.length;
    out.relaxed = (out.length < count) || (skippedBlocked > 0);   // 数量没放满 或 规律被障碍打断 → 警告
    return out;
  }

  // 捆绑规律布局：最小单位=左右相邻 2 列的一条横向绳；按随机模式排列——
  //   上下(同列对逐行) / 对角线(逐行右移) / 交错齿轮(奇偶行左右交替)。排除最底行(初始在底会立即断)。
  // blockedCols:{col:truthy} 不可用列(限定列/双色块列)。返回 [{rowIndex,col1,col2},...]
  function linkPattern(K, H, count, blockedCols, blockedCells) {
    count = Math.max(0, Math.floor(count));
    var maxRow = H - 2;
    if (count <= 0 || maxRow < 0 || K < 2) return [];
    blockedCols = blockedCols || {};
    blockedCells = blockedCells || {};       // 格级避让(如问号已占格) → 捆绑不与问号重叠
    var links = [], used = {};
    function ok(r, c) {
      if (c < 0 || c + 1 >= K || r < 0 || r > maxRow) return false;
      if (blockedCols[c] || blockedCols[c + 1]) return false;
      if (blockedCells[c + '_' + r] || blockedCells[(c + 1) + '_' + r]) return false;   // 避开问号等已占格
      return !(used[r + '_' + c] || used[r + '_' + (c + 1)]);
    }
    function add(r, c) { links.push({ rowIndex: r, col1: c, col2: c + 1 }); used[r + '_' + c] = used[r + '_' + (c + 1)] = 1; }
    var pat = rint(3);
    if (pat === 0) {                 // 上下：固定列对逐行
      var c0 = Math.min(K - 2, rint(Math.max(1, K - 1)));
      for (var r = 0; r <= maxRow && links.length < count; r++) if (ok(r, c0)) add(r, c0);
    } else if (pat === 1) {          // 对角线：逐行右移
      var c = 0, rr = 0;
      while (links.length < count && rr <= maxRow * 2) { var r2 = rr % (maxRow + 1); if (ok(r2, c)) add(r2, c); c++; if (c + 1 >= K) c = 0; rr++; }
    } else {                         // 交错齿轮：奇偶行左右交替
      var leftC = 0, rightC = K - 2;
      for (var r3 = 0; r3 <= maxRow && links.length < count; r3++) { var cc = (r3 % 2 === 0) ? leftC : rightC; if (ok(r3, cc)) add(r3, cc); }
    }
    var byPattern = links.length;    // 规律模式放置数（用于判断是否被迫放宽）
    // 兜底补足
    for (var ra = 0; ra <= maxRow && links.length < count; ra++) for (var ca = 0; ca + 1 < K && links.length < count; ca += 2) if (ok(ra, ca)) add(ra, ca);
    // 数量没放满 或 规律模式没凑齐(动用了兜底补足) → 标记放宽，由上层打 ⚠️
    links.relaxed = (links.length < count) || (byPattern < count);
    links.placed = links.length;
    links.requested = count;
    return links;
  }

  // ---- 1+2) 配色 + 混乱度 ----
  // 返回 columns: [[colorKey,...],...]（index0=顶部），balanced：每色=占用列数×H
  // 注：chaos 形参已废弃——初始棋盘一律【完全乱序】(full shuffle)。这样求解推进过程必然
  //     把所有方块翻动到底部，确保问号/冰块等障碍都会在通关前被揭示/解锁，UI 展示才完整。
  function buildColorBoard(H, K, colorCount, chaos) {
    colorCount = Math.max(1, Math.min(colorCount, K));
    // 分配列给颜色：每色至少 1 列，余下"均匀"分配——所有色到 2 列前不会有色到 3 列
    var colsPerColor = new Array(colorCount).fill(1);
    var remain = K - colorCount;
    while (remain-- > 0) {
      var mi = 0;
      for (var i = 1; i < colorCount; i++) if (colsPerColor[i] < colsPerColor[mi]) mi = i;
      colsPerColor[mi]++;
    }
    // 颜色 key（取不同 colorId）
    var colorKeys = [];
    for (var ci = 0; ci < colorCount; ci++) colorKeys.push(ci + '_0');

    // 列→目标色 展开（length K）
    var colTarget = [];
    for (var ci2 = 0; ci2 < colorCount; ci2++)
      for (var n = 0; n < colsPerColor[ci2]; n++) colTarget.push(colorKeys[ci2]);
    shuffle(colTarget);

    // 有序基线：每列填自己的目标色
    var columns = colTarget.map(function (key) {
      var col = []; for (var r = 0; r < H; r++) col.push(key); return col;
    });

    // 列同色约束乱序：每列任一颜色 ≤3（放不下→≤4→⚠️警告）。确保列足够杂乱、不堆同色（尤其小盘 H≤5）。
    var allCols = []; for (var ac = 0; ac < K; ac++) allCols.push(ac);
    capColumns(columns, H, allCols, '基础棋盘');

    return { columns: columns, colorKeys: colorKeys, colsPerColor: colsPerColor };
  }

  // ---- 区域感知配色（用于遮挡类障碍：保证可解）----
  // 把棋盘分成"可达区"(reachCols 列) 与"锁定区"(lockCount 列)，各持有【完整颜色】，区内各自打乱。
  // 这样可达区是自足可解子棋盘、能完成 reachCols 列订单；锁定区解锁后也是自足可解子棋盘。
  // 解决"随机撒障碍把某色副本锁进冻结列→可达区凑不满该色→无解"的脏数据问题。
  function applyChaosRegion(columns, H, colIdxs, chaos) {
    // 列同色约束乱序：区域内每列任一颜色≤3(→4→警告)，保持区域颜色集合不变(不破坏可达性)。
    capColumns(columns, H, colIdxs, '自由区');
  }

  // 通用"锁定列 + 钥匙色可达"生成：lockCount 个被锁列(隐藏)，保证 keyCount 种"钥匙色"完整可达。
  // 返回 { columns, lockedCols, keyColors, reachCols }
  function buildLockedLevel(H, K, colorCount, chaos, lockCount, keyCount, lockedColsArg) {
    lockCount = Math.max(1, Math.min(lockCount, K - 1));
    colorCount = Math.max(2, Math.min(colorCount, K));
    var reachCols = K - lockCount;
    keyCount = Math.max(1, Math.min(keyCount, reachCols));

    var board = buildColorBoard(H, K, colorCount, chaos);
    var columns = board.columns;
    var locked;
    if (lockedColsArg && lockedColsArg.length) {
      locked = lockedColsArg.slice(0, lockCount);
    } else {
      var allCols = []; for (var c = 0; c < K; c++) allCols.push(c);
      shuffle(allCols);
      locked = allCols.slice(0, lockCount);
    }
    var lockedSet = {}; locked.forEach(function (c) { lockedSet[c] = 1; });
    var reach = []; for (var rc0 = 0; rc0 < K; rc0++) if (!lockedSet[rc0]) reach.push(rc0);

    // 选 keyCount 种"钥匙色"（取占 1 列的色，保证能全塞进可达区）
    var colCountByKey = {};
    board.colsPerColor.forEach(function (n, i) { colCountByKey[i + '_0'] = n; });
    var keyColors = Object.keys(colCountByKey).filter(function (k) { return colCountByKey[k] === 1; }).slice(0, keyCount);
    if (keyColors.length < keyCount) keyColors = Object.keys(colCountByKey).sort(function (a, b) { return colCountByKey[a] - colCountByKey[b]; }).slice(0, keyCount);
    var isKey = {}; keyColors.forEach(function (k) { isKey[k] = 1; });

    // 把钥匙色的格子从被锁列换到可达列（与可达列里的非钥匙色交换，保持平衡）
    for (var fi = 0; fi < locked.length; fi++) {
      var fc = locked[fi];
      for (var r = 0; r < H; r++) {
        if (!isKey[columns[fc][r]]) continue;
        var done = false;
        for (var ri = 0; ri < reach.length && !done; ri++) {
          var rc = reach[ri];
          for (var rr = 0; rr < H; rr++) {
            if (!isKey[columns[rc][rr]]) { var t = columns[fc][r]; columns[fc][r] = columns[rc][rr]; columns[rc][rr] = t; done = true; break; }
          }
        }
      }
    }
    // 列同色约束：可达区/锁定区【各自】重分配——保持各区颜色多重集不变(钥匙色仍完整留在可达区→不破坏可达性)，
    //   只把每列同色压到≤3(可达区列太少放不下→≤4→⚠️列同色过多)。
    capColumns(columns, H, reach, '可达区');
    capColumns(columns, H, locked, '锁定区');
    return { columns: columns, lockedCols: locked, keyColors: keyColors, reachCols: reachCols };
  }

  // 区域感知炸弹关：count 个炸弹附在顶部不同列的色块上（各色为盘面真实色、可完成）；步数=倒计时
  function buildBombLevel(H, K, colorCount, chaos, count, steps) {
    var board = buildColorBoard(H, K, colorCount, chaos);
    count = Math.max(1, Math.min(count || 1, K));
    var cols = []; for (var c = 0; c < K; c++) cols.push(c); shuffle(cols);
    var cellFeatures = {};
    for (var i = 0; i < count; i++) {
      var bc = cols[i], br = rint(Math.min(3, H));   // 不同列、顶部 1-3 行
      cellFeatures[bc + '_' + br] = ['Bomb'];
    }
    return { columns: board.columns, cellFeatures: cellFeatures, bombSteps: steps };
  }

  // 区域感知石墙关：石墙列【非相邻】放置，保证每个石墙旁有可完成的可达列(相邻列完成即解锁)
  function buildRockLevel(H, K, colorCount, chaos, rockCount) {
    rockCount = Math.max(1, Math.min(rockCount, Math.floor(K / 2)));  // 非相邻 → 最多 ⌊K/2⌋
    var rocks = []; for (var c = 0; c < K && rocks.length < rockCount; c += 2) rocks.push(c);
    var reachCols = K - rocks.length;
    var keyN = Math.min(rocks.length + 1, reachCols);   // 可达区保证若干完整色 → 相邻列能完成
    var lv = buildLockedLevel(H, K, colorCount, chaos, rocks.length, keyN, rocks);
    var columnFeatures = []; for (var i = 0; i < K; i++) columnFeatures.push([]);
    rocks.forEach(function (c) { columnFeatures[c].push({ type: 'Rock' }); });
    return { columns: lv.columns, columnFeatures: columnFeatures, rockCount: rocks.length, reachCols: reachCols };
  }

  // 区域感知限定色关：count 个限定列，每列接受色=该列主色（盘面有≥H副本、可完成）
  function buildFixedLevel(H, K, colorCount, chaos, count) {
    count = Math.max(1, Math.min(count, K - 1));
    var board = buildColorBoard(H, K, colorCount, chaos);
    var fxMode = ['spaced', 'adjacent', 'edges', 'symmetric'][rint(4)];
    var cols = pickColumns(K, count, fxMode);
    var columnFeatures = []; for (var i = 0; i < K; i++) columnFeatures.push([]);
    cols.forEach(function (fc) {
      var key = dominantKey(board.columns[fc]);
      var p = key.split('_');
      columnFeatures[fc].push({ type: 'FixedColor', acceptedColor: { colorId: +p[0], shadeIndex: +p[1] || 0 } });
    });
    return { columns: board.columns, columnFeatures: columnFeatures, count: count };
  }

  // 区域感知锁定列关：count 个锁(Lock 在底部) + count 个钥匙(Key 在上部，距底≥4，左右间隔列)
  function buildKeyLockLevel(H, K, colorCount, chaos, count) {
    count = Math.max(1, Math.min(count, Math.floor(K / 2)));   // 锁与钥匙各 count，需 2count≤K
    var board = buildColorBoard(H, K, colorCount, chaos);
    var lockMode = ['spaced', 'adjacent', 'edges', 'symmetric'][rint(4)];
    var lockCols = pickColumns(K, count, lockMode);
    var lockSet = {}; lockCols.forEach(function (c) { lockSet[c] = 1; });
    var avail = []; for (var c = 0; c < K; c++) if (!lockSet[c]) avail.push(c);
    var keyCols = [];                                          // 钥匙列：非锁列里左右间隔挑
    for (var i = 0; i < avail.length && keyCols.length < count; i += 2) keyCols.push(avail[i]);
    for (var j = 1; j < avail.length && keyCols.length < count; j += 2) keyCols.push(avail[j]);
    var cellFeatures = {};
    lockCols.forEach(function (c) { cellFeatures[c + '_' + (H - 1)] = ['Lock']; });        // 锁在底部
    keyCols.forEach(function (c) { cellFeatures[c + '_' + keyRowUpper(H)] = ['Key']; });    // 钥匙上部(距底≥4)，转到底解锁
    return { columns: board.columns, cellFeatures: cellFeatures, count: count };
  }

  // 区域感知双色块关（设计者机制·杂色顶层版）：
  //   双色块 = 底层(收集色) + 顶层(杂色)。底层是一个【新底色 X】(不占任何整列)，撒成 H 个分散格；
  //   每个双色格的顶层 = 该格原本的颜色(各不相同的杂色，借自多种在场色)。
  //   解法：把这 H 个底色 X 聚成 1 列 → 列按底色统一 → 引擎转换 → 该列原位变成"顶层杂色"的普通混合列
  //         → 各被借走的颜色补回缺额 → 继续普通求解。总列数不变、可解。
  //   ★关键：顶层是【多种】杂色(assorted)，不是单一色——转换后形成一条需要再分拣的普通列。
  //   groups = 双色块组数(每组 1 个新底色，H 格)；默认 1-2 组。
  function buildDualLevel(H, K, colorCount, chaos, bottomColorCount, chained) {
    var board = buildColorBoard(H, K, colorCount, chaos);
    var groups = Math.max(1, Math.min(bottomColorCount || 1, 2));
    var dualCells = {};
    var allPos = [];
    for (var c = 0; c < K; c++) for (var r = 0; r < H; r++) allPos.push([c, r]);
    shuffle(allPos);
    var used = {};        // 已被某组占用的格(c_r)
    var made = 0;
    for (var g = 0; g < groups; g++) {
      var baseKey = (colorCount + g) + '_0';   // 新底色：不与任何整列色重复，转换后整列腾空
      var picked = [];
      var topCount = {};   // 各顶色已选数量(控制 assorted：单一顶色 ≤ ⌈H/2⌉，避免退化成单色)
      for (var i = 0; i < allPos.length && picked.length < H; i++) {
        var key = allPos[i][0] + '_' + allPos[i][1];
        if (used[key]) continue;
        var donor = board.columns[allPos[i][0]][allPos[i][1]];
        if ((topCount[donor] || 0) >= Math.ceil(H / 2)) continue;   // 限制单色占比 → 强制杂色
        picked.push(allPos[i]); used[key] = 1; topCount[donor] = (topCount[donor] || 0) + 1;
      }
      if (picked.length < H) break;                 // 凑不齐一组(可用色不足) → 放弃多余组
      if (Object.keys(topCount).length < 2) break;  // 顶层未能形成杂色(色种太少) → 放弃该组
      picked.forEach(function (p) {
        var donor = board.columns[p[0]][p[1]];
        dualCells[p[0] + '_' + p[1]] = donor;       // 顶层 = 原(杂)色
        board.columns[p[0]][p[1]] = baseKey;        // 底层 = 新底色
      });
      made++;
    }
    return { columns: board.columns, dualCells: dualCells, bottomColorCount: made, chained: false };
  }

  // 区域感知冰块关：被锁列=冰块。多个冰块【步数严格互不相同】；可区分步数不足则减少冰块数量。keyCount=最大步数
  // dep!==false 时启用【冰块颜色拆分依赖】：把某色拆到多个冰块后，按 durability 顺序解冻才能凑齐该色订单。
  function buildIceLevel(H, K, colorCount, chaos, iceCount, durMin, durMax, dep) {
    iceCount = Math.max(1, Math.min(iceCount, K - 1));
    var reachColsReq = Math.max(1, K - iceCount);                 // 以请求数量估算可达列(保守上限)
    var effMax = Math.max(1, Math.min(durMax || 4, reachColsReq, 4));
    var effMin = Math.max(1, Math.min(durMin || 1, effMax));
    var durs = iceDurArray(iceCount, effMin, effMax);             // 互不相同, 长度=min(iceCount, effMax-effMin+1)
    iceCount = durs.length;                                       // ★实际冰块数 = 可区分步数个数(多余不生成)
    var reachCols = K - iceCount;
    var maxDur = Math.max.apply(null, durs);
    var iceMode = ['spaced', 'adjacent', 'edges', 'symmetric'][rint(4)];  // 列分布随机
    var iceCols = pickColumns(K, iceCount, iceMode);
    var lv = buildLockedLevel(H, K, colorCount, chaos, iceCount, maxDur, iceCols);
    var columnFeatures = []; for (var c = 0; c < K; c++) columnFeatures.push([]);
    lv.lockedCols.forEach(function (c, i) { columnFeatures[c].push({ type: 'Ice', durability: durs[i] }); });  // 1:1, 互不相同
    // 冰块颜色拆分依赖：冰块列按 durability 升序，把依赖色散布进去
    if (dep !== false) {
      var pairs = lv.lockedCols.map(function (c, i) { return { c: c, d: durs[i] }; }).sort(function (a, b) { return a.d - b.d; });
      splitIceColorDependency(lv.columns, H, K, pairs.map(function (p) { return p.c; }), lv.keyColors);
    }
    return { columns: lv.columns, columnFeatures: columnFeatures, durability: maxDur, durs: durs, iceCount: iceCount, reachCols: reachCols };
  }

  // 区域感知保护列关：被锁列=保护列，每列 requiredColor=某钥匙色（完成该色即解锁）
  function buildCoveredLevel(H, K, colorCount, chaos, count) {
    count = Math.max(1, Math.min(count, K - 1));
    var reachCols = K - count;
    var keyN = Math.max(1, Math.min(count, reachCols));   // 需求色种类（可达可完成）
    var covMode = ['spaced', 'adjacent', 'edges', 'symmetric'][rint(4)];
    var covCols = pickColumns(K, count, covMode);
    var lv = buildLockedLevel(H, K, colorCount, chaos, count, keyN, covCols);
    var columnFeatures = []; for (var c = 0; c < K; c++) columnFeatures.push([]);
    lv.lockedCols.forEach(function (c, i) {
      var key = lv.keyColors[i % lv.keyColors.length] || lv.keyColors[0];
      var p = key.split('_');
      columnFeatures[c].push({ type: 'CoveredColor', requiredColor: { colorId: +p[0], shadeIndex: +p[1] || 0 } });
    });
    return { columns: lv.columns, columnFeatures: columnFeatures, count: count, reachCols: reachCols };
  }

  // 区域感知冰块关 v2（已并入 buildLockedLevel；保留下方旧实现说明）

  // ====== 多重障碍：可达性依赖布局（复用 buildLockedLevel 底座，保证可解）======
  // hardSpecs: [{type:'Ice',durability}|{type:'Rock'}|{type:'CoveredColor'}|{type:'KeyLock'}, ...]
  //   每个硬障碍占 1 锁定列；可达区含足够"完整 key 色"驱动解锁。解锁依赖：
  //     冰块→完成 D 列；石墙→紧邻可达列完成；保护列→完成某 key 色；锁定列→钥匙到底。
  //   全部解锁后 = 满平衡棋盘 → 必然可解。问号(软)最后按密度叠加，不碰 Key/Lock 卡。
  function buildMixedLevel(H, K, colorCount, chaos, hardSpecs, surpriseDensity, fixedCount, dep) {
    hardSpecs = hardSpecs.slice(0, Math.max(1, K - 1));   // 至少留 1 自由列
    var n = hardSpecs.length;
    colorCount = Math.max(2, Math.min(colorCount, K));

    // 锁定列位置：随机分布模式；含石墙时强制 spaced(隔列)——石墙需相邻可达列解锁，间隔最安全。
    var hasRock = hardSpecs.some(function (s) { return s.type === 'Rock'; });
    var lockMode = hasRock ? 'spaced' : ['spaced', 'edges', 'symmetric'][rint(3)];
    var lockedCols = pickColumns(K, n, lockMode);
    var lockedSet = {}; lockedCols.forEach(function (c) { lockedSet[c] = 1; });
    // key 色数量：≥ 障碍数，且 ≥ 最大冰块步数（足够驱动解锁），≤ 可达列数
    var maxDur = 1;
    hardSpecs.forEach(function (s) { if (s.type === 'Ice') maxDur = Math.max(maxDur, s.durability || 1); });
    var reachCols = K - n;
    var keyCount = Math.min(Math.max(n, maxDur), reachCols);

    var lv = buildLockedLevel(H, K, colorCount, chaos, n, keyCount, lockedCols);
    var columns = lv.columns;
    var columnFeatures = []; for (var c0 = 0; c0 < K; c0++) columnFeatures.push([]);
    var cellFeatures = {};
    var reachList = []; for (var rc = 0; rc < K; rc++) if (!lockedSet[rc]) reachList.push(rc);
    function keyToColor(key) { var p = key.split('_'); return { colorId: +p[0], shadeIndex: +p[1] || 0 }; }

    hardSpecs.forEach(function (spec, idx) {
      var c = lv.lockedCols[idx];
      if (spec.type === 'Ice') {
        columnFeatures[c].push({ type: 'Ice', durability: Math.min(spec.durability || 1, keyCount) });
      } else if (spec.type === 'Rock') {
        columnFeatures[c].push({ type: 'Rock' });
      } else if (spec.type === 'CoveredColor') {
        var rkey = lv.keyColors[idx % lv.keyColors.length];
        columnFeatures[c].push({ type: 'CoveredColor', requiredColor: keyToColor(rkey) });
      } else if (spec.type === 'KeyLock') {
        cellFeatures[c + '_' + (H - 1)] = ['Lock'];                       // Lock 在锁定列底
        var kc = reachList[idx % reachList.length];                       // Key 在可达列上部（距底≥4，转到底解锁）
        var kk = kc + '_' + keyRowUpper(H);
        cellFeatures[kk] = (cellFeatures[kk] || []).concat(['Key']);
      }
    });

    // 可选限定色：可达列上 FixedColor = 该列主色（不与 Key 冲突）
    for (var f = 0; f < Math.min(fixedCount || 0, reachList.length); f++) {
      var fc = reachList[f];
      if (cellFeatures[fc + '_0']) continue;
      columnFeatures[fc].push({ type: 'FixedColor', acceptedColor: keyToColor(dominantKey(columns[fc])) });
    }

    // 冰块颜色拆分依赖：混合关里 ≥2 个冰块时，把某依赖色散布到不同 durability 冰块后(按序解冻才能凑齐)
    if (dep !== false) {
      var icePairs = [];
      hardSpecs.forEach(function (spec, idx) { if (spec.type === 'Ice') icePairs.push({ c: lv.lockedCols[idx], d: Math.min(spec.durability || 1, keyCount) }); });
      if (icePairs.length >= 2) {
        icePairs.sort(function (a, b) { return a.d - b.d; });
        splitIceColorDependency(columns, H, K, icePairs.map(function (p) { return p.c; }), lv.keyColors);
      }
    }

    // 问号(软障碍)统一在第4步由 overlayExtras 最后填，此处不放（流水线顺序：硬障碍 → 可达检查 → 软障碍）。
    return { columns: columns, columnFeatures: columnFeatures, cellFeatures: cellFeatures, keyColors: lv.keyColors, reachList: reachList, lockedCols: lv.lockedCols };
  }


  // combo: { Surprise, Ice, Rock, FixedColor, CoveredColor, Linked, Dual, Bomb } 布尔/数量
  // 返回 { columnFeatures:[[..]], cellFeatures:{'c_r':[type]}, dualCells:{'c_r':topKey}, links:[], bombSteps }
  function placeObstacles(board, H, K, combo, opts) {
    opts = opts || {};
    var columns = board.columns, colorKeys = board.colorKeys;
    var columnFeatures = []; for (var i = 0; i < K; i++) columnFeatures.push([]);
    var cellFeatures = {};
    var dualCells = {};
    var links = [];
    var lockedCol = new Array(K).fill(false);   // 锁列类（冰块/石墙/限定/保护）占用
    var dualCol = new Array(K).fill(false);

    function pickFreeCols(count, pred) {
      var avail = [];
      for (var c = 0; c < K; c++) if (pred(c)) avail.push(c);
      shuffle(avail);
      return avail.slice(0, count);
    }
    function cntOf(name, dflt) {
      var v = combo[name];
      if (v === true) return dflt;
      if (typeof v === 'number') return v;
      return 0;
    }

    // 双色块：优先放，占用列不可再被锁列类遮挡（规则4）。在非锁定列里挑若干列，列内 1-2 张底层=该列主色的双色块
    var nDual = cntOf('Dual', 1);
    if (nDual > 0) {
      var dcols = pickFreeCols(nDual, function (c) { return !lockedCol[c]; });
      dcols.forEach(function (c) {
        dualCol[c] = true;
        var topKey = colorKeys[rint(colorKeys.length)];
        var r = rint(H);
        dualCells[c + '_' + r] = topKey;  // 底层=该格当前色，顶层=随机色
      });
    }

    // 锁列类：互不同列、不与双色块列重叠（规则3、4）
    function placeColLock(name, count, makeFeat) {
      var cs = pickFreeCols(count, function (c) { return !lockedCol[c] && !dualCol[c]; });
      cs.forEach(function (c) { lockedCol[c] = true; columnFeatures[c].push(makeFeat(c)); });
      return cs;
    }
    placeColLock('Ice', cntOf('Ice', 1), function () { return { type: 'Ice', durability: opts.iceDurability || (1 + rint(2)) }; });
    placeColLock('Rock', cntOf('Rock', 1), function () { return { type: 'Rock' }; });
    var fixedCols = placeColLock('FixedColor', cntOf('FixedColor', 1), function (c) {
      // 限定色 = 该列出现最多的色
      var key = dominantKey(columns[c]);
      var p = key.split('_'); return { type: 'FixedColor', acceptedColor: { colorId: +p[0], shadeIndex: +p[1] || 0 } };
    });
    placeColLock('CoveredColor', cntOf('CoveredColor', 1), function (c) {
      // 保护列：需先完成的色 = 另一列的主色（确保是盘面存在色）
      var other = (c + 1) % K; var key = dominantKey(columns[other]) || colorKeys[0];
      var p = key.split('_'); return { type: 'CoveredColor', requiredColor: { colorId: +p[0], shadeIndex: +p[1] || 0 } };
    });

    // 捆绑：规律布局（左右一对为最小单位；上下/对角线/交错齿轮随机模式）；不碰限定列/双色块列
    var linkedCells = {};
    var warnings = [];
    var nLink = cntOf('Linked', 1);
    if (nLink > 0) {
      var blockedCols = {};
      fixedCols.forEach(function (c) { blockedCols[c] = 1; });
      for (var dc2 = 0; dc2 < K; dc2++) if (dualCol[dc2]) blockedCols[dc2] = 1;
      var lkRes = linkPattern(K, H, nLink, blockedCols);
      lkRes.forEach(function (lk) {
        links.push(lk);
        linkedCells[lk.col1 + '_' + lk.rowIndex] = 1; linkedCells[lk.col2 + '_' + lk.rowIndex] = 1;
      });
      if (lkRes.relaxed) warnings.push('捆绑未完全按规律(被障碍挤占或可达列不足)，实际 ' + lkRes.placed + '/' + nLink + ' 条');
    }

    // 问号：多种数学规律布局；避开捆绑两端/双色块/已占格
    var nSurp = cntOf('Surprise', Math.max(2, Math.round(K * H * 0.12)));
    var sBlocked = {};
    for (var lk in linkedCells) sBlocked[lk] = 1;
    for (var dk in dualCells) sBlocked[dk] = 1;
    for (var fk in cellFeatures) sBlocked[fk] = 1;
    var spRes = surprisePattern(K, H, nSurp, sBlocked);
    spRes.forEach(function (key) { cellFeatures[key] = ['Surprise']; });
    if (nSurp > 0 && spRes.relaxed) warnings.push('问号未完全按规律(被障碍挤占或可达空格不足)，实际 ' + spRes.placed + '/' + nSurp + ' 个');

    // 炸弹：统一由 generateOne 调 placeBombs 放置（明牌/隐藏列 + 按步数上限挂钩倒计时），此处不再处理。
    return { columnFeatures: columnFeatures, cellFeatures: cellFeatures, dualCells: dualCells, links: links, bombSteps: null, warnings: warnings };
  }

  function dominantKey(col) {
    var cnt = {}, best = null, bn = -1;
    col.forEach(function (k) { cnt[k] = (cnt[k] || 0) + 1; if (cnt[k] > bn) { bn = cnt[k]; best = k; } });
    return best;
  }

  // ---- 障碍叠加：主分支产出 base 后，把 combo 中尚未体现的障碍叠加到自由空间 ----
  // 解决"组合障碍(如 问号+双色块 / 冰块+双色块 / 冰块+保护列+双色块)只生成其中一种 → 难度不达标"的不对齐。
  // 已存在的障碍不重复叠加(幂等)；只用自由列/自由格。可解性由 generateOne 的 validate+solve 重试兜底
  //（叠加偶发破坏可解 → 自动弃用该棋盘重生成）。
  function overlayExtras(boardWrap, obs, H, K, colorCount, combo, gopts) {
    function present(v) { return v === true || (typeof v === 'number' && v > 0); }
    var cols = boardWrap.columns;
    function lockedColumns() {
      var s = {};
      for (var c = 0; c < K; c++) if (obs.columnFeatures[c] && obs.columnFeatures[c].length) s[c] = 1;
      for (var dk in obs.dualCells) s[+dk.split('_')[0]] = 1;
      for (var ck in obs.cellFeatures) {
        var f = obs.cellFeatures[ck] || [];
        if (f.indexOf('Lock') >= 0 || f.indexOf('Key') >= 0) s[+ck.split('_')[0]] = 1;
      }
      return s;
    }
    function occupiedCells() {
      var s = {};
      for (var ck in obs.cellFeatures) s[ck] = 1;
      for (var dk in obs.dualCells) s[dk] = 1;
      obs.links.forEach(function (l) { s[l.col1 + '_' + l.rowIndex] = 1; s[l.col2 + '_' + l.rowIndex] = 1; });
      return s;
    }
    var hasSurp = false; for (var k0 in obs.cellFeatures) if ((obs.cellFeatures[k0] || []).indexOf('Surprise') >= 0) { hasSurp = true; break; }
    var hasDual = false; for (var kd in obs.dualCells) { hasDual = true; break; }
    var hasLink = obs.links.length > 0;
    var hasBomb = obs.bombSteps != null; if (!hasBomb) for (var kb in obs.cellFeatures) if ((obs.cellFeatures[kb] || []).indexOf('Bomb') >= 0) { hasBomb = true; break; }
    var hasFixed = false; for (var cf = 0; cf < K; cf++) if ((obs.columnFeatures[cf] || []).some(function (f) { return f.type === 'FixedColor'; })) { hasFixed = true; break; }

    // 双色块叠加(新底色·杂色顶层)：自由列的自由格
    if (present(combo.Dual) && !hasDual) {
      var groups = Math.max(1, Math.min(typeof combo.Dual === 'number' ? combo.Dual : 1, 2));
      var locked = lockedColumns(), occ = occupiedCells(), freePos = [];
      for (var c1 = 0; c1 < K; c1++) if (!locked[c1]) for (var r1 = 0; r1 < H; r1++) if (!occ[c1 + '_' + r1]) freePos.push([c1, r1]);
      shuffle(freePos);
      var used2 = {};
      for (var g = 0; g < groups; g++) {
        var baseKey = (colorCount + g) + '_0', picked = [], topCount = {};
        for (var i = 0; i < freePos.length && picked.length < H; i++) {
          var p = freePos[i], key = p[0] + '_' + p[1]; if (used2[key]) continue;
          var donor = cols[p[0]][p[1]];
          if (parseInt(donor, 10) >= colorCount) continue;            // 不拿已是新底色的格
          if ((topCount[donor] || 0) >= Math.ceil(H / 2)) continue;   // 强制顶层杂色
          picked.push(p); used2[key] = 1; topCount[donor] = (topCount[donor] || 0) + 1;
        }
        if (picked.length < H || Object.keys(topCount).length < 2) break;
        picked.forEach(function (p) { obs.dualCells[p[0] + '_' + p[1]] = cols[p[0]][p[1]]; cols[p[0]][p[1]] = baseKey; });
      }
    }
    // 限定色叠加：自由列加 FixedColor(接受色=该列主色)
    if (present(combo.FixedColor) && !hasFixed) {
      var nf = typeof combo.FixedColor === 'number' ? combo.FixedColor : 1;
      var locked4 = lockedColumns(), cand4 = [];
      for (var c4 = 0; c4 < K; c4++) if (!locked4[c4]) cand4.push(c4);
      shuffle(cand4);
      cand4.slice(0, nf).forEach(function (c) {
        var key = dominantKey(cols[c]); var pp = key.split('_');
        obs.columnFeatures[c] = (obs.columnFeatures[c] || []);
        obs.columnFeatures[c].push({ type: 'FixedColor', acceptedColor: { colorId: +pp[0], shadeIndex: +pp[1] || 0 } });
      });
    }
    // 捆绑叠加：自由列成对；★避开问号等已占格(occupiedCells 含已放的问号) → 捆绑不与问号重叠
    if (present(combo.Linked) && !hasLink) {
      var locked3 = lockedColumns(), blocked = {};
      for (var c3 = 0; c3 < K; c3++) if (locked3[c3]) blocked[c3] = 1;
      var nl = typeof combo.Linked === 'number' ? combo.Linked : 1;
      var lkRes = linkPattern(K, H, nl, blocked, occupiedCells());
      lkRes.forEach(function (lk) { obs.links.push(lk); });
      obs.warnings = obs.warnings || [];
      if (lkRes.relaxed) obs.warnings.push('捆绑未完全按规律(被障碍挤占或可达列不足)，实际 ' + lkRes.placed + '/' + nl + ' 条');
    }
    // 问号叠加(软,最安全)：避开所有已占格
    if (present(combo.Surprise) && !hasSurp) {
      var ns = typeof combo.Surprise === 'number' ? combo.Surprise : Math.max(2, Math.round(K * H * 0.12));
      var occ2 = occupiedCells();
      var spRes = surprisePattern(K, H, ns, occ2);
      spRes.forEach(function (key) { obs.cellFeatures[key] = ['Surprise']; });
      obs.warnings = obs.warnings || [];
      if (spRes.relaxed) obs.warnings.push('问号未完全按规律(被障碍挤占或可达空格不足)，实际 ' + spRes.placed + '/' + ns + ' 个');
    }
    // 炸弹：统一由 generateOne 调 placeBombs 放置（明牌限可达完整色/隐藏列 + 按步数上限挂钩倒计时），此处不再处理。
  }

  // 内部抽象色键(如 '0_0','1_0',双色块底 '5_0') → 真实色库色。无映射时原样返回(兜底/手工路径)。
  function realColorOf(map, key) {
    if (map && map[key]) return map[key];
    var p = key.split('_');
    return { colorId: +p[0], shadeIndex: +p[1] || 0 };
  }
  // 扫描本关用到的【全部内部色键】(棋盘格 + 双色块顶色 + 限定色/指定色消除的色)，
  // 用对比度色库分配真实色：内部色键 → {colorId,shadeIndex}。同一内部键全局一致 → FixedColor/CoveredColor 与棋盘色对齐。
  function buildColorMap(board, obs, H, K) {
    var seen = {};
    for (var c = 0; c < K; c++) for (var r = 0; r < H; r++) { var k = board.columns[c][r]; if (k != null) seen[k] = 1; }
    for (var dk in obs.dualCells) seen[obs.dualCells[dk]] = 1;
    for (var c2 = 0; c2 < K; c2++) (obs.columnFeatures[c2] || []).forEach(function (f) {
      if (f.acceptedColor) seen[f.acceptedColor.colorId + '_' + (f.acceptedColor.shadeIndex || 0)] = 1;
      if (f.requiredColor) seen[f.requiredColor.colorId + '_' + (f.requiredColor.shadeIndex || 0)] = 1;
    });
    var list = Object.keys(seen);
    var real = SS.Colors.pickContrastColors(list.length);   // 高对比子集(≤库容量10)
    var map = {};
    for (var i = 0; i < list.length; i++) map[list[i]] = real[i % real.length];
    return map;
  }

  // ---- 组装 raw JSON ----
  function buildRaw(board, obs, H, K, stepCount, name) {
    var cmap = obs._colorMap;   // 真实色库映射(generateOne 建好；缺则原样)
    // 把含色 feature(限定色/指定色消除) 的颜色一并映射到真实色库
    function remapFeat(f) {
      if (f.acceptedColor) {
        var ra = realColorOf(cmap, f.acceptedColor.colorId + '_' + (f.acceptedColor.shadeIndex || 0));
        var na = {}; for (var k1 in f) na[k1] = f[k1]; na.acceptedColor = { colorId: ra.colorId, shadeIndex: ra.shadeIndex }; return na;
      }
      if (f.requiredColor) {
        var rr = realColorOf(cmap, f.requiredColor.colorId + '_' + (f.requiredColor.shadeIndex || 0));
        var nr = {}; for (var k2 in f) nr[k2] = f[k2]; nr.requiredColor = { colorId: rr.colorId, shadeIndex: rr.shadeIndex }; return nr;
      }
      return f;
    }
    function colorTile(key, cr) {
      var rc = realColorOf(cmap, key);
      var tile = { layers: [{ type: 'BasicColorTile', color: { colorId: rc.colorId, shadeIndex: rc.shadeIndex } }], features: [] };
      var dl = obs.dualCells[cr];
      if (dl) {
        var drc = realColorOf(cmap, dl);
        tile.layers.push({ type: 'BasicColorTile', color: { colorId: drc.colorId, shadeIndex: drc.shadeIndex } });
      }
      var feats = obs.cellFeatures[cr] || [];
      feats.forEach(function (t) {
        if (t === 'Bomb') {
          // 倒计时 = frac × 步数上限 sc(=stepCount)；缺 frac 时回退旧 bombSteps。
          var fr = obs.bombFrac && obs.bombFrac[cr];
          var cd = (fr != null) ? Math.max(1, Math.round(fr * stepCount)) : (obs.bombSteps || 20);
          var bf = { type: 'Bomb', endCondition: { type: 'StepCount', stepCount: cd } };
          if (obs.bombTiming === 'afterReveal') bf.timing = 'afterReveal';  // 隐藏列独立计时
          tile.features.push(bf);
        } else tile.features.push({ type: t });
      });
      return tile;
    }
    var columns = [];
    for (var c = 0; c < K; c++) {
      var tiles = [];
      for (var r = 0; r < H; r++) tiles.push(colorTile(board.columns[c][r], c + '_' + r));
      columns.push({ layers: [{ tiles: tiles, columnFeatures: (obs.columnFeatures[c] || []).map(remapFeat) }] });
    }
    var gridFeatures = obs.links.map(function (l) {
      return { type: 'LinkedCards', rowIndex: l.rowIndex, firstColumnIndex: l.col1, secondColumnIndex: l.col2 };
    });
    return {
      version: 1, id: name, name: name,
      data: {
        id: name, name: name,
        endConditions: [{ type: 'StepCount', stepCount: stepCount }],
        boards: [{
          benchInitialTile: { layers: [{ type: 'RainbowTile' }], features: [] },
          grids: [{ rowCount: H, columns: columns, features: gridFeatures }]
        }]
      }
    };
  }

  // ---- 单关生成（固定棋盘后，用步数余量把难度调到目标阈值）----
  // ---- 单关生成（固定棋盘后，在 0~maxMargin 步余量内调难度到目标阈值）----
  // params: { H,K,colorCount,chaos,combo, difficultyMin,difficultyMax, name, runsPerMode, maxAttempts,
  //           maxMargin=20(步数余量上限,绝对步数,以最优解为基线), minMargin=0(余量下限),
  //           maxSolverGap=20(玩家版与全知版最优步偏离上限,超出/玩家无解→异常重生成),
  //           validateStrict, opts }
  function generateOne(params) {
    var H = params.H, K = Math.min(params.K, 8);   // ★单关最多 8 列=8 色（对比度色库上限）
    var runsPerMode = params.runsPerMode || 8;
    var maxAttempts = params.maxAttempts || 40;
    var lo = params.difficultyMin != null ? params.difficultyMin : 0;
    var hi = params.difficultyMax != null ? params.difficultyMax : 100;
    var mid = (lo + hi) / 2;
    var best = null;       // 难度达标且炸弹可解的最接近备选
    var looseBest = null;  // 宽松兜底：任何"纯求解可解"的最接近备选(不论炸弹复验/难度是否达标)

    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      // 障碍棋盘构建：多重障碍→可达性依赖(buildMixedLevel)；单一障碍→各自区域感知生成器
      var combo = params.combo || {}, gopts = params.opts || {};
      genBoardWarnings.length = 0;   // 清空本次尝试的板级警告(列同色过多等)
      var boardWrap, obs;
      // 数量解析：number=手动数量；true=默认(自动,在[lo,hi]随机,靠重试探索命中难度)；其它=关闭
      function autoN(v, alo, ahi) { return (typeof v === 'number') ? Math.max(0, v) : (v ? (alo + rint(ahi - alo + 1)) : 0); }
      function present(v) { return v === true || (typeof v === 'number' && v > 0); }
      // 冰块步数范围（默认 1-4：单个冰块步数随机1-4；多个冰块步数会被打散不全相同）
      var iceDurMin = Math.max(1, Math.min(4, gopts.iceDurMin || 1));
      var iceDurMax = Math.max(iceDurMin, Math.min(4, gopts.iceDurMax || 4));
      // 硬障碍(强锁列)清单：冰块步数 iceDurArray 保证【互不相同】(长度=min(iceN,可区分步数))
      var iceN = autoN(combo.Ice, 1, 3);
      var iceDurs = iceN > 0 ? iceDurArray(iceN, iceDurMin, iceDurMax) : [];   // ★iceN=0(没选冰块)→空，不凭空生成冰块
      var hardList = [];
      for (var hi1 = 0; hi1 < iceDurs.length; hi1++) hardList.push({ type: 'Ice', durability: iceDurs[hi1] });
      for (var hi2 = 0; hi2 < autoN(combo.Rock, 1, 2); hi2++) hardList.push({ type: 'Rock' });
      for (var hi3 = 0; hi3 < autoN(combo.CoveredColor, 1, 3); hi3++) hardList.push({ type: 'CoveredColor' });
      for (var hi4 = 0; hi4 < autoN(combo.KeyLock, 1, 3); hi4++) hardList.push({ type: 'KeyLock' });
      // ★强锁列障碍总数 ≤ min(4, K-1)：过多会因"保证可达性"反而降低难度。超出则随机截断。
      var hardCap = Math.min(4, K - 1);
      if (hardList.length > hardCap) { shuffle(hardList); hardList = hardList.slice(0, hardCap); }
      // ★截断后重排冰块步数：≤ 可达列数 且【严格互不相同】；可区分步数不足则删除多余冰块(不生成同步数冰块)。
      var reachAfter = Math.max(1, K - hardList.length);
      var iceIdx = []; for (var ii = 0; ii < hardList.length; ii++) if (hardList[ii].type === 'Ice') iceIdx.push(ii);
      if (iceIdx.length) {
        var effMaxI = Math.max(1, Math.min(iceDurMax, reachAfter, 4));
        var effMinI = Math.max(1, Math.min(iceDurMin, effMaxI));
        var ddI = iceDurArray(iceIdx.length, effMinI, effMaxI);   // 互不相同
        for (var kk = 0; kk < iceIdx.length; kk++) {
          if (kk < ddI.length) hardList[iceIdx[kk]].durability = ddI[kk];
          else hardList[iceIdx[kk]] = null;                       // 多余冰块 → 删除
        }
        hardList = hardList.filter(function (s) { return s; });
      }
      var fixedCnt = autoN(combo.FixedColor, 1, 2);
      // 软障碍(问号等)只在用户主动选择时才用；难度对齐靠步数余量(扫步数)平衡，不自动注入软障碍。
      var surpCount = (typeof combo.Surprise === 'number') ? combo.Surprise : (combo.Surprise ? Math.round(0.12 * H * K) : 0);
      // 障碍种类数
      var kindsCount = (present(combo.Ice) ? 1 : 0) + (present(combo.Rock) ? 1 : 0) + (present(combo.CoveredColor) ? 1 : 0) +
        (present(combo.KeyLock) ? 1 : 0) + (fixedCnt > 0 ? 1 : 0) + (surpCount > 0 ? 1 : 0) +
        (present(combo.Dual) ? 1 : 0) + (present(combo.Bomb) ? 1 : 0) + (present(combo.Linked) ? 1 : 0);

      // ★统一流水线（阶段3）：含硬障碍(冰块/石墙/指定色消除/锁定列；单个或多个)→ buildMixedLevel(可达性依赖布局)；
      //   无硬障碍 → 纯乱序基础盘。软/明牌障碍(双色块/限定色/捆绑/问号)随后统一由 overlayExtras 叠加，炸弹由 placeBombs。
      //   旧的单障碍专用构造(buildIceLevel/buildCoveredLevel/...)保留定义但生产路径不再走，统一收敛到这两条。
      if (hardList.length >= 1) {
        var mlv = buildMixedLevel(H, K, params.colorCount || K, params.chaos || 'high', hardList, 0, fixedCnt, gopts.iceDependency !== false);
        boardWrap = { columns: mlv.columns };
        obs = { columnFeatures: mlv.columnFeatures, cellFeatures: mlv.cellFeatures, dualCells: {}, links: [], bombSteps: null,
                _keyColors: mlv.keyColors, _reachList: mlv.reachList, _lockedCols: mlv.lockedCols, warnings: [] };
      } else {
        var board = buildColorBoard(H, K, params.colorCount || K, params.chaos || 'high');
        boardWrap = { columns: board.columns };
        var cf0 = []; for (var ci0 = 0; ci0 < K; ci0++) cf0.push([]);
        obs = { columnFeatures: cf0, cellFeatures: {}, dualCells: {}, links: [], bombSteps: null, warnings: [] };
      }
      // ★叠加 combo 中尚未体现的障碍（双色块/限定色/捆绑/问号），确保组合障碍完整对齐
      overlayExtras(boardWrap, obs, H, K, params.colorCount || K, combo, gopts);
      // ★炸弹统一放置：明牌限可达完整色(约束2)/隐藏列；倒计时=frac×步数上限，在 buildRaw(sc) 落地。
      if (present(combo.Bomb)) {
        placeBombs(boardWrap, obs, H, K, gopts, { keyColors: obs._keyColors, reachList: obs._reachList, lockedCols: obs._lockedCols });
      }
      // 并入板级警告(列同色过多等)，连同 obs 既有的问号/捆绑/炸弹警告一起带到 rec
      if (genBoardWarnings.length) { obs.warnings = (obs.warnings || []).concat(genBoardWarnings); }
      // ★颜色落地：把内部抽象色键映射到真实色库的【高对比子集】(单关≤8色)，所有 buildRaw 共用同一张映射
      obs._colorMap = buildColorMap(boardWrap, obs, H, K);
      var rawTmp = buildRaw(boardWrap, obs, H, K, 999, params.name || 'gen');
      SS.Colors.reset();
      var lvl = SS.LevelLoader.parse(rawTmp);
      var st = SS.Engine.createState(lvl.boards[0], 999);

      // 合法性
      var valid = SS.Solver.validateLevel(st);
      if (params.validateStrict !== false && !valid.valid) continue;

      // ★可达性轻量检查(完成列粒度BFS)：挡"死锁盘"(硬障碍无法逐步解锁)，避免浪费求解；真实可解仍由下方 multiSolve 裁定
      if (!reachabilityCheck(st)) continue;

      // 求最优解（宽松步数下）。best/avg/successRate 与最终步数无关。
      // maxMargin 传入 → 平均步数按"best+余量上限"剔除策略失配脏数据。
      var r = SS.Analysis.multiSolve(st, runsPerMode, params.maxMargin != null ? params.maxMargin : 20);
      if (r.best == null) continue;

      var obsKeys = SS.Analysis.obstaclesFromState(st);

      // 玩家版：含问号 或 混合障碍 → 跑一次玩家版(宽步数)拿各成功线步数，用于混合附加分 + 异常检测。
      // （非问号单障碍关玩家==全知，省去不跑。）
      var playerProf = null, playerBest = r.best;
      if (SS.PlayerSolver && SS.PlayerSolver.bestModeSuccAt &&
          (obsKeys.length > 1 || SS.PlayerSolver.hasSurprise(st))) {
        playerProf = SS.PlayerSolver.multiSolve(st, runsPerMode);
        playerBest = playerProf.best;
      }

      // ★异常检测（设计者）：玩家版与全知版最优步【偏离过大】或玩家无解 → 该关对真实玩家不合理，弃用重生成。
      var maxSolverGap = params.maxSolverGap != null ? params.maxSolverGap : 20;
      if (playerBest == null || Math.abs(playerBest - r.best) > maxSolverGap) continue;

      var optBest = Math.min(r.best, playerBest);   // 真正最优步 = 两解算器更小者，作为难度标尺基线

      // ★炸弹倒计时按步数上限 sc 自洽：构造与 st.bombs 同序(列优先 c↑,r↑)的 frac 数组；
      //   扫描每个 sc 时把每弹 remaining 设为 floor(frac×sc)，使难度评分(紧迫度)用的就是最终倒计时。
      var bombFracOrdered = [];
      if (obs.bombFrac) {
        bombFracOrdered = Object.keys(obs.bombFrac).sort(function (a, b) {
          var pa = a.split('_'), pb = b.split('_');
          return (+pa[0] - +pb[0]) || (+pa[1] - +pb[1]);
        }).map(function (k) { return obs.bombFrac[k]; });
      }
      function applyBombCountdown(state, sc) {
        if (!state.bombs || !bombFracOrdered.length) return;
        for (var bi = 0; bi < state.bombs.length && bi < bombFracOrdered.length; bi++) {
          state.bombs[bi].remaining = Math.max(1, Math.round(bombFracOrdered[bi] * sc));
        }
      }
      // 含炸弹关：在【真实倒计时 frac×sc】下复验可解（炸弹设太紧会无解 → 弃用重生成，对齐"确保可解"约束）。
      function bombVerifyOK(rec) {
        if (!present(combo.Bomb)) return true;
        SS.Colors.reset();
        var lv2 = SS.LevelLoader.parse(rec.raw);
        var st2 = SS.Engine.createState(lv2.boards[0], rec.stepCount);
        var r2 = SS.Analysis.multiSolve(st2, Math.max(3, Math.min(runsPerMode, 6)), params.maxMargin != null ? params.maxMargin : 20);
        return r2.best != null;
      }

      // ★难度 + 容错率【双限制】才算合格：难度落进 [lo,hi]，且步数余量(容错)落进【该难度等级】目标区间：
      //   简单 13-20 / 普通 9-12 / 困难 5-8 / 极难 1-4 步（以最优解为基线）。两者都满足 → ok=true。
      //   ★手动步数余量 [minMargin,maxMargin] 作为【搜索范围】：调大它会强制抬高步数上限(=optBest+margin)。
      //   等级容错与手动范围取交集判定；若交集为空(手动余量超出等级区间) → 手动余量优先(只判难度)。
      //   不合格时换棋盘(重随机障碍分布/默认数量)重试；多轮仍不合格 → ok=false，UI 建议改参数。
      function gradeMargin(score) {
        if (score < 31) return [13, 20];   // 简单 0-30
        if (score < 61) return [9, 12];    // 普通 31-60
        if (score < 81) return [5, 8];     // 困难 61-80
        return [1, 4];                     // 极难 81-100
      }
      var minMargin = params.minMargin != null ? Math.max(0, params.minMargin) : 0;
      var maxMargin = params.maxMargin != null ? Math.max(minMargin, params.maxMargin) : 20;
      var DIFF_TOL = 4;   // 难度命中【非对称】容差：向下严格(必须≥lo，不够难不命中)，向上放宽+4(可以难一点被命中)
      var qSc = -1, qD = null, qC = 1e9;   // 完全合格(难度∈[lo,hi+4] 且 容错∈等级∩手动范围)
      var dSc = -1, dD = null, dC = 1e9;   // 仅难度合格(容错不符)
      var fSc = -1, fD = null, fC = 1e9;   // 最接近兜底
      for (var sc = optBest + minMargin; sc <= optBest + maxMargin; sc++) {
        if (sc < playerBest) continue;     // 上限须≥玩家最优，保证玩家能通关
        var m = sc - optBest;
        applyBombCountdown(st, sc);   // 按当前 sc 设定每弹倒计时(frac×sc)，使难度评分自洽
        var ps = playerProf ? SS.PlayerSolver.bestModeSuccAt(playerProf, sc) : null;
        var d = SS.Analysis.difficulty(st, obsKeys, optBest, sc, r, ps, playerProf);
        var dist = Math.abs(d.score - mid);
        var inBand = d.score >= lo && d.score <= hi + DIFF_TOL;   // 向下严格 / 向上+4
        var gm0 = gradeMargin(d.score);
        var gLo = Math.max(gm0[0], minMargin), gHi = Math.min(gm0[1], maxMargin);  // 等级容错∩手动范围
        var marginOK = (gLo <= gHi) ? (m >= gLo && m <= gHi) : true;               // 交集为空→手动余量优先
        if (inBand && marginOK && dist < qC) { qC = dist; qSc = sc; qD = d; }
        if (inBand && dist < dC) { dC = dist; dSc = sc; dD = d; }
        if (dist < fC) { fC = dist; fSc = sc; fD = d; }
      }

      function mkRec(sc, d) {
        var gm = gradeMargin(d.score), mg = sc - optBest;
        return {
          raw: buildRaw(boardWrap, obs, H, K, sc, params.name || 'gen'),
          best: optBest, omniBest: r.best, playerBest: playerBest, avg: r.avg, successRate: r.successRate,
          stepCount: sc, margin: mg, marginRange: gm, marginOK: (mg >= gm[0] && mg <= gm[1]),
          difficulty: d.score, level: d.level, parts: d.parts,
          obs: obsKeys, colorKinds: d.colorKinds, sizeK: K, sizeH: H,
          warnings: (obs.warnings && obs.warnings.length) ? obs.warnings.slice() : []
        };
      }

      // 完全合格 → 复验炸弹可解后【立即返回】(严格遵守轮次上限，避免一键重生成耗时过久)。
      // 注：可能带"问号/捆绑未完全按规律"的 ⚠️ 警告(已记入 rec.warnings)，由人工检查；不再为找无警告关而跑满全部轮次。
      if (qSc > 0) {
        var qRec = mkRec(qSc, qD);
        if (bombVerifyOK(qRec)) return { ok: true, attempts: attempt + 1, rec: qRec };
        // 真实倒计时下不可解 → 落入兜底/换棋盘重试
      }

      // 未完全合格：优先保留"难度合格但容错不符"，否则"最接近"；换棋盘重试（重随机障碍分布/数量）
      var fbSc = dSc > 0 ? dSc : fSc, fbD = dSc > 0 ? dD : fD;
      if (fbSc > 0) {
        var rec = mkRec(fbSc, fbD);
        // ★宽松兜底：fbSc>0 说明该棋盘"纯求解可解"。无论炸弹复验/难度是否达标，都记下【最接近目标难度】的可解盘，
        //   保证只要不是完全不可解就一定能产出一个最接近的关(供你手动调参)。
        if (!looseBest || Math.abs(rec.difficulty - mid) < Math.abs(looseBest.difficulty - mid)) looseBest = rec;
        if (bombVerifyOK(rec)) {     // 含炸弹关需在真实倒计时下可解才作为"较优"候选
          var recInBand = rec.difficulty >= lo && rec.difficulty <= hi + DIFF_TOL;
          var bestInBand = best && best.difficulty >= lo && best.difficulty <= hi + DIFF_TOL;
          var better = !best
            || (recInBand && !bestInBand)
            || (recInBand === bestInBand && Math.abs(rec.difficulty - mid) < Math.abs(best.difficulty - mid));
          if (better) best = rec;
        }
      }
    }
    // 兜底顺序：①难度达标且炸弹可解的最接近(best) ②任何纯求解可解的最接近(looseBest,可能炸弹偏紧/难度未达,带提示)
    if (best) return { ok: false, attempts: maxAttempts, rec: best };
    if (looseBest) {
      looseBest.warnings = (looseBest.warnings || []).concat(['⚠️ 未达难度/容错或炸弹倒计时偏紧，已取最接近的可解盘，请手动微调']);
      return { ok: false, attempts: maxAttempts, rec: looseBest };
    }
    return { ok: false, attempts: maxAttempts, rec: null };   // 完全无可解盘(死锁/求解器解不出)
  }

  return {
    buildColorBoard: buildColorBoard,
    buildLockedLevel: buildLockedLevel,
    buildIceLevel: buildIceLevel,
    buildCoveredLevel: buildCoveredLevel,
    buildMixedLevel: buildMixedLevel,
    buildBombLevel: buildBombLevel,
    buildRockLevel: buildRockLevel,
    buildFixedLevel: buildFixedLevel,
    buildKeyLockLevel: buildKeyLockLevel,
    buildDualLevel: buildDualLevel,
    placeObstacles: placeObstacles,
    buildRaw: buildRaw,
    generateOne: generateOne
  };
})();
