/**
 * 毛线JSON关卡编辑器 - 应用入口和主控制器
 */

var YarnLevel = YarnLevel || {};

YarnLevel.App = (function() {
  // 当前关卡数据
  var levelData = null;

  function init() {
    YarnLevel.TargetViewer.init();
    YarnLevel.BoardEditor.init();

    bindToolbar();
    bindSizeControls();
    bindValidationButtons();

    // 初始状态
    YarnLevel.TargetViewer.clear();
    YarnLevel.BoardEditor.createEmpty(9, 10);

    console.log('毛线JSON关卡编辑器 已初始化');
  }

  // ==================== 工具栏绑定 ====================
  function bindToolbar() {
    // 导入
    document.getElementById('btn-import').addEventListener('click', function() {
      document.getElementById('file-input').click();
    });

    document.getElementById('file-input').addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      importFile(file);
      // 重置input，允许重复导入同一文件
      e.target.value = '';
    });

    // 导出
    document.getElementById('btn-export').addEventListener('click', exportJSON);

    // 撤回
    document.getElementById('btn-undo').addEventListener('click', function() {
      if (YarnLevel.Simulator.isActive()) {
        YarnLevel.Simulator.undo();
      } else {
        YarnLevel.BoardEditor.undo();
      }
    });

    // 模拟游玩
    document.getElementById('btn-sim-mode').addEventListener('click', function() {
      if (YarnLevel.Simulator.isActive()) {
        exitSimMode();
      } else {
        enterSimMode();
      }
    });

    // 批量分析
    document.getElementById('btn-batch').addEventListener('click', function() {
      document.getElementById('batch-file-input').click();
    });
    document.getElementById('batch-file-input').addEventListener('change', function(e) {
      var files = Array.prototype.slice.call(e.target.files);
      if (files.length === 0) return;
      batchAnalyze(files);
      e.target.value = '';
    });

    // 导入关卡库（批量导入，可切换）
    document.getElementById('btn-import-lib').addEventListener('click', function() {
      document.getElementById('lib-file-input').click();
    });
    document.getElementById('lib-file-input').addEventListener('change', function(e) {
      var files = Array.prototype.slice.call(e.target.files);
      if (files.length === 0) return;
      importLevelLibrary(files);
      e.target.value = '';
    });
    var levelSelect = document.getElementById('level-select');
    if (levelSelect) levelSelect.addEventListener('change', function() {
      switchToLibraryLevel(parseInt(this.value));
    });
    var prevBtn = document.getElementById('btn-prev-level');
    if (prevBtn) prevBtn.addEventListener('click', function() {
      if (levelLibrary.length === 0) return;
      switchToLibraryLevel((libIndex - 1 + levelLibrary.length) % levelLibrary.length);
    });
    var nextBtn = document.getElementById('btn-next-level');
    if (nextBtn) nextBtn.addEventListener('click', function() {
      if (levelLibrary.length === 0) return;
      switchToLibraryLevel((libIndex + 1) % levelLibrary.length);
    });
  }

  // ==================== 关卡库（批量导入 + 切换） ====================
  var levelLibrary = [];   // [{name, json}]
  var libIndex = -1;
  var auditLoadedCount = 0;   // 本次批量导入里识别出的"审核求解数据"关数（供 onLibraryLoaded 提示）

  function importLevelLibrary(files) {
    files = files.filter(function(file) {
      return file && /\.json$/i.test(file.name);
    });
    if (files.length === 0) {
      alert('没有找到 .json 关卡文件。请多选 JSON 文件。');
      return;
    }

    // 全量读取解析；严格保留文件选择器返回的原始顺序，不按文件名重排。
    levelLibrary = [];
    auditLoadedCount = 0;
    var pending = files.length;
    files.forEach(function(file, idx) {
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var json = JSON.parse(e.target.result);
          // 审核求解数据：存为查表（按文件名复用生产审核解法/曲线），不当普通关卡塞进库
          if (_looksLikeAuditData(json)) {
            YarnLevel._auditData = Object.assign(YarnLevel._auditData || {}, json);
            auditLoadedCount += Object.keys(json).length;
            levelLibrary[idx] = null;   // 标记该槽位不计入关卡库，onLibraryLoaded 的 filter 会剔除
          } else {
            levelLibrary[idx] = { name: file.name, json: json };
          }
        } catch (err) {
          levelLibrary[idx] = { name: file.name + '(解析失败)', json: null };
        }
        pending--;
        if (pending === 0) onLibraryLoaded();
      };
      reader.onerror = function() {
        levelLibrary[idx] = { name: file.name + '(读取失败)', json: null };
        pending--;
        if (pending === 0) onLibraryLoaded();
      };
      reader.readAsText(file);
    });
  }

  function onLibraryLoaded() {
    // 过滤解析失败的，但保留成功关卡的原始相对顺序。
    levelLibrary = levelLibrary.filter(function(x) { return x && x.json; });
    var sel = document.getElementById('level-select');
    if (!sel) return;
    if (levelLibrary.length === 0) {
      sel.style.display = 'none';
      document.getElementById('btn-prev-level').style.display = 'none';
      document.getElementById('btn-next-level').style.display = 'none';
      if (auditLoadedCount > 0) {
        alert('已载入审核求解数据 ' + auditLoadedCount + ' 关，但本次没有可切换的关卡。\n请再多选对应的"合格关卡"JSON 一起导入，切换关卡时即可直接复用生产审核的解法/曲线。');
      } else {
        alert('没有成功解析的关卡');
      }
      return;
    }
    var opts = '';
    for (var i = 0; i < levelLibrary.length; i++) {
      opts += '<option value="' + i + '">' + (i + 1) + '. ' + escapeHTML(levelLibrary[i].name.replace(/\.json$/i, '')) + '</option>';
    }
    sel.innerHTML = opts;
    sel.style.display = '';
    document.getElementById('btn-prev-level').style.display = '';
    document.getElementById('btn-next-level').style.display = '';
    switchToLibraryLevel(0);
    // 若本次还随库载入了"审核求解数据"，提示用户切关将直接复用生产审核的解法/曲线
    if (auditLoadedCount > 0) {
      var fnEl = document.getElementById('file-name');
      if (fnEl) fnEl.value = fnEl.value + '（已随库载入审核求解数据 ' + auditLoadedCount + ' 关）';
      alert('已随库载入审核求解数据 ' + auditLoadedCount + ' 关，切换关卡将直接复用生产审核的解法/曲线（不再临时求解，消除随机扰动）。');
    }
  }

  function switchToLibraryLevel(idx) {
    if (idx < 0 || idx >= levelLibrary.length) return;
    libIndex = idx;
    var entry = levelLibrary[idx];
    var sel = document.getElementById('level-select');
    if (sel) sel.value = String(idx);
    document.getElementById('file-name').value = entry.name;

    var wasSimulating = YarnLevel.Simulator && YarnLevel.Simulator.isActive && YarnLevel.Simulator.isActive();
    if (wasSimulating) {
      // 退出当前模拟，载入新关后重新进入模拟，保持界面同步
      exitSimMode();
    }
    loadLevel(entry.json);
    YarnLevel._currentLevelFile = entry.name;   // loadLevel 会把它清 null，这里设回文件名，使库里每关也能按文件名命中审核求解数据
    if (wasSimulating) {
      enterSimMode();
    }
  }

  function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  // ==================== 尺寸控制 ====================
  function bindSizeControls() {
    document.getElementById('btn-resize').addEventListener('click', function() {
      var newRow = parseInt(document.getElementById('input-maprow').value);
      var newCol = parseInt(document.getElementById('input-mapcol').value);
      if (isNaN(newRow) || newRow < 1) newRow = 1;
      if (isNaN(newCol) || newCol < 1) newCol = 1;
      if (newRow > 20) newRow = 20;
      if (newCol > 20) newCol = 20;
      YarnLevel.BoardEditor.resize(newRow, newCol);
    });

    // 目标预览缩放滑块
    var zoomInput = document.getElementById('input-target-zoom');
    if (zoomInput) {
      zoomInput.addEventListener('input', function() {
        var px = parseInt(zoomInput.value) || 8;
        var valEl = document.getElementById('target-zoom-val');
        if (valEl) valEl.textContent = px + 'px';
        YarnLevel.TargetViewer.setZoom(px);
      });
    }
  }

  // ==================== 验证按钮绑定 ====================
  function bindValidationButtons() {
    document.getElementById('btn-validate-colors').addEventListener('click', validateColors);
    document.getElementById('btn-validate-reach').addEventListener('click', validateReachability);
    document.getElementById('btn-show-solution').addEventListener('click', function() { showOptimalSolution(false); });
    var btnPlayer = document.getElementById('btn-show-player');
    if (btnPlayer) btnPlayer.addEventListener('click', function() { showOptimalSolution(true); });
    document.getElementById('btn-clear-validation').addEventListener('click', clearValidation);
  }

  // ==================== 颜色验证 ====================
  function validateColors() {
    var spools = YarnLevel.BoardEditor.getSpoolsRef();
    var blocks = (levelData && levelData.blocks) ? levelData.blocks : [];

    var result = YarnLevel.Validator.checkColorCounts(spools, blocks);

    var warningsEl = document.getElementById('validation-warnings');
    var contentEl = document.getElementById('validation-warnings-content');

    var html = '';
    html += '<div style="font-size:11px;color:#718096;margin-bottom:4px;">以目标区为基准: 棋盘应有 = 目标像素÷3</div>';

    for (var i = 0; i < result.colorDetails.length; i++) {
      var d = result.colorDetails[i];
      var statusIcon = d.match ? '✓' : '✕';
      var statusColor = d.match ? '#5cb85c' : '#d9534f';
      var dotStyle = d.cssColor ? 'display:inline-block;width:10px;height:10px;border-radius:50%;background:' + d.cssColor + ';margin-right:4px;vertical-align:middle;' : '';
      html += '<div class="warn-item" style="border-left-color:' + statusColor + ';display:flex;align-items:center;gap:4px;">';
      html += '<span style="color:' + statusColor + '">' + statusIcon + '</span>';
      if (dotStyle) html += '<span style="' + dotStyle + '"></span>';
      html += '<span style="flex:1">' + d.colorName + '</span>';
      html += '<span style="color:#718096;font-size:11px;">';
      html += '目标' + d.blockCount + '像素 棋盘' + d.spoolCount + '(应为' + d.expectedSpool + ')';
      if (!d.match) {
        if (d.diff > 0) {
          html += ' <span style="color:#d9534f;">多余' + d.diff + '</span>';
        } else {
          html += ' <span style="color:#d9534f;">缺少' + Math.abs(d.diff) + '</span>';
        }
      }
      html += '</span>';
      html += '</div>';
    }

    if (result.valid) {
      html = '<div class="warn-item" style="color:#5cb85c;border-left-color:#5cb85c;">✓ 颜色验证通过，关卡可正常通关</div>' + html;
    } else {
      html = '<div class="warn-item" style="color:#d9534f;border-left-color:#d9534f;">⚠ 颜色不匹配，修改后可能无法通关</div>' + html;
    }

    contentEl.innerHTML = html;
    warningsEl.classList.add('visible');
  }

  // ==================== 死锁验证 ====================
  function validateReachability() {
    var spools = YarnLevel.BoardEditor.getSpoolsRef();
    var maprow = YarnLevel.BoardEditor.getMapRow();
    var mapcol = YarnLevel.BoardEditor.getMapCol();
    var blocks = (levelData && levelData.blocks) ? levelData.blocks : [];

    clearCellMarks();

    // 使用深度检测：静态分析 + 求解器验证
    var deadlocks = YarnLevel.Validator.checkDeadlocksDeep(spools, maprow, mapcol, blocks);

    var warningsEl = document.getElementById('validation-warnings');
    var contentEl = document.getElementById('validation-warnings-content');
    var html = '';

    if (deadlocks.length === 0) {
      html += '<div class="warn-item" style="color:#5cb85c;border-left-color:#5cb85c;">✓ 无死锁，关卡可正常通关</div>';
    } else {
      html += '<div class="warn-item" style="color:#d9534f;border-left-color:#d9534f;font-weight:600;">🚫 发现 ' + deadlocks.length + ' 个死锁问题</div>';

      for (var i = 0; i < deadlocks.length; i++) {
        var dl = deadlocks[i];
        var icon = '⚠';
        var desc = '';

        if (dl.type === 'unreachable') {
          icon = '■';
          desc = '不可达格 (' + dl.row + ',' + dl.col + '): ' + dl.reason;
          markCell(dl.row, dl.col, 'unreachable');
        } else if (dl.type === 'chain_deadlock') {
          icon = '🔗';
          desc = '锁链死锁 (' + dl.row + ',' + dl.col + ')↔(' + dl.r2 + ',' + dl.c2 + '): ' + dl.reason;
          markCell(dl.row, dl.col, 'unreachable');
          markCell(dl.r2, dl.c2, 'unreachable');
        } else if (dl.type === 'narrow_chain_deadlock') {
          icon = '🔒';
          desc = '窄路锁链死锁 (' + dl.row + ',' + dl.col + ')↔(' + dl.r2 + ',' + dl.c2 + '): ' + dl.reason;
          markCell(dl.row, dl.col, 'unreachable');
          markCell(dl.r2, dl.c2, 'unreachable');
        } else if (dl.type === 'surrounded') {
          icon = '▣';
          desc = '被包围 (' + dl.row + ',' + dl.col + '): 四面封锁';
          markCell(dl.row, dl.col, 'unreachable');
        } else if (dl.type === 'isolated_region') {
          icon = '🏝';
          desc = '孤立区域 (' + dl.row + ',' + dl.col + '): ' + dl.reason;
          markCell(dl.row, dl.col, 'unreachable');
        } else if (dl.type === 'solver_deadlock') {
          icon = '💀';
          desc = dl.reason;
        }

        html += '<div class="warn-item" style="padding-left:8px;font-size:12px;border-left-color:#d9534f;">' + icon + ' ' + desc + '</div>';
      }
    }

    contentEl.innerHTML = html;
    warningsEl.classList.add('visible');
  }

  // ==================== 显示最优解法 ====================
  function showOptimalSolution(playerMode) {
    playerMode = !!playerMode;
    var spools = YarnLevel.BoardEditor.getSpoolsRef();
    var maprow = YarnLevel.BoardEditor.getMapRow();
    var mapcol = YarnLevel.BoardEditor.getMapCol();
    var blocks = (levelData && levelData.blocks) ? levelData.blocks : [];

    if (!blocks || blocks.length === 0) {
      alert('需要目标区数据（blocks）才能计算解法');
      return;
    }

    // 取消选中状态，清空属性面板
    YarnLevel.BoardEditor.clearSelection();
    document.getElementById('property-panel').innerHTML = '<div class="no-selection">点击格子查看属性</div>';

    clearCellMarks();

    // 点"最优解法"(全知)时清除待用的玩家档路线，避免泄漏到模拟游玩
    if (!playerMode) { YarnLevel._pendingRouteResult = null; YarnLevel._lastDS = null; }

    // 若该关有"审核求解数据"（生产端导出的最好那遍），模拟玩家直接复用，不再临时求解（消除扰动）
    var auditEntry = (playerMode && YarnLevel._auditData && YarnLevel._currentLevelFile)
      ? YarnLevel._auditData[YarnLevel._currentLevelFile] : null;
    var auditScore = null;
    var result;
    if (auditEntry && auditEntry.solve) {
      result = _resultFromSolve(auditEntry.solve, auditEntry.auditTier);
      auditScore = auditEntry.score || null;
      if (auditScore) auditScore._fromAudit = true;
    } else {
      result = playerMode
        ? YarnLevel.Validator.analyzePlayerSolution(spools, maprow, mapcol, blocks)
        : YarnLevel.Validator.analyzeOptimalSolution(spools, maprow, mapcol, blocks);
    }

    // 标记取球顺序在棋盘上（抽成可复用函数，支持切换三档路线）
    renderPickRoute(result.pickOrder);

    // 显示结果
    var warningsEl = document.getElementById('validation-warnings');
    var contentEl = document.getElementById('validation-warnings-content');
    var html = '';

    var statusIcon = result.completed ? '✅' : '⚠️';
    var statusColor = result.completed ? '#5cb85c' : '#d9534f';

    html += '<div class="warn-item" style="color:#4a90d9;border-left-color:#4a90d9;font-weight:600;">' +
      (playerMode ? '🙋 模拟玩家（信息受限：问号激活才知色、管道仅出口可见）' : '🧩 最优解法（全知，最低平均暂存）') + '</div>';

    // 通道分析信息（新增）
    if (result.corridorAnalysis && result.corridorAnalysis.hasCriticalCorridor) {
      var ca = result.corridorAnalysis;
      var sevColor = ca.severity === 'extreme' ? '#d9534f' : (ca.severity === 'high' ? '#f0ad4e' : '#4a90d9');
      var sevText = ca.severity === 'extreme' ? '极端' : (ca.severity === 'high' ? '高' : '中等');
      html += '<div class="warn-item" style="border-left-color:' + sevColor + ';background:rgba(217,83,79,0.05);">';
      html += '🚧 <strong>瓶颈通道检测</strong>：严重度 <span style="color:' + sevColor + ';font-weight:600;">' + sevText + '</span>';
      html += '<br><span style="font-size:11px;color:#718096;">';
      html += '被封锁球占比: ' + Math.round(ca.blockedRatio * 100) + '% | ';
      html += '关键通道: ' + ca.corridors.length + '条 | ';
      html += '总解锁成本: ~' + ca.requiredThawSteps + '步';
      html += '</span>';
      if (ca.corridors.length > 0) {
        html += '<br><span style="font-size:11px;color:#718096;">';
        for (var ci = 0; ci < Math.min(ca.corridors.length, 5); ci++) {
          var corr = ca.corridors[ci];
          var obsCount = corr.obstacles ? corr.obstacles.length : 0;
          var normalCount = corr.normalCells ? corr.normalCells.length : 0;
          html += '通道' + (ci + 1) + ': ' + corr.behindCount + '球(' + obsCount + '障碍+' + normalCount + '普通, 成本' + corr.totalCost + '步)';
          if (ci < Math.min(ca.corridors.length, 5) - 1) html += '<br>';
        }
        html += '</span>';
      }
      html += '</div>';
    }

    html += '<div class="warn-item" style="border-left-color:' + statusColor + ';">';
    html += statusIcon + ' 完成进度: <strong>' + result.progress + '%</strong> (' + result.eliminatedSpools + '/' + result.totalTargetSpools + '组线轴)';
    html += '</div>';

    // 玩家模式：难度标签（按平均暂存）+ 三档明细
    if (playerMode) {
      if (result.completed) {
        var ratio = result.avgBufferRatio;
        var dLabel = ratio < 20 ? '简单' : (ratio < 40 ? '普通' : (ratio < 60 ? '较难' : (ratio < 80 ? '很难' : '极难')));
        var dColor = ratio < 40 ? '#5cb85c' : (ratio < 60 ? '#f0ad4e' : '#d9534f');
        html += '<div class="warn-item" style="border-left-color:' + dColor + ';">';
        html += '🎯 难度: <strong style="color:' + dColor + ';">' + dLabel + '</strong>';
        html += ' <span style="font-size:11px;color:#718096;">(按综合玩家平均暂存 ' + ratio + '%)</span>';
        html += '</div>';
      }
      // 玩家指标：默认只跑高手档；点击综合后才补齐三档加权。
      var isStrongOnly = playerMode && result.solverVersion === 'StrongOnly';
      html += '<div class="warn-item" style="border-left-color:#4a90d9;">';
      html += (isStrongOnly ? '😎 高手玩家' : '👥 综合玩家(加权)') + ': 通关率 <strong>' + (result.passRate !== undefined ? result.passRate : (result.completed?100:0)) + '%</strong>';
      html += ' | 峰值 ' + result.maxBuffer + ' | 平均暂存 ' + result.avgBuffer + ' (' + result.avgBufferRatio + '%)';
      html += ' <span style="font-size:11px;color:#718096;">' + (isStrongOnly ? '菜鸟/中级/综合点击路线按钮后再计算' : '权重 菜鸟30/中级40/高手30') + '</span>';
      html += '</div>';
      // 难度评分体系（客观难度 + 曲线质量 + 卡点压力曲线）：基准档 + 全知 融合
      var omniForScore = (!playerMode ? result : ((YarnLevel.Simulator && YarnLevel.Simulator._omniResult) || null));
      var ds = auditScore || YarnLevel.Validator.computeDifficultyScore(result, { omniResult: omniForScore, auditTier: (auditEntry ? auditEntry.auditTier : undefined) });
      YarnLevel._lastDS = ds;   // 供末尾图表渲染融合曲线用
      // 卡点/难度块包在容器里；点击档位路线按钮时整块按该档重算重渲染
      html += '<div id="difficulty-curve-block">' + buildDifficultyBlockHTML(ds) + '</div>';
      // 三档明细
      if (result.tiers) {
        var tierDefs = [['novice','🐣 菜鸟(1步,压力时2步)'],['mid','🙂 中级(2步,压力时3步)'],['strong','😎 高手(3步+均匀管道)']];
        for (var ti = 0; ti < tierDefs.length; ti++) {
          var tr = result.tiers[tierDefs[ti][0]];
          if (!tr) continue;
          var tColor = tr.avgBufferRatio < 40 ? '#5cb85c' : (tr.avgBufferRatio < 60 ? '#f0ad4e' : '#d9534f');
          html += '<div class="warn-item" style="padding-left:12px;font-size:11px;border-left-color:' + tColor + ';">';
          html += tierDefs[ti][1] + ': ' + (tr.completed ? '✓通关' : '✗未通关') +
                  ' 尝试' + tr.attempts + '次 | 步' + tr.totalSteps +
                  ' | 峰' + tr.maxBuffer + ' | 均' + tr.avgBuffer + '(' + tr.avgBufferRatio + '%)' +
                  ' | 误触' + (tr.misclicks || 0) + '次';
          html += '</div>';
        }
        // 三档/综合 模拟路线切换
        YarnLevel._lastPlayerResult = result;
        html += '<div class="warn-item" style="border-left-color:#4a90d9;">';
        html += '<div style="font-size:11px;color:#718096;margin-bottom:4px;">🗺 在棋盘上显示模拟路线（点击切换）:</div>';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        html += '<button class="route-btn" onclick="YarnLevel._showTierRoute(\'novice\')" style="padding:4px 10px;font-size:11px;border:1px solid #d9534f;background:#fff;color:#d9534f;border-radius:4px;cursor:pointer;">🐣 菜鸟</button>';
        html += '<button class="route-btn" onclick="YarnLevel._showTierRoute(\'mid\')" style="padding:4px 10px;font-size:11px;border:1px solid #f0ad4e;background:#fff;color:#f0ad4e;border-radius:4px;cursor:pointer;">🙂 中级</button>';
        html += '<button class="route-btn" onclick="YarnLevel._showTierRoute(\'strong\')" style="padding:4px 10px;font-size:11px;border:1px solid #5cb85c;background:#5cb85c;color:#fff;border-radius:4px;cursor:pointer;">😎 高手</button>';
        html += '<button class="route-btn" onclick="YarnLevel._showTierRoute(\'combined\')" style="padding:4px 10px;font-size:11px;border:1px solid #4a90d9;background:#fff;color:#4a90d9;border-radius:4px;cursor:pointer;">👥 综合</button>';
        html += '</div>';
        html += '<div style="font-size:10px;color:#a0aec0;margin-top:3px;">当前显示：😎 高手路线；菜鸟/中级/综合点击后再计算</div>';
        html += '</div>';
      }
    }

    html += '<div class="warn-item" style="border-left-color:#5cb85c;">';
    html += '总步数: <strong>' + result.totalSteps + '</strong>';
    if (typeof result.totalTargetSpools === 'number' && result.completed) {
      var pairs = result.totalTargetSpools - result.totalSteps;
      if (pairs > 0) html += ' <span style="font-size:11px;color:#718096;">(球' + result.totalTargetSpools + ', 锁链约' + pairs + '对)</span>';
    }
    html += ' | 暂存峰值: <strong>' + result.maxBuffer + '/' + result.bufferLimit + '</strong>';
    html += '</div>';

    html += '<div class="warn-item" style="border-left-color:#4a90d9;">';
    html += '平均暂存占用: <strong>' + result.avgBuffer + '/' + result.bufferLimit + '</strong> ';
    html += '(<strong>' + result.avgBufferRatio + '%</strong>容量)';
    html += '</div>';

    if (result.bufferFinal > 0) {
      html += '<div class="warn-item" style="border-left-color:#d9534f;">';
      html += '⚠ 结束时暂存区剩余: ' + result.bufferFinal + '个线轴未完成';
      html += '</div>';
    }

    // 顺序合法性检验结果
    if (result.validationErrors && result.validationErrors.length > 0) {
      html += '<div class="warn-item" style="border-left-color:#d9534f;color:#d9534f;font-weight:600;">';
      html += '❌ 顺序检验失败（' + result.validationErrors.length + '处错误）：';
      html += '</div>';
      var maxShow = Math.min(result.validationErrors.length, 5);
      for (var ei = 0; ei < maxShow; ei++) {
        var err = result.validationErrors[ei];
        html += '<div class="warn-item" style="padding-left:12px;font-size:11px;border-left-color:#d9534f;">';
        html += '步' + err.step + ' (' + err.row + ',' + err.col + '): ' + err.error;
        html += '</div>';
        // 在棋盘上标红错误格子
        var errCell = document.querySelector('.board-cell[data-row="' + err.row + '"][data-col="' + err.col + '"]');
        if (errCell) errCell.classList.add('unreachable');
      }
      if (result.validationErrors.length > 5) {
        html += '<div class="warn-item" style="padding-left:12px;font-size:11px;color:#718096;">还有 ' + (result.validationErrors.length - 5) + ' 处...</div>';
      }
    } else if (result.pickOrder.length > 0) {
      html += '<div class="warn-item" style="border-left-color:#5cb85c;color:#5cb85c;">';
      html += '✓ 顺序检验通过，所有步骤可按序执行';
      html += '</div>';
    }

    // 暂存区变化图（简化柱状图）
    if (result.stepBufferHistory && result.stepBufferHistory.length > 0) {
      html += '<div class="warn-item" style="border-left-color:#718096;">';
      html += '<div style="font-size:11px;color:#718096;margin-bottom:4px;">暂存区占用变化:</div>';
      html += '<div style="display:flex;align-items:flex-end;gap:1px;height:36px;">';
      var maxShow = Math.min(result.stepBufferHistory.length, 80);
      var step = Math.max(1, Math.floor(result.stepBufferHistory.length / maxShow));
      for (var i = 0; i < result.stepBufferHistory.length; i += step) {
        var h = result.stepBufferHistory[i];
        var height = Math.round((h / result.bufferLimit) * 36);
        var barColor = h >= result.bufferLimit ? '#d9534f' : (h >= 4 ? '#f0ad4e' : '#5cb85c');
        html += '<div style="width:3px;height:' + Math.max(1, height) + 'px;background:' + barColor + ';border-radius:1px;" title="步' + (i + 1) + ': ' + h + '/' + result.bufferLimit + '"></div>';
      }
      html += '</div></div>';
    }

    // 取球顺序详情（可折叠）
    if (result.pickOrder.length > 0) {
      html += '<div class="warn-item" style="border-left-color:#4a90d9;cursor:pointer;" onclick="document.getElementById(\'solution-detail\').classList.toggle(\'hidden\');this.querySelector(\'span\').textContent=document.getElementById(\'solution-detail\').classList.contains(\'hidden\')?\'▶ 展开\':\'▼ 收起\'">';
      html += '<strong>取球顺序（' + result.pickOrder.length + '步）</strong> <span style="font-size:11px;color:#718096;">▶ 展开</span>';
      html += '</div>';
      html += '<div id="solution-detail" class="hidden" style="max-height:300px;overflow-y:auto;">';
      for (var i = 0; i < result.pickOrder.length; i++) {
        var p = result.pickOrder[i];
        var cssC = p.colorId > 0 ? YarnLevel.getColorCSS(p.colorId) : '#999';
        var dot = cssC ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + cssC + ';margin-right:3px;"></span>' : '';
        var srcLabel = p.source === 'pipe' ? '管道(' + p.row + ',' + p.col + ')' : '(' + p.row + ',' + p.col + ')';
        var bufLabel = p.bufferAfter !== undefined ? (' 暂存' + p.bufferAfter + '/' + result.bufferLimit) : '';
        html += '<div class="warn-item" style="padding-left:12px;font-size:11px;">';
        html += '#' + p.step + ' ' + dot + p.colorName + ' ' + srcLabel + bufLabel;
        html += '</div>';
      }
      html += '</div>';
    }

    contentEl.innerHTML = html;
    warningsEl.classList.add('visible');

    // 显示暂存区图表（原图：按步暂存，保持不变）
    if (result.stepBufferHistory && result.stepBufferHistory.length > 0) {
      var narrowZones = extractNarrowZones(result);
      showBufferChart(result.stepBufferHistory, result.bufferLimit, 0, {
        narrowZones: narrowZones,
        totalSteps: result.totalSteps,
        progress: result.progress
      });
    }

    // 融合压力曲线（新图：0.4全知+0.6玩家 按球暂存，横轴=进度，标卡点窗口）
    if (playerMode && YarnLevel._lastDS && YarnLevel._lastDS.ballCurve && YarnLevel._lastDS.ballCurve.length > 0) {
      drawFusedChart(YarnLevel._lastDS, result.bufferLimit);
    } else {
      var fb = document.getElementById('fused-chart-block');
      if (fb) fb.style.display = 'none';
    }
  }

  /**
   * 从求解结果中提取窄路区间（哪些步数范围正在处理窄路）
   * 基于corridorAnalysis和pickOrder推断
   */
  function extractNarrowZones(result) {
    var zones = [];
    if (!result.corridorAnalysis || !result.corridorAnalysis.hasCriticalCorridor) return zones;
    if (!result.pickOrder || result.pickOrder.length === 0) return zones;
    
    var corridors = result.corridorAnalysis.corridors || [];
    // 收集所有通道格子坐标
    var corridorCells = {};
    for (var ci = 0; ci < corridors.length; ci++) {
      var corr = corridors[ci];
      for (var oi = 0; oi < corr.cells.length; oi++) {
        corridorCells[corr.cells[oi].row + ',' + corr.cells[oi].col] = ci;
      }
      if (corr.entryCell) {
        corridorCells[corr.entryCell.row + ',' + corr.entryCell.col] = ci;
      }
    }
    
    // 扫描pickOrder，找出哪些步骤正在拾取通道格子
    var corridorSteps = {}; // corridorIdx -> [steps]
    for (var pi = 0; pi < result.pickOrder.length; pi++) {
      var pick = result.pickOrder[pi];
      var key = pick.row + ',' + pick.col;
      if (corridorCells[key] !== undefined) {
        var ci = corridorCells[key];
        if (!corridorSteps[ci]) corridorSteps[ci] = [];
        corridorSteps[ci].push(pick.step);
      }
    }
    
    // 对每个通道生成区间
    for (var ci in corridorSteps) {
      var steps = corridorSteps[ci];
      if (steps.length < 2) continue;
      steps.sort(function(a, b) { return a - b; });
      zones.push({
        startStep: steps[0],
        endStep: steps[steps.length - 1],
        label: '窄路' + (parseInt(ci) + 1)
      });
    }
    
    // 按起始步数排序
    zones.sort(function(a, b) { return a.startStep - b.startStep; });
    return zones;
  }
  // ==================== 暂存区图表 ====================
  var chartState = {
    data: [],
    limit: 6,
    mode: 'bar',
    zoom: 1,
    offset: 0,
    dragging: false,
    dragStartX: 0,
    dragStartOffset: 0,
    // 新增：进度信息
    totalSteps: 0,
    progress: 100,
    // 新增：窄路区间 [{startStep, endStep, label}]
    narrowZones: [],
    // 新增：是否显示预设压力曲线
    showPresetCurve: true,
    // 新增：按球进度模式（横轴=进度%，数据是融合后按球暂存曲线）
    ballMode: false,
    capWinStart: -1,
    capWinLen: 0
  };

  function showBufferChart(data, limit, currentStep, extraInfo) {
    chartState.data = data;
    chartState.limit = limit;
    chartState.currentStep = currentStep || 0;
    // 额外信息：窄路区间、总步数、进度
    if (extraInfo) {
      chartState.narrowZones = extraInfo.narrowZones || [];
      chartState.totalSteps = extraInfo.totalSteps || data.length;
      chartState.progress = extraInfo.progress || 100;
      chartState.ballMode = !!extraInfo.ballMode;
      chartState.capWinStart = (extraInfo.capWinStart !== undefined) ? extraInfo.capWinStart : -1;
      chartState.capWinLen = extraInfo.capWinLen || 0;
    } else {
      chartState.narrowZones = [];
      chartState.totalSteps = data.length;
      chartState.progress = 100;
      chartState.ballMode = false;
      chartState.capWinStart = -1;
      chartState.capWinLen = 0;
    }
    // 只在首次显示时重置zoom/offset
    if (!chartState._initialized) {
      chartState.zoom = 1;
      chartState.offset = 0;
      chartState._initialized = true;
    }

    var container = document.getElementById('buffer-chart-container');
    container.style.display = 'block';

    document.getElementById('btn-chart-bar').onclick = function() {
      chartState.mode = 'bar';
      this.classList.add('active');
      document.getElementById('btn-chart-line').classList.remove('active');
      drawChart();
    };
    document.getElementById('btn-chart-line').onclick = function() {
      chartState.mode = 'line';
      this.classList.add('active');
      document.getElementById('btn-chart-bar').classList.remove('active');
      drawChart();
    };
    document.getElementById('btn-chart-zoom-in').onclick = function() {
      chartState.zoom = Math.min(chartState.zoom * 1.5, 5);
      var canvas = document.getElementById('buffer-chart-canvas');
      canvas.style.cursor = chartState.zoom > 1 ? 'grab' : 'crosshair';
      drawChart();
    };
    document.getElementById('btn-chart-zoom-out').onclick = function() {
      chartState.zoom = Math.max(chartState.zoom / 1.5, 0.5);
      chartState.offset = 0;
      var canvas = document.getElementById('buffer-chart-canvas');
      canvas.style.cursor = chartState.zoom > 1 ? 'grab' : 'crosshair';
      drawChart();
    };

    // 导出Excel按钮
    var exportBtn = document.getElementById('btn-chart-export');
    if (exportBtn) {
      exportBtn.onclick = function() { exportBufferChartCSV(); };
    }

    var canvas = document.getElementById('buffer-chart-canvas');
    canvas.onmousemove = function(e) {
      if (chartState.dragging) {
        var dx = e.clientX - chartState.dragStartX;
        var visibleCount = Math.max(1, Math.floor(chartState.data.length / chartState.zoom));
        var stepsPer = chartState.data.length / visibleCount;
        var shift = Math.round(-dx / 5 * stepsPer / chartState.data.length * visibleCount);
        chartState.offset = Math.max(0, Math.min(chartState.data.length - visibleCount, chartState.dragStartOffset + shift));
        drawChart();
        return;
      }
      var rect = canvas.getBoundingClientRect();
      var x = (e.clientX - rect.left) * (canvas.width / rect.width);
      var stepIdx = getStepFromX(x);
      if (stepIdx >= 0 && stepIdx < chartState.data.length) {
        var tooltip = document.getElementById('buffer-chart-tooltip');
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX + 10) + 'px';
        tooltip.style.top = (e.clientY - 30) + 'px';
        if (chartState.ballMode) {
          var prog = Math.round((stepIdx + 1) / chartState.data.length * 100);
          tooltip.textContent = '进度' + prog + '%(球' + (stepIdx + 1) + '): 暂存' + chartState.data[stepIdx];
        } else {
          tooltip.textContent = '步' + (stepIdx + 1) + ': ' + chartState.data[stepIdx] + '/' + chartState.limit;
        }
      }
    };
    canvas.onmouseleave = function() {
      document.getElementById('buffer-chart-tooltip').style.display = 'none';
      chartState.dragging = false;
    };
    canvas.onmousedown = function(e) {
      if (chartState.zoom > 1) {
        chartState.dragging = true;
        chartState.dragStartX = e.clientX;
        chartState.dragStartOffset = chartState.offset;
        canvas.style.cursor = 'grabbing';
      }
    };
    canvas.onmouseup = function() {
      chartState.dragging = false;
      canvas.style.cursor = chartState.zoom > 1 ? 'grab' : 'crosshair';
    };

    drawChart();
  }

  // ==================== 卡点压力曲线图（按球进度 + 卡点窗口）====================
  // 独立于"暂存区变化"图，画 ds.ballCurve（高手档按球曲线），横轴=进度%，紫框=卡点窗口
  var fusedChartState = { curve: null, res: null, limit: 7, capStart: -1, capLen: 0 };
  function drawFusedChart(ds, limit) {
    var block = document.getElementById('fused-chart-block');
    var canvas = document.getElementById('fused-chart-canvas');
    if (!block || !canvas || !ds.ballCurve) return;
    block.style.display = 'block';
    fusedChartState.curve = ds.ballCurve;
    fusedChartState.res = ds.ballRes || null;
    fusedChartState.limit = limit || 7;
    fusedChartState.capStart = (ds.capWinStart !== undefined) ? ds.capWinStart : -1;
    fusedChartState.capLen = ds.capWinLen || 0;

    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var pad = { top: 14, bottom: 26, left: 28, right: 8 };
    var chartW = w - pad.left - pad.right, chartH = h - pad.top - pad.bottom;
    ctx.clearRect(0, 0, w, h);
    var data = fusedChartState.curve, N = data.length, lim = fusedChartState.limit;
    if (N === 0) return;
    var barW = chartW / N;

    // 50-90 目标区淡蓝背景
    var zx1 = pad.left + Math.floor(N * 0.5) * barW;
    var zx2 = pad.left + Math.floor(N * 0.9) * barW;
    ctx.fillStyle = 'rgba(74,144,217,0.07)';
    ctx.fillRect(zx1, pad.top, zx2 - zx1, chartH);

    // 卡点窗口紫色高亮
    if (fusedChartState.capStart >= 0 && fusedChartState.capLen > 0) {
      var cx1 = pad.left + fusedChartState.capStart * barW;
      var cx2 = pad.left + Math.min(fusedChartState.capStart + fusedChartState.capLen, N) * barW;
      ctx.fillStyle = 'rgba(155,89,182,0.20)';
      ctx.fillRect(cx1, pad.top, cx2 - cx1, chartH);
      ctx.fillStyle = 'rgba(142,68,173,0.9)';
      ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('卡点', (cx1 + cx2) / 2, pad.top + 10);
    }

    // 网格线 暂存=4 (高压线)
    var y4 = pad.top + chartH - (4 / lim) * chartH;
    ctx.beginPath(); ctx.strokeStyle = 'rgba(240,173,78,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.moveTo(pad.left, y4); ctx.lineTo(pad.left + chartW, y4); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#f0ad4e'; ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('4', pad.left - 2, y4 + 3);

    // 进度竖线 30/50/70/90%
    [30, 50, 70, 90].forEach(function(p) {
      var idx = Math.round(p / 100 * N);
      var mx = pad.left + idx * barW;
      ctx.beginPath(); ctx.strokeStyle = 'rgba(113,128,150,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.moveTo(mx, pad.top); ctx.lineTo(mx, pad.top + chartH); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#718096'; ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p + '%', mx, pad.top + chartH + 10);
    });

    // 折线：融合暂存曲线
    ctx.beginPath(); ctx.strokeStyle = '#9b59b6'; ctx.lineWidth = 1.5;
    for (var i = 0; i < N; i++) {
      var x = pad.left + i * barW + barW / 2;
      var y = pad.top + chartH - (Math.min(data[i], lim) / lim) * chartH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 鼠标提示
    canvas.onmousemove = function(e) {
      var rect = canvas.getBoundingClientRect();
      var x = (e.clientX - rect.left) * (canvas.width / rect.width);
      var idx = Math.floor((x - pad.left) / barW);
      if (idx >= 0 && idx < N) {
        var tip = document.getElementById('fused-chart-tooltip');
        tip.style.display = 'block';
        tip.style.left = (e.clientX + 10) + 'px';
        tip.style.top = (e.clientY - 30) + 'px';
        var prog = Math.round((idx + 1) / N * 100);
        var resTxt = fusedChartState.res ? ('/滞留' + fusedChartState.res[idx]) : '';
        tip.textContent = '进度' + prog + '%(球' + (idx + 1) + '): 暂存' + data[idx] + resTxt;
      }
    };
    canvas.onmouseleave = function() {
      var tip = document.getElementById('fused-chart-tooltip'); if (tip) tip.style.display = 'none';
    };
  }
  YarnLevel._drawFusedChart = drawFusedChart;

  /**
   * 导出暂存区数据为CSV（Excel可打开）
   */
  function exportBufferChartCSV() {
    if (!chartState.data || chartState.data.length === 0) return;

    var rows = [];
    rows.push('步数,暂存区占用,暂存上限');
    for (var i = 0; i < chartState.data.length; i++) {
      rows.push((i + 1) + ',' + chartState.data[i] + ',' + chartState.limit);
    }
    var csv = '\uFEFF' + rows.join('\n'); // BOM for Excel中文兼容

    var fileName = (document.getElementById('file-name').value || '关卡') .replace('.json', '') + '_暂存区数据.csv';
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function hideBufferChart() {
    var container = document.getElementById('buffer-chart-container');
    if (container) container.style.display = 'none';
  }

  function getStepFromX(x) {
    var canvas = document.getElementById('buffer-chart-canvas');
    var w = canvas.width;
    var paddingLeft = 30;
    var paddingRight = 10;
    var chartW = w - paddingLeft - paddingRight;
    var visibleCount = Math.max(1, Math.floor(chartState.data.length / chartState.zoom));
    var barW = chartW / visibleCount;
    return Math.floor((x - paddingLeft) / barW) + chartState.offset;
  }

  function drawChart() {
    var canvas = document.getElementById('buffer-chart-canvas');
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var pad = { top: 15, bottom: 28, left: 30, right: 10 };
    var chartW = w - pad.left - pad.right;
    var chartH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);

    var data = chartState.data;
    var limit = chartState.limit;
    if (data.length === 0) return;

    var visibleCount = Math.max(1, Math.floor(data.length / chartState.zoom));
    var start = Math.min(chartState.offset, Math.max(0, data.length - visibleCount));
    var end = Math.min(start + visibleCount, data.length);
    var slice = data.slice(start, end);
    var barW = chartW / slice.length;
    var totalSteps = chartState.totalSteps || data.length;
    var progress = chartState.progress || 100;

    // === 窄路区间背景高亮 ===
    if (chartState.narrowZones && chartState.narrowZones.length > 0) {
      var zoneColors = ['rgba(255,107,107,0.12)', 'rgba(255,159,67,0.12)', 'rgba(156,136,255,0.12)'];
      for (var zi = 0; zi < chartState.narrowZones.length; zi++) {
        var zone = chartState.narrowZones[zi];
        var zStart = zone.startStep - 1 - start; // 转为slice内索引
        var zEnd = zone.endStep - 1 - start;
        if (zEnd < 0 || zStart >= slice.length) continue;
        zStart = Math.max(0, zStart);
        zEnd = Math.min(slice.length - 1, zEnd);
        var x1 = pad.left + zStart * barW;
        var x2 = pad.left + (zEnd + 1) * barW;
        ctx.fillStyle = zoneColors[zi % zoneColors.length];
        ctx.fillRect(x1, pad.top, x2 - x1, chartH);
        // 窄路标签
        ctx.fillStyle = zi === 0 ? 'rgba(217,83,79,0.7)' : (zi === 1 ? 'rgba(230,126,34,0.7)' : 'rgba(142,68,173,0.7)');
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        var labelX = (x1 + x2) / 2;
        ctx.fillText(zone.label || ('窄路' + (zi + 1)), labelX, pad.top + 9);
      }
    }

    // === 卡点窗口高亮（仅ballMode：在50-90融合曲线上标出算法选中的卡点10%窗口）===
    if (chartState.ballMode && chartState.capWinStart >= 0 && chartState.capWinLen > 0) {
      var cwS = chartState.capWinStart - start;
      var cwE = chartState.capWinStart + chartState.capWinLen - start;
      cwS = Math.max(0, cwS); cwE = Math.min(slice.length, cwE);
      if (cwE > cwS) {
        var cx1 = pad.left + cwS * barW;
        var cx2 = pad.left + cwE * barW;
        ctx.fillStyle = 'rgba(155,89,182,0.18)';
        ctx.fillRect(cx1, pad.top, cx2 - cx1, chartH);
        ctx.fillStyle = 'rgba(142,68,173,0.85)';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('卡点', (cx1 + cx2) / 2, pad.top + 9);
      }
    }

    // === 进度分区竖线（30%/60%/90%进度标记）===
    var progressMarks = [30, 60, 90];
    for (var mi = 0; mi < progressMarks.length; mi++) {
      var markProg = progressMarks[mi];
      // 进度→索引映射：ballMode下索引即进度(总长=100%)；否则进度→步数线性映射
      var markIdx;
      if (chartState.ballMode) {
        markIdx = Math.round(markProg / 100 * data.length) - 1 - start;
      } else {
        var markStep = Math.round(markProg / progress * totalSteps);
        markIdx = markStep - 1 - start;
      }
      if (markIdx >= 0 && markIdx < slice.length) {
        var mx = pad.left + markIdx * barW + barW / 2;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(113,128,150,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.moveTo(mx, pad.top);
        ctx.lineTo(mx, pad.top + chartH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#718096';
        ctx.font = '7px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(markProg + '%', mx, pad.top + chartH + 10);
      }
    }

    // Y轴
    ctx.fillStyle = '#718096';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    for (var y = 0; y <= limit; y++) {
      var yPos = pad.top + chartH - (y / limit) * chartH;
      ctx.fillText(y, pad.left - 4, yPos + 3);
      ctx.beginPath();
      ctx.strokeStyle = y === limit ? 'rgba(217,83,79,0.4)' : '#e2e8f0';
      ctx.lineWidth = y === limit ? 1.5 : 0.5;
      ctx.moveTo(pad.left, yPos);
      ctx.lineTo(w - pad.right, yPos);
      ctx.stroke();
    }

    // === 预设压力曲线（理想玩家体验）===
    if (chartState.showPresetCurve && slice.length > 5) {
      // 预设：0-30%→0.5, 30-60%→2.5, 60-90%→3.5, 90-100%→4.5
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(46,204,113,0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      for (var i = 0; i < slice.length; i++) {
        var stepIdx = start + i;
        var stepProg = totalSteps > 0 ? (stepIdx + 1) / totalSteps * progress : 0;
        var presetVal;
        if (stepProg < 30) presetVal = 0.3 + stepProg / 30 * 0.7; // 0.3→1.0
        else if (stepProg < 60) presetVal = 1.0 + (stepProg - 30) / 30 * 1.8; // 1.0→2.8
        else if (stepProg < 90) presetVal = 2.8 + (stepProg - 60) / 30 * 1.0; // 2.8→3.8
        else presetVal = 3.8 + (stepProg - 90) / 10 * 0.7; // 3.8→4.5
        
        var px = pad.left + i * barW + barW / 2;
        var py = pad.top + chartH - (presetVal / limit) * chartH;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // 图例
      ctx.fillStyle = 'rgba(46,204,113,0.7)';
      ctx.font = '7px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('--- 理想曲线', pad.left + 2, pad.top + chartH - 2);
    }

    // === 数据绘制 ===
    if (chartState.mode === 'bar') {
      for (var i = 0; i < slice.length; i++) {
        var val = slice[i];
        var barH = (val / limit) * chartH;
        var x = pad.left + i * barW;
        var y = pad.top + chartH - barH;
        var color = val >= limit ? '#d9534f' : (val >= 4 ? '#f0ad4e' : (val >= 2 ? '#4a90d9' : '#5cb85c'));
        ctx.fillStyle = color;
        ctx.fillRect(x + 1, y, Math.max(barW - 2, 2), barH);
        if (barW > 14) {
          ctx.fillStyle = '#4a5568';
          ctx.font = '8px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(val, x + barW / 2, y - 2);
        }
      }
    } else {
      ctx.beginPath();
      ctx.strokeStyle = '#4a90d9';
      ctx.lineWidth = 1.5;
      for (var i = 0; i < slice.length; i++) {
        var val = slice[i];
        var x = pad.left + i * barW + barW / 2;
        var y = pad.top + chartH - (val / limit) * chartH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (var i = 0; i < slice.length; i++) {
        var val = slice[i];
        var x = pad.left + i * barW + barW / 2;
        var y = pad.top + chartH - (val / limit) * chartH;
        var color = val >= limit ? '#d9534f' : (val >= 4 ? '#f0ad4e' : '#4a90d9');
        ctx.beginPath(); ctx.fillStyle = color;
        ctx.arc(x, y, barW > 10 ? 3 : 2, 0, Math.PI * 2); ctx.fill();
        if (barW > 14) {
          ctx.fillStyle = '#4a5568'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(val, x, y - 6);
        }
      }
    }

    // X轴步数标注
    ctx.fillStyle = '#718096'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    var xStep = Math.max(1, Math.floor(slice.length / 10));
    for (var i = 0; i < slice.length; i += xStep) {
      ctx.fillText(start + i + 1, pad.left + i * barW + barW / 2, h - 14);
    }

    // 当前步数进度竖线（模拟模式时）
    if (chartState.currentStep > 0) {
      var stepInView = chartState.currentStep - 1 - start;
      if (stepInView >= 0 && stepInView < slice.length) {
        var lineX = pad.left + stepInView * barW + barW / 2;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(217, 83, 79, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 2]);
        ctx.moveTo(lineX, pad.top);
        ctx.lineTo(lineX, pad.top + chartH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#d9534f';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('▼' + chartState.currentStep, lineX, pad.top - 2);
      }
    }
  }

  function clearValidation() {
    clearCellMarks();
    var warningsEl = document.getElementById('validation-warnings');
    warningsEl.classList.remove('visible');
    hideBufferChart();
  }

  // 标记格子
  function markCell(row, col, className) {
    var cellEl = document.querySelector('.board-cell[data-row="' + row + '"][data-col="' + col + '"]');
    if (cellEl) {
      cellEl.classList.add(className);
    }
  }

  // 清除所有格子标记
  function clearCellMarks() {
    var marks = ['unreachable', 'path-highlight-1', 'path-highlight-2', 'path-highlight-3', 'bottleneck', 'path-to-cell'];
    for (var m = 0; m < marks.length; m++) {
      var cells = document.querySelectorAll('.board-cell.' + marks[m]);
      for (var i = 0; i < cells.length; i++) {
        cells[i].classList.remove(marks[m]);
      }
    }
    // 移除箭头和消除顺序标记
    var extras = document.querySelectorAll('.path-arrow, .elim-order-badge');
    for (var i = 0; i < extras.length; i++) {
      extras[i].remove();
    }
  }

  // 渲染一条取球路线（棋盘格子 badge + 管道球步数），用于三档/综合路线切换
  function renderPickRoute(pickOrder) {
    // 先清掉旧路线标记
    var oldBadges = document.querySelectorAll('.elim-order-badge, .pipe-ball-step');
    for (var ob = 0; ob < oldBadges.length; ob++) oldBadges[ob].remove();
    var oldHl = document.querySelectorAll('.board-cell.path-highlight-1');
    for (var oh = 0; oh < oldHl.length; oh++) oldHl[oh].classList.remove('path-highlight-1');
    if (!pickOrder || pickOrder.length === 0) return;

    // 棋盘格子 badge
    var cellBadges = {}; // 'r,c' -> step
    for (var i = 0; i < pickOrder.length; i++) {
      var pick = pickOrder[i];
      if (pick.source === 'pipe') continue;
      var key = pick.row + ',' + pick.col;
      if (!cellBadges[key]) cellBadges[key] = pick.step;
    }
    for (var key in cellBadges) {
      var parts = key.split(',');
      var cellEl = document.querySelector('.board-cell[data-row="' + parts[0] + '"][data-col="' + parts[1] + '"]');
      if (cellEl && !cellEl.querySelector('.elim-order-badge')) {
        var badge = document.createElement('span');
        badge.className = 'elim-order-badge';
        badge.textContent = cellBadges[key];
        cellEl.appendChild(badge);
        cellEl.classList.add('path-highlight-1');
      }
    }

    // 管道面板步数
    var pipePanel = document.getElementById('pipe-panel');
    if (pipePanel) {
      var pipeStepsByPipe = {};
      for (var pi = 0; pi < pickOrder.length; pi++) {
        var po = pickOrder[pi];
        if (po.source === 'pipe' && po.pipeRow !== undefined && po.pipeCol !== undefined) {
          var pKey = po.pipeRow + ',' + po.pipeCol;
          if (!pipeStepsByPipe[pKey]) pipeStepsByPipe[pKey] = [];
          pipeStepsByPipe[pKey].push({ pipeIndex: po.pipeIndex, step: po.step });
        }
      }
      for (var pKey2 in pipeStepsByPipe) {
        var parts2 = pKey2.split(',');
        var pipeBalls = pipePanel.querySelectorAll('.pipe-ball[data-pipe-row="' + parts2[0] + '"][data-pipe-col="' + parts2[1] + '"]');
        var stepEntries = pipeStepsByPipe[pKey2];
        stepEntries.sort(function(a, b) { return a.pipeIndex - b.pipeIndex; });
        for (var si = 0; si < stepEntries.length; si++) {
          var idx = stepEntries[si].pipeIndex;
          if (idx !== undefined && idx < pipeBalls.length) {
            var stepBadge = document.createElement('span');
            stepBadge.className = 'pipe-ball-step';
            stepBadge.textContent = stepEntries[si].step;
            pipeBalls[idx].appendChild(stepBadge);
          }
        }
      }
    }
  }
  // 暴露给行内 onclick 使用
  YarnLevel._renderPickRoute = renderPickRoute;
  YarnLevel._lastPlayerResult = null;

  function getCurrentSolvePayload() {
    if (YarnLevel.Simulator && YarnLevel.Simulator.isActive && YarnLevel.Simulator.isActive() &&
        YarnLevel.Simulator._levelSpools) {
      return {
        spools: YarnLevel.Simulator._levelSpools,
        maprow: YarnLevel.Simulator._levelMaprow,
        mapcol: YarnLevel.Simulator._levelMapcol,
        blocks: YarnLevel.Simulator._levelBlocks || []
      };
    }
    return {
      spools: YarnLevel.BoardEditor.getSpools(),
      maprow: YarnLevel.BoardEditor.getMapRow(),
      mapcol: YarnLevel.BoardEditor.getMapCol(),
      blocks: (levelData && levelData.blocks) ? levelData.blocks : []
    };
  }

  function cachePlayerResult(playerRes) {
    if (!playerRes) return null;
    YarnLevel._lastPlayerResult = playerRes;
    if (YarnLevel.Simulator) YarnLevel.Simulator._playerTiers = playerRes;
    return playerRes;
  }

  function ensurePlayerResultBase(payload) {
    var res = (YarnLevel.Simulator && YarnLevel.Simulator._playerTiers) || YarnLevel._lastPlayerResult;
    if (!res) {
      res = YarnLevel.Validator.analyzePlayerSolution(payload.spools, payload.maprow, payload.mapcol, payload.blocks);
    }
    if (!res.tiers) res.tiers = {};
    if (!res.tiers.strong && res.pickOrder) res.tiers.strong = res;
    return cachePlayerResult(res);
  }

  function computeMissingTier(playerRes, payload, tierKey) {
    if (!playerRes.tiers) playerRes.tiers = {};
    if (playerRes.tiers[tierKey]) return playerRes.tiers[tierKey];
    if (YarnLevel.Validator.analyzePlayerTier) {
      playerRes.tiers[tierKey] = YarnLevel.Validator.analyzePlayerTier(
        payload.spools,
        payload.maprow,
        payload.mapcol,
        payload.blocks,
        tierKey
      );
    } else if (YarnLevel.Validator.analyzePlayerSolutionAllTiers) {
      var all = YarnLevel.Validator.analyzePlayerSolutionAllTiers(payload.spools, payload.maprow, payload.mapcol, payload.blocks);
      playerRes.tiers = all && all.tiers ? all.tiers : playerRes.tiers;
    }
    cachePlayerResult(playerRes);
    return playerRes.tiers[tierKey] || null;
  }

  function ensureCombinedPlayerResult(playerRes) {
    if (YarnLevel.Validator.composePlayerTierResult) {
      var merged = YarnLevel.Validator.composePlayerTierResult(playerRes.tiers || {});
      if (merged) return cachePlayerResult(merged);
    }
    return playerRes;
  }

  YarnLevel._ensureSimRoute = function(which) {
    var payload = getCurrentSolvePayload();
    if (!payload.blocks || payload.blocks.length === 0) return null;

    if (which === 'omni') {
      if (YarnLevel.Simulator && YarnLevel.Simulator._omniResult) return YarnLevel.Simulator._omniResult;
      var omni = YarnLevel.Validator.analyzeOptimalSolution(payload.spools, payload.maprow, payload.mapcol, payload.blocks);
      if (YarnLevel.Simulator) YarnLevel.Simulator._omniResult = omni;
      return omni;
    }

    var playerRes = ensurePlayerResultBase(payload);
    if (!playerRes) return null;

    if (which === 'combined') {
      computeMissingTier(playerRes, payload, 'novice');
      computeMissingTier(playerRes, payload, 'mid');
      computeMissingTier(playerRes, payload, 'strong');
      return ensureCombinedPlayerResult(playerRes);
    }

    return computeMissingTier(playerRes, payload, which);
  };

  // 难度/卡点块（客观难度 + 曲线质量 + 复合压力曲线/卡点压力曲线）—— 抽成函数，切换档位时整块重渲染
  function buildDifficultyBlockHTML(ds) {
    if (!ds) return '';
    var tierColorMap = { '简单':'#5cb85c', '普通':'#4a90d9', '困难':'#f0ad4e', '极难':'#d9534f' };
    var tc2 = tierColorMap[ds.difficultyTier] || '#4a90d9';
    var h = '';
    h += '<div class="warn-item" style="border-left-color:' + tc2 + ';">';
    h += '🎯 客观难度: <strong style="color:' + tc2 + ';">' + ds.difficultyTier + '</strong> (强度 ' + ds.difficultyStrength + '/100)';
    if (ds.auditTier) {
      var atN = { novice: '🐣 菜鸟', mid: '🙂 中级', strong: '😎 高手' }[ds.auditTier] || ds.auditTier;
      h += ' <span style="font-size:11px;color:#718096;">基准档：' + atN + (ds._fromAudit ? ' ｜📋来自生产审核(未重算)' : '') + '</span>';
    }
    h += '</div>';
    var qColorMap = { '符合预期':'#5cb85c', '趋势符合':'#4a90d9', '不符合预期':'#d9534f', '正常简单关':'#718096', '异常(过于简单)':'#d9534f', '数据不足':'#a0aec0' };
    var qc = qColorMap[ds.curveQuality] || '#718096';
    h += '<div class="warn-item" style="border-left-color:' + qc + ';">';
    h += '📐 曲线质量: <strong style="color:' + qc + ';">' + ds.curveQuality + '</strong> | 卡点 ' + ds.peakBand + (ds.peakInZone ? ' ✓' : ' ✗') + ' | 目标区 暂存' + ds.zoneAvgBuf + '/滞留' + ds.zoneAvgRes + ' vs 前期 暂存' + ds.earlyAvgBuf + '/滞留' + ds.earlyAvgRes;
    h += '<br><span style="font-size:11px;color:#718096;">' + ds.diagnosis + '</span>';
    if (ds.tierClearNote) h += '<br><span style="font-size:11px;color:#d9534f;font-weight:600;">⚠ ' + ds.tierClearNote + '</span>';
    if (ds.artNote) h += '<br><span style="font-size:11px;color:#d9534f;">🎨 调整建议: ' + ds.artNote + '</span>';
    h += '</div>';
    // 复合压力曲线迷你柱状（即卡点压力曲线）
    h += '<div class="warn-item" style="border-left-color:#9b59b6;">';
    h += '<div style="font-size:11px;color:#718096;margin-bottom:3px;">复合压力曲线(进度0→100%，暂存压力×滞留):</div>';
    h += '<div style="display:flex;align-items:flex-end;gap:2px;height:40px;">';
    var cc = ds.compositeCurve || [];
    var maxC = Math.max.apply(null, cc.concat([1]));
    for (var ci = 0; ci < cc.length; ci++) {
      var hh = Math.round(cc[ci] / maxC * 40);
      var inZ = (ci >= 5 && ci <= 8);
      var barC = ci === 9 ? '#cbd5e0' : (inZ ? '#9b59b6' : '#b8c2cc');
      h += '<div style="flex:1;height:' + Math.max(1, hh) + 'px;background:' + barC + ';border-radius:1px;" title="' + (ci * 10) + '-' + ((ci + 1) * 10) + '%: ' + cc[ci] + '"></div>';
    }
    h += '</div>';
    h += '<div style="font-size:10px;color:#a0aec0;margin-top:2px;">紫=50-90%目标卡点区，灰=收尾(不计卡点)</div>';
    h += '</div>';
    return h;
  }

  // 切换显示某档（novice/mid/strong/combined）的模拟路线
  YarnLevel._showTierRoute = function(which) {
    // 若该档正是该关"审核基准档"且有审核求解数据 → 直接复用导出的最好那遍（不重新求解）
    var auditEntry = (YarnLevel._auditData && YarnLevel._currentLevelFile) ? YarnLevel._auditData[YarnLevel._currentLevelFile] : null;
    var useAudit = !!(auditEntry && auditEntry.solve && which === auditEntry.auditTier);
    var src = useAudit ? _resultFromSolve(auditEntry.solve, auditEntry.auditTier)
                       : (YarnLevel._ensureSimRoute ? YarnLevel._ensureSimRoute(which) : null);
    if (!src) return;
    var po = src ? src.pickOrder : null;
    renderPickRoute(po);

    // 同步：暂存区变化图切到该档曲线
    if (src && src.stepBufferHistory && src.stepBufferHistory.length > 0) {
      showBufferChart(src.stepBufferHistory, src.bufferLimit || 7, 0, {
        totalSteps: src.totalSteps,
        progress: src.progress
      });
    }

    // 同步：卡点压力曲线 + 客观难度/曲线质量 也切到该档（按该档曲线重算 computeDifficultyScore）
    var dcBlock = document.getElementById('difficulty-curve-block');
    if (dcBlock && which !== 'omni') {
      var omniS = (YarnLevel.Simulator && YarnLevel.Simulator._omniResult) || null;
      var atForScore = (which === 'combined') ? 'strong' : which; // 综合用高手口径做卡点判定
      try {
        var dsTier;
        if (useAudit && auditEntry.score) {
          dsTier = auditEntry.score; dsTier._fromAudit = true; // 审核档直接用导出结论
        } else {
          dsTier = YarnLevel.Validator.computeDifficultyScore(src, { omniResult: omniS, auditTier: atForScore });
        }
        YarnLevel._lastDS = dsTier;
        dcBlock.innerHTML = buildDifficultyBlockHTML(dsTier);
      } catch (e) { /* 该档曲线数据不足时保持原状 */ }
    }

    // 同步：模拟游玩(enterSimMode)使用同一条路线
    if (YarnLevel.Simulator && src) {
      // 用该档结果作为模拟推演的参考路线
      YarnLevel.Simulator._optimalResult = src;
      YarnLevel.Simulator._routeTier = which;
    }
    // 记录待用路线，进入"模拟游玩"时沿用该档
    YarnLevel._pendingRouteResult = src || null;
    YarnLevel._pendingRouteTier = which;

    // 更新按钮高亮 + 提示文字
    var labels = { novice: '🐣 菜鸟', mid: '🙂 中级', strong: '😎 高手', combined: '👥 综合' };
    var colors = { novice: '#d9534f', mid: '#f0ad4e', strong: '#5cb85c', combined: '#4a90d9' };
    var btns = document.querySelectorAll('.route-btn');
    for (var b = 0; b < btns.length; b++) {
      var t = btns[b].getAttribute('onclick').match(/'(\w+)'/)[1];
      if (t === which) { btns[b].style.background = colors[t]; btns[b].style.color = '#fff'; }
      else { btns[b].style.background = '#fff'; btns[b].style.color = colors[t]; }
    }
    var hintEl = document.querySelector('.route-btn');
    if (hintEl && hintEl.parentElement && hintEl.parentElement.nextElementSibling) {
      hintEl.parentElement.nextElementSibling.textContent = '当前显示：' + (labels[which] || which) + '路线' +
        (po ? '（' + po.length + '步）' : '（无数据）');
    }
  };

  // ==================== 导入 ====================
  // 判断导入的 JSON 是否是"审核求解数据.json"（{文件名:{auditTier,solve,score}} 映射，而非关卡）
  function _looksLikeAuditData(obj) {
    if (!obj || obj.blocks || obj.spools) return false;
    var ks = Object.keys(obj);
    if (!ks.length) return false;
    var v = obj[ks[0]];
    return !!(v && typeof v === 'object' && v.solve && v.score);
  }

  // 把导出的"最好那遍"解法还原成 showOptimalSolution 可用的 result 结构
  function _resultFromSolve(solve, tier) {
    var r = {};
    for (var k in solve) { if (Object.prototype.hasOwnProperty.call(solve, k)) r[k] = solve[k]; }
    r.auditTier = tier;
    r.solverVersion = 'AuditExport:' + tier;
    r.tiers = {}; r.tiers[tier] = solve;
    return r;
  }

  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var json = JSON.parse(e.target.result);
        // 审核求解数据：存为查表，不当关卡载入
        if (_looksLikeAuditData(json)) {
          YarnLevel._auditData = Object.assign(YarnLevel._auditData || {}, json);
          var n = Object.keys(json).length;
          document.getElementById('file-name').value = file.name + '（审核求解数据·' + n + '关）';
          alert('已载入审核求解数据（' + n + ' 关）。\n再导入对应"合格关卡"JSON后，点"模拟玩家"会直接复用生产审核的解法与曲线，不再临时求解（消除随机扰动）。');
          return;
        }
        loadLevel(json);
        YarnLevel._currentLevelFile = file.name;   // 供审核求解数据按文件名匹配
        // 更新文件名
        document.getElementById('file-name').value = file.name;
      } catch (err) {
        alert('JSON解析失败: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function loadLevel(json) {
    levelData = json;
    YarnLevel._currentLevelFile = null;   // 先清空：仅在 importFile 按文件名导入时才设回，避免沿用上一关的审核数据
    YarnLevel._lastPlayerResult = null;
    YarnLevel._pendingRouteResult = null;
    YarnLevel._pendingRouteTier = null;
    YarnLevel._lastDS = null;

    // toprow
    var toprow = json.toprow || 8;
    document.getElementById('input-toprow').value = toprow;

    // 目标区
    if (json.blocks && json.blocks.length > 0) {
      // 根据目标图大小自动选择初始缩放（大图用小格，小图用大格）
      var bcols = json.blocks[0].length;
      var autoZoom = bcols >= 60 ? 8 : (bcols >= 40 ? 11 : (bcols >= 20 ? 14 : 16));
      var zoomInput = document.getElementById('input-target-zoom');
      if (zoomInput) {
        zoomInput.value = autoZoom;
        var valEl = document.getElementById('target-zoom-val');
        if (valEl) valEl.textContent = autoZoom + 'px';
      }
      YarnLevel.TargetViewer.setZoom(autoZoom);
      YarnLevel.TargetViewer.render(json.blocks);
    } else {
      YarnLevel.TargetViewer.clear();
    }

    // 元素区
    var maprow = json.maprow || 9;
    var mapcol = json.mapcol || 10;
    document.getElementById('input-maprow').value = maprow;
    document.getElementById('input-mapcol').value = mapcol;

    if (json.spools && json.spools.length > 0) {
      YarnLevel.BoardEditor.loadSpools(json.spools, maprow, mapcol);
    } else {
      YarnLevel.BoardEditor.createEmpty(maprow, mapcol);
    }

    // 清除验证状态
    clearValidation();
  }

  // ==================== 导出 ====================
  function exportJSON() {
    var output = {};

    // toprow
    output.toprow = parseInt(document.getElementById('input-toprow').value) || 8;

    // blocks（保留原始导入数据，或空数组）
    if (levelData && levelData.blocks) {
      output.blocks = levelData.blocks;
    } else {
      output.blocks = [];
    }

    // maprow / mapcol
    var size = YarnLevel.BoardEditor.getSize();
    output.maprow = size.maprow;
    output.mapcol = size.mapcol;

    // spools
    output.spools = YarnLevel.BoardEditor.getSpools();

    // 如果原始数据有其他字段，保留
    if (levelData) {
      var preserveKeys = Object.keys(levelData);
      for (var i = 0; i < preserveKeys.length; i++) {
        var key = preserveKeys[i];
        if (!output.hasOwnProperty(key)) {
          output[key] = levelData[key];
        }
      }
    }

    // 生成JSON字符串
    var jsonStr = JSON.stringify(output, null, 2);

    // 下载
    var fileName = document.getElementById('file-name').value || '未命名关卡.json';
    if (!fileName.endsWith('.json')) fileName += '.json';

    var blob = new Blob([jsonStr], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==================== 批量分析 ====================
  /**
   * 批量导入多个JSON关卡，逐个求解，导出暂存区变化数据汇总表格
   * 输出格式：CSV，每行一个关卡的逐步暂存区数据
   */
  function batchAnalyze(files) {
    // 按文件名排序
    files.sort(function(a, b) { return a.name.localeCompare(b.name); });
    
    var totalFiles = files.length;
    var results = []; // [{fileName, result, error}]
    var processed = 0;
    
    // 显示进度弹窗
    var overlay = document.createElement('div');
    overlay.id = 'batch-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
    var panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;border-radius:12px;padding:32px 40px;min-width:400px;max-width:600px;box-shadow:0 10px 40px rgba(0,0,0,0.3);';
    panel.innerHTML = '<h3 style="margin:0 0 16px;font-size:18px;">📊 批量分析进行中</h3>' +
      '<div id="batch-progress-text" style="font-size:14px;color:#4a5568;margin-bottom:12px;">准备中...</div>' +
      '<div style="background:#e2e8f0;border-radius:6px;height:8px;overflow:hidden;">' +
      '<div id="batch-progress-bar" style="background:#4a90d9;height:100%;width:0%;transition:width 0.3s;border-radius:6px;"></div></div>' +
      '<div id="batch-log" style="margin-top:16px;max-height:200px;overflow-y:auto;font-size:12px;color:#718096;border:1px solid #e2e8f0;border-radius:6px;padding:8px;"></div>' +
      '<div style="margin-top:16px;text-align:right;">' +
      '<button id="batch-cancel-btn" style="padding:6px 16px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;background:#fff;">取消</button></div>';
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    
    var cancelled = false;
    document.getElementById('batch-cancel-btn').onclick = function() {
      cancelled = true;
      document.body.removeChild(overlay);
    };
    
    function updateProgress(msg) {
      var pct = Math.round(processed / totalFiles * 100);
      document.getElementById('batch-progress-bar').style.width = pct + '%';
      document.getElementById('batch-progress-text').textContent = '正在分析 ' + processed + '/' + totalFiles + ' (' + pct + '%)';
      var log = document.getElementById('batch-log');
      log.innerHTML += '<div>' + msg + '</div>';
      log.scrollTop = log.scrollHeight;
    }
    
    // 逐个读取文件并求解（使用setTimeout避免阻塞UI）
    function processNext(index) {
      if (cancelled || index >= totalFiles) {
        if (!cancelled) finishBatch(results);
        return;
      }
      
      var file = files[index];
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var json = JSON.parse(e.target.result);
          var spools = json.spools;
          var maprow = json.maprow || 9;
          var mapcol = json.mapcol || 10;
          var blocks = json.blocks || [];
          
          if (!spools || !blocks || blocks.length === 0) {
            processed++;
            results.push({ fileName: file.name, result: null, error: '缺少spools或blocks数据' });
            updateProgress('⚠ ' + file.name + ': 数据不完整，跳过');
            setTimeout(function() { processNext(index + 1); }, 10);
            return;
          }
          
          updateProgress('🔍 ' + file.name + ' 求解中...');
          
          // 异步求解（让UI有时间更新）。同时跑全知最优版 + 模拟玩家版。
          setTimeout(function() {
            try {
              var result = YarnLevel.Validator.analyzeOptimalSolution(spools, maprow, mapcol, blocks);
              var playerResult = null;
              try {
                playerResult = YarnLevel.Validator.analyzePlayerSolution(spools, maprow, mapcol, blocks);
              } catch (ep) { playerResult = null; }

              processed++;
              results.push({ fileName: file.name, result: result, playerResult: playerResult, error: null });
              var status = result.completed ? '✓' : '⚠';
              var att = (playerResult && playerResult.attempts !== undefined) ? (' 玩家尝试=' + playerResult.attempts) : '';
              var info = status + ' ' + file.name + ': 全知' + result.progress + '% 步=' + result.totalSteps + ' 峰=' + result.maxBuffer + att;
              updateProgress(info);
              setTimeout(function() { processNext(index + 1); }, 10);
            } catch (err) {
              processed++;
              results.push({ fileName: file.name, result: null, playerResult: null, error: err.message });
              updateProgress('✗ ' + file.name + ': ' + err.message);
              setTimeout(function() { processNext(index + 1); }, 10);
            }
          }, 50);
          
        } catch (err) {
          processed++;
          results.push({ fileName: file.name, result: null, error: 'JSON解析失败: ' + err.message });
          updateProgress('✗ ' + file.name + ': JSON解析失败');
          setTimeout(function() { processNext(index + 1); }, 10);
        }
      };
      reader.readAsText(file);
    }
    
    processNext(0);
  }
  
  /**
   * 批量分析完成，生成并导出CSV
   */
  function finishBatch(results) {
    var overlay = document.getElementById('batch-overlay');
    
    // 统计
    var successCount = 0;
    var failCount = 0;
    var maxSteps = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i].result) {
        successCount++;
        if (results[i].result.stepBufferHistory.length > maxSteps) {
          maxSteps = results[i].result.stepBufferHistory.length;
        }
      } else {
        failCount++;
      }
    }
    
    // 更新界面为完成状态
    var panel = overlay.querySelector('div');
    panel.innerHTML = '<h3 style="margin:0 0 16px;font-size:18px;">✅ 批量分析完成</h3>' +
      '<div style="font-size:14px;color:#4a5568;margin-bottom:16px;">' +
      '成功: <strong>' + successCount + '</strong> 个 | 失败: <strong>' + failCount + '</strong> 个 | 最大步数: <strong>' + maxSteps + '</strong></div>' +
      '<div style="margin-bottom:12px;font-size:13px;color:#718096;">选择导出格式：</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
      '<button id="batch-export-detail" style="padding:8px 16px;background:#4a90d9;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">📥 导出详细表（逐步数据）</button>' +
      '<button id="batch-export-summary" style="padding:8px 16px;background:#5cb85c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">📋 导出汇总表</button>' +
      '<button id="batch-export-pressure" style="padding:8px 16px;background:#9b59b6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">📈 导出进度压力表</button>' +
      '<button id="batch-export-compare" style="padding:8px 16px;background:#e67e22;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">🆚 导出横向对比表</button>' +
      '<button id="batch-export-rank" style="padding:8px 16px;background:#16a085;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">🏆 导出难度排序</button>' +
      '<button id="batch-export-analysis" style="padding:8px 16px;background:#8e44ad;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">📊 导出难度分析</button>' +
      '<button id="batch-export-both" style="padding:8px 16px;background:#f0ad4e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">📦 全部导出</button>' +
      '</div>' +
      '<div style="margin-top:16px;text-align:right;">' +
      '<button id="batch-close-btn" style="padding:6px 16px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;background:#fff;">关闭</button></div>';
    
    document.getElementById('batch-close-btn').onclick = function() {
      document.body.removeChild(overlay);
    };
    document.getElementById('batch-export-detail').onclick = function() {
      exportBatchDetailCSV(results, maxSteps);
    };
    document.getElementById('batch-export-summary').onclick = function() {
      exportBatchSummaryCSV(results);
    };
    document.getElementById('batch-export-pressure').onclick = function() {
      exportBatchPressureCSV(results);
    };
    var cmpBtn = document.getElementById('batch-export-compare');
    if (cmpBtn) cmpBtn.onclick = function() {
      exportBatchCompareCSV(results);
    };
    var rankBtn = document.getElementById('batch-export-rank');
    if (rankBtn) rankBtn.onclick = function() {
      exportBatchRankCSV(results);
    };
    var anaBtn = document.getElementById('batch-export-analysis');
    if (anaBtn) anaBtn.onclick = function() {
      exportBatchAnalysisCSV(results);
    };
    document.getElementById('batch-export-both').onclick = function() {
      exportBatchAsZip(results, maxSteps);
    };
  }
  
  /**
   * 导出详细表：每行一个关卡，每列一个步骤的暂存区值
   * 格式：关卡名, 步1, 步2, 步3, ..., 步N
   */
  function exportBatchDetailCSV(results, maxSteps) {
    var rows = [];
    
    // 表头
    var header = ['关卡名'];
    for (var s = 1; s <= maxSteps; s++) {
      header.push('步' + s);
    }
    rows.push(header.join(','));
    
    // 数据行
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r.result) continue;
      var row = [r.fileName.replace('.json', '')];
      var hist = r.result.stepBufferHistory;
      for (var s = 0; s < maxSteps; s++) {
        row.push(s < hist.length ? hist[s] : '');
      }
      rows.push(row.join(','));
    }
    
    var csv = '\uFEFF' + rows.join('\n');
    downloadFile(csv, '批量分析_暂存区逐步数据.csv', 'text/csv;charset=utf-8;');
  }
  
  /**
   * 导出汇总表：每行一个关卡的关键指标
   */
  function exportBatchSummaryCSV(results) {
    var rows = [];
    
    // 表头
    rows.push(['关卡名', '是否通关', '总步数', '进度%', '暂存峰值', '平均暂存', '暂存占用率%', '消除线轴数', '总线轴数', '求解耗时ms', '暂存≥4步数', '暂存≥5步数', '暂存=6步数', '压力区间(连续≥4)'].join(','));
    
    // 数据行
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r.result) {
        rows.push([r.fileName.replace('.json', ''), '失败', '', '', '', '', '', '', '', '', '', '', '', r.error || ''].join(','));
        continue;
      }
      var res = r.result;
      var hist = res.stepBufferHistory || [];
      
      // 计算暂存区压力指标
      var count4 = 0, count5 = 0, count6 = 0;
      var pressureZones = []; // 连续暂存>=4的区间
      var zoneStart = -1;
      for (var s = 0; s < hist.length; s++) {
        if (hist[s] >= 4) count4++;
        if (hist[s] >= 5) count5++;
        if (hist[s] >= 6) count6++;
        if (hist[s] >= 4) {
          if (zoneStart === -1) zoneStart = s + 1;
        } else {
          if (zoneStart !== -1) {
            pressureZones.push(zoneStart + '-' + s);
            zoneStart = -1;
          }
        }
      }
      if (zoneStart !== -1) {
        pressureZones.push(zoneStart + '-' + hist.length);
      }
      
      var row = [
        r.fileName.replace('.json', ''),
        res.completed ? '是' : '否',
        res.totalSteps,
        res.progress,
        res.maxBuffer,
        res.avgBuffer,
        res.avgBufferRatio,
        res.eliminatedSpools,
        res.totalTargetSpools,
        res.solverTime || '',
        count4,
        count5,
        count6,
        pressureZones.length > 0 ? '"' + pressureZones.join('; ') + '"' : '无'
      ];
      rows.push(row.join(','));
    }
    
    var csv = '\uFEFF' + rows.join('\n');
    downloadFile(csv, '批量分析_暂存区汇总.csv', 'text/csv;charset=utf-8;');
  }
  
  /**
   * 导出横向对比表：每行一个关卡，全知最优版 vs 模拟玩家版 指标并排对比
   */
  function exportBatchCompareCSV(results) {
    var csv = '\uFEFF' + generateBatchCompareContent(results);
    downloadFile(csv, '批量分析_横向对比表.csv', 'text/csv;charset=utf-8;');
  }

  function exportBatchRankCSV(results) {
    var csv = '\uFEFF' + generateBatchRankContent(results);
    downloadFile(csv, '批量分析_难度排序.csv', 'text/csv;charset=utf-8;');
  }

  function exportBatchAnalysisCSV(results) {
    var csv = '\uFEFF' + generateBatchAnalysisContent(results);
    downloadFile(csv, '批量分析_难度分析汇总.csv', 'text/csv;charset=utf-8;');
  }

  // 难度标签：暂时以"玩家版平均暂存占用率"为指标（之后再优化）。
  // 平均暂存越高、越接近上限7，玩家操作越紧张 → 越难。
  function difficultyLabelByBuffer(playerResult) {
    if (!playerResult) return '-';
    if (!playerResult.completed) return '极难/未通关';
    var ratio = playerResult.avgBufferRatio; // 0-100
    if (ratio < 20) return '简单';
    if (ratio < 40) return '普通';
    if (ratio < 60) return '较难';
    if (ratio < 80) return '很难';
    return '极难';
  }

  function generateBatchCompareContent(results) {
    var rows = [];
    rows.push([
      '关卡名', '总线轴数', '锁链对数',
      '全知_通关', '全知_步数', '全知_暂存峰值', '全知_平均暂存', '全知_占用率%',
      '菜鸟_通关', '菜鸟_尝试', '菜鸟_误触', '菜鸟_峰值', '菜鸟_平均暂存', '菜鸟_占用率%',
      '中级_通关', '中级_尝试', '中级_误触', '中级_峰值', '中级_平均暂存', '中级_占用率%',
      '高手_通关', '高手_尝试', '高手_误触', '高手_峰值', '高手_平均暂存', '高手_占用率%',
      '综合_通关率%', '综合_加权峰值', '综合_加权平均暂存', '综合_占用率%',
      '难度标签(按综合平均暂存)',
      '难度强度', '难度档', '曲线质量', '卡点区间', '卡点达标', '目标区平均暂存', '目标区平均滞留', '前期平均暂存', '前期平均滞留', '问题类型', '各档通关情况', '调整建议(美术)', '诊断'
    ].join(','));

    function tierCols(t) {
      if (!t) return ['-','-','-','-','-','-'];
      return [t.completed?'是':'否', (t.attempts!==undefined?t.attempts:'-'), (t.misclicks||0), t.maxBuffer, t.avgBuffer, t.avgBufferRatio];
    }

    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var name = r.fileName.replace('.json', '');
      if (!r.result) {
        rows.push([name].concat(new Array(42).fill('')).concat([r.error||'失败']).join(','));
        continue;
      }
      var o = r.result;
      var p = r.playerResult;
      var tiers = p && p.tiers ? p.tiers : {};

      var chainPairs = (o.completed && typeof o.totalTargetSpools === 'number') ? (o.totalTargetSpools - o.totalSteps) : '';
      var label = difficultyLabelByBuffer(p);
      var ds = (p && YarnLevel.Validator.computeDifficultyScore) ? YarnLevel.Validator.computeDifficultyScore(p, { omniResult: o }) : null;

      var row = [
        name, o.totalTargetSpools, chainPairs,
        o.completed?'是':'否', o.totalSteps, o.maxBuffer, o.avgBuffer, o.avgBufferRatio
      ];
      row = row.concat(tierCols(tiers.novice)).concat(tierCols(tiers.mid)).concat(tierCols(tiers.strong));
      row = row.concat([
        (p && p.passRate !== undefined ? p.passRate : ''),
        (p ? p.maxBuffer : ''), (p ? p.avgBuffer : ''), (p ? p.avgBufferRatio : ''),
        label
      ]);
      if (ds) {
        row = row.concat([ds.difficultyStrength, ds.difficultyTier, ds.curveQuality, ds.peakBand, ds.peakInZone?'是':'否', ds.zoneAvgBuf, ds.zoneAvgRes, ds.earlyAvgBuf, ds.earlyAvgRes, (ds.issueType||'-'), '"' + (ds.tierClearNote||'全部通关') + '"', '"' + (ds.artNote||'') + '"', '"' + ds.diagnosis + '"']);
      } else {
        row = row.concat(['','','','','','','','','','','','','']);
      }
      rows.push(row.join(','));
    }
    return rows.join('\n');
  }

  // 难度排序表：按综合玩家占用率从难到易
  function generateBatchRankContent(results) {
    var valid = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (r.result && r.playerResult) valid.push(r);
    }
    var DS = YarnLevel.Validator.computeDifficultyScore;
    valid.sort(function(a, b) {
      var sa = DS ? DS(a.playerResult, { omniResult: a.result }).difficultyStrength : a.playerResult.avgBufferRatio;
      var sb = DS ? DS(b.playerResult, { omniResult: b.result }).difficultyStrength : b.playerResult.avgBufferRatio;
      return sb - sa;
    });
    var rows = [];
    rows.push(['排名', '关卡名', '难度强度', '难度档', '曲线质量', '卡点区间', '卡点达标', '目标区平均暂存', '目标区平均滞留', '前期平均暂存', '前期平均滞留', '问题类型', '各档通关情况', '调整建议(美术)',
      '综合占用%', '综合加权峰值', '平均滞留', '原始滞留',
      '全知占用%', '菜鸟占用%', '中级占用%', '高手占用%', '总球数'].join(','));
    for (var k = 0; k < valid.length; k++) {
      var r = valid[k];
      var p = r.playerResult, o = r.result;
      var tn = p.tiers ? p.tiers.novice : null;
      var tm = p.tiers ? p.tiers.mid : null;
      var ts = p.tiers ? p.tiers.strong : null;
      var ds = DS ? DS(p, { omniResult: o }) : null;
      rows.push([
        k + 1, r.fileName.replace('.json', ''),
        ds ? ds.difficultyStrength : '', ds ? ds.difficultyTier : '', ds ? ds.curveQuality : '',
        ds ? ds.peakBand : '', ds ? (ds.peakInZone?'是':'否') : '', ds ? ds.zoneAvgBuf : '',
        ds ? ds.zoneAvgRes : '', ds ? ds.earlyAvgBuf : '', ds ? ds.earlyAvgRes : '', ds ? (ds.issueType||'-') : '', ds ? ('"' + (ds.tierClearNote||'全部通关') + '"') : '', ds ? ('"' + (ds.artNote||'') + '"') : '',
        p.avgBufferRatio, p.maxBuffer, p.avgResidence, p.avgRawResidence,
        o.avgBufferRatio, tn ? tn.avgBufferRatio : '', tm ? tm.avgBufferRatio : '', ts ? ts.avgBufferRatio : '',
        o.totalTargetSpools
      ].join(','));
    }
    return rows.join('\n');
  }

  // 难度分析汇总：总览 + 各档统计 + 最难/最简单/技术差距/高压关
  function generateBatchAnalysisContent(results) {
    var valid = [];
    for (var i = 0; i < results.length; i++) {
      if (results[i].result && results[i].playerResult) valid.push(results[i]);
    }
    var n = valid.length;
    function avgOf(getter) { var s = 0; for (var i = 0; i < n; i++) s += getter(valid[i]); return n ? s / n : 0; }
    function rnd(x, d) { var p = Math.pow(10, d || 0); return Math.round(x * p) / p; }
    function tier(r, key) { return r.playerResult.tiers ? r.playerResult.tiers[key] : null; }

    var DS = YarnLevel.Validator.computeDifficultyScore;
    // 难度档分布（新评分：简单/普通/困难/极难）+ 曲线质量分布
    var diffCount = {}, qualCount = {}, inZoneCnt = 0;
    var skillGapCnt = 0, noviceFailCnt = 0, midFailCnt = 0, strongFailCnt = 0;
    for (var i = 0; i < n; i++) {
      var ds0 = DS(valid[i].playerResult, { omniResult: valid[i].result });
      diffCount[ds0.difficultyTier] = (diffCount[ds0.difficultyTier] || 0) + 1;
      qualCount[ds0.curveQuality] = (qualCount[ds0.curveQuality] || 0) + 1;
      if (ds0.peakInZone) inZoneCnt++;
      if (ds0.skillGapBig) skillGapCnt++;
      if (ds0.tierPass) {
        if (ds0.tierPass.novice === false) noviceFailCnt++;
        if (ds0.tierPass.mid === false) midFailCnt++;
        if (ds0.tierPass.strong === false) strongFailCnt++;
      }
    }

    var rows = [];
    rows.push(['分类', '项目', '数值1', '数值2', '数值3'].join(','));
    rows.push(['总览', '关卡总数', n, '', ''].join(','));
    var dorder = ['简单','普通','困难','极难'];
    for (var di = 0; di < dorder.length; di++) {
      if (diffCount[dorder[di]]) rows.push(['难度档', dorder[di], diffCount[dorder[di]], rnd(diffCount[dorder[di]]/n*100,0)+'%', ''].join(','));
    }
    var qorder = ['好关','合格','差关','平淡'];
    for (var qi = 0; qi < qorder.length; qi++) {
      if (qualCount[qorder[qi]]) rows.push(['曲线质量', qorder[qi], qualCount[qorder[qi]], rnd(qualCount[qorder[qi]]/n*100,0)+'%', ''].join(','));
    }
    rows.push(['曲线质量', '卡点落在50-90%', inZoneCnt + '/' + n, rnd(inZoneCnt/n*100,0)+'%', ''].join(','));
    rows.push(['通关情况', '菜鸟无法通关', noviceFailCnt + '/' + n, rnd(noviceFailCnt/n*100,0)+'%', ''].join(','));
    rows.push(['通关情况', '中级无法通关', midFailCnt + '/' + n, rnd(midFailCnt/n*100,0)+'%', ''].join(','));
    rows.push(['通关情况', '高手无法通关', strongFailCnt + '/' + n, rnd(strongFailCnt/n*100,0)+'%', ''].join(','));
    rows.push(['通关情况', '各水平难度差距大', skillGapCnt + '/' + n, rnd(skillGapCnt/n*100,0)+'%', '部分档通关/部分档卡死'].join(','));
    var overflow = 0, allPass = 0;
    for (var i = 0; i < n; i++) {
      if (valid[i].playerResult.completed) allPass++;
      ['novice','mid','strong'].forEach(function(key){ var t = tier(valid[i], key); if (t && t.maxBuffer > 7) overflow++; });
    }
    rows.push(['总览', '综合通关关数', allPass + '/' + n, '', ''].join(','));
    rows.push(['总览', '暂存溢出关数', overflow, '', ''].join(','));

    // 各档平均占用率与误触
    var tiers = [['novice','菜鸟'],['mid','中级'],['strong','高手']];
    // 全知（理论最优基准）
    rows.push(['基准', '全知最优', '平均占用率'+rnd(avgOf(function(r){return r.result.avgBufferRatio;}),1)+'%', '平均峰值'+rnd(avgOf(function(r){return r.result.maxBuffer;}),1), '理论下限'].join(','));
    for (var ti = 0; ti < tiers.length; ti++) {
      (function(key, name){
        var ratio = rnd(avgOf(function(r){ var t = tier(r,key); return t?t.avgBufferRatio:0; }), 1);
        var mis = rnd(avgOf(function(r){ var t = tier(r,key); return t?(t.misclicks||0):0; }), 2);
        var att = rnd(avgOf(function(r){ var t = tier(r,key); return t?(t.attempts||0):0; }), 2);
        rows.push(['各档', name, '平均占用率'+ratio+'%', '平均误触'+mis+'/关', '平均尝试'+att+'次'].join(','));
      })(tiers[ti][0], tiers[ti][1]);
    }
    rows.push(['综合', '加权', '平均占用率'+rnd(avgOf(function(r){return r.playerResult.avgBufferRatio;}),1)+'%', '平均加权峰值'+rnd(avgOf(function(r){return r.playerResult.maxBuffer;}),1), ''].join(','));

    // 最难 TOP10
    var byHard = valid.slice().sort(function(a,b){ return DS(b.playerResult, { omniResult: b.result }).difficultyStrength - DS(a.playerResult, { omniResult: a.result }).difficultyStrength; });
    for (var h = 0; h < Math.min(10, byHard.length); h++) {
      var rr = byHard[h]; var dsh = DS(rr.playerResult, { omniResult: rr.result });
      rows.push(['最难TOP10', (h+1)+' '+rr.fileName.replace('.json',''), '强度'+dsh.difficultyStrength, dsh.difficultyTier+'/'+dsh.curveQuality, '卡点'+dsh.peakBand].join(','));
    }
    // 最简单 TOP10
    for (var e = 0; e < Math.min(10, byHard.length); e++) {
      var rr2 = byHard[byHard.length - 1 - e]; var dse = DS(rr2.playerResult, { omniResult: rr2.result });
      rows.push(['最简单TOP10', (e+1)+' '+rr2.fileName.replace('.json',''), '强度'+dse.difficultyStrength, dse.difficultyTier+'/'+dse.curveQuality, '卡点'+dse.peakBand].join(','));
    }
    // 技术差距最大 TOP10（菜鸟-高手）
    var byGap = valid.slice().filter(function(r){ return tier(r,'novice') && tier(r,'strong'); })
      .sort(function(a,b){ return (tier(b,'novice').avgBufferRatio - tier(b,'strong').avgBufferRatio) - (tier(a,'novice').avgBufferRatio - tier(a,'strong').avgBufferRatio); });
    for (var g = 0; g < Math.min(10, byGap.length); g++) {
      var rg = byGap[g], dn = tier(rg,'novice').avgBufferRatio, ds = tier(rg,'strong').avgBufferRatio;
      rows.push(['技术差距TOP10', rg.fileName.replace('.json',''), '菜鸟'+dn+'%', '高手'+ds+'%', '落差'+rnd(dn-ds,1)].join(','));
    }
    // 高压关（加权峰值>=6）
    var hp = valid.slice().filter(function(r){ return r.playerResult.maxBuffer >= 6; })
      .sort(function(a,b){ return b.playerResult.maxBuffer - a.playerResult.maxBuffer; });
    for (var hpi = 0; hpi < hp.length; hpi++) {
      rows.push(['高压关峰值>=6', hp[hpi].fileName.replace('.json',''), '峰'+hp[hpi].playerResult.maxBuffer, '', ''].join(','));
    }
    return rows.join('\n');
  }
  
  /**
   * 导出进度压力表：按进度区间展示每个关卡的暂存区压力分布
   * 
   * 进度区间：0-15%, 15-30%, 30-40%, 40-50%, 50-60%, 60-70%, 70-80%, 80-90%, 90-100%
   * 
   * 压力计算：
   *   - 求解器平均暂存值（最优解压力）
   *   - 玩家预估压力 = 求解器压力 × 惩罚系数
   *   - 惩罚系数：有窄路的关卡后期压力×1.5~2.0，无窄路×1.2~1.4
   *   
   * 压力等级：5=高压🔴, 4=中压🟡, 3=轻压🟠, 0-2=低压🟢
   */
  function exportBatchPressureCSV(results) {
    var progressBands = [
      { label: '0-15%', lo: 0, hi: 15, playerMult: 1.1 },
      { label: '15-30%', lo: 15, hi: 30, playerMult: 1.2 },
      { label: '30-40%', lo: 30, hi: 40, playerMult: 1.25 },
      { label: '40-50%', lo: 40, hi: 50, playerMult: 1.3 },
      { label: '50-60%', lo: 50, hi: 60, playerMult: 1.35 },
      { label: '60-70%', lo: 60, hi: 70, playerMult: 1.4 },
      { label: '70-80%', lo: 70, hi: 80, playerMult: 1.45 },
      { label: '80-90%', lo: 80, hi: 90, playerMult: 1.5 },
      { label: '90-100%', lo: 90, hi: 100, playerMult: 1.55 }
    ];
    
    // 窄路额外惩罚系数（叠加在playerMult上）
    // 有窄路：后期进度段额外×1.3~1.5
    var narrowPenalty = [
      1.0,  // 0-15%  窄路此时影响不大
      1.0,  // 15-30%
      1.1,  // 30-40%  开始有影响
      1.15, // 40-50%
      1.2,  // 50-60%  中期窄路压力明显
      1.3,  // 60-70%
      1.4,  // 70-80%  后期窄路严重
      1.5,  // 80-90%  收尾窄路极大压力
      1.5   // 90-100%
    ];
    
    var rows = [];
    
    // 表头
    var header = ['关卡名', '是否通关', '总步数', '有无窄路'];
    for (var bi = 0; bi < progressBands.length; bi++) {
      header.push(progressBands[bi].label + '求解器暂存');
      header.push(progressBands[bi].label + '玩家预估压力');
      header.push(progressBands[bi].label + '压力等级');
      header.push(progressBands[bi].label + '峰值');
    }
    header.push('求解器整体均值');
    header.push('玩家预估整体均值');
    header.push('整体压力评级');
    rows.push(header.join(','));
    
    // 数据行
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r.result) {
        var emptyRow = [r.fileName.replace('.json', ''), '失败', '', ''];
        for (var bi = 0; bi < progressBands.length; bi++) {
          emptyRow.push('', '', '', '');
        }
        emptyRow.push('', '', '');
        rows.push(emptyRow.join(','));
        continue;
      }
      
      var res = r.result;
      var hist = res.stepBufferHistory || [];
      var totalSteps = res.totalSteps || hist.length;
      
      // 检测该关卡是否有窄路（通过corridorAnalysis）
      var hasNarrow = false;
      if (res.corridorAnalysis && res.corridorAnalysis.hasCriticalCorridor) {
        hasNarrow = true;
      }
      
      // 计算每步对应的进度百分比（线性近似）
      var stepProgress = [];
      for (var s = 0; s < hist.length; s++) {
        stepProgress.push(totalSteps > 0 ? (s + 1) / totalSteps * (res.progress || 100) : 0);
      }
      
      // 按进度区间统计
      var row = [r.fileName.replace('.json', ''), res.completed ? '是' : '否', totalSteps, hasNarrow ? '是' : '否'];
      var solverOverallSum = 0, playerOverallSum = 0, overallCount = 0;
      
      for (var bi = 0; bi < progressBands.length; bi++) {
        var band = progressBands[bi];
        var bandValues = [];
        
        for (var s = 0; s < hist.length; s++) {
          var prog = stepProgress[s];
          if (prog >= band.lo && (prog < band.hi || (band.hi === 100 && prog <= 100))) {
            bandValues.push(hist[s]);
          }
        }
        
        if (bandValues.length === 0) {
          row.push('', '', '', '');
        } else {
          var sum = 0, max = 0;
          for (var v = 0; v < bandValues.length; v++) {
            sum += bandValues[v];
            if (bandValues[v] > max) max = bandValues[v];
          }
          var solverAvg = sum / bandValues.length;
          
          // 玩家预估压力 = 求解器值 × 基础放大系数 × 窄路惩罚
          var mult = band.playerMult;
          if (hasNarrow) {
            mult *= narrowPenalty[bi];
          }
          var playerAvg = Math.min(6, solverAvg * mult);
          
          solverOverallSum += solverAvg * bandValues.length;
          playerOverallSum += playerAvg * bandValues.length;
          overallCount += bandValues.length;
          
          // 压力等级（基于玩家预估）
          var level;
          if (playerAvg >= 5) level = '高压🔴';
          else if (playerAvg >= 4) level = '中压🟡';
          else if (playerAvg >= 3) level = '轻压🟠';
          else level = '低压🟢';
          
          row.push(solverAvg.toFixed(2), playerAvg.toFixed(2), level, max);
        }
      }
      
      // 整体评级
      var solverOverall = overallCount > 0 ? solverOverallSum / overallCount : 0;
      var playerOverall = overallCount > 0 ? playerOverallSum / overallCount : 0;
      var overallLevel;
      if (playerOverall >= 4.5) overallLevel = '极难';
      else if (playerOverall >= 3.5) overallLevel = '困难';
      else if (playerOverall >= 2.5) overallLevel = '中等';
      else if (playerOverall >= 1.5) overallLevel = '简单';
      else overallLevel = '很简单';
      
      row.push(solverOverall.toFixed(2), playerOverall.toFixed(2), overallLevel);
      rows.push(row.join(','));
    }
    
    var csv = '\uFEFF' + rows.join('\n');
    downloadFile(csv, '批量分析_进度压力分布.csv', 'text/csv;charset=utf-8;');
  }

  /**
   * 通用文件下载
   */
  function downloadFile(content, fileName, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 全部导出为ZIP压缩包
   * 包含3个CSV文件：详细表、汇总表、进度压力表
   */
  function exportBatchAsZip(results, maxSteps) {
    // 生成3个CSV的内容
    var detailCSV = generateBatchDetailContent(results, maxSteps);
    var summaryCSV = generateBatchSummaryContent(results);
    var pressureCSV = generateBatchPressureContent(results);
    var compareCSV = generateBatchCompareContent(results);
    var rankCSV = generateBatchRankContent(results);
    var analysisCSV = generateBatchAnalysisContent(results);
    
    var files = [
      { name: '暂存区逐步数据.csv', content: detailCSV },
      { name: '暂存区汇总.csv', content: summaryCSV },
      { name: '进度压力分布.csv', content: pressureCSV },
      { name: '横向对比表.csv', content: compareCSV },
      { name: '难度排序.csv', content: rankCSV },
      { name: '难度分析汇总.csv', content: analysisCSV }
    ];
    
    // 生成ZIP
    var zipBlob = createZipBlob(files);
    var url = URL.createObjectURL(zipBlob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '批量分析结果.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 生成详细表CSV内容（不下载，返回字符串）
   */
  function generateBatchDetailContent(results, maxSteps) {
    var rows = [];
    var header = ['关卡名'];
    for (var s = 1; s <= maxSteps; s++) header.push('步' + s);
    rows.push(header.join(','));
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r.result) continue;
      var row = [r.fileName.replace('.json', '')];
      var hist = r.result.stepBufferHistory;
      for (var s = 0; s < maxSteps; s++) {
        row.push(s < hist.length ? hist[s] : '');
      }
      rows.push(row.join(','));
    }
    return '\uFEFF' + rows.join('\n');
  }

  /**
   * 生成汇总表CSV内容（不下载，返回字符串）
   */
  function generateBatchSummaryContent(results) {
    var rows = [];
    rows.push(['关卡名', '是否通关', '总步数', '进度%', '暂存峰值', '平均暂存', '暂存占用率%', '消除线轴数', '总线轴数', '求解耗时ms', '暂存≥4步数', '暂存≥5步数', '暂存=6步数', '压力区间(连续≥4)'].join(','));
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r.result) {
        rows.push([r.fileName.replace('.json', ''), '失败', '', '', '', '', '', '', '', '', '', '', '', r.error || ''].join(','));
        continue;
      }
      var res = r.result;
      var hist = res.stepBufferHistory || [];
      var count4 = 0, count5 = 0, count6 = 0;
      var pressureZones = [], zoneStart = -1;
      for (var s = 0; s < hist.length; s++) {
        if (hist[s] >= 4) count4++;
        if (hist[s] >= 5) count5++;
        if (hist[s] >= 6) count6++;
        if (hist[s] >= 4) { if (zoneStart === -1) zoneStart = s + 1; }
        else { if (zoneStart !== -1) { pressureZones.push(zoneStart + '-' + s); zoneStart = -1; } }
      }
      if (zoneStart !== -1) pressureZones.push(zoneStart + '-' + hist.length);
      rows.push([
        r.fileName.replace('.json', ''), res.completed ? '是' : '否', res.totalSteps, res.progress,
        res.maxBuffer, res.avgBuffer, res.avgBufferRatio, res.eliminatedSpools, res.totalTargetSpools,
        res.solverTime || '', count4, count5, count6,
        pressureZones.length > 0 ? '"' + pressureZones.join('; ') + '"' : '无'
      ].join(','));
    }
    return '\uFEFF' + rows.join('\n');
  }

  /**
   * 生成进度压力表CSV内容（不下载，返回字符串）
   * 复用exportBatchPressureCSV的逻辑但不下载
   */
  function generateBatchPressureContent(results) {
    var progressBands = [
      { label: '0-15%', lo: 0, hi: 15, playerMult: 1.1 },
      { label: '15-30%', lo: 15, hi: 30, playerMult: 1.2 },
      { label: '30-40%', lo: 30, hi: 40, playerMult: 1.25 },
      { label: '40-50%', lo: 40, hi: 50, playerMult: 1.3 },
      { label: '50-60%', lo: 50, hi: 60, playerMult: 1.35 },
      { label: '60-70%', lo: 60, hi: 70, playerMult: 1.4 },
      { label: '70-80%', lo: 70, hi: 80, playerMult: 1.45 },
      { label: '80-90%', lo: 80, hi: 90, playerMult: 1.5 },
      { label: '90-100%', lo: 90, hi: 100, playerMult: 1.55 }
    ];
    var narrowPenalty = [1.0, 1.0, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5, 1.5];
    var rows = [];
    var header = ['关卡名', '是否通关', '总步数', '有无窄路'];
    for (var bi = 0; bi < progressBands.length; bi++) {
      header.push(progressBands[bi].label + '求解器暂存');
      header.push(progressBands[bi].label + '玩家预估压力');
      header.push(progressBands[bi].label + '压力等级');
      header.push(progressBands[bi].label + '峰值');
    }
    header.push('求解器整体均值', '玩家预估整体均值', '整体压力评级', '窄路区间');
    rows.push(header.join(','));
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r.result) { var e = [r.fileName.replace('.json',''),'失败','','']; for(var b=0;b<progressBands.length;b++)e.push('','','',''); e.push('','','',''); rows.push(e.join(',')); continue; }
      var res = r.result, hist = res.stepBufferHistory||[], totalSteps = res.totalSteps||hist.length;
      var hasNarrow = !!(res.corridorAnalysis && res.corridorAnalysis.hasCriticalCorridor);
      var stepProgress = [];
      for (var s = 0; s < hist.length; s++) stepProgress.push(totalSteps > 0 ? (s+1)/totalSteps*(res.progress||100) : 0);
      var row = [r.fileName.replace('.json',''), res.completed?'是':'否', totalSteps, hasNarrow?'是':'否'];
      var sOS = 0, pOS = 0, oC = 0;
      for (var bi = 0; bi < progressBands.length; bi++) {
        var band = progressBands[bi], bv = [];
        for (var s = 0; s < hist.length; s++) { var p = stepProgress[s]; if (p >= band.lo && (p < band.hi || (band.hi===100&&p<=100))) bv.push(hist[s]); }
        if (bv.length===0) { row.push('','','',''); continue; }
        var sum=0,max=0; for(var v=0;v<bv.length;v++){sum+=bv[v];if(bv[v]>max)max=bv[v];}
        var sa = sum/bv.length, m = band.playerMult*(hasNarrow?narrowPenalty[bi]:1), pa = Math.min(6,sa*m);
        sOS+=sa*bv.length; pOS+=pa*bv.length; oC+=bv.length;
        var lv; if(pa>=5)lv='高压🔴';else if(pa>=4)lv='中压🟡';else if(pa>=3)lv='轻压🟠';else lv='低压🟢';
        row.push(sa.toFixed(2), pa.toFixed(2), lv, max);
      }
      var so=oC>0?sOS/oC:0, po=oC>0?pOS/oC:0;
      var ol; if(po>=4.5)ol='极难';else if(po>=3.5)ol='困难';else if(po>=2.5)ol='中等';else if(po>=1.5)ol='简单';else ol='很简单';
      row.push(so.toFixed(2), po.toFixed(2), ol);
      // 窄路区间描述
      var narrowDesc = '';
      if (res.corridorAnalysis && res.corridorAnalysis.corridors && res.corridorAnalysis.corridors.length > 0) {
        var nzones = extractNarrowZones(r.result);
        if (nzones.length > 0) {
          var zoneDescs = [];
          for (var zi = 0; zi < nzones.length; zi++) {
            var z = nzones[zi];
            var zStartProg = totalSteps > 0 ? Math.round(z.startStep / totalSteps * (res.progress||100)) : 0;
            var zEndProg = totalSteps > 0 ? Math.round(z.endStep / totalSteps * (res.progress||100)) : 0;
            zoneDescs.push('步' + z.startStep + '-' + z.endStep + '(进度' + zStartProg + '%-' + zEndProg + '%)');
          }
          narrowDesc = zoneDescs.join('; ');
        }
      }
      row.push(narrowDesc ? '"' + narrowDesc + '"' : '无');
      rows.push(row.join(','));
    }
    return '\uFEFF' + rows.join('\n');
  }

  /**
   * 纯JS生成ZIP文件（无外部依赖）
   * 支持多个UTF-8文本文件打包，使用STORE模式（不压缩，简单可靠）
   */
  function createZipBlob(files) {
    var localHeaders = [];
    var centralHeaders = [];
    var offset = 0;
    
    for (var i = 0; i < files.length; i++) {
      var name = files[i].name;
      var content = files[i].content;
      
      // 编码文件名和内容为UTF-8
      var nameBytes = new TextEncoder().encode(name);
      var contentBytes = new TextEncoder().encode(content);
      
      var crc = crc32(contentBytes);
      var size = contentBytes.length;
      
      // Local file header (30 + nameLen + contentLen)
      var localHeader = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true);  // signature
      lv.setUint16(4, 20, true);           // version needed
      lv.setUint16(6, 0x0800, true);       // flags (UTF-8)
      lv.setUint16(8, 0, true);            // compression (STORE)
      lv.setUint16(10, 0, true);           // mod time
      lv.setUint16(12, 0, true);           // mod date
      lv.setUint32(14, crc, true);         // crc32
      lv.setUint32(18, size, true);        // compressed size
      lv.setUint32(22, size, true);        // uncompressed size
      lv.setUint16(26, nameBytes.length, true); // filename length
      lv.setUint16(28, 0, true);           // extra field length
      localHeader.set(nameBytes, 30);
      
      localHeaders.push({ header: localHeader, content: contentBytes });
      
      // Central directory header
      var centralHeader = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(centralHeader.buffer);
      cv.setUint32(0, 0x02014b50, true);   // signature
      cv.setUint16(4, 20, true);            // version made by
      cv.setUint16(6, 20, true);            // version needed
      cv.setUint16(8, 0x0800, true);        // flags (UTF-8)
      cv.setUint16(10, 0, true);            // compression
      cv.setUint16(12, 0, true);            // mod time
      cv.setUint16(14, 0, true);            // mod date
      cv.setUint32(16, crc, true);          // crc32
      cv.setUint32(20, size, true);         // compressed size
      cv.setUint32(24, size, true);         // uncompressed size
      cv.setUint16(28, nameBytes.length, true); // filename length
      cv.setUint16(30, 0, true);            // extra field length
      cv.setUint16(32, 0, true);            // comment length
      cv.setUint16(34, 0, true);            // disk number
      cv.setUint16(36, 0, true);            // internal attrs
      cv.setUint32(38, 0, true);            // external attrs
      cv.setUint32(42, offset, true);       // local header offset
      centralHeader.set(nameBytes, 46);
      
      centralHeaders.push(centralHeader);
      offset += localHeader.length + contentBytes.length;
    }
    
    // End of central directory
    var centralDirOffset = offset;
    var centralDirSize = 0;
    for (var i = 0; i < centralHeaders.length; i++) centralDirSize += centralHeaders[i].length;
    
    var endRecord = new Uint8Array(22);
    var ev = new DataView(endRecord.buffer);
    ev.setUint32(0, 0x06054b50, true);      // signature
    ev.setUint16(4, 0, true);               // disk number
    ev.setUint16(6, 0, true);               // central dir disk
    ev.setUint16(8, files.length, true);    // entries on disk
    ev.setUint16(10, files.length, true);   // total entries
    ev.setUint32(12, centralDirSize, true); // central dir size
    ev.setUint32(16, centralDirOffset, true); // central dir offset
    ev.setUint16(20, 0, true);              // comment length
    
    // 组合所有部分
    var parts = [];
    for (var i = 0; i < localHeaders.length; i++) {
      parts.push(localHeaders[i].header);
      parts.push(localHeaders[i].content);
    }
    for (var i = 0; i < centralHeaders.length; i++) {
      parts.push(centralHeaders[i]);
    }
    parts.push(endRecord);
    
    return new Blob(parts, { type: 'application/zip' });
  }

  /**
   * CRC32计算（ZIP文件校验用）
   */
  function crc32(bytes) {
    var table = crc32.table;
    if (!table) {
      table = crc32.table = new Uint32Array(256);
      for (var i = 0; i < 256; i++) {
        var c = i;
        for (var j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ==================== 模拟模式 ====================
  function enterSimMode() {
    var spools = YarnLevel.BoardEditor.getSpools();
    var size = YarnLevel.BoardEditor.getSize();
    var blocks = (levelData && levelData.blocks) ? levelData.blocks : [];

    // 模拟游玩默认只跑高手档；菜鸟/中级/综合/全知点击档位按钮时再懒加载。
    var result = null;
    try {
      var playerRes = YarnLevel.Validator.analyzePlayerSolution(spools, size.maprow, size.mapcol, blocks);
      YarnLevel.Simulator._omniResult = null;
      YarnLevel.Simulator._playerTiers = playerRes;
      YarnLevel.Simulator._levelSpools = spools;
      YarnLevel.Simulator._levelMaprow = size.maprow;
      YarnLevel.Simulator._levelMapcol = size.mapcol;
      YarnLevel.Simulator._levelBlocks = blocks;
      YarnLevel._lastPlayerResult = playerRes;

      result = (playerRes && playerRes.tiers && playerRes.tiers.strong) ? playerRes.tiers.strong : playerRes;
      YarnLevel.Simulator._routeTier = 'strong';
      if (result && result.pickOrder) {
        YarnLevel.Simulator._optimalResult = result;
      }
    } catch (e) {
      console.error('求解失败:', e);
      YarnLevel.Simulator._optimalResult = null;
    }

    // 进入模拟（会切换到模拟UI）
    YarnLevel.Simulator.enter(spools, size.maprow, size.mapcol, blocks);

    // 工具栏按钮样式
    document.getElementById('btn-sim-mode').textContent = '✕ 退出模拟';
    document.getElementById('btn-sim-mode').style.background = '#d9534f';
    document.getElementById('btn-sim-mode').style.color = '#fff';
    document.getElementById('btn-sim-mode').style.borderColor = '#d9534f';

    // 显示暂存区图表
    if (result && result.stepBufferHistory && result.stepBufferHistory.length > 0) {
      showBufferChart(result.stepBufferHistory, result.bufferLimit, 0, {
        totalSteps: result.totalSteps,
        progress: result.progress
      });
    }
  }

  function exitSimMode() {
    YarnLevel.Simulator.exit(); // 会恢复编辑UI
    YarnLevel.Simulator._optimalResult = null;
    YarnLevel.Simulator._playerTiers = null;
    YarnLevel.Simulator._omniResult = null;
    YarnLevel.Simulator._routeTier = null;
    YarnLevel.Simulator._levelSpools = null;
    YarnLevel.Simulator._levelMaprow = null;
    YarnLevel.Simulator._levelMapcol = null;
    YarnLevel.Simulator._levelBlocks = null;
    YarnLevel._pendingRouteResult = null;
    var _fb = document.getElementById('fused-chart-block');
    if (_fb) _fb.style.display = 'none';
    chartState._initialized = false;

    // 恢复工具栏按钮
    document.getElementById('btn-sim-mode').textContent = '🎮 模拟游玩';
    document.getElementById('btn-sim-mode').style.background = '';
    document.getElementById('btn-sim-mode').style.color = '';
    document.getElementById('btn-sim-mode').style.borderColor = '';

    // 重新渲染编辑器
    YarnLevel.BoardEditor.render();
    if (levelData && levelData.blocks) {
      YarnLevel.TargetViewer.render(levelData.blocks);
    }
    document.getElementById('property-panel').innerHTML = '<div class="no-selection">点击格子查看属性</div>';
    // 隐藏暂存图表
    var chartContainer = document.getElementById('buffer-chart-container');
    if (chartContainer) chartContainer.style.display = 'none';
  }

  // ==================== 拖拽导入支持 ====================
  function initDragDrop() {
    document.body.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.stopPropagation();
    });

    document.body.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var files = e.dataTransfer.files;
      if (files.length > 0 && files[0].name.endsWith('.json')) {
        importFile(files[0]);
        document.getElementById('file-name').value = files[0].name;
      }
    });
  }

  // 初始化
  document.addEventListener('DOMContentLoaded', function() {
    init();
    initDragDrop();
  });

  return {
    init: init,
    loadLevel: loadLevel,
    exportJSON: exportJSON,
    exitSimMode: exitSimMode,
    showBufferChart: showBufferChart,
    drawFusedChart: drawFusedChart,
    exportBufferChartCSV: exportBufferChartCSV,
    batchAnalyze: batchAnalyze,
    getLevelData: function() { return levelData; }
  };
})();
