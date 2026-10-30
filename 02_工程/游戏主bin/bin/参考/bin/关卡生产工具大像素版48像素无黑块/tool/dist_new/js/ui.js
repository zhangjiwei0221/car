/**
 * 像素毛线关卡生成工具 - 目标区UI组件
 */

var YarnLevel = YarnLevel || {};

// ==================== TargetZoneUI 类 ====================
YarnLevel.TargetZoneUI = function(options) {
  options = options || {};
  this.manager = options.manager || null;
  this.onError = options.onError || function(msg) { console.error(msg); };
  this.onSuccess = options.onSuccess || function(msg) { console.log(msg); };
  this.selectedColorId = 0;
  this.cellSize = 10;
  this.gridContainer = null;
  this.baseRowCountInput = null;
  this.defaultColorIdInput = null;
  this.tiledFileInput = null;
  this.txtFileInput = null;
  this.colorPalette = null;
  this.zoomSlider = null;
  this.colorCountSpan = null;
  this.pixelCountSpan = null;
};

YarnLevel.TargetZoneUI.prototype.init = function() {
  this.gridContainer = document.getElementById('targetGrid');
  this.baseRowCountInput = document.getElementById('baseRowCount');
  this.defaultColorIdInput = document.getElementById('defaultColorId');
  this.tiledFileInput = document.getElementById('tiledFileInput');
  this.txtFileInput = document.getElementById('txtFileInput');
  this.colorPalette = document.getElementById('targetColorPalette');
  this.zoomSlider = document.getElementById('targetZoom');
  this.colorCountSpan = document.getElementById('targetColorCount');
  this.pixelCountSpan = document.getElementById('targetGroupCount');
  this._initColorPalette();
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
  var swatches = this.colorPalette ? this.colorPalette.querySelectorAll('.color-swatch') : [];
  for (var i = 0; i < swatches.length; i++) {
    swatches[i].classList.remove('selected');
    if (parseInt(swatches[i].textContent, 10) === colorId) swatches[i].classList.add('selected');
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

YarnLevel.TargetZoneUI.prototype._getDefaultColorId = function() {
  var value = parseInt(this.defaultColorIdInput ? this.defaultColorIdInput.value : '0', 10);
  return isNaN(value) ? 0 : value;
};

YarnLevel.TargetZoneUI.prototype._loadRawGrid = function(grid, successMessage) {
  if (!this.manager) return;
  try {
    var clippedGrid = this._removeEmptyRowsAndCols(grid);
    this.manager.loadRawData(clippedGrid, this._getDefaultColorId());
    if (this.baseRowCountInput) this.baseRowCountInput.value = this.manager.getBaseRowCount();
    this.render();
    this.onSuccess(successMessage);
  } catch (err) {
    this.onError(err.message || '加载数据失败');
  }
};

YarnLevel.TargetZoneUI.prototype._handleTiledFileSelect = function(event) {
  var self = this;
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var result = YarnLevel.parseTiledJSON(e.target.result);
    if (YarnLevel.isParseError(result)) {
      self.onError(result.message || '导入Tiled文件失败');
      return;
    }
    self._loadRawGrid(result.grid, 'Tiled文件导入成功');
  };
  reader.onerror = function() { self.onError('读取文件失败'); };
  reader.readAsText(file);
  event.target.value = '';
};

/**
 * 删除二维数组中原始值为0或非正数的全空行列。
 */
YarnLevel.TargetZoneUI.prototype._removeEmptyRowsAndCols = function(grid) {
  if (!Array.isArray(grid) || grid.length === 0) return [];

  var normalized = [];
  var maxColCount = 0;
  for (var r = 0; r < grid.length; r++) {
    var sourceRow = Array.isArray(grid[r]) ? grid[r] : [];
    var row = [];
    for (var c = 0; c < sourceRow.length; c++) {
      var value = typeof sourceRow[c] === 'number' && !isNaN(sourceRow[c]) ? sourceRow[c] : 0;
      row.push(value);
    }
    if (row.length > maxColCount) maxColCount = row.length;
    normalized.push(row);
  }
  for (var nr = 0; nr < normalized.length; nr++) {
    while (normalized[nr].length < maxColCount) normalized[nr].push(0);
  }

  var filteredRows = [];
  for (var rowIndex = 0; rowIndex < normalized.length; rowIndex++) {
    var allEmptyRow = true;
    for (var colIndex = 0; colIndex < normalized[rowIndex].length; colIndex++) {
      if (normalized[rowIndex][colIndex] > 0) {
        allEmptyRow = false;
        break;
      }
    }
    if (!allEmptyRow) filteredRows.push(normalized[rowIndex]);
  }
  if (filteredRows.length === 0) return [];

  var emptyCols = {};
  for (var col = 0; col < maxColCount; col++) {
    var allEmptyCol = true;
    for (var row = 0; row < filteredRows.length; row++) {
      if (filteredRows[row][col] > 0) {
        allEmptyCol = false;
        break;
      }
    }
    if (allEmptyCol) emptyCols[col] = true;
  }

  var result = [];
  for (var rr = 0; rr < filteredRows.length; rr++) {
    var newRow = [];
    for (var cc = 0; cc < filteredRows[rr].length; cc++) {
      if (!emptyCols[cc]) newRow.push(filteredRows[rr][cc]);
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
    var result = YarnLevel.parseTXT(e.target.result);
    if (YarnLevel.isParseError(result)) {
      self.onError(result.message || '导入TXT文件失败');
      return;
    }
    self._loadRawGrid(result, 'TXT文件导入成功');
  };
  reader.onerror = function() { self.onError('读取文件失败'); };
  reader.readAsText(file);
  event.target.value = '';
};

YarnLevel.TargetZoneUI.prototype._handleBaseRowCountChange = function(event) {
  var value = parseInt(event.target.value, 10);
  if (isNaN(value) || value < 0) {
    this.onError('基础行数必须是非负整数');
    return;
  }
  if (this.manager) {
    try {
      this.manager.setBaseRowCount(value);
    } catch (err) {
      this.onError(err.message);
    }
  }
};

YarnLevel.TargetZoneUI.prototype.render = function() {
  if (!this.gridContainer) {
    console.error('目标区网格容器未找到');
    return;
  }
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
  for (var row = 0; row < rowCount; row++) {
    for (var col = 0; col < colCount; col++) {
      var cell = this._createCell(row, col, data[row][col]);
      cell.style.width = cellSizePx;
      cell.style.height = cellSizePx;
      this.gridContainer.appendChild(cell);
    }
  }
};

YarnLevel.TargetZoneUI.prototype._updateStats = function() {
  if (!this.manager || this.manager.isEmpty()) {
    if (this.colorCountSpan) this.colorCountSpan.textContent = '0';
    if (this.pixelCountSpan) this.pixelCountSpan.textContent = '0';
    return;
  }
  var stats = this.manager.getPixelStats();
  if (this.colorCountSpan) this.colorCountSpan.textContent = stats.colorTypeCount;
  if (this.pixelCountSpan) this.pixelCountSpan.textContent = stats.pixelCount;
};

YarnLevel.TargetZoneUI.prototype._createCell = function(row, col, colorId) {
  var self = this;
  var cell = document.createElement('div');
  cell.className = 'grid-cell';
  cell.dataset.row = row;
  cell.dataset.col = col;
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
    var fallbackSpan = document.createElement('span');
    fallbackSpan.className = 'color-id';
    fallbackSpan.textContent = colorId;
    cell.appendChild(fallbackSpan);
  }
  cell.addEventListener('click', function() { self._handleCellClick(row, col); });
  return cell;
};

YarnLevel.TargetZoneUI.prototype._handleCellClick = function(row, col) {
  if (!this.manager) return;
  var success = this.manager.updateCell(row, col, this.selectedColorId);
  if (success) this.render();
};

YarnLevel.TargetZoneUI.prototype.setManager = function(manager) { this.manager = manager; };
YarnLevel.TargetZoneUI.prototype.updateBaseRowCountInput = function(value) {
  if (this.baseRowCountInput) this.baseRowCountInput.value = value;
};
YarnLevel.TargetZoneUI.prototype.refresh = function() {
  if (this.manager) this.updateBaseRowCountInput(this.manager.getBaseRowCount());
  this.render();
};
YarnLevel.TargetZoneUI.prototype.clear = function() {
  if (this.gridContainer) this.gridContainer.innerHTML = '';
  if (this.baseRowCountInput) this.baseRowCountInput.value = '1';
  if (this.defaultColorIdInput) this.defaultColorIdInput.value = '0';
  this._updateStats();
};
