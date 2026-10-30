/**
 * 蚂蚁拿块求解器 - 主应用UI模块
 */

var AntSolver = AntSolver || {};

AntSolver.App = (function() {
  var currentLevel = null;
  var simulating = false;

  function init() {
    document.getElementById('btn-import').addEventListener('click', importLevel);
    document.getElementById('btn-sample').addEventListener('click', loadSample);
    document.getElementById('btn-solve').addEventListener('click', runSolve);
    document.getElementById('btn-simulate').addEventListener('click', enterSimulation);
    document.getElementById('btn-exit-sim').addEventListener('click', exitSimulation);
    document.getElementById('btn-undo').addEventListener('click', doUndo);
    document.getElementById('btn-reset').addEventListener('click', doReset);
    document.getElementById('btn-auto-step').addEventListener('click', autoStep);
    document.getElementById('btn-auto-all').addEventListener('click', autoAll);
    document.getElementById('file-input').addEventListener('change', handleFileSelect);
  }

  // ==================== 关卡导入 ====================
  function importLevel() {
    document.getElementById('file-input').click();
  }

  function handleFileSelect(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var json = JSON.parse(ev.target.result);
        loadLevel(json);
      } catch (err) {
        alert('JSON解析失败: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function loadSample() {
    var json = AntSolver.generateSampleLevel();
    loadLevel(json);
  }

  function loadLevel(json) {
    currentLevel = AntSolver.parseLevel(json);
    document.getElementById('btn-simulate').disabled = false;
    document.getElementById('solve-result').classList.add('hidden');
    exitSimulation();
    renderLevelInfo();
    renderTarget();
    renderQueues();
  }

  // ==================== 渲染 ====================
  function renderLevelInfo() {
    if (!currentLevel) return;
    var html = '<p>目标图: ' + currentLevel.rows + ' × ' + currentLevel.cols + '</p>';
    html += '<p>总像素: ' + currentLevel.totalPixels + '</p>';
    html += '<p>队列数: ' + currentLevel.queues.length + '</p>';
    var totalBoxes = 0;
    for (var i = 0; i < currentLevel.queues.length; i++) totalBoxes += currentLevel.queues[i].length;
    html += '<p>蚂蚁盒总数: ' + totalBoxes + '</p>';
    html += '<p>暂存上限: ' + currentLevel.bufferLimit + '</p>';
    html += '<hr style="border-color:#333;margin:8px 0">';
    html += '<p>颜色分布:</p>';
    for (var id in currentLevel.colorCounts) {
      var c = AntSolver.getColorCSS(parseInt(id));
      html += '<span style="display:inline-block;width:12px;height:12px;background:' + c + ';border-radius:2px;margin-right:4px;vertical-align:middle"></span>';
      html += '<span style="font-size:11px">' + AntSolver.getColorName(parseInt(id)) + ': ' + currentLevel.colorCounts[id] + '</span><br>';
    }
    document.getElementById('status-content').innerHTML = html;
  }

  function renderTarget(eliminated) {
    if (!currentLevel) return;
    var canvas = document.getElementById('target-canvas');
    var rows = currentLevel.rows, cols = currentLevel.cols;

    // 自适应格子大小
    var maxW = 500, maxH = 400;
    var cellSize = Math.min(Math.floor(maxW / cols), Math.floor(maxH / rows), 24);
    if (cellSize < 3) cellSize = 3;
    var gap = cellSize > 8 ? 1 : 0;
    var step = cellSize + gap;

    canvas.width = cols * step;
    canvas.height = rows * step;
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var colorId = currentLevel.blocks[r][c];
        var isElim = eliminated && eliminated[r][c];
        if (colorId > 0 && !isElim) {
          ctx.fillStyle = AntSolver.getColorCSS(colorId);
        } else if (isElim) {
          ctx.fillStyle = '#111'; // 已消除显示为暗色
        } else {
          ctx.fillStyle = '#222';
        }
        ctx.fillRect(c * step, r * step, cellSize, cellSize);

        // 已消除标记
        if (isElim && colorId > 0) {
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(c * step, r * step);
          ctx.lineTo(c * step + cellSize, r * step + cellSize);
          ctx.moveTo(c * step + cellSize, r * step);
          ctx.lineTo(c * step, r * step + cellSize);
          ctx.stroke();
        }
      }
    }

    // 高亮可消除边界
    if (eliminated) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (eliminated[r][c]) continue;
          if (currentLevel.blocks[r][c] <= 0) continue;
          // 检查是否为边界可达
          var reachable = false;
          if (r === 0 || r === rows-1 || c === 0 || c === cols-1) reachable = true;
          else {
            for (var d = 0; d < dirs.length; d++) {
              var nr = r + dirs[d][0], nc = c + dirs[d][1];
              if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || eliminated[nr][nc]) {
                reachable = true; break;
              }
            }
          }
          if (reachable) {
            ctx.strokeRect(c * step + 0.5, r * step + 0.5, cellSize - 1, cellSize - 1);
          }
        }
      }
    }

    var info = document.getElementById('target-info');
    if (eliminated) {
      var elim = 0;
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) if (eliminated[r][c]) elim++;
      info.textContent = '已消除 ' + elim + ' / ' + currentLevel.totalPixels + ' (' + Math.round(elim/currentLevel.totalPixels*100) + '%)';
    } else {
      info.textContent = rows + '×' + cols + ' | ' + currentLevel.totalPixels + ' 像素';
    }
  }

  function renderQueues(state) {
    var container = document.getElementById('board-queues');
    if (!currentLevel) { container.innerHTML = ''; return; }

    var html = '';
    for (var q = 0; q < currentLevel.queues.length; q++) {
      html += '<div class="queue-row">';
      html += '<span class="queue-label">Q' + (q+1) + '</span>';
      var queue = currentLevel.queues[q];
      var headIdx = state ? state.queueHeads[q] : 0;
      for (var i = 0; i < queue.length; i++) {
        var box = queue[i];
        var color = AntSolver.getColorCSS(box.color);
        var classes = 'ant-box';
        if (state && i < headIdx) classes += ' picked';
        if (state && i === headIdx) classes += ' head';
        if (!state && i === 0) classes += ' head';
        html += '<div class="' + classes + '" style="background:' + color + '" ';
        html += 'data-queue="' + q + '" data-idx="' + i + '" ';
        html += 'title="' + AntSolver.getColorName(box.color) + ' ×' + box.count + '">';
        html += box.count;
        html += '</div>';
      }
      html += '</div>';
    }
    container.innerHTML = html;

    // 绑定点击事件（模拟模式）
    if (simulating) {
      var boxes = container.querySelectorAll('.ant-box.head');
      for (var i = 0; i < boxes.length; i++) {
        boxes[i].addEventListener('click', handleBoxClick);
      }
    }
  }

  function handleBoxClick(e) {
    var qIdx = parseInt(e.currentTarget.dataset.queue);
    var success = AntSolver.Simulator.pickFromQueue(qIdx);
    if (success) refreshSimUI();
  }

  function renderBuffer(state) {
    var limit = state ? state.bufferLimit : 5;
    document.getElementById('buffer-count').textContent = (state ? state.buffer.length : 0) + '/' + limit;
    var html = '';
    for (var i = 0; i < limit; i++) {
      if (state && i < state.buffer.length) {
        var item = state.buffer[i];
        var c = AntSolver.getColorCSS(item.color);
        html += '<div class="buffer-slot filled" style="background:' + c + '">';
        html += item.progress + '/' + item.need;
        html += '</div>';
      } else {
        html += '<div class="buffer-slot empty"></div>';
      }
    }
    document.getElementById('buffer-slots').innerHTML = html;
  }

  function renderStats(state) {
    if (!state) return;
    document.getElementById('stat-steps').textContent = state.steps;
    document.getElementById('stat-eliminated').textContent = state.eliminatedPixels;
    document.getElementById('stat-total').textContent = state.totalPixels;
    var pct = state.totalPixels > 0 ? Math.round(state.eliminatedPixels / state.totalPixels * 100) : 0;
    document.getElementById('stat-progress').textContent = pct + '%';
  }

  // ==================== 模拟模式 ====================
  function enterSimulation() {
    if (!currentLevel) return;
    simulating = true;
    AntSolver.Simulator.enter(currentLevel);
    document.getElementById('sim-ui').classList.remove('hidden');
    document.getElementById('btn-simulate').disabled = true;
    document.getElementById('btn-exit-sim').classList.remove('hidden');
    document.getElementById('status-title').textContent = '模拟游玩';
    refreshSimUI();
  }

  function exitSimulation() {
    simulating = false;
    AntSolver.Simulator.exit();
    document.getElementById('sim-ui').classList.add('hidden');
    document.getElementById('btn-simulate').disabled = !currentLevel;
    document.getElementById('btn-exit-sim').classList.add('hidden');
    document.getElementById('status-title').textContent = '关卡信息';
    if (currentLevel) {
      renderTarget();
      renderQueues();
      renderLevelInfo();
    }
  }

  function refreshSimUI() {
    var state = AntSolver.Simulator.getState();
    if (!state) return;
    renderTarget(state.eliminated);
    renderQueues(state);
    renderBuffer(state);
    renderStats(state);

    if (state.gameOver) {
      if (state.gameWon) {
        setTimeout(function() { alert('通关！步数: ' + state.steps); }, 100);
      } else {
        setTimeout(function() { alert('失败！暂存区溢出'); }, 100);
      }
    }
  }

  function doUndo() {
    AntSolver.Simulator.undo();
    refreshSimUI();
  }

  function doReset() {
    AntSolver.Simulator.reset();
    refreshSimUI();
  }

  function autoStep() {
    if (!AntSolver.Simulator.isActive()) return;
    var state = AntSolver.Simulator.getState();
    if (state.gameOver) return;

    // 用求解器选一步
    var moves = AntSolver.Simulator.getAvailableMoves();
    if (moves.length === 0) return;

    // 简单贪心：优先选能完全消除的
    var best = null;
    for (var i = 0; i < moves.length; i++) {
      if (moves[i].canConsume) { best = moves[i]; break; }
    }
    if (!best) best = moves[0]; // 没有完美选择就选第一个

    AntSolver.Simulator.pickFromQueue(best.queueIdx);
    refreshSimUI();
  }

  function autoAll() {
    if (!AntSolver.Simulator.isActive()) return;
    var state = AntSolver.Simulator.getState();
    var count = 0;
    while (!state.gameOver && count < 200) {
      autoStep();
      state = AntSolver.Simulator.getState();
      count++;
    }
    refreshSimUI();
  }

  // ==================== 求解 ====================
  function runSolve() {
    if (!currentLevel) { alert('请先导入关卡'); return; }

    document.getElementById('solve-result').classList.remove('hidden');
    document.getElementById('solve-details').innerHTML = '<p>正在求解...</p>';

    setTimeout(function() {
      var result = AntSolver.Solver.solve(currentLevel);
      displaySolveResult(result);
    }, 50);
  }

  function displaySolveResult(result) {
    var html = '';
    if (result.completed) {
      html += '<p class="pass">✅ 通关！</p>';
    } else {
      html += '<p class="fail">❌ 未通关 (进度: ' + result.progress + '%)</p>';
    }
    html += '<p>步数: ' + result.steps + '</p>';
    html += '<p>消除: ' + result.eliminatedPixels + ' / ' + result.totalPixels + '</p>';
    html += '<p>完成盒子: ' + result.completedBoxes + ' / ' + result.totalBoxes + '</p>';
    html += '<p>最大暂存: ' + result.maxBuffer + '</p>';
    html += '<p>平均暂存: ' + result.avgBuffer + '</p>';
    html += '<p>耗时: ' + (result.time || 0) + 'ms</p>';
    if (result.retryRound) {
      html += '<p>重试轮次: ' + result.retryRound + '</p>';
    }
    html += '<hr style="border-color:#333;margin:8px 0">';
    html += '<p style="font-size:11px;color:#666">操作序列:</p>';
    html += '<div style="font-size:10px;max-height:200px;overflow:auto;color:#888">';
    for (var i = 0; i < result.pickOrder.length; i++) {
      var p = result.pickOrder[i];
      var c = AntSolver.getColorCSS(p.color);
      html += '<span style="color:' + c + '">●</span> ';
      html += 'Q' + (p.queueIdx + 1) + ' ' + AntSolver.getColorName(p.color) + '×' + p.count;
      if (i < result.pickOrder.length - 1) html += ' → ';
      if ((i + 1) % 5 === 0) html += '<br>';
    }
    html += '</div>';
    document.getElementById('solve-details').innerHTML = html;
  }

  // 启动
  document.addEventListener('DOMContentLoaded', init);
})();
