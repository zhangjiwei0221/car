/**
 * 蚂蚁拿块求解器 - 模拟游玩模块（棋盘/元素区模型）
 *
 * 核心规则：
 * 1. 棋盘(元素区) = 蚂蚁盒所在的二维网格；蚂蚁从顶部进入，只有"顶部可达"的盒子可取。
 * 2. 取盒 → 蚂蚁在目标图上四方向 flood-fill 消除同色像素；消不完进暂存区。
 * 3. 暂存区满(默认5) 且无法继续消除 = 失败；目标图全部消除 = 通关。
 *
 * 障碍（全部在棋盘上，逻辑对齐毛线求解器 simulator）：
 * - 黑块：永久阻挡，不可取、不可通行、阻断激活。
 * - 冰块(ice)：先"激活"(1步：成为暴露/被点邻居)，再需 durability 步解冻(默认3)，解冻前不可取。
 * - 锁链(chain)：成对；配对端已激活时可取，取一端 → 两端同时消除进场。
 * - 问号(q)：软障碍，隐藏真实颜色；"激活"后揭示原有颜色（求解器全知，不影响可解性）。
 * - 管道(pipe)：分散在棋盘各处、四方向之一；视作黑块永久占格阻挡；出口格空出时释放下一个盒到出口；吐完不消失。
 *
 * 激活模型（毛线口径）：第0行(及与顶部空格连通处)初始激活；每次取盒 → 相邻格激活(单调，永不撤销)。
 *   盒可取 = 已激活 且 未被冰/链锁定。冰块解冻：每次取盒，所有"已激活"冰块 thaw+1，thaw≥durability 解冻。
 */

var AntSolver = AntSolver || {};

AntSolver.Simulator = (function() {
  var active = false;
  var state = null;

  function isActive() { return active; }
  function getState() { return state; }

  // 手动游玩默认用"起点距离优先"消除(对齐真机/玩家模拟)；可传 opts 覆盖(如 {useSlotStart:false} 用理论口径)。
  var _enterOpts = null;
  function enter(level, opts) { active = true; _enterOpts = opts || { useSlotStart: true }; state = createState(level, _enterOpts); return state; }
  function exit() { active = false; state = null; }

  /**
   * 暂存槽 slot(0-indexed) 的蚂蚁起点：蚂蚁从【底部】进入(游戏行0=数组底 r=rows-1)，
   * 所以起点行 = 最底行(rows-1)，列 = 按槽位比例映射。slot0 = 左下角。
   */
  function slotStartCoord(slot, rows, cols, bufferLimit) {
    if (slot == null) return null;
    var col = Math.floor((slot / Math.max(1, bufferLimit)) * cols);
    if (col > cols - 1) col = cols - 1; if (col < 0) col = 0;
    return { r: rows - 1, c: col };
  }
  /** 暂存区最左空槽(供起点映射)；全占则返回 buffer.length(溢出)。 */
  function leftmostFreeSlot(s) {
    var used = {};
    for (var i = 0; i < s.buffer.length; i++) if (s.buffer[i].slot != null) used[s.buffer[i].slot] = 1;
    for (var k = 0; k < s.bufferLimit; k++) if (!used[k]) return k;
    return s.buffer.length;
  }
  /** (r,c) 同色像素是否可达(邻接边界或已消格)。 */
  function reachableCell(eliminated, rows, cols, r, c) {
    if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return true;
    return eliminated[r - 1][c] || eliminated[r + 1][c] || eliminated[r][c - 1] || eliminated[r][c + 1];
  }
  /** 探测离 start 最近的可达同色像素距离(不移除)，供暂存"距离优先"排序。 */
  function peekNearestDist(s, color, start) {
    var best = Infinity;
    for (var r = 0; r < s.rows; r++) for (var c = 0; c < s.cols; c++) {
      if (s.eliminated[r][c] || s.blocks[r][c] !== color) continue;
      if (!reachableCell(s.eliminated, s.rows, s.cols, r, c)) continue;
      var d = start ? (Math.abs(r - start.r) + Math.abs(c - start.c)) : ((s.rows - 1 - r) * s.cols + c);
      if (d < best) best = d;
    }
    return best;
  }

  // ---- 棋盘 cell 深拷贝 ----
  function cloneCell(cell) {
    if (cell == null) return null;
    if (cell.t === 'box') return { t: 'box', color: cell.color, count: cell.count, ice: cell.ice || 0, chain: cell.chain || 0, q: !!cell.q };
    if (cell.t === 'black') return { t: 'black' };
    if (cell.t === 'pipe') return { t: 'pipe', dir: cell.dir, queue: (cell.queue || []).map(function(b) { return { color: b.color, count: b.count }; }), next: cell.next || 0, opened: !!cell.opened };
    return null;
  }
  function cloneCells(cells) {
    var out = [];
    for (var r = 0; r < cells.length; r++) {
      var row = [];
      for (var c = 0; c < cells[r].length; c++) row.push(cloneCell(cells[r][c]));
      out.push(row);
    }
    return out;
  }

  /**
   * 创建初始游戏状态
   */
  function createState(level, opts) {
    var board = level.board || { rows: 0, cols: 0, cells: [] };
    var s = {
      level: level,
      useSlotStart: !!(opts && opts.useSlotStart), // 起点距离优先消除(手动游玩)；默认关(求解器/生成)
      bottomOnly: !!(opts && opts.bottomOnly),     // 底部版：仅【目标图溶解】自底向上(上/左/右封闭)；棋盘取盒逻辑不变(仍顶部口径)
      // 第三种玩法模式：四方向瞬时连锁消除（需求 08.03，用户 2026-08-03 批准）。
      // 与 bottomOnly 互斥——本模式固定四方向可达，不接受底部单入口。
      // 开启后【全链路同一口径】：结算走 instantChainEliminate(快照批次 + 起点距离优先)、
      // 暂存推进严格按进入顺序(先进先得)、全知求解与玩家模拟共用这一套结算。
      instantChain: !!(opts && opts.instantChain),
      rows: level.rows, cols: level.cols,
      blocks: AntSolver.deepClone(level.blocks),
      eliminated: AntSolver.create2D(level.rows, level.cols, false),
      totalPixels: level.totalPixels,
      eliminatedPixels: 0,
      bufferLimit: level.bufferLimit || 5,
      buffer: [],
      // 棋盘
      boardRows: board.rows, boardCols: board.cols,
      cells: cloneCells(board.cells),
      activated: {},    // 'r,c' -> true（单调激活）
      removed: {},      // 'r,c' -> true（曾被拿走的格；用于问号"相邻被拿走即揭示"）
      frozen: {},       // 'r,c' -> {activated, thaw, durability}
      chainGroups: [],  // [[{r,c},...], ...] 每组2或3连（仅横/竖正交；三连可 L/反L）
      pressureSamples: [], // 每完成一个球记录 {done,buf}（buf=此刻暂存数，不含本次完成的球）
      capturePreviewStats: !!(opts && opts.capturePreviewStats), // 仅图表/调试按需采集可消/封锁快照，避免生产批量无谓计算
      // 统计
      steps: 0,
      totalBoxes: level.totalBoxes || 0,
      completedBoxes: 0,
      _linkSeq: 0,      // 锁链组自增 id
      _keySeq: 0,       // 暂存条目自增 key（动画用）
      capture: false,   // 是否记录动画事件
      capOps: null,     // 本次取盒的动画事件序列
      history: [],
      gameOver: false,
      gameWon: false,
      overflow: false,  // 暂存瞬时超上限(锁链整组入场即超) → 死亡；严格执行"暂存满且无法消除就死亡"
      resSum: 0,        // 滞留累计：每个球(从入场到消除)在暂存停留的步数之和
      resCount: 0       // 曾入场暂存的球数（滞留分母）→ 平均滞留 = resSum/resCount
    };

    // 瞬时连锁模式固定四方向：即使调用方误传 bottomOnly 也强制关掉，避免出现「四方向模式却按底部播种」。
    if (s.instantChain && s.bottomOnly) s.bottomOnly = false;
    // 初始可达空格：仅与棋盘外部连通的空格（对齐 ColonyFlow computeReach，封闭空腔不可达）
    s.eliminated = AntSolver.outsideReachSeed(level.blocks, level.rows, level.cols, s.bottomOnly);

    initBoardObstacles(s);
    checkPipeRelease(s);
    updateActivation(s);
    // ===== 取消首行冰块的「免费激活」（ANT-ICE-ROW0-NOFREE-20260805，用户 2026-08-05）=====
    // 背景：上面的 updateActivation 会把所有【当前暴露】的盒标为已激活，而首行盒天然暴露
    //   （上方无遮挡），于是首行冰块在开局就已 activated —— 这就是「免费赠送激活」。
    //   代码里并没有首行特判，它是暴露判定的自然结果。
    // 后果：applyPick 内的顺序是【先 advanceIce 后 updateActivation】，因此
    //   · 首行冰块：开局已激活 → 第 1 次取盒就开始计步 → 第 3 次取盒解冻（3 步）
    //   · 其他行冰块：第 1 次取盒时尚未激活、该步不计数 → 第 4 次取盒才解冻（1 次激活 + 3 次全局）
    //   首行因此比其他行少一步。
    // 用户要求统一口径：所有冰块都是「1 次激活 + 3 次全局 = 4 步」。
    // 做法：初始化阶段把冰块的 activated 一律归零，使激活只能发生在至少一次取盒之后。
    //   注意只清 frozen 的 activated，不动 s.activated（后者是盒是否可取的单调标记，
    //   清它会让首行盒开局不可取、直接改变玩法）。
    for (var fk0 in s.frozen) s.frozen[fk0].activated = false;
    return s;
  }

  /**
   * 从棋盘 cell 初始化冰块状态 + 锁链配对
   */
  function initBoardObstacles(s) {
    // 冰块：frozen{activated,thaw,durability}
    for (var r = 0; r < s.boardRows; r++) {
      for (var c = 0; c < s.boardCols; c++) {
        var cell = s.cells[r][c];
        if (AntSolver.isBox(cell) && cell.ice > 0) {
          s.frozen[r + ',' + c] = { activated: false, thaw: 0, durability: cell.ice };
        }
      }
    }
    // 锁链分组：按 chain 组号收集（每组2或3连，仅横/竖正交，三连可 L/反L）
    var byGroup = {};
    for (var r2 = 0; r2 < s.boardRows; r2++) {
      for (var c2 = 0; c2 < s.boardCols; c2++) {
        var cell2 = s.cells[r2][c2];
        if (AntSolver.isBox(cell2) && cell2.chain > 0) {
          (byGroup[cell2.chain] = byGroup[cell2.chain] || []).push({ r: r2, c: c2 });
        }
      }
    }
    for (var g in byGroup) {
      if (byGroup[g].length >= 2) s.chainGroups.push(byGroup[g]);
    }
  }

  /**
   * 更新激活（单调）：所有当前"暴露"的盒 → 标记 activated；同步冰块 activated。
   */
  function updateActivation(s) {
    var R = computeReach(s);
    for (var r = 0; r < s.boardRows; r++) {
      for (var c = 0; c < s.boardCols; c++) {
        if (!AntSolver.isBox(s.cells[r][c])) continue;
        if (isExposedAt(s, r, c, R)) {
          var k = r + ',' + c;
          s.activated[k] = true;
          if (s.frozen[k]) s.frozen[k].activated = true;
        }
      }
    }
    // 管道口【已开口】出球盒直接激活：球从管道口出来即在表面可取(即便四周被盒/墙围)。
    for (var pr = 0; pr < s.boardRows; pr++) {
      for (var pc = 0; pc < s.boardCols; pc++) {
        var pcell = s.cells[pr][pc];
        if (!AntSolver.isPipe(pcell) || !pcell.opened) continue;
        var pdv = AntSolver.PIPE_DIRS[pcell.dir] || [1, 0];
        var er = pr + pdv[0], ec = pc + pdv[1];
        if (er < 0 || er >= s.boardRows || ec < 0 || ec >= s.boardCols) continue;
        if (AntSolver.isBox(s.cells[er][ec])) {
          var ek = er + ',' + ec;
          s.activated[ek] = true;
          if (s.frozen[ek]) s.frozen[ek].activated = true;
        }
      }
    }
  }

  /** 每次取盒推进冰块解冻：所有已激活且未解冻的冰块 thaw+1。 */
  function advanceIce(s) {
    for (var k in s.frozen) {
      var f = s.frozen[k];
      if (f.activated && f.thaw < f.durability) f.thaw++;
    }
  }

  /** 查(r,c)所在的锁链组（全部成员位置）。返回 [{r,c},...] 或 null。 */
  function chainGroupMembers(s, r, c) {
    for (var i = 0; i < s.chainGroups.length; i++) {
      var g = s.chainGroups[i];
      for (var j = 0; j < g.length; j++) if (g[j].r === r && g[j].c === c) return g;
    }
    return null;
  }

  /** 问号是否已揭示：核心=只要有相邻格被拿走(removed)即揭示；或本格已激活。 */
  function isRevealed(s, r, c) {
    if (s.activated[r + ',' + c]) return true;
    if (!s.removed) return false;
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var d = 0; d < 4; d++) {
      var nr = r + dirs[d][0], nc = c + dirs[d][1];
      if (nr < 0 || nr >= s.boardRows || nc < 0 || nc >= s.boardCols) continue;
      if (s.removed[nr + ',' + nc]) return true;
    }
    return false;
  }

  // ==================== 棋盘可达性（顶部解锁） ====================
  /**
   * 计算从顶部经空格可达的空格集合（BFS）。管道/黑块/盒子阻挡通行。
   */
  function computeReach(s) {
    var R = AntSolver.create2D(s.boardRows, s.boardCols, false);
    var queue = [];
    // 棋盘取盒可达：始终从顶部(第0行)播种。底部版【棋盘取盒逻辑不变】，仍从首行开始拿；
    // 底部版的差异只在【目标图溶解闭合】(floodFillEliminate/outsideReachSeed 的 bottomOnly)。
    for (var c = 0; c < s.boardCols; c++) {
      if (AntSolver.isEmptyCell(s.cells[0][c])) { R[0][c] = true; queue.push([0, c]); }
    }
    // 管道口【已开口】(opened = 从管道口拿走过任意盒)作为【可达源】：出口格标记可达并入队 → 使相邻块暴露(激活)。
    // 修复：只要管道口拿走过任意盒即可激活相邻块，而非必须把管道内球全部拿走。开口前(仅释放未取)行为同旧版。
    for (var pr = 0; pr < s.boardRows; pr++) {
      for (var pc = 0; pc < s.boardCols; pc++) {
        var pcell = s.cells[pr][pc];
        if (!AntSolver.isPipe(pcell) || !pcell.opened) continue;
        var pdv = AntSolver.PIPE_DIRS[pcell.dir] || [1, 0];
        var per = pr + pdv[0], pec = pc + pdv[1];
        if (per < 0 || per >= s.boardRows || pec < 0 || pec >= s.boardCols) continue;
        if (!R[per][pec]) { R[per][pec] = true; queue.push([per, pec]); }
      }
    }
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var h = 0; h < queue.length; h++) {
      var r = queue[h][0], cc = queue[h][1];
      for (var d = 0; d < dirs.length; d++) {
        var nr = r + dirs[d][0], nc = cc + dirs[d][1];
        if (nr < 0 || nr >= s.boardRows || nc < 0 || nc >= s.boardCols) continue;
        if (R[nr][nc]) continue;
        if (AntSolver.isEmptyCell(s.cells[nr][nc])) { R[nr][nc] = true; queue.push([nr, nc]); }
      }
    }
    return R;
  }

  /**
   * 盒子(r,c)是否"暴露"可取（棋盘取盒，顶部口径，底部版不变）：位于第0行，或任意正交邻格可达。
   */
  function isExposedAt(s, r, c, R) {
    if (!AntSolver.isBox(s.cells[r][c])) return false;
    if (r === 0) return true;
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var d = 0; d < dirs.length; d++) {
      var nr = r + dirs[d][0], nc = c + dirs[d][1];
      if (nr < 0 || nr >= s.boardRows || nc < 0 || nc >= s.boardCols) continue;
      if (R[nr][nc]) return true;
    }
    return false;
  }

  /** 冰块锁定：已激活且 thaw≥durability 才解冻，否则锁定。 */
  function isIceLocked(s, r, c) {
    var f = s.frozen[r + ',' + c];
    if (!f) return false;
    return !(f.activated && f.thaw >= f.durability);
  }

  /** 锁链锁定：组内【所有】其他成员都必须已激活且冰已解冻，才可连体取（否则锁定）。 */
  function isChainLocked(s, r, c) {
    var g = chainGroupMembers(s, r, c);
    if (!g) return false;
    for (var i = 0; i < g.length; i++) {
      var m = g[i];
      if (m.r === r && m.c === c) continue;
      if (!AntSolver.isBox(s.cells[m.r][m.c])) continue; // 已消除(整组同取，通常不会) → 忽略
      if (!s.activated[m.r + ',' + m.c]) return true;    // 有成员未激活 → 锁
      if (isIceLocked(s, m.r, m.c)) return true;          // 有成员冰未解 → 锁
    }
    return false;
  }

  /**
   * 盒子(r,c)当前是否可取（已激活 + 未被冰/链锁定）。
   */
  function isPickable(s, r, c) {
    if (!AntSolver.isBox(s.cells[r][c])) return false;
    if (!s.activated[r + ',' + c]) return false;
    if (isIceLocked(s, r, c)) return false;
    if (isChainLocked(s, r, c)) return false;
    return true;
  }

  // ==================== 目标图消除（flood-fill） ====================
  /**
   * 消除：完整复刻 ColonyFlow 的 FoodContainer.TryGetTileCanSelect 起点判定——
   * 每次在"同色 + 可达"方块中，取【最底部(游戏行0=数组底 r=rows-1)、再最左(c 小)】的那一个消除，
   * 消除后重新扫描再取下一个，直到消满 maxCount 或无可消。即"从最底部开始、由外向内逐个消"。
   * 可达 = 邻接棋盘边界 或 邻接已消除格(外部连通空格；配合 outsideReachSeed 保证不含封闭空腔)。
   */
  // 小顶堆（按 key 升序）：供逐像素动态依赖波排序使用。
  function _hpush(h, k, r, c) {
    h.push({ k: k, r: r, c: c });
    var i = h.length - 1;
    while (i > 0) { var p = (i - 1) >> 1; if (h[p].k <= h[i].k) break; var t = h[p]; h[p] = h[i]; h[i] = t; i = p; }
  }
  function _hpop(h) {
    var top = h[0], last = h.pop();
    if (h.length) { h[0] = last; var i = 0, n = h.length;
      while (true) { var l = 2*i+1, rr = 2*i+2, m = i;
        if (l < n && h[l].k < h[m].k) m = l;
        if (rr < n && h[rr].k < h[m].k) m = rr;
        if (m === i) break; var t = h[m]; h[m] = h[i]; h[i] = t; i = m; } }
    return top;
  }

  // 每次取盒均按像素级动态依赖波消除：底→左→右→顶的入口优先；消一格即刷新其解锁区域。
  // start 提供时（手动游玩）额外以离盒起点的曼哈顿距离为最高优先级，平手再用动态依赖波。
  function floodFillEliminate(eliminated, blocks, rows, cols, colorId, maxCount, trace, start, bottomOnly) {
    if (maxCount <= 0) return 0;
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    var AREA = rows * cols;
    function keyOf(r, c) {
      // 可达前提下【距离优先·由外向内】：距最近(底/左/右)边越近越先消。
      // → 左侧区域 L→R、右侧区域 R→L、底部优先；平手再取最底、再最左。(顶边不计入距离，故顶部中央最后消)
      var dEdge = Math.min(rows - 1 - r, c, cols - 1 - c);
      var base = dEdge * AREA + (rows - 1 - r) * cols + c;
      if (start) return (Math.abs(r - start.r) + Math.abs(c - start.c)) * AREA * (rows + cols) + base; // 手动游玩：离起点近优先
      return base;
    }
    // 可达(闭合逻辑)：默认四边皆为外部开口；bottomOnly 仅底边开口，上/左/右视作墙 →
    // 目标图只能从底部溶解、逐层向上，左/上/右不会"漏进去"越位消除。相邻已消除格始终算可达(空腔已打通)。
    function reachable(r, c) {
      if (bottomOnly) { if (r === rows - 1) return true; }
      else if (r === 0 || r === rows-1 || c === 0 || c === cols-1) return true;
      for (var d = 0; d < 4; d++) {
        var nr = r + dirs[d][0], nc = c + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) { if (bottomOnly) continue; return true; }
        if (eliminated[nr][nc]) return true;
      }
      return false;
    }
    // 像素级【动态依赖波】排序：
    // 初始可达同色像素不再混成一个"静态最近边"堆。先按入口方向分源：底→左→右→顶；
    // 每拿走一格，新揭示的同色格继承该入口并进入下一波(depth+1)。因此底部区域揭示出的第2/3行
    // 会先于远处左/右边界的初始候选，而不会出现"底部第1行后立刻跳到两侧"。
    // 同一波内：底部/顶边按左→右，左/右边按下→上；右侧进入内部时仍从右→左靠拢。
    var heap = [], bestKey = {}, bestSource = {}, bestDepth = {};
    var SOURCE_SPAN = AREA * (AREA + 1); // 一个入口源的所有 depth/tie 必须小于下一源
    function edgeSource(r, c) {
      // 外部入口优先级：底→左→右→顶；bottomOnly 时只有底边可作为入口。
      if (bottomOnly) return r === rows - 1 ? 0 : -1;
      if (r === rows - 1) return 0;
      if (c === 0) return 1;
      if (c === cols - 1) return 2;
      if (r === 0) return 3;
      return -1;
    }
    function tieOf(r, c, source) {
      if (source === 0 || source === 3) return c;       // 底/顶：左→右
      if (source === 1) return rows - 1 - r;             // 左：下→上
      return rows - 1 - r;                               // 右：下→上（横向进入时由右向左）
    }
    function keyOf(r, c, source, depth) {
      var base = source * SOURCE_SPAN + depth * AREA + tieOf(r, c, source);
      // 手动模式仍以"离盒起点"优先；同起点距离内再遵循动态依赖波，保持原玩家口径。
      if (start) return (Math.abs(r - start.r) + Math.abs(c - start.c)) * (4 * SOURCE_SPAN) + base;
      return base;
    }
    function pushCandidate(r, c, source, depth) {
      var id = r * cols + c, k = keyOf(r, c, source, depth);
      // 同一像素可由更高优先入口/更短依赖波再次揭示：允许更新，旧堆节点弹出时忽略。
      if (bestKey[id] != null && bestKey[id] <= k) return;
      bestKey[id] = k; bestSource[id] = source; bestDepth[id] = depth;
      _hpush(heap, k, r, c);
    }

    // 以【当前已消除空格】重建外部可达的入口/波深度。
    // 这是跨盒连续性的关键：第二个同色盒开始时，上一盒挖出的空洞仍带有从底/左/右/顶进入的真实路径深度。
    // 例如底行已消、第二行残余的深度=1，第三行只经第二行已消部分可达的深度=2，不能都被重新当成 depth=0。
    var accessHeap = [], accessKey = {}, accessSource = {}, accessDepth = {};
    function pushAccess(r, c, source, depth) {
      var id = r * cols + c, k = source * SOURCE_SPAN + depth * AREA + tieOf(r, c, source);
      if (accessKey[id] != null && accessKey[id] <= k) return;
      accessKey[id] = k; accessSource[id] = source; accessDepth[id] = depth;
      _hpush(accessHeap, k, r, c);
    }
    // 外边已消空格作为深度0种子；其余已消空格经 BFS 从种子继承真实深度。
    for (var sr = 0; sr < rows; sr++) {
      for (var sc = 0; sc < cols; sc++) {
        var es = edgeSource(sr, sc);
        if (es >= 0 && eliminated[sr][sc]) pushAccess(sr, sc, es, 0);
      }
    }
    while (accessHeap.length) {
      var ap = _hpop(accessHeap), ar = ap.r, ac = ap.c, aid = ar * cols + ac;
      if (accessKey[aid] !== ap.k) continue;
      var as = accessSource[aid], ad = accessDepth[aid] + 1;
      for (var ai = 0; ai < 4; ai++) {
        var er = ar + dirs[ai][0], ec = ac + dirs[ai][1];
        if (er < 0 || er >= rows || ec < 0 || ec >= cols || !eliminated[er][ec]) continue;
        pushAccess(er, ec, as, ad);
      }
    }

    // 初始全局扫描：边界同色块深度0；邻接当前外部空洞的同色块从空洞继承【真实路径深度】。
    for (var r0 = 0; r0 < rows; r0++) {
      for (var c0 = 0; c0 < cols; c0++) {
        if (eliminated[r0][c0] || blocks[r0][c0] !== colorId) continue;
        var seedSource = edgeSource(r0, c0), seedDepth = seedSource >= 0 ? 0 : null;
        for (var sd = 0; sd < 4; sd++) {
          var rr0 = r0 + dirs[sd][0], cc0 = c0 + dirs[sd][1];
          if (rr0 < 0 || rr0 >= rows || cc0 < 0 || cc0 >= cols) continue;
          var nearId = rr0 * cols + cc0;
          if (!eliminated[rr0][cc0] || accessKey[nearId] == null) continue;
          var ns = accessSource[nearId], nd = accessDepth[nearId] + 1;
          if (seedDepth == null || keyOf(r0, c0, ns, nd) < keyOf(r0, c0, seedSource, seedDepth)) { seedSource = ns; seedDepth = nd; }
        }
        if (seedSource >= 0) pushCandidate(r0, c0, seedSource, seedDepth);
      }
    }
    var count = 0;
    while (count < maxCount && heap.length) {
      var top = _hpop(heap), r = top.r, c = top.c, topId = r * cols + c;
      if (eliminated[r][c] || bestKey[topId] !== top.k) continue; // 已消/已被更优依赖路径更新的旧节点
      eliminated[r][c] = true; count++;
      if (trace) trace.push([r, c]);
      // 每消一格，立即刷新该格打开的同色依赖：新像素继承当前入口源，进入下一依赖波。
      var source = bestSource[topId], nextDepth = bestDepth[topId] + 1;
      for (var d = 0; d < 4; d++) {
        var nr = r + dirs[d][0], nc = c + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (eliminated[nr][nc] || blocks[nr][nc] !== colorId) continue;
        pushCandidate(nr, nc, source, nextDepth);
      }
    }
    return count;
  }

  function floodFillCount(tempElim, blocks, rows, cols, colorId, bottomOnly) {
    return floodFillEliminate(tempElim, blocks, rows, cols, colorId, Infinity, null, null, bottomOnly);
  }

  // ==================== 四方向瞬时连锁消除（第三种玩法模式） ====================
  /**
   * 需求：08.03-四方向瞬时连锁消除生成分支。用户 2026-08-03 批准，阶段一在独立拷贝内实验。
   *
   * 与原四方向消除（floodFillEliminate）的两点核心区别——这是两套并列口径，不是同一套的参数变化：
   *
   *   ① 排序依据。原实现按「入口源分层（底→左→右→顶）+ 依赖波深度」，全知/生成不传起点、
   *      完全不看离暂存起点的距离。本模式一律按【离该订单暂存起点的曼哈顿距离】近优先，
   *      平手沿用现有稳定规则（先最底 r 大，再最左 c 小），与玩家侧 eatNearest 的平手口径一致。
   *   ② 批次边界。原实现是逐格增量：消一格就立刻把新暴露的同色邻居推进同一个堆继续比较，
   *      新暴露的近处像素会插到远处初始候选之前。本模式是【快照批次】：本轮只在「进入本轮时的
   *      可达同色全集」里挑，消除过程中新暴露的像素不参与本轮，要等这一批整体消完、
   *      目标图刷新后，下一轮重扫才纳入。
   *
   * 容量封顶（需求 §二.3）：每轮取 min(本轮快照数, 订单剩余容量)，实际消除量恒 ≤ 订单剩余容量。
   * 快照数多于剩余容量时只消最近的那些，订单完成离场，剩余同色像素继续留在目标图里。
   *
   * 循环终止（需求 §二.4）：订单达成容量，或本轮快照为空（无可达同色 → 订单滞留暂存区）。
   *
   * 本模式固定使用四方向可达，不接受底部单入口（需求 §一：不使用底部单入口规则）。
   *
   * @param {Array<Array<boolean>>} eliminated 已消除矩阵，原地修改
   * @param {number} maxCount 本次允许消除的上限 = 订单剩余容量（Infinity 表示只做可达计数）
   * @param {Array} [trace] 传入则按实际消除次序追加 [r,c]
   * @param {{r:number,c:number}} start 订单的暂存起点（槽位映射到目标图底行的列）；缺失时用确定性兜底
   * @param {object} [stat] 传入则回填 { rounds:[每轮消除数], batches:number, snapshotFirst:number }
   * @returns {number} 实际消除的像素数
   */
  function instantChainEliminate(eliminated, blocks, rows, cols, colorId, maxCount, trace, start, stat) {
    if (maxCount <= 0) return 0;
    // 起点缺失时不静默乱来：用最底最左作确定性兜底，并在 stat 里标出来，供上层如实展示。
    var st = start || { r: rows - 1, c: 0 };
    if (stat) { stat.rounds = []; stat.batches = 0; stat.startFallback = !start; }

    function reachable(r, c) {
      // 四方向：贴任一边即为外部入口；否则邻接已消除格才算可达（空腔打通后继续向内）。
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return true;
      if (eliminated[r - 1][c] || eliminated[r + 1][c]) return true;
      if (eliminated[r][c - 1] || eliminated[r][c + 1]) return true;
      return false;
    }

    var count = 0;
    var guard = rows * cols + 8;   // 每轮至少消 1 格，轮数不可能超过像素总数
    while (count < maxCount && guard-- > 0) {
      // —— 本轮快照：进入本轮时的可达同色全集（消除过程中新暴露的不进本轮）——
      var snap = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (eliminated[r][c] || blocks[r][c] !== colorId) continue;
          if (!reachable(r, c)) continue;
          snap.push({ r: r, c: c, d: Math.abs(r - st.r) + Math.abs(c - st.c) });
        }
      }
      if (!snap.length) break;                       // 无可达同色 → 订单滞留，本次结算结束
      if (stat && stat.snapshotFirst == null) stat.snapshotFirst = snap.length;
      // 距离近优先；平手沿用现有稳定规则（最底、再最左），保证结果可复现
      snap.sort(function (a, b) { return (a.d - b.d) || (b.r - a.r) || (a.c - b.c); });
      var take = Math.min(snap.length, maxCount - count);
      for (var i = 0; i < take; i++) {
        var p = snap[i];
        eliminated[p.r][p.c] = true;
        count++;
        if (trace) trace.push([p.r, p.c]);
      }
      if (stat) { stat.rounds.push(take); stat.batches++; }
      if (take < snap.length) break;                 // 容量用尽（快照还有剩）→ 订单完成，不再重扫
    }
    return count;
  }

  /** 瞬时连锁模式下的可达同色计数（不改动传入矩阵之外的状态）。 */
  function instantChainCount(tempElim, blocks, rows, cols, colorId, start) {
    return instantChainEliminate(tempElim, blocks, rows, cols, colorId, Infinity, null, start, null);
  }

  /**
   * 消除结算的唯一分发点（三种玩法模式共用一个入口，避免各处零散判断导致口径分裂）。
   *   瞬时连锁模式 → instantChainEliminate（四方向 + 快照批次 + 起点距离优先）
   *   其余两种模式 → floodFillEliminate（原实现，bottomOnly 决定是否只开底边）
   * 原两种模式走的代码路径与参数完全不变，因此产出不受本模式新增影响。
   */
  function elimDispatch(s, colorId, maxCount, trace, start, stat) {
    return elimOnMatrix(s.eliminated, s, colorId, maxCount, trace, start, stat);
  }

  /**
   * 同一个分发口径，但作用在【调用方给定的已消除矩阵】上（打分试算、可达预览等用 scratch 副本）。
   * 与 elimDispatch 共用同一判断，避免出现「真实结算走新口径、打分试算走老口径」这类分裂。
   */
  function elimOnMatrix(elimMatrix, s, colorId, maxCount, trace, start, stat) {
    if (s.instantChain) {
      return instantChainEliminate(elimMatrix, s.blocks, s.rows, s.cols, colorId, maxCount, trace, start, stat || null);
    }
    return floodFillEliminate(elimMatrix, s.blocks, s.rows, s.cols, colorId, maxCount, trace, start || null, s.bottomOnly);
  }

  /**
   * 返回下一盒进入暂存时会使用的空槽和目标图起点。
   * 已滞留的盒仍保留它们原有 start；此处只描述【下一盒】因最左空槽变化得到的新起点。
   */
  function getNextSlotStart(s) {
    if (!s) return { slot: null, start: null };
    var slot = (s.useSlotStart || s.instantChain) ? leftmostFreeSlot(s) : null;
    return {
      slot: slot,
      start: slot != null ? slotStartCoord(slot, s.rows, s.cols, s.bufferLimit) : null
    };
  }

  /**
   * 暂存滞留期间的“下一盒可消顺序”预览。
   *
   * 从当前目标图空洞出发，对每个颜色分别以【下一盒】的真实槽位起点试算 Infinity 个像素；
   * 不修改 live state。rank 是每色独立的 1..k 排名；locked[r][c]=true 表示该未消像素
   * 在本次起点/空洞状态下当前不可达，绝非编号遗漏。stats/byColor 用于压力图、玩家分析与难度平衡。
   * options.slot 可供并发玩家模拟传入其下一空槽；未传时按 Simulator state 的最左空槽计算。
   */
  function previewNextEliminationOrder(s, options) {
    options = options || {};
    var next;
    if (options.slot != null && options.slot >= 0 && options.slot < s.bufferLimit) {
      next = { slot: options.slot, start: (s.useSlotStart || s.instantChain) ? slotStartCoord(options.slot, s.rows, s.cols, s.bufferLimit) : null };
    } else {
      next = getNextSlotStart(s);
    }
    var rank = AntSolver.create2D(s.rows, s.cols, 0);
    var locked = AntSolver.create2D(s.rows, s.cols, false);
    var colors = {}, byColor = {}, reachable = 0, remaining = 0;
    for (var r = 0; r < s.rows; r++) {
      for (var c = 0; c < s.cols; c++) {
        if (s.eliminated[r][c] || s.blocks[r][c] <= 0) continue;
        var color = s.blocks[r][c];
        colors[color] = true;
        if (!byColor[color]) byColor[color] = { remaining: 0, reachable: 0, locked: 0 };
        byColor[color].remaining++;
        remaining++;
      }
    }
    for (var colorId in colors) {
      var scratch = [];
      for (var sr = 0; sr < s.rows; sr++) scratch.push(s.eliminated[sr].slice());
      var trace = [];
      if (s.instantChain) {
        instantChainEliminate(scratch, s.blocks, s.rows, s.cols, parseInt(colorId, 10), Infinity, trace, next.start, null);
      } else {
        floodFillEliminate(scratch, s.blocks, s.rows, s.cols, parseInt(colorId, 10), Infinity, trace, next.start, s.bottomOnly);
      }
      byColor[colorId].reachable = trace.length;
      for (var ti = 0; ti < trace.length; ti++) {
        var p = trace[ti];
        rank[p[0]][p[1]] = ti + 1;
        reachable++;
      }
    }
    for (var lr = 0; lr < s.rows; lr++) {
      for (var lc = 0; lc < s.cols; lc++) {
        if (!s.eliminated[lr][lc] && s.blocks[lr][lc] > 0 && !rank[lr][lc]) locked[lr][lc] = true;
      }
    }
    for (var statColor in byColor) byColor[statColor].locked = byColor[statColor].remaining - byColor[statColor].reachable;
    var lockedCount = remaining - reachable;
    return {
      rank: rank, locked: locked, slot: next.slot, start: next.start,
      total: reachable, reachable: reachable, lockedCount: lockedCount, remaining: remaining,
      stats: { reachable: reachable, locked: lockedCount, remaining: remaining, lockRatio: remaining ? lockedCount / remaining : 0 },
      byColor: byColor
    };
  }

  // ==================== 管道释放 ====================
  /**
   * 检查所有管道：出口格空出且队列有剩余 → 释放下一个盒到出口。队列耗尽 → 管道变空格。
   */
  function checkPipeRelease(s) {
    var changed = true;
    while (changed) {
      changed = false;
      for (var r = 0; r < s.boardRows; r++) {
        for (var c = 0; c < s.boardCols; c++) {
          var cell = s.cells[r][c];
          if (!AntSolver.isPipe(cell)) continue;
          var dir = AntSolver.PIPE_DIRS[cell.dir] || [1, 0];
          var er = r + dir[0], ec = c + dir[1];
          if (er < 0 || er >= s.boardRows || ec < 0 || ec >= s.boardCols) continue;
          if (!AntSolver.isEmptyCell(s.cells[er][ec])) continue;
          if (cell.next < cell.queue.length) {
            var ball = cell.queue[cell.next];
            s.cells[er][ec] = { t: 'box', color: ball.color, count: ball.count, ice: 0, chain: 0, q: false };
            cell.next++;
            changed = true;
          }
          // 队列耗尽：管道保留占位（视作黑块，不消失、依旧阻挡）
        }
      }
    }
  }

  // ==================== 取盒 & 暂存 ====================
  function executeAntBox(s, antBox, trace, start, stat) {
    trace = trace || null;
    var actual = elimDispatch(s, antBox.color, antBox.count, trace, start, stat);
    s.eliminatedPixels += actual;
    return { eliminated: actual, completed: actual >= antBox.count, remaining: antBox.count - actual };
  }

  // 记录一次"球完成"时的暂存压力样本（buf 不含本次完成的球）。
  // 调试/图表显式开启 capturePreviewStats 时，同步保存下一槽位的可消/封锁快照；
  // 默认不计算，避免批量生成与求解前瞻产生额外的整图扫描成本。
  function recordCompletion(s) {
    if (!s.pressureSamples) return;
    var sample = { done: s.completedBoxes, buf: s.buffer.length };
    if (s.capturePreviewStats) {
      var preview = previewNextEliminationOrder(s);
      sample.nextSlot = preview.slot;
      sample.reachable = preview.reachable;
      sample.locked = preview.lockedCount;
      sample.remaining = preview.remaining;
      sample.lockRatio = preview.stats.lockRatio;
    }
    s.pressureSamples.push(sample);
  }

  function processAntBox(s, antBox) {
    var trace = s.capture ? [] : null;
    var key = ++s._keySeq;
    // 该球进入的暂存槽 → 决定蚂蚁起点(手动游玩起点距离优先)
    // 瞬时连锁模式必须有起点（用户裁决：全知侧也接入起点逻辑，沿用现有槽位映射），
    // 所以这里不再只看 useSlotStart —— 该模式下求解器/生成路径同样分配槽位与起点。
    var needStart = s.useSlotStart || s.instantChain;
    var slot = needStart ? leftmostFreeSlot(s) : null;
    var start = slot != null ? slotStartCoord(slot, s.rows, s.cols, s.bufferLimit) : null;
    var result = executeAntBox(s, antBox, trace, start);
    if (s.capture) {
      s.capOps.push({ t: 'add', key: key, color: antBox.color, need: antBox.count, link: 0, slot: slot, start: start });
      s.capOps.push({ t: 'eat', key: key, cells: trace });
    }
    if (result.completed) {
      s.completedBoxes++;
      recordCompletion(s);
      if (s.capture) s.capOps.push({ t: 'done', keys: [key] });
    } else {
      s.buffer.push({ color: antBox.color, progress: result.eliminated, need: antBox.count, remaining: result.remaining, key: key, slot: slot, start: start, enterStep: s.steps });
    }
    s._enterPeak = s.buffer.length;                          // 只读观测：入场后、结算前（同 processChainGroup）
    if (s.buffer.length > s.bufferLimit) s.overflow = true;  // 暂存超上限 → 死亡(取则占满且消不完)
    autoReleaseBuffer(s);
  }

  /**
   * 锁链整组(2或3连)一起进暂存：同一 link 组。组内所有球都消完订单才一起完成离场；
   * 只要有一个没消完，整组都留在暂存区。
   */
  function processChainGroup(s, boxes) {
    var link = (++s._linkSeq);
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var key = ++s._keySeq;
      var trace = s.capture ? [] : null;
      var slot = (s.useSlotStart || s.instantChain) ? leftmostFreeSlot(s) : null;
      var start = slot != null ? slotStartCoord(slot, s.rows, s.cols, s.bufferLimit) : null;
      var e = elimDispatch(s, b.color, b.count, trace, start, null);
      s.eliminatedPixels += e;
      s.buffer.push({ color: b.color, progress: e, need: b.count, link: link, key: key, slot: slot, start: start, enterStep: s.steps });
      if (s.capture) {
        s.capOps.push({ t: 'add', key: key, color: b.color, need: b.count, link: link, slot: slot, start: start });
        s.capOps.push({ t: 'eat', key: key, cells: trace });
      }
    }
    // 锁链整组一次性入场：若超过暂存上限 → 死亡(物理放不下，严格执行)。在 drain 前判定捕获瞬时峰值。
    // s._enterPeak 是【只读观测】：把这个「入场后、结算前」的占用留给 applyPick 记进求解路线。
    // 它就是本行 overflow 判定所用的同一个值 —— 以前判完即被 autoReleaseBuffer 抹掉，从未被记录。
    s._enterPeak = s.buffer.length;
    if (s.buffer.length > s.bufferLimit) s.overflow = true;
    autoReleaseBuffer(s);
  }

  function autoReleaseBuffer(s) {
    var changed = true;
    while (changed) {
      changed = false;
      // 1) 推进每个暂存球的消除。手动游玩：按【距离优先】(离各自起点最近可达同色像素更近者先消)，
      //    每球用自己的起点(slot 映射)取像素；求解器/生成：按暂存序、最底最左。
      var order = [];
      for (var i = 0; i < s.buffer.length; i++) order.push(i);
      // 瞬时连锁模式：严格【先进先得】（用户 2026-08-03 裁决 + 需求 §四）。
      // 暂存数组本身就是进入顺序，因此这里不做任何重排；前一个同色订单未完成且无可达同色时，
      // 后进入的同色订单也不会越过它抢像素——因为轮到它时可达同色集合已经为空。
      if (s.instantChain) { /* 保持 buffer 原序 = 进入顺序 */ }
      else if (s.useSlotStart && s.buffer.length > 1) {   // 单球无需排序，省去 peek 开销
        var distCache = {};
        for (var oi = 0; oi < order.length; oi++) { var bi = s.buffer[order[oi]]; distCache[order[oi]] = (bi.need - bi.progress) > 0 ? peekNearestDist(s, bi.color, bi.start) : Infinity; }
        order.sort(function (a, b) { return (distCache[a] - distCache[b]) || (a - b); });
      }
      for (var od = 0; od < order.length; od++) {
        var item = s.buffer[order[od]];
        var remaining = item.need - item.progress;
        if (remaining <= 0) continue;
        var trace = s.capture ? [] : null;
        var actual = elimDispatch(s, item.color, remaining, trace, item.start || null, null);
        if (actual > 0) {
          item.progress += actual; s.eliminatedPixels += actual; changed = true;
          if (s.capture && trace.length) s.capOps.push({ t: 'eat', key: item.key, cells: trace });
        }
      }
      // 2) 移除已完成的球：非锁链单独完成；锁链需整组都完成才一起离场
      var removedGroup = false;
      for (var j = s.buffer.length - 1; j >= 0 && !removedGroup; j--) {
        var it = s.buffer[j];
        if (it.progress < it.need) continue;
        if (!it.link) {
          if (s.capture) s.capOps.push({ t: 'done', keys: [it.key] });
          s.resSum += (s.steps - (it.enterStep || 0)); s.resCount++;   // 滞留：入场→消除的步数
          s.buffer.splice(j, 1); s.completedBoxes++; recordCompletion(s); changed = true;
        } else {
          var idxs = [], groupDone = true, gkeys = [];
          for (var k = 0; k < s.buffer.length; k++) {
            if (s.buffer[k].link === it.link) { idxs.push(k); gkeys.push(s.buffer[k].key); if (s.buffer[k].progress < s.buffer[k].need) groupDone = false; }
          }
          if (groupDone) {
            if (s.capture) s.capOps.push({ t: 'done', keys: gkeys });
            idxs.sort(function(x, y) { return y - x; });
            for (var gi = 0; gi < idxs.length; gi++) { var gb = s.buffer[idxs[gi]]; s.resSum += (s.steps - (gb.enterStep || 0)); s.resCount++; s.buffer.splice(idxs[gi], 1); s.completedBoxes++; recordCompletion(s); }
            changed = true; removedGroup = true;
          }
          // 组未全完成 → 该球(即使已消完)留在暂存等待伙伴
        }
      }
    }
  }

  /**
   * 在给定 state 上执行一次取盒（供模拟器与求解器共用）。毛线口径顺序：
   * 取盒(+锁链同取) → 冰块推进 → 管道释放 → 激活相邻 → 消除进场 → 释放暂存。
   */
  /** 若 (r,c) 是某管道的出口(吐球位)，标记该管道【已开口】(拿走过任意盒即开口 → 激活其相邻块)。 */
  function markPipeOpenedIfExit(s, r, c) {
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var d = 0; d < 4; d++) {
      var pr = r + dirs[d][0], pc = c + dirs[d][1];
      if (pr < 0 || pr >= s.boardRows || pc < 0 || pc >= s.boardCols) continue;
      var cell = s.cells[pr][pc];
      if (!AntSolver.isPipe(cell)) continue;
      var dv = AntSolver.PIPE_DIRS[cell.dir] || [1, 0];
      if (pr + dv[0] === r && pc + dv[1] === c) cell.opened = true; // (r,c)=该管道出口
    }
  }

  function applyPick(s, r, c) {
    if (!isPickable(s, r, c)) return false;
    var box = s.cells[r][c];
    var group = box.chain > 0 ? chainGroupMembers(s, r, c) : null;

    // 本次 pick 的暂存起点（结算前）。锁链一步多盒时，调用方只看 buffer.length 无法还原
    // 「入场瞬间占了几位」——那个值在 processChainGroup 内部用于判 overflow 后就被 autoRelease 抹掉了。
    // 故在此处开一份快照，逐字段记录，供求解器写进求解路线（用户 2026-08-27 要求）。
    // 【只读观测，不参与任何决策】：取盒机械、入场、overflow 判定、autoRelease 一行未改。
    var bufBefore = s.buffer.length;
    var chainId = group ? box.chain : 0;

    s.steps++;
    var boxes = [];
    var picked = [];          // 本步实际离场的格子（含锁链整组），顺序 = 触发盒在前
    if (group) {
      // 整组(2/3连)一起离场
      for (var i = 0; i < group.length; i++) {
        var m = group[i], b = s.cells[m.r][m.c];
        if (AntSolver.isBox(b)) {
          boxes.push(b);
          picked.push({ r: m.r, c: m.c, color: b.color, count: b.count });
          s.cells[m.r][m.c] = null; markPipeOpenedIfExit(s, m.r, m.c); if (s.removed) s.removed[m.r + ',' + m.c] = true;
        }
      }
      // 触发盒排到最前：chainGroupMembers 的顺序按扫描序，不保证 (r,c) 在首位。
      // 求解路线需要「触发盒 = chainIndex 0」这个语义（回放时按它调 pickBox）。
      for (var pi = 0; pi < picked.length; pi++) {
        if (picked[pi].r === r && picked[pi].c === c) {
          if (pi > 0) { var t = picked[0]; picked[0] = picked[pi]; picked[pi] = t; }
          break;
        }
      }
    } else {
      boxes.push(box);
      picked.push({ r: r, c: c, color: box.color, count: box.count });
      s.cells[r][c] = null; markPipeOpenedIfExit(s, r, c); if (s.removed) s.removed[r + ',' + c] = true;
    }

    advanceIce(s);            // 冰块解冻推进（所有已激活冰块 +1）
    checkPipeRelease(s);      // 管道释放
    updateActivation(s);      // 激活相邻（单调）

    // 消除进场：锁链整组同一 link 组一起进暂存（全消完才完成订单）
    s._enterPeak = null;      // 由 processChainGroup/processAntBox 在 autoRelease 之前填
    if (group && boxes.length > 1) processChainGroup(s, boxes);
    else processAntBox(s, boxes[0]);
    autoReleaseBuffer(s);

    // 本步观测快照（供求解器/回放记录，不影响任何判定）
    s.lastPick = {
      step: s.steps,
      boxes: picked.length,                                    // 这一步放进来几个盒（1/2/3）
      bufBefore: bufBefore,                                    // pick 之前的暂存占用
      bufEnter: (s._enterPeak != null) ? s._enterPeak : s.buffer.length,  // 整组入场后、结算前
      bufAfter: s.buffer.length,                               // 结算后
      isChain: !!(group && picked.length > 1),
      chain: chainId,
      picked: picked                                           // [{r,c,color,count}]，[0] 是触发盒
    };
    return true;
  }

  /**
   * 只做「取块机械」：移除盒(含锁链整组)、冰块推进、管道释放、激活相邻；
   * 【不做】瞬时消除/进暂存 —— 返回被取的球，交由玩家模拟器做并发消除。
   * @returns {{boxes:Array<{color,count}>, isChain:boolean}|null}
   */
  function pickBoxRaw(s, r, c) {
    if (!isPickable(s, r, c)) return null;
    var box = s.cells[r][c];
    var group = box.chain > 0 ? chainGroupMembers(s, r, c) : null;
    s.steps++;
    var boxes = [];
    if (group) {
      for (var i = 0; i < group.length; i++) {
        var m = group[i], b = s.cells[m.r][m.c];
        // v113：additively 带上坐标 r/c —— 玩家模拟要按盒记轨迹（锁链 2/3 连一步多盒），
        // 没有坐标就只能记触发盒。既有字段 color/count 原样保留，调用方不受影响。
        if (AntSolver.isBox(b)) { boxes.push({ r: m.r, c: m.c, color: b.color, count: b.count }); s.cells[m.r][m.c] = null; markPipeOpenedIfExit(s, m.r, m.c); if (s.removed) s.removed[m.r + ',' + m.c] = true; }
      }
      // 触发盒排到最前（chainGroupMembers 按扫描序返回，不保证 (r,c) 在首位）
      for (var pj = 0; pj < boxes.length; pj++) {
        if (boxes[pj].r === r && boxes[pj].c === c) {
          if (pj > 0) { var tb = boxes[0]; boxes[0] = boxes[pj]; boxes[pj] = tb; }
          break;
        }
      }
    } else {
      boxes.push({ r: r, c: c, color: box.color, count: box.count }); s.cells[r][c] = null; markPipeOpenedIfExit(s, r, c); if (s.removed) s.removed[r + ',' + c] = true;
    }
    advanceIce(s);
    checkPipeRelease(s);
    updateActivation(s);
    return { boxes: boxes, isChain: !!(group && boxes.length > 1) };
  }

  /**
   * 取棋盘上(r,c)的盒子（模拟器入口，带历史/胜负判定）。
   */
  function pickBox(r, c) {
    if (!state || state.gameOver) return false;
    if (r < 0 || r >= state.boardRows || c < 0 || c >= state.boardCols) return false;
    if (!isPickable(state, r, c)) return false;
    saveHistory();
    state.capture = true; state.capOps = [];   // 记录动画事件序列
    applyPick(state, r, c);
    state.capture = false;
    checkWinLose();
    return true;
  }

  /** 取最近一次取盒的动画事件序列（add/eat/done）。 */
  function getCapOps() { return state ? (state.capOps || []) : []; }

  function checkWinLose() {
    if (state.eliminatedPixels >= state.totalPixels) { state.gameWon = true; state.gameOver = true; return; }
    // 暂存区超过上限（含锁链整组入场瞬时超上限）→ 死亡。严格执行"暂存满且无法消除就死亡"。
    if (state.overflow || state.buffer.length > state.bufferLimit) { state.gameOver = true; state.gameWon = false; return; }
    // 死锁 → 死亡：没有任何"可推进"的取盒（blocked 已统一涵盖：普通盒满且消不完 / 锁链组空位不足）
    var moves = listMoves(state);
    var usable = false;
    for (var i = 0; i < moves.length; i++) {
      if (moves[i].blocked) continue;
      usable = true; break;
    }
    if (!usable) { state.gameOver = true; state.gameWon = false; }
  }

  // ==================== 可选动作 ====================
  /**
   * 所有可取的盒子（暴露 + 未锁）。move: {r, c, antBox, canConsume, blocked}
   */
  function getAvailableMoves() {
    if (!state || state.gameOver) return [];
    return listMoves(state);
  }

  function listMoves(s) {
    var moves = [];
    // 外部连通的已消除格(开口)对本 state 的所有盒相同 → 只算一次，供每个盒的 canConsume 复用。
    var open = computeExteriorOpen(s);
    for (var r = 0; r < s.boardRows; r++) {
      for (var c = 0; c < s.boardCols; c++) {
        if (!isPickable(s, r, c)) continue;
        var box = s.cells[r][c];
        var canConsume = canConsumeReach(s, box, open);
        // 锁链整组一次性进暂存：入场瞬间需要 groupSize 个空位（严格：暂存物理上不可超上限）
        // chain>0 但组不完整(孤立成员，chainGroups 只收≥2)→ chainGroupMembers 返回 null → 当普通盒(groupSize=1)防崩
        var _grp = (box.chain > 0) ? chainGroupMembers(s, r, c) : null;
        var groupSize = _grp ? _grp.length : 1;
        var blocked;
        if (groupSize > 1) {
          // 锁链组：暂存现有 + 组员数 超过上限 = 放不下 = 取则死亡 → 求解器须避开(视为阻塞)
          blocked = (s.buffer.length + groupSize > s.bufferLimit);
        } else {
          // 普通盒：暂存已满且此盒消不完(要占位) = 取则死亡 → 阻塞
          blocked = s.buffer.length >= s.bufferLimit && !canConsume;
        }
        moves.push({
          r: r, c: c, antBox: box,
          canConsume: canConsume, groupSize: groupSize,
          blocked: blocked
        });
      }
    }
    return moves;
  }

  // 计算"外部连通的已消除格"集合：从边界(bottomOnly 只底边)出发经【已消除格】4连通扩散。
  // 只有能通到外界的已消除空腔才算真正开口——图内被彩色像素封住的背景空洞(预消除)不提供可达性。
  // 该口径与 floodFillEliminate 的 accessKey 完全一致(已用 _canchk 全量比对 0 不一致)。
  var _EO_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  function computeExteriorOpen(s) {
    var rows = s.rows, cols = s.cols, elim = s.eliminated, bottomOnly = s.bottomOnly;
    var open = new Uint8Array(rows * cols), stack = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var isEdge = bottomOnly ? (r === rows - 1) : (r === 0 || r === rows - 1 || c === 0 || c === cols - 1);
      if (isEdge && elim[r][c]) { var id = r * cols + c; if (!open[id]) { open[id] = 1; stack.push(id); } }
    }
    while (stack.length) {
      var cur = stack.pop(), cr = (cur / cols) | 0, cc = cur % cols;
      for (var d = 0; d < 4; d++) {
        var nr = cr + _EO_DIRS[d][0], nc = cc + _EO_DIRS[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        var nid = nr * cols + nc;
        if (open[nid] || !elim[nr][nc]) continue;
        open[nid] = 1; stack.push(nid);
      }
    }
    return open;
  }

  // 盒能否被一次性消完(可达同色像素数 ≥ count)：从"边界/外部连通已消除格"旁的同色像素起，
  // 沿同色4连通扩散(消一格即打开同色邻居)计数，达到 count 即提前返回。等价于 floodFill 的布尔结论但无整图拷贝/无堆。
  function canConsumeReach(s, box, open) {
    var need = box.count; if (need <= 0) return true;
    var rows = s.rows, cols = s.cols, blocks = s.blocks, elim = s.eliminated, bottomOnly = s.bottomOnly, color = box.color;
    if (!open) open = computeExteriorOpen(s);
    var visited = new Uint8Array(rows * cols), stack = [], count = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (elim[r][c] || blocks[r][c] !== color) continue;
      var isEdge = bottomOnly ? (r === rows - 1) : (r === 0 || r === rows - 1 || c === 0 || c === cols - 1);
      var seed = isEdge
        || (r > 0 && open[(r - 1) * cols + c]) || (r < rows - 1 && open[(r + 1) * cols + c])
        || (c > 0 && open[r * cols + (c - 1)]) || (c < cols - 1 && open[r * cols + (c + 1)]);
      if (!seed) continue;
      var id = r * cols + c; if (visited[id]) continue;
      visited[id] = 1; stack.push(id);
    }
    while (stack.length) {
      var cur = stack.pop(); count++;
      if (count >= need) return true;
      var cr = (cur / cols) | 0, cc = cur % cols;
      for (var d = 0; d < 4; d++) {
        var nr = cr + _EO_DIRS[d][0], nc = cc + _EO_DIRS[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        var nid = nr * cols + nc;
        if (visited[nid] || elim[nr][nc] || blocks[nr][nc] !== color) continue;
        visited[nid] = 1; stack.push(nid);
      }
    }
    return count >= need;
  }
  // 兼容旧签名(外部/单盒调用)：自算 open。
  function canConsumeAntBox(s, antBox) { return canConsumeReach(s, antBox, null); }

  // ==================== 历史 / 撤销 ====================
  function saveHistory() {
    state.history.push({
      cells: cloneCells(state.cells),
      eliminated: AntSolver.deepClone(state.eliminated),
      buffer: AntSolver.deepClone(state.buffer),
      activated: AntSolver.deepClone(state.activated),
      frozen: AntSolver.deepClone(state.frozen),
      steps: state.steps,
      eliminatedPixels: state.eliminatedPixels,
      completedBoxes: state.completedBoxes,
      gameOver: state.gameOver,
      gameWon: state.gameWon,
      overflow: state.overflow
    });
    if (state.history.length > 200) state.history.shift();
  }

  function undo() {
    if (!state || state.history.length === 0) return false;
    var p = state.history.pop();
    state.cells = p.cells;
    state.eliminated = p.eliminated;
    state.buffer = p.buffer;
    state.activated = p.activated;
    state.frozen = p.frozen;
    state.steps = p.steps;
    state.eliminatedPixels = p.eliminatedPixels;
    state.completedBoxes = p.completedBoxes;
    state.gameOver = p.gameOver;
    state.gameWon = p.gameWon;
    state.overflow = p.overflow || false;
    return true;
  }

  function reset() { if (!state) return; var level = state.level; var opts = _enterOpts; exit(); enter(level, opts); }

  return {
    isActive: isActive, getState: getState, enter: enter, exit: exit, reset: reset,
    pickBox: pickBox, getAvailableMoves: getAvailableMoves, undo: undo,
    floodFillEliminate: floodFillEliminate, floodFillCount: floodFillCount,
    // 第三种玩法模式（四方向瞬时连锁消除）：新增并列口径，原两种模式的函数与行为未改
    instantChainEliminate: instantChainEliminate,
    instantChainCount: instantChainCount,
    elimDispatch: elimDispatch,
    elimOnMatrix: elimOnMatrix,
    getNextSlotStart: getNextSlotStart, previewNextEliminationOrder: previewNextEliminationOrder,
    computeReach: computeReach, isPickable: isPickable, isExposedAt: isExposedAt,
    createState: createState, processAntBox: processAntBox, autoReleaseBuffer: autoReleaseBuffer,
    canConsumeAntBox: canConsumeAntBox, canConsumeReach: canConsumeReach, computeExteriorOpen: computeExteriorOpen,
    executeAntBox: executeAntBox,
    applyPick: applyPick, updateActivation: updateActivation, isRevealed: isRevealed,
    checkPipeRelease: checkPipeRelease, listMoves: listMoves, cloneCells: cloneCells,
    getCapOps: getCapOps, pickBoxRaw: pickBoxRaw
  };
})();
