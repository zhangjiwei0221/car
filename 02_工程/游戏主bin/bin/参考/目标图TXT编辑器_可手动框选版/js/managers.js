/**
 * 目标图 TXT 编辑器 - 管理器模块
 */

var YarnLevel = YarnLevel || {};

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
      if (id === 0 && validDefaultColorId > 0) id = validDefaultColorId;
      return YarnLevel.createTargetBlock(id, 0);
    });
  });
  this._baseRowCount = data.length;
};

YarnLevel.TargetZoneManager.prototype.createEmptyGrid = function(width, height, fillValue) {
  if (!Number.isInteger(width) || width <= 0) throw new Error('TXT宽度必须为正整数');
  if (!Number.isInteger(height) || height <= 0) throw new Error('TXT高度必须为正整数');
  if (!Number.isInteger(fillValue) || fillValue < 0) throw new Error('填充值必须是非负整数');
  var rows = [];
  for (var r = 0; r < height; r++) {
    var row = [];
    for (var c = 0; c < width; c++) row.push(fillValue);
    rows.push(row);
  }
  this.loadRawData(rows, 0);
};

YarnLevel.TargetZoneManager.prototype.setBaseRowCount = function(count) {
  if (typeof count !== 'number' || !Number.isInteger(count)) throw new Error('基础行数必须是整数');
  if (count < 0) throw new Error('基础行数不能为负数');
  this._baseRowCount = count;
};

YarnLevel.TargetZoneManager.prototype.getBaseRowCount = function() { return this._baseRowCount; };

YarnLevel.TargetZoneManager.prototype.updateCell = function(row, col, colorId) {
  if (row < 0 || row >= this._blocks.length) return false;
  if (col < 0 || col >= this._blocks[row].length) return false;
  if (typeof colorId !== 'number') return false;
  this._blocks[row][col].id = colorId;
  return true;
};

YarnLevel.TargetZoneManager.prototype.updateCellType = function(row, col, type) {
  if (row < 0 || row >= this._blocks.length) return false;
  if (col < 0 || col >= this._blocks[row].length) return false;
  if (typeof type !== 'number') return false;
  this._blocks[row][col].type = type;
  return true;
};

YarnLevel.TargetZoneManager.prototype.fillEmptyCells = function(colorId) {
  if (typeof colorId !== 'number' || colorId <= 0) throw new Error('背景填充颜色编号必须大于0');
  var count = 0;
  for (var r = 0; r < this._blocks.length; r++) {
    for (var c = 0; c < this._blocks[r].length; c++) {
      if (this._blocks[r][c].id === 0) {
        this._blocks[r][c].id = colorId;
        count++;
      }
    }
  }
  return count;
};

YarnLevel.TargetZoneManager.prototype.getCell = function(row, col) {
  if (row < 0 || row >= this._blocks.length) return null;
  if (col < 0 || col >= this._blocks[row].length) return null;
  return YarnLevel.cloneTargetBlock(this._blocks[row][col]);
};

YarnLevel.TargetZoneManager.prototype.getData = function() { return YarnLevel.cloneBlocks(this._blocks); };
YarnLevel.TargetZoneManager.prototype.setData = function(blocks) { this._blocks = YarnLevel.cloneBlocks(blocks || []); };
YarnLevel.TargetZoneManager.prototype.getRowCount = function() { return this._blocks.length; };
YarnLevel.TargetZoneManager.prototype.getColCount = function() { return this._blocks.length > 0 ? this._blocks[0].length : 0; };
YarnLevel.TargetZoneManager.prototype.clear = function() { this._blocks = []; this._baseRowCount = 0; };
YarnLevel.TargetZoneManager.prototype.isEmpty = function() { return this._blocks.length === 0; };

YarnLevel.TargetZoneManager.prototype.getUsedColors = function() {
  var colorMap = {};
  for (var r = 0; r < this._blocks.length; r++) {
    for (var c = 0; c < this._blocks[r].length; c++) {
      var id = this._blocks[r][c].id;
      if (id > 0) colorMap[id] = (colorMap[id] || 0) + 1;
    }
  }
  return colorMap;
};

YarnLevel.TargetZoneManager.prototype.replaceColor = function(oldId, newId) {
  var count = 0;
  for (var r = 0; r < this._blocks.length; r++) {
    for (var c = 0; c < this._blocks[r].length; c++) {
      if (this._blocks[r][c].id === oldId) {
        this._blocks[r][c].id = newId;
        count++;
      }
    }
  }
  return count;
};
