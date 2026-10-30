/**
 * 毛线关卡生成工具 - 地形区UI和工具栏
 */

var YarnLevel = YarnLevel || {};

// ==================== TerrainZoneUI 类 ====================
YarnLevel.TerrainZoneUI = function(options) {
  options = options || {};
  this.manager = options.manager || null;
  this.onError = options.onError || function(msg) { console.error(msg); };
  this.onSuccess = options.onSuccess || function(msg) { console.log(msg); };
  this.gridContainer = null;
  this.rowsInput = null;
  this.colsInput = null;
  this.terrainFileInput = null;
};

YarnLevel.TerrainZoneUI.prototype.init = function() {
  this.gridContainer = document.getElementById('terrainGrid');
  this.rowsInput = document.getElementById('terrainRows');
  this.colsInput = document.getElementById('terrainCols');
  this.terrainFileInput = document.getElementById('terrainDataFileInput');
  this._bindEvents();
};

YarnLevel.TerrainZoneUI.prototype._bindEvents = function() {
  var self = this;
  var generateTerrainBtn = document.getElementById('generateTerrainBtn');
  if (generateTerrainBtn) {
    generateTerrainBtn.addEventListener('click', function() { self._handleGenerateTerrain(); });
  }
  var loadTerrainDataBtn = document.getElementById('loadTerrainDataBtn');
  if (loadTerrainDataBtn && this.terrainFileInput) {
    loadTerrainDataBtn.addEventListener('click', function() { self.terrainFileInput.click(); });
    this.terrainFileInput.addEventListener('change', function(e) { self._handleTerrainFileSelect(e); });
  }
  var saveTerrainBtn = document.getElementById('saveTerrainBtn');
  if (saveTerrainBtn) {
    saveTerrainBtn.addEventListener('click', function() { self._handleSaveTerrain(); });
  }
};

YarnLevel.TerrainZoneUI.prototype._handleGenerateTerrain = function() {
  if (!this.manager) { this.onError('地形区管理器未初始化'); return; }
  var rows = parseInt(this.rowsInput ? this.rowsInput.value : '9', 10);
  var cols = parseInt(this.colsInput ? this.colsInput.value : '9', 10);
  if (isNaN(rows) || rows <= 0) { this.onError('行数必须为正整数'); return; }
  if (isNaN(cols) || cols <= 0) { this.onError('列数必须为正整数'); return; }
  try {
    this.manager.generateGrid(rows, cols);
    this.render();
    this.onSuccess('地形表格生成成功');
  } catch (err) { this.onError(err.message || '生成地形表格失败'); }
};

YarnLevel.TerrainZoneUI.prototype._handleTerrainFileSelect = function(event) {
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
        self.updateRowColInputs(self.manager.getRowCount(), self.manager.getColCount());
        self.render();
        self.onSuccess('地形文件加载成功');
      } catch (err) { self.onError(err.message || '加载地形数据失败'); }
    }
  };
  reader.onerror = function() { self.onError('读取文件失败'); };
  reader.readAsText(file);
  event.target.value = '';
};

YarnLevel.TerrainZoneUI.prototype._handleSaveTerrain = function() {
  if (!this.manager) { this.onError('地形区管理器未初始化'); return; }
  if (this.manager.isEmpty()) { this.onError('没有地形数据可保存'); return; }
  try {
    var terrainData = this.manager.getData();
    var jsonContent = YarnLevel.serializeTerrainJSON(terrainData);
    var blob = new Blob([jsonContent], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'terrain.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    this.onSuccess('地形文件保存成功');
  } catch (err) { this.onError(err.message || '保存地形文件失败'); }
};

YarnLevel.TerrainZoneUI.prototype.render = function() {
  if (!this.gridContainer) { console.error('地形区网格容器未找到'); return; }
  this.gridContainer.innerHTML = '';
  if (!this.manager || this.manager.isEmpty()) {
    this.gridContainer.innerHTML = '<div class="empty-state">请生成地形表格或加载地形文件</div>';
    return;
  }
  var data = this.manager.getData();
  var rowCount = data.length;
  var colCount = data[0] ? data[0].length : 0;
  if (rowCount === 0 || colCount === 0) return;
  this.gridContainer.style.gridTemplateColumns = 'repeat(' + colCount + ', var(--cell-size))';
  this.gridContainer.style.gridTemplateRows = 'repeat(' + rowCount + ', var(--cell-size))';
  for (var row = 0; row < rowCount; row++) {
    for (var col = 0; col < colCount; col++) {
      var value = data[row][col];
      var cell = this._createCell(row, col, value);
      this.gridContainer.appendChild(cell);
    }
  }
};

YarnLevel.TerrainZoneUI.prototype._createCell = function(row, col, value) {
  var self = this;
  var cell = document.createElement('div');
  cell.className = 'grid-cell terrain-cell';
  cell.dataset.row = row;
  cell.dataset.col = col;
  if (value === 1) cell.classList.add('terrain-blocked');
  else cell.classList.add('terrain-passable');
  cell.addEventListener('click', function() { self._handleCellClick(row, col); });
  return cell;
};

YarnLevel.TerrainZoneUI.prototype._handleCellClick = function(row, col) {
  if (!this.manager) return;
  var success = this.manager.toggleCell(row, col);
  if (success) this.render();
};

YarnLevel.TerrainZoneUI.prototype.setManager = function(manager) { this.manager = manager; };
YarnLevel.TerrainZoneUI.prototype.updateRowColInputs = function(rows, cols) {
  if (this.rowsInput) this.rowsInput.value = rows;
  if (this.colsInput) this.colsInput.value = cols;
};
YarnLevel.TerrainZoneUI.prototype.refresh = function() {
  if (this.manager) this.updateRowColInputs(this.manager.getRowCount(), this.manager.getColCount());
  this.render();
};
YarnLevel.TerrainZoneUI.prototype.clear = function() {
  if (this.gridContainer) this.gridContainer.innerHTML = '';
  if (this.rowsInput) this.rowsInput.value = '9';
  if (this.colsInput) this.colsInput.value = '9';
};

// ==================== Toolbar 类 ====================
YarnLevel.Toolbar = function(options) {
  options = options || {};
  this.levelState = options.levelState || null;
  this.targetZoneManager = options.targetZoneManager || null;
  this.elementZoneManager = options.elementZoneManager || null;
  this.targetZoneUI = options.targetZoneUI || null;
  this.elementZoneUI = options.elementZoneUI || null;
  this.onError = options.onError || function(msg) { console.error(msg); };
  this.onSuccess = options.onSuccess || function(msg) { console.log(msg); };
  this.loadLevelBtn = null;
  this.saveLevelBtn = null;
  this.levelFileInput = null;
};

YarnLevel.Toolbar.prototype.init = function() {
  this.loadLevelBtn = document.getElementById('loadLevelBtn');
  this.saveLevelBtn = document.getElementById('saveLevelBtn');
  this.levelFileInput = document.getElementById('levelFileInput');
  this._bindEvents();
};

YarnLevel.Toolbar.prototype._bindEvents = function() {
  var self = this;
  if (this.loadLevelBtn && this.levelFileInput) {
    this.loadLevelBtn.addEventListener('click', function() { self.levelFileInput.click(); });
    this.levelFileInput.addEventListener('change', function(e) { self._handleLevelFileSelect(e); });
  }
  if (this.saveLevelBtn) {
    this.saveLevelBtn.addEventListener('click', function() { self._handleSaveLevel(); });
  }
};

YarnLevel.Toolbar.prototype._handleLevelFileSelect = function(event) {
  var self = this;
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var content = e.target.result;
    var result = YarnLevel.parseLevelJSON(content);
    if (YarnLevel.isParseError(result)) {
      self.onError(result.message || '加载关卡文件失败');
      return;
    }
    try {
      if (self.levelState) self.levelState.loadFromLevelData(result);
      if (self.targetZoneManager) self.targetZoneManager.loadFromLevelData(result);
      if (self.elementZoneManager) self.elementZoneManager.loadFromLevelData(result);
      if (self.targetZoneUI) self.targetZoneUI.refresh();
      if (self.elementZoneUI) self.elementZoneUI.refresh();
      self.onSuccess('关卡文件加载成功');
    } catch (err) { self.onError(err.message || '加载关卡数据失败'); }
  };
  reader.onerror = function() { self.onError('读取文件失败'); };
  reader.readAsText(file);
  event.target.value = '';
};

YarnLevel.Toolbar.prototype._buildLevelData = function() {
  var toprow = this.targetZoneManager ? this.targetZoneManager.getBaseRowCount() : 0;
  var blocks = this.targetZoneManager ? this.targetZoneManager.getData() : [];
  var maprow = this.elementZoneManager ? this.elementZoneManager.getRowCount() : 0;
  var mapcol = this.elementZoneManager ? this.elementZoneManager.getColCount() : 0;
  var spools = this.elementZoneManager ? this.elementZoneManager.getData() : [];
  return { toprow: toprow, blocks: blocks, maprow: maprow, mapcol: mapcol, spools: spools };
};

YarnLevel.Toolbar.prototype._handleSaveLevel = function() {
  var hasTargetData = this.targetZoneManager && !this.targetZoneManager.isEmpty();
  var hasElementData = this.elementZoneManager && !this.elementZoneManager.isEmpty();
  if (!hasTargetData && !hasElementData) { this.onError('没有关卡数据可保存'); return; }
  try {
    var levelData = this._buildLevelData();
    var txtContent = YarnLevel.serializeLevelTXT(levelData);
    var blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'level.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    this.onSuccess('关卡文件保存成功');
  } catch (err) { this.onError(err.message || '保存关卡文件失败'); }
};

YarnLevel.Toolbar.prototype.setLevelState = function(levelState) { this.levelState = levelState; };
YarnLevel.Toolbar.prototype.setTargetZoneManager = function(manager) { this.targetZoneManager = manager; };
YarnLevel.Toolbar.prototype.setElementZoneManager = function(manager) { this.elementZoneManager = manager; };
YarnLevel.Toolbar.prototype.setTargetZoneUI = function(ui) { this.targetZoneUI = ui; };
YarnLevel.Toolbar.prototype.setElementZoneUI = function(ui) { this.elementZoneUI = ui; };
