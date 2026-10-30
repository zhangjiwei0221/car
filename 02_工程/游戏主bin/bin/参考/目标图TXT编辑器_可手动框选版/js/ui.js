/**
 * 目标区 UI 组件
 */

var YarnLevel = YarnLevel || {};

YarnLevel.TargetZoneUI = function(options) {
  options = options || {};
  this.manager = options.manager || null;
  this.onError = options.onError || function(msg) { console.error(msg); };
  this.onSuccess = options.onSuccess || function(msg) { console.log(msg); };
  this.selectedColorId = 0;
  this.selectedSpecialType = null;
  this.cellSize = 40;
  this.paintMode = false;
  this.isPainting = false;
  this.paintSnapshot = null;
  this.lastPaintCellKey = null;
  this.undoStack = [];
  this.maxUndoSteps = 30;
  this.gridContainer = null;
  this.baseRowCountInput = null;
  this.txtWidthInput = null;
  this.txtHeightInput = null;
  this.txtFillValueInput = null;
  this.txtFileInput = null;
  this.colorPalette = null;
  this.zoomSlider = null;
  this.specialPanel = null;
  this.colorReplacePanel = null;
  this.backgroundFillColorInput = null;
  this.backgroundFillBtn = null;
  this.paintModeBtn = null;
  this.undoPaintBtn = null;
  // 框选模式状态
  this.selectMode = false;
  this.isSelecting = false;
  this.selectionStart = null; // {row, col}
  this.selectionEnd = null;   // {row, col}
  this.selection = null;      // {startRow, startCol, endRow, endCol} 规范化后的选区
  this.selectionPaintMode = false;
  // 孤立像素扫描结果
  this.isolatePixels = []; // [{row, col, currentId, suggestId}]
};

YarnLevel.TargetZoneUI.prototype.init = function() {
  this.gridContainer = document.getElementById('targetGrid');
  this.baseRowCountInput = document.getElementById('baseRowCount');
  this.txtWidthInput = document.getElementById('txtWidth');
  this.txtHeightInput = document.getElementById('txtHeight');
  this.txtFillValueInput = document.getElementById('txtFillValue');
  this.txtFileInput = document.getElementById('txtFileInput');
  this.colorPalette = document.getElementById('targetColorPalette');
  this.zoomSlider = document.getElementById('targetZoom');
  this.colorCountSpan = document.getElementById('targetColorCount');
  this.groupCountSpan = document.getElementById('targetGroupCount');
  this.specialPanel = document.getElementById('targetSpecialPanel');
  this.colorReplacePanel = document.getElementById('targetColorReplacePanel');
  this.backgroundFillColorInput = document.getElementById('backgroundFillColor');
  this.backgroundFillBtn = document.getElementById('backgroundFillBtn');
  this.paintModeBtn = document.getElementById('paintModeBtn');
  this.undoPaintBtn = document.getElementById('undoPaintBtn');
  this._initColorPalette();
  this._initSpecialPanel();
  this._bindEvents();
  this._updatePaintControls();
};

YarnLevel.TargetZoneUI.prototype._createColorSwatch = function(entry, options) {
  options = options || {};
  var colorId = entry ? entry.id : 0;
  var swatch = document.createElement('div');
  swatch.className = 'color-swatch' + (colorId === 0 ? ' empty-swatch' : ' image-swatch color-' + colorId);
  swatch.dataset.colorId = String(colorId);
  swatch.title = colorId === 0 ? '空位' : entry.name + ' (' + colorId + ')';

  if (colorId === 0) {
    swatch.textContent = '0';
    return swatch;
  }

  var img = document.createElement('img');
  img.src = YarnLevel.getTargetImage(colorId);
  img.alt = '目标区颜色' + colorId;
  img.draggable = false;
  img.onerror = function() {
    swatch.classList.add('image-missing');
    img.remove();
  };
  swatch.appendChild(img);

  var label = document.createElement('span');
  label.className = 'color-swatch-label';
  label.textContent = colorId;
  swatch.appendChild(label);

  if (options.compactLabel) swatch.classList.add('compact-label');
  return swatch;
};

YarnLevel.TargetZoneUI.prototype._initColorPalette = function() {
  if (!this.colorPalette) return;
  var self = this;
  this.colorPalette.innerHTML = '';
  var emptySwatch = this._createColorSwatch(null);
  if (this.selectedColorId === 0) emptySwatch.classList.add('selected');
  emptySwatch.addEventListener('click', function() { self._selectColor(0); });
  this.colorPalette.appendChild(emptySwatch);
  for (var i = 0; i < YarnLevel.COLOR_MAP.length; i++) {
    (function(entry) {
      var swatch = self._createColorSwatch(entry);
      if (self.selectedColorId === entry.id) swatch.classList.add('selected');
      swatch.addEventListener('click', function() { self._selectColor(entry.id); });
      self.colorPalette.appendChild(swatch);
    })(YarnLevel.COLOR_MAP[i]);
  }
};

YarnLevel.TargetZoneUI.prototype._selectColor = function(colorId) {
  this.selectedColorId = colorId;
  this.selectedSpecialType = null;
  var swatches = this.colorPalette.querySelectorAll('.color-swatch');
  for (var i = 0; i < swatches.length; i++) {
    swatches[i].classList.remove('selected');
    if (parseInt(swatches[i].dataset.colorId || '-1', 10) === colorId) swatches[i].classList.add('selected');
  }
  if (this.specialPanel) {
    var specialBtns = this.specialPanel.querySelectorAll('.target-special-btn');
    for (var j = 0; j < specialBtns.length; j++) specialBtns[j].classList.remove('selected');
  }
};

YarnLevel.TargetZoneUI.prototype._initSpecialPanel = function() {
  if (!this.specialPanel) return;
  var self = this;
  var specialBtns = this.specialPanel.querySelectorAll('.target-special-btn');
  for (var i = 0; i < specialBtns.length; i++) {
    (function(btn) { btn.addEventListener('click', function() { self._selectSpecialType(btn); }); })(specialBtns[i]);
  }
};

YarnLevel.TargetZoneUI.prototype._selectSpecialType = function(btn) {
  var type = parseInt(btn.dataset.type, 10);
  this.selectedSpecialType = type;
  var swatches = this.colorPalette.querySelectorAll('.color-swatch');
  for (var i = 0; i < swatches.length; i++) swatches[i].classList.remove('selected');
  var specialBtns = this.specialPanel.querySelectorAll('.target-special-btn');
  for (var j = 0; j < specialBtns.length; j++) {
    specialBtns[j].classList.remove('selected');
    if (parseInt(specialBtns[j].dataset.type, 10) === type) specialBtns[j].classList.add('selected');
  }
};

YarnLevel.TargetZoneUI.prototype._bindEvents = function() {
  var self = this;
  var importTxtBtn = document.getElementById('importTxtBtn');
  if (importTxtBtn && this.txtFileInput) {
    importTxtBtn.addEventListener('click', function() { self.txtFileInput.click(); });
    this.txtFileInput.addEventListener('change', function(e) { self._handleTxtFileSelect(e); });
  }
  var exportTxtBtn = document.getElementById('exportTxtBtn');
  if (exportTxtBtn) exportTxtBtn.addEventListener('click', function() { self._handleExportTxt(); });
  var createTxtBtn = document.getElementById('createTxtBtn');
  if (createTxtBtn) createTxtBtn.addEventListener('click', function() { self._handleCreateTxt(); });
  if (this.backgroundFillBtn) this.backgroundFillBtn.addEventListener('click', function() { self._handleBackgroundFill(); });
  if (this.paintModeBtn) this.paintModeBtn.addEventListener('click', function() { self._togglePaintMode(); });
  if (this.undoPaintBtn) this.undoPaintBtn.addEventListener('click', function() { self._undoLastPaint(); });
  var selectModeBtn = document.getElementById('selectModeBtn');
  if (selectModeBtn) selectModeBtn.addEventListener('click', function() { self._toggleSelectMode(); });
  var selectionClearBtn = document.getElementById('selectionClearBtn');
  if (selectionClearBtn) selectionClearBtn.addEventListener('click', function() { self._clearSelection(); });
  var selectionFillBtn = document.getElementById('selectionFillBtn');
  if (selectionFillBtn) selectionFillBtn.addEventListener('click', function() { self._fillSelection(); });
  var selectionPaintBtn = document.getElementById('selectionPaintBtn');
  if (selectionPaintBtn) selectionPaintBtn.addEventListener('click', function() { self._toggleSelectionPaintMode(); });
  var selectionZoomInBtn = document.getElementById('selectionZoomInBtn');
  if (selectionZoomInBtn) selectionZoomInBtn.addEventListener('click', function() { self._selectionZoom(1); });
  var selectionZoomOutBtn = document.getElementById('selectionZoomOutBtn');
  if (selectionZoomOutBtn) selectionZoomOutBtn.addEventListener('click', function() { self._selectionZoom(-1); });
  var scanIsolateBtn = document.getElementById('scanIsolateBtn');
  if (scanIsolateBtn) scanIsolateBtn.addEventListener('click', function() { self._scanIsolatePixels(); });
  var fixAllIsolateBtn = document.getElementById('fixAllIsolateBtn');
  if (fixAllIsolateBtn) fixAllIsolateBtn.addEventListener('click', function() { self._fixAllIsolatePixels(); });
  document.addEventListener('keydown', function(e) { self._handleKeyboardShortcut(e); });
  document.addEventListener('mouseup', function() {
    if (self.isSelecting) {
      self._finishSelection(self.selectionEnd ? self.selectionEnd.row : (self.selectionStart ? self.selectionStart.row : 0),
                            self.selectionEnd ? self.selectionEnd.col : (self.selectionStart ? self.selectionStart.col : 0));
    }
    if (self.isPainting) {
      self._commitPaintStroke();
      self._finishPaintStroke();
    }
  });
  if (this.baseRowCountInput) {
    this.baseRowCountInput.addEventListener('change', function(e) { self._handleBaseRowCountChange(e); });
  }
  if (this.zoomSlider) {
    var zoomInput = document.getElementById('targetZoomInput');
    // 拖动时只更新数字显示，不渲染网格
    this.zoomSlider.addEventListener('input', function(e) {
      var value = parseInt(e.target.value, 10);
      self.cellSize = value;
      if (zoomInput) zoomInput.value = value;
    });
    // 松手后才渲染
    this.zoomSlider.addEventListener('change', function(e) {
      var value = parseInt(e.target.value, 10);
      self.cellSize = value;
      if (zoomInput) zoomInput.value = value;
      self.render();
    });
    // 手动输入缩放值
    if (zoomInput) {
      zoomInput.addEventListener('change', function(e) {
        var value = parseInt(e.target.value, 10);
        if (isNaN(value) || value < 4) value = 4;
        if (value > 120) value = 120;
        e.target.value = value;
        self.cellSize = value;
        self.zoomSlider.value = value;
        self.render();
      });
    }
  }
  var zoomFitBtn = document.getElementById('zoomFitBtn');
  if (zoomFitBtn) zoomFitBtn.addEventListener('click', function() { self._zoomToFit(); });
  var zoomResetBtn = document.getElementById('zoomResetBtn');
  if (zoomResetBtn) zoomResetBtn.addEventListener('click', function() { self._zoomReset(); });
};

YarnLevel.TargetZoneUI.prototype._handleTxtFileSelect = function(event) {
  var self = this;
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var result = YarnLevel.parseTXT(e.target.result);
    if (YarnLevel.isParseError(result)) { self.onError(result.message || '导入TXT文件失败'); return; }
    try {
      self.manager.loadRawData(result, 0);
      self._clearUndoStack();
      if (self.baseRowCountInput) self.baseRowCountInput.value = self.manager.getBaseRowCount();
      if (self.txtHeightInput) self.txtHeightInput.value = self.manager.getRowCount();
      if (self.txtWidthInput) self.txtWidthInput.value = self.manager.getColCount();
      self.render();
      // 导入后默认设为10px缩放
      self.cellSize = 10;
      self._syncZoomSlider();
      self.render();
      self.onSuccess('TXT文件导入成功');
    } catch (err) { self.onError(err.message || '加载数据失败'); }
  };
  reader.onerror = function() { self.onError('读取文件失败'); };
  reader.readAsText(file);
  event.target.value = '';
};

YarnLevel.TargetZoneUI.prototype._downloadTxt = function(content, filename) {
  var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename || 'target_zone.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

YarnLevel.TargetZoneUI.prototype._handleExportTxt = function() {
  if (!this.manager || this.manager.isEmpty()) { this.onError('目标区没有数据，无法导出'); return; }
  this._downloadTxt(YarnLevel.serializeTXT(this.manager.getData()), 'target_zone.txt');
  this.onSuccess('TXT文件导出成功');
};

YarnLevel.TargetZoneUI.prototype._handleCreateTxt = function() {
  var width = parseInt(this.txtWidthInput ? this.txtWidthInput.value : '0', 10);
  var height = parseInt(this.txtHeightInput ? this.txtHeightInput.value : '0', 10);
  var fillValue = parseInt(this.txtFillValueInput ? this.txtFillValueInput.value : '0', 10);
  if (isNaN(width) || width <= 0) { this.onError('TXT宽度必须为正整数'); return; }
  if (isNaN(height) || height <= 0) { this.onError('TXT高度必须为正整数'); return; }
  if (isNaN(fillValue) || fillValue < 0) { this.onError('填充值必须是非负整数'); return; }
  try {
    this.manager.createEmptyGrid(width, height, fillValue);
    this.manager.setBaseRowCount(height);
    this._clearUndoStack();
    if (this.baseRowCountInput) this.baseRowCountInput.value = height;
    this.render();
    this.onSuccess('已创建 ' + width + '×' + height + ' 空图，可编辑后再导出TXT');
  } catch (err) { this.onError(err.message || '创建TXT编辑区失败'); }
};

YarnLevel.TargetZoneUI.prototype._handleBackgroundFill = function() {
  if (!this.manager || this.manager.isEmpty()) { this.onError('请先创建或导入TXT'); return; }
  var colorId = parseInt(this.backgroundFillColorInput ? this.backgroundFillColorInput.value : '0', 10);
  if (isNaN(colorId) || colorId <= 0) { this.onError('背景填充颜色编号必须大于0'); return; }
  if (!YarnLevel.isValidColorId(colorId)) { this.onError('颜色编号不存在：' + colorId); return; }
  try {
    this._pushUndoSnapshot();
    var count = this.manager.fillEmptyCells(colorId);
    if (count === 0) {
      this._popEmptyUndoSnapshot();
      this.onSuccess('没有编号为0的块需要填充');
      return;
    }
    this.render();
    this.onSuccess('背景填充完成：已覆盖 ' + count + ' 个0块');
  } catch (err) { this.onError(err.message || '背景填充失败'); }
};

YarnLevel.TargetZoneUI.prototype._handleKeyboardShortcut = function(e) {
  var key = (e.key || '').toLowerCase();
  // Escape 取消选区
  if (key === 'escape' && this.selection) {
    e.preventDefault();
    this._clearSelection();
    return;
  }
  var isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z';
  if (!isUndo) return;
  var target = e.target || {};
  var tagName = (target.tagName || '').toLowerCase();
  var isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
  if (isInput) return;
  if (this.undoStack.length === 0) return;
  e.preventDefault();
  this._undoLastPaint();
};

YarnLevel.TargetZoneUI.prototype._pushUndoSnapshot = function() {
  if (!this.manager || this.manager.isEmpty()) return;
  this.undoStack.push(this.manager.getData());
  if (this.undoStack.length > this.maxUndoSteps) this.undoStack.shift();
  this._updatePaintControls();
};

YarnLevel.TargetZoneUI.prototype._popEmptyUndoSnapshot = function() {
  if (this.undoStack.length > 0) this.undoStack.pop();
  this._updatePaintControls();
};

YarnLevel.TargetZoneUI.prototype._clearUndoStack = function() {
  this.undoStack = [];
  this._updatePaintControls();
};

YarnLevel.TargetZoneUI.prototype._undoLastPaint = function() {
  if (!this.manager || this.undoStack.length === 0) return;
  this.manager.setData(this.undoStack.pop());
  this._finishPaintStroke(false);
  this.render();
  this._updatePaintControls();
  this.onSuccess('已撤回上一步填充');
};

YarnLevel.TargetZoneUI.prototype._updatePaintControls = function() {
  if (this.paintModeBtn) {
    this.paintModeBtn.textContent = this.paintMode ? '拖拽填充：开' : '拖拽填充：关';
    this.paintModeBtn.classList.toggle('btn-success', this.paintMode);
    this.paintModeBtn.classList.toggle('btn-secondary', !this.paintMode);
  }
  if (this.undoPaintBtn) this.undoPaintBtn.disabled = this.undoStack.length === 0;
};

YarnLevel.TargetZoneUI.prototype._finishPaintStroke = function(shouldRender) {
  if (!this.isPainting) return;
  this.isPainting = false;
  this.paintSnapshot = null;
  this.lastPaintCellKey = null;
  if (shouldRender !== false) this.render();
};

YarnLevel.TargetZoneUI.prototype._startPaintStroke = function(row, col) {
  if (!this.manager || this.manager.isEmpty()) return;
  this.isPainting = true;
  this.paintSnapshot = this.manager.getData();
  this.lastPaintCellKey = null;
  this._paintCell(row, col);
};

YarnLevel.TargetZoneUI.prototype._paintCell = function(row, col) {
  if (!this.isPainting || !this.manager) return;
  var key = row + ',' + col;
  if (this.lastPaintCellKey === key) return;
  this.lastPaintCellKey = key;
  this.manager.updateCell(row, col, this.selectedColorId);
};

YarnLevel.TargetZoneUI.prototype._commitPaintStroke = function() {
  if (!this.paintSnapshot) return;
  this.undoStack.push(this.paintSnapshot);
  if (this.undoStack.length > this.maxUndoSteps) this.undoStack.shift();
  this.paintSnapshot = null;
  this._updatePaintControls();
};

YarnLevel.TargetZoneUI.prototype._handleBaseRowCountChange = function(event) {
  var value = parseInt(event.target.value, 10);
  if (isNaN(value) || value < 0) { this.onError('基础行数必须是非负整数'); return; }
  try { this.manager.setBaseRowCount(value); this.render(); } catch (err) { this.onError(err.message); }
};

YarnLevel.TargetZoneUI.prototype.render = function() {
  if (!this.gridContainer) return;
  this._updateStats();
  this._updatePaintControls();
  if (!this.manager || this.manager.isEmpty()) {
    this.gridContainer.innerHTML = '<div class="empty-state">请创建TXT或导入TXT文件</div>';
    this.renderColorReplacePanel();
    return;
  }
  var data = this.manager.getData();
  var rowCount = data.length;
  var colCount = data[0] ? data[0].length : 0;
  var cellSizePx = this.cellSize + 'px';
  // 根据单元格大小自动调整间距
  this.gridContainer.classList.remove('compact-grid', 'ultra-compact-grid');
  if (this.cellSize <= 8) {
    this.gridContainer.classList.add('ultra-compact-grid');
  } else if (this.cellSize <= 16) {
    this.gridContainer.classList.add('compact-grid');
  }
  this.gridContainer.style.gridTemplateColumns = 'repeat(' + colCount + ', ' + cellSizePx + ')';
  this.gridContainer.style.gridTemplateRows = 'repeat(' + rowCount + ', ' + cellSizePx + ')';
  var baseRowCount = this.manager.getBaseRowCount();
  var supplementRowCount = Math.max(0, rowCount - baseRowCount);
  // 是否加载图片：只有单元格足够大时才加载
  var useImages = this.cellSize > 20;
  // 使用 DocumentFragment 批量插入，减少重排
  var fragment = document.createDocumentFragment();
  for (var row = 0; row < rowCount; row++) {
    for (var col = 0; col < colCount; col++) {
      var cell = this._createCell(row, col, data[row][col], row < supplementRowCount, useImages);
      cell.style.width = cellSizePx;
      cell.style.height = cellSizePx;
      // 选区高亮 + 边界线
      if (this.selection) {
        var s = this.selection;
        var inSel = row >= s.startRow && row <= s.endRow && col >= s.startCol && col <= s.endCol;
        if (inSel) {
          cell.classList.add('in-selection');
          if (row === s.startRow) cell.classList.add('sel-border-top');
          if (row === s.endRow) cell.classList.add('sel-border-bottom');
          if (col === s.startCol) cell.classList.add('sel-border-left');
          if (col === s.endCol) cell.classList.add('sel-border-right');
        }
      }
      // 孤立像素高亮
      if (this._isolateSet && this._isolateSet[row + ',' + col]) {
        cell.classList.add('isolate-highlight');
      }
      fragment.appendChild(cell);
    }
  }
  this.gridContainer.innerHTML = '';
  this.gridContainer.appendChild(fragment);
  // 添加 has-selection class
  this.gridContainer.classList.toggle('has-selection', !!this.selection);
  this.renderColorReplacePanel();
  this._updateSelectionPanel();
  this._renderThumb();
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
      if (colorId > 0) { colorSet[colorId] = true; totalCount++; }
    }
  }
  if (this.colorCountSpan) this.colorCountSpan.textContent = Object.keys(colorSet).length;
  if (this.groupCountSpan) this.groupCountSpan.textContent = Math.floor(totalCount / 3);
};

YarnLevel.TargetZoneUI.prototype._createCell = function(row, col, block, isSupplementRow, useImages) {
  var self = this;
  var cell = document.createElement('div');
  cell.className = 'grid-cell';
  cell.dataset.row = row;
  cell.dataset.col = col;
  var colorId = block.id;
  if (colorId === 0) {
    cell.classList.add('empty-cell');
  } else if (YarnLevel.isValidColorId(colorId)) {
    cell.classList.add('color-' + colorId);
    // 只有 useImages=true 且单元格够大时才加载图片
    if (useImages) {
      var imagePath = YarnLevel.getTargetImage(colorId);
      if (imagePath) {
        var img = document.createElement('img');
        img.src = imagePath;
        img.alt = '颜色' + colorId;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.draggable = false;
        img.onerror = function() {
          img.remove();
          var idSpan = document.createElement('span');
          idSpan.className = 'color-id';
          idSpan.textContent = colorId;
          cell.appendChild(idSpan);
        };
        cell.appendChild(img);
      }
    }
  } else {
    var idSpan2 = document.createElement('span');
    idSpan2.className = 'color-id';
    idSpan2.textContent = colorId;
    cell.appendChild(idSpan2);
  }
  if (block.type === 1) {
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
  cell.addEventListener('mousedown', function(e) {
    if (self.selectMode && !self.paintMode && self.selectedSpecialType === null) {
      e.preventDefault();
      self._startSelection(row, col);
    } else if (self.selectionPaintMode && self.selection && self._isInSelection(row, col)) {
      e.preventDefault();
      self._startPaintStroke(row, col);
    } else if (self.paintMode && self.selectedSpecialType === null) {
      e.preventDefault();
      self._startPaintStroke(row, col);
    }
  });
  cell.addEventListener('mouseenter', function() {
    if (self.selectMode && self.isSelecting) {
      self._updateSelection(row, col);
    } else if (self.selectionPaintMode && self.isPainting && self.selection && self._isInSelection(row, col)) {
      self._paintCell(row, col);
    } else if (self.paintMode && self.isPainting && self.selectedSpecialType === null) {
      self._paintCell(row, col);
    }
  });
  cell.addEventListener('mouseup', function() {
    if (self.selectMode && self.isSelecting) {
      self._finishSelection(row, col);
    } else if (self.selectionPaintMode && self.isPainting) {
      self._commitPaintStroke();
      self._finishPaintStroke();
    } else if (self.paintMode && self.isPainting) {
      self._commitPaintStroke();
      self._finishPaintStroke();
    }
  });
  cell.addEventListener('click', function() {
    if (!self.paintMode && !self.selectMode && !self.selectionPaintMode) self._handleCellClick(row, col);
  });
  return cell;
};

YarnLevel.TargetZoneUI.prototype._handleCellClick = function(row, col) {
  if (!this.manager) return;
  if (this.selectedSpecialType !== null) {
    this._pushUndoSnapshot();
    if (this.manager.updateCellType(row, col, this.selectedSpecialType)) this.render();
    return;
  }
  this._pushUndoSnapshot();
  if (this.manager.updateCell(row, col, this.selectedColorId)) {
    // 快速更新单个单元格而不是重建整个网格
    this._quickUpdateCell(row, col);
    this.renderColorReplacePanel();
    this._updateSelectionPanel();
  }
};

// 快速更新单个单元格的显示（避免完整 render）
YarnLevel.TargetZoneUI.prototype._quickUpdateCell = function(row, col) {
  if (!this.gridContainer) return;
  var colCount = this.manager.getColCount();
  var index = row * colCount + col;
  var cells = this.gridContainer.children;
  if (index >= cells.length) return;
  var oldCell = cells[index];
  var block = this.manager.getCell(row, col);
  if (!block) return;
  var useImages = this.cellSize > 20;
  var baseRowCount = this.manager.getBaseRowCount();
  var rowCount = this.manager.getRowCount();
  var supplementRowCount = Math.max(0, rowCount - baseRowCount);
  var newCell = this._createCell(row, col, block, row < supplementRowCount, useImages);
  newCell.style.width = oldCell.style.width;
  newCell.style.height = oldCell.style.height;
  // 保留选区样式
  if (oldCell.classList.contains('in-selection')) newCell.classList.add('in-selection');
  if (oldCell.classList.contains('sel-border-top')) newCell.classList.add('sel-border-top');
  if (oldCell.classList.contains('sel-border-bottom')) newCell.classList.add('sel-border-bottom');
  if (oldCell.classList.contains('sel-border-left')) newCell.classList.add('sel-border-left');
  if (oldCell.classList.contains('sel-border-right')) newCell.classList.add('sel-border-right');
  this.gridContainer.replaceChild(newCell, oldCell);
};

YarnLevel.TargetZoneUI.prototype.renderColorReplacePanel = function() {
  if (!this.colorReplacePanel) return;
  this.colorReplacePanel.innerHTML = '';
  if (!this.manager || this.manager.isEmpty()) {
    var hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = '导入或创建数据后显示';
    this.colorReplacePanel.appendChild(hint);
    return;
  }
  var usedColors = this.manager.getUsedColors();
  var colorIds = Object.keys(usedColors).map(Number).sort(function(a, b) { return a - b; });
  if (colorIds.length === 0) {
    var emptyHint = document.createElement('span');
    emptyHint.className = 'hint';
    emptyHint.textContent = '暂无颜色数据';
    this.colorReplacePanel.appendChild(emptyHint);
    return;
  }
  // 计算总像素数
  var totalPixels = 0;
  for (var k in usedColors) totalPixels += usedColors[k];
  var self = this;
  colorIds.forEach(function(colorId) {
    var count = usedColors[colorId];
    var percent = totalPixels > 0 ? (count / totalPixels * 100).toFixed(1) : '0';
    var entry = YarnLevel.getColorEntry(colorId);
    var wrapper = document.createElement('div');
    wrapper.className = 'color-replace-item';
    wrapper.title = (entry ? entry.name : '颜色') + '(' + colorId + ') × ' + count + ' (' + percent + '%)\n点击替换';
    var swatch = self._createColorSwatch(entry || { id: colorId, name: '颜色' + colorId, targetImage: '目标区颜色' + colorId + '.png' }, { compactLabel: true });
    var badge = document.createElement('span');
    badge.className = 'color-replace-badge';
    badge.innerHTML = '×' + count + '<br>' + percent + '%';
    wrapper.appendChild(swatch);
    wrapper.appendChild(badge);
    wrapper.addEventListener('click', function() { self._openColorReplaceModal(colorId); });
    self.colorReplacePanel.appendChild(wrapper);
  });
};

YarnLevel.TargetZoneUI.prototype._openColorReplaceModal = function(oldColorId) {
  var self = this;
  var modal = document.getElementById('colorReplaceModal');
  var titleEl = document.getElementById('colorReplaceModalTitle');
  var palette = document.getElementById('colorReplaceModalPalette');
  if (!modal || !palette) return;
  var oldEntry = YarnLevel.getColorEntry(oldColorId);
  var oldName = oldEntry ? oldEntry.name + '(' + oldColorId + ')' : '颜色' + oldColorId;
  if (titleEl) titleEl.textContent = '将「' + oldName + '」替换为：';
  palette.innerHTML = '';
  YarnLevel.COLOR_MAP.forEach(function(entry) {
    if (entry.id === oldColorId) return;
    var swatch = self._createColorSwatch(entry);
    swatch.addEventListener('click', function() {
      self._pushUndoSnapshot();
      var count = self.manager.replaceColor(oldColorId, entry.id);
      self.render();
      self.onSuccess('已将 ' + oldName + ' 全部替换为 ' + entry.name + '(' + entry.id + ')，共 ' + count + ' 个');
      self._closeColorReplaceModal();
    });
    palette.appendChild(swatch);
  });
  modal.classList.remove('hidden');
  var closeBtn = document.getElementById('colorReplaceModalClose');
  if (closeBtn) closeBtn.onclick = function() { self._closeColorReplaceModal(); };
  var backdrop = modal.querySelector('.color-replace-modal-backdrop');
  if (backdrop) backdrop.onclick = function() { self._closeColorReplaceModal(); };
};

YarnLevel.TargetZoneUI.prototype._closeColorReplaceModal = function() {
  var modal = document.getElementById('colorReplaceModal');
  if (modal) modal.classList.add('hidden');
};

YarnLevel.TargetZoneUI.prototype._zoomToFit = function() {
  if (!this.manager || this.manager.isEmpty() || !this.gridContainer) return;
  var colCount = this.manager.getColCount();
  var rowCount = this.manager.getRowCount();
  if (colCount === 0 || rowCount === 0) return;
  // 获取网格容器的可用空间
  var container = this.gridContainer.parentElement;
  if (!container) return;
  var containerWidth = container.clientWidth - 32;
  var containerHeight = window.innerHeight * 0.6; // 使用视口高度的60%
  if (containerWidth < 200) containerWidth = window.innerWidth - 100;
  // 计算适合的单元格大小（考虑gap）
  var gapSize = 2;
  var fitWidth = Math.floor((containerWidth - gapSize * (colCount + 1)) / colCount);
  var fitHeight = Math.floor((containerHeight - gapSize * (rowCount + 1)) / rowCount);
  var fitSize = Math.min(fitWidth, fitHeight);
  // 限制在滑块范围内
  fitSize = Math.max(4, Math.min(120, fitSize));
  this.cellSize = fitSize;
  this._syncZoomSlider();
  this.render();
  this.onSuccess('已适应窗口，单元格大小：' + fitSize + 'px');
};

YarnLevel.TargetZoneUI.prototype._zoomReset = function() {
  this.cellSize = 40;
  this._syncZoomSlider();
  this.render();
};

YarnLevel.TargetZoneUI.prototype._syncZoomSlider = function() {
  if (this.zoomSlider) this.zoomSlider.value = this.cellSize;
  var zoomInput = document.getElementById('targetZoomInput');
  if (zoomInput) zoomInput.value = this.cellSize;
};

// ==================== 框选模式 ====================

YarnLevel.TargetZoneUI.prototype._toggleSelectMode = function() {
  this.selectMode = !this.selectMode;
  if (this.selectMode && this.paintMode) {
    this.paintMode = false;
    this._updatePaintControls();
  }
  var btn = document.getElementById('selectModeBtn');
  if (btn) {
    btn.textContent = this.selectMode ? '框选模式：开' : '框选模式：关';
    btn.classList.toggle('btn-active', this.selectMode);
    btn.classList.toggle('btn-secondary', !this.selectMode);
  }
  if (!this.selectMode) {
    this._clearSelection();
  }
};

YarnLevel.TargetZoneUI.prototype._togglePaintMode = function() {
  this.paintMode = !this.paintMode;
  if (this.paintMode && this.selectMode) {
    this.selectMode = false;
    var selectBtn = document.getElementById('selectModeBtn');
    if (selectBtn) {
      selectBtn.textContent = '框选模式：关';
      selectBtn.classList.remove('btn-active');
      selectBtn.classList.add('btn-secondary');
    }
    this._clearSelection();
  }
  this._finishPaintStroke(false);
  this._updatePaintControls();
};

YarnLevel.TargetZoneUI.prototype._startSelection = function(row, col) {
  this.isSelecting = true;
  this.selectionStart = { row: row, col: col };
  this.selectionEnd = { row: row, col: col };
  this.selection = null;
  this.selectionPaintMode = false;
  // 添加 selecting class 实现实时暗化
  if (this.gridContainer) this.gridContainer.classList.add('selecting');
  this._updateSelectionHighlight();
};

YarnLevel.TargetZoneUI.prototype._updateSelection = function(row, col) {
  if (!this.isSelecting) return;
  this.selectionEnd = { row: row, col: col };
  this._updateSelectionHighlight();
};

YarnLevel.TargetZoneUI.prototype._finishSelection = function(row, col) {
  if (!this.isSelecting) return;
  this.isSelecting = false;
  this.selectionEnd = { row: row, col: col };
  if (this.gridContainer) this.gridContainer.classList.remove('selecting');
  var r1 = Math.min(this.selectionStart.row, this.selectionEnd.row);
  var r2 = Math.max(this.selectionStart.row, this.selectionEnd.row);
  var c1 = Math.min(this.selectionStart.col, this.selectionEnd.col);
  var c2 = Math.max(this.selectionStart.col, this.selectionEnd.col);
  this.selection = { startRow: r1, startCol: c1, endRow: r2, endCol: c2 };
  // 框选后：主区域显示选区放大，右侧显示全图缩略
  this._enterSelectionView();
  this.onSuccess('已选区: ' + (c2 - c1 + 1) + '×' + (r2 - r1 + 1) + '，共 ' + ((r2 - r1 + 1) * (c2 - c1 + 1)) + ' 像素');
};

YarnLevel.TargetZoneUI.prototype._clearSelection = function() {
  this.selection = null;
  this.selectionStart = null;
  this.selectionEnd = null;
  this.isSelecting = false;
  this.selectionPaintMode = false;
  if (this.gridContainer) this.gridContainer.classList.remove('selecting');
  this._exitSelectionView();
};

YarnLevel.TargetZoneUI.prototype._isInSelection = function(row, col) {
  if (!this.selection) return false;
  return row >= this.selection.startRow && row <= this.selection.endRow &&
         col >= this.selection.startCol && col <= this.selection.endCol;
};

YarnLevel.TargetZoneUI.prototype._updateSelectionHighlight = function() {
  if (!this.gridContainer || !this.selectionStart || !this.selectionEnd) return;
  var r1 = Math.min(this.selectionStart.row, this.selectionEnd.row);
  var r2 = Math.max(this.selectionStart.row, this.selectionEnd.row);
  var c1 = Math.min(this.selectionStart.col, this.selectionEnd.col);
  var c2 = Math.max(this.selectionStart.col, this.selectionEnd.col);
  var cells = this.gridContainer.querySelectorAll('.grid-cell');
  for (var i = 0; i < cells.length; i++) {
    var cellRow = parseInt(cells[i].dataset.row, 10);
    var cellCol = parseInt(cells[i].dataset.col, 10);
    var inRange = cellRow >= r1 && cellRow <= r2 && cellCol >= c1 && cellCol <= c2;
    cells[i].classList.toggle('in-selection', inRange);
  }
};

// 进入选区视图：主区域放大选区，右侧缩略全图
YarnLevel.TargetZoneUI.prototype._enterSelectionView = function() {
  var thumbContainer = document.getElementById('zoneContentThumb');
  if (thumbContainer) thumbContainer.classList.remove('hidden');
  // 计算选区适合的缩放大小（目标：主区域宽度的80%）
  var mainContainer = document.getElementById('zoneContentMain');
  if (mainContainer && this.selection) {
    var s = this.selection;
    var selWidth = s.endCol - s.startCol + 1;
    var selHeight = s.endRow - s.startRow + 1;
    var availWidth = mainContainer.clientWidth - 40;
    var availHeight = window.innerHeight * 0.5;
    if (availWidth < 300) availWidth = 600;
    var fitW = Math.floor(availWidth / selWidth);
    var fitH = Math.floor(availHeight / selHeight);
    var fitSize = Math.min(fitW, fitH);
    fitSize = Math.max(6, Math.min(60, fitSize));
    this.cellSize = fitSize;
    this._syncZoomSlider();
  }
  this.render();
  // 渲染后滚动到选区居中
  var self = this;
  setTimeout(function() { self._scrollToSelection(); }, 30);
};

// 退出选区视图：恢复正常布局
YarnLevel.TargetZoneUI.prototype._exitSelectionView = function() {
  var thumbContainer = document.getElementById('zoneContentThumb');
  if (thumbContainer) thumbContainer.classList.add('hidden');
  this.render();
};

// 选区缩放：direction 1=放大, -1=缩小
YarnLevel.TargetZoneUI.prototype._selectionZoom = function(direction) {
  if (!this.selection) return;
  // 每次缩放步进：小尺寸时步进小，大尺寸时步进大
  var step;
  if (this.cellSize <= 10) step = 2;
  else if (this.cellSize <= 30) step = 4;
  else step = 8;
  var newSize = this.cellSize + (direction * step);
  newSize = Math.max(4, Math.min(120, newSize));
  if (newSize === this.cellSize) return;
  this.cellSize = newSize;
  this._syncZoomSlider();
  this.render();
  // 渲染后滚动到选区居中
  this._scrollToSelection();
};

// 滚动主区域使选区居中显示
YarnLevel.TargetZoneUI.prototype._scrollToSelection = function() {
  if (!this.selection || !this.gridContainer) return;
  var mainContainer = document.getElementById('zoneContentMain');
  if (!mainContainer) return;
  var s = this.selection;
  var gapSize = this.cellSize <= 8 ? 0 : (this.cellSize <= 16 ? 1 : 2);
  // 计算选区中心在网格中的像素位置
  var centerRow = (s.startRow + s.endRow) / 2;
  var centerCol = (s.startCol + s.endCol) / 2;
  var cellWithGap = this.cellSize + gapSize;
  var centerX = centerCol * cellWithGap + this.cellSize / 2;
  var centerY = centerRow * cellWithGap + this.cellSize / 2;
  // 滚动使中心对准容器中心
  var scrollLeft = centerX - mainContainer.clientWidth / 2;
  var scrollTop = centerY - mainContainer.clientHeight / 2;
  mainContainer.scrollTo({ left: Math.max(0, scrollLeft), top: Math.max(0, scrollTop), behavior: 'smooth' });
};

// 渲染右侧缩略图
YarnLevel.TargetZoneUI.prototype._renderThumb = function() {
  var thumbGrid = document.getElementById('targetGridThumb');
  var thumbContainer = document.getElementById('zoneContentThumb');
  if (!thumbGrid || !thumbContainer || thumbContainer.classList.contains('hidden')) return;
  if (!this.manager || this.manager.isEmpty()) { thumbGrid.innerHTML = ''; return; }
  var data = this.manager.getData();
  var rowCount = data.length;
  var colCount = data[0] ? data[0].length : 0;
  // 计算缩略图单元格大小（适配容器宽度）
  var thumbWidth = thumbContainer.clientWidth - 20;
  if (thumbWidth < 100) thumbWidth = 240;
  var thumbCellSize = Math.max(2, Math.floor(thumbWidth / colCount));
  if (thumbCellSize > 8) thumbCellSize = 8;
  var thumbCellPx = thumbCellSize + 'px';
  thumbGrid.classList.remove('compact-grid', 'ultra-compact-grid');
  thumbGrid.classList.add('ultra-compact-grid');
  thumbGrid.style.gridTemplateColumns = 'repeat(' + colCount + ', ' + thumbCellPx + ')';
  thumbGrid.style.gridTemplateRows = 'repeat(' + rowCount + ', ' + thumbCellPx + ')';
  var fragment = document.createDocumentFragment();
  for (var row = 0; row < rowCount; row++) {
    for (var col = 0; col < colCount; col++) {
      var cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.style.width = thumbCellPx;
      cell.style.height = thumbCellPx;
      var colorId = data[row][col].id;
      if (colorId === 0) {
        cell.classList.add('empty-cell');
      } else if (YarnLevel.isValidColorId(colorId)) {
        cell.classList.add('color-' + colorId);
      }
      if (this.selection && this._isInSelection(row, col)) {
        cell.classList.add('in-selection');
      }
      fragment.appendChild(cell);
    }
  }
  thumbGrid.innerHTML = '';
  thumbGrid.appendChild(fragment);
};

YarnLevel.TargetZoneUI.prototype._updateSelectionPanel = function() {
  var panel = document.getElementById('selectionInfoPanel');
  if (!panel) return;
  if (!this.selection) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  var s = this.selection;
  var width = s.endCol - s.startCol + 1;
  var height = s.endRow - s.startRow + 1;
  var pixelCount = width * height;
  // 更新选区元信息
  var metaEl = document.getElementById('selectionMeta');
  if (metaEl) metaEl.textContent = '范围(' + s.startRow + ',' + s.startCol + ')→(' + s.endRow + ',' + s.endCol + ') | ' + width + '×' + height + ' | ' + pixelCount + '像素';
  // 统计选区内颜色
  this._renderSelectionColors();
  // 更新选区拖拽填充按钮状态
  var paintBtn = document.getElementById('selectionPaintBtn');
  if (paintBtn) {
    paintBtn.textContent = this.selectionPaintMode ? '选区内拖拽：开' : '选区内拖拽：关';
    paintBtn.classList.toggle('btn-active', this.selectionPaintMode);
    paintBtn.classList.toggle('btn-secondary', !this.selectionPaintMode);
  }
};

YarnLevel.TargetZoneUI.prototype._renderSelectionColors = function() {
  var colorPanel = document.getElementById('selectionColorPanel');
  if (!colorPanel || !this.selection || !this.manager) return;
  colorPanel.innerHTML = '';
  var s = this.selection;
  var data = this.manager.getData();
  var colorMap = {};
  var totalInSelection = 0;
  for (var r = s.startRow; r <= s.endRow; r++) {
    for (var c = s.startCol; c <= s.endCol; c++) {
      if (data[r] && data[r][c]) {
        var id = data[r][c].id;
        if (id > 0) { colorMap[id] = (colorMap[id] || 0) + 1; totalInSelection++; }
      }
    }
  }
  var colorIds = Object.keys(colorMap).map(Number).sort(function(a, b) { return a - b; });
  if (colorIds.length === 0) {
    var hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = '选区内无颜色';
    colorPanel.appendChild(hint);
    return;
  }
  var self = this;
  colorIds.forEach(function(colorId) {
    var count = colorMap[colorId];
    var percent = totalInSelection > 0 ? (count / totalInSelection * 100).toFixed(1) : '0';
    var entry = YarnLevel.getColorEntry(colorId);
    var wrapper = document.createElement('div');
    wrapper.className = 'color-replace-item';
    wrapper.title = (entry ? entry.name : '颜色') + '(' + colorId + ') × ' + count + ' (' + percent + '%)\n点击替换选区内该颜色';
    var swatch = self._createColorSwatch(entry || { id: colorId, name: '颜色' + colorId, targetImage: '目标区颜色' + colorId + '.png' }, { compactLabel: true });
    var badge = document.createElement('span');
    badge.className = 'color-replace-badge';
    badge.innerHTML = '×' + count + '<br>' + percent + '%';
    wrapper.appendChild(swatch);
    wrapper.appendChild(badge);
    wrapper.addEventListener('click', function() { self._openSelectionReplaceModal(colorId); });
    colorPanel.appendChild(wrapper);
  });
};

YarnLevel.TargetZoneUI.prototype._fillSelection = function() {
  if (!this.selection || !this.manager) return;
  var colorId = this.selectedColorId;
  if (colorId < 0) { this.onError('请先选择一个颜色'); return; }
  this._pushUndoSnapshot();
  var s = this.selection;
  var count = 0;
  for (var r = s.startRow; r <= s.endRow; r++) {
    for (var c = s.startCol; c <= s.endCol; c++) {
      if (this.manager.updateCell(r, c, colorId)) count++;
    }
  }
  this.render();
  var colorName = colorId === 0 ? '空位' : (YarnLevel.getColorEntry(colorId) ? YarnLevel.getColorEntry(colorId).name : '颜色' + colorId);
  this.onSuccess('已用「' + colorName + '」填充选区，共 ' + count + ' 像素');
};

YarnLevel.TargetZoneUI.prototype._toggleSelectionPaintMode = function() {
  this.selectionPaintMode = !this.selectionPaintMode;
  if (this.selectionPaintMode && this.paintMode) {
    this.paintMode = false;
    this._updatePaintControls();
  }
  this._updateSelectionPanel();
};

YarnLevel.TargetZoneUI.prototype._openSelectionReplaceModal = function(oldColorId) {
  var self = this;
  var modal = document.getElementById('selectionReplaceModal');
  var titleEl = document.getElementById('selectionReplaceModalTitle');
  var palette = document.getElementById('selectionReplaceModalPalette');
  if (!modal || !palette) return;
  var oldEntry = YarnLevel.getColorEntry(oldColorId);
  var oldName = oldEntry ? oldEntry.name + '(' + oldColorId + ')' : '颜色' + oldColorId;
  if (titleEl) titleEl.textContent = '选区内将「' + oldName + '」替换为：';
  palette.innerHTML = '';
  YarnLevel.COLOR_MAP.forEach(function(entry) {
    if (entry.id === oldColorId) return;
    var swatch = self._createColorSwatch(entry);
    swatch.addEventListener('click', function() {
      self._pushUndoSnapshot();
      var count = self._replaceColorInSelection(oldColorId, entry.id);
      self.render();
      self.onSuccess('选区内已将「' + oldName + '」替换为「' + entry.name + '(' + entry.id + ')」，共 ' + count + ' 个');
      self._closeSelectionReplaceModal();
    });
    palette.appendChild(swatch);
  });
  modal.classList.remove('hidden');
  var closeBtn = document.getElementById('selectionReplaceModalClose');
  if (closeBtn) closeBtn.onclick = function() { self._closeSelectionReplaceModal(); };
  var backdrop = modal.querySelector('.color-replace-modal-backdrop');
  if (backdrop) backdrop.onclick = function() { self._closeSelectionReplaceModal(); };
};

YarnLevel.TargetZoneUI.prototype._closeSelectionReplaceModal = function() {
  var modal = document.getElementById('selectionReplaceModal');
  if (modal) modal.classList.add('hidden');
};

YarnLevel.TargetZoneUI.prototype._replaceColorInSelection = function(oldId, newId) {
  if (!this.selection || !this.manager) return 0;
  var s = this.selection;
  var count = 0;
  var data = this.manager.getData();
  for (var r = s.startRow; r <= s.endRow; r++) {
    for (var c = s.startCol; c <= s.endCol; c++) {
      if (data[r] && data[r][c] && data[r][c].id === oldId) {
        this.manager.updateCell(r, c, newId);
        count++;
      }
    }
  }
  return count;
};

// ==================== 孤立像素扫描 ====================

/**
 * 扫描孤立像素：多策略综合检测
 * 核心原则：中心5×5区域内同色数量 ≤ 3（含自身）= 小群体候选
 * 四角方向（左上、右上、左下、右下各3×3）用于确认区域主导色
 * 横向/纵向长条用于捕获过渡地带漏网之鱼
 * 第二轮：模拟修复后，对10×10区域内剩余2-3个同色小群体进行主导色同化
 * 修复建议：取直接相邻8格中占比最高的颜色
 */
YarnLevel.TargetZoneUI.prototype._scanIsolatePixels = function() {
  if (!this.manager || this.manager.isEmpty()) {
    this.onError('请先导入或创建TXT');
    return;
  }
  var data = this.manager.getData();
  var rowCount = data.length;
  var colCount = data[0] ? data[0].length : 0;

  // ========== 第一轮：检测孤立像素和小群体 ==========
  var isolates = [];
  // 先标记哪些像素是"小群体"（中心5×5内同色≤3）
  var smallGroupMap = {}; // key -> true

  for (var r = 0; r < rowCount; r++) {
    for (var c = 0; c < colCount; c++) {
      var myId = data[r][c].id;
      if (myId === 0) continue;

      // === 中心5×5区域内同色计数（含自身） ===
      var sameCount5x5 = 0;
      for (var dr = -2; dr <= 2; dr++) {
        for (var dc = -2; dc <= 2; dc++) {
          var nr = r + dr;
          var nc = c + dc;
          if (nr < 0 || nr >= rowCount || nc < 0 || nc >= colCount) continue;
          if (data[nr][nc].id === myId) sameCount5x5++;
        }
      }

      // 同色数量 > 3（含自身），说明有足够的同色群体，不是孤立
      if (sameCount5x5 > 3) continue;

      // 标记为小群体候选
      smallGroupMap[r + ',' + c] = true;

      // === 四角方向确认区域主导色 ===
      var cornerOffsets = [
        { dr: -3, dc: -3 },
        { dr: -3, dc: 3 },
        { dr: 3, dc: -3 },
        { dr: 3, dc: 3 }
      ];
      var regionColorCount = {};
      var regionTotal = 0;
      for (var oi = 0; oi < cornerOffsets.length; oi++) {
        var cR = r + cornerOffsets[oi].dr;
        var cC = c + cornerOffsets[oi].dc;
        for (var dr2 = -1; dr2 <= 1; dr2++) {
          for (var dc2 = -1; dc2 <= 1; dc2++) {
            var nr2 = cR + dr2;
            var nc2 = cC + dc2;
            if (nr2 < 0 || nr2 >= rowCount || nc2 < 0 || nc2 >= colCount) continue;
            if (nr2 === r && nc2 === c) continue;
            var nId = data[nr2][nc2].id;
            if (nId > 0) {
              regionColorCount[nId] = (regionColorCount[nId] || 0) + 1;
              regionTotal++;
            }
          }
        }
      }

      // 四角区域中自身颜色数量
      var myRegionCount = regionColorCount[myId] || 0;
      // 如果四角区域中自身颜色较多（>5），说明附近有同色大区域，不算孤立
      if (myRegionCount > 5) continue;

      // === 横向长条 1×9 ===
      var hSameCount = 0;
      var hStart = Math.max(0, c - 4);
      var hEnd = Math.min(colCount - 1, c + 4);
      for (var hc = hStart; hc <= hEnd; hc++) {
        if (hc === c) continue;
        if (data[r][hc].id === myId) hSameCount++;
      }

      // === 纵向长条 9×1 ===
      var vSameCount = 0;
      var vStart = Math.max(0, r - 4);
      var vEnd = Math.min(rowCount - 1, r + 4);
      for (var vr = vStart; vr <= vEnd; vr++) {
        if (vr === r) continue;
        if (data[vr][c].id === myId) vSameCount++;
      }

      // 综合判定：横向和纵向同色都很少（各≤1）
      var isIsolate = (hSameCount <= 1 || vSameCount <= 1);

      if (isIsolate) {
        // 修复建议：取直接相邻8格中占比最高的颜色
        var neighborCount = {};
        for (var dr3 = -1; dr3 <= 1; dr3++) {
          for (var dc3 = -1; dc3 <= 1; dc3++) {
            if (dr3 === 0 && dc3 === 0) continue;
            var nr3 = r + dr3;
            var nc3 = c + dc3;
            if (nr3 < 0 || nr3 >= rowCount || nc3 < 0 || nc3 >= colCount) continue;
            var nId3 = data[nr3][nc3].id;
            if (nId3 > 0 && nId3 !== myId) {
              neighborCount[nId3] = (neighborCount[nId3] || 0) + 1;
            }
          }
        }
        var suggestId = 0;
        var maxNCount = 0;
        for (var nid in neighborCount) {
          if (neighborCount[nid] > maxNCount) {
            maxNCount = neighborCount[nid];
            suggestId = parseInt(nid, 10);
          }
        }
        if (suggestId > 0) {
          isolates.push({ row: r, col: c, currentId: myId, suggestId: suggestId });
        }
      }
    }
  }

  // ========== 第二轮：小群体同化扫描 ==========
  // 模拟第一轮修复后的数据，检测剩余的2-3个同色小群体
  // 在10×10区域中如果有1-2个主导色且该小群体不是主导色，则同化
  var firstRoundKeys = {};
  for (var i = 0; i < isolates.length; i++) {
    firstRoundKeys[isolates[i].row + ',' + isolates[i].col] = isolates[i].suggestId;
  }

  // 模拟修复后的数据读取函数
  function getSimulatedId(row, col) {
    var key = row + ',' + col;
    if (firstRoundKeys[key] !== undefined) return firstRoundKeys[key];
    return data[row][col].id;
  }

  // 对所有小群体候选（未被第一轮标记的）进行第二轮检测
  for (var r2 = 0; r2 < rowCount; r2++) {
    for (var c2 = 0; c2 < colCount; c2++) {
      var key2 = r2 + ',' + c2;
      // 跳过已被第一轮标记的
      if (firstRoundKeys[key2] !== undefined) continue;
      // 只检查小群体候选
      if (!smallGroupMap[key2]) continue;

      var myId2 = data[r2][c2].id;
      if (myId2 === 0) continue;

      // 在10×10区域内统计模拟修复后的颜色分布
      var areaColorCount = {};
      var areaTotal = 0;
      var rMin = Math.max(0, r2 - 5);
      var rMax = Math.min(rowCount - 1, r2 + 5);
      var cMin = Math.max(0, c2 - 5);
      var cMax = Math.min(colCount - 1, c2 + 5);

      for (var ar = rMin; ar <= rMax; ar++) {
        for (var ac = cMin; ac <= cMax; ac++) {
          var simId = getSimulatedId(ar, ac);
          if (simId > 0) {
            areaColorCount[simId] = (areaColorCount[simId] || 0) + 1;
            areaTotal++;
          }
        }
      }

      if (areaTotal < 10) continue;

      // 自身颜色在区域内的数量
      var myAreaCount = areaColorCount[myId2] || 0;
      // 如果自身颜色在10×10区域中占比 > 10%，不算需要同化的小群体
      if (myAreaCount / areaTotal > 0.10) continue;

      // 找区域内的主导色（排除自身）
      var dominant = 0;
      var dominantCnt = 0;
      for (var aid in areaColorCount) {
        var aidNum = parseInt(aid, 10);
        if (aidNum !== myId2 && areaColorCount[aid] > dominantCnt) {
          dominantCnt = areaColorCount[aid];
          dominant = aidNum;
        }
      }

      // 主导色占比需要 > 35% 才进行同化
      if (dominant > 0 && dominantCnt / areaTotal > 0.35) {
        // 确认直接相邻8格中主导色是否存在（优先相邻色）
        var adjHasDominant = false;
        for (var dr4 = -1; dr4 <= 1; dr4++) {
          for (var dc4 = -1; dc4 <= 1; dc4++) {
            if (dr4 === 0 && dc4 === 0) continue;
            var nr4 = r2 + dr4;
            var nc4 = c2 + dc4;
            if (nr4 < 0 || nr4 >= rowCount || nc4 < 0 || nc4 >= colCount) continue;
            if (getSimulatedId(nr4, nc4) === dominant) { adjHasDominant = true; break; }
          }
          if (adjHasDominant) break;
        }

        if (adjHasDominant) {
          isolates.push({ row: r2, col: c2, currentId: myId2, suggestId: dominant });
        }
      }
    }
  }

  this.isolatePixels = isolates;
  this._isolateSet = {};
  for (var i = 0; i < isolates.length; i++) {
    this._isolateSet[isolates[i].row + ',' + isolates[i].col] = true;
  }

  this._renderIsolateResults();
  this.render();
  this.onSuccess('扫描完成，发现 ' + isolates.length + ' 个孤立像素（含小群体同化）');
};

YarnLevel.TargetZoneUI.prototype._renderIsolateResults = function() {
  var panel = document.getElementById('isolateResultPanel');
  var fixAllBtn = document.getElementById('fixAllIsolateBtn');
  if (!panel) return;
  panel.innerHTML = '';

  if (this.isolatePixels.length === 0) {
    var hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = '未发现孤立像素，图像质量良好 ✓';
    hint.style.color = '#5cb85c';
    panel.appendChild(hint);
    if (fixAllBtn) fixAllBtn.disabled = true;
    return;
  }

  if (fixAllBtn) fixAllBtn.disabled = false;

  // 摘要
  var summary = document.createElement('div');
  summary.className = 'isolate-result-summary';
  summary.innerHTML = '发现 <strong>' + this.isolatePixels.length + '</strong> 个孤立像素，点击定位，或逐个/批量修复';
  panel.appendChild(summary);

  // 列表（最多显示50个，避免太多）
  var self = this;
  var showCount = Math.min(this.isolatePixels.length, 50);
  for (var i = 0; i < showCount; i++) {
    (function(item, index) {
      var row = document.createElement('div');
      row.className = 'isolate-item';

      var pos = document.createElement('span');
      pos.className = 'isolate-pos';
      pos.textContent = '(' + item.row + ',' + item.col + ')';

      var currentColor = document.createElement('div');
      currentColor.className = 'isolate-color-current';
      var currentEntry = YarnLevel.getColorEntry(item.currentId);
      currentColor.style.backgroundColor = currentEntry ? currentEntry.cssColor : '#ccc';
      currentColor.title = (currentEntry ? currentEntry.name : '颜色') + '(' + item.currentId + ')';

      var arrow = document.createElement('span');
      arrow.className = 'isolate-arrow';
      arrow.textContent = '→';

      var suggestColor = document.createElement('div');
      suggestColor.className = 'isolate-color-suggest';
      var suggestEntry = YarnLevel.getColorEntry(item.suggestId);
      suggestColor.style.backgroundColor = suggestEntry ? suggestEntry.cssColor : '#ccc';
      suggestColor.title = (suggestEntry ? suggestEntry.name : '颜色') + '(' + item.suggestId + ')';

      var actions = document.createElement('div');
      actions.className = 'isolate-actions';

      var locateBtn = document.createElement('button');
      locateBtn.textContent = '定位';
      locateBtn.title = '滚动到该像素位置';
      locateBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        self._locatePixel(item.row, item.col);
      });

      var fixBtn = document.createElement('button');
      fixBtn.className = 'fix-btn';
      fixBtn.textContent = '修复';
      fixBtn.title = '替换为建议颜色';
      fixBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        self._fixIsolatePixel(index);
      });

      actions.appendChild(locateBtn);
      actions.appendChild(fixBtn);

      row.appendChild(pos);
      row.appendChild(currentColor);
      row.appendChild(arrow);
      row.appendChild(suggestColor);
      row.appendChild(actions);

      row.addEventListener('click', function() {
        self._locatePixel(item.row, item.col);
      });

      panel.appendChild(row);
    })(this.isolatePixels[i], i);
  }

  if (this.isolatePixels.length > 50) {
    var more = document.createElement('div');
    more.className = 'isolate-result-summary';
    more.textContent = '... 还有 ' + (this.isolatePixels.length - 50) + ' 个未显示，建议使用"一键修复全部"';
    panel.appendChild(more);
  }
};

// 定位到某个像素位置（滚动+高亮闪烁）
YarnLevel.TargetZoneUI.prototype._locatePixel = function(row, col) {
  var mainContainer = document.getElementById('zoneContentMain');
  if (!mainContainer || !this.gridContainer) return;
  var gapSize = this.cellSize <= 8 ? 0 : (this.cellSize <= 16 ? 1 : 2);
  var cellWithGap = this.cellSize + gapSize;
  var targetX = col * cellWithGap;
  var targetY = row * cellWithGap;
  // 滚动到目标位置居中
  mainContainer.scrollTo({
    left: Math.max(0, targetX - mainContainer.clientWidth / 2 + this.cellSize / 2),
    top: Math.max(0, targetY - mainContainer.clientHeight / 2 + this.cellSize / 2),
    behavior: 'smooth'
  });
  // 闪烁高亮
  var colCount = this.manager.getColCount();
  var index = row * colCount + col;
  var cells = this.gridContainer.children;
  if (index < cells.length) {
    var cell = cells[index];
    cell.style.outline = '3px solid #ff0000';
    cell.style.outlineOffset = '-1px';
    setTimeout(function() {
      cell.style.outline = '';
      cell.style.outlineOffset = '';
    }, 1500);
  }
};

// 修复单个孤立像素
YarnLevel.TargetZoneUI.prototype._fixIsolatePixel = function(index) {
  if (index < 0 || index >= this.isolatePixels.length) return;
  var item = this.isolatePixels[index];
  this._pushUndoSnapshot();
  this.manager.updateCell(item.row, item.col, item.suggestId);
  // 从列表中移除
  this.isolatePixels.splice(index, 1);
  // 重建查找集合
  this._isolateSet = {};
  for (var i = 0; i < this.isolatePixels.length; i++) {
    this._isolateSet[this.isolatePixels[i].row + ',' + this.isolatePixels[i].col] = true;
  }
  this._renderIsolateResults();
  this.render();
  this.onSuccess('已修复 (' + item.row + ',' + item.col + ') 的孤立像素');
};

// 一键修复全部孤立像素
YarnLevel.TargetZoneUI.prototype._fixAllIsolatePixels = function() {
  if (this.isolatePixels.length === 0) return;
  this._pushUndoSnapshot();
  var count = this.isolatePixels.length;
  for (var i = 0; i < this.isolatePixels.length; i++) {
    var item = this.isolatePixels[i];
    this.manager.updateCell(item.row, item.col, item.suggestId);
  }
  this.isolatePixels = [];
  this._isolateSet = {};
  this._renderIsolateResults();
  this.render();
  this.onSuccess('已一键修复 ' + count + ' 个孤立像素');
};
