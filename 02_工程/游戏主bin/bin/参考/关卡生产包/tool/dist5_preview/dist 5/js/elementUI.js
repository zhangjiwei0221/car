/**
 * 毛线关卡生成工具 - 元素区UI组件
 */

var YarnLevel = YarnLevel || {};

// ==================== ElementZoneUI 类 ====================
YarnLevel.ElementZoneUI = function(options) {
  options = options || {};
  this.manager = options.manager || null;
  this.targetManager = options.targetManager || null;
  this.onError = options.onError || function(msg) { console.error(msg); };
  this.onSuccess = options.onSuccess || function(msg) { console.log(msg); };
  this.selectedColorId = 1;
  this.selectedSpecialType = null;
  this.selectedTerrainType = null;  // 'black' 或 'clear'
  this.cellSize = 40;
  this.gridContainer = null;
  this.rowsInput = null;
  this.colsInput = null;
  this.iceCountInput = null;
  this.chainCountInput = null;
  this.questionCountInput = null;
  this.terrainFileInput = null;
  this.colorPalette = null;
  this.zoomSlider = null;
};

YarnLevel.ElementZoneUI.prototype.init = function() {
  this.gridContainer = document.getElementById('elementGrid');
  this.rowsInput = document.getElementById('elementRows');
  this.colsInput = document.getElementById('elementCols');
  this.iceCountInput = document.getElementById('iceCount');
  this.chainCountInput = document.getElementById('chainCount');
  this.questionCountInput = document.getElementById('elementQuestionCount');
  this.terrainFileInput = document.getElementById('terrainFileInput');
  this.colorPalette = document.getElementById('elementColorPalette');
  this.zoomSlider = document.getElementById('elementZoom');
  this._initColorPalette();
  this._bindEvents();
};

YarnLevel.ElementZoneUI.prototype._initColorPalette = function() {
  if (!this.colorPalette) return;
  var self = this;
  this.colorPalette.innerHTML = '';
  var emptySwatch = document.createElement('div');
  emptySwatch.className = 'color-swatch empty-swatch' + (this.selectedColorId === 0 ? ' selected' : '');
  emptySwatch.textContent = '0';
  emptySwatch.title = '空位';
  emptySwatch.addEventListener('click', function() { self._selectColor(0); });
  this.colorPalette.appendChild(emptySwatch);
  for (var i = 0; i < YarnLevel.COLOR_MAP.length; i++) {
    (function(entry) {
      var swatch = document.createElement('div');
      swatch.className = 'color-swatch color-' + entry.id + (self.selectedColorId === entry.id ? ' selected' : '');
      swatch.textContent = entry.id;
      swatch.title = entry.name + ' (' + entry.id + ')';
      swatch.addEventListener('click', function() { self._selectColor(entry.id); });
      self.colorPalette.appendChild(swatch);
    })(YarnLevel.COLOR_MAP[i]);
  }
};

YarnLevel.ElementZoneUI.prototype._selectColor = function(colorId) {
  this.selectedColorId = colorId;
  this.selectedSpecialType = null;
  this.selectedTerrainType = null;
  var specialBtns = document.querySelectorAll('.special-btn');
  for (var i = 0; i < specialBtns.length; i++) specialBtns[i].classList.remove('selected');
  var terrainBtns = document.querySelectorAll('.terrain-btn');
  for (var i = 0; i < terrainBtns.length; i++) terrainBtns[i].classList.remove('selected');
  var swatches = this.colorPalette.querySelectorAll('.color-swatch');
  for (var i = 0; i < swatches.length; i++) {
    swatches[i].classList.remove('selected');
    if (parseInt(swatches[i].textContent, 10) === colorId) swatches[i].classList.add('selected');
  }
};

YarnLevel.ElementZoneUI.prototype._bindEvents = function() {
  var self = this;
  var generateBoardBtn = document.getElementById('generateBoardBtn');
  if (generateBoardBtn) {
    generateBoardBtn.addEventListener('click', function() { self._handleGenerateBoard(); });
  }
  var loadTerrainBtn = document.getElementById('loadTerrainBtn');
  if (loadTerrainBtn && this.terrainFileInput) {
    loadTerrainBtn.addEventListener('click', function() { self.terrainFileInput.click(); });
    this.terrainFileInput.addEventListener('change', function(e) { self._handleTerrainFileSelect(e); });
  }
  var specialBtns = document.querySelectorAll('.special-btn');
  for (var i = 0; i < specialBtns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() { self._handleSpecialElementSelect(btn); });
    })(specialBtns[i]);
  }
  var terrainBtns = document.querySelectorAll('.terrain-btn');
  for (var i = 0; i < terrainBtns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() { self._handleTerrainSelect(btn); });
    })(terrainBtns[i]);
  }
  var generateElementsBtn = document.getElementById('generateElementsBtn');
  if (generateElementsBtn) {
    generateElementsBtn.addEventListener('click', function() { self._handleGenerateElements(); });
  }
  if (this.zoomSlider) {
    var zoomValueSpan = document.getElementById('elementZoomValue');
    this.zoomSlider.addEventListener('input', function(e) {
      var value = parseInt(e.target.value, 10);
      self.cellSize = value;
      if (zoomValueSpan) zoomValueSpan.textContent = value + 'px';
      self.render();
    });
  }
};

YarnLevel.ElementZoneUI.prototype._handleGenerateBoard = function() {
  if (!this.manager) { this.onError('元素区管理器未初始化'); return; }
  var rows = parseInt(this.rowsInput ? this.rowsInput.value : '9', 10);
  var cols = parseInt(this.colsInput ? this.colsInput.value : '9', 10);
  if (isNaN(rows) || rows <= 0) { this.onError('行数必须为正整数'); return; }
  if (isNaN(cols) || cols <= 0) { this.onError('列数必须为正整数'); return; }
  try {
    this.manager.generateBaseBoard(rows, cols);
    this.render();
    this.onSuccess('基础棋盘生成成功');
  } catch (err) { this.onError(err.message || '生成基础棋盘失败'); }
};

YarnLevel.ElementZoneUI.prototype._handleTerrainFileSelect = function(event) {
  var self = this;
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var content = e.target.result;
    var result = YarnLevel.parseTerrainJSON(content);
    if (result instanceof YarnLevel.ParseError) {
      self.onError(result.message || '加载地形文件失败');
      return;
    }
    if (self.manager) {
      try {
        self.manager.loadTerrain(result);
        self.render();
        self.onSuccess('地形文件加载成功');
      } catch (err) { self.onError(err.message || '加载地形数据失败'); }
    }
  };
  reader.onerror = function() { self.onError('读取文件失败'); };
  reader.readAsText(file);
  event.target.value = '';
};

YarnLevel.ElementZoneUI.prototype._handleSpecialElementSelect = function(btn) {
  var type = parseInt(btn.dataset.type, 10);
  if (this.selectedSpecialType === type) {
    this.selectedSpecialType = null;
    btn.classList.remove('selected');
  } else {
    var prevSelected = document.querySelector('.special-btn.selected');
    if (prevSelected) prevSelected.classList.remove('selected');
    this.selectedSpecialType = type;
    this.selectedTerrainType = null;  // 清除地形选项
    btn.classList.add('selected');
    // 清除地形按钮选中状态
    var terrainBtns = document.querySelectorAll('.terrain-btn');
    for (var i = 0; i < terrainBtns.length; i++) terrainBtns[i].classList.remove('selected');
    if (this.colorPalette) {
      var swatches = this.colorPalette.querySelectorAll('.color-swatch');
      for (var i = 0; i < swatches.length; i++) swatches[i].classList.remove('selected');
    }
  }
};

YarnLevel.ElementZoneUI.prototype._handleTerrainSelect = function(btn) {
  var terrainType = btn.dataset.terrain;
  if (this.selectedTerrainType === terrainType) {
    this.selectedTerrainType = null;
    btn.classList.remove('selected');
  } else {
    var prevSelected = document.querySelector('.terrain-btn.selected');
    if (prevSelected) prevSelected.classList.remove('selected');
    this.selectedTerrainType = terrainType;
    this.selectedSpecialType = null;  // 清除特殊元素选项
    btn.classList.add('selected');
    // 清除特殊元素按钮选中状态
    var specialBtns = document.querySelectorAll('.special-btn');
    for (var i = 0; i < specialBtns.length; i++) specialBtns[i].classList.remove('selected');
    // 清除颜色选择
    if (this.colorPalette) {
      var swatches = this.colorPalette.querySelectorAll('.color-swatch');
      for (var i = 0; i < swatches.length; i++) swatches[i].classList.remove('selected');
    }
  }
};

YarnLevel.ElementZoneUI.prototype._handleGenerateElements = function() {
  if (!this.manager) { this.onError('元素区管理器未初始化'); return; }
  if (!this.targetManager) { this.onError('目标区管理器未初始化'); return; }
  if (this.manager.isEmpty()) { this.onError('请先生成基础棋盘'); return; }
  var iceCount = parseInt(this.iceCountInput ? this.iceCountInput.value : '0', 10);
  var chainCount = parseInt(this.chainCountInput ? this.chainCountInput.value : '0', 10);
  var questionCount = parseInt(this.questionCountInput ? this.questionCountInput.value : '0', 10);
  if (isNaN(iceCount) || iceCount < 0) { this.onError('冰块个数必须是非负整数'); return; }
  if (isNaN(chainCount) || chainCount < 0) { this.onError('链条个数必须是非负整数'); return; }
  if (isNaN(questionCount) || questionCount < 0) { this.onError('问号个数必须是非负整数'); return; }
  try {
    // 先清空所有元素和特殊功能（保留黑块）
    this.manager.resetElements();
    this.manager.generateBaseElements({ targetManager: this.targetManager });
    if (iceCount > 0) {
      var icePlaced = this.manager.autoPlaceIce(iceCount);
      if (icePlaced < iceCount) this.onSuccess('冰块放置完成，成功放置 ' + icePlaced + '/' + iceCount + ' 个');
    }
    if (chainCount > 0) {
      var chainResult = this.manager.autoPlaceChains(chainCount);
      if (chainResult.failed > 0) this.onSuccess('链条放置完成，成功放置 ' + chainResult.placed + '/' + chainCount + ' 对');
    }
    if (questionCount > 0) {
      var questionPlaced = this.manager.autoPlaceQuestionMarks(questionCount);
      if (questionPlaced < questionCount) this.onSuccess('问号放置完成，成功放置 ' + questionPlaced + '/' + questionCount + ' 个');
    }
    this.render();
    this.onSuccess('基础元素生成成功');
  } catch (err) { this.onError(err.message || '生成基础元素失败'); }
};

YarnLevel.ElementZoneUI.prototype.render = function() {
  if (!this.gridContainer) { console.error('元素区网格容器未找到'); return; }
  this.gridContainer.innerHTML = '';
  if (!this.manager || this.manager.isEmpty()) {
    this.gridContainer.innerHTML = '<div class="empty-state">请生成基础棋盘或加载关卡文件</div>';
    return;
  }
  var data = this.manager.getData();
  var rowCount = data.length;
  var colCount = data[0] ? data[0].length : 0;
  if (rowCount === 0 || colCount === 0) return;
  var cellSizePx = this.cellSize + 'px';
  this.gridContainer.style.gridTemplateColumns = 'repeat(' + colCount + ', ' + cellSizePx + ')';
  this.gridContainer.style.gridTemplateRows = 'repeat(' + rowCount + ', ' + cellSizePx + ')';
  for (var row = 0; row < rowCount; row++) {
    for (var col = 0; col < colCount; col++) {
      var element = data[row][col];
      var cell = this._createCell(row, col, element);
      cell.style.width = cellSizePx;
      cell.style.height = cellSizePx;
      this.gridContainer.appendChild(cell);
    }
  }
};

YarnLevel.ElementZoneUI.prototype._getSpecialTypeName = function(type) {
  var names = { 11: '管道-上', 12: '管道-右', 13: '管道-下', 14: '管道-左', 21: '钥匙1', 22: '钥匙2', 23: '钥匙3', 24: '钥匙4', 25: '钥匙5', 31: '锁1', 32: '锁2', 33: '锁3', 34: '锁4', 35: '锁5', 4: '冰块', 5: '链条', 6: '问号' };
  return names[type] || ('类型' + type);
};

YarnLevel.ElementZoneUI.prototype._getSpecialTypeSymbol = function(type) {
  var symbols = { 11: '↑', 12: '→', 13: '↓', 14: '←', 21: 'K1', 22: 'K2', 23: 'K3', 24: 'K4', 25: 'K5', 31: 'L1', 32: 'L2', 33: 'L3', 34: 'L4', 35: 'L5', 4: '❄', 5: '⛓', 6: '?' };
  return symbols[type] || type.toString();
};

YarnLevel.ElementZoneUI.prototype._renderSpecialIcons = function(cell, type, param) {
  if (!type || type === 0) return;
  var types = Array.isArray(type) ? type : [type];
  var self = this;
  for (var i = 0; i < types.length; i++) {
    var t = types[i];
    if (t === 0) continue;
    var iconContainer = document.createElement('div');
    iconContainer.className = 'special-icon-container';
    var imagePath = YarnLevel.getSpecialImage(t);
    if (imagePath) {
      var img = document.createElement('img');
      img.src = imagePath;
      img.alt = self._getSpecialTypeName(t);
      img.className = 'special-icon-image';
      (function(img, t, iconContainer) {
        img.onerror = function() {
          img.remove();
          var textSpan = document.createElement('span');
          textSpan.className = 'special-icon-text';
          textSpan.textContent = self._getSpecialTypeSymbol(t);
          textSpan.title = self._getSpecialTypeName(t);
          iconContainer.appendChild(textSpan);
        };
      })(img, t, iconContainer);
      iconContainer.appendChild(img);
    } else {
      var textSpan = document.createElement('span');
      textSpan.className = 'special-icon-text';
      textSpan.textContent = self._getSpecialTypeSymbol(t);
      textSpan.title = self._getSpecialTypeName(t);
      iconContainer.appendChild(textSpan);
    }
    cell.appendChild(iconContainer);
  }
};

// 渲染非管道的特殊元素图标
YarnLevel.ElementZoneUI.prototype._renderNonPipeSpecialIcons = function(cell, type, param) {
  if (!type || type === 0) return;
  var types = Array.isArray(type) ? type : [type];
  var self = this;
  for (var i = 0; i < types.length; i++) {
    var t = types[i];
    if (t === 0) continue;
    // 跳过管道类型
    if (t >= 11 && t <= 14) continue;
    var iconContainer = document.createElement('div');
    iconContainer.className = 'special-icon-container';
    var imagePath = YarnLevel.getSpecialImage(t);
    if (imagePath) {
      var img = document.createElement('img');
      img.src = imagePath;
      img.alt = self._getSpecialTypeName(t);
      img.className = 'special-icon-image';
      (function(img, t, iconContainer) {
        img.onerror = function() {
          img.remove();
          var textSpan = document.createElement('span');
          textSpan.className = 'special-icon-text';
          textSpan.textContent = self._getSpecialTypeSymbol(t);
          textSpan.title = self._getSpecialTypeName(t);
          iconContainer.appendChild(textSpan);
        };
      })(img, t, iconContainer);
      iconContainer.appendChild(img);
    } else {
      var textSpan = document.createElement('span');
      textSpan.className = 'special-icon-text';
      textSpan.textContent = self._getSpecialTypeSymbol(t);
      textSpan.title = self._getSpecialTypeName(t);
      iconContainer.appendChild(textSpan);
    }
    cell.appendChild(iconContainer);
  }
};

YarnLevel.ElementZoneUI.prototype._createCell = function(row, col, element) {
  var self = this;
  var cell = document.createElement('div');
  cell.className = 'grid-cell';
  cell.dataset.row = row;
  cell.dataset.col = col;
  var colorId = element.id;
  var type = element.type;
  
  // 检查是否是管道元素
  var isPipe = false;
  var pipeType = null;
  if (Array.isArray(type)) {
    for (var i = 0; i < type.length; i++) {
      if (type[i] >= 11 && type[i] <= 14) {
        isPipe = true;
        pipeType = type[i];
        break;
      }
    }
  } else if (type >= 11 && type <= 14) {
    isPipe = true;
    pipeType = type;
  }
  
  if (colorId === -1) {
    cell.classList.add('black-block');
  } else if (isPipe) {
    // 管道元素：图片铺满单元格
    cell.classList.add('pipe-cell');
    var imagePath = YarnLevel.getSpecialImage(pipeType);
    if (imagePath) {
      var img = document.createElement('img');
      img.src = imagePath;
      img.alt = self._getSpecialTypeName(pipeType);
      img.className = 'pipe-image';
      img.onerror = function() {
        img.remove();
        var textSpan = document.createElement('span');
        textSpan.className = 'pipe-text';
        textSpan.textContent = self._getSpecialTypeSymbol(pipeType);
        cell.appendChild(textSpan);
      };
      cell.appendChild(img);
    } else {
      var textSpan = document.createElement('span');
      textSpan.className = 'pipe-text';
      textSpan.textContent = self._getSpecialTypeSymbol(pipeType);
      cell.appendChild(textSpan);
    }
    // 管道个数标签
    if (element.param && Array.isArray(element.param) && element.param.length > 0) {
      var countLabel = document.createElement('span');
      countLabel.className = 'pipe-count-label';
      countLabel.textContent = element.param.length;
      countLabel.title = '管道内有 ' + element.param.length + ' 个元素';
      cell.appendChild(countLabel);
    }
  } else if (colorId === 0) {
    cell.classList.add('empty-cell');
    // 空单元格也可能有非管道特殊元素
    this._renderSpecialIcons(cell, type, element.param);
  } else if (YarnLevel.isValidColorId(colorId)) {
    cell.classList.add('color-' + colorId);
    var imagePath = YarnLevel.getElementImage(colorId);
    if (imagePath) {
      var img = document.createElement('img');
      img.src = imagePath;
      img.alt = '颜色' + colorId;
      img.className = 'cell-image';
      img.onerror = function() {
        img.remove();
        var idSpan = document.createElement('span');
        idSpan.className = 'color-id';
        idSpan.textContent = colorId;
        cell.appendChild(idSpan);
      };
      cell.appendChild(img);
    } else {
      var idSpan = document.createElement('span');
      idSpan.className = 'color-id';
      idSpan.textContent = colorId;
      cell.appendChild(idSpan);
    }
    // 非管道特殊元素
    this._renderNonPipeSpecialIcons(cell, type, element.param);
  } else {
    var idSpan = document.createElement('span');
    idSpan.className = 'color-id';
    idSpan.textContent = colorId;
    cell.appendChild(idSpan);
  }
  cell.addEventListener('click', function() { self._handleCellClick(row, col); });
  return cell;
};

YarnLevel.ElementZoneUI.prototype._handleCellClick = function(row, col) {
  if (!this.manager) return;
  var currentCell = this.manager.getCell(row, col);
  if (!currentCell) return;
  
  // 地形选项处理（可以修改任何单元格）
  if (this.selectedTerrainType !== null) {
    if (this.selectedTerrainType === 'black') {
      var success = this.manager.setCellAsBlackBlock(row, col);
      if (success) this.render();
      return;
    }
    if (this.selectedTerrainType === 'clear') {
      var success = this.manager.clearBlackBlock(row, col);
      if (success) this.render();
      return;
    }
  }
  
  if (currentCell.id === -1) return;  // 黑块不能修改（除了地形选项）
  
  if (this.selectedSpecialType !== null) {
    // 清空特殊功能(0)
    if (this.selectedSpecialType === 0) {
      var success = this.manager.clearSpecialElement(row, col);
      if (success) this.render();
      return;
    }
    // 管道功能(11-14)直接覆盖单元格全部数据
    if (this.selectedSpecialType >= 11 && this.selectedSpecialType <= 14) {
      var success = this.manager.setCellAsPipe(row, col, this.selectedSpecialType);
      if (success) this.render();
      else this.onError('无法放置管道');
      return;
    }
    // 其他特殊功能叠加放置
    var success = this.manager.placeSpecialElement(row, col, this.selectedSpecialType);
    if (success) this.render();
    else this.onError('无法放置特殊元素（可能已达到叠加上限）');
    return;
  }
  var success = this.manager.updateCell(row, col, this.selectedColorId);
  if (success) this.render();
};

YarnLevel.ElementZoneUI.prototype.setManager = function(manager) { this.manager = manager; };
YarnLevel.ElementZoneUI.prototype.setTargetManager = function(targetManager) { this.targetManager = targetManager; };
YarnLevel.ElementZoneUI.prototype.updateRowColInputs = function(rows, cols) {
  if (this.rowsInput) this.rowsInput.value = rows;
  if (this.colsInput) this.colsInput.value = cols;
};
YarnLevel.ElementZoneUI.prototype.refresh = function() {
  if (this.manager) this.updateRowColInputs(this.manager.getRowCount(), this.manager.getColCount());
  this.render();
};
YarnLevel.ElementZoneUI.prototype.clear = function() {
  if (this.gridContainer) this.gridContainer.innerHTML = '';
  if (this.rowsInput) this.rowsInput.value = '9';
  if (this.colsInput) this.colsInput.value = '9';
  if (this.iceCountInput) this.iceCountInput.value = '0';
  if (this.chainCountInput) this.chainCountInput.value = '0';
  if (this.questionCountInput) this.questionCountInput.value = '0';
  this.selectedSpecialType = null;
  var specialBtns = document.querySelectorAll('.special-btn');
  for (var i = 0; i < specialBtns.length; i++) specialBtns[i].classList.remove('selected');
};
