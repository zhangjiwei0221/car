/**
 * 毛线JSON关卡编辑器 - 模拟游玩模块
 * 模拟实际游戏流程：点击激活的线轴拾取，自动匹配目标区
 * 
 * 布局：在中间面板内一体化展示（目标区+暂存区+棋盘）
 * 状态/进度/操作按钮/暂存图表：放在右侧属性面板
 * 
 * 消除逻辑（修正版）：
 *   从左到右扫描目标区各列栈顶，每列最多消1个同色像素
 *   一轮扫完后如果有列发生下落（栈顶变化），则再进行下一轮扫描
 *   直到一轮中没有消除发生为止
 */

var YarnLevel = YarnLevel || {};

YarnLevel.Simulator = (function() {
  var active = false;
  var state = null;
  var animating = false;

  function isActive() { return active; }

  /**
   * 进入模拟模式
   */
  function enter(spools, maprow, mapcol, blocks) {
    active = true;
    animating = false;
    state = {
      spools: YarnLevel.deepClone(spools),
      maprow: maprow,
      mapcol: mapcol,
      blocks: blocks ? YarnLevel.deepClone(blocks) : [],
      activated: {},
      picked: {},
      frozen: {},
      pipes: [],
      pipeReleasedAt: {},
      occupiedCells: {},
      buffer: [],
      targetColumns: [],
      targetEliminated: {},
      steps: 0,
      eliminatedSpools: 0,
      totalTargetPixels: 0,
      totalTargetSpools: 0,
      history: [],
      realBufferHistory: []
    };

    // 初始化激活：第一行
    for (var c = 0; c < mapcol; c++) {
      var s = spools[0] && spools[0][c];
      if (s && !YarnLevel.Validator.isObstacle(s)) {
        state.activated['0,' + c] = true;
      }
    }

    // 初始化占据格子
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var s = spools[r] && spools[r][c];
        if (s && s.id > 0 && !YarnLevel.isPipeType(s.type)) {
          state.occupiedCells[r + ',' + c] = true;
        }
      }
    }

    // 初始化冰块
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var s = spools[r] && spools[r][c];
        if (!s) continue;
        var types = Array.isArray(s.type) ? s.type : [s.type];
        if (types.indexOf(4) !== -1 && s.id > 0) {
          state.frozen[r + ',' + c] = {
            activated: !!state.activated[r + ',' + c],
            thawProgress: (r === 0 ? -1 : 0)
          };
        }
      }
    }

    // 初始化管道
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var s = spools[r] && spools[r][c];
        if (s && YarnLevel.isPipeType(s.type) && Array.isArray(s.param) && s.param.length > 0) {
          var dir = YarnLevel.getPipeDirection(s.type);
          var exitR = r, exitC = c;
          if (dir === 11) exitR = r - 1;
          else if (dir === 12) exitC = c + 1;
          else if (dir === 13) exitR = r + 1;
          else if (dir === 14) exitC = c - 1;
          state.pipes.push({
            row: r, col: c,
            exitRow: exitR, exitCol: exitC,
            param: s.param.slice(),
            nextRelease: 0
          });
        }
      }
    }

    // 初始化目标区：每列一个栈（从底往上排列，[0]是当前栈顶=最底行的像素）
    if (blocks && blocks.length > 0) {
      var bCols = blocks[0].length;
      for (var c = 0; c < bCols; c++) {
        var col = [];
        for (var r = blocks.length - 1; r >= 0; r--) {
          var bid = blocks[r] ? YarnLevel.getBlockId(blocks[r][c]) : 0;
          if (bid > 0) {
            col.push({ colorId: bid, origRow: r, origCol: c });
            state.totalTargetPixels++;
          }
        }
        state.targetColumns.push(col);
      }
    }
    // 总线轴数：棋盘格球 + 管道内球（新规则按球数统计，不再是 像素/3）
    var totalSpools = 0;
    for (var tr = 0; tr < maprow; tr++) {
      for (var tc = 0; tc < mapcol; tc++) {
        var tsp = spools[tr] && spools[tr][tc];
        if (!tsp) continue;
        if (tsp.id > 0 && !YarnLevel.isPipeType(tsp.type)) {
          totalSpools++;
        }
        if (YarnLevel.isPipeType(tsp.type) && Array.isArray(tsp.param)) {
          for (var tpi = 0; tpi < tsp.param.length; tpi++) {
            if (YarnLevel.getPipeItemId(tsp.param[tpi]) > 0) totalSpools++;
          }
        }
      }
    }
    state.totalTargetSpools = totalSpools;

    // 初始管道释放
    checkPipeRelease();

    // 切换UI
    showSimUI();
    render();
  }

  /**
   * 重置
   */
  function reset() {
    if (!state) return;
    var spools = YarnLevel.deepClone(state.spools);
    var maprow = state.maprow;
    var mapcol = state.mapcol;
    var blocks = YarnLevel.deepClone(state.blocks);
    var optResult = YarnLevel.Simulator._optimalResult;
    var playerTiers = YarnLevel.Simulator._playerTiers;
    var omniResult = YarnLevel.Simulator._omniResult;
    var routeTier = YarnLevel.Simulator._routeTier;
    exit();
    enter(spools, maprow, mapcol, blocks);
    YarnLevel.Simulator._optimalResult = optResult;
    YarnLevel.Simulator._playerTiers = playerTiers;
    YarnLevel.Simulator._omniResult = omniResult;
    YarnLevel.Simulator._routeTier = routeTier;
    render();
  }

  /**
   * 退出模拟模式
   */
  function exit() {
    active = false;
    state = null;
    animating = false;
    hideSimUI();
  }

  /**
   * 显示/隐藏模拟UI
   */
  function showSimUI() {
    var editor = document.getElementById('editor-content');
    var sim = document.getElementById('sim-content');
    var panelLeft = document.getElementById('panel-left');
    if (editor) editor.classList.add('hidden');
    if (sim) sim.classList.remove('hidden');
    if (panelLeft) panelLeft.classList.add('hidden');
    // 右侧面板标题改为模拟信息
    var title = document.getElementById('right-panel-title');
    if (title) title.textContent = '模拟游玩';
  }

  function hideSimUI() {
    var editor = document.getElementById('editor-content');
    var sim = document.getElementById('sim-content');
    var panelLeft = document.getElementById('panel-left');
    if (editor) editor.classList.remove('hidden');
    if (sim) sim.classList.add('hidden');
    if (panelLeft) panelLeft.classList.remove('hidden');
    var title = document.getElementById('right-panel-title');
    if (title) title.textContent = '属性面板';
  }

  /**
   * 检查是否可拾取
   */
  function canPick(row, col) {
    if (!state || animating) return false;
    var key = row + ',' + col;

    if (state.pipeReleasedAt[key]) {
      return !!state.activated[key];
    }

    if (!state.activated[key]) return false;
    if (state.picked[key]) return false;
    var s = state.spools[row] && state.spools[row][col];
    if (!s || s.id <= 0 || YarnLevel.isPipeType(s.type)) return false;

    if (state.frozen[key]) {
      if (!state.frozen[key].activated) return false;
      if (state.frozen[key].thawProgress < 3) return false;
    }

    var types = Array.isArray(s.type) ? s.type : [s.type];
    if (types.indexOf(5) !== -1) {
      var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      var partnerOk = false;
      for (var d = 0; d < dirs.length; d++) {
        var nr = row + dirs[d][0], nc = col + dirs[d][1];
        if (nr < 0 || nr >= state.maprow || nc < 0 || nc >= state.mapcol) continue;
        var ns = state.spools[nr] && state.spools[nr][nc];
        if (!ns) continue;
        var ntypes = Array.isArray(ns.type) ? ns.type : [ns.type];
        if (ntypes.indexOf(5) !== -1 && !state.picked[nr + ',' + nc]) {
          if (state.activated[nr + ',' + nc]) partnerOk = true;
          break;
        }
      }
      if (!partnerOk) return false;
    }

    return true;
  }

  /**
   * 点击拾取（带动画）
   */
  function pick(row, col) {
    if (!state || !canPick(row, col)) return false;
    var key = row + ',' + col;
    animating = true;

    var cellEl = document.querySelector('#sim-board-grid .board-cell[data-row="' + row + '"][data-col="' + col + '"]');
    var chainPartnerCell = null;

    // 查锁链配对
    var isPipeReleased = !!state.pipeReleasedAt[key];
    if (!isPipeReleased) {
      var s = state.spools[row][col];
      var types = Array.isArray(s.type) ? s.type : [s.type];
      if (types.indexOf(5) !== -1) {
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var d = 0; d < dirs.length; d++) {
          var nr = row + dirs[d][0], nc = col + dirs[d][1];
          if (nr < 0 || nr >= state.maprow || nc < 0 || nc >= state.mapcol) continue;
          var ns = state.spools[nr] && state.spools[nr][nc];
          if (!ns) continue;
          var ntypes = Array.isArray(ns.type) ? ns.type : [ns.type];
          if (ntypes.indexOf(5) !== -1 && !state.picked[nr + ',' + nc]) {
            chainPartnerCell = document.querySelector('#sim-board-grid .board-cell[data-row="' + nr + '"][data-col="' + nc + '"]');
            break;
          }
        }
      }
    }

    if (cellEl) cellEl.classList.add('sim-pick-anim');
    if (chainPartnerCell) chainPartnerCell.classList.add('sim-chain-pick-anim');

    setTimeout(function() {
      executePick(row, col);
      animating = false;
    }, 380);

    return true;
  }

  /**
   * 执行拾取逻辑
   */
  function executePick(row, col) {
    var key = row + ',' + col;

    // 保存历史
    state.history.push(YarnLevel.deepClone({
      activated: state.activated,
      picked: state.picked,
      frozen: state.frozen,
      buffer: state.buffer,
      targetColumns: state.targetColumns,
      targetEliminated: state.targetEliminated,
      occupiedCells: state.occupiedCells,
      pipeReleasedAt: state.pipeReleasedAt,
      pipes: state.pipes,
      steps: state.steps,
      eliminatedSpools: state.eliminatedSpools
    }));

    state.steps++;

    var colorId;
    var orderCount;
    var isPipeReleased = !!state.pipeReleasedAt[key];
    if (isPipeReleased) {
      colorId = state.pipeReleasedAt[key].colorId;
      orderCount = state.pipeReleasedAt[key].count;
      delete state.pipeReleasedAt[key];
    } else {
      colorId = state.spools[row][col].id;
      orderCount = YarnLevel.getSpoolCount(state.spools[row][col]);
    }

    state.picked[key] = true;
    delete state.occupiedCells[key];

    // 锁链配对
    var chainPartner = null;
    if (!isPipeReleased) {
      var s = state.spools[row][col];
      var types = Array.isArray(s.type) ? s.type : [s.type];
      if (types.indexOf(5) !== -1) {
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var d = 0; d < dirs.length; d++) {
          var nr = row + dirs[d][0], nc = col + dirs[d][1];
          if (nr < 0 || nr >= state.maprow || nc < 0 || nc >= state.mapcol) continue;
          var ns = state.spools[nr] && state.spools[nr][nc];
          if (!ns) continue;
          var ntypes = Array.isArray(ns.type) ? ns.type : [ns.type];
          if (ntypes.indexOf(5) !== -1 && !state.picked[nr + ',' + nc]) {
            chainPartner = { row: nr, col: nc, colorId: ns.id, count: YarnLevel.getSpoolCount(ns) };
            state.picked[nr + ',' + nc] = true;
            delete state.occupiedCells[nr + ',' + nc];
            break;
          }
        }
      }
    }

    // 冰块解冻推进
    for (var fk in state.frozen) {
      if (state.frozen[fk].activated && state.frozen[fk].thawProgress < 3) {
        state.frozen[fk].thawProgress++;
      }
    }

    // 激活相邻
    activateNeighbors(row, col);
    if (chainPartner) activateNeighbors(chainPartner.row, chainPartner.col);

    // 管道释放
    checkPipeRelease();

    // 暂存+消除
    if (chainPartner) {
      // 锁链两球同时进场：交替逐轮从左到右抢（前者改变棋盘影响后者）
      processChainPair(colorId, orderCount, chainPartner.colorId, chainPartner.count);
    } else {
      processBuffer(colorId, orderCount);
    }

    // 记录实时暂存区历史
    state.realBufferHistory.push(state.buffer.length);

    render();
    checkWinLose();
  }

  /**
   * 线轴进暂存+消除
   *
   * 消除规则（新大像素规则）：
   * 1. 从左到右扫描各列栈顶，每列最多消除1个同色像素
   * 2. 一轮扫描完成后，如果发生了消除（某些列的栈顶变了），再进行下一轮
   * 3. 直到一轮中没有消除为止
   * 4. 每个线轴最多消除 need 个像素（need=该球订单量count，48上下浮动；旧关卡为3）
   * @param {number} colorId 线轴颜色
   * @param {number} orderCount 该线轴的订单量（需要消除多少个目标像素）
   */
  function processBuffer(colorId, orderCount) {
    if (colorId <= 0) return;

    var need = (typeof orderCount === 'number' && orderCount > 0) ? orderCount : YarnLevel.DEFAULT_ORDER;
    var item = { colorId: colorId, progress: 0, need: need };

    // 尝试匹配目标区
    matchTargetFixed(colorId, item);

    if (item.progress >= item.need) {
      state.eliminatedSpools++;
    } else {
      state.buffer.push(item);
    }

    // 自动释放暂存区
    autoReleaseBuffer();
  }

  /**
   * 目标区匹配：
   * 从左到右扫描各列栈顶，每列最多消1个
   * 一轮扫完后如果有变动（下落），再做下一轮
   * 最多消除 (item.need - item.progress) 个
   */
  function matchTargetFixed(colorId, item) {
    var needed = item.need - item.progress;
    if (needed <= 0) return;

    var changed = true;
    while (changed && item.progress < item.need) {
      changed = false;
      // 一轮：从左到右，每列最多消1个
      for (var c = 0; c < state.targetColumns.length; c++) {
        if (item.progress >= item.need) break;
        if (state.targetColumns[c].length > 0 && state.targetColumns[c][0].colorId === colorId) {
          var pixel = state.targetColumns[c].shift();
          state.targetEliminated[pixel.origRow + ',' + pixel.origCol] = true;
          item.progress++;
          changed = true;
          // 这一列消了1个，继续下一列（不重复消同列）
        }
      }
      // 一轮结束，如果changed=true说明有列发生了下落（栈顶变了），再循环一轮
    }
  }

  /**
   * 锁链两球同时进场的消除：
   * 两球有一前一后的顺序。每个球各自独立、连续地从左到右扫描消除
   * （自己一路扫，每列最多1个，不够则再循环下一轮，直到订单满或场上没有它的目标色为止），
   * 一个球完整扫完后，另一个球在变化后的棋盘上同样完整扫描。
   * 同色时后者面对的是前者抢走后变化的棋盘，从而产生"抢色"效果。
   */
  function processChainPair(c1, n1, c2, n2) {
    var need1 = (typeof n1 === 'number' && n1 > 0) ? n1 : YarnLevel.DEFAULT_ORDER;
    var need2 = (typeof n2 === 'number' && n2 > 0) ? n2 : YarnLevel.DEFAULT_ORDER;
    var item1 = { colorId: c1, progress: 0, need: need1 };
    var item2 = { colorId: c2, progress: 0, need: need2 };

    // 球1先完整扫描（matchTargetFixed 内部多轮循环直到满或消不动）
    matchTargetFixed(item1.colorId, item1);
    // 球2在球1抢完后的棋盘上完整扫描
    matchTargetFixed(item2.colorId, item2);

    if (item1.progress >= item1.need) state.eliminatedSpools++;
    else state.buffer.push(item1);
    if (item2.progress >= item2.need) state.eliminatedSpools++;
    else state.buffer.push(item2);

    autoReleaseBuffer();
  }

  /**
   * 自动释放暂存区（暂存中的球尝试继续消除）
   */
  function autoReleaseBuffer() {
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = state.buffer.length - 1; i >= 0; i--) {
        var item = state.buffer[i];
        // 检查能否继续消
        var canMatch = false;
        for (var c = 0; c < state.targetColumns.length; c++) {
          if (state.targetColumns[c].length > 0 && state.targetColumns[c][0].colorId === item.colorId) {
            canMatch = true;
            break;
          }
        }
        if (canMatch) {
          matchTargetFixed(item.colorId, item);
          if (item.progress >= item.need) {
            state.buffer.splice(i, 1);
            state.eliminatedSpools++;
          }
          changed = true;
        }
      }
    }
  }

  function activateNeighbors(row, col) {
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var d = 0; d < dirs.length; d++) {
      var nr = row + dirs[d][0], nc = col + dirs[d][1];
      if (nr < 0 || nr >= state.maprow || nc < 0 || nc >= state.mapcol) continue;
      var ns = state.spools[nr] && state.spools[nr][nc];
      if (!ns || YarnLevel.Validator.isObstacle(ns)) continue;
      var nKey = nr + ',' + nc;
      if (!state.activated[nKey]) {
        state.activated[nKey] = true;
        if (state.frozen[nKey] && !state.frozen[nKey].activated) {
          state.frozen[nKey].activated = true;
        }
      }
    }
  }

  function checkPipeRelease() {
    for (var i = 0; i < state.pipes.length; i++) {
      var pipe = state.pipes[i];
      if (pipe.nextRelease >= pipe.param.length) continue;
      var exitKey = pipe.exitRow + ',' + pipe.exitCol;
      if (!state.occupiedCells[exitKey] && !state.pipeReleasedAt[exitKey]) {
        var pItem = pipe.param[pipe.nextRelease];
        var colorId = YarnLevel.getPipeItemId(pItem);
        var pCount = YarnLevel.getPipeItemCount(pItem);
        state.pipeReleasedAt[exitKey] = { colorId: colorId, count: pCount, pipeRow: pipe.row, pipeCol: pipe.col };
        state.occupiedCells[exitKey] = true;
        pipe.nextRelease++;
      }
    }
  }

  function checkWinLose() {
    var remaining = 0;
    for (var c = 0; c < state.targetColumns.length; c++) {
      remaining += state.targetColumns[c].length;
    }
    if (remaining === 0 && state.buffer.length === 0) {
      setTimeout(function() { alert('🎉 通关！步数: ' + state.steps); }, 100);
      return;
    }
    if (state.buffer.length >= 7) {
      var anyCanMatch = false;
      for (var i = 0; i < state.buffer.length; i++) {
        for (var c = 0; c < state.targetColumns.length; c++) {
          if (state.targetColumns[c].length > 0 && state.targetColumns[c][0].colorId === state.buffer[i].colorId) {
            anyCanMatch = true;
            break;
          }
        }
        if (anyCanMatch) break;
      }
      if (!anyCanMatch) {
        setTimeout(function() { alert('💀 游戏失败！暂存区满且无法消除'); }, 100);
      }
    }
  }

  function undo() {
    if (!state || state.history.length === 0) return;
    var prev = state.history.pop();
    state.activated = prev.activated;
    state.picked = prev.picked;
    state.frozen = prev.frozen;
    state.buffer = prev.buffer;
    state.targetColumns = prev.targetColumns;
    state.targetEliminated = prev.targetEliminated;
    state.occupiedCells = prev.occupiedCells;
    state.pipeReleasedAt = prev.pipeReleasedAt;
    state.pipes = prev.pipes;
    state.steps = prev.steps;
    state.eliminatedSpools = prev.eliminatedSpools;
    render();
  }

  // ==================== 渲染 ====================

  function render() {
    if (!state) return;
    renderTarget();
    renderBuffer();
    renderBoard();
    renderPipePanel();
    renderRightPanel();
    bindEvents();
  }

  /**
   * 渲染目标区（真实下落效果）
   * 每列独立计算：去掉已消除的像素后，剩余像素从底往上紧密排列
   * 这意味着目标区画面会随着消除不断变化（跟真实游戏一样）
   */
  /**
   * 模拟模式目标区格子尺寸自适应（大像素图缩放）
   * 受限于目标区高度（约45%视口）和宽度（约700px），取较小者保证完整显示
   */
  function computeSimTargetCellSize(rows, cols) {
    if (cols <= 14 && rows <= 14) return 24;
    var availW = 720;
    var availH = Math.max(220, window.innerHeight * 0.42);
    var byW = Math.floor((availW - cols) / cols);
    var byH = Math.floor((availH - rows) / rows);
    var size = Math.min(byW, byH);
    if (size < 3) size = 3;
    if (size > 24) size = 24;
    return size;
  }

  function renderTarget() {
    var container = document.getElementById('sim-target-viewer');
    if (!container || !state.blocks || state.blocks.length === 0) return;

    var rows = state.blocks.length;
    var cols = state.blocks[0].length;
    var cellSize = computeSimTargetCellSize(rows, cols);
    var gap = 1;

    // 构建当前目标区实际画面：每列把已消除的去掉，剩余的下沉
    var targetGrid = [];
    for (var r = 0; r < rows; r++) {
      targetGrid.push(new Array(cols).fill(0));
    }
    for (var c = 0; c < cols; c++) {
      var remaining = [];
      for (var r = 0; r < rows; r++) {
        var bid = state.blocks[r] ? YarnLevel.getBlockId(state.blocks[r][c]) : 0;
        if (bid > 0 && !state.targetEliminated[r + ',' + c]) {
          remaining.push(bid);
        }
      }
      for (var i = 0; i < remaining.length; i++) {
        targetGrid[rows - 1 - i][c] = remaining[remaining.length - 1 - i];
      }
    }

    // === Canvas 渲染（替代 4900 个 DOM 格子，消除卡顿）===
    var stepPx = cellSize + gap;
    var cw = cols * stepPx;
    var chh = rows * stepPx;

    // 复用 canvas，避免每帧重建
    var canvas = container._simCanvas;
    if (!canvas || canvas.parentNode !== container) {
      container.innerHTML = '';
      container.style.gridTemplateColumns = '';
      canvas = document.createElement('canvas');
      canvas.className = 'sim-target-canvas';
      container.appendChild(canvas);
      container._simCanvas = canvas;
    }
    if (canvas.width !== cw || canvas.height !== chh) {
      canvas.width = cw;
      canvas.height = chh;
      canvas.style.width = cw + 'px';
      canvas.style.height = chh + 'px';
    }

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, chh);
    // 背景（间隙色）
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, cw, chh);

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var colorId = targetGrid[r][c];
        if (colorId > 0) {
          var color = YarnLevel.getColorCSS(colorId);
          ctx.fillStyle = color || '#999';
          ctx.fillRect(c * stepPx, r * stepPx, cellSize, cellSize);
        }
      }
    }
    state._prevTargetGrid = targetGrid;

    // 进度
    var remaining = 0;
    for (var c2 = 0; c2 < state.targetColumns.length; c2++) {
      remaining += state.targetColumns[c2].length;
    }
    var progress = state.totalTargetSpools > 0 ? Math.round(state.eliminatedSpools / state.totalTargetSpools * 100) : 0;
    var progressEl = document.getElementById('sim-progress-text');
    if (progressEl) {
      progressEl.textContent = progress + '% (' + state.eliminatedSpools + '/' + state.totalTargetSpools + ') 剩余' + remaining;
    }
  }

  /**
   * 渲染暂存区
   */
  function renderBuffer() {
    var label = document.getElementById('sim-buffer-label');
    var slots = document.getElementById('sim-buffer-slots');

    if (label) label.textContent = '暂存区 ' + state.buffer.length + '/7';

    if (slots) {
      var html = '';
      for (var i = 0; i < 7; i++) {
        if (i < state.buffer.length) {
          var item = state.buffer[i];
          var c = YarnLevel.getColorCSS(item.colorId);
          html += '<div class="sim-buffer-slot filled" style="background:' + (c || '#999') + ';">';
          html += '<span class="sim-buffer-progress">' + item.progress + '/' + item.need + '</span>';
          html += '</div>';
        } else {
          html += '<div class="sim-buffer-slot empty"></div>';
        }
      }
      slots.innerHTML = html;
    }
  }

  /**
   * 渲染棋盘
   */
  function renderBoard() {
    var container = document.getElementById('sim-board-grid');
    if (!container) return;

    var grid = document.createElement('div');
    grid.className = 'board-grid';
    grid.style.gridTemplateColumns = 'repeat(' + state.mapcol + ', 40px)';

    for (var r = 0; r < state.maprow; r++) {
      for (var c = 0; c < state.mapcol; c++) {
        grid.appendChild(renderSimCell(r, c));
      }
    }
    container.innerHTML = '';
    container.appendChild(grid);
  }

  function renderSimCell(r, c) {
    var cell = document.createElement('div');
    cell.className = 'board-cell';
    cell.dataset.row = r;
    cell.dataset.col = c;

    var key = r + ',' + c;
    var spool = state.spools[r][c];

    if (state.picked[key] && !state.pipeReleasedAt[key]) {
      cell.classList.add('sim-picked');
    } else if (spool.id === -1) {
      cell.classList.add('black-cell');
    } else if (YarnLevel.isPipeType(spool.type)) {
      cell.classList.add('cell-pipe-bg');
      var dir = YarnLevel.getPipeDirection(spool.type);
      var arrow = document.createElement('span');
      arrow.className = 'cell-pipe-arrow';
      arrow.textContent = YarnLevel.TYPE_MAP[dir] ? YarnLevel.TYPE_MAP[dir].icon : '?';
      cell.appendChild(arrow);

      // 管道编号标记（跟左侧面板对应）
      for (var pi = 0; pi < state.pipes.length; pi++) {
        if (state.pipes[pi].row === r && state.pipes[pi].col === c) {
          var pipeIdx = document.createElement('span');
          pipeIdx.className = 'cell-pipe-index';
          pipeIdx.textContent = '#' + (pi + 1);
          cell.appendChild(pipeIdx);
          break;
        }
      }

      // 管道高亮
      if (YarnLevel.Simulator._optimalResult) {
        var optResult = YarnLevel.Simulator._optimalResult;
        for (var pi = 0; pi < state.pipes.length; pi++) {
          var pipe = state.pipes[pi];
          if (pipe.row === r && pipe.col === c && pipe.nextRelease < pipe.param.length) {
            for (var oi = 0; oi < optResult.pickOrder.length; oi++) {
              var op = optResult.pickOrder[oi];
              if (op.source === 'pipe' && op.pipeRow === r && op.pipeCol === c && op.pipeIndex === pipe.nextRelease) {
                var nextStep = state.steps + 1;
                if (op.step >= nextStep && op.step <= nextStep + 4) {
                  cell.classList.add('sim-pipe-highlight');
                }
                break;
              }
            }
            break;
          }
        }
      }
    } else if (state.pipeReleasedAt[key]) {
      var prb = state.pipeReleasedAt[key];
      var circle = document.createElement('div');
      circle.className = 'cell-color-circle';
      var bgColor = YarnLevel.getColorCSS(prb.colorId);
      if (bgColor) circle.style.backgroundColor = bgColor;
      cell.appendChild(circle);
      var pTag = document.createElement('span');
      pTag.className = 'sim-pipe-tag';
      pTag.textContent = '管';
      cell.appendChild(pTag);
    } else if (spool.id > 0) {
      var circle = document.createElement('div');
      circle.className = 'cell-color-circle';
      var bgColor = YarnLevel.getColorCSS(spool.id);
      if (bgColor) circle.style.backgroundColor = bgColor;
      cell.appendChild(circle);

      var types = Array.isArray(spool.type) ? spool.type : [spool.type];
      var icons = [];
      if (types.indexOf(4) !== -1) icons.push('❄');
      if (types.indexOf(5) !== -1) icons.push('🔗');
      if (types.indexOf(6) !== -1) icons.push('❓');
      if (icons.length > 0) {
        var overlay = document.createElement('div');
        overlay.className = 'cell-overlay';
        overlay.textContent = icons.join('');
        cell.appendChild(overlay);
      }
    } else {
      cell.classList.add('empty-cell');
    }

    // 激活高亮
    if (state.activated[key] && !state.picked[key] && spool.id > 0 && !YarnLevel.isPipeType(spool.type)) {
      cell.classList.add('sim-active');
    }
    if (canPick(r, c)) {
      cell.classList.add('sim-pickable');
    }

    // 冰块进度
    if (state.frozen[key] && !state.picked[key]) {
      var fp = state.frozen[key];
      if (fp.activated && fp.thawProgress < 3) {
        var thawBadge = document.createElement('span');
        thawBadge.className = 'sim-thaw-badge';
        thawBadge.textContent = Math.max(0, fp.thawProgress) + '/3';
        cell.appendChild(thawBadge);
      }
    }

    // 最优步数标注
    if (!state.picked[key] && YarnLevel.Simulator._optimalResult) {
      var optResult = YarnLevel.Simulator._optimalResult;
      for (var oi = 0; oi < optResult.pickOrder.length; oi++) {
        var op = optResult.pickOrder[oi];
        if (op.row === r && op.col === c && op.source !== 'pipe') {
          var optBadge = document.createElement('span');
          optBadge.className = 'sim-opt-badge';
          var nextStep = state.steps + 1;
          if (op.step >= nextStep && op.step <= nextStep + 4) {
            optBadge.classList.add('sim-opt-next');
            cell.classList.add('sim-next-step');
          }
          optBadge.textContent = op.step;
          cell.appendChild(optBadge);
          break;
        }
      }
    }

    // 管道释放球步数标注
    if (state.pipeReleasedAt[key] && YarnLevel.Simulator._optimalResult) {
      var optResult = YarnLevel.Simulator._optimalResult;
      var prb = state.pipeReleasedAt[key];
      var currentPipeIndex = -1;
      for (var pi = 0; pi < state.pipes.length; pi++) {
        var pipe = state.pipes[pi];
        if (pipe.row === prb.pipeRow && pipe.col === prb.pipeCol) {
          currentPipeIndex = pipe.nextRelease - 1;
          break;
        }
      }
      if (currentPipeIndex >= 0) {
        for (var oi = 0; oi < optResult.pickOrder.length; oi++) {
          var op = optResult.pickOrder[oi];
          if (op.source === 'pipe' && op.pipeRow === prb.pipeRow && op.pipeCol === prb.pipeCol && op.pipeIndex === currentPipeIndex) {
            var optBadge = document.createElement('span');
            optBadge.className = 'sim-opt-badge';
            var nextStep = state.steps + 1;
            if (op.step >= nextStep && op.step <= nextStep + 4) {
              optBadge.classList.add('sim-opt-next');
              cell.classList.add('sim-next-step');
            }
            optBadge.textContent = op.step;
            cell.appendChild(optBadge);
            break;
          }
        }
      }
    }

    // 点击事件
    (function(row, col) {
      cell.addEventListener('click', function() {
        if (canPick(row, col)) pick(row, col);
      });
    })(r, c);

    return cell;
  }

  function renderPipePanel() {
    var panel = document.getElementById('sim-pipe-panel');
    if (!panel || !state) return;

    var html = '';
    for (var i = 0; i < state.pipes.length; i++) {
      var pipe = state.pipes[i];
      var dir = '?';
      var pipeSpool = state.spools[pipe.row] && state.spools[pipe.row][pipe.col];
      if (pipeSpool) {
        var dirType = YarnLevel.getPipeDirection(pipeSpool.type);
        dir = YarnLevel.TYPE_MAP[dirType] ? YarnLevel.TYPE_MAP[dirType].icon : '?';
      }

      html += '<div class="pipe-panel-item">';
      html += '<span class="pipe-label">#' + (i + 1) + ' ' + pipe.row + ',' + pipe.col + '</span>';
      html += '<span class="pipe-arrow-icon">' + dir + '</span>';
      html += '<span class="pipe-balls">';
      for (var j = 0; j < pipe.param.length; j++) {
        var color = YarnLevel.getColorCSS(YarnLevel.getPipeItemId(pipe.param[j]));
        var released = j < pipe.nextRelease;
        var style = 'background:' + (color || '#eee') + ';';
        if (released) style += 'opacity:0.3;';
        html += '<span class="pipe-ball" style="' + style + '">';
        if (YarnLevel.Simulator._optimalResult) {
          var optResult = YarnLevel.Simulator._optimalResult;
          for (var oi = 0; oi < optResult.pickOrder.length; oi++) {
            var op = optResult.pickOrder[oi];
            if (op.source === 'pipe' && op.pipeRow === pipe.row && op.pipeCol === pipe.col && op.pipeIndex === j) {
              html += '<span class="pipe-ball-step">' + op.step + '</span>';
              break;
            }
          }
        }
        html += '</span>';
      }
      html += '</span>';
      html += '</div>';
    }

    panel.innerHTML = html;
  }

  /**
   * 渲染右侧属性面板（模拟状态+操作按钮+解法信息+暂存图表）
   */
  function renderRightPanel() {
    var panel = document.getElementById('property-panel');
    if (!panel) return;

    var remaining = 0;
    for (var c = 0; c < state.targetColumns.length; c++) {
      remaining += state.targetColumns[c].length;
    }
    var progress = state.totalTargetSpools > 0 ? Math.round(state.eliminatedSpools / state.totalTargetSpools * 100) : 0;

    var html = '';

    // 步数+进度
    html += '<div class="prop-section">';
    html += '<div class="prop-label">模拟进度</div>';
    html += '<div style="font-size:13px;margin-bottom:4px;">步数: <strong>' + state.steps + '</strong></div>';
    html += '<div style="font-size:13px;margin-bottom:4px;">进度: <strong>' + progress + '%</strong> (' + state.eliminatedSpools + '/' + state.totalTargetSpools + ')</div>';
    html += '<div style="font-size:11px;color:#718096;">剩余像素: ' + remaining + '</div>';
    html += '</div>';

    // 操作按钮
    html += '<div class="prop-section">';
    html += '<button class="prop-btn" id="sim-undo-btn" style="width:100%;">↩ 撤回一步</button>';
    html += '<button class="prop-btn" id="sim-reset-btn2" style="width:100%;margin-top:4px;">🔄 重置</button>';
    html += '<button class="prop-btn btn-danger" id="sim-exit-btn" style="width:100%;margin-top:4px;">✕ 退出模拟</button>';
    html += '</div>';

    // 模拟档位切换（菜鸟/中级/高手/综合/全知）
    if (YarnLevel.Simulator._playerTiers) {
      var curTier = YarnLevel.Simulator._routeTier || 'combined';
      var tierBtns = [
        ['novice', '🐣 菜鸟', '#d9534f'],
        ['mid', '🙂 中级', '#f0ad4e'],
        ['strong', '😎 高手', '#5cb85c'],
        ['combined', '👥 综合', '#4a90d9'],
        ['omni', '🧩 全知', '#9b59b6']
      ];
      html += '<div class="prop-section">';
      html += '<div class="prop-label">模拟档位（切换重置推演）</div>';
      html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
      for (var tb = 0; tb < tierBtns.length; tb++) {
        var tk = tierBtns[tb][0], tn = tierBtns[tb][1], tc = tierBtns[tb][2];
        var on = (tk === curTier);
        html += '<button class="sim-tier-btn" data-tier="' + tk + '" style="flex:1;min-width:48px;padding:4px 6px;font-size:11px;border:1px solid ' + tc + ';border-radius:4px;cursor:pointer;background:' + (on ? tc : '#fff') + ';color:' + (on ? '#fff' : tc) + ';">' + tn + '</button>';
      }
      html += '</div>';
      html += '</div>';
    }

    // 快进控制
    if (YarnLevel.Simulator._optimalResult) {
      var opt = YarnLevel.Simulator._optimalResult;
      var totalSteps = opt.totalSteps || opt.pickOrder.length;
      html += '<div class="prop-section">';
      html += '<div class="prop-label">快速推进</div>';
      html += '<div style="display:flex;gap:4px;margin-bottom:6px;">';
      html += '<button class="prop-btn" id="sim-advance-1" style="flex:1;margin-top:0;">+1步</button>';
      html += '<button class="prop-btn" id="sim-advance-5" style="flex:1;margin-top:0;">+5步</button>';
      html += '<button class="prop-btn" id="sim-advance-10" style="flex:1;margin-top:0;">+10步</button>';
      html += '</div>';
      html += '<div style="display:flex;gap:4px;align-items:center;">';
      html += '<span style="font-size:11px;color:#718096;white-space:nowrap;">跳到第</span>';
      html += '<input type="number" id="sim-jump-input" min="0" max="' + totalSteps + '" value="' + state.steps + '" style="width:50px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:3px;font-size:12px;">';
      html += '<span style="font-size:11px;color:#718096;">/' + totalSteps + '步</span>';
      html += '<button class="prop-btn" id="sim-jump-btn" style="margin-top:0;padding:3px 8px;">跳转</button>';
      html += '</div>';
      html += '</div>';
    }

    // 提示
    html += '<div class="prop-section">';
    html += '<div style="font-size:11px;color:#718096;">';
    html += '💡 点击<span style="color:#4a90d9;">蓝框</span>线轴拾取<br>';
    html += '❄ 冰块需3步解冻<br>';
    html += '🔗 锁链两端都激活才能拾取<br>';
    html += '🔴 红色数字=当前推荐步<br>';
    html += '🔵 蓝色数字=后续推荐步';
    html += '</div>';
    html += '</div>';

    // 最优解法信息
    if (YarnLevel.Simulator._optimalResult) {
      var opt = YarnLevel.Simulator._optimalResult;
      html += '<div class="prop-section">';
      html += '<div class="prop-label">最优解法</div>';
      html += '<div style="font-size:11px;">';
      html += '总步数: <strong>' + opt.totalSteps + '</strong><br>';
      html += '暂存峰值: <strong>' + opt.maxBuffer + '/' + opt.bufferLimit + '</strong><br>';
      html += '平均暂存: <strong>' + opt.avgBuffer + '</strong>';
      html += '</div>';
      if (opt.validationErrors && opt.validationErrors.length > 0) {
        html += '<div style="margin-top:6px;padding:4px 6px;background:#fcebeb;border-radius:3px;font-size:10px;color:#d9534f;">';
        html += '⚠ 算法有' + opt.validationErrors.length + '处逻辑待优化';
        html += '</div>';
      }
      html += '</div>';
    }

    panel.innerHTML = html;

    // 显示暂存区图表（优先使用实时数据）
    var chartData = null;
    var chartLimit = 6;
    if (state.realBufferHistory && state.realBufferHistory.length > 0) {
      // 使用实时数据：已走过的步用实时值，未走的用预计算值补充
      chartData = state.realBufferHistory.slice();
      if (YarnLevel.Simulator._optimalResult && YarnLevel.Simulator._optimalResult.stepBufferHistory) {
        var preCalc = YarnLevel.Simulator._optimalResult.stepBufferHistory;
        chartLimit = YarnLevel.Simulator._optimalResult.bufferLimit || 6;
        // 补充未走的步数的预计算数据
        for (var si = chartData.length; si < preCalc.length; si++) {
          chartData.push(preCalc[si]);
        }
      }
    } else if (YarnLevel.Simulator._optimalResult && YarnLevel.Simulator._optimalResult.stepBufferHistory) {
      chartData = YarnLevel.Simulator._optimalResult.stepBufferHistory;
      chartLimit = YarnLevel.Simulator._optimalResult.bufferLimit || 6;
    }

    if (chartData && chartData.length > 0) {
      var chartContainer = document.getElementById('buffer-chart-container');
      if (chartContainer) chartContainer.style.display = 'block';
      if (YarnLevel.App && YarnLevel.App.showBufferChart) {
        YarnLevel.App.showBufferChart(chartData, chartLimit, state.steps);
      }
    }

    // 融合压力曲线（与编辑模式同步）：用玩家三档+全知算 ds，画按球融合曲线+卡点窗口
    if (YarnLevel.App && YarnLevel.App.drawFusedChart && YarnLevel.Simulator._playerTiers && YarnLevel.Validator.computeDifficultyScore) {
      try {
        var _ds = YarnLevel.Validator.computeDifficultyScore(
          YarnLevel.Simulator._playerTiers,
          { omniResult: YarnLevel.Simulator._omniResult }
        );
        if (_ds && _ds.ballCurve) YarnLevel.App.drawFusedChart(_ds, _ds.bufferLimit || 7);
      } catch (e) { /* 忽略 */ }
    }
  }

  /**
   * 绑定事件
   */
  function bindEvents() {
    var resetBtn = document.getElementById('sim-reset-btn');
    if (resetBtn) resetBtn.onclick = function() { reset(); };
    var resetBtn2 = document.getElementById('sim-reset-btn2');
    if (resetBtn2) resetBtn2.onclick = function() { reset(); };
    var undoBtn = document.getElementById('sim-undo-btn');
    if (undoBtn) undoBtn.onclick = function() { undo(); };
    var exitBtn = document.getElementById('sim-exit-btn');
    if (exitBtn) exitBtn.onclick = function() {
      exit();
      if (YarnLevel.App && YarnLevel.App.exitSimMode) YarnLevel.App.exitSimMode();
    };

    // 快进按钮
    var adv1 = document.getElementById('sim-advance-1');
    if (adv1) adv1.onclick = function() { autoAdvance(1); };
    var adv5 = document.getElementById('sim-advance-5');
    if (adv5) adv5.onclick = function() { autoAdvance(5); };
    var adv10 = document.getElementById('sim-advance-10');
    if (adv10) adv10.onclick = function() { autoAdvance(10); };

    // 跳转按钮
    var jumpBtn = document.getElementById('sim-jump-btn');
    if (jumpBtn) jumpBtn.onclick = function() {
      var input = document.getElementById('sim-jump-input');
      var target = parseInt(input.value);
      if (!isNaN(target) && target >= 0) {
        jumpToStep(target);
      }
    };
    // 回车跳转
    var jumpInput = document.getElementById('sim-jump-input');
    if (jumpInput) jumpInput.onkeydown = function(e) {
      if (e.key === 'Enter') {
        var target = parseInt(this.value);
        if (!isNaN(target) && target >= 0) {
          jumpToStep(target);
        }
      }
    };

    // 档位切换按钮
    var tierBtns = document.querySelectorAll('.sim-tier-btn');
    for (var tbi = 0; tbi < tierBtns.length; tbi++) {
      tierBtns[tbi].onclick = function() {
        switchTier(this.getAttribute('data-tier'));
      };
    }
  }

  /**
   * 切换模拟档位（novice/mid/strong/combined/omni），重置推演到第0步
   */
  function switchTier(which) {
    if (!state) return;
    var pt = YarnLevel.Simulator._playerTiers;
    var src = null;
    if (which === 'omni') {
      src = YarnLevel.Simulator._omniResult || (YarnLevel._ensureSimRoute ? YarnLevel._ensureSimRoute('omni') : null);
    } else if (which === 'combined') {
      src = (YarnLevel._ensureSimRoute ? YarnLevel._ensureSimRoute('combined') : pt) || null;
    } else if (pt && pt.tiers && pt.tiers[which]) {
      src = pt.tiers[which];
    } else if (YarnLevel._ensureSimRoute) {
      src = YarnLevel._ensureSimRoute(which);
    }
    if (!src || !src.pickOrder) return;
    YarnLevel.Simulator._optimalResult = src;
    YarnLevel.Simulator._routeTier = which;
    // 重置推演到第0步（保留当前关卡与所选路线）
    reset();
  }

  /**
   * 按最优解法自动推进n步（无动画）
   */
  function autoAdvance(n) {
    if (!state || !YarnLevel.Simulator._optimalResult) return;
    var pickOrder = YarnLevel.Simulator._optimalResult.pickOrder;
    if (!pickOrder || pickOrder.length === 0) return;

    for (var i = 0; i < n; i++) {
      var currentStep = state.steps;
      // 找到pickOrder中step === currentStep+1的主球（跳过锁链配对条目）
      var nextPick = null;
      for (var oi = 0; oi < pickOrder.length; oi++) {
        if (pickOrder[oi].step === currentStep + 1 && pickOrder[oi].note !== '锁链配对') {
          nextPick = pickOrder[oi];
          break;
        }
      }
      if (!nextPick) break;

      var row = nextPick.row;
      var col = nextPick.col;
      if (canPick(row, col)) {
        executePick(row, col);
      } else {
        break;
      }
    }
    render();
  }

  /**
   * 跳转到指定步数（重置后自动推进到目标步）
   */
  function jumpToStep(targetStep) {
    if (!state || !YarnLevel.Simulator._optimalResult) return;
    if (targetStep < 0) targetStep = 0;

    var pickOrder = YarnLevel.Simulator._optimalResult.pickOrder;
    var maxStep = pickOrder ? pickOrder.length : 0;
    if (targetStep > maxStep) targetStep = maxStep;

    // 如果目标步数小于当前步数，需要重置
    if (targetStep < state.steps) {
      // 保存optResult
      var optResult = YarnLevel.Simulator._optimalResult;
      var spools = YarnLevel.deepClone(state.spools);
      var maprow = state.maprow;
      var mapcol = state.mapcol;
      var blocks = YarnLevel.deepClone(state.blocks);

      // 退出再进入（不触发UI切换）
      active = false;
      state = null;
      animating = false;

      // 重新初始化（不调showSimUI因为已经在模拟中）
      enter_internal(spools, maprow, mapcol, blocks);
      YarnLevel.Simulator._optimalResult = optResult;
    }

    // 从当前步数推进到目标步数
    var stepsNeeded = targetStep - state.steps;
    if (stepsNeeded > 0) {
      autoAdvance(stepsNeeded);
    } else {
      render();
    }
  }

  /**
   * 内部进入（不切换UI，用于jumpToStep重置）
   */
  function enter_internal(spools, maprow, mapcol, blocks) {
    active = true;
    animating = false;
    state = {
      spools: YarnLevel.deepClone(spools),
      maprow: maprow,
      mapcol: mapcol,
      blocks: blocks ? YarnLevel.deepClone(blocks) : [],
      activated: {},
      picked: {},
      frozen: {},
      pipes: [],
      pipeReleasedAt: {},
      occupiedCells: {},
      buffer: [],
      targetColumns: [],
      targetEliminated: {},
      steps: 0,
      eliminatedSpools: 0,
      totalTargetPixels: 0,
      totalTargetSpools: 0,
      history: [],
      realBufferHistory: []
    };

    for (var c = 0; c < mapcol; c++) {
      var s = spools[0] && spools[0][c];
      if (s && !YarnLevel.Validator.isObstacle(s)) {
        state.activated['0,' + c] = true;
      }
    }

    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var s = spools[r] && spools[r][c];
        if (s && s.id > 0 && !YarnLevel.isPipeType(s.type)) {
          state.occupiedCells[r + ',' + c] = true;
        }
      }
    }

    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var s = spools[r] && spools[r][c];
        if (!s) continue;
        var types = Array.isArray(s.type) ? s.type : [s.type];
        if (types.indexOf(4) !== -1 && s.id > 0) {
          state.frozen[r + ',' + c] = {
            activated: !!state.activated[r + ',' + c],
            thawProgress: (r === 0 ? -1 : 0)
          };
        }
      }
    }

    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var s = spools[r] && spools[r][c];
        if (s && YarnLevel.isPipeType(s.type) && Array.isArray(s.param) && s.param.length > 0) {
          var dir = YarnLevel.getPipeDirection(s.type);
          var exitR = r, exitC = c;
          if (dir === 11) exitR = r - 1;
          else if (dir === 12) exitC = c + 1;
          else if (dir === 13) exitR = r + 1;
          else if (dir === 14) exitC = c - 1;
          state.pipes.push({
            row: r, col: c,
            exitRow: exitR, exitCol: exitC,
            param: s.param.slice(),
            nextRelease: 0
          });
        }
      }
    }

    if (blocks && blocks.length > 0) {
      var bCols = blocks[0].length;
      for (var c = 0; c < bCols; c++) {
        var col = [];
        for (var r = blocks.length - 1; r >= 0; r--) {
          var _bid = YarnLevel.getBlockId(blocks[r] && blocks[r][c]);
          if (_bid > 0) {
            col.push({ colorId: _bid, origRow: r, origCol: c });
            state.totalTargetPixels++;
          }
        }
        state.targetColumns.push(col);
      }
    }
    var totalSpools2 = 0;
    for (var sr = 0; sr < maprow; sr++) {
      for (var sc = 0; sc < mapcol; sc++) {
        var ssp = spools[sr] && spools[sr][sc];
        if (!ssp) continue;
        if (ssp.id > 0 && !YarnLevel.isPipeType(ssp.type)) totalSpools2++;
        if (YarnLevel.isPipeType(ssp.type) && Array.isArray(ssp.param)) {
          for (var spi = 0; spi < ssp.param.length; spi++) {
            if (YarnLevel.getPipeItemId(ssp.param[spi]) > 0) totalSpools2++;
          }
        }
      }
    }
    state.totalTargetSpools = totalSpools2;

    checkPipeRelease();
  }

  return {
    isActive: isActive,
    enter: enter,
    exit: exit,
    render: render,
    undo: undo,
    reset: reset,
    getState: function() { return state; }
  };
})();
