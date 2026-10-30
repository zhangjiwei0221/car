/**
 * 像素毛线关卡生成工具 - 目标区管理器
 */

var YarnLevel = YarnLevel || {};

// ==================== TargetZoneManager 类 ====================
YarnLevel.TargetZoneManager = function() {
  this._blocks = [];
  this._baseRowCount = 0;
};

YarnLevel.TargetZoneManager.prototype.loadRawData = function(data, defaultColorId) {
  if (!Array.isArray(data)) throw new Error('原始数据必须是二维数组');
  if (data.length === 0) {
    this._blocks = [];
    this._baseRowCount = 0;
    return;
  }

  var validDefaultColorId = (typeof defaultColorId === 'number' && defaultColorId > 0) ? defaultColorId : 0;
  this._blocks = data.map(function(row) {
    if (!Array.isArray(row)) throw new Error('原始数据的每一行必须是数组');
    return row.map(function(colorId) {
      var id = typeof colorId === 'number' ? colorId : 0;
      return (id === 0 && validDefaultColorId > 0) ? validDefaultColorId : id;
    });
  });
  this._baseRowCount = this._blocks.length;
};

YarnLevel.TargetZoneManager.prototype.setBaseRowCount = function(count) {
  if (typeof count !== 'number' || !Number.isInteger(count)) throw new Error('基础行数必须是整数');
  if (count < 0) throw new Error('基础行数不能为负数');
  this._baseRowCount = count;
};

YarnLevel.TargetZoneManager.prototype.getBaseRowCount = function() {
  return this._baseRowCount;
};

YarnLevel.TargetZoneManager.prototype.updateCell = function(row, col, colorId) {
  if (row < 0 || row >= this._blocks.length) return false;
  if (col < 0 || col >= this._blocks[row].length) return false;
  if (typeof colorId !== 'number') return false;
  this._blocks[row][col] = colorId;
  return true;
};

YarnLevel.TargetZoneManager.prototype.getCell = function(row, col) {
  if (row < 0 || row >= this._blocks.length) return null;
  if (col < 0 || col >= this._blocks[row].length) return null;
  return this._blocks[row][col];
};

YarnLevel.TargetZoneManager.prototype.getData = function() {
  return YarnLevel.cloneBlocks(this._blocks);
};

YarnLevel.TargetZoneManager.prototype.getRowCount = function() {
  return this._blocks.length;
};

YarnLevel.TargetZoneManager.prototype.getColCount = function() {
  return this._blocks.length > 0 ? this._blocks[0].length : 0;
};

YarnLevel.TargetZoneManager.prototype.clear = function() {
  this._blocks = [];
  this._baseRowCount = 0;
};

YarnLevel.TargetZoneManager.prototype.isEmpty = function() {
  return this._blocks.length === 0;
};

YarnLevel.TargetZoneManager.prototype.loadFromLevelData = function(levelData) {
  if (!levelData || typeof levelData !== 'object') throw new Error('关卡数据无效');
  this._baseRowCount = levelData.toprow || 0;
  this._blocks = Array.isArray(levelData.blocks) ? YarnLevel.cloneBlocks(levelData.blocks) : [];
};

YarnLevel.TargetZoneManager.prototype.getPixelStats = function() {
  var colorSet = {};
  var pixelCount = 0;
  for (var row = 0; row < this._blocks.length; row++) {
    for (var col = 0; col < this._blocks[row].length; col++) {
      var colorId = this._blocks[row][col];
      if (colorId > 0) {
        colorSet[colorId] = true;
        pixelCount++;
      }
    }
  }
  return {
    colorTypeCount: Object.keys(colorSet).length,
    pixelCount: pixelCount
  };
};

