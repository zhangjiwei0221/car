/**
 * 蚂蚁拿块求解器 - 求解算法模块
 * 
 * 复用毛线求解器的3步前瞻框架：
 * - 对每个可取蚂蚁盒展开3步搜索树，计算3步总分，选总分最高路径的第1步
 * - 暂存安全检查作为否决权
 * - 多轮带噪声重试确保通关率
 * 
 * 核心差异：消除匹配从"栈顶弹出"改为"四方向flood-fill扩展"
 */

var AntSolver = AntSolver || {};

AntSolver.Solver = (function() {

  /**
   * 主求解入口
   * @param {object} level - 解析后的关卡数据
   * @returns {object} 求解结果
   */
  function solve(level) {
    var startTime = Date.now();

    // 第1轮：无噪声确定性求解
    var best = runSolver(level, 0, 1);
    if (best.completed) {
      best.time = Date.now() - startTime;
      return best;
    }

    // 未通关 → 多轮带随机扰动重试
    var retryConfigs = [
      { noise: 0.3, seed: 17 },
      { noise: 0.6, seed: 53 },
      { noise: 0.9, seed: 101 },
      { noise: 1.2, seed: 211 },
      { noise: 0.5, seed: 307 },
      { noise: 1.5, seed: 401 },
      { noise: 2.0, seed: 599 },
      { noise: 1.0, seed: 733 }
    ];

    for (var i = 0; i < retryConfigs.length; i++) {
      var cfg = retryConfigs[i];
      var r = runSolver(level, cfg.noise, cfg.seed);
      if (r.completed) {
        r.time = Date.now() - startTime;
        r.retryRound = i + 1;
        return r;
      }
      if (r.eliminatedPixels > best.eliminatedPixels) best = r;
    }

    best.time = Date.now() - startTime;
    return best;
  }

  /**
   * 单轮求解器（3步前瞻）
   */
  function runSolver(level, noise, seed) {
    var LOOKAHEAD = 3;
    var BUFFER_LIMIT = level.bufferLimit || 5;

    // 伪随机数生成器
    var _rngState = (seed || 1) >>> 0;
    function rng() {
      _rngState = (_rngState * 1664525 + 1013904223) & 0xFFFFFFFF;
      return (_rngState >>> 0) / 4294967296;
    }

    // 初始化状态
    var state = AntSolver.Simulator.createState(level);

    var pickOrder = [];
    var stepBufferHistory = [];
    var maxSteps = state.totalBoxes + 50; // 安全上限

    // 主循环
    while (!state.gameOver && state.steps < maxSteps) {
      var moves = getAvailableMovesFromState(state);
      if (moves.length === 0) break;

      // 对每个可选操作，进行前瞻评分
      var bestMove = null;
      var bestScore = -Infinity;

      for (var m = 0; m < moves.length; m++) {
        var move = moves[m];

        // 检查暂存安全：如果暂存满且这个盒子消不完，跳过
        if (move.blocked) continue;

        // 1步评分
        var score1 = evaluateMove(state, move);

        // 2-3步前瞻（简化版）
        var totalScore = score1;
        if (LOOKAHEAD >= 2 && moves.length > 1) {
          var simState2 = cloneState(state);
          applyMove(simState2, move);
          var moves2 = getAvailableMovesFromState(simState2);
          if (moves2.length > 0) {
            var best2 = -Infinity;
            for (var m2 = 0; m2 < Math.min(moves2.length, 5); m2++) {
              var s2 = evaluateMove(simState2, moves2[m2]);
              if (LOOKAHEAD >= 3) {
                var simState3 = cloneState(simState2);
                applyMove(simState3, moves2[m2]);
                var moves3 = getAvailableMovesFromState(simState3);
                if (moves3.length > 0) {
                  var best3 = -Infinity;
                  for (var m3 = 0; m3 < Math.min(moves3.length, 4); m3++) {
                    var s3 = evaluateMove(simState3, moves3[m3]);
                    if (s3 > best3) best3 = s3;
                  }
                  s2 += best3 * 0.5;
                }
              }
              if (s2 > best2) best2 = s2;
            }
            totalScore += best2 * 0.7;
          }
        }

        // 加入随机噪声
        if (noise > 0) {
          totalScore += (rng() - 0.5) * noise * 20;
        }

        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestMove = move;
        }
      }

      if (!bestMove) {
        // 所有操作都被阻止，选第一个未blocked的
        for (var m = 0; m < moves.length; m++) {
          if (!moves[m].blocked) { bestMove = moves[m]; break; }
        }
        if (!bestMove) break; // 真的无路可走
      }

      // 执行选中的操作
      applyMove(state, bestMove);
      pickOrder.push({
        step: state.steps,
        queueIdx: bestMove.queueIdx,
        color: bestMove.antBox.color,
        count: bestMove.antBox.count
      });
      stepBufferHistory.push(state.buffer.length);

      // 检查胜负
      if (state.eliminatedPixels >= state.totalPixels) {
        state.gameWon = true;
        state.gameOver = true;
      }
      if (state.buffer.length > BUFFER_LIMIT) {
        AntSolver.Simulator.autoReleaseBuffer(state);
        if (state.buffer.length > BUFFER_LIMIT) {
          state.gameOver = true;
          state.gameWon = false;
        }
      }
    }

    var progress = state.totalPixels > 0 ? Math.round(state.eliminatedPixels / state.totalPixels * 100) : 0;

    return {
      completed: state.gameWon,
      steps: state.steps,
      eliminatedPixels: state.eliminatedPixels,
      totalPixels: state.totalPixels,
      completedBoxes: state.completedBoxes,
      totalBoxes: state.totalBoxes,
      maxBuffer: Math.max.apply(null, stepBufferHistory.concat([0])),
      avgBuffer: stepBufferHistory.length > 0 ? (stepBufferHistory.reduce(function(a,b){return a+b;},0) / stepBufferHistory.length).toFixed(2) : 0,
      progress: progress,
      pickOrder: pickOrder,
      stepBufferHistory: stepBufferHistory
    };
  }

  /**
   * 评估一个操作的得分
   */
  function evaluateMove(state, move) {
    var score = 0;
    var antBox = move.antBox;

    // 1. 能否完全消除（不进暂存）→ 高分
    if (move.canConsume) {
      score += 30;
    } else {
      // 进暂存 → 根据当前暂存压力扣分
      var bufLen = state.buffer.length;
      if (bufLen >= 4) score -= 20;
      else if (bufLen >= 3) score -= 10;
      else if (bufLen >= 2) score -= 5;
      else score -= 2;
    }

    // 2. 消除数量越多越好（即使进暂存也有部分消除）
    var tempElim = [];
    for (var r = 0; r < state.rows; r++) {
      tempElim.push(state.eliminated[r].slice());
    }
    var potential = AntSolver.Simulator.floodFillEliminate(
      tempElim, state.blocks, state.rows, state.cols, antBox.color, antBox.count
    );
    score += potential * 2;

    // 3. 消除后能否释放暂存中的盒子（连锁效应）
    var bufferRelease = 0;
    for (var i = 0; i < state.buffer.length; i++) {
      var item = state.buffer[i];
      var remaining = item.need - item.progress;
      var canRelease = AntSolver.Simulator.floodFillEliminate(
        AntSolver.deepClone(tempElim), state.blocks, state.rows, state.cols, item.color, remaining
      );
      if (canRelease >= remaining) bufferRelease++;
    }
    score += bufferRelease * 15;

    // 4. 暂存区中已有同色的球 → 优先消同色（可能连锁释放）
    for (var i = 0; i < state.buffer.length; i++) {
      if (state.buffer[i].color === antBox.color) {
        score += 8;
        break;
      }
    }

    // 5. 距离微惩罚：队列越靠后的盒子稍微降优先级
    score -= move.queueIdx * 0.1;

    return score;
  }

  /**
   * 从状态获取所有可用操作
   */
  function getAvailableMovesFromState(state) {
    var moves = [];
    for (var i = 0; i < state.queues.length; i++) {
      var head = state.queueHeads[i];
      if (head < state.queues[i].length) {
        var antBox = state.queues[i][head];
        var canConsume = AntSolver.Simulator.canConsumeAntBox(state, antBox);
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
   * 在状态上执行一个操作
   */
  function applyMove(state, move) {
    state.steps++;
    state.queueHeads[move.queueIdx]++;
    AntSolver.Simulator.processAntBox(state, move.antBox);
  }

  /**
   * 深拷贝状态（轻量化：只复制关键部分）
   */
  function cloneState(state) {
    var s = {
      level: state.level,
      rows: state.rows,
      cols: state.cols,
      blocks: state.blocks, // blocks不变，共享引用
      queues: state.queues, // queues不变，共享引用
      queueHeads: state.queueHeads.slice(),
      eliminated: [],
      buffer: AntSolver.deepClone(state.buffer),
      bufferLimit: state.bufferLimit,
      steps: state.steps,
      eliminatedPixels: state.eliminatedPixels,
      totalPixels: state.totalPixels,
      totalBoxes: state.totalBoxes,
      completedBoxes: state.completedBoxes,
      history: [],
      gameOver: state.gameOver,
      gameWon: state.gameWon
    };
    for (var r = 0; r < state.rows; r++) {
      s.eliminated.push(state.eliminated[r].slice());
    }
    return s;
  }

  return {
    solve: solve,
    runSolver: runSolver
  };
})();
