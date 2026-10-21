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
 * - 锁链(chain)：成对；配对端已激活时可取，取一端 → 两端同时消除进场。
 * - 问号(q)：软障碍，隐藏真实颜色；"激活"后揭示原有颜色（求解器全知，不影响可解性）。
 * - 管道(pipe)：分散在棋盘各处、四方向之一；视作黑块永久占格阻挡；出口格空出时释放下一个盒到出口；吐完不消失。
 *
 * 激活模型（毛线口径）：第0行(及与顶部空格连通处)初始激活；每次取盒 → 相邻格激活(单调，永不撤销)。
 *   盒可取 = 已激活 且 未被数字冰/链锁定。数字冰：按"取走几个盒"倒计时，减到 0 破碎（不再有老冰）。
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

  /**
   * 【v143】暂存区同色多车「争用同色像素」时的取用次序 —— 单一来源，三处共用（本文件的
   *   autoReleaseBuffer 与 settleStep、以及 playersim.js 的玩家模拟），避免留第二份规则副本。
   *
   * 用户 2026-10-15 定：「暂存区有两辆颜色为 A 的车，当目标区颜色 A 出来后，
   * 应该先进【容量少的】那个」。于是主判据由原来的"距离优先"改为【剩余容量优先】：
   *
   *   ① 剩余容量（还差几个球）升序 —— 先装满的先走、先腾出槽位。两辆刚进暂存时剩余=容量，
   *      就是字面上的"容量少的先"；已经装了一部分的按"还差多少"排，同样是"先装满先走"。
   *   ② 平手 → 离各自暂存起点的最近可达同色像素更近者先（原口径，降级为第一平手判据）。
   *   ③ 再平手 → 先进暂存的先（下标 / key），保证确定性。
   *
   * 瞬时连锁模式不走本函数：那边按用户 2026-08-03 的裁决严格【先进先得】。
   *
   * @param {Array} items 等价项数组，每项至少要有 need / progress
   * @param {function} distOf (item, index) => 距离；无起点信息时返回 Infinity 即可（该键自动失效）
   * @returns {Array<number>} items 的下标，按取用次序排列
   */
  function contendOrder(items, distOf) {
    var n = items.length, idx = [], rem = [];
    for (var i = 0; i < n; i++) {
      idx.push(i);
      var r = items[i].need - items[i].progress;
      rem[i] = r > 0 ? r : Infinity;      // 已装满的排最后（调用方本来也会跳过它们）
    }
    var d = [];
    for (var j = 0; j < n; j++) d[j] = (rem[j] === Infinity) ? Infinity : distOf(items[j], j);
    idx.sort(function (a, b) { return (rem[a] - rem[b]) || (d[a] - d[b]) || (a - b); });
    return idx;
  }

  // ---- 棋盘 cell 深拷贝 ----
  function cloneCell(cell) {
    if (cell == null) return null;
    // 【v138】数字冰字段必须跟着深拷贝走：漏掉它 = 克隆出来的棋盘没有数字冰（求解器/玩家模拟/撤销全都会瞎）
    if (cell.t === 'box') return { t: 'box', color: cell.color, count: cell.count, chain: cell.chain || 0, q: !!cell.q, numice: cell.numice || 0 };
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
      // 数字冰（唯一冰机制，老冰 v139 已下线）：'r,c' -> { remaining: 还剩几个球 }。
      //   语义（与实机一致）：**按球数**倒计时——玩家每取走一个球，该格 remaining 减 1；锁链一步拿 2 个球就一次减 2；
      //   减到 ≤0 即破碎（从本表移除），此后该格与普通盒一样，仍要满足暴露/可达才可取。
      numice: {},
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
    return s;
  }

  /**
   * 从棋盘 cell 初始化数字冰状态 + 锁链配对
   */
  function initBoardObstacles(s) {
    for (var r = 0; r < s.boardRows; r++) {
      for (var c = 0; c < s.boardCols; c++) {
        var cell = s.cells[r][c];
        // 数字冰：把作者预设的剩余球数记进运行态（破碎后就从本表删掉）
        if (AntSolver.isBox(cell) && cell.numice > 0) {
          s.numice[r + ',' + c] = { remaining: cell.numice };
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
   * 更新激活（单调）：所有当前"暴露"的盒 → 标记 activated。
   */
  function updateActivation(s) {
    var R = computeReach(s);
    for (var r = 0; r < s.boardRows; r++) {
      for (var c = 0; c < s.boardCols; c++) {
        if (!AntSolver.isBox(s.cells[r][c])) continue;
        if (isExposedAt(s, r, c, R)) {
          var k = r + ',' + c;
          s.activated[k] = true;
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
        }
      }
    }
  }

  /**
   * 【v138】数字冰：按**本步取走的球数**推进倒计时（实机口径）。
   *   锁链一步拿 2 个球 → 一次扣 2；拿满/超过剩余数即破碎（从运行态移除，此后按普通盒判定）。
   *   注意：数字冰是"全局球数"倒计时，与激活/暴露无关 —— 所以这里不看 activated。
   * @param {object} s 模拟态
   * @param {number} balls 本步取走的球数（= 离场的格子数，锁链整组一起算）
   */
  function advanceNumIce(s, balls) {
    if (!s.numice || !(balls > 0)) return;
    for (var k in s.numice) {
      var it = s.numice[k];
      if (!(it.remaining > 0)) continue;
      it.remaining -= balls;
      if (it.remaining <= 0) delete s.numice[k];   // 破碎：恢复成普通盒（仍要暴露才可取）
    }
  }

  /** 【v138】数字冰是否还在锁着该格（锁着 → 不可取）。 */
  function isNumIceLocked(s, r, c) {
    if (!s || !s.numice) return false;
    var it = s.numice[r + ',' + c];
    return !!(it && it.remaining > 0);
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

  /** 锁链锁定：组内【所有】其他成员都必须已激活且数字冰已破碎，才可连体取（否则锁定）。 */
  function isChainLocked(s, r, c) {
    var g = chainGroupMembers(s, r, c);
    if (!g) return false;
    for (var i = 0; i < g.length; i++) {
      var m = g[i];
      if (m.r === r && m.c === c) continue;
      if (!AntSolver.isBox(s.cells[m.r][m.c])) continue; // 已消除(整组同取，通常不会) → 忽略
      if (!s.activated[m.r + ',' + m.c]) return true;    // 有成员未激活 → 锁
      // 【v141 修复】组内只要有成员被【数字冰】锁着 → 整组不可点。
      //   这条判据原本是给老冰写的（`isIceLocked`），v139 删老冰时被一并删掉、却没补上数字冰的等价判断，
      //   于是"同组另一辆没冰的车"仍可被点，一点就把整组（含被锁那辆）连体取走 —— 与实机行为不符。
      //   注意不能只靠 isPickable 里那条自身判据：那条只挡"点被锁的那一辆"，挡不住"点它的邻居"。
      if (isNumIceLocked(s, m.r, m.c)) return true;      // 有成员被数字冰锁着 → 锁
    }
    return false;
  }

  /**
   * 盒子(r,c)当前是否可取（已激活 + 未被数字冰/链锁定）。
   */
  function isPickable(s, r, c) {
    if (!AntSolver.isBox(s.cells[r][c])) return false;
    if (!s.activated[r + ',' + c]) return false;
    if (isNumIceLocked(s, r, c)) return false;   // 数字冰未破碎 → 不可取
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

  // ===== 【2026-10-13 口径·动态】目标像素的“圈” = 图形当前的轮廓层 =====
  // 【2026-10-14】「圈」什么时候重算，做成三档可切换（网页右栏「选取层级」下拉）：
  //   'frozen' —— 一次取盒开始时算一遍，整盒都用这一份（旧行为；这一盒中途露出来的格子
  //               仍算里层、只能排在这一盒的最后）
  //   'layer'  —— 每取完一层（圈）就重算一遍“现在谁露出来了”，再从新的最外层继续
  //               （= 用户描述过的“扫一遍到顶还没满，就重新扫一遍，原来的方块就露出来了”）
  //   'pixel'  —— 每取走一个像素就重算一遍（= 玩家模拟 PlayerSim 一直在用的口径）
  var pickLayerMode = 'frozen';
  function setPickLayerMode(m) { pickLayerMode = (m === 'layer' || m === 'pixel') ? m : 'frozen'; }
  function getPickLayerMode() { return pickLayerMode; }

  // 用户原话：“先选没被遮挡住的……沿着外框走，能识别到的就是未被遮挡住的。”
  // 所以“圈”按【像素连通性】算，不按图片的几何边框算：
  //   第 0 圈 = 【此刻】就已经露出来的像素（贴着已经空掉的格子、或贴着图片边缘）；
  //   第 k 圈 = 要先吃掉第 k-1 圈才露出来的像素。
  // ⚠ 必须按【传入的当前 eliminated】现算 —— 早前用“开局状态”缓存一版，
  //   结果“已经露出来”的格子会被算成更深的圈、很晚才轮到（用户实测到的偏差）。
  var _ringScratch = null, _ringScratchN = 0;
  function ringMaskOf(eliminated, blocks, rows, cols, bottomOnly) {
    var N = rows * cols;
    if (!_ringScratch || _ringScratchN < N) { _ringScratch = new Int32Array(N); _ringScratchN = N; }
    var ring = _ringScratch; ring.fill(-1, 0, N);
    var dirs4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var q = [], i, d, r, c;
    // 第 0 圈：此刻未被遮挡的像素（贴边界，或四邻里已有“空”格）
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        if (blocks[r][c] <= 0 || eliminated[r][c]) continue;
        var ok = false;
        if (bottomOnly) { if (r === rows - 1) ok = true; }
        else if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) ok = true;
        if (!ok) {
          for (d = 0; d < 4; d++) {
            var nr = r + dirs4[d][0], nc = c + dirs4[d][1];
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) { ok = true; break; }
            if (eliminated[nr][nc]) { ok = true; break; }
          }
        }
        if (ok) { ring[r * cols + c] = 0; q.push(r * cols + c); }
      }
    }
    // 逐层向内
    for (i = 0; i < q.length; i++) {
      var id = q[i], cr = (id / cols) | 0, cc = id % cols, L = ring[id];
      for (d = 0; d < 4; d++) {
        var nr2 = cr + dirs4[d][0], nc2 = cc + dirs4[d][1];
        if (nr2 < 0 || nr2 >= rows || nc2 < 0 || nc2 >= cols) continue;
        if (blocks[nr2][nc2] <= 0 || eliminated[nr2][nc2]) continue;
        var id2 = nr2 * cols + nc2;
        if (ring[id2] >= 0) continue;
        ring[id2] = L + 1; q.push(id2);
      }
    }
    return ring;
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
    // 【每次调用按“当前”已消状态现算一遍圈号】—— 这是“动态外围”的关键：
    //   刚被吃出来的格子这一轮就属于第 0 圈，不会被算成更深、不会被无谓推迟。
    var _ring = ringMaskOf(eliminated, blocks, rows, cols, bottomOnly);
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
      // 【2026-10-13 口径·动态外圈】目标像素选取顺序：
      //   ① 圈号升序 —— 第 0 圈 = 此刻已经露出来的外框（贴已空格/贴图片边缘）；
      //      整圈走完（或走完还不够）才进下一圈。圈号每次调用按当前状态现算，见 _ring。
      //   ② 圈内【由下到上】—— 行号大的先，所以每圈都从它的“左下角”起步
      //   ③ 同行【由左到右】—— 列号小的先
      // 走到的格子颜色不符 / 此刻还没露出来 → 跳过，继续沿这圈走。
      // 旧的起点距离 / 入口源 / 依赖波深度不再参与排序（start/source/depth 保留仅作兼容）。
      var R = _ring[r * cols + c]; if (R < 0) R = 0;
      return R * (rows * cols + 1) + (rows - 1 - r) * cols + c;
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
    var perLayer = (pickLayerMode === 'layer'), perPixel = (pickLayerMode === 'pixel');
    var layer = -1, eatenSinceRefresh = false;
    // 按「现在」的状态重算一遍圈号，并把当前可达的同色格重新入堆（旧堆节点会因 key 不匹配被跳过）
    function refreshCandidates() {
      _ring = ringMaskOf(eliminated, blocks, rows, cols, bottomOnly);
      heap = []; bestKey = {}; bestSource = {}; bestDepth = {};
      for (var rr = 0; rr < rows; rr++) for (var cc = 0; cc < cols; cc++) {
        if (eliminated[rr][cc] || blocks[rr][cc] !== colorId) continue;
        if (!reachable(rr, cc)) continue;
        pushCandidate(rr, cc, 0, 0);
      }
    }
    while (count < maxCount && heap.length) {
      var top = _hpop(heap), r = top.r, c = top.c, topId = r * cols + c;
      if (eliminated[r][c] || bestKey[topId] !== top.k) continue; // 已消/已被更优依赖路径更新的旧节点
      // 'layer'：要进入下一层了 → 先按当前状态重算一遍，再从新的最外层继续
      if (perLayer) {
        var Rcur = _ring[topId]; if (Rcur < 0) Rcur = 0;
        if (Rcur > layer) {
          if (eatenSinceRefresh) { refreshCandidates(); layer = 0; eatenSinceRefresh = false; continue; }
          layer = Rcur;
        }
      }
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
      eatenSinceRefresh = true;
      if (perPixel && count < maxCount) refreshCandidates();   // 'pixel'：每取走一个就按当前状态重算
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
            // 【v138】管道吐出来的盒天然没有数字冰（与 initBoardObstacles 口径一致）
            s.cells[er][ec] = { t: 'box', color: ball.color, count: ball.count, ice: 0, chain: 0, q: false, numice: 0 };
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
    // 【v160·修正】"占满上限"本身**不判死**——用户 2026-10-16 明确规则是「满 5 **且一个都消不掉**」才是失败
    //   （满格但还能消 → 仍活着）。所以这里保持原口径：只有**超过**上限（真的要多占一格）才算溢出。
    //   "满格且消不掉"的死局由 `isDeadEnd()` + `checkWinLose()` 判（每次刷新都会结算）。
    if (s.buffer.length > s.bufferLimit) s.overflow = true;
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
    if (s.buffer.length > s.bufferLimit) s.overflow = true;    // 【v160·修正】同普通盒：超过上限才算溢出
    autoReleaseBuffer(s);
  }

  function autoReleaseBuffer(s) {
    var changed = true;
    while (changed) {
      changed = false;
      // 1) 推进每个暂存球的消除。取用次序见 contendOrder（v143：剩余容量少的先）。
      //    每球用自己的起点(slot 映射)取像素；求解器/生成：按暂存序、最底最左。
      var order = [];
      for (var i = 0; i < s.buffer.length; i++) order.push(i);
      // 瞬时连锁模式：严格【先进先得】（用户 2026-08-03 裁决 + 需求 §四）。
      // 暂存数组本身就是进入顺序，因此这里不做任何重排；前一个同色订单未完成且无可达同色时，
      // 后进入的同色订单也不会越过它抢像素——因为轮到它时可达同色集合已经为空。
      // 【v143】取用次序改由 contendOrder 统一给（剩余容量少的先 → 距离近的先 → 先进暂存的先）。
      //   原实现是"距离优先"；本次按用户裁决把主判据换成剩余容量，距离降为第一平手判据。
      if (s.instantChain) { /* 保持 buffer 原序 = 进入顺序 */ }
      else if (s.buffer.length > 1) {   // 单球无需排序，省去 peek 开销
        order = contendOrder(s.buffer, function (bi) {
          return (s.useSlotStart && bi.start) ? peekNearestDist(s, bi.color, bi.start) : Infinity;
        });
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
      // 2) 移除已完成的球 → 抽到 releaseCompletedBuffer（v121 时间驱动结算需要复用同一段逻辑）
      if (releaseCompletedBuffer(s)) changed = true;
    }
  }

  /**
   * 移除已完成的球：非锁链单独完成；锁链需整组都完成才一起离场。
   *
   * 【v121 抽取说明】这一段原先内联在 `autoReleaseBuffer` 的第 2 步里。
   * 时间驱动的手点结算（`settleStep`）**不能**调 `autoReleaseBuffer` —— 后者 `while(changed)`
   * 会把进度一路推到完成，正好抵消掉「每秒只出 5~8 只蚂蚁」的速率限制。
   * 但两者的「谁能离场」规则必须完全一致，所以抽出来共用，而不是复制第二份
   * （这个工程已经在「第二份算法副本」上栽过几次）。
   * **纯搬移，判据与副作用逐行未改**：等价性由十五套历史回归背书（它们全都密集走 autoReleaseBuffer）。
   * @returns {boolean} 是否有球离场（供 autoReleaseBuffer 的 changed 循环判定）
   */
  function releaseCompletedBuffer(s) {
    var any = false;
    {
      var removedGroup = false;
      for (var j = s.buffer.length - 1; j >= 0 && !removedGroup; j--) {
        var it = s.buffer[j];
        if (it.progress < it.need) continue;
        if (!it.link) {
          if (s.capture) s.capOps.push({ t: 'done', keys: [it.key] });
          s.resSum += (s.steps - (it.enterStep || 0)); s.resCount++;   // 滞留：入场→消除的步数
          s.buffer.splice(j, 1); s.completedBoxes++; recordCompletion(s); any = true;
        } else {
          var idxs = [], groupDone = true, gkeys = [];
          for (var k = 0; k < s.buffer.length; k++) {
            if (s.buffer[k].link === it.link) { idxs.push(k); gkeys.push(s.buffer[k].key); if (s.buffer[k].progress < s.buffer[k].need) groupDone = false; }
          }
          if (groupDone) {
            if (s.capture) s.capOps.push({ t: 'done', keys: gkeys });
            idxs.sort(function(x, y) { return y - x; });
            for (var gi = 0; gi < idxs.length; gi++) { var gb = s.buffer[idxs[gi]]; s.resSum += (s.steps - (gb.enterStep || 0)); s.resCount++; s.buffer.splice(idxs[gi], 1); s.completedBoxes++; recordCompletion(s); }
            any = true; removedGroup = true;
          }
          // 组未全完成 → 该球(即使已消完)留在暂存等待伙伴
        }
      }
    }
    return any;
  }

  // ==================== v121 · 手点模拟的时间驱动并发结算 ====================
  // 任务 ANT-SIM-LIVE-CONCURRENT-20260828。用户给的真机规则：
  //   「每个盒都要出蚂蚁，大概 1s 出 5-8 个蚂蚁（消除 5-8 像素），在这个出蚂蚁的周期内玩家就会接着放盒」
  // 即**每盒固定速率、多盒并行**。这与 playersim 的 tick 模型同构，与本文件既有的
  // `applyPick`（一次取盒就 autoReleaseBuffer 推到底）不同。
  //
  // 下面三个函数是**纯新增**，只服务手点交互路径：
  //   pickCapacityOf  容量门（时间驱动下每盒必占槽）
  //   pickBoxLive     只入场、不消除
  //   settleStep      按速率推进一次结算
  // `applyPick` / `autoReleaseBuffer` / `listMoves` 的既有口径**一行未改** ——
  // 全知求解器与回放继续走它们（求解器的 pickOrder 是在串行模型下算的，
  // 用并发模型回放会偏离甚至溢出死）。

  /**
   * 取盒容量门：这一步取下去放不放得下。
   *
   * 与 `listMoves` 的 `blocked` **口径不同，是有意的**：
   *   listMoves（服务求解器，瞬时结算模型）：普通盒 `buffer满 && !canConsume` 才算阻塞
   *     —— 即「能一次消完的盒」在暂存满时也允许取，因为它瞬间就消完了、不占槽。
   *   本函数（服务手点，时间驱动模型）：**每盒都要占一个槽 count/rate 秒**，
   *     所以没有 canConsume 豁免，空位不够就是不够。
   * 这正是用户说的「6/5 作弊」的根源：那条豁免让 5/5 满暂存下能无限取「一次能消完」的盒。
   *
   * @returns {{ok:boolean, reason?:string, need:number, free:number}}
   */
  function pickCapacityOf(s, r, c) {
    if (!s || s.gameOver) return { ok: false, reason: 'over', need: 0, free: 0 };
    if (r < 0 || r >= s.boardRows || c < 0 || c >= s.boardCols) return { ok: false, reason: 'oob', need: 0, free: 0 };
    if (!isPickable(s, r, c)) return { ok: false, reason: 'locked', need: 0, free: 0 };
    var box = s.cells[r][c];
    var grp = (box.chain > 0) ? chainGroupMembers(s, r, c) : null;
    var need = grp ? grp.length : 1;
    var free = s.bufferLimit - s.buffer.length;
    if (free < 0) free = 0;
    if (free < need) {
      return { ok: false, reason: need > 1 ? 'noSlotChain' : 'noSlot', need: need, free: free };
    }
    return { ok: true, need: need, free: free };
  }

  /**
   * 手点取盒（时间驱动路径）：**只把盒放进暂存，不做任何消除**。
   * 消除交给 `settleStep` 按真机速率推进。
   *
   * 与 `pickBox`（既有串行入口）的区别：
   *   pickBox：取盒 → 立刻消除到底 → autoReleaseBuffer → 判死。放不下的盒也放得进去（先超限再判死）。
   *   pickBoxLive：**放不下就拒绝，棋盘一格不动**（真机就是点不动）；放得下则入场占槽、等待出蚂蚁。
   *
   * @returns {{ok:boolean, reason?:string, need?:number, free?:number, added?:Array, link?:number}}
   */
  function pickBoxLive(r, c) {
    if (!state) return { ok: false, reason: 'nostate' };
    var cap = pickCapacityOf(state, r, c);
    if (!cap.ok) return cap;                       // ← 拒绝：不移除棋盘盒、不入暂存、不结算、不判死
    saveHistory();
    state.capture = false;                         // 时间驱动路径不用 capOps 补播动画（直接渲染逻辑态）
    var raw = pickBoxRaw(state, r, c);             // 只做取盒机械：移盒 + 冰推进 + 管道释放 + 激活相邻
    if (!raw) return { ok: false, reason: 'locked', need: cap.need, free: cap.free };
    var link = raw.isChain ? (++state._linkSeq) : 0;
    var added = [];
    for (var i = 0; i < raw.boxes.length; i++) {
      var b = raw.boxes[i];
      var slot = leftmostFreeSlot(state);
      var start = (slot != null) ? slotStartCoord(slot, state.rows, state.cols, state.bufferLimit) : null;
      var item = {
        color: b.color, need: b.count, progress: 0, remaining: b.count,
        key: (++state._keySeq), slot: slot, start: start, link: link,
        enterStep: state.steps,
        acc: 0                                     // 出蚂蚁的小数累计（速率 < 1 像素/帧，必须累计）
      };
      state.buffer.push(item);
      added.push(item);
    }
    state._enterPeak = state.buffer.length;
    // 容量门已保证不会超上限；这里只做防御性断言，真触发说明门漏了（不静默）
    if (state.buffer.length > state.bufferLimit) state.overflow = true;    // 【v160·修正】同上
    return { ok: true, added: added, isChain: !!raw.isChain, link: link, need: cap.need };
  }

  /**
   * 按真机速率推进一次结算。
   *
   * @param {number} dtMs       距上次推进的**真实**毫秒数（调用方用时间戳算，不要假设帧间隔 ——
   *                            setInterval 会漂移，后台标签页还会被浏览器节流到 1s）
   * @param {number} ratePerSec 每个盒每秒出几只蚂蚁（= 消几个像素）。真机 5~8
   * @returns {{eaten:number, released:number, over:boolean}}
   *
   * 争抢次序沿用 `autoReleaseBuffer` 的既有口径，不另立一套：
   *   瞬时连锁 → 严格先进先得（buffer 原序）；其余 → 【剩余容量少的先】（contendOrder，v143 改）。
   */
  function settleStep(dtMs, ratePerSec) {
    if (!state || state.gameOver) return { eaten: 0, released: 0, over: true };
    var s = state;
    var rate = (ratePerSec > 0) ? ratePerSec : 6.5;
    var dt = (dtMs > 0) ? dtMs : 0;
    if (dt > 1000) dt = 1000;                      // 卡帧/切后台回来时不要一次补一大段（会瞬间消掉一片）
    var eaten = 0;

    // 每盒各自累计「应出蚂蚁数」，取整数部分作为本次的像素预算。
    // 必须用小数累计：6.5 像素/秒 在 40ms 帧上是 0.26 像素/帧，取整会永远是 0。
    var budget = {};
    for (var i = 0; i < s.buffer.length; i++) {
      var it = s.buffer[i];
      if (it.acc == null) it.acc = 0;
      if (it.progress >= it.need) { budget[it.key] = 0; continue; }
      it.acc += rate * dt / 1000;
      var q = Math.floor(it.acc);
      if (q > 0) it.acc -= q;
      budget[it.key] = q;
    }

    // 与 autoReleaseBuffer 同一排序口径
    var order = [];
    for (var oi = 0; oi < s.buffer.length; oi++) order.push(oi);
    // 【v143】与 autoReleaseBuffer 同一口径（contendOrder，单一来源）：剩余容量少的先。
    if (s.instantChain) { /* 先进先得：保持 buffer 原序 */ }
    else if (s.buffer.length > 1) {
      order = contendOrder(s.buffer, function (bi) {
        return (s.useSlotStart && bi.start) ? peekNearestDist(s, bi.color, bi.start) : Infinity;
      });
    }

    // 逐盒吃掉本次预算。**一次只吃 1 像素再轮到下一盒** → 多盒交替推进，
    // 像素争抢关系与真机的并行同序（若一次吃满预算，先手盒会把争用像素全抢走）。
    var progressed = true;
    while (progressed) {
      progressed = false;
      for (var od = 0; od < order.length; od++) {
        var item = s.buffer[order[od]];
        if (!item) continue;
        if (!(budget[item.key] > 0)) continue;
        if (item.progress >= item.need) { budget[item.key] = 0; continue; }
        var got = elimDispatch(s, item.color, 1, null, item.start || null, null);
        if (got > 0) {
          item.progress += got; s.eliminatedPixels += got; eaten += got;
          budget[item.key] -= got; progressed = true;
        } else {
          budget[item.key] = 0;                    // 该盒当前无可达同色像素 → 本次不再尝试（滞留）
        }
      }
    }

    var before = s.buffer.length;
    releaseCompletedBuffer(s);                     // 离场规则与 autoReleaseBuffer 共用同一段
    var released = before - s.buffer.length;
    checkWinLose();
    return { eaten: eaten, released: released, over: !!s.gameOver };
  }

  /**
   * 在给定 state 上执行一次取盒（供模拟器与求解器共用）。毛线口径顺序：
   * 取盒(+锁链同取) → 数字冰倒计时推进 → 管道释放 → 激活相邻 → 消除进场 → 释放暂存。
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

    advanceNumIce(s, picked.length);   // 【v138】数字冰按本步球数倒计时（锁链一步 2/3 个盒就扣 2/3）
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
   * 只做「取块机械」：移除盒(含锁链整组)、数字冰推进、管道释放、激活相邻；
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
    advanceNumIce(s, boxes.length);   // 【v138】数字冰按本步球数倒计时（玩家模拟走这条路径）
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
    // 【v160·修正】这里**不再**拦截"满格时点一个消不掉的盒"：
    //   用户 2026-10-16 明确的规则是「**满 5 且一个都消不掉**才算失败」（满格本身不是死）。
    //   所以点这种盒仍走原路径（真取入 → 暂存变 6 → 溢出 → 判死），与"取则死亡"的 blocked 语义一致；
    //   而"满格且全都消不掉"这种**不需要任何点击就已经死**的局面，由 isDeadEnd()/checkWinLose() 负责立刻结算。
    //   注：整段只影响手点/演示入口，**求解器走的 `applyPick` 一行不动** → 求解、审核、产能不变。
    saveHistory();
    state.capture = true; state.capOps = [];   // 记录动画事件序列
    applyPick(state, r, c);
    state.capture = false;
    checkWinLose();
    return true;
  }

  /**
   * 【v160】死局判定：**没有任何"非阻塞"的取盒**（满格且消不掉 / 只剩放不下的锁链组）。
   *   为什么单独导出：手点游玩时，死局可能"一个取盒动作都没有"就存在（玩家把最后一格垫满后
   *   盘面全被冰/链锁住）——如果只在 `pickBox` 之后判一次，就会出现"已经死了却不弹失败窗"。
   *   页面在每次模拟态刷新时调它，保证死局立刻结算。纯读，不改状态。
   */
  function isDeadEnd(s) {
    if (!s || s.gameOver) return false;
    if (s.overflow) return true;
    if (s.buffer.length > s.bufferLimit) return true;
    var moves = listMoves(s);
    for (var i = 0; i < moves.length; i++) if (!moves[i].blocked) return false;
    return true;
  }

  /** 取最近一次取盒的动画事件序列（add/eat/done）。 */
  function getCapOps() { return state ? (state.capOps || []) : []; }

  function checkWinLose() {
    if (state.eliminatedPixels >= state.totalPixels) { state.gameWon = true; state.gameOver = true; return; }
    // 暂存区超过上限（含锁链整组入场瞬时超上限）→ 死亡。严格执行"暂存满且无法消除就死亡"。
    // 溢出判据 = **超过**上限（要真的多占一格）。"满格且一个都消不掉"由 isDeadEnd 判（见下）。
    if (state.overflow || state.buffer.length > state.bufferLimit) { state.gameOver = true; state.gameWon = false; return; }
    // 【v160】"满格且一个都消不掉" = 死局（用户 2026-10-16 的规则）：由下面的 isDeadEnd 判定统一处理
    // 死局 → 死亡：**满格且一个都消不掉**（或盘面已无可取盒 / 只剩放不下的锁链组）。
    //   用户 2026-10-16 定的规则；判据统一收在 isDeadEnd()，页面每次刷新也会调它 → 死局立刻结算、不再"点了才有反应"。
    if (isDeadEnd(state)) { state.gameOver = true; state.gameWon = false; state.deadEnd = true; }
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
      numice: AntSolver.deepClone(state.numice),   // 数字冰倒计时要能回退
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
    state.numice = p.numice;
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
    isDeadEnd: isDeadEnd,   // 【v160】死局判定（满格且消不掉 / 无可取盒）——页面每次模拟态刷新时结算失败
    floodFillEliminate: floodFillEliminate, floodFillCount: floodFillCount,
    ringMaskOf: ringMaskOf,          // 「圈」的定义（按图形轮廓分层）——供玩家模拟等复用，避免第二份副本口径漂移
    setPickLayerMode: setPickLayerMode,   // 「圈」多久重算一次：'frozen' | 'layer' | 'pixel'
    getPickLayerMode: getPickLayerMode,
    // 第三种玩法模式（四方向瞬时连锁消除）：新增并列口径，原两种模式的函数与行为未改
    instantChainEliminate: instantChainEliminate,
    instantChainCount: instantChainCount,
    elimDispatch: elimDispatch,
    elimOnMatrix: elimOnMatrix,
    // 数字冰：按球数倒计时 / 是否锁着（供单测与外部按球数推进使用）
    advanceNumIce: advanceNumIce,
    isNumIceLocked: isNumIceLocked,
    // 【v141】锁链组是否被「组内某成员的数字冰」锁着 —— 供界面把"同组陪锁"的格子也灰显
    //   （否则它看着正常、点下去却毫无反应，正是本工程一直想避免的那种手感问题）。
    isChainLocked: isChainLocked,
    // 【v143】暂存区同色多车争用次序（剩余容量少的先）—— 供 playersim 复用，避免第二份规则副本
    contendOrder: contendOrder,
    getNextSlotStart: getNextSlotStart, previewNextEliminationOrder: previewNextEliminationOrder,
    computeReach: computeReach, isPickable: isPickable, isExposedAt: isExposedAt,
    createState: createState, processAntBox: processAntBox, autoReleaseBuffer: autoReleaseBuffer,
    canConsumeAntBox: canConsumeAntBox, canConsumeReach: canConsumeReach, computeExteriorOpen: computeExteriorOpen,
    executeAntBox: executeAntBox,
    applyPick: applyPick, updateActivation: updateActivation, isRevealed: isRevealed,
    checkPipeRelease: checkPipeRelease, listMoves: listMoves, cloneCells: cloneCells,
    getCapOps: getCapOps, pickBoxRaw: pickBoxRaw,
    // v121 手点时间驱动路径（纯新增；applyPick/autoReleaseBuffer/listMoves 口径未改）
    pickCapacityOf: pickCapacityOf, pickBoxLive: pickBoxLive, settleStep: settleStep,
    releaseCompletedBuffer: releaseCompletedBuffer
  };
})();
