/**
 * 蚂蚁拿块求解器 - 模拟游玩模块
 * 
 * 核心规则：
 * 1. 玩家点击队列头部的蚂蚁盒 → 蚂蚁盒进入"工作状态"
 * 2. 蚂蚁从目标图的已消除边界，四方向匹配同色像素进行消除
 * 3. 如果蚂蚁盒消不完（目标色被其他色包围无法触达），进入暂存区
 * 4. 暂存区满(5个) 且 无法继续消除 = 失败
 * 5. 目标图所有像素被消除 = 通关
 * 
 * 消除逻辑（蚂蚁版）：
 *   目标图不动。初始状态：四条边的外围为"已消除"（蚂蚁可从外围进入）。
 *   蚂蚁盒激活后，从已消除区域的边界找同色像素，四方向扩展消除。
 *   一个蚂蚁盒最多消除其count个同色像素。
 *   消除后，新消除的格子成为新的"已消除"区域，扩展可消除边界。
 */

var AntSolver = AntSolver || {};

AntSolver.Simulator = (function() {
  var active = false;
  var state = null;

  function isActive() { return active; }
  function getState() { return state; }

  /**
   * 进入模拟模式
   */
  function enter(level) {
    active = true;
    state = createState(level);
    return state;
  }

  /**
   * 创建初始游戏状态
   */
  function createState(level) {
    var s = {
      level: level,
      rows: level.rows,
      cols: level.cols,
      blocks: AntSolver.deepClone(level.blocks),
      queues: AntSolver.deepClone(level.queues),
      // 每条队列的当前头部索引
      queueHeads: [],
      // 已消除的像素（2D布尔矩阵）
      eliminated: AntSolver.create2D(level.rows, level.cols, false),
      // 暂存区
      buffer: [],
      bufferLimit: level.bufferLimit || 5,
      // 统计
      steps: 0,
      eliminatedPixels: 0,
      totalPixels: level.totalPixels,
      totalBoxes: 0,
      completedBoxes: 0,
      // 历史（用于撤销）
      history: [],
      // 游戏状态
      gameOver: false,
      gameWon: false
    };

    // 初始化队列头部
    for (var i = 0; i < s.queues.length; i++) {
      s.queueHeads.push(0);
      s.totalBoxes += s.queues[i].length;
    }

    // 初始化已消除区域：目标图边界外一圈视为"已消除"
    // 实现方式：把边缘行列的像素标记为可接触（即外围全部开放）
    // 具体做法：创建一个扩展的虚拟边框，不修改eliminated矩阵
    // 在getBorderCells时，边缘像素自动成为边界（因为它们邻接"外部"）
    // 
    // 我们用一个特殊逻辑：如果一个格子在边缘(r=0, r=rows-1, c=0, c=cols-1)，
    // 它默认就是"可接触的"（即使周围没有已消除格子）

    return s;
  }

  /**
   * 判断一个格子是否"可消除"（边界可达）
   * 规则：格子尚未消除 + (邻接已消除格 或 位于目标图边缘)
   */
  function isCellReachable(s, r, c) {
    if (r < 0 || r >= s.rows || c < 0 || c >= s.cols) return false;
    if (s.eliminated[r][c]) return false;
    if (s.blocks[r][c] <= 0) return false;

    // 边缘格子始终可达
    if (r === 0 || r === s.rows - 1 || c === 0 || c === s.cols - 1) return true;

    // 邻接已消除格子则可达
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var d = 0; d < dirs.length; d++) {
      var nr = r + dirs[d][0], nc = c + dirs[d][1];
      if (nr < 0 || nr >= s.rows || nc < 0 || nc >= s.cols) {
        // 越界也算邻接外部
        return true;
      }
      if (s.eliminated[nr][nc]) return true;
    }
    return false;
  }

  /**
   * 获取当前所有可消除的边界格子（按颜色分组）
   */
  function getReachableCells(s) {
    var cells = [];
    for (var r = 0; r < s.rows; r++) {
      for (var c = 0; c < s.cols; c++) {
        if (isCellReachable(s, r, c)) {
          cells.push({ row: r, col: c, colorId: s.blocks[r][c] });
        }
      }
    }
    return cells;
  }

  /**
   * 获取某颜色在边界上可消除的像素数量
   */
  function countReachableByColor(s, colorId) {
    var count = 0;
    // 使用flood-fill：从所有当前可达的同色格开始，扩展消除
    // 因为消除一个格子会打开新的路径，需要迭代
    var tempElim = [];
    for (var r = 0; r < s.rows; r++) {
      tempElim.push(s.eliminated[r].slice());
    }
    return floodFillCount(tempElim, s.blocks, s.rows, s.cols, colorId);
  }

  /**
   * 核心消除函数：flood-fill 四方向扩展消除
   * 模拟一个蚂蚁盒的消除过程
   * 
   * @param {Array} eliminated - 已消除矩阵（会被修改！）
   * @param {Array} blocks - 目标图
   * @param {number} rows, cols - 尺寸
   * @param {number} colorId - 目标颜色
   * @param {number} maxCount - 最多消除多少个
   * @returns {number} 实际消除数量
   */
  function floodFillEliminate(eliminated, blocks, rows, cols, colorId, maxCount) {
    var count = 0;
    var changed = true;

    while (changed && count < maxCount) {
      changed = false;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (count >= maxCount) break;
          if (eliminated[r][c]) continue;
          if (blocks[r][c] !== colorId) continue;

          // 检查是否可达（邻接已消除 或 边缘）
          var reachable = false;
          if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
            reachable = true;
          } else {
            var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            for (var d = 0; d < dirs.length; d++) {
              var nr = r + dirs[d][0], nc = c + dirs[d][1];
              if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || eliminated[nr][nc]) {
                reachable = true;
                break;
              }
            }
          }

          if (reachable) {
            eliminated[r][c] = true;
            count++;
            changed = true;
          }
        }
      }
    }
    return count;
  }

  /**
   * 计算某颜色最多能消除多少个（不实际修改状态）
   */
  function floodFillCount(tempElim, blocks, rows, cols, colorId) {
    return floodFillEliminate(tempElim, blocks, rows, cols, colorId, Infinity);
  }

  /**
   * 执行一个蚂蚁盒的消除
   * @param {object} antBox - {color, count}
   * @returns {object} {eliminated: 消除数, completed: 是否完成}
   */
  function executeAntBox(s, antBox) {
    var colorId = antBox.color;
    var maxCount = antBox.count;
    var actual = floodFillEliminate(s.eliminated, s.blocks, s.rows, s.cols, colorId, maxCount);
    s.eliminatedPixels += actual;
    return { eliminated: actual, completed: actual >= maxCount, remaining: maxCount - actual };
  }

  /**
   * 处理蚂蚁盒进场（暂存+消除逻辑）
   */
  function processAntBox(s, antBox) {
    var result = executeAntBox(s, antBox);

    if (result.completed) {
      s.completedBoxes++;
    } else {
      // 未完成，进入暂存区
      s.buffer.push({
        color: antBox.color,
        progress: result.eliminated,
        need: antBox.count,
        remaining: result.remaining
      });
    }

    // 尝试释放暂存区中的盒子
    autoReleaseBuffer(s);
  }

  /**
   * 自动释放暂存区：检查暂存中的盒子是否可以继续消除
   */
  function autoReleaseBuffer(s) {
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = s.buffer.length - 1; i >= 0; i--) {
        var item = s.buffer[i];
        var remaining = item.need - item.progress;
        if (remaining <= 0) {
          s.buffer.splice(i, 1);
          s.completedBoxes++;
          changed = true;
          continue;
        }
        // 尝试继续消除
        var actual = floodFillEliminate(s.eliminated, s.blocks, s.rows, s.cols, item.color, remaining);
        if (actual > 0) {
          item.progress += actual;
          item.remaining -= actual;
          s.eliminatedPixels += actual;
          if (item.progress >= item.need) {
            s.buffer.splice(i, 1);
            s.completedBoxes++;
          }
          changed = true;
        }
      }
    }
  }

  /**
   * 玩家点击某队列的头部蚂蚁盒
   * @param {number} queueIdx - 队列索引
   * @returns {boolean} 是否成功
   */
  function pickFromQueue(queueIdx) {
    if (!state || state.gameOver) return false;
    if (queueIdx < 0 || queueIdx >= state.queues.length) return false;

    var head = state.queueHeads[queueIdx];
    var queue = state.queues[queueIdx];
    if (head >= queue.length) return false;

    // 暂存区满时不能再取（除非能立即消完）
    // 这里先允许取，如果消不完再进暂存，暂存满了判失败

    // 保存历史
    saveHistory();

    state.steps++;
    var antBox = queue[head];
    state.queueHeads[queueIdx] = head + 1;

    // 执行消除
    processAntBox(state, antBox);

    // 检查胜负
    checkWinLose();

    return true;
  }

  /**
   * 检查胜负
   */
  function checkWinLose() {
    if (state.eliminatedPixels >= state.totalPixels) {
      state.gameWon = true;
      state.gameOver = true;
      return;
    }

    if (state.buffer.length > state.bufferLimit) {
      // 暂存溢出，检查是否能释放
      autoReleaseBuffer(state);
      if (state.buffer.length > state.bufferLimit) {
        state.gameOver = true;
        state.gameWon = false;
      }
    }
  }

  /**
   * 获取所有可选的操作（可点击的队列头）
   */
  function getAvailableMoves() {
    if (!state || state.gameOver) return [];
    var moves = [];
    for (var i = 0; i < state.queues.length; i++) {
      var head = state.queueHeads[i];
      if (head < state.queues[i].length) {
        // 检查暂存区是否允许（暂存满且这个盒子消不完→不允许）
        var antBox = state.queues[i][head];
        var canConsume = canConsumeAntBox(state, antBox);
        moves.push({
          queueIdx: i,
          antBox: antBox,
          canConsume: canConsume,
          blocked: state.buffer.length >= state.bufferLimit && !canConsume
        });
      }
    }
    return moves;
  }

  /**
   * 判断一个蚂蚁盒能否完全消除（不进暂存）
   */
  function canConsumeAntBox(s, antBox) {
    // 模拟消除（不实际修改）
    var tempElim = [];
    for (var r = 0; r < s.rows; r++) {
      tempElim.push(s.eliminated[r].slice());
    }
    var actual = floodFillEliminate(tempElim, s.blocks, s.rows, s.cols, antBox.color, antBox.count);
    return actual >= antBox.count;
  }

  function saveHistory() {
    state.history.push({
      queueHeads: state.queueHeads.slice(),
      eliminated: AntSolver.deepClone(state.eliminated),
      buffer: AntSolver.deepClone(state.buffer),
      steps: state.steps,
      eliminatedPixels: state.eliminatedPixels,
      completedBoxes: state.completedBoxes,
      gameOver: state.gameOver,
      gameWon: state.gameWon
    });
  }

  function undo() {
    if (!state || state.history.length === 0) return false;
    var prev = state.history.pop();
    state.queueHeads = prev.queueHeads;
    state.eliminated = prev.eliminated;
    state.buffer = prev.buffer;
    state.steps = prev.steps;
    state.eliminatedPixels = prev.eliminatedPixels;
    state.completedBoxes = prev.completedBoxes;
    state.gameOver = prev.gameOver;
    state.gameWon = prev.gameWon;
    return true;
  }

  function reset() {
    if (!state) return;
    var level = state.level;
    exit();
    enter(level);
  }

  function exit() {
    active = false;
    state = null;
  }

  // 暴露公共API
  return {
    isActive: isActive,
    getState: getState,
    enter: enter,
    exit: exit,
    reset: reset,
    pickFromQueue: pickFromQueue,
    getAvailableMoves: getAvailableMoves,
    undo: undo,
    // 工具函数（供求解器使用）
    floodFillEliminate: floodFillEliminate,
    floodFillCount: floodFillCount,
    isCellReachable: isCellReachable,
    getReachableCells: getReachableCells,
    createState: createState,
    processAntBox: processAntBox,
    autoReleaseBuffer: autoReleaseBuffer,
    canConsumeAntBox: canConsumeAntBox,
    executeAntBox: executeAntBox
  };
})();
