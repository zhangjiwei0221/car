/**
 * 毛线JSON关卡编辑器 - 棋盘编辑器核心逻辑
 */

var YarnLevel = YarnLevel || {};

YarnLevel.BoardEditor = (function() {
  // 状态
  var spools = [];       // 2D数组
  var maprow = 9;
  var mapcol = 10;
  var selectedCell = null; // {row, col}
  var undoStack = [];
  var maxUndo = 50;

  // DOM引用
  var boardContainer = null;
  var propertyPanel = null;

  function init() {
    boardContainer = document.getElementById('board-container');
    propertyPanel = document.getElementById('property-panel');
    initKeyboardShortcuts();
  }

  // ==================== 撤回系统 ====================
  function pushUndo() {
    undoStack.push(YarnLevel.deepClone(spools));
    if (undoStack.length > maxUndo) {
      undoStack.shift();
    }
    updateUndoCount();
  }

  function undo() {
    if (undoStack.length === 0) return;
    spools = undoStack.pop();
    updateUndoCount();
    render();
    if (selectedCell) {
      showPropertyPanel(selectedCell.row, selectedCell.col);
    }
  }

  function updateUndoCount() {
    var el = document.getElementById('undo-count');
    if (el) {
      el.textContent = undoStack.length > 0 ? '(' + undoStack.length + ')' : '';
    }
  }

  // ==================== 键盘快捷键 ====================
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    });
  }

  // ==================== 加载数据 ====================
  function loadSpools(data, row, col) {
    maprow = row;
    mapcol = col;
    spools = YarnLevel.deepClone(data);
    selectedCell = null;
    undoStack = [];
    updateUndoCount();
    render();
  }

  function getSpools() {
    return YarnLevel.deepClone(spools);
  }

  function getSize() {
    return { maprow: maprow, mapcol: mapcol };
  }

  // ==================== 调整尺寸 ====================
  function resize(newRow, newCol) {
    pushUndo();
    var newSpools = [];
    for (var r = 0; r < newRow; r++) {
      newSpools[r] = [];
      for (var c = 0; c < newCol; c++) {
        if (r < spools.length && c < (spools[r] ? spools[r].length : 0)) {
          newSpools[r][c] = YarnLevel.deepClone(spools[r][c]);
        } else {
          newSpools[r][c] = YarnLevel.createEmptySpool();
        }
      }
    }
    maprow = newRow;
    mapcol = newCol;
    spools = newSpools;
    selectedCell = null;
    render();
    showPropertyPanel(-1, -1);
  }

  // ==================== 渲染棋盘 ====================
  function render() {
    if (!boardContainer) return;

    var grid = document.createElement('div');
    grid.className = 'board-grid';
    grid.style.gridTemplateColumns = 'repeat(' + mapcol + ', 40px)';

    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var cell = renderCell(r, c);
        grid.appendChild(cell);
      }
    }

    boardContainer.innerHTML = '';
    boardContainer.appendChild(grid);

    // 渲染管道面板
    renderPipePanel();
  }

  // ==================== 管道面板 ====================
  function renderPipePanel() {
    var panel = document.getElementById('pipe-panel');
    if (!panel) return;

    // 收集所有管道，按从上到下排序
    var pipes = [];
    for (var r = 0; r < maprow; r++) {
      for (var c = 0; c < mapcol; c++) {
        var spool = spools[r] && spools[r][c];
        if (spool && YarnLevel.isPipeType(spool.type) && Array.isArray(spool.param) && spool.param.length > 0) {
          var dir = YarnLevel.getPipeDirection(spool.type);
          var dirIcon = YarnLevel.TYPE_MAP[dir] ? YarnLevel.TYPE_MAP[dir].icon : '?';
          pipes.push({ row: r, col: c, dir: dirIcon, param: spool.param });
        }
      }
    }

    if (pipes.length === 0) {
      panel.innerHTML = '';
      return;
    }

    var html = '';
    for (var i = 0; i < pipes.length; i++) {
      var p = pipes[i];
      html += '<div class="pipe-panel-item" data-pipe-row="' + p.row + '" data-pipe-col="' + p.col + '">';
      html += '<span class="pipe-label">' + p.row + ',' + p.col + '</span>';
      html += '<span class="pipe-arrow-icon">' + p.dir + '</span>';
      html += '<span class="pipe-balls">';
      for (var j = 0; j < p.param.length; j++) {
        var _pid = YarnLevel.getPipeItemId(p.param[j]);
        var color = YarnLevel.getColorCSS(_pid);
        html += '<span class="pipe-ball" data-pipe-row="' + p.row + '" data-pipe-col="' + p.col + '" data-ball-idx="' + j + '" draggable="true" style="background:' + (color || '#eee') + ';" title="' + YarnLevel.getColorName(_pid) + '"></span>';
      }
      html += '</span>';
      html += '</div>';
    }

    panel.innerHTML = html;

    // 绑定管道球拖拽排序
    initPipePanelDrag(panel);
  }

  function initPipePanelDrag(panel) {
    var balls = panel.querySelectorAll('.pipe-ball');
    var dragBall = null;
    var dragPipeRow = null;
    var dragPipeCol = null;
    var dragIdx = null;

    balls.forEach(function(ball) {
      ball.addEventListener('dragstart', function(e) {
        dragBall = this;
        dragPipeRow = parseInt(this.dataset.pipeRow);
        dragPipeCol = parseInt(this.dataset.pipeCol);
        dragIdx = parseInt(this.dataset.ballIdx);
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragIdx + '');
      });

      ball.addEventListener('dragend', function() {
        this.classList.remove('dragging');
        dragBall = null;
      });

      ball.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.style.outline = '2px solid #4a90d9';
      });

      ball.addEventListener('dragleave', function() {
        this.style.outline = '';
      });

      ball.addEventListener('drop', function(e) {
        e.preventDefault();
        this.style.outline = '';
        if (!dragBall || dragBall === this) return;

        var targetRow = parseInt(this.dataset.pipeRow);
        var targetCol = parseInt(this.dataset.pipeCol);
        var targetIdx = parseInt(this.dataset.ballIdx);

        // 只允许同一管道内排序
        if (targetRow !== dragPipeRow || targetCol !== dragPipeCol) return;

        pushUndo();
        var param = spools[targetRow][targetCol].param;
        var moved = param.splice(dragIdx, 1)[0];
        var newIdx = targetIdx > dragIdx ? targetIdx - 1 : targetIdx;
        param.splice(newIdx, 0, moved);

        render();
        if (selectedCell) showPropertyPanel(selectedCell.row, selectedCell.col);
      });
    });
  }

  function renderCell(row, col) {
    var spool = spools[row] && spools[row][col] ? spools[row][col] : { id: 0, type: 0, param: 0 };
    var cell = document.createElement('div');
    cell.className = 'board-cell';
    cell.dataset.row = row;
    cell.dataset.col = col;

    // 选中状态
    if (selectedCell && selectedCell.row === row && selectedCell.col === col) {
      cell.classList.add('selected');
    }

    // 坐标
    var coord = document.createElement('span');
    coord.className = 'cell-coord';
    coord.textContent = row + ',' + col;
    cell.appendChild(coord);

    // 黑块
    if (spool.id === -1) {
      cell.classList.add('black-cell');
      cell.addEventListener('click', function() { onCellClick(row, col); });
      return cell;
    }

    // 管道
    var isPipe = YarnLevel.isPipeType(spool.type);
    if (isPipe) {
      cell.classList.add('cell-pipe-bg');
      var pipeDir = YarnLevel.getPipeDirection(spool.type);
      var arrow = document.createElement('span');
      arrow.className = 'cell-pipe-arrow';
      arrow.textContent = YarnLevel.TYPE_MAP[pipeDir] ? YarnLevel.TYPE_MAP[pipeDir].icon : '?';
      cell.appendChild(arrow);

      // 管道内颜色点
      if (Array.isArray(spool.param) && spool.param.length > 0) {
        var dots = document.createElement('div');
        dots.className = 'cell-pipe-dots';
        var showCount = Math.min(spool.param.length, 5);
        for (var i = 0; i < showCount; i++) {
          var dot = document.createElement('div');
          dot.className = 'pipe-dot';
          var dotColor = YarnLevel.getColorCSS(spool.param[i]);
          if (dotColor) dot.style.backgroundColor = dotColor;
          dots.appendChild(dot);
        }
        if (spool.param.length > 5) {
          var more = document.createElement('span');
          more.style.fontSize = '8px';
          more.style.color = '#aaa';
          more.textContent = '+' + (spool.param.length - 5);
          dots.appendChild(more);
        }
        cell.appendChild(dots);
      }
    } else {
      // 普通颜色格
      if (spool.id > 0) {
        var circle = document.createElement('div');
        circle.className = 'cell-color-circle';
        var bgColor = YarnLevel.getColorCSS(spool.id);
        if (bgColor) circle.style.backgroundColor = bgColor;
        cell.appendChild(circle);
      } else {
        cell.classList.add('empty-cell');
      }

      // 特殊元素覆盖
      var icons = YarnLevel.getTypeIcons(spool.type);
      if (icons.length > 0) {
        var overlay = document.createElement('div');
        overlay.className = 'cell-overlay';
        overlay.textContent = icons.join('');
        cell.appendChild(overlay);
      }
    }

    cell.addEventListener('click', function() { onCellClick(row, col); });
    // 拖拽交换功能
    cell.draggable = true;
    cell.addEventListener('dragstart', function(e) {
      e.dataTransfer.setData('text/plain', row + ',' + col);
      e.dataTransfer.effectAllowed = 'move';
      cell.classList.add('dragging');
    });
    cell.addEventListener('dragend', function() { cell.classList.remove('dragging'); });
    cell.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cell.style.outline = '2px solid #4a90d9'; });
    cell.addEventListener('dragleave', function() { cell.style.outline = ''; });
    cell.addEventListener('drop', function(e) {
      e.preventDefault();
      cell.style.outline = '';
      var fromData = e.dataTransfer.getData('text/plain').split(',');
      var fromRow = parseInt(fromData[0]);
      var fromCol = parseInt(fromData[1]);
      if (fromRow === row && fromCol === col) return;
      swapCells(fromRow, fromCol, row, col);
    });
    return cell;
  }

  // ==================== 点击处理 ====================
  function onCellClick(row, col) {
    // 再次点击同一格子 = 取消选中
    if (selectedCell && selectedCell.row === row && selectedCell.col === col) {
      selectedCell = null;
      render();
      propertyPanel.innerHTML = '<div class="no-selection">点击格子查看属性</div>';
      return;
    }
    selectedCell = { row: row, col: col };
    render();
    showPropertyPanel(row, col);
    showPathToCell(row, col);
  }

  // ==================== 属性面板 ====================
  function showPropertyPanel(row, col) {
    if (!propertyPanel) return;
    if (row < 0 || col < 0 || !spools[row] || !spools[row][col]) {
      propertyPanel.innerHTML = '<div class="no-selection">点击格子查看属性</div>';
      return;
    }

    var spool = spools[row][col];
    var html = '';

    // 坐标
    html += '<div class="prop-section">';
    html += '<div class="prop-label">坐标</div>';
    html += '<div class="prop-value">行 ' + row + ', 列 ' + col + '</div>';
    html += '</div>';

    // ID / 颜色
    html += '<div class="prop-section">';
    html += '<div class="prop-label">颜色</div>';
    if (spool.id === -1) {
      html += '<div class="prop-value">黑块</div>';
    } else if (spool.id === 0 && YarnLevel.isPipeType(spool.type)) {
      html += '<div class="prop-value">管道（无颜色）</div>';
    } else if (spool.id === 0) {
      html += '<div class="prop-value">空</div>';
    } else {
      var colorCSS = YarnLevel.getColorCSS(spool.id);
      html += '<div class="prop-value">';
      if (colorCSS) html += '<span class="prop-color-preview" style="background-color:' + colorCSS + '"></span>';
      html += YarnLevel.getColorName(spool.id);
      html += '</div>';
    }
    // 颜色快速选择网格
    if (spool.id !== -1 && !YarnLevel.isPipeType(spool.type)) {
      html += '<div class="prop-color-grid" style="display:grid;grid-template-columns:repeat(7,22px);gap:3px;margin-top:6px;">';
      html += '<div class="prop-color-pick" data-cid="0" style="width:22px;height:22px;border-radius:50%;border:1px dashed #ccc;cursor:pointer;background:#f7fafc;" title="空(0)"></div>';
      for (var ci = 0; ci < YarnLevel.COLOR_MAP.length; ci++) {
        var ce = YarnLevel.COLOR_MAP[ci];
        var isActive = ce.id === spool.id ? 'border:2px solid #333;' : 'border:1px solid #e2e8f0;';
        html += '<div class="prop-color-pick" data-cid="' + ce.id + '" style="width:22px;height:22px;border-radius:50%;cursor:pointer;background:' + ce.cssColor + ';' + isActive + '" title="' + ce.name + '(' + ce.id + ')"></div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // 障碍/特殊元素操作
    html += '<div class="prop-section">';
    html += '<div class="prop-label">元素操作</div>';
    if (spool.id === -1) {
      html += '<div class="prop-value" style="margin-bottom:6px">当前: <strong>黑块</strong></div>';
      html += '<button class="prop-btn btn-success" id="prop-remove-obstacle">✓ 移除黑块</button>';
    } else {
      // 当前特殊元素状态显示 + 移除
      var currentTypes = Array.isArray(spool.type) ? spool.type : (spool.type === 0 ? [] : [spool.type]);
      var hasIce = currentTypes.indexOf(4) !== -1;
      var hasChain = currentTypes.indexOf(5) !== -1;
      var hasQuestion = currentTypes.indexOf(6) !== -1;
      if (hasIce || hasChain || hasQuestion) {
        html += '<div style="margin-bottom:6px;font-size:12px;">当前: ';
        if (hasIce) html += '<span style="margin-right:4px;">❄冰块</span>';
        if (hasChain) html += '<span style="margin-right:4px;">🔗锁链</span>';
        if (hasQuestion) html += '<span style="margin-right:4px;">❓问号</span>';
        html += '</div>';
        html += '<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap;">';
        if (hasIce) html += '<button class="prop-btn" id="prop-del-ice" style="font-size:11px;padding:3px 6px;border-color:#d9534f;color:#d9534f;">移除冰块</button>';
        if (hasChain) html += '<button class="prop-btn" id="prop-del-chain" style="font-size:11px;padding:3px 6px;border-color:#d9534f;color:#d9534f;">移除锁链</button>';
        if (hasQuestion) html += '<button class="prop-btn" id="prop-del-question" style="font-size:11px;padding:3px 6px;border-color:#d9534f;color:#d9534f;">移除问号</button>';
        html += '</div>';
      }
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
      html += '<button class="prop-btn btn-danger" id="prop-set-black">■ 设为黑块</button>';
      if (!hasIce) html += '<button class="prop-btn" id="prop-set-ice" style="border-color:#41DBEA;color:#0E9CE6;">❄ 冰块</button>';
      if (!hasQuestion) html += '<button class="prop-btn" id="prop-set-question" style="border-color:#f0ad4e;color:#d97706;">❓ 问号</button>';
      html += '</div>';
      // 锁链操作：检测相邻格子
      if (!hasChain) {
        html += '<div style="margin-top:6px;">';
        html += '<div style="font-size:11px;color:#718096;margin-bottom:3px;">锁链（向相邻线轴配对）:</div>';
        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
        var dirs = [{dr:-1,dc:0,label:'↑上'},{dr:1,dc:0,label:'↓下'},{dr:0,dc:-1,label:'←左'},{dr:0,dc:1,label:'→右'}];
        for (var di = 0; di < dirs.length; di++) {
          var nr = row + dirs[di].dr;
          var nc = col + dirs[di].dc;
          if (nr >= 0 && nr < maprow && nc >= 0 && nc < mapcol) {
            var neighbor = spools[nr][nc];
            if (neighbor && neighbor.id > 0 && !YarnLevel.isPipeType(neighbor.type)) {
              html += '<button class="prop-btn prop-chain-btn" data-tr="' + nr + '" data-tc="' + nc + '" style="font-size:11px;padding:3px 6px;">🔗' + dirs[di].label + '</button>';
            }
          }
        }
        html += '</div></div>';
      }
    }
    html += '</div>';

    // Type & 管道方向
    html += '<div class="prop-section">';
    html += '<div class="prop-label">类型</div>';
    html += '<div class="prop-value">' + YarnLevel.getTypeDisplay(spool.type) + '</div>';
    // 管道方向快速切换
    if (YarnLevel.isPipeType(spool.type)) {
      html += '<div style="margin-top:6px;font-size:11px;color:#718096;">管道方向:</div>';
      html += '<div style="display:flex;gap:4px;margin-top:3px;">';
      var pDirs = [{t:11,label:'↑上'},{t:12,label:'→右'},{t:13,label:'↓下'},{t:14,label:'←左'}];
      var currentDir = YarnLevel.getPipeDirection(spool.type);
      for (var pi = 0; pi < pDirs.length; pi++) {
        var activeStyle = pDirs[pi].t === currentDir ? 'background:#4a90d9;color:#fff;border-color:#4a90d9;' : '';
        html += '<button class="prop-btn prop-pipe-dir" data-dir="' + pDirs[pi].t + '" style="font-size:11px;padding:3px 8px;' + activeStyle + '">' + pDirs[pi].label + '</button>';
      }
      html += '</div>';
      html += '<button class="prop-btn" id="prop-remove-pipe" style="margin-top:6px;font-size:11px;padding:3px 8px;border-color:#d9534f;color:#d9534f;">✕ 移除管道</button>';
    } else if (spool.id !== -1) {
      // 非管道非黑块：提供设为管道按钮
      html += '<div style="margin-top:6px;font-size:11px;color:#718096;">设为管道:</div>';
      html += '<div style="display:flex;gap:4px;margin-top:3px;">';
      var pDirs2 = [{t:11,label:'↑上'},{t:12,label:'→右'},{t:13,label:'↓下'},{t:14,label:'←左'}];
      for (var pi2 = 0; pi2 < pDirs2.length; pi2++) {
        html += '<button class="prop-btn prop-set-pipe" data-dir="' + pDirs2[pi2].t + '" style="font-size:11px;padding:3px 8px;">' + pDirs2[pi2].label + '</button>';
      }
      html += '</div>';
    }
    html += '</div>';

    // Param
    html += '<div class="prop-section">';
    html += '<div class="prop-label">参数 (param)</div>';

    if (YarnLevel.isPipeType(spool.type) && Array.isArray(spool.param)) {
      // 管道参数编辑器
      html += '<div class="pipe-param-editor">';
      html += '<div style="font-size:11px;color:#718096;margin-bottom:4px">管道内颜色（拖拽排序）:</div>';
      html += '<ul class="pipe-param-list" id="pipe-param-list">';
      for (var i = 0; i < spool.param.length; i++) {
        var pColor = YarnLevel.getColorCSS(spool.param[i]);
        var pName = YarnLevel.getColorName(spool.param[i]);
        html += '<li class="pipe-param-item" draggable="true" data-index="' + i + '">';
        html += '<span class="drag-handle">⋮⋮</span>';
        html += '<span class="param-color-dot" style="background-color:' + (pColor || '#eee') + '"></span>';
        html += '<span class="param-color-name">' + pName + '</span>';
        html += '<button class="param-remove-btn" data-index="' + i + '">×</button>';
        html += '</li>';
      }
      html += '</ul>';
      html += '<div class="pipe-param-add">';
      html += '<select id="pipe-add-color">';
      for (var j = 0; j < YarnLevel.COLOR_MAP.length; j++) {
        var c = YarnLevel.COLOR_MAP[j];
        html += '<option value="' + c.id + '">' + c.id + ' - ' + c.name + '</option>';
      }
      html += '</select>';
      html += '<button id="pipe-add-btn">+添加</button>';
      html += '</div>';
      html += '</div>';
    } else {
      html += '<div class="prop-value">' + JSON.stringify(spool.param) + '</div>';
    }
    html += '</div>';

    // 距离信息（BFS距离）
    html += '<div class="prop-section">';
    html += '<div class="prop-label">路径信息</div>';
    if (spool.id === -1 || YarnLevel.isPipeType(spool.type)) {
      html += '<div class="prop-distance-info">此格为黑块/管道，不可通过</div>';
    } else {
      var distance = YarnLevel.Validator.getDistanceToCell(spools, maprow, mapcol, row, col);
      if (distance === -1) {
        html += '<div class="prop-distance-info" style="color:#d9534f;">⚠ 从第一行不可达此格</div>';
      } else if (distance === 0) {
        html += '<div class="prop-distance-info">此格在第一行，距离: <span class="distance-value">0步</span></div>';
      } else {
        html += '<div class="prop-distance-info">解锁此格需要: <span class="distance-value">' + distance + '步</span></div>';
      }
    }
    html += '</div>';

    propertyPanel.innerHTML = html;

    // 绑定事件
    bindPropertyEvents(row, col);
  }

  function bindPropertyEvents(row, col) {
    // 颜色快速选择
    var colorPicks = document.querySelectorAll('.prop-color-pick');
    colorPicks.forEach(function(pick) {
      pick.addEventListener('click', function() {
        var cid = parseInt(this.dataset.cid);
        pushUndo();
        spools[row][col].id = cid;
        render();
        showPropertyPanel(row, col);
      });
    });

    // 管道方向切换
    var pipeDirBtns = document.querySelectorAll('.prop-pipe-dir');
    pipeDirBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var dir = parseInt(this.dataset.dir);
        pushUndo();
        spools[row][col].type = dir;
        render();
        showPropertyPanel(row, col);
      });
    });

    // 设为管道
    var setPipeBtns = document.querySelectorAll('.prop-set-pipe');
    setPipeBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var dir = parseInt(this.dataset.dir);
        pushUndo();
        spools[row][col].id = 0;
        spools[row][col].type = dir;
        spools[row][col].param = [];
        render();
        showPropertyPanel(row, col);
      });
    });

    // 移除管道
    var removePipeBtn = document.getElementById('prop-remove-pipe');
    if (removePipeBtn) {
      removePipeBtn.addEventListener('click', function() {
        pushUndo();
        spools[row][col] = YarnLevel.createEmptySpool();
        render();
        showPropertyPanel(row, col);
      });
    }

    // 障碍物快捷按钮
    var setBlackBtn = document.getElementById('prop-set-black');
    if (setBlackBtn) {
      setBlackBtn.addEventListener('click', function() {
        pushUndo();
        spools[row][col] = { id: -1, type: 0, param: 0 };
        render();
        showPropertyPanel(row, col);
      });
    }

    var setIceBtn = document.getElementById('prop-set-ice');
    if (setIceBtn) {
      setIceBtn.addEventListener('click', function() {
        pushUndo();
        var spool = spools[row][col];
        var types = Array.isArray(spool.type) ? spool.type.slice() : (spool.type === 0 ? [] : [spool.type]);
        if (types.indexOf(4) === -1) types.push(4); else types.splice(types.indexOf(4), 1);
        spool.type = types.length === 0 ? 0 : (types.length === 1 ? types[0] : types);
        render();
        showPropertyPanel(row, col);
      });
    }

    var setQuestionBtn = document.getElementById('prop-set-question');
    if (setQuestionBtn) {
      setQuestionBtn.addEventListener('click', function() {
        pushUndo();
        var spool = spools[row][col];
        var types = Array.isArray(spool.type) ? spool.type.slice() : (spool.type === 0 ? [] : [spool.type]);
        if (types.indexOf(6) === -1) types.push(6); else types.splice(types.indexOf(6), 1);
        spool.type = types.length === 0 ? 0 : (types.length === 1 ? types[0] : types);
        render();
        showPropertyPanel(row, col);
      });
    }

    // 删除特殊元素
    var delIceBtn = document.getElementById('prop-del-ice');
    if (delIceBtn) {
      delIceBtn.addEventListener('click', function() {
        pushUndo();
        removeTypeFromCell(row, col, 4);
        render(); showPropertyPanel(row, col);
      });
    }
    var delChainBtn = document.getElementById('prop-del-chain');
    if (delChainBtn) {
      delChainBtn.addEventListener('click', function() {
        pushUndo();
        removeTypeFromCell(row, col, 5);
        // 同时移除配对邻居的链条
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var d = 0; d < dirs.length; d++) {
          var nr = row + dirs[d][0], nc = col + dirs[d][1];
          if (nr >= 0 && nr < maprow && nc >= 0 && nc < mapcol) {
            var ns = spools[nr][nc];
            var nt = Array.isArray(ns.type) ? ns.type : [ns.type];
            if (nt.indexOf(5) !== -1) removeTypeFromCell(nr, nc, 5);
          }
        }
        render(); showPropertyPanel(row, col);
      });
    }
    var delQuestionBtn = document.getElementById('prop-del-question');
    if (delQuestionBtn) {
      delQuestionBtn.addEventListener('click', function() {
        pushUndo();
        removeTypeFromCell(row, col, 6);
        render(); showPropertyPanel(row, col);
      });
    }

    var removeObstacleBtn = document.getElementById('prop-remove-obstacle');
    if (removeObstacleBtn) {
      removeObstacleBtn.addEventListener('click', function() {
        pushUndo();
        spools[row][col] = YarnLevel.createEmptySpool();
        render();
        showPropertyPanel(row, col);
      });
    }

    // 锁链配对按钮
    var chainBtns = document.querySelectorAll('.prop-chain-btn');
    chainBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tr = parseInt(this.dataset.tr);
        var tc = parseInt(this.dataset.tc);
        pushUndo();
        // 给当前格和目标格都添加链条type=5
        function addChain(r, c) {
          var s = spools[r][c];
          var types = Array.isArray(s.type) ? s.type.slice() : (s.type === 0 ? [] : [s.type]);
          if (types.indexOf(5) === -1) types.push(5);
          s.type = types.length === 1 ? types[0] : types;
        }
        addChain(row, col);
        addChain(tr, tc);
        render();
        showPropertyPanel(row, col);
      });
    });

    // 管道颜色添加
    var addBtn = document.getElementById('pipe-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        var select = document.getElementById('pipe-add-color');
        var colorId = parseInt(select.value);
        pushUndo();
        if (!Array.isArray(spools[row][col].param)) {
          spools[row][col].param = [];
        }
        spools[row][col].param.push(colorId);
        render();
        showPropertyPanel(row, col);
      });
    }

    // 管道颜色删除
    var removeBtns = document.querySelectorAll('.param-remove-btn');
    removeBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(this.dataset.index);
        pushUndo();
        spools[row][col].param.splice(idx, 1);
        render();
        showPropertyPanel(row, col);
      });
    });

    // 管道颜色拖拽排序
    initPipeParamDrag(row, col);
  }

  // 显示到指定格子的最优路线
  function showPathToCell(row, col) {
    // 清除之前的路线标记
    var marked = boardContainer.querySelectorAll('.path-to-cell');
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove('path-to-cell');

    var spool = spools[row][col];
    if (!spool || spool.id === -1 || YarnLevel.isPipeType(spool.type)) return;

    var dist = YarnLevel.Validator.bfsFromTopRow(spools, maprow, mapcol);
    if (dist[row][col] === -1) return;

    // 回溯路径
    var path = [];
    var r = row, c = col;
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    while (dist[r][c] > 0) {
      path.push({ row: r, col: c });
      var found = false;
      for (var d = 0; d < dirs.length; d++) {
        var nr = r + dirs[d][0], nc = c + dirs[d][1];
        if (nr >= 0 && nr < maprow && nc >= 0 && nc < mapcol && dist[nr][nc] === dist[r][c] - 1) {
          r = nr; c = nc; found = true; break;
        }
      }
      if (!found) break;
    }
    if (dist[r][c] === 0) path.push({ row: r, col: c });

    // 高亮路径
    for (var i = 0; i < path.length; i++) {
      var cellEl = boardContainer.querySelector('.board-cell[data-row="' + path[i].row + '"][data-col="' + path[i].col + '"]');
      if (cellEl) cellEl.classList.add('path-to-cell');
    }
  }

  // 交换两个格子
  function swapCells(r1, c1, r2, c2) {
    pushUndo();
    var temp = YarnLevel.deepClone(spools[r1][c1]);
    spools[r1][c1] = YarnLevel.deepClone(spools[r2][c2]);
    spools[r2][c2] = temp;
    render();
    if (selectedCell) showPropertyPanel(selectedCell.row, selectedCell.col);
  }

  // 辅助：从格子中移除某个type
  function removeTypeFromCell(r, c, typeToRemove) {
    var spool = spools[r][c];
    var types = Array.isArray(spool.type) ? spool.type.slice() : (spool.type === 0 ? [] : [spool.type]);
    var idx = types.indexOf(typeToRemove);
    if (idx !== -1) types.splice(idx, 1);
    spool.type = types.length === 0 ? 0 : (types.length === 1 ? types[0] : types);
  }

  // ==================== 管道参数拖拽排序 ====================
  function initPipeParamDrag(row, col) {
    var list = document.getElementById('pipe-param-list');
    if (!list) return;

    var dragItem = null;
    var items = list.querySelectorAll('.pipe-param-item');

    items.forEach(function(item) {
      item.addEventListener('dragstart', function(e) {
        dragItem = this;
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.dataset.index);
      });

      item.addEventListener('dragend', function() {
        this.classList.remove('dragging');
        dragItem = null;
        // 移除所有高亮
        items.forEach(function(i) { i.style.borderTop = ''; });
      });

      item.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.style.borderTop = '2px solid #3498db';
      });

      item.addEventListener('dragleave', function() {
        this.style.borderTop = '';
      });

      item.addEventListener('drop', function(e) {
        e.preventDefault();
        this.style.borderTop = '';
        if (!dragItem || dragItem === this) return;

        var fromIdx = parseInt(dragItem.dataset.index);
        var toIdx = parseInt(this.dataset.index);

        if (fromIdx === toIdx) return;

        pushUndo();
        var param = spools[row][col].param;
        var moved = param.splice(fromIdx, 1)[0];
        if (toIdx > fromIdx) toIdx--;
        param.splice(toIdx, 0, moved);

        render();
        showPropertyPanel(row, col);
      });
    });
  }

  // ==================== 创建空棋盘 ====================
  function createEmpty(row, col) {
    maprow = row;
    mapcol = col;
    spools = [];
    for (var r = 0; r < row; r++) {
      spools[r] = [];
      for (var c = 0; c < col; c++) {
        spools[r][c] = YarnLevel.createEmptySpool();
      }
    }
    selectedCell = null;
    undoStack = [];
    updateUndoCount();
    render();
  }

  // 公开接口
  return {
    init: init,
    loadSpools: loadSpools,
    getSpools: getSpools,
    getSize: getSize,
    resize: resize,
    render: render,
    createEmpty: createEmpty,
    undo: undo,
    clearSelection: function() { selectedCell = null; render(); },
    getSpoolsRef: function() { return spools; },
    getMapRow: function() { return maprow; },
    getMapCol: function() { return mapcol; }
  };
})();
