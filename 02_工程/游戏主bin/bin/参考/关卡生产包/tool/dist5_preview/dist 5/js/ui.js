/**
 * 毛线关卡生成工具 - UI组件
 */

var YarnLevel = YarnLevel || {};

// ==================== TargetZoneUI 类 ====================
YarnLevel.TargetZoneUI = function(options) {
  options = options || {};
  this.manager = options.manager || null;
  this.onError = options.onError || function(msg) { console.error(msg); };
  this.onSuccess = options.onSuccess || function(msg) { console.log(msg); };
  this.selectedColorId = 0;
  this.selectedSpecialType = null;  // null表示修改颜色，0或1表示修改特殊功能
  this.cellSize = 40;
  this.gridContainer = null;
  this.baseRowCountInput = null;
  this.extraColorTypesInput = null;
  this.extraColorGroupsInput = null;
  this.colorSequenceInput = null;
  this.questionCountInput = null;
  this.defaultColorIdInput = null;
  this.tiledFileInput = null;
  this.txtFileInput = null;
  this.colorPalette = null;
  this.zoomSlider = null;
  this.specialPanel = null;
};

YarnLevel.TargetZoneUI.prototype.init = function() {
  this.gridContainer = document.getElementById('targetGrid');
  this.baseRowCountInput = document.getElementById('baseRowCount');
  this.extraColorTypesInput = document.getElementById('extraColorTypes');
  this.extraColorGroupsInput = document.getElementById('extraColorGroups');
  this.colorSequenceInput = document.getElementById('colorSequence');
  this.questionCountInput = document.getElementById('targetQuestionCount');
  this.defaultColorIdInput = document.getElementById('defaultColorId');
  this.tiledFileInput = document.getElementById('tiledFileInput');
  this.txtFileInput = document.getElementById('txtFileInput');
  this.colorPalette = document.getElementById('targetColorPalette');
  this.zoomSlider = document.getElementById('targetZoom');
  this.colorCountSpan = document.getElementById('targetColorCount');
  this.groupCountSpan = document.getElementById('targetGroupCount');
  this.specialPanel = document.getElementById('targetSpecialPanel');
  this._initColorPalette();
  this._initSpecialPanel();
  this._bindEvents();
};

YarnLevel.TargetZoneUI.prototype._initColorPalette = function() {
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

YarnLevel.TargetZoneUI.prototype._selectColor = function(colorId) {
  this.selectedColorId = colorId;
  this.selectedSpecialType = null;  // 选择颜色时取消特殊功能选择
  var swatches = this.colorPalette.querySelectorAll('.color-swatch');
  for (var i = 0; i < swatches.length; i++) {
    swatches[i].classList.remove('selected');
    if (parseInt(swatches[i].textContent, 10) === colorId) swatches[i].classList.add('selected');
  }
  // 取消特殊功能按钮选中
  if (this.specialPanel) {
    var specialBtns = this.specialPanel.querySelectorAll('.target-special-btn');
    for (var i = 0; i < specialBtns.length; i++) specialBtns[i].classList.remove('selected');
  }
};

YarnLevel.TargetZoneUI.prototype._initSpecialPanel = function() {
  if (!this.specialPanel) return;
  var self = this;
  var specialBtns = this.specialPanel.querySelectorAll('.target-special-btn');
  for (var i = 0; i < specialBtns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        self._selectSpecialType(btn);
      });
    })(specialBtns[i]);
  }
};

YarnLevel.TargetZoneUI.prototype._selectSpecialType = function(btn) {
  var type = parseInt(btn.dataset.type, 10);
  this.selectedSpecialType = type;
  // 取消颜色选择高亮
  var swatches = this.colorPalette.querySelectorAll('.color-swatch');
  for (var i = 0; i < swatches.length; i++) swatches[i].classList.remove('selected');
  // 更新特殊功能按钮选中状态
  var specialBtns = this.specialPanel.querySelectorAll('.target-special-btn');
  for (var i = 0; i < specialBtns.length; i++) {
    specialBtns[i].classList.remove('selected');
    if (parseInt(specialBtns[i].dataset.type, 10) === type) specialBtns[i].classList.add('selected');
  }
};

YarnLevel.TargetZoneUI.prototype._bindEvents = function() {
  var self = this;
  var importTiledBtn = document.getElementById('importTiledBtn');
  if (importTiledBtn && this.tiledFileInput) {
    importTiledBtn.addEventListener('click', function() { self.tiledFileInput.click(); });
    this.tiledFileInput.addEventListener('change', function(e) { self._handleTiledFileSelect(e); });
  }
  var importTxtBtn = document.getElementById('importTxtBtn');
  if (importTxtBtn && this.txtFileInput) {
    importTxtBtn.addEventListener('click', function() { self.txtFileInput.click(); });
    this.txtFileInput.addEventListener('change', function(e) { self._handleTxtFileSelect(e); });
  }
  if (this.baseRowCountInput) {
    this.baseRowCountInput.addEventListener('change', function(e) { self._handleBaseRowCountChange(e); });
  }
  var generateSupplementBtn = document.getElementById('generateSupplementBtn');
  if (generateSupplementBtn) {
    generateSupplementBtn.addEventListener('click', function() { self._handleGenerateSupplement(); });
  }
  if (this.zoomSlider) {
    var zoomValueSpan = document.getElementById('targetZoomValue');
    this.zoomSlider.addEventListener('input', function(e) {
      var value = parseInt(e.target.value, 10);
      self.cellSize = value;
      if (zoomValueSpan) zoomValueSpan.textContent = value + 'px';
      self.render();
    });
  }
};

YarnLevel.TargetZoneUI.prototype._handleTiledFileSelect = function(event) {
  var self = this;
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var content = e.target.result;
    var result = YarnLevel.parseTiledJSON(content);
    if (YarnLevel.isParseError(result)) {
      self.onError(result.message || '导入Tiled文件失败');
      return;
    }
    if (self.manager) {
      try {
        // 删除全空的行和列
        var grid = self._removeEmptyRowsAndCols(result.grid);
        // 获取默认颜色ID
        var defaultColorId = parseInt(self.defaultColorIdInput ? self.defaultColorIdInput.value : '0', 10);
        self.manager.loadRawData(grid, defaultColorId);
        if (self.baseRowCountInput) self.baseRowCountInput.value = self.manager.getBaseRowCount();
        self.render();
        self.onSuccess('Tiled文件导入成功');
      } catch (err) { self.onError(err.message || '加载数据失败'); }
    }
  };
  reader.onerror = function() { self.onError('读取文件失败'); };
  reader.readAsText(file);
  event.target.value = '';
};

/**
 * 删除二维数组中全空的行和列（值为0或非正数视为空）
 */
YarnLevel.TargetZoneUI.prototype._removeEmptyRowsAndCols = function(grid) {
  if (!Array.isArray(grid) || grid.length === 0) return grid;

  // 删除全空行
  var filtered = [];
  for (var r = 0; r < grid.length; r++) {
    var row = grid[r];
    var allEmpty = true;
    for (var c = 0; c < row.length; c++) {
      if (row[c] > 0) { allEmpty = false; break; }
    }
    if (!allEmpty) filtered.push(row);
  }

  if (filtered.length === 0) return [];

  // 找出全空列的索引
  var colCount = filtered[0].length;
  var emptyCols = {};
  for (var c = 0; c < colCount; c++) {
    var allEmpty = true;
    for (var r = 0; r < filtered.length; r++) {
      if (filtered[r][c] > 0) { allEmpty = false; break; }
    }
    if (allEmpty) emptyCols[c] = true;
  }

  // 删除全空列
  var result = [];
  for (var r = 0; r < filtered.length; r++) {
    var newRow = [];
    for (var c = 0; c < filtered[r].length; c++) {
      if (!emptyCols[c]) newRow.push(filtered[r][c]);
    }
    result.push(newRow);
  }

  return result;
};

YarnLevel.TargetZoneUI.prototype._handleTxtFileSelect = function(event) {
  var self = this;
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var content = e.target.result;
    var result = YarnLevel.parseTXT(content);
    if (result instanceof YarnLevel.ParseError) {
      self.onError(result.message || '导入TXT文件失败');
      return;
    }
    if (self.manager) {
      try {
        // 获取默认颜色ID
        var defaultColorId = parseInt(self.defaultColorIdInput ? self.defaultColorIdInput.value : '0', 10);
        self.manager.loadRawData(result, defaultColorId);
        if (self.baseRowCountInput) self.baseRowCountInput.value = self.manager.getBaseRowCount();
        self.render();
        self.onSuccess('TXT文件导入成功');
      } catch (err) { self.onError(err.message || '加载数据失败'); }
    }
  };
  reader.onerror = function() { self.onError('读取文件失败'); };
  reader.readAsText(file);
  event.target.value = '';
};

YarnLevel.TargetZoneUI.prototype._handleBaseRowCountChange = function(event) {
  var value = parseInt(event.target.value, 10);
  if (isNaN(value) || value < 0) { this.onError('基础行数必须是非负整数'); return; }
  if (this.manager) {
    try { this.manager.setBaseRowCount(value); } catch (err) { this.onError(err.message); }
  }
};

YarnLevel.TargetZoneUI.prototype._parseColorSequence = function(str) {
  if (!str || str.trim() === '') {
    // 默认使用映射表中全部颜色
    return YarnLevel.getAllColorIds();
  }
  return str.split(/[,\s]+/).map(function(s) { return parseInt(s.trim(), 10); }).filter(function(n) { return !isNaN(n); });
};

YarnLevel.TargetZoneUI.prototype._handleGenerateSupplement = function() {
  if (!this.manager) { this.onError('目标区管理器未初始化'); return; }
  var extraColorTypes = parseInt(this.extraColorTypesInput ? this.extraColorTypesInput.value : '0', 10);
  var extraColorGroups = parseInt(this.extraColorGroupsInput ? this.extraColorGroupsInput.value : '0', 10);
  var questionCount = parseInt(this.questionCountInput ? this.questionCountInput.value : '0', 10);
  var colorSequenceStr = this.colorSequenceInput ? this.colorSequenceInput.value : '';
  var colorSequence = this._parseColorSequence(colorSequenceStr);
  if (isNaN(extraColorTypes) || extraColorTypes < 0) { this.onError('额外颜色种类数必须是非负整数'); return; }
  if (isNaN(extraColorGroups) || extraColorGroups < 0) { this.onError('额外颜色组数必须是非负整数'); return; }
  if (isNaN(questionCount) || questionCount < 0) { this.onError('问号颜色个数必须是非负整数'); return; }
  try {
    this.manager.generateSupplementColors({ extraColorTypes: extraColorTypes, extraColorGroups: extraColorGroups, colorSequence: colorSequence, questionCount: questionCount });
    this.render();
    this.onSuccess('补充颜色生成成功');
  } catch (err) { this.onError(err.message || '补充生成失败'); }
};

YarnLevel.TargetZoneUI.prototype.render = function() {
  if (!this.gridContainer) { console.error('目标区网格容器未找到'); return; }
  this.gridContainer.innerHTML = '';
  this._updateStats();
  if (!this.manager || this.manager.isEmpty()) {
    this.gridContainer.innerHTML = '<div class="empty-state">请导入数据或加载关卡文件</div>';
    return;
  }
  var data = this.manager.getData();
  var rowCount = data.length;
  var colCount = data[0] ? data[0].length : 0;
  if (rowCount === 0 || colCount === 0) return;
  var cellSizePx = this.cellSize + 'px';
  this.gridContainer.style.gridTemplateColumns = 'repeat(' + colCount + ', ' + cellSizePx + ')';
  this.gridContainer.style.gridTemplateRows = 'repeat(' + rowCount + ', ' + cellSizePx + ')';
  var baseRowCount = this.manager.getBaseRowCount();
  var supplementRowCount = rowCount - baseRowCount;
  for (var row = 0; row < rowCount; row++) {
    for (var col = 0; col < colCount; col++) {
      var block = data[row][col];
      var cell = this._createCell(row, col, block, row < supplementRowCount);
      cell.style.width = cellSizePx;
      cell.style.height = cellSizePx;
      this.gridContainer.appendChild(cell);
    }
  }
};

YarnLevel.TargetZoneUI.prototype._updateStats = function() {
  if (!this.manager || this.manager.isEmpty()) {
    if (this.colorCountSpan) this.colorCountSpan.textContent = '0';
    if (this.groupCountSpan) this.groupCountSpan.textContent = '0';
    return;
  }
  var data = this.manager.getData();
  var colorSet = {};
  var totalCount = 0;
  for (var row = 0; row < data.length; row++) {
    for (var col = 0; col < data[row].length; col++) {
      var colorId = data[row][col].id;
      if (colorId > 0) {
        colorSet[colorId] = true;
        totalCount++;
      }
    }
  }
  var colorCount = Object.keys(colorSet).length;
  var groupCount = Math.floor(totalCount / 3);
  if (this.colorCountSpan) this.colorCountSpan.textContent = colorCount;
  if (this.groupCountSpan) this.groupCountSpan.textContent = groupCount;
};

YarnLevel.TargetZoneUI.prototype._createCell = function(row, col, block, isSupplementRow) {
  var self = this;
  var cell = document.createElement('div');
  cell.className = 'grid-cell';
  cell.dataset.row = row;
  cell.dataset.col = col;
  var colorId = block.id;
  var type = block.type;
  if (colorId === 0) {
    cell.classList.add('empty-cell');
  } else if (YarnLevel.isValidColorId(colorId)) {
    cell.classList.add('color-' + colorId);
    var imagePath = YarnLevel.getTargetImage(colorId);
    if (imagePath) {
      var img = document.createElement('img');
      img.src = imagePath;
      img.alt = '颜色' + colorId;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'contain';
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
  } else {
    var idSpan = document.createElement('span');
    idSpan.className = 'color-id';
    idSpan.textContent = colorId;
    cell.appendChild(idSpan);
  }
  if (type === 1) {
    var iconContainer = document.createElement('div');
    iconContainer.className = 'special-icon-container';
    var questionIcon = document.createElement('span');
    questionIcon.className = 'special-icon-text';
    questionIcon.textContent = '?';
    questionIcon.title = '问号元素';
    iconContainer.appendChild(questionIcon);
    cell.appendChild(iconContainer);
  }
  if (isSupplementRow) {
    cell.style.opacity = '0.9';
    cell.style.borderTop = row === 0 ? '2px solid #4a90d9' : '';
  }
  cell.addEventListener('click', function() { self._handleCellClick(row, col); });
  return cell;
};

YarnLevel.TargetZoneUI.prototype._handleCellClick = function(row, col) {
  if (!this.manager) return;
  var currentCell = this.manager.getCell(row, col);
  if (!currentCell) return;
  
  // 如果选择了特殊功能，修改type
  if (this.selectedSpecialType !== null) {
    var success = this.manager.updateCellType(row, col, this.selectedSpecialType);
    if (success) this.render();
    return;
  }
  
  // 否则修改颜色
  var success = this.manager.updateCell(row, col, this.selectedColorId);
  if (success) this.render();
};

YarnLevel.TargetZoneUI.prototype.setManager = function(manager) { this.manager = manager; };
YarnLevel.TargetZoneUI.prototype.updateBaseRowCountInput = function(value) { if (this.baseRowCountInput) this.baseRowCountInput.value = value; };
YarnLevel.TargetZoneUI.prototype.refresh = function() {
  if (this.manager) this.updateBaseRowCountInput(this.manager.getBaseRowCount());
  this.render();
};
YarnLevel.TargetZoneUI.prototype.clear = function() {
  if (this.gridContainer) this.gridContainer.innerHTML = '';
  if (this.baseRowCountInput) this.baseRowCountInput.value = '1';
  if (this.extraColorTypesInput) this.extraColorTypesInput.value = '0';
  if (this.extraColorGroupsInput) this.extraColorGroupsInput.value = '0';
  if (this.colorSequenceInput) this.colorSequenceInput.value = '';
  if (this.questionCountInput) this.questionCountInput.value = '0';
};
