/**
 * 蚂蚁拿块 - 玩家模拟器（并发实时消除，有限信息玩家）
 *
 * 与全知求解器(Solver)的本质差异：
 *  - 全知求解器：瞬时、串行、已知问号色/管道序，算理论解。
 *  - 玩家模拟器：并发按 tick 逐像素消除；玩家不等动画结束(进度≥60%且非高压就取下一个)；
 *    决策只依据"当前半消画面 + 已揭示色 + 已激活球"的乐观估计 → 会误判 → 更真实的难度。
 *
 * 起点规则：暂存槽 i(0..limit-1) → 目标图 (row0, col=floor(i/limit*cols))；
 *   起点【固定】为暂存槽映射位置(不随消除移动)；每次取"离该固定起点最短距离(曼哈顿)"的可达同色像素。
 *   同色多球共享像素池，按【剩余容量少的先】取用（v143；规则本体在 Simulator.contendOrder）。
 *   异色并发，仅通过可达性耦合。可达性用【局部增量刷新】：消一个像素只通知其4邻居。
 */
var AntSolver = AntSolver || {};

AntSolver.PlayerSim = (function () {
  var Sim = AntSolver.Simulator;

  /* ── 性能埋点(阶段1，只计数不改行为) ──
   * 统计玩家模拟被跑了多少次、累计多少毫秒，供生产性能报告拆分"慢在求解还是玩家模拟"。
   * 纯累加，不参与任何玩家决策/通关/复活判定。
   */
  var PERF = { runs: 0, ms: 0 };
  function resetPerf() { PERF = { runs: 0, ms: 0 }; }
  function getPerf() { return { runs: PERF.runs, ms: PERF.ms }; }

  /**
   * 暂存槽 slot(0-indexed) 的蚂蚁起点：蚂蚁从【底部】进入(游戏行0=数组底 r=rows-1)，
   * 起点行=最底行(rows-1)，列=按槽位比例映射。slot0 = 左下角。
   */
  function slotStart(slot, rows, cols, bufferLimit) {
    var col = Math.floor((slot / Math.max(1, bufferLimit)) * cols);
    if (col > cols - 1) col = cols - 1;
    if (col < 0) col = 0;
    return { r: rows - 1, c: col };
  }

  /**
   * 运行一局玩家模拟。
   * @param {object} level 解析后的关卡
   * @param {object} opts { pickThreshold=0.6, seed, capture, bottomOnly }
   *   opts.bottomOnly：目标图消除入口模式。false/缺省=四边入口(默认，行为与本参数引入前一致)；
   *     true=仅底部入口(上/左/右封闭)。必须与同一关的求解器 solve({bottomOnly}) 取同一值，
   *     否则会出现"全知按底部入口、玩家按四边入口"的口径分裂，审核与难度结论不可用。
   * @returns {object} { won, ticks, picks, misjudge, bufferPeak, bufferTimeline, eliminatedPixels, totalPixels, progress }
   */
  function run(level, opts) {
    opts = opts || {};
    var pickThreshold = opts.pickThreshold != null ? opts.pickThreshold : 0.6;
    var capture = !!opts.capture;             // 记录逐 tick 帧供前端并发回放
    var capturePreviewStats = !!opts.capturePreviewStats; // 图表/调试才采集下一槽位可消/封锁快照
    var bottomOnly = !!opts.bottomOnly;       // 仅底部入口(见上)；透传给 Simulator 并用于本文件自有可达判定
    // 第三种玩法模式：四方向瞬时连锁消除（需求 08.03，用户 2026-08-03 批准改玩家模拟）。
    // 与 bottomOnly 互斥，固定四方向可达；开启后玩家侧的消除结算改为：
    //   选盒 → 在【同一次结算】里按【严格先进先得】把暂存订单逐个推到底（每个订单内部走快照批次连锁）
    //   → 而不是原来的「每 tick 每球各吃 1 像素、球之间按距离抢」。
    var instantChain = !!opts.instantChain;
    if (instantChain) bottomOnly = false;
    var frames = capture ? [] : null;
    var curFrame = null;
    // 玩家自有并发取球，但给状态声明同一槽位起点口径，供 previewNextEliminationOrder 按玩家真实空槽排序。
    // bottomOnly 一并传入：createState 据此播种初始已消空格，Simulator 侧所有消除/预览/暂存释放同口径。
    var s = Sim.createState(level, { useSlotStart: true, bottomOnly: bottomOnly, instantChain: instantChain });
    var rows = s.rows, cols = s.cols, blocks = s.blocks, elim = s.eliminated;
    var bufferLimit = s.bufferLimit;
    var totalPixels = s.totalPixels;

    var rngState = (opts.seed || 12345) >>> 0;
    function rng() { rngState = (rngState * 1664525 + 1013904223) & 0xffffffff; return (rngState >>> 0) / 4294967296; }

    // ---- 每色可达同色像素集合（局部增量维护）----
    var reachSet = {}; // color -> { key(r*cols+c): true }
    // 【2026-10-13】「圈」表由 Simulator 统一提供（按【当前】已消状态现算，动态）。
    // 可达判定：本文件为性能自维护一份增量可达集，不走 Simulator.floodFillEliminate 的闭合逻辑，
    // 因此入口模式必须在此同步——否则玩家侧会把上/左/右边界像素当成可达，与全知求解器口径分裂。
    // 默认(四边)：任一边界即可达；bottomOnly：只有底边(r=rows-1)是外部入口，上/左/右视作墙。
    // 两种模式都保留"邻接已消除格即可达"(空腔被打通后继续向内蔓延)，与 Simulator.reachable() 一致。
    function isReach(r, c) {
      if (bottomOnly) {
        if (r === rows - 1) return true;
      } else if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        return true;
      }
      if (r > 0 && elim[r - 1][c]) return true;
      if (r < rows - 1 && elim[r + 1][c]) return true;
      if (c > 0 && elim[r][c - 1]) return true;
      if (c < cols - 1 && elim[r][c + 1]) return true;
      return false;
    }
    function tryAddReach(r, c) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return;
      if (elim[r][c]) return;
      var col = blocks[r][c];
      if (col <= 0) return;
      if (!isReach(r, c)) return;
      (reachSet[col] = reachSet[col] || {})[r * cols + c] = true;
    }
    function seedReach() {
      reachSet = {};
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        if (!elim[r][c] && blocks[r][c] > 0 && isReach(r, c)) (reachSet[blocks[r][c]] = reachSet[blocks[r][c]] || {})[r * cols + c] = true;
      }
    }
    seedReach();

    // 吃掉离(ar,ac)最近的可达同色像素；返回 {r,c} 或 null
    function eatNearest(color, ar, ac) {
      var set = reachSet[color];
      if (!set) return null;
      // 【2026-10-13 口径统一】不再用“离盒起点最近优先”，改为与全知求解器同一套：
      //   圈号(按图形轮廓分层) → 由下到上 → 由左到右。
      //   之所以必须共用：这个文件原先自带一份自己的排序（第二份实现），导致
      //   「手点/玩家版看到的顺序」与「全知/单步看到的顺序」不一致。
      // 每次选点都按【当前】已消状态重算圈号（动态外围），与全知求解器完全同一套
      var ring = (Sim.ringMaskOf ? Sim.ringMaskOf(elim, blocks, rows, cols, bottomOnly) : null);
      if (!ring) ring = new Int32Array(rows * cols);
      var bestKey = -1, bestRank = Infinity, bestR = 0, bestC = 0;
      for (var k in set) {
        var kk = +k, r = (kk / cols) | 0, c = kk % cols;
        if (elim[r][c]) { delete set[k]; continue; }       // 已被吃(异色刷新导致)——清理
        if (!isReach(r, c)) { continue; }                   // 仍不可达(理论上在集合里都可达)
        var rk = ring[kk]; if (rk == null || rk < 0) rk = 0;
        var rank = rk * (rows * cols + 1) + (rows - 1 - r) * cols + c;
        if (rank < bestRank) { bestRank = rank; bestKey = kk; bestR = r; bestC = c; }
      }
      if (bestKey < 0) return null;
      elim[bestR][bestC] = true; delete set[bestKey]; s.eliminatedPixels++;
      // 局部刷新：只通知4邻居(任意色可能变可达)
      tryAddReach(bestR - 1, bestC); tryAddReach(bestR + 1, bestC);
      tryAddReach(bestR, bestC - 1); tryAddReach(bestR, bestC + 1);
      return { r: bestR, c: bestC, dist: bestRank };
    }
    // 仅探测离(ar,ac)最近可达同色像素的距离(不移除)，用于"距离优先"排序；无则 Infinity
    function peekNearestDist(color, ar, ac) {
      var set = reachSet[color]; if (!set) return Infinity;
      var bestD = Infinity;
      for (var k in set) {
        var kk = +k, r = (kk / cols) | 0, c = kk % cols;
        if (elim[r][c]) continue;
        var d = Math.abs(r - ar) + Math.abs(c - ac);
        if (d < bestD) bestD = d;
      }
      return bestD;
    }
    function colorHasReach(color) { var set = reachSet[color]; if (!set) return false; for (var k in set) return true; return false; }

    // ---- 暂存(并发) ----
    var balls = [];          // {color,need,progress,slot,ar,ac,link,key}
    var slotUsed = [];       // slot -> ball or null
    for (var i = 0; i < bufferLimit; i++) slotUsed.push(null);
    function freeSlotCount() { var n = 0; for (var i = 0; i < bufferLimit; i++) if (!slotUsed[i]) n++; return n; }
    function leftmostFreeSlot() { for (var i = 0; i < bufferLimit; i++) if (!slotUsed[i]) return i; return -1; }

    var keySeq = 0, linkSeq = 0;

    // 外部连通空腔(open)只随"已消除格集合"变化，而每次消除都会 +eliminatedPixels →
    // 用它做版本键缓存 open：同一 tick 内(选球阶段未消除)多次 optimisticConsumable 复用同一 open。
    var _openCache = null, _openVer = -1;
    function currentOpen() {
      if (_openVer !== s.eliminatedPixels) { _openCache = Sim.computeExteriorOpen(s); _openVer = s.eliminatedPixels; }
      return _openCache;
    }
    // 玩家"乐观估计"：当前半消画面下，该色可达同色像素数是否≥need。
    // 用 Sim.canConsumeReach(可达同色计数，达 need 即止) 取代旧的整图拷贝+floodFill(Infinity)——布尔结论完全等价、更快。
    function optimisticConsumable(color, need) {
      var set = reachSet[color]; if (!set) return need <= 0;
      return Sim.canConsumeReach(s, { color: color, count: need }, currentOpen());
    }

    // ---- 玩家取球决策(有限信息、乐观、贪心；探索窄路/清可达区/问号试探) ----
    function choosePlayerPick() {
      var moves = Sim.listMoves(s);
      if (!moves.length) { s.lastRefuse = { reason: 'noMoves', free: freeSlotCount() }; return null; }
      var highPressure = balls.length >= bufferLimit - 1;
      var best = null, bestScore = -Infinity, _blk = null;
      for (var mi = 0; mi < moves.length; mi++) {
        var mv = moves[mi];
        if (mv.blocked) {   // 暂存放不下(普通盒满且消不完 / 锁链组空位不足) → 玩家不取(严格避免超暂存)
          if (!_blk || (mv.groupSize || 1) > (_blk.groupSize || 1)) _blk = mv;   // 【v323】留一份"最想点但放不下"的
          continue;
        }
        var cell = s.cells[mv.r][mv.c];
        var isQ = cell.q && !Sim.isRevealed(s, mv.r, mv.c);   // 玩家看不到色的问号
        var score = 0, consumable;
        if (isQ) {
          // 试探性：低分但可取(问号只临时挡路)；高压时更谨慎
          score = highPressure ? -30 : 4;
          consumable = false;
        } else {
          var need = cell.count;
          consumable = optimisticConsumable(cell.color, need); // 玩家乐观估计(可能错)
          score += consumable ? 30 : -12;
          // 与暂存同色可连锁 → 略偏好
          for (var bi = 0; bi < balls.length; bi++) if (balls[bi].color === cell.color) { score += 6; break; }
          // 清理可达区：靠上(先暴露)略优先
          score -= mv.r * 0.05;
        }
        if (highPressure && !consumable) score -= 40;          // 高压不接不可消的球
        if (score > bestScore) { bestScore = score; best = mv; }
      }
      // 高压且最佳仍是"不可消" → 宁可不取(等消)
      if (best) {
        var bc = s.cells[best.r][best.c];
        var bIsQ = bc.q && !Sim.isRevealed(s, best.r, best.c);
        if (balls.length >= bufferLimit - 1 && !bIsQ && !optimisticConsumable(bc.color, bc.count)) {
          // 【v323·死亡归因】"高压且不可消"→ 宁可不取，这就是卡死前最后一次拒绝
          s.lastRefuse = { reason: 'highPressure', r: best.r, c: best.c, need: best.groupSize || 1, free: freeSlotCount(), color: bc.color, chain: bc.chain || 0 };
          return null;
        }
      }
      if (!best && _blk) {
        var _bcb = s.cells[_blk.r][_blk.c];
        s.lastRefuse = { reason: 'blocked', r: _blk.r, c: _blk.c, need: _blk.groupSize || 1, free: freeSlotCount(), color: _bcb ? _bcb.color : null, chain: _bcb ? (_bcb.chain || 0) : 0 };
      }
      return best;
    }

    function doPick(mv) {
      // 严格：锁链整组需 groupSize 个空位一次性入场；不足则超暂存 → 死亡(在移除棋盘盒之前判定，避免丢盒)
      var need = mv.groupSize || 1;
      if (freeSlotCount() < need) {
        s.overflow = true;
        // 【v323·死亡归因】记下"卡在哪一格、差几个槽、是不是锁链组"。
        //   以前只置一个 overflow 标记，事后只能知道"死了"，不知道死在谁手上。
        var _bc0 = s.cells[mv.r] && s.cells[mv.r][mv.c];
        s.lastBlocked = {
          step: picks, r: mv.r, c: mv.c, need: need, free: freeSlotCount(),
          color: _bc0 ? _bc0.color : null, chain: _bc0 ? (_bc0.chain || 0) : 0,
          isChainGroup: need > 1, cellType: _bc0 ? (AntSolver.isBox(_bc0) ? 'box' : (_bc0.t || '?')) : '?'
        };
        return false;
      }   // 放不下→放弃本次取(不直接判死)；卡住则走死锁复活
      var beforeBoxes = null, bR = s.boardRows, bC = s.boardCols;
      if (capture) { beforeBoxes = {}; for (var br = 0; br < bR; br++) for (var bc = 0; bc < bC; bc++) if (AntSolver.isBox(s.cells[br][bc])) beforeBoxes[br + ',' + bc] = true; }
      var bufBeforePick = balls.length;    // v113：取盒前的槽占用（只读观测）
      var raw = Sim.pickBoxRaw(s, mv.r, mv.c);
      if (!raw) return false;
      var link = raw.isChain ? (++linkSeq) : 0;
      var thoughtConsumable = null;
      var pickedDetail = [];               // v113：本步逐盒明细，[0] 是触发盒（pickBoxRaw 已排序）
      for (var i = 0; i < raw.boxes.length; i++) {
        var b = raw.boxes[i];
        pickedDetail.push({ r: b.r, c: b.c, color: b.color, count: b.count });
        var slot = leftmostFreeSlot();
        if (slot < 0) break; // 无空槽(不应发生，取前已判断)
        var st = slotStart(slot, rows, cols, bufferLimit);
        // enterTick（需求 §4.2）：该盒进入暂存区的玩家操作 tick。滞留步数 = 离场 tick − enterTick。
        // 取盒发生在本 tick 的开头，此时 ticks 已是本 tick 的序号，故直接用 ticks。
        var ball = { color: b.color, need: b.count, progress: 0, slot: slot, ar: st.r, ac: st.c, link: link, key: (++keySeq), enterTick: curOpTick, thought: optimisticConsumable(b.color, b.count) };
        slotUsed[slot] = ball; balls.push(ball);
        if (curFrame) curFrame.picks.push({ key: ball.key, slot: slot, color: b.color, need: b.count, sr: st.r, sc: st.c, link: link });
      }
      // 棋盘变化(供前端棋盘动画)：移除的盒 + 管道新吐出的盒
      if (capture && beforeBoxes) {
        var removed = [], added = [];
        for (var dr = 0; dr < bR; dr++) for (var dc = 0; dc < bC; dc++) {
          var key = dr + ',' + dc, isB = AntSolver.isBox(s.cells[dr][dc]);
          if (beforeBoxes[key] && !isB) removed.push({ r: dr, c: dc });
          else if (!beforeBoxes[key] && isB) { var cc = s.cells[dr][dc]; added.push({ r: dr, c: dc, color: cc.color, count: cc.count }); }
        }
        curFrame.board = { removed: removed, added: added };
      }
      // v113 只读观测：本步逐盒明细 + 暂存入场态。此处 balls.length 已含本步全部入场盒、
      // 且【消除阶段尚未开始】，所以就是「整组入场后、结算前」的占用（锁链严格 = bufBefore + N）。
      lastPickDetail = {
        boxes: pickedDetail.length,
        picked: pickedDetail,
        bufBefore: bufBeforePick,
        bufEnter: balls.length,
        isChain: !!raw.isChain
      };
      return true;
    }

    // ---- 主循环(按 tick 推进) ----
    // v113：doPick 把本次取盒的逐盒明细与暂存入场态写在这里，供 tickPickInfo 取用。
    // 单独一个变量而不是让 doPick 返回对象：doPick 的返回值语义是 true/false（取到没取到），
    // 多处判断依赖它，改返回值风险大于收益。
    var lastPickDetail = null;
    var ticks = 0, picks = 0, misjudge = 0, bufferPeak = 0;
    var timeline = [];
    // 瞬时连锁模式的操作事件流（每次「选盒 + 完整瞬时结算」一条）。原两种模式下恒为空数组。
    var instantEvents = [];
    // 【v121·任务AK③】玩家版棋盘取盒序列（只新增输出，不参与任何决策）。
    // 口径与 v112 全知侧 solver.pickOrder 完全一致：**一条 = 一个盒**，同一 pick 的锁链成员
    // 共享同一个 step；额外带 tick 便于与 tickTrajectory / pressureSamples 对齐。
    // 为什么必须新开一个数组：现有输出里**没有任何**可用于画玩家路线的棋盘坐标 ——
    //   · `frames[i].picks[j]` 的 sr/sc 是【暂存槽起点坐标】(slotStart 映射到目标图的行列)，不是棋盘坐标；
    //   · 棋盘坐标只存在于函数内部的 lastPickDetail.picked，从不出函数。
    // 因此前端此前只能显示全知路线。本数组把已有信息汇总出去，不新增任何计算。
    var pickOrderPS = [];
    var pressureSamples = []; // 每完成(有球离场)时记录 {done,buf,...动态封锁指标} → 供【卡点审核/合格门】(done 轴，语义不得改)
    // ===== 玩家滞留统计（需求 §4）=====
    // 单盒滞留 = 离场操作 tick − enterTick。普通盒、锁链盒(整组释放时各按自己 enterTick)、
    // 复活【从暂存】释放的盒 都计入；复活【从棋盘残留区】直接移除、从未进暂存的盒不计入。
    var resSumPS = 0, resCountPS = 0;
    function accResidence(ball, leaveTick) {
      if (!ball || ball.enterTick == null) return;
      var d = leaveTick - ball.enterTick;
      if (d < 0) d = 0;
      resSumPS += d; resCountPS++;
    }
    // ===== 逐操作 tick 轨迹（需求 §5.1）=====
    // 【重要】与 pressureSamples 分离：后者是「完成事件轴(done)」且喂合格门审核，语义必须保持不变；
    // 本数组是「玩家操作 tick 轴」，供 f1 平均暂存、f2 滞留、压力图与复活回溯使用。
    // 需求 §5.3 要求同一条原始轨迹可映射两种视图，故两者并存而非互相替代。
    var tickTrajectory = [];
    var reviveEvents = [];   // 复活事件列表（需求 §七）
    var pendingRevive = null; // 本 tick 若发生复活，由 revivePS() 写入、tick 末尾并入轨迹记录
    // 本 tick 的操作步号。【不能直接用 ticks】：原实现 `ticks++` 位于停滞检测【之前】，
    // 而复活发生在停滞检测【之内】，若用 ticks 记复活步会整体偏大 1（既有 off-by-one）。
    // 故在每个 tick 开头固定取一次 curOpTick，全程（入场/离场/复活/轨迹）统一用它。
    var curOpTick = 0;
    var tickRecorded = false;
    // 在 tick 末尾（含胜负 break 之前）统一记录一次。必须在复活之后调用，
    // 这样 bufferAfter 才是需求 §5.2.5 要求的「复活后的暂存数」。
    function finishTick() {
      if (tickRecorded) return;
      tickRecorded = true;
      // 有效操作 tick（需求 §3.1/§3.6）：取了盒、或有推进、或发生复活。
      // 纯空转的停滞检测 tick 不计入 f1 平均，避免同一个暂存状态被反复加权。
      var effective = !!tickPickInfo || !!progressed || !!pendingRevive;
      tickTrajectory.push({
        tick: curOpTick,
        effective: effective,
        idle: !effective,
        done: s.completedBoxes,
        eliminatedPixels: s.eliminatedPixels,
        progress: totalPixels ? +(s.eliminatedPixels / totalPixels).toFixed(4) : 0,
        pick: tickPickInfo || null,
        picked: !!tickPickInfo,
        revive: !!pendingRevive,
        reviveIndex: pendingRevive ? pendingRevive.index : 0,
        bufferBeforeRevive: pendingRevive ? pendingRevive.bufferBefore : null,
        bufferAfterRevive: pendingRevive ? pendingRevive.bufferAfter : null,
        bufferAfter: balls.length,              // 本 tick 最终暂存（复活步 = 复活后真实值）
        releasedSlots: tickReleasedSlots.slice(),
        normalDone: tickNormalDone,             // 本步正常完成盒数
        reviveDone: tickReviveDone              // 本步复活完成盒数
      });
    }
    function recordPressureSample() {
      var sample = { done: s.completedBoxes, buf: balls.length };
      // PlayerSim 的 buffer/slot 由 balls + slotUsed 自行维护；明确传入其真实最左空槽，不依赖 Simulator.buffer。
      var nextSlot = leftmostFreeSlot();
      if (capturePreviewStats && nextSlot >= 0) {
        var preview = Sim.previewNextEliminationOrder(s, { slot: nextSlot });
        sample.nextSlot = preview.slot;
        sample.reachable = preview.reachable;
        sample.locked = preview.lockedCount;
        sample.remaining = preview.remaining;
        sample.lockRatio = preview.stats.lockRatio;
      }
      pressureSamples.push(sample);
    }
    // 消除道具：死锁时救场——立即消除暂存区"完成进度最低"的球；消除跨越阻挡、按距离直取目标像素。
    var useItems = opts.useItems === true;   // 默认关(严格)；演示/图表可开
    var itemUses = 0, itemMarks = [], itemCap = (s.totalBoxes || 0) + 5;
    // 复活道具：玩家死亡(暂存卡死)时自动触发，每关最多 reviveCap 次(默认2)；≤reviveCap 次复活通关即算玩家合格。
    // 复活效果：立即消除暂存区【剩余订单最大的 2 个盒】——无视依赖封锁，按离其起点最近直取像素，释放这2个槽位。
    var reviveCap = (opts.reviveCap != null) ? opts.reviveCap : 2;
    var revivesUsed = 0;

    // 用一次道具：选进度最低的暂存球，忽略可达性、按离其起点最近，消除其剩余像素，释放该球。
    function useItemPS() {
      if (!balls.length) return false;
      var target = null, tr = 2;
      for (var i = 0; i < balls.length; i++) { var bb = balls[i], ratio = bb.progress / bb.need; if (!target || bb.progress < target.progress || (bb.progress === target.progress && ratio < tr)) { target = bb; tr = ratio; } }
      var remaining = target.need - target.progress;
      var px = [];
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) if (!elim[r][c] && blocks[r][c] === target.color) px.push({ r: r, c: c, d: Math.abs(r - target.ar) + Math.abs(c - target.ac) });
      px.sort(function (a, b) { return (a.d - b.d) || (b.r - a.r) || (a.c - b.c); }); // 距离优先，跨越阻挡
      var k = Math.min(remaining, px.length);
      for (var p = 0; p < k; p++) {
        var q = px[p]; elim[q.r][q.c] = true; s.eliminatedPixels++; tickReviveElim++;
        tryAddReach(q.r - 1, q.c); tryAddReach(q.r + 1, q.c); tryAddReach(q.r, q.c - 1); tryAddReach(q.r, q.c + 1);
        if (curFrame) curFrame.eats.push({ key: target.key, r: q.r, c: q.c, color: target.color, item: true });
      }
      target.progress += k;
      slotUsed[target.slot] = null; balls = balls.filter(function (x) { return x !== target; }); s.completedBoxes++;
      // 旧主动道具同样是「从暂存释放」，离场步为当前操作 tick，口径与复活释放一致。
      // 注：正式玩家验证 useItems 默认为 false，此路径仅在演示/图表显式开启时走到。
      accResidence(target, curOpTick);
      itemUses++; itemMarks.push({ done: s.completedBoxes, tick: ticks });
      tickReleasedSlots.push(target.slot);
      if (curFrame) curFrame.done.push({ key: target.key, slot: target.slot, item: true });
      return true;
    }

    // 复活：消除【剩余订单最大的 2 个盒】——严格【暂存区优先】：先取暂存中剩余最大的球；
    //   若暂存不足 2 个(常见：暂存已空但棋盘还锁着末尾残留盒)，再用棋盘残留盒(剩余最大优先)补足到 2。
    //   无视依赖封锁，按离起点最近直取像素，释放暂存槽 / 移除棋盘盒。
    // 【演示捕获】(需求 §5.2)：不改变以上选择/执行逻辑，只在其执行过程中额外记录一份独立的 revive 事件，
    //   挂到 curFrame.revive，与普通取盒/逐像素消除/普通完成事件区分(演示层按 revive 字段单独识别、不再混进 item 消除)。
    function revivePS() {
      var bufferBefore = balls.length;
      // 1) 暂存池(优先)：按剩余订单降序
      var bufPool = [];
      for (var i = 0; i < balls.length; i++) bufPool.push({ color: balls[i].color, rem: balls[i].need - balls[i].progress, kind: 'b', ref: balls[i], ar: balls[i].ar, ac: balls[i].ac });
      bufPool.sort(function (a, b) { return b.rem - a.rem; });
      var targets = bufPool.slice(0, 2);
      // 2) 暂存不足 2 个 → 用棋盘残留盒补足(按剩余订单降序)
      if (targets.length < 2) {
        var boardPool = [];
        for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) { var cell = s.cells[r] && s.cells[r][c]; if (cell && cell.t === 'box') boardPool.push({ color: cell.color, rem: cell.count, kind: 'g', r: r, c: c, ar: 0, ac: c }); }
        boardPool.sort(function (a, b) { return b.rem - a.rem; });
        for (var bp = 0; bp < boardPool.length && targets.length < 2; bp++) targets.push(boardPool[bp]);
      }
      if (!targets.length) return false;
      var removedBalls = [];
      // 演示捕获用：本次复活的目标清单/消除像素/释放槽位/棋盘移除盒(不参与选择逻辑，只旁路记录)。
      var reviveTargets = [], revivePixels = [], releasedSlots = [], removedBoardCells = [];
      for (var t = 0; t < targets.length; t++) {
        var tg = targets[t], px = [];
        for (var pr = 0; pr < rows; pr++) for (var pcx = 0; pcx < cols; pcx++) if (!elim[pr][pcx] && blocks[pr][pcx] === tg.color) px.push({ r: pr, c: pcx, d: Math.abs(pr - tg.ar) + Math.abs(pcx - tg.ac) });
        px.sort(function (a, b) { return (a.d - b.d) || (b.r - a.r) || (a.c - b.c); });
        var k = Math.min(tg.rem, px.length);
        reviveTargets.push({
          source: tg.kind === 'b' ? 'buffer' : 'board', color: tg.color, remaining: tg.rem,
          slot: tg.kind === 'b' ? tg.ref.slot : null, r: tg.kind === 'g' ? tg.r : null, c: tg.kind === 'g' ? tg.c : null
        });
        for (var p = 0; p < k; p++) {
          var q = px[p]; elim[q.r][q.c] = true; s.eliminatedPixels++; tickReviveElim++;
          tryAddReach(q.r - 1, q.c); tryAddReach(q.r + 1, q.c); tryAddReach(q.r, q.c - 1); tryAddReach(q.r, q.c + 1);
          revivePixels.push({ r: q.r, c: q.c, color: tg.color });
          if (curFrame) curFrame.eats.push({ key: tg.kind === 'b' ? tg.ref.key : -1, r: q.r, c: q.c, color: tg.color, item: true, revive: true });
        }
        if (tg.kind === 'b') {
          slotUsed[tg.ref.slot] = null; removedBalls.push(tg.ref); releasedSlots.push(tg.ref.slot);
          // 需求 §4.4：复活【从暂存】释放的盒属于已进入暂存的盒，离场步为复活发生的当前操作 tick。
          // 下方 kind==='g'（棋盘残留、从未进暂存）分支【不】调用，符合「不参与平均滞留统计」。
          accResidence(tg.ref, curOpTick);
          tickReviveDone++; tickReleasedSlots.push(tg.ref.slot);
          if (curFrame) curFrame.done.push({ key: tg.ref.key, slot: tg.ref.slot, item: true, revive: true });
        } else {
          s.cells[tg.r][tg.c] = null;   // 棋盘残留盒直接移除(复活救场，简化不处理管道吐球)
          removedBoardCells.push({ r: tg.r, c: tg.c });
        }
        s.completedBoxes++;
      }
      if (removedBalls.length) balls = balls.filter(function (x) { return removedBalls.indexOf(x) < 0; });
      // 需求 §5.2：复活前后的真实暂存数必须能被【评分与图表】取到，不能只存在于演示捕获里。
      // 原实现只写 curFrame.revive（需 capture 开启），故此处另存一份到 tick 轨迹待回填的暂存变量。
      pendingRevive = {
        tick: curOpTick, index: revivesUsed + 1, cap: reviveCap,
        // done 取【复活后】的完成盒数：与紧随其后的 recordPressureSample() 落点一致，
        // 这样压力图按进度轴定位复活标记时，标记正好落在曲线真实下降处。
        done: s.completedBoxes,
        bufferBefore: bufferBefore, bufferAfter: balls.length,
        released: releasedSlots.slice(), releasedCount: releasedSlots.length,
        targets: reviveTargets, removedBoardCells: removedBoardCells.slice(),
        fromBuffer: releasedSlots.length, fromBoard: removedBoardCells.length
      };
      reviveEvents.push(pendingRevive);
      if (curFrame) {
        curFrame.revive = {
          tick: ticks, index: revivesUsed + 1, cap: reviveCap,
          bufferBefore: bufferBefore, targetCount: reviveTargets.length, targets: reviveTargets,
          eliminatedPixels: revivePixels, releasedSlots: releasedSlots, removedBoardCells: removedBoardCells,
          bufferAfter: balls.length
        };
      }
      return true;
    }
    var guard = totalPixels * 4 + 5000;
    var stallTicks = 0;

    // 开局先取一个
    while (!s.gameOver && guard-- > 0) {
      curFrame = capture ? { picks: [], eats: [], done: [] } : null;
      // 瞬时连锁模式的逐 tick 记录（需求 §八.2）：本 tick 瞬时消除总量、内部重扫批次数、整轮扫描遍数、
      // 结算前后的暂存数量。原口径下这些值保持 0/不使用，不影响既有行为。
      var tickElim = 0, tickBatches = 0, tickSettleSweeps = 0;
      var bufBeforeSettle = balls.length;
      var tickPickInfo = null;
      // 复活/道具【绕过瞬时结算】直接按距离清像素（无视可达性），这部分不属于 tickElim，
      // 但必须单独记账，否则事件流消除量之和会小于总消除像素（实测过一次这个缺口）。
      var tickReviveElim = 0;
      var curEvent = null;
      // 本 tick 的滞留/轨迹记账（需求 §5.1）：正常完成盒数、复活完成盒数、释放槽位、复活待回填。
      var tickNormalDone = 0, tickReviveDone = 0, tickReleasedSlots = [];
      pendingRevive = null;
      curOpTick = ticks;          // 本 tick 的操作步号，固定在此处取一次
      tickRecorded = false;
      // ===== 取球阶段 =====
      var highPressure = balls.length >= bufferLimit - 1;
      var latest = balls.length ? balls[balls.length - 1] : null;
      var frontOK = !latest || (latest.progress / latest.need) >= pickThreshold;
      var wantPick = freeSlotCount() > 0 && (balls.length === 0 || (!highPressure && frontOK));
      // 若没有球在消(全停滞)且有空位，必须尝试取球推进(否则死锁)
      var anyEating = false;
      for (var bi = 0; bi < balls.length; bi++) if (colorHasReach(balls[bi].color)) { anyEating = true; break; }
      if (!anyEating && freeSlotCount() > 0) wantPick = true;

      if (wantPick) {
        var mv = choosePlayerPick();
        if (mv) {
          var cell = s.cells[mv.r][mv.c];
          var wasQ = cell.q && !Sim.isRevealed(s, mv.r, mv.c);
          var thought = wasQ ? false : optimisticConsumable(cell.color, cell.count);
          if (doPick(mv)) {
            picks++;
            // 记录本次选择的盒（需求 §八.2 第1项）
            // v113：补锁链逐盒明细与暂存入场态（与 v112 solver 侧 pickOrder/stepStats 同口径）。
            // 改前只有 groupSize，color/need 都只是【触发盒】的 —— 知道这 tick 取了 3 盒，
            // 却不知道另外两盒是什么色、多少球，也看不到「整组入场后、消除前」占了几个槽。
            // lastPickDetail 由 doPick 填（它拿得到 pickBoxRaw 的全部成员与入场前后的槽占用）。
            var lpd = lastPickDetail || {};
            tickPickInfo = {
              r: mv.r, c: mv.c, color: cell.color, need: cell.count,
              groupSize: mv.groupSize || 1, wasQuestion: wasQ,
              boxes: lpd.boxes != null ? lpd.boxes : (mv.groupSize || 1),   // 这一步实际入场几个盒
              picked: lpd.picked || null,          // [{r,c,color,count}]，[0] 是触发盒
              bufBefore: lpd.bufBefore != null ? lpd.bufBefore : null,     // 取盒前的槽占用
              bufEnter: lpd.bufEnter != null ? lpd.bufEnter : null         // 整组入场后、消除前
            };
            // 【v121·任务AK③】汇总本步的棋盘取盒序列（纯记录，逐盒一条、同步共享 step）。
            // 没有 picked 明细时（理论上不会，doPick 成功必填）退化为只记触发盒，不静默丢步。
            var pkList = (lpd.picked && lpd.picked.length)
              ? lpd.picked : [{ r: mv.r, c: mv.c, color: cell.color, count: cell.count }];
            for (var pk = 0; pk < pkList.length; pk++) {
              pickOrderPS.push({
                step: picks,                       // picks 已在上面自增 → 1 起算，与 solver 侧 step 同口径
                tick: curOpTick,
                r: pkList[pk].r, c: pkList[pk].c,
                color: pkList[pk].color, count: pkList[pk].count,
                chain: lpd.isChain ? 1 : 0,        // 是否锁链整组（0 = 单盒）
                chainSize: tickPickInfo.boxes || pkList.length,   // 这一步共取几盒
                chainIndex: pk                     // 组内序号，0 = 触发盒
              });
            }
            if (thought) { /* 认为可消，稍后校验是否误判 */ }
          }
        }
      }

      // ===== 消除阶段 =====
      var progressed = false;
      if (instantChain) {
        // 【四方向瞬时连锁】：本次结算里把暂存订单按【严格先进先得】逐个推到底。
        // balls 数组本身就是进入暂存的顺序，这里不做任何重排（需求 §四 + 用户 2026-08-03 裁决）。
        // 前一个同色订单没消完又拿不到可达同色时，轮到后面的同色订单时可达集合已被它消空/或本来就空，
        // 因此后进入者不会越过它抢像素。
        // 每个订单内部走 Simulator 的快照批次连锁（起点=该订单的暂存槽映射位置），
        // 整轮扫完若有任何推进就再扫一遍——因为某个订单完成会暴露新区域，可能让更早滞留的订单继续推进（需求 §五.2）。
        var settleRounds = 0, settleGuard = totalPixels + 64;
        var sweepProgressed = true;
        while (sweepProgressed && settleGuard-- > 0) {
          sweepProgressed = false;
          for (var fi = 0; fi < balls.length; fi++) {
            var fb = balls[fi];
            var fRemain = fb.need - fb.progress;
            if (fRemain <= 0) continue;
            var fTrace = capture ? [] : null;
            var fStat = {};
            var fGot = Sim.instantChainEliminate(elim, blocks, rows, cols, fb.color, fRemain, fTrace, { r: fb.ar, c: fb.ac }, fStat);
            if (fGot > 0) {
              fb.progress += fGot;
              s.eliminatedPixels += fGot;
              progressed = true; sweepProgressed = true;
              // 逐项记录（需求 §八.2）：本订单本次消除量、内部分了几轮重扫、每轮各消多少
              fb.lastSettle = { eliminated: fGot, batches: fStat.batches || 0, rounds: (fStat.rounds || []).slice() };
              tickElim += fGot;
              tickBatches += (fStat.batches || 0);
              if (capture && fTrace && fTrace.length) {
                for (var ft = 0; ft < fTrace.length; ft++) {
                  curFrame.eats.push({ key: fb.key, r: fTrace[ft][0], c: fTrace[ft][1], color: fb.color });
                }
              }
            }
          }
          settleRounds++;
        }
        // 本文件自维护的增量可达集已被上面的批量消除绕过，必须重播种，否则后续选盒的乐观估计会用过期数据
        seedReach();
        tickSettleSweeps = settleRounds;
      } else {
        // ===== 原口径(1 tick：每球各吃1像素) =====
        // 【v143·剩余容量优先】同色多球共享像素池时的取用次序（用户 2026-10-15 定：
        //   「两辆同色的车在暂存区，目标图那颜色出来后应该先进容量少的那个」）。
        //   **规则本体在 Simulator.contendOrder，单一来源**，这里只传"距离"这个平手判据，
        //   不再自带一份排序（本文件过去就因为自带第二份排序踩过口径分裂的坑）。
        //   次序：剩余容量升序 → 离各自起点最近可达同色像素升序 → 先进暂存者（下标=key 序）。
        var order = [];
        if (Sim.contendOrder) {
          var ordIdx = Sim.contendOrder(balls, function (b) { return peekNearestDist(b.color, b.ar, b.ac); });
          for (var oq = 0; oq < ordIdx.length; oq++) order.push(balls[ordIdx[oq]]);
        } else {
          order = balls.slice();
          order.sort(function (a, b) { return ((a.need - a.progress) - (b.need - b.progress)) || (a.key - b.key); });
        }
        for (var oi = 0; oi < order.length; oi++) {
          var ball = order[oi];
          if (ball.progress >= ball.need) continue;
          // 起点固定为暂存槽映射位置(不随消除移动)：取"离该固定起点最近"的可达同色像素
          var got = eatNearest(ball.color, ball.ar, ball.ac);
          if (got) { ball.progress++; progressed = true; if (curFrame) curFrame.eats.push({ key: ball.key, r: got.r, c: got.c, color: ball.color }); }
        }
      }

      // ===== 结算完成的球(锁链整组都消完才一起离场) =====
      var prevCompleted = s.completedBoxes;
      var linkGroups = {};
      for (var lg = 0; lg < balls.length; lg++) { var b0 = balls[lg]; if (b0.link) (linkGroups[b0.link] = linkGroups[b0.link] || []).push(b0); }
      var doneLinks = {};
      for (var lk in linkGroups) { if (linkGroups[lk].every(function (x) { return x.progress >= x.need; })) doneLinks[lk] = true; }
      var survivors = [];
      for (var sv = 0; sv < balls.length; sv++) {
        var it = balls[sv];
        var done = it.link ? !!doneLinks[it.link] : (it.progress >= it.need);
        if (done) {
          slotUsed[it.slot] = null; s.completedBoxes++;
          // 滞留统计（需求 §4.2/§4.3）：普通盒按自身完成离场；锁链盒在整组释放这一 tick
          // 分别用各自 enterTick 计算——先完成的成员在等待伙伴期间仍占用暂存，滞留继续累计到此刻。
          accResidence(it, curOpTick);
          tickNormalDone++;
          tickReleasedSlots.push(it.slot);
          if (curFrame) curFrame.done.push({ key: it.key, slot: it.slot });
        }
        else survivors.push(it);
      }
      balls = survivors;
      if (s.completedBoxes > prevCompleted) recordPressureSample();

      // ===== 记录/胜负 =====
      if (balls.length > bufferPeak) bufferPeak = balls.length;
      timeline.push(balls.length);
      // 瞬时连锁模式：把这一次「选盒 + 完整瞬时结算」作为一条操作事件如实记录（需求 §八.2 / §十.2）。
      // 只在本模式下记录，原两种模式不产生该数组，行为完全不变。
      if (instantChain) {
        // 保留引用：复活/道具在本 tick 的【停滞检测阶段】才可能触发，即发生在本次 push 之后，
        // 所以 revive / reviveEliminated 两项必须等它真正执行后回填，不能在这里一次写死。
        curEvent = {
          tick: ticks,
          pick: tickPickInfo,                     // 本次选择的盒（没取盒的 tick 为 null）
          eliminated: tickElim,                   // 本 tick【瞬时结算】消除的像素总数
          reviveEliminated: 0,                    // 本 tick 复活/道具【绕过结算】直接消掉的像素数
          batches: tickBatches,                   // 各订单内部快照重扫的批次总数
          settleSweeps: tickSettleSweeps,          // 整个暂存区被反复扫描的遍数
          bufferBefore: bufBeforeSettle,           // 结算前暂存数量
          bufferAfter: balls.length,               // 结算后暂存数量
          completedBoxes: s.completedBoxes,
          stalled: balls.map(function (b) { return { key: b.key, color: b.color, progress: b.progress, need: b.need }; }),
          revive: false                            // 本 tick 是否触发复活（下方回填）
        };
        instantEvents.push(curEvent);
      }
      // 注意：此时先不 push curFrame——revivePS() 在【本 tick 稍后】的停滞检测里才可能触发，
      //   若在此提前 push、之后再往 curFrame 挂 revive 字段，空帧(取/吃/完成三项都为空但触发了复活)会漏收（curFrame
      //   引用虽仍会被 revivePS 写入，但从未进入 frames[]，演示层永远看不到）。改为整个 tick 末尾统一判断一次是否要 push。
      var framePushedThisTick = false;
      ticks++;

      if (s.eliminatedPixels >= totalPixels) { s.gameWon = true; s.gameOver = true; finishTick(); if (capture && !framePushedThisTick && (curFrame.picks.length || curFrame.eats.length || curFrame.done.length || curFrame.revive)) { frames.push(curFrame); framePushedThisTick = true; } break; }

      // 停滞检测：本 tick 没消除、也没取到新球 → 累计
      if (!progressed) stallTicks++; else stallTicks = 0;
      if (stallTicks > 3) {
        // 停滞(连续多 tick 既没消除、也没取到能推进的新球) = 玩家卡死。先看能否取有效新球推进，不能则【复活】。
        var canPickUseful = false;
        if (freeSlotCount() > 0) { var mv2 = choosePlayerPick(); if (mv2) canPickUseful = true; }
        // 取不到有效新球(暂存满/无路)，或能取但取了仍长时间停滞(>12 tick 无推进=取了也没用) → 判卡死 → 复活
        if (!canPickUseful || stallTicks > 12) {
          // 复活：消【剩余订单最大的 2 盒】(暂存优先，暂存空则清棋盘残留盒)、腾出空间，每关最多 reviveCap 次；复活用尽才判负。
          // 注意：不再以 balls.length 为门槛——暂存空但棋盘仍有卡死残留盒时也要能复活(revivePS 内部按池是否为空返回)。
          if (revivesUsed < reviveCap && revivePS()) {
            revivesUsed++; recordPressureSample(); stallTicks = 0;
            // 回填本 tick 事件：复活确实发生 + 它直接清掉的像素数（保证事件流消除量能对上总数）
            if (curEvent) { curEvent.revive = true; curEvent.reviveEliminated = tickReviveElim; curEvent.bufferAfter = balls.length; }
          } else if (useItems && balls.length && itemUses < itemCap && useItemPS()) {
            recordPressureSample(); stallTicks = 0;   // 兼容旧主动道具模式(演示/图表用)
            if (curEvent) { curEvent.reviveEliminated = tickReviveElim; curEvent.bufferAfter = balls.length; }
          } else {
            finishTick();
            if (capture && !framePushedThisTick && (curFrame.picks.length || curFrame.eats.length || curFrame.done.length || curFrame.revive)) { frames.push(curFrame); framePushedThisTick = true; }
            // 【v323·死亡归因】判负这一刻的现场：手里有哪些票、场上还剩哪些障碍。
            //   只读观测；不改复活/判负逻辑。
            try {
              var _cnt = { chain: 0, ice: 0, pipe: 0 };
              var _bR4 = s.boardRows || rows, _bC4 = s.boardCols || cols;
              for (var _rr = 0; _rr < _bR4; _rr++) for (var _cc = 0; _cc < _bC4; _cc++) {
                var _cl = s.cells[_rr][_cc];
                if (!_cl) continue;
                if ((_cl.chain || 0) > 0) _cnt.chain++;
                if ((_cl.numice || 0) > 0) _cnt.ice++;
                if (_cl.t === 'pipe') _cnt.pipe++;
              }
              s.deathSnapshot = {
                step: picks, free: freeSlotCount(), bufferLimit: bufferLimit,
                buffer: balls.map(function (b) { return { color: b.color, rem: b.need - b.progress }; }),
                left: _cnt
              };
            } catch (e) { }
            s.gameOver = true; s.gameWon = false; break;
          }
        }
      }
      // tick 末尾统一记录轨迹（必须在上方复活/道具处理之后，bufferAfter 才是复活后的真实值）
      finishTick();
      if (capture && !framePushedThisTick && (curFrame.picks.length || curFrame.eats.length || curFrame.done.length || curFrame.revive)) frames.push(curFrame);
    }

    // 误判统计：结束时仍卡在暂存、当初被玩家判"可消"的球
    for (var mi2 = 0; mi2 < balls.length; mi2++) if (balls[mi2].thought && balls[mi2].progress < balls[mi2].need) misjudge++;

    // 【v323·死亡归因】没通关时（不管是卡死判负还是 tick 用尽），统一在这里拍一张现场：
    //   手里还剩哪些票、场上还剩多少链/冰/管道。放在这里是因为不同的退出路径有三条。
    var _deathSnap = s.deathSnapshot || null;
    // 不管从哪条路退出的，都补一份"场上最大锁链组 vs 空槽"（判负分支没算这个）
    if (!s.gameWon) {
      var _cgA = {}, _bRA = s.boardRows || rows, _bCA = s.boardCols || cols;
      for (var _rA = 0; _rA < _bRA; _rA++) for (var _cA = 0; _cA < _bCA; _cA++) {
        var _xA = s.cells[_rA][_cA];
        if (_xA && (_xA.chain || 0) > 0) _cgA[_xA.chain] = (_cgA[_xA.chain] || 0) + 1;
      }
      var _cmA = 0; for (var _kA in _cgA) if (_cgA[_kA] > _cmA) _cmA = _cgA[_kA];
      var _freeA = (typeof freeSlotCount === 'function') ? freeSlotCount() : null;
      if (_deathSnap) { _deathSnap.chainMax = _cmA; _deathSnap.chainGroups = Object.keys(_cgA).length; if (_deathSnap.free == null) _deathSnap.free = _freeA; }
      else if (_cmA > 0) { _deathSnap = { step: picks, free: _freeA, bufferLimit: bufferLimit, chainMax: _cmA, chainGroups: Object.keys(_cgA).length, buffer: [], left: null, exitedAt: 'chain' }; }
    }
    if (!s.gameWon && !_deathSnap) {
      try {
        var _c2 = { chain: 0, ice: 0, pipe: 0, box: 0 };
        var _bR3 = s.boardRows || rows, _bC3 = s.boardCols || cols;
        for (var _r3 = 0; _r3 < _bR3; _r3++) for (var _c3 = 0; _c3 < _bC3; _c3++) {
          var _x3 = s.cells[_r3][_c3];
          if (!_x3) continue;
          if (AntSolver.isBox(_x3)) _c2.box++;
          if ((_x3.chain || 0) > 0) _c2.chain++;
          if ((_x3.numice || 0) > 0) _c2.ice++;
          if (_x3.t === 'pipe') _c2.pipe++;
        }
        // 场上最大的锁链组还要几个槽（组大小 > 空槽 = 这组永远拿不进来 → 卡死主因）
        var _cg = {};
        var _bR5 = s.boardRows || rows, _bC5 = s.boardCols || cols;
        for (var _r5 = 0; _r5 < _bR5; _r5++) for (var _c5 = 0; _c5 < _bC5; _c5++) {
          var _x5 = s.cells[_r5][_c5];
          if (_x5 && (_x5.chain || 0) > 0) _cg[_x5.chain] = (_cg[_x5.chain] || 0) + 1;
        }
        var _cmax = 0; for (var _k5 in _cg) if (_cg[_k5] > _cmax) _cmax = _cg[_k5];
        _deathSnap = {
          step: picks, free: freeSlotCount(), bufferLimit: bufferLimit,
          buffer: balls.map(function (b) { return { color: b.color, rem: b.need - b.progress }; }),
          left: _c2, chainMax: _cmax, chainGroups: Object.keys(_cg).length, exitedAt: 'end'
        };
      } catch (e) { }
    }
    var progress = totalPixels > 0 ? Math.round(s.eliminatedPixels / totalPixels * 100) : 0;
    // ===== f1 玩家平均暂存（需求 §3）=====
    // 口径：只统计【有效操作 tick】的结算后暂存值；复活 tick 只取复活后的最终值（finishTick 已保证）；
    // 空转检测 tick 被排除，避免同一暂存状态被反复加权。
    var effTicks = 0, effBufSum = 0;
    for (var ti = 0; ti < tickTrajectory.length; ti++) {
      if (!tickTrajectory[ti].effective) continue;
      effTicks++; effBufSum += tickTrajectory[ti].bufferAfter;
    }
    var playerAvgBufferTick = effTicks ? +(effBufSum / effTicks).toFixed(4) : 0;
    // ===== f2 玩家平均滞留（需求 §4）=====
    // 已进入暂存并最终离开的盒才计入。未通关时仍滞留在暂存中的盒【不】伪造离场（§4.5）。
    var playerAvgResidence = resCountPS ? +(resSumPS / resCountPS).toFixed(4) : 0;
    return {
      won: s.gameWon, ticks: ticks, picks: picks, misjudge: misjudge,
      // 【v323·死亡归因】卡死前最后的拒绝（choosePlayerPick）或放不下（doPick）——
      //   用来回答「这关玩家主要死于哪个障碍」，只读观测，不改任何决策逻辑。
      lastRefuse: s.lastRefuse || null, lastBlocked: s.lastBlocked || null,
      deathSnapshot: _deathSnap,
      // ---- 新增：玩家侧评分口径数据（需求 §3/§4/§5/§七）----
      playerAvgBuffer: playerAvgBufferTick,   // f1 原始值（有效操作 tick 轴）
      playerBufferPeak: bufferPeak,
      effectiveTicks: effTicks,               // 参与 f1 平均的有效操作步数
      avgResidence: playerAvgResidence,       // f2 原始值（玩家平均滞留步数）
      residenceCount: resCountPS,             // 参与滞留平均的盒数
      residenceSum: resSumPS,
      stalledAtEnd: balls.length,             // 结束时仍滞留暂存的盒数（未通关时用于如实标记）
      tickTrajectory: tickTrajectory,         // 逐操作 tick 轨迹（§5.1）
      reviveEvents: reviveEvents,             // 复活事件列表（含前后暂存、释放槽位）
      // 本字段标的是【玩家侧数据口径】版本，不是难度评分版本——难度评分版本由 analysis.js
      // 的 difficulty() 返回（现为 diff-v5-scalefree）。早前这里写 'diff-v4-player'，
      // 会让下游把玩家数据口径误当成评分版本，v5 起改成不再自称评分版本。
      statsVersion: 'player-stats-v1',        // 玩家侧统计口径（enterTick/滞留/逐tick轨迹，2026-08-05 起）
      generatedAt: new Date().toISOString(),
      bufferPeak: bufferPeak, bufferTimeline: timeline,
      eliminatedPixels: s.eliminatedPixels, totalPixels: totalPixels, progress: progress,
      completedBoxes: s.completedBoxes, totalBoxes: s.totalBoxes,
      frames: frames, bufferLimit: bufferLimit, cols: cols, rows: rows,
      // 【v121·任务AK③】玩家版棋盘取盒序列（一条=一个盒，同 step 共享）。供前端画「玩家版求解路线」。
      pickOrder: pickOrderPS,
      pressureSamples: pressureSamples, itemUses: itemUses, itemMarks: itemMarks,
      revivesUsed: revivesUsed, reviveCap: reviveCap,
      // 玩法模式与瞬时连锁的操作事件流（需求 §八.2、§十.2）。
      // elimMode 让调用方一眼看出这份结果是哪种模式跑出来的，避免把三种模式的数据混着比。
      elimMode: instantChain ? 'fourSideInstantChain' : (bottomOnly ? 'bottomOnly' : 'fourSide'),
      instantEvents: instantEvents
    };
  }

  /** 多次运行取通关率(玩家有随机门槛/决策噪声较小，主要看结构)。 */
  function multiRun(level, runs, opts) {
    runs = runs || 5; var ok = 0, peak = 0, mis = 0;
    for (var i = 0; i < runs; i++) {
      var r = run(level, Object.assign({ seed: 7 + i * 131 }, opts || {}));
      if (r.won) ok++; peak += r.bufferPeak; mis += r.misjudge;
    }
    return { successRate: ok / runs, avgPeak: (peak / runs).toFixed(2), avgMisjudge: (mis / runs).toFixed(2) };
  }

  return {
    run: function (level, opts) {                 // 埋点包装：计数+计时后原样转调 run，返回值不变
      PERF.runs++;
      var _t0 = Date.now();
      try { return run(level, opts); } finally { PERF.ms += Date.now() - _t0; }
    },
    multiRun: multiRun, slotStart: slotStart,
    resetPerf: resetPerf, getPerf: getPerf
  };
})();
