/**
 * 毛线关卡生成工具 - 元素区管理器
 */

var YarnLevel = YarnLevel || {};

// ==================== ElementZoneManager 类 ====================
YarnLevel.ElementZoneManager = function() {
  this._spools = [];
  this._rows = 0;
  this._cols = 0;
};

YarnLevel.ElementZoneManager.prototype.generateBaseBoard = function(rows, cols) {
  if (typeof rows !== 'number' || !Number.isInteger(rows)) throw new Error('行数必须是整数');
  if (typeof cols !== 'number' || !Number.isInteger(cols)) throw new Error('列数必须是整数');
  if (rows <= 0) throw new Error('行数必须为正整数');
  if (cols <= 0) throw new Error('列数必须为正整数');

  this._rows = rows;
  this._cols = cols;
  this._spools = [];
  for (var i = 0; i < rows; i++) {
    var row = [];
    for (var j = 0; j < cols; j++) {
      row.push(YarnLevel.createSpoolElement(0, 0, 0));
    }
    this._spools.push(row);
  }
};

YarnLevel.ElementZoneManager.prototype.loadTerrain = function(terrain) {
  if (!Array.isArray(terrain)) throw new Error('地形数据必须是二维数组');
  if (this._spools.length === 0) throw new Error('请先生成基础棋盘');
  for (var row = 0; row < terrain.length; row++) {
    if (!Array.isArray(terrain[row])) throw new Error('地形数据的每一行必须是数组');
    if (row >= this._rows) continue;
    for (var col = 0; col < terrain[row].length; col++) {
      if (col >= this._cols) continue;
      if (terrain[row][col] === 1) {
        this._spools[row][col].id = -1;
        this._spools[row][col].type = 0;
        this._spools[row][col].param = 0;
      }
    }
  }
};

YarnLevel.ElementZoneManager.prototype.updateCell = function(row, col, colorId) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  if (typeof colorId !== 'number') return false;
  if (this._spools[row][col].id === -1) return false;
  this._spools[row][col].id = colorId;
  return true;
};

YarnLevel.ElementZoneManager.prototype.setCellAsPipe = function(row, col, pipeType) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  if (this._spools[row][col].id === -1) return false;  // 黑块不能修改
  if (pipeType < 11 || pipeType > 14) return false;  // 只接受管道类型
  // 直接覆盖单元格全部数据
  this._spools[row][col].id = 0;
  this._spools[row][col].type = pipeType;
  this._spools[row][col].param = 0;
  return true;
};

YarnLevel.ElementZoneManager.prototype.clearSpecialElement = function(row, col) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  if (this._spools[row][col].id === -1) return false;  // 黑块不能修改
  // 清空特殊功能
  this._spools[row][col].type = 0;
  this._spools[row][col].param = 0;
  return true;
};

YarnLevel.ElementZoneManager.prototype.setCellAsBlackBlock = function(row, col) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  // 直接设置为黑块，清空所有数据
  this._spools[row][col].id = -1;
  this._spools[row][col].type = 0;
  this._spools[row][col].param = 0;
  return true;
};

YarnLevel.ElementZoneManager.prototype.clearBlackBlock = function(row, col) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  if (this._spools[row][col].id !== -1) return false;  // 只能清除黑块
  // 变回空位置
  this._spools[row][col].id = 0;
  this._spools[row][col].type = 0;
  this._spools[row][col].param = 0;
  return true;
};

YarnLevel.ElementZoneManager.prototype.resetElements = function() {
  // 清空所有颜色元素和自动生成的特殊功能（冰块4、链条5、问号6），保留黑块和手动放置的特殊元素
  for (var row = 0; row < this._spools.length; row++) {
    for (var col = 0; col < this._spools[row].length; col++) {
      var cell = this._spools[row][col];
      if (cell.id === -1) continue;  // 保留黑块
      
      // 清空颜色
      cell.id = 0;
      cell.param = 0;
      
      // 只清空自动生成的特殊功能（冰块4、链条5、问号6）
      var type = cell.type;
      if (Array.isArray(type)) {
        // 过滤掉冰块、链条、问号，保留其他
        var filtered = type.filter(function(t) {
          return t !== 4 && t !== 5 && t !== 6;
        });
        if (filtered.length === 0) {
          cell.type = 0;
        } else if (filtered.length === 1) {
          cell.type = filtered[0];
        } else {
          cell.type = filtered;
        }
      } else if (type === 4 || type === 5 || type === 6) {
        cell.type = 0;
      }
      // 其他特殊功能（管道、钥匙、锁等）保留
    }
  }
};

YarnLevel.ElementZoneManager.prototype.getCell = function(row, col) {
  if (row < 0 || row >= this._spools.length) return null;
  if (col < 0 || col >= this._spools[row].length) return null;
  return YarnLevel.cloneSpoolElement(this._spools[row][col]);
};

YarnLevel.ElementZoneManager.prototype.getData = function() { return YarnLevel.cloneSpools(this._spools); };
YarnLevel.ElementZoneManager.prototype.getRowCount = function() { return this._rows; };
YarnLevel.ElementZoneManager.prototype.getColCount = function() { return this._cols; };
YarnLevel.ElementZoneManager.prototype.clear = function() { this._spools = []; this._rows = 0; this._cols = 0; };
YarnLevel.ElementZoneManager.prototype.isEmpty = function() { return this._spools.length === 0; };

YarnLevel.ElementZoneManager.prototype.loadFromLevelData = function(levelData) {
  if (!levelData || typeof levelData !== 'object') throw new Error('关卡数据无效');
  this._rows = levelData.maprow || 0;
  this._cols = levelData.mapcol || 0;
  this._spools = Array.isArray(levelData.spools) ? YarnLevel.cloneSpools(levelData.spools) : [];
};

YarnLevel.ElementZoneManager.prototype.isBlackBlock = function(row, col) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  return this._spools[row][col].id === -1;
};

YarnLevel.ElementZoneManager.prototype.isValidSpecialType = function(type) {
  if (type >= 11 && type <= 14) return true;
  if (type >= 21 && type <= 25) return true;
  if (type >= 31 && type <= 35) return true;
  if (type === 4 || type === 5 || type === 6) return true;
  return false;
};

YarnLevel.ElementZoneManager.prototype.getSpecialTypeCount = function(row, col) {
  if (row < 0 || row >= this._spools.length) return 0;
  if (col < 0 || col >= this._spools[row].length) return 0;
  var type = this._spools[row][col].type;
  if (Array.isArray(type)) return type.filter(function(t) { return t !== 0; }).length;
  return type !== 0 ? 1 : 0;
};

YarnLevel.ElementZoneManager.prototype.placeSpecialElement = function(row, col, type) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  if (typeof type !== 'number' || !Number.isInteger(type)) return false;
  if (!this.isValidSpecialType(type)) return false;
  var cell = this._spools[row][col];
  if (cell.id === -1) return false;
  if (this.getSpecialTypeCount(row, col) >= 2) return false;
  var currentType = cell.type;
  if (Array.isArray(currentType)) {
    currentType.push(type);
  } else if (currentType === 0) {
    cell.type = type;
  } else {
    cell.type = [currentType, type];
  }
  return true;
};

YarnLevel.ElementZoneManager.prototype.removeSpecialElement = function(row, col, typeToRemove) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  var cell = this._spools[row][col];
  if (cell.id === -1) return false;
  if (typeToRemove === undefined) { cell.type = 0; return true; }
  var currentType = cell.type;
  if (Array.isArray(currentType)) {
    var index = currentType.indexOf(typeToRemove);
    if (index === -1) return false;
    currentType.splice(index, 1);
    if (currentType.length === 1) cell.type = currentType[0];
    else if (currentType.length === 0) cell.type = 0;
    return true;
  } else if (currentType === typeToRemove) {
    cell.type = 0;
    return true;
  }
  return false;
};

YarnLevel.ElementZoneManager.prototype.isPipeElement = function(row, col) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  var type = this._spools[row][col].type;
  if (Array.isArray(type)) {
    for (var i = 0; i < type.length; i++) {
      if (type[i] >= 11 && type[i] <= 14) return true;
    }
    return false;
  }
  return type >= 11 && type <= 14;
};

YarnLevel.ElementZoneManager.prototype.getPipeElements = function() {
  var pipes = [];
  for (var row = 0; row < this._spools.length; row++) {
    for (var col = 0; col < this._spools[row].length; col++) {
      var type = this._spools[row][col].type;
      var pipeType = null;
      if (Array.isArray(type)) {
        for (var i = 0; i < type.length; i++) {
          if (type[i] >= 11 && type[i] <= 14) { pipeType = type[i]; break; }
        }
      } else if (type >= 11 && type <= 14) {
        pipeType = type;
      }
      if (pipeType !== null) pipes.push({ row: row, col: col, type: pipeType });
    }
  }
  return pipes;
};

YarnLevel.ElementZoneManager.prototype.setPipeParam = function(row, col, elements) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  if (!this.isPipeElement(row, col)) return false;
  if (!Array.isArray(elements)) return false;
  this._spools[row][col].param = elements.slice();
  return true;
};

YarnLevel.ElementZoneManager.prototype._getAvailablePositions = function() {
  var positions = [];
  for (var row = 0; row < this._spools.length; row++) {
    for (var col = 0; col < this._spools[row].length; col++) {
      var cell = this._spools[row][col];
      if (cell.id === -1) continue;
      if (this.isPipeElement(row, col)) continue;
      positions.push({ row: row, col: col });
    }
  }
  return positions;
};

// 获取某一行的空位置
YarnLevel.ElementZoneManager.prototype._getRowAvailablePositions = function(row) {
  var positions = [];
  if (row < 0 || row >= this._spools.length) return positions;
  for (var col = 0; col < this._spools[row].length; col++) {
    var cell = this._spools[row][col];
    if (cell.id === -1) continue;
    if (this.isPipeElement(row, col)) continue;
    positions.push({ row: row, col: col });
  }
  return positions;
};

/**
 * 统计目标区颜色组信息
 * 从目标区二维数组尾部开始（从下到上，从左到右），统计颜色组
 * 每3个相同颜色为一组，跨行延续统计
 * @param {Object} targetManager - 目标区管理器
 * @returns {Object} 目标区统计容器
 */
YarnLevel.ElementZoneManager.prototype._buildTargetGroupStats = function(targetManager) {
  var result = {
    groups: [],           // 所有组信息: { groupId, colorId, rowId }
    rowGroups: {},        // 按行ID分组: { rowId: [groupInfo, ...] }
    totalGroups: 0,
    baseRowCount: 0
  };
  
  if (!targetManager || targetManager.isEmpty()) return result;
  
  var data = targetManager.getData();
  var baseRowCount = targetManager.getBaseRowCount();
  result.baseRowCount = baseRowCount;
  
  var colorAccumulator = {};  // 每种颜色的累计计数
  var groupId = 1;
  var rowId = 0;
  
  // 从下到上遍历（数组尾部开始）
  for (var rowIndex = data.length - 1; rowIndex >= 0; rowIndex--) {
    var row = data[rowIndex];
    result.rowGroups[rowId] = [];
    
    // 从左到右遍历
    for (var colIndex = 0; colIndex < row.length; colIndex++) {
      var colorId = row[colIndex].id;
      if (colorId <= 0) continue;
      
      var currentCount = (colorAccumulator[colorId] || 0) + 1;
      
      if (currentCount === 3) {
        // 完成一组
        var groupInfo = { groupId: groupId, colorId: colorId, rowId: rowId };
        result.groups.push(groupInfo);
        result.rowGroups[rowId].push(groupInfo);
        result.totalGroups++;
        groupId++;
        colorAccumulator[colorId] = 0;
      } else {
        colorAccumulator[colorId] = currentCount;
      }
    }
    rowId++;
  }
  
  return result;
};

/**
 * 从归纳容器中随机取出指定数量的组
 * @param {Array} pool - 归纳容器（组信息数组）
 * @param {number} count - 需要取出的数量
 * @returns {Array} 取出的组信息数组
 */
YarnLevel.ElementZoneManager.prototype._pickRandomGroups = function(pool, count) {
  var picked = [];
  var actualCount = Math.min(count, pool.length);
  
  for (var i = 0; i < actualCount; i++) {
    var randomIndex = Math.floor(Math.random() * pool.length);
    picked.push(pool[randomIndex]);
    pool.splice(randomIndex, 1);
  }
  
  return picked;
};

/**
 * 生成基础元素（新逻辑）
 * 按照新的说明文档实现：
 * 1. 统计目标区颜色组信息
 * 2. 先放置20%的补充颜色组
 * 3. 按行放置，动态调整抓取行数
 * 4. 剩余组信息放入管道
 */
YarnLevel.ElementZoneManager.prototype.generateBaseElements = function(params) {
  var targetManager = params && params.targetManager;
  if (!targetManager) throw new Error('必须提供目标区管理器');
  if (this._spools.length === 0) throw new Error('请先生成基础棋盘');
  
  // 1. 统计目标区颜色组信息
  var stats = this._buildTargetGroupStats(targetManager);
  if (stats.totalGroups === 0) return { pipeParams: [] };
  
  // 2. 初始化变量
  var fetchRowCount = 3;  // 抓取行数，默认为3
  var currentFetchRow = 0;  // 当前已抓取到的行ID
  var pool = [];  // 归纳容器
  var baseRowCount = stats.baseRowCount;
  var totalRows = Object.keys(stats.rowGroups).length;
  
  // 补充行是rowId >= baseRowCount的行（因为rowId从目标区底部开始计数，基础行在底部）
  // 例如：目标区有5行，基础行数为3，则rowId 0,1,2是基础行，rowId 3,4是补充行
  
  // 3. 先放置20%的补充颜色组
  var supplementGroups = [];
  for (var rowId = baseRowCount; rowId < totalRows; rowId++) {
    if (stats.rowGroups[rowId]) {
      supplementGroups = supplementGroups.concat(stats.rowGroups[rowId]);
    }
  }
  
  var supplementFirst = Math.ceil(supplementGroups.length * 0.2);
  var allAvailablePositions = this._getAvailablePositions();
  var placedGroupIds = {};
  
  if (supplementFirst > 0 && supplementGroups.length > 0) {
    // 随机取出20%的补充组（_pickRandomGroups会从supplementGroups中移除）
    var firstSupplementGroups = this._pickRandomGroups(supplementGroups, supplementFirst);
    
    // 记录已放置的组ID
    for (var i = 0; i < firstSupplementGroups.length; i++) {
      placedGroupIds[firstSupplementGroups[i].groupId] = true;
    }
    
    // 随机放置到元素区
    var shuffledPositions = allAvailablePositions.slice();
    YarnLevel.shuffleArray(shuffledPositions);
    
    for (var i = 0; i < firstSupplementGroups.length && i < shuffledPositions.length; i++) {
      var pos = shuffledPositions[i];
      this._spools[pos.row][pos.col].id = firstSupplementGroups[i].colorId;
    }
  }
  
  // 重建rowGroups，排除已放置的组
  var newRowGroups = {};
  for (var rowId in stats.rowGroups) {
    newRowGroups[rowId] = [];
    for (var i = 0; i < stats.rowGroups[rowId].length; i++) {
      var g = stats.rowGroups[rowId][i];
      if (!placedGroupIds[g.groupId]) {
        newRowGroups[rowId].push(g);
      }
    }
  }
  stats.rowGroups = newRowGroups;
  
  // 4. 按行放置元素
  for (var elementRow = 0; elementRow < this._rows; elementRow++) {
    // 获取当前行的空位置
    var rowPositions = this._getRowAvailablePositions(elementRow);
    // 过滤掉已经有颜色的位置
    var emptyPositions = [];
    for (var i = 0; i < rowPositions.length; i++) {
      var pos = rowPositions[i];
      if (this._spools[pos.row][pos.col].id === 0) {
        emptyPositions.push(pos);
      }
    }
    
    if (emptyPositions.length === 0) continue;
    
    // 根据抓取行数，从目标区统计容器中获取组信息到归纳容器
    while (pool.length < emptyPositions.length) {
      // 检查是否还有更多行可以抓取
      if (currentFetchRow >= totalRows) break;
      
      // 抓取fetchRowCount行
      var endRow = Math.min(currentFetchRow + fetchRowCount, totalRows);
      for (var r = currentFetchRow; r < endRow; r++) {
        if (stats.rowGroups[r]) {
          pool = pool.concat(stats.rowGroups[r]);
        }
      }
      currentFetchRow = endRow;
      
      // 如果还不够，增加抓取行数
      if (pool.length < emptyPositions.length && currentFetchRow < totalRows) {
        fetchRowCount++;
      }
    }
    
    // 随机从归纳容器中取出组，放入空位置
    var groupsToPlace = this._pickRandomGroups(pool, emptyPositions.length);
    YarnLevel.shuffleArray(emptyPositions);
    
    for (var i = 0; i < groupsToPlace.length && i < emptyPositions.length; i++) {
      var pos = emptyPositions[i];
      this._spools[pos.row][pos.col].id = groupsToPlace[i].colorId;
    }
  }
  
  // 5. 元素区放满后，抓取剩余全部未抓取的行到归纳容器
  while (currentFetchRow < totalRows) {
    if (stats.rowGroups[currentFetchRow]) {
      pool = pool.concat(stats.rowGroups[currentFetchRow]);
    }
    currentFetchRow++;
  }
  
  // 6. 处理剩余组信息，放入管道
  var pipeResult = this._distributeToPipes(pool);
  
  return { pipeParams: pipeResult };
};

/**
 * 将剩余组信息分配到管道
 * 按管道位置顺序（从上到下，从左到右），依次放入组信息
 * 保持归纳容器中的顺序不变
 */
YarnLevel.ElementZoneManager.prototype._distributeToPipes = function(remainingGroups) {
  var result = [];
  if (!remainingGroups || remainingGroups.length === 0) return result;
  
  var pipes = this.getPipeElements();
  if (pipes.length === 0) {
    // 没有管道，返回剩余组的统计
    var colorCounts = {};
    for (var i = 0; i < remainingGroups.length; i++) {
      var colorId = remainingGroups[i].colorId;
      colorCounts[colorId] = (colorCounts[colorId] || 0) + 1;
    }
    for (var colorId in colorCounts) {
      result.push({ colorId: parseInt(colorId, 10), count: colorCounts[colorId] });
    }
    return result;
  }
  
  // 管道按位置排序（从上到下，从左到右）
  pipes.sort(function(a, b) {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });
  
  // 初始化每个管道的颜色数组
  var pipeColorArrays = [];
  for (var i = 0; i < pipes.length; i++) {
    pipeColorArrays.push([]);
  }
  
  // 第一层循环剩余组信息，第二层循环管道列表，依次平铺放入
  var pipeIndex = 0;
  for (var i = 0; i < remainingGroups.length; i++) {
    pipeColorArrays[pipeIndex].push(remainingGroups[i].colorId);
    pipeIndex++;
    if (pipeIndex >= pipes.length) {
      pipeIndex = 0;
    }
  }
  
  // 设置每个管道的参数
  for (var i = 0; i < pipes.length; i++) {
    var pipe = pipes[i];
    var pipeColors = pipeColorArrays[i];
    
    if (pipeColors.length > 0) {
      this.setPipeParam(pipe.row, pipe.col, pipeColors);
      result.push({ row: pipe.row, col: pipe.col, count: pipeColors.length });
    }
  }
  
  return result;
};

YarnLevel.ElementZoneManager.prototype.areAdjacent = function(row1, col1, row2, col2) {
  var rowDiff = Math.abs(row1 - row2);
  var colDiff = Math.abs(col1 - col2);
  return (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);
};

YarnLevel.ElementZoneManager.prototype.hasChain = function(row, col) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  var type = this._spools[row][col].type;
  if (Array.isArray(type)) return type.indexOf(5) !== -1;
  return type === 5;
};

YarnLevel.ElementZoneManager.prototype._getSurroundingPositions = function(row, col) {
  var positions = [];
  var directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (var i = 0; i < directions.length; i++) {
    var newRow = row + directions[i][0];
    var newCol = col + directions[i][1];
    if (newRow >= 0 && newRow < this._rows && newCol >= 0 && newCol < this._cols) {
      positions.push({ row: newRow, col: newCol });
    }
  }
  return positions;
};

YarnLevel.ElementZoneManager.prototype.hasChainInSurrounding = function(row1, col1, row2, col2) {
  var surrounding1 = this._getSurroundingPositions(row1, col1);
  var surrounding2 = this._getSurroundingPositions(row2, col2);
  var allSurrounding = {};
  for (var i = 0; i < surrounding1.length; i++) {
    var pos = surrounding1[i];
    if (!(pos.row === row1 && pos.col === col1) && !(pos.row === row2 && pos.col === col2)) {
      allSurrounding[pos.row + ',' + pos.col] = true;
    }
  }
  for (var i = 0; i < surrounding2.length; i++) {
    var pos = surrounding2[i];
    if (!(pos.row === row1 && pos.col === col1) && !(pos.row === row2 && pos.col === col2)) {
      allSurrounding[pos.row + ',' + pos.col] = true;
    }
  }
  for (var posKey in allSurrounding) {
    var parts = posKey.split(',');
    if (this.hasChain(parseInt(parts[0], 10), parseInt(parts[1], 10))) return true;
  }
  return false;
};

YarnLevel.ElementZoneManager.prototype.canPlaceChainAt = function(row, col) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  var cell = this._spools[row][col];
  if (cell.id === -1 || cell.id === 0) return false;
  if (this.isPipeElement(row, col)) return false;
  if (this.getSpecialTypeCount(row, col) >= 2) return false;
  return true;
};

// ★ 链条格开放邻格检查：排除伙伴格后，至少有一个方向不是黑块/管道/越界墙
// 防止链条对放完后某个格子四面被封死（管道+黑块+墙+伙伴），玩家无法操作
YarnLevel.ElementZoneManager.prototype._chainCellHasOpenNeighbor = function(row, col, excludeRow, excludeCol) {
  var directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (var i = 0; i < directions.length; i++) {
    var nr = row + directions[i][0];
    var nc = col + directions[i][1];
    if (nr === excludeRow && nc === excludeCol) continue; // 排除伙伴格
    if (nr < 0 || nr >= this._rows || nc < 0 || nc >= this._cols) continue; // 越界=墙，跳过
    var cell = this._spools[nr][nc];
    if (!cell || cell.id === -1 || cell.id === 0) continue; // 黑块，跳过
    if (this.isPipeElement(nr, nc)) continue; // 管道，跳过
    return true; // 找到至少一个开放邻格
  }
  return false;
};

YarnLevel.ElementZoneManager.prototype.placeChainPair = function(row1, col1, row2, col2) {
  if (!this.areAdjacent(row1, col1, row2, col2)) return false;
  if (!this.canPlaceChainAt(row1, col1)) return false;
  if (!this.canPlaceChainAt(row2, col2)) return false;
  if (this.hasChainInSurrounding(row1, col1, row2, col2)) return false;
  // ★ 两个格子各自排除伙伴方向后，必须至少有一个开放邻格
  if (!this._chainCellHasOpenNeighbor(row1, col1, row2, col2)) return false;
  if (!this._chainCellHasOpenNeighbor(row2, col2, row1, col1)) return false;
  var result1 = this.placeSpecialElement(row1, col1, 5);
  if (!result1) return false;
  var result2 = this.placeSpecialElement(row2, col2, 5);
  if (!result2) { this.removeSpecialElement(row1, col1, 5); return false; }
  return true;
};

// ★ 判断某格是否对链条"可通行"：在棋盘内 且 不是黑块(id=-1/0) 且 不是管道
YarnLevel.ElementZoneManager.prototype._isChainPassable = function(row, col) {
  if (row < 0 || row >= this._rows || col < 0 || col >= this._cols) return false;
  var cell = this._spools[row][col];
  if (cell.id === -1 || cell.id === 0) return false;
  if (this.isPipeElement(row, col)) return false;
  return true;
};

// ★ 某格（排除伙伴格）至少有一个可通行邻格（玩家能进入/离开）
YarnLevel.ElementZoneManager.prototype._chainCellHasFreeEntry = function(row, col, partnerRow, partnerCol) {
  var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (var i = 0; i < dirs.length; i++) {
    var nr = row + dirs[i][0], nc = col + dirs[i][1];
    if (nr === partnerRow && nc === partnerCol) continue; // 排除伙伴格
    if (this._isChainPassable(nr, nc)) return true;
  }
  return false;
};

YarnLevel.ElementZoneManager.prototype._findCandidateChainPairs = function() {
  var pairs = [];
  for (var row = 0; row < this._rows; row++) {
    for (var col = 0; col < this._cols; col++) {
      if (!this.canPlaceChainAt(row, col)) continue;
      // 横向对
      if (col + 1 < this._cols && this.canPlaceChainAt(row, col + 1)) {
        // ★ 两格各自在排除伙伴后仍有自由邻格
        if (this._chainCellHasFreeEntry(row, col, row, col + 1) &&
            this._chainCellHasFreeEntry(row, col + 1, row, col)) {
          pairs.push({ row1: row, col1: col, row2: row, col2: col + 1 });
        }
      }
      // 纵向对
      if (row + 1 < this._rows && this.canPlaceChainAt(row + 1, col)) {
        if (this._chainCellHasFreeEntry(row, col, row + 1, col) &&
            this._chainCellHasFreeEntry(row + 1, col, row, col)) {
          pairs.push({ row1: row, col1: col, row2: row + 1, col2: col });
        }
      }
    }
  }
  return pairs;
};

YarnLevel.ElementZoneManager.prototype.autoPlaceChains = function(count) {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) throw new Error('链条对数量必须是非负整数');
  if (this._spools.length === 0) throw new Error('请先生成基础棋盘');
  var placed = 0;
  var candidatePairs = this._findCandidateChainPairs();
  YarnLevel.shuffleArray(candidatePairs);
  for (var i = 0; i < candidatePairs.length; i++) {
    if (placed >= count) break;
    var pair = candidatePairs[i];
    if (this.placeChainPair(pair.row1, pair.col1, pair.row2, pair.col2)) placed++;
  }
  return { placed: placed, failed: count - placed };
};

YarnLevel.ElementZoneManager.prototype.canPlaceIceOrQuestionAt = function(row, col) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  var cell = this._spools[row][col];
  if (cell.id === -1 || cell.id <= 0) return false;
  if (this.isPipeElement(row, col)) return false;
  if (this.getSpecialTypeCount(row, col) >= 2) return false;
  return true;
};

YarnLevel.ElementZoneManager.prototype._getIceOrQuestionPlaceablePositions = function() {
  var positions = [];
  for (var row = 0; row < this._rows; row++) {
    for (var col = 0; col < this._cols; col++) {
      if (this.canPlaceIceOrQuestionAt(row, col)) positions.push({ row: row, col: col });
    }
  }
  return positions;
};

YarnLevel.ElementZoneManager.prototype.autoPlaceIce = function(count) {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) throw new Error('冰块数量必须是非负整数');
  if (this._spools.length === 0) throw new Error('请先生成基础棋盘');
  if (count === 0) return 0;
  var availablePositions = this._getIceOrQuestionPlaceablePositions();
  YarnLevel.shuffleArray(availablePositions);
  var placed = 0;
  for (var i = 0; i < availablePositions.length; i++) {
    if (placed >= count) break;
    var pos = availablePositions[i];
    if (this.canPlaceIceOrQuestionAt(pos.row, pos.col)) {
      if (this.placeSpecialElement(pos.row, pos.col, 4)) placed++;
    }
  }
  return placed;
};

YarnLevel.ElementZoneManager.prototype.autoPlaceQuestionMarks = function(count) {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) throw new Error('问号数量必须是非负整数');
  if (this._spools.length === 0) throw new Error('请先生成基础棋盘');
  if (count === 0) return 0;
  var availablePositions = this._getIceOrQuestionPlaceablePositions().filter(function(pos) {
    return pos.row > 0; // 排除第一行（数组index=0，游戏顶行）
  });
  YarnLevel.shuffleArray(availablePositions);
  var placed = 0;
  for (var i = 0; i < availablePositions.length; i++) {
    if (placed >= count) break;
    var pos = availablePositions[i];
    if (this.canPlaceIceOrQuestionAt(pos.row, pos.col)) {
      if (this.placeSpecialElement(pos.row, pos.col, 6)) placed++;
    }
  }
  return placed;
};
