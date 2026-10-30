/**
 * 毛线关卡生成工具 - 管理器模块
 */

var YarnLevel = YarnLevel || {};

// ==================== TargetZoneManager 类 ====================
YarnLevel.TargetZoneManager = function() {
  this._blocks = [];
  this._baseRowCount = 0;
};

YarnLevel.TargetZoneManager.prototype.loadRawData = function(data, defaultColorId) {
  if (!Array.isArray(data)) {
    throw new Error('原始数据必须是二维数组');
  }
  if (data.length === 0) {
    this._blocks = [];
    this._baseRowCount = 0;
    return;
  }
  // 确保defaultColorId是有效数字
  var validDefaultColorId = (typeof defaultColorId === 'number' && defaultColorId > 0) ? defaultColorId : 0;
  var self = this;
  this._blocks = data.map(function(row) {
    if (!Array.isArray(row)) {
      throw new Error('原始数据的每一行必须是数组');
    }
    return row.map(function(colorId) {
      var id = typeof colorId === 'number' ? colorId : 0;
      // 如果颜色ID为0且设置了默认颜色，使用默认颜色替换
      if (id === 0 && validDefaultColorId > 0) {
        id = validDefaultColorId;
      }
      return YarnLevel.createTargetBlock(id, 0);
    });
  });
  this._baseRowCount = data.length;
};

YarnLevel.TargetZoneManager.prototype.setBaseRowCount = function(count) {
  if (typeof count !== 'number' || !Number.isInteger(count)) {
    throw new Error('基础行数必须是整数');
  }
  if (count < 0) {
    throw new Error('基础行数不能为负数');
  }
  this._baseRowCount = count;
};

YarnLevel.TargetZoneManager.prototype.getBaseRowCount = function() {
  return this._baseRowCount;
};

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

YarnLevel.TargetZoneManager.prototype.getCell = function(row, col) {
  if (row < 0 || row >= this._blocks.length) return null;
  if (col < 0 || col >= this._blocks[row].length) return null;
  return YarnLevel.cloneTargetBlock(this._blocks[row][col]);
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
  if (!levelData || typeof levelData !== 'object') {
    throw new Error('关卡数据无效');
  }
  this._baseRowCount = levelData.toprow || 0;
  if (Array.isArray(levelData.blocks)) {
    this._blocks = YarnLevel.cloneBlocks(levelData.blocks);
  } else {
    this._blocks = [];
  }
};

YarnLevel.TargetZoneManager.prototype.getColorGroupStats = function() {
  var result = { totalGroups: 0, supplementGroups: 0, rowStats: [] };
  if (this._blocks.length === 0) return result;
  var colorAccumulator = {};
  for (var rowIndex = this._blocks.length - 1; rowIndex >= 0; rowIndex--) {
    var row = this._blocks[rowIndex];
    var isBaseRow = rowIndex >= this._blocks.length - this._baseRowCount;
    var colorSequence = [];
    var rowGroupCount = 0;
    for (var colIndex = 0; colIndex < row.length; colIndex++) {
      var block = row[colIndex];
      var colorId = block.id;
      if (colorId > 0) {
        colorSequence.push(colorId);
        var currentCount = (colorAccumulator[colorId] || 0) + 1;
        if (currentCount === 3) {
          rowGroupCount++;
          result.totalGroups++;
          if (!isBaseRow) result.supplementGroups++;
          colorAccumulator[colorId] = 0;
        } else {
          colorAccumulator[colorId] = currentCount;
        }
      }
    }
    result.rowStats.push({ rowIndex: rowIndex, groupCount: rowGroupCount, colorSequence: colorSequence, isBaseRow: isBaseRow });
  }
  return result;
};

YarnLevel.TargetZoneManager.prototype._clearSupplementRows = function() {
  if (this._blocks.length > this._baseRowCount) {
    this._blocks = this._blocks.slice(this._blocks.length - this._baseRowCount);
  }
};

YarnLevel.TargetZoneManager.prototype._getIncompleteColorCounts = function() {
  var colorCounts = {};
  var startRow = Math.max(0, this._blocks.length - this._baseRowCount);
  for (var rowIndex = startRow; rowIndex < this._blocks.length; rowIndex++) {
    var row = this._blocks[rowIndex];
    for (var i = 0; i < row.length; i++) {
      var block = row[i];
      if (block.id > 0) {
        colorCounts[block.id] = (colorCounts[block.id] || 0) + 1;
      }
    }
  }
  var incompleteColors = {};
  for (var colorId in colorCounts) {
    var count = colorCounts[colorId];
    var remainder = count % 3;
    if (remainder !== 0) incompleteColors[colorId] = remainder;
  }
  return incompleteColors;
};

YarnLevel.TargetZoneManager.prototype._selectRandomColors = function(colorSequence, count) {
  var uniqueColors = [];
  var seen = {};
  for (var i = 0; i < colorSequence.length; i++) {
    if (!seen[colorSequence[i]]) {
      seen[colorSequence[i]] = true;
      uniqueColors.push(colorSequence[i]);
    }
  }
  if (uniqueColors.length <= count) return uniqueColors;
  var selected = [];
  var available = uniqueColors.slice();
  for (var i = 0; i < count && available.length > 0; i++) {
    var randomIndex = Math.floor(Math.random() * available.length);
    selected.push(available[randomIndex]);
    available.splice(randomIndex, 1);
  }
  return selected;
};

YarnLevel.TargetZoneManager.prototype._selectRandomIndices = function(total, count) {
  var indices = {};
  if (count >= total) {
    for (var i = 0; i < total; i++) indices[i] = true;
    return indices;
  }
  var size = 0;
  while (size < count) {
    var randomIndex = Math.floor(Math.random() * total);
    if (!indices[randomIndex]) {
      indices[randomIndex] = true;
      size++;
    }
  }
  return indices;
};

YarnLevel.TargetZoneManager.prototype._placeSupplementRows = function(supplementBlocks, colCount) {
  var rowCount = Math.ceil(supplementBlocks.length / colCount);
  var newRows = [];
  var blockIndex = 0;
  for (var row = 0; row < rowCount; row++) {
    var newRow = [];
    for (var col = 0; col < colCount; col++) {
      if (blockIndex < supplementBlocks.length) {
        newRow.push(supplementBlocks[blockIndex]);
        blockIndex++;
      } else {
        newRow.push(YarnLevel.createTargetBlock(0, 0));
      }
    }
    newRows.unshift(newRow);  // 使用unshift使最后填充的行在最上方（数组第一行）
  }
  this._blocks = newRows.concat(this._blocks);
};

YarnLevel.TargetZoneManager.prototype.generateSupplementColors = function(params) {
  params = params || {};
  var extraColorTypes = params.extraColorTypes || 0;
  var extraColorGroups = params.extraColorGroups || 0;
  var colorSequence = params.colorSequence || [];
  var questionCount = params.questionCount || 0;

  if (!Number.isInteger(extraColorTypes) || extraColorTypes < 0) throw new Error('额外补充颜色种类数必须是非负整数');
  if (!Number.isInteger(extraColorGroups) || extraColorGroups < 0) throw new Error('额外补充颜色组数必须是非负整数');
  if (!Array.isArray(colorSequence)) throw new Error('颜色序列必须是数组');
  if (!Number.isInteger(questionCount) || questionCount < 0) throw new Error('问号颜色个数必须是非负整数');

  this._clearSupplementRows();
  if (this._blocks.length === 0 || this._baseRowCount === 0) return;
  var colCount = this.getColCount();
  if (colCount === 0) return;

  var validColorSequence = colorSequence.filter(function(id) { return YarnLevel.isValidColorId(id); });
  var supplementColors = [];
  
  // 补充不完整的颜色（凑成3的倍数）
  var incompleteColors = this._getIncompleteColorCounts();
  for (var colorId in incompleteColors) {
    var count = incompleteColors[colorId];
    var supplementCount = 3 - count;
    for (var i = 0; i < supplementCount; i++) {
      supplementColors.push(parseInt(colorId, 10));
    }
  }

  // 额外补充颜色：从颜色序列中随机选extraColorTypes种颜色，总共补充extraColorGroups组
  if (extraColorTypes > 0 && extraColorGroups > 0 && validColorSequence.length > 0) {
    var selectedColors = this._selectRandomColors(validColorSequence, extraColorTypes);
    // 将extraColorGroups组分配给选中的颜色，每组随机选一种
    for (var group = 0; group < extraColorGroups; group++) {
      var randomIndex = Math.floor(Math.random() * selectedColors.length);
      var cid = selectedColors[randomIndex];
      for (var j = 0; j < 3; j++) supplementColors.push(cid);
    }
  }

  if (supplementColors.length === 0) return;

  var questionIndices = this._selectRandomIndices(supplementColors.length, Math.min(questionCount, supplementColors.length));
  var supplementBlocks = [];
  for (var i = 0; i < supplementColors.length; i++) {
    var type = questionIndices[i] ? 1 : 0;
    supplementBlocks.push(YarnLevel.createTargetBlock(supplementColors[i], type));
  }
  YarnLevel.shuffleArray(supplementBlocks);
  this._placeSupplementRows(supplementBlocks, colCount);
};
