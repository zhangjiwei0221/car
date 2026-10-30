/**
 * 像素毛线关卡生成工具 - 地形管理器和状态
 */

var YarnLevel = YarnLevel || {};

// ==================== TerrainZoneManager 类 ====================
YarnLevel.TerrainZoneManager = function() {
  this._terrain = [];
  this._rows = 0;
  this._cols = 0;
};

YarnLevel.TerrainZoneManager.prototype.generateGrid = function(rows, cols) {
  if (typeof rows !== 'number' || !Number.isInteger(rows)) throw new Error('行数必须是整数');
  if (typeof cols !== 'number' || !Number.isInteger(cols)) throw new Error('列数必须是整数');
  if (rows <= 0) throw new Error('行数必须为正整数');
  if (cols <= 0) throw new Error('列数必须为正整数');
  this._rows = rows;
  this._cols = cols;
  this._terrain = [];
  for (var i = 0; i < rows; i++) {
    var row = [];
    for (var j = 0; j < cols; j++) row.push(0);
    this._terrain.push(row);
  }
};

YarnLevel.TerrainZoneManager.prototype.toggleCell = function(row, col) {
  if (row < 0 || row >= this._rows) return false;
  if (col < 0 || col >= this._cols) return false;
  this._terrain[row][col] = this._terrain[row][col] === 0 ? 1 : 0;
  return true;
};

YarnLevel.TerrainZoneManager.prototype.loadTerrain = function(data) {
  if (!Array.isArray(data)) throw new Error('地形数据必须是二维数组');
  if (data.length === 0) { this._terrain = []; this._rows = 0; this._cols = 0; return; }
  for (var i = 0; i < data.length; i++) {
    if (!Array.isArray(data[i])) throw new Error('地形数据的每一行必须是数组');
  }
  this._terrain = data.map(function(row) {
    return row.map(function(value) { return value === 0 ? 0 : 1; });
  });
  this._rows = data.length;
  this._cols = data.length > 0 ? data[0].length : 0;
};

YarnLevel.TerrainZoneManager.prototype.getData = function() { return YarnLevel.cloneTerrain(this._terrain); };
YarnLevel.TerrainZoneManager.prototype.getCell = function(row, col) {
  if (row < 0 || row >= this._rows) return null;
  if (col < 0 || col >= this._cols) return null;
  return this._terrain[row][col];
};
YarnLevel.TerrainZoneManager.prototype.getRowCount = function() { return this._rows; };
YarnLevel.TerrainZoneManager.prototype.getColCount = function() { return this._cols; };
YarnLevel.TerrainZoneManager.prototype.clear = function() { this._terrain = []; this._rows = 0; this._cols = 0; };
YarnLevel.TerrainZoneManager.prototype.isEmpty = function() { return this._terrain.length === 0; };

// ==================== LevelState 类 ====================
YarnLevel.LevelState = function() {
  this._toprow = 0;
  this._blocks = [];
  this._maprow = 0;
  this._mapcol = 0;
  this._spools = [];
};

YarnLevel.LevelState.prototype.getToprow = function() { return this._toprow; };
YarnLevel.LevelState.prototype.setToprow = function(toprow) { this._toprow = toprow; };
YarnLevel.LevelState.prototype.getBlocks = function() { return YarnLevel.cloneBlocks(this._blocks); };
YarnLevel.LevelState.prototype.setBlocks = function(blocks) { this._blocks = YarnLevel.cloneBlocks(blocks); };
YarnLevel.LevelState.prototype.getMaprow = function() { return this._maprow; };
YarnLevel.LevelState.prototype.setMaprow = function(maprow) { this._maprow = maprow; };
YarnLevel.LevelState.prototype.getMapcol = function() { return this._mapcol; };
YarnLevel.LevelState.prototype.setMapcol = function(mapcol) { this._mapcol = mapcol; };
YarnLevel.LevelState.prototype.getSpools = function() { return YarnLevel.cloneSpools(this._spools); };
YarnLevel.LevelState.prototype.setSpools = function(spools) { this._spools = YarnLevel.cloneSpools(spools); };

YarnLevel.LevelState.prototype.loadFromLevelData = function(levelData) {
  this._toprow = levelData.toprow;
  this._blocks = YarnLevel.cloneBlocks(levelData.blocks);
  this._maprow = levelData.maprow;
  this._mapcol = levelData.mapcol;
  this._spools = YarnLevel.cloneSpools(levelData.spools);
};

YarnLevel.LevelState.prototype.exportToLevelData = function() {
  return {
    toprow: this._toprow,
    blocks: YarnLevel.cloneBlocks(this._blocks),
    maprow: this._maprow,
    mapcol: this._mapcol,
    spools: YarnLevel.cloneSpools(this._spools)
  };
};

YarnLevel.LevelState.prototype.clear = function() {
  this._toprow = 0; this._blocks = []; this._maprow = 0; this._mapcol = 0; this._spools = [];
};

// ==================== TerrainState 类 ====================
YarnLevel.TerrainState = function() {
  this._terrain = [];
  this._rows = 0;
  this._cols = 0;
};

YarnLevel.TerrainState.prototype.getRows = function() { return this._rows; };
YarnLevel.TerrainState.prototype.getCols = function() { return this._cols; };
YarnLevel.TerrainState.prototype.getTerrain = function() { return YarnLevel.cloneTerrain(this._terrain); };
YarnLevel.TerrainState.prototype.setTerrain = function(terrain) {
  this._terrain = YarnLevel.cloneTerrain(terrain);
  this._rows = terrain.length;
  this._cols = terrain.length > 0 ? terrain[0].length : 0;
};

YarnLevel.TerrainState.prototype.getCell = function(row, col) {
  if (row < 0 || row >= this._rows) return null;
  if (col < 0 || col >= this._cols) return null;
  return this._terrain[row][col];
};

YarnLevel.TerrainState.prototype.toggleCell = function(row, col) {
  if (row < 0 || row >= this._rows) return false;
  if (col < 0 || col >= this._cols) return false;
  this._terrain[row][col] = this._terrain[row][col] === 0 ? 1 : 0;
  return true;
};

YarnLevel.TerrainState.prototype.init = function(rows, cols) {
  this._rows = rows;
  this._cols = cols;
  this._terrain = [];
  for (var i = 0; i < rows; i++) {
    var row = [];
    for (var j = 0; j < cols; j++) row.push(0);
    this._terrain.push(row);
  }
};

YarnLevel.TerrainState.prototype.loadFromTerrainData = function(terrainData) {
  this._terrain = YarnLevel.cloneTerrain(terrainData);
  this._rows = terrainData.length;
  this._cols = terrainData.length > 0 ? terrainData[0].length : 0;
};

YarnLevel.TerrainState.prototype.clear = function() { this._terrain = []; this._rows = 0; this._cols = 0; };
