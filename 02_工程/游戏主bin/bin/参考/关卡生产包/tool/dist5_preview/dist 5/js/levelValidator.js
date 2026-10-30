/**
 * 毛线关卡生成工具 - 关卡验证器
 * 模拟关卡执行流程，验证当前关卡数据是否可以被成功通关
 */

var YarnLevel = YarnLevel || {};

// ==================== 常量 ====================

/** 管道方向偏移映射：11=上, 12=右, 13=下, 14=左 */
var PIPE_DIRECTION_OFFSET = {
  11: { dRow: -1, dCol: 0 },
  12: { dRow: 0, dCol: 1 },
  13: { dRow: 1, dCol: 0 },
  14: { dRow: 0, dCol: -1 }
};

/** 钥匙-锁对应关系：钥匙21-25 对应 锁31-35 */
var KEY_LOCK_MAP = {
  21: 31,
  22: 32,
  23: 33,
  24: 34,
  25: 35
};

// ==================== LevelValidator 构造函数 ====================

/**
 * 关卡验证器
 * @param {Array<Array<{id: number, type: number}>>} targetData - 目标区二维数组深拷贝
 * @param {Array<Array<{id: number, type: number|number[], param: number|number[]}>>} elementData - 元素区二维数组深拷贝
 */
YarnLevel.LevelValidator = function(targetData, elementData) {
  this._target = YarnLevel.cloneBlocks(targetData);
  this._elements = YarnLevel.cloneSpools(elementData);
  this._buffer = [];          // 暂存区，最多6个元素
  this._activeMap = [];       // 激活状态二维数组
  this._iceCountMap = [];     // 冰块损耗计数二维数组
  this._lockMap = {};         // 锁状态 {lockId: [{row, col}]}
  this._pipeState = [];       // 管道状态 [{row, col, direction, params, paramIndex}]
  this._chainPairs = [];      // 链条绑定关系 [{row1, col1, row2, col2}]
  this._log = [];             // 验证步骤日志
  this._step = 0;             // 当前步骤编号
};

// ==================== 公开方法 ====================

/**
 * 执行完整验证流程
 * @returns {{success: boolean, message: string, details: {remainingTarget: number, remainingElement: number, bufferCount: number, reason: string}}}
 */
YarnLevel.LevelValidator.prototype.validate = function() {
  try {
    // 1. 前置条件检查
    var preconditionResult = this._checkPreconditions();
    if (!preconditionResult.success) {
      preconditionResult.log = [];
      return preconditionResult;
    }

    // 2. 初始化激活状态
    this._initActiveState();

    // 3. 初始化特殊功能状态（冰块、锁、管道、链条）
    this._initSpecialState();

    // 4. 执行模拟主循环
    return this._runSimulation();
  } catch (error) {
    return {
      success: false,
      message: '验证过程中出现异常: ' + error.message,
      log: this._log,
      details: {
        remainingTarget: -1,
        remainingElement: -1,
        bufferCount: this._buffer.length,
        reason: 'exception'
      }
    };
  }
};

// ==================== 激活状态管理 ====================

/**
 * 初始化激活状态：创建与元素区同维度的激活映射，第一行非空非黑块元素强制激活
 * 需求：3.1, 3.2
 */
YarnLevel.LevelValidator.prototype._initActiveState = function() {
  this._activeMap = [];
  for (var r = 0; r < this._elements.length; r++) {
    this._activeMap[r] = [];
    for (var c = 0; c < this._elements[r].length; c++) {
      if (r === 0) {
        var elem = this._elements[r][c];
        this._activeMap[r][c] = (elem.id > 0 && elem.id !== -1);
      } else {
        this._activeMap[r][c] = false;
      }
    }
  }
};

/**
 * 激活指定位置上下左右4个方向的相邻元素
 * 当元素被移动后该位置变为空位，激活相邻的未激活元素
 * 需求：3.3, 3.4
 * @param {number} row - 被移动元素的行
 * @param {number} col - 被移动元素的列
 */
YarnLevel.LevelValidator.prototype._activateAdjacent = function(row, col) {
  var directions = [
    { dRow: -1, dCol: 0 },  // 上
    { dRow: 1, dCol: 0 },   // 下
    { dRow: 0, dCol: -1 },  // 左
    { dRow: 0, dCol: 1 }    // 右
  ];

  for (var i = 0; i < directions.length; i++) {
    var newRow = row + directions[i].dRow;
    var newCol = col + directions[i].dCol;

    // 检查边界
    if (newRow >= 0 && newRow < this._elements.length &&
        newCol >= 0 && newCol < this._elements[newRow].length) {
      // 仅激活之前未激活的元素
      if (!this._activeMap[newRow][newCol]) {
        this._activeMap[newRow][newCol] = true;
      }
    }
  }
};

// ==================== 前置条件检查 ====================

/**
 * 检查前置条件：颜色配对和数量匹配
 * @returns {{success: boolean, message: string, details: {remainingTarget: number, remainingElement: number, bufferCount: number, reason: string}}}
 */
YarnLevel.LevelValidator.prototype._checkPreconditions = function() {
  // 1. 统计目标区中每种颜色的数量
  var colorCounts = {};
  var totalColors = 0;
  for (var r = 0; r < this._target.length; r++) {
    for (var c = 0; c < this._target[r].length; c++) {
      var block = this._target[r][c];
      if (block.id > 0) {
        colorCounts[block.id] = (colorCounts[block.id] || 0) + 1;
        totalColors++;
      }
    }
  }

  // 2. 检查每种颜色数量是否为3的倍数
  var invalidColors = [];
  for (var colorId in colorCounts) {
    if (colorCounts.hasOwnProperty(colorId)) {
      if (colorCounts[colorId] % 3 !== 0) {
        invalidColors.push({ id: Number(colorId), count: colorCounts[colorId] });
      }
    }
  }

  if (invalidColors.length > 0) {
    var details = invalidColors.map(function(c) {
      return '颜色' + c.id + '数量为' + c.count;
    }).join('、');
    return {
      success: false,
      message: '目标区颜色数量不是3的倍数: ' + details,
      details: {
        remainingTarget: totalColors,
        remainingElement: 0,
        bufferCount: 0,
        reason: 'precondition_failed'
      }
    };
  }

  // 3. 计算目标区颜色组总数
  var colorGroupCount = totalColors / 3;

  // 4. 计算元素区可移动元素总数（普通元素 + 管道内元素）
  var movableCount = 0;
  for (var r = 0; r < this._elements.length; r++) {
    for (var c = 0; c < this._elements[r].length; c++) {
      var elem = this._elements[r][c];
      // 检查是否为管道元素 (type 11-14)
      var isPipe = this._findTypeInRange(elem.type, 11, 14) !== -1;

      if (isPipe) {
        // 管道元素本身不可移动，但其param列表中的元素计入可移动总数
        if (Array.isArray(elem.param)) {
          movableCount += elem.param.length;
        }
      } else if (elem.id > 0) {
        // 普通可移动元素
        movableCount++;
      }
    }
  }

  // 5. 检查颜色组总数是否等于可移动元素总数
  if (colorGroupCount !== movableCount) {
    return {
      success: false,
      message: '目标区颜色组数(' + colorGroupCount + ')与可移动元素数(' + movableCount + ')不匹配',
      details: {
        remainingTarget: totalColors,
        remainingElement: movableCount,
        bufferCount: 0,
        reason: 'precondition_failed'
      }
    };
  }

  return {
    success: true,
    message: '',
    details: {
      remainingTarget: totalColors,
      remainingElement: movableCount,
      bufferCount: 0,
      reason: ''
    }
  };
};


// ==================== 类型检查辅助方法 ====================

/**
 * 检查元素的 type 是否包含指定的目标类型值
 * type 可以是单个数字或数字数组
 * @param {number|number[]} type - 元素的 type 值
 * @param {number} targetType - 要检查的目标类型
 * @returns {boolean}
 */
YarnLevel.LevelValidator.prototype._hasType = function(type, targetType) {
  if (Array.isArray(type)) {
    for (var i = 0; i < type.length; i++) {
      if (type[i] === targetType) return true;
    }
    return false;
  }
  return type === targetType;
};

/**
 * 检查元素的 type 是否包含指定范围内的类型值，并返回匹配的值
 * @param {number|number[]} type - 元素的 type 值
 * @param {number} minType - 范围最小值（含）
 * @param {number} maxType - 范围最大值（含）
 * @returns {number} 匹配的类型值，未找到返回 -1
 */
YarnLevel.LevelValidator.prototype._findTypeInRange = function(type, minType, maxType) {
  if (Array.isArray(type)) {
    for (var i = 0; i < type.length; i++) {
      if (type[i] >= minType && type[i] <= maxType) return type[i];
    }
    return -1;
  }
  return (type >= minType && type <= maxType) ? type : -1;
};

// ==================== 特殊功能状态初始化 ====================

/**
 * 初始化特殊功能状态：冰块计数、锁映射、管道状态、链条绑定关系
 * 需求：5.1, 6.1, 7.1
 */
YarnLevel.LevelValidator.prototype._initSpecialState = function() {
  var rows = this._elements.length;

  // 重置所有状态
  this._iceCountMap = [];
  this._lockMap = {};
  this._pipeState = [];
  this._chainPairs = [];

  // 用于链条去重：记录已配对的位置
  var chainPaired = {};

  for (var r = 0; r < rows; r++) {
    this._iceCountMap[r] = [];
    var cols = this._elements[r].length;

    for (var c = 0; c < cols; c++) {
      var elem = this._elements[r][c];

      // 1. 冰块损耗计数：有冰块(type含4)初始为0，否则为-1
      if (this._hasType(elem.type, 4)) {
        this._iceCountMap[r][c] = 0;
      } else {
        this._iceCountMap[r][c] = -1;
      }

      // 2. 锁状态映射：锁类型 31-35
      var lockType = this._findTypeInRange(elem.type, 31, 35);
      if (lockType !== -1) {
        if (!this._lockMap[lockType]) {
          this._lockMap[lockType] = [];
        }
        this._lockMap[lockType].push({ row: r, col: c });
      }

      // 3. 管道状态：管道类型 11-14
      var pipeType = this._findTypeInRange(elem.type, 11, 14);
      if (pipeType !== -1) {
        this._pipeState.push({
          row: r,
          col: c,
          direction: pipeType,
          params: Array.isArray(elem.param) ? elem.param : [],
          paramIndex: 0
        });
      }

      // 4. 链条绑定关系：链条类型 5
      if (this._hasType(elem.type, 5)) {
        var key = r + ',' + c;
        if (!chainPaired[key]) {
          // 检查4个相邻格查找链条配对
          var directions = [
            { dRow: -1, dCol: 0 },  // 上
            { dRow: 1, dCol: 0 },   // 下
            { dRow: 0, dCol: -1 },  // 左
            { dRow: 0, dCol: 1 }    // 右
          ];
          for (var d = 0; d < directions.length; d++) {
            var nr = r + directions[d].dRow;
            var nc = c + directions[d].dCol;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < this._elements[nr].length) {
              var neighbor = this._elements[nr][nc];
              var neighborKey = nr + ',' + nc;
              if (this._hasType(neighbor.type, 5) && !chainPaired[neighborKey]) {
                this._chainPairs.push({ row1: r, col1: c, row2: nr, col2: nc });
                chainPaired[key] = true;
                chainPaired[neighborKey] = true;
                break;  // 每个链条元素只配对一次
              }
            }
          }
        }
      }
    }
  }
};

// ==================== 冰块损耗 ====================

/**
 * 全元素区统一冰块损耗
 * 搜索所有处于激活状态且带有冰块的元素，统一损耗一次
 * 未激活状态的冰块元素不损耗
 * 损耗计数达到4次时，删除冰块使对应元素可被移动
 * 需求：5.1, 5.2, 5.3
 */
YarnLevel.LevelValidator.prototype._processIceDamage = function() {
  for (var r = 0; r < this._elements.length; r++) {
    for (var c = 0; c < this._elements[r].length; c++) {
      // 只处理有冰块(>=0)、未被移除(<4)、且已激活的元素
      if (this._iceCountMap[r][c] >= 0 &&
          this._iceCountMap[r][c] < 4 &&
          this._activeMap[r][c] === true) {
        this._iceCountMap[r][c]++;

        // 损耗计数达到4，移除冰块类型
        if (this._iceCountMap[r][c] === 4) {
          var elem = this._elements[r][c];
          if (Array.isArray(elem.type)) {
            elem.type = elem.type.filter(function(t) { return t !== 4; });
          } else if (elem.type === 4) {
            elem.type = 0;
          }
        }
      }
    }
  }
};

// ==================== 管道放置 ====================

/**
 * 处理所有管道放置逻辑
 * 按从上到下、从左到右的顺序检查所有管道（_pipeState 已按此顺序存储）
 * 如果管道指向方向的相邻格为空且参数列表未用完，放置一个元素
 * 新放置的元素根据激活规则判断是否激活
 * 管道元素本身永远不会被消除
 * 需求：6.1, 6.2, 6.3, 6.4, 6.5
 */
YarnLevel.LevelValidator.prototype._processPipes = function() {
  for (var i = 0; i < this._pipeState.length; i++) {
    var pipe = this._pipeState[i];

    // 参数列表已用完，跳过
    if (pipe.paramIndex >= pipe.params.length) {
      continue;
    }

    // 获取管道指向方向的相邻格坐标
    var offset = PIPE_DIRECTION_OFFSET[pipe.direction];
    if (!offset) continue;

    var targetRow = pipe.row + offset.dRow;
    var targetCol = pipe.col + offset.dCol;

    // 检查边界
    if (targetRow < 0 || targetRow >= this._elements.length ||
        targetCol < 0 || targetCol >= this._elements[targetRow].length) {
      continue;
    }

    // 相邻格非空，不放置
    if (this._elements[targetRow][targetCol].id !== 0) {
      continue;
    }

    // 从参数列表取出下一个颜色ID，放置到相邻格
    var colorId = pipe.params[pipe.paramIndex];
    this._elements[targetRow][targetCol] = { id: colorId, type: 0, param: 0 };
    pipe.paramIndex++;

    this._log.push({
      step: this._step,
      action: 'pipe',
      desc: '管道(' + pipe.row + ',' + pipe.col + ')放置颜色' + colorId + ' → (' + targetRow + ',' + targetCol + ')',
      buffer: this._buffer.slice()
    });

    // 新放置的元素根据激活规则判断是否激活
    // 激活条件：在第一行，或者任一相邻格为空(id==0)
    var shouldActivate = false;

    if (targetRow === 0) {
      shouldActivate = true;
    } else {
      var directions = [
        { dRow: -1, dCol: 0 },  // 上
        { dRow: 1, dCol: 0 },   // 下
        { dRow: 0, dCol: -1 },  // 左
        { dRow: 0, dCol: 1 }    // 右
      ];
      for (var d = 0; d < directions.length; d++) {
        var adjRow = targetRow + directions[d].dRow;
        var adjCol = targetCol + directions[d].dCol;
        if (adjRow >= 0 && adjRow < this._elements.length &&
            adjCol >= 0 && adjCol < this._elements[adjRow].length) {
          if (this._elements[adjRow][adjCol].id === 0) {
            shouldActivate = true;
            break;
          }
        }
      }
    }

    this._activeMap[targetRow][targetCol] = shouldActivate;
  }
};

// ==================== 钥匙解锁 ====================

/**
 * 钥匙解锁对应的锁
 * 根据 KEY_LOCK_MAP 找到对应的锁ID，消除所有该锁的位置，使元素恢复可移动状态
 * 需求：7.1, 7.2
 * @param {number} keyId - 钥匙类型ID（21-25）
 */
YarnLevel.LevelValidator.prototype._processKeyUnlock = function(keyId) {
  // 1. 查找对应的锁ID
  var lockId = KEY_LOCK_MAP[keyId];
  if (!lockId) return;

  // 2. 获取该锁的所有位置
  var positions = this._lockMap[lockId];
  if (!positions || positions.length === 0) return;

  // 3. 消除每个位置的锁类型
  for (var i = 0; i < positions.length; i++) {
    var pos = positions[i];
    var elem = this._elements[pos.row][pos.col];

    if (Array.isArray(elem.type)) {
      elem.type = elem.type.filter(function(t) { return t !== lockId; });
    } else if (elem.type === lockId) {
      elem.type = 0;
    }
  }

  // 4. 清除锁映射中的记录
  delete this._lockMap[lockId];
};

// ==================== 元素移动判断 ====================

/**
 * 判断指定位置的元素是否可以移动
 * 检查条件：非空非黑块、非管道、已激活、无锁、无冰、暂存区有空位（链条需2个空位且伙伴也满足条件）
 * 需求：4.2, 4.4, 4.5
 * @param {number} row - 元素行
 * @param {number} col - 元素列
 * @returns {boolean}
 */
YarnLevel.LevelValidator.prototype._canMove = function(row, col) {
  var elem = this._elements[row][col];

  // 1. 元素非空(id>0)且非黑块(id!=-1)
  if (elem.id <= 0 || elem.id === -1) {
    return false;
  }

  // 2. 管道元素(type 11-14)永远不可移动
  if (this._findTypeInRange(elem.type, 11, 14) !== -1) {
    return false;
  }

  // 3. 元素处于激活状态
  if (!this._activeMap[row][col]) {
    return false;
  }

  // 4. 元素无未消除的锁(type 31-35 still in _lockMap)
  var lockType = this._findTypeInRange(elem.type, 31, 35);
  if (lockType !== -1 && this._lockMap[lockType] && this._lockMap[lockType].length > 0) {
    return false;
  }

  // 5. 元素无未消除的冰块(iceCount >= 0 && < 4 means ice still present)
  if (this._iceCountMap[row][col] >= 0 && this._iceCountMap[row][col] < 4) {
    return false;
  }

  // 6. 链条元素检查
  if (this._hasType(elem.type, 5)) {
    // 找到链条伙伴
    var partner = null;
    for (var i = 0; i < this._chainPairs.length; i++) {
      var pair = this._chainPairs[i];
      if (pair.row1 === row && pair.col1 === col) {
        partner = { row: pair.row2, col: pair.col2 };
        break;
      }
      if (pair.row2 === row && pair.col2 === col) {
        partner = { row: pair.row1, col: pair.col1 };
        break;
      }
    }

    if (partner) {
      var partnerElem = this._elements[partner.row][partner.col];

      // 伙伴必须非空非黑块
      if (partnerElem.id <= 0 || partnerElem.id === -1) {
        return false;
      }

      // 伙伴不能是管道元素
      if (this._findTypeInRange(partnerElem.type, 11, 14) !== -1) {
        return false;
      }

      // 伙伴必须已激活
      if (!this._activeMap[partner.row][partner.col]) {
        return false;
      }

      // 伙伴无未消除的锁
      var partnerLockType = this._findTypeInRange(partnerElem.type, 31, 35);
      if (partnerLockType !== -1 && this._lockMap[partnerLockType] && this._lockMap[partnerLockType].length > 0) {
        return false;
      }

      // 伙伴无未消除的冰块
      if (this._iceCountMap[partner.row][partner.col] >= 0 && this._iceCountMap[partner.row][partner.col] < 4) {
        return false;
      }

      // 链条需要暂存区至少2个空位
      if (6 - this._buffer.length < 2) {
        return false;
      }
    } else {
      // 链条元素但找不到伙伴，需要至少1个空位
      if (6 - this._buffer.length < 1) {
        return false;
      }
    }
  } else {
    // 非链条元素：暂存区至少1个空位
    if (6 - this._buffer.length < 1) {
      return false;
    }
  }

  return true;
};

// ==================== 元素移动选择策略 ====================

/**
 * 在所有可移动元素中，优先选择能被目标区匹配消除的元素
 * 若无可匹配元素，选择第一个可移动元素占用暂存区
 * 扫描顺序：从左到右、从上到下（行优先，即先遍历列再换行）
 * 需求：4.1, 4.2, 4.3, 4.4
 * @returns {{row: number, col: number}|null}
 */
YarnLevel.LevelValidator.prototype._selectBestMovableElement = function() {
  // 1. 收集所有可移动元素（从左到右、从上到下：行优先）
  var movableList = [];

  for (var r = 0; r < this._elements.length; r++) {
    for (var c = 0; c < this._elements[r].length; c++) {
      if (this._canMove(r, c)) {
        movableList.push({ row: r, col: c });
      }
    }
  }

  if (movableList.length === 0) {
    return null;
  }

  // 2. 预计算目标区维度
  var targetRows = this._target.length;
  var targetCols = 0;
  for (var r = 0; r < targetRows; r++) {
    if (this._target[r].length > targetCols) {
      targetCols = this._target[r].length;
    }
  }

  // 3. 对每个可移动元素，预判其颜色能否匹配消除3个
  for (var i = 0; i < movableList.length; i++) {
    var pos = movableList[i];
    var colorId = this._elements[pos.row][pos.col].id;
    var totalMatchable = 0;

    for (var tc = 0; tc < targetCols; tc++) {
      // 找到该列最下方的非空元素行索引
      var bottomRow = -1;
      for (var tr = targetRows - 1; tr >= 0; tr--) {
        if (tc < this._target[tr].length && this._target[tr][tc].id > 0) {
          bottomRow = tr;
          break;
        }
      }

      if (bottomRow === -1) continue; // 该列为空

      var bottomElem = this._target[bottomRow][tc];

      // 问号元素(type=1)仅在该列最下方非空位置时才能识别颜色
      // 由于 bottomRow 就是最下方非空元素，问号在此位置可以识别
      var bottomColor = bottomElem.id;

      // 非问号元素直接用颜色，问号元素在底部也可识别
      // 但如果问号不在底部（上方的问号），则不可识别 —— 这在向上检查时处理

      if (bottomColor !== colorId) continue;

      // 该列底部匹配，计算从底部向上连续相同颜色的数量（最多3个）
      var colMatchCount = 1; // 底部已匹配1个

      for (var up = 1; up <= 2; up++) {
        var checkRow = bottomRow - up;
        if (checkRow < 0 || tc >= this._target[checkRow].length) break;

        var upperElem = this._target[checkRow][tc];
        if (upperElem.id <= 0) break; // 空位，停止

        // 向上检查时，每个元素在前一个被消除后会变成最下一行
        // 所以问号元素在此预判中也可以识别颜色
        if (upperElem.id === colorId) {
          colMatchCount++;
        } else {
          break; // 颜色不匹配，停止
        }
      }

      totalMatchable += colMatchCount;
    }

    if (totalMatchable >= 3) {
      return pos;
    }
  }

  // 4. 所有可移动元素都无法匹配消除，选择第一个可移动元素
  return movableList[0];
};

// ==================== 元素移动执行 ====================

/**
 * 执行元素移动：将元素从元素区移入暂存区，处理链条、钥匙等特殊功能
 * 需求：3.3, 4.4, 4.5, 7.1
 * @param {number} row - 要移动的元素行
 * @param {number} col - 要移动的元素列
 */
YarnLevel.LevelValidator.prototype._moveElement = function(row, col) {
  var elem = this._elements[row][col];
  var movedColorId = elem.id;

  // 1. 将元素颜色(id)加入暂存区
  this._buffer.push(elem.id);

  // 日志：移动元素
  this._log.push({
    step: this._step,
    action: 'move',
    desc: '移动元素区(' + row + ',' + col + ')颜色' + movedColorId + ' → 暂存区',
    buffer: this._buffer.slice()
  });

  // 2. 检查元素是否带有钥匙(type 21-25)，如有则解锁对应的锁
  var keyType = this._findTypeInRange(elem.type, 21, 25);
  if (keyType !== -1) {
    this._log.push({
      step: this._step,
      action: 'unlock',
      desc: '钥匙' + keyType + '解锁对应的锁' + KEY_LOCK_MAP[keyType],
      buffer: this._buffer.slice()
    });
    this._processKeyUnlock(keyType);
  }

  // 3. 将原位置设为空
  this._elements[row][col] = { id: 0, type: 0, param: 0 };

  // 4. 重置冰块损耗计数
  this._iceCountMap[row][col] = -1;

  // 5. 激活相邻元素
  this._activateAdjacent(row, col);

  // 6. 如果元素带有链条(type含5)，同时移动绑定伙伴
  if (this._hasType(elem.type, 5)) {
    var partner = null;
    for (var i = 0; i < this._chainPairs.length; i++) {
      var pair = this._chainPairs[i];
      if (pair.row1 === row && pair.col1 === col) {
        partner = { row: pair.row2, col: pair.col2 };
        break;
      }
      if (pair.row2 === row && pair.col2 === col) {
        partner = { row: pair.row1, col: pair.col1 };
        break;
      }
    }

    if (partner) {
      var partnerElem = this._elements[partner.row][partner.col];

      // 6a. 将伙伴颜色加入暂存区
      this._buffer.push(partnerElem.id);

      this._log.push({
        step: this._step,
        action: 'chain',
        desc: '链条联动：移动元素区(' + partner.row + ',' + partner.col + ')颜色' + partnerElem.id + ' → 暂存区',
        buffer: this._buffer.slice()
      });

      // 6b. 检查伙伴是否带有钥匙
      var partnerKeyType = this._findTypeInRange(partnerElem.type, 21, 25);
      if (partnerKeyType !== -1) {
        this._processKeyUnlock(partnerKeyType);
      }

      // 6c. 将伙伴位置设为空
      this._elements[partner.row][partner.col] = { id: 0, type: 0, param: 0 };

      // 6d. 重置伙伴冰块损耗计数
      this._iceCountMap[partner.row][partner.col] = -1;

      // 6e. 激活伙伴相邻元素
      this._activateAdjacent(partner.row, partner.col);
    }
  }
};

// ==================== 暂存区与目标区匹配消除 ====================

/**
 * 暂存区元素与目标区匹配消除
 * 按从下到上、从左到右的顺序搜索目标区，仅删除每列最下方的非空元素
 * 每删除一个匹配颜色后该列上方元素下移一行，连续删除3个后停止并从暂存区移除该元素
 * 问号元素(type=1)仅在该列最下方非空位置时才能识别颜色
 * 需求：8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 * @param {number} colorId - 要匹配的颜色ID
 */
YarnLevel.LevelValidator.prototype._matchAndEliminate = function(colorId) {
  var matchCount = 0;
  var targetRows = this._target.length;
  var eliminatedPositions = [];

  // 从目标区最后一行开始向上遍历，每行从左到右遍历
  for (var scanRow = targetRows - 1; scanRow >= 0; scanRow--) {
    var cols = this._target[scanRow].length;

    for (var col = 0; col < cols; col++) {
      // 对该列找到最下方的非空元素
      var bottomRow = -1;
      for (var r = targetRows - 1; r >= 0; r--) {
        if (col < this._target[r].length && this._target[r][col].id > 0) {
          bottomRow = r;
          break;
        }
      }

      // 该列无非空元素，跳过
      if (bottomRow === -1) continue;

      var bottomElem = this._target[bottomRow][col];

      // 问号元素(type=1)在最下方非空位置时可以识别颜色
      // 非问号元素直接比较颜色
      if (bottomElem.id === colorId) {
        eliminatedPositions.push({ row: bottomRow, col: col });

        // a. 删除该元素并执行列重力（上方元素下移一行）
        for (var shiftRow = bottomRow; shiftRow > 0; shiftRow--) {
          if (col < this._target[shiftRow - 1].length) {
            this._target[shiftRow][col].id = this._target[shiftRow - 1][col].id;
            this._target[shiftRow][col].type = this._target[shiftRow - 1][col].type;
          } else {
            this._target[shiftRow][col].id = 0;
            this._target[shiftRow][col].type = 0;
          }
        }
        // 最顶行变为空
        if (col < this._target[0].length) {
          this._target[0][col].id = 0;
          this._target[0][col].type = 0;
        }

        // b. matchCount++
        matchCount++;

        // c. 如果 matchCount == 3，停止搜索，从暂存区删除该元素
        if (matchCount === 3) {
          var bufferIndex = this._buffer.indexOf(colorId);
          if (bufferIndex !== -1) {
            this._buffer.splice(bufferIndex, 1);
          }
          // 日志：消除成功
          var colDesc = eliminatedPositions.map(function(p) { return '第' + p.col + '列'; }).join('、');
          // 获取目标区删除后最后两行内容
          var lastRows = this._getTargetLastRows(2);
          this._log.push({
            step: this._step,
            action: 'eliminate',
            desc: '目标区消除颜色' + colorId + ' ×3：' + colDesc + ' → 暂存区移除颜色' + colorId,
            targetLastRows: lastRows,
            buffer: this._buffer.slice()
          });
          return;
        }
      }
    }
  }

  // 遍历完毕 matchCount < 3，元素留在暂存区
};

// ==================== 验证结果判定 ====================

/**
 * 判断关卡是否全部消除完毕（验证成功）
 * 检查条件：元素区所有元素已消除（空/黑块/管道）、目标区所有颜色已消除、暂存区为空
 * 需求：9.1
 * @returns {boolean}
 */
YarnLevel.LevelValidator.prototype._isComplete = function() {
  // 1. 检查元素区：所有元素 id <= 0（空或黑块）或为管道元素(type 11-14)
  for (var r = 0; r < this._elements.length; r++) {
    for (var c = 0; c < this._elements[r].length; c++) {
      var elem = this._elements[r][c];
      if (elem.id > 0) {
        // 有正ID的元素，检查是否为管道
        if (this._findTypeInRange(elem.type, 11, 14) === -1) {
          return false; // 非管道的正ID元素仍存在
        }
      }
    }
  }

  // 2. 检查目标区：所有元素 id <= 0（空）
  for (var r = 0; r < this._target.length; r++) {
    for (var c = 0; c < this._target[r].length; c++) {
      if (this._target[r][c].id > 0) {
        return false; // 目标区仍有未消除的颜色
      }
    }
  }

  // 3. 检查暂存区为空
  if (this._buffer.length > 0) {
    return false;
  }

  return true;
};

/**
 * 判断是否死锁（无法继续）
 * 死锁条件：暂存区已满(>=6)，或无可移动元素且关卡未完成
 * 需求：9.3, 9.5
 * @returns {boolean}
 */
YarnLevel.LevelValidator.prototype._isDeadlock = function() {
  // 条件1：暂存区已满
  if (this._buffer.length >= 6) {
    return true;
  }

  // 条件2：无可移动元素且关卡未完成
  var bestMove = this._selectBestMovableElement();
  if (bestMove === null && !this._isComplete()) {
    return true;
  }

  return false;
};

// ==================== 模拟主循环 ====================

/**
 * 执行模拟主循环
 * 循环：选择最佳元素 → 移动元素 → 冰块损耗 → 管道放置 → 匹配消除 → 检查完成/死锁
 * 需求：9.1, 9.2, 9.3, 9.4, 9.5
 * @returns {{success: boolean, message: string, details: {remainingTarget: number, remainingElement: number, bufferCount: number, reason: string}}}
 */
YarnLevel.LevelValidator.prototype._runSimulation = function() {
  var MAX_ITERATIONS = 10000;

  for (var iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    this._step = iteration + 1;

    // a. 选择最佳可移动元素
    var best = this._selectBestMovableElement();

    // b. 无可移动元素
    if (best === null) {
      if (this._isComplete()) {
        return {
          success: true,
          message: '验证成功：关卡可以通关',
          log: this._log,
          details: {
            remainingTarget: 0,
            remainingElement: 0,
            bufferCount: 0,
            reason: ''
          }
        };
      }
      // 死锁：无可移动元素但关卡未完成
      this._log.push({
        step: this._step,
        action: 'deadlock',
        desc: '无可移动元素，关卡死锁',
        buffer: this._buffer.slice()
      });
      return {
        success: false,
        message: '验证失败：无可移动元素，关卡死锁',
        log: this._log,
        details: {
          remainingTarget: this._countRemainingTarget(),
          remainingElement: this._countRemainingElement(),
          bufferCount: this._buffer.length,
          reason: 'no_movable_element'
        }
      };
    }

    // c. 移动元素
    this._moveElement(best.row, best.col);

    // d. 冰块损耗
    this._processIceDamage();

    // e. 管道放置
    this._processPipes();

    // f. 匹配消除：尝试对暂存区中每个元素进行匹配，重复直到无更多匹配
    var matched = true;
    while (matched) {
      matched = false;
      for (var i = 0; i < this._buffer.length; i++) {
        var prevLen = this._buffer.length;
        this._matchAndEliminate(this._buffer[i]);
        if (this._buffer.length < prevLen) {
          // 一个元素被消除了，重新从头开始检查
          matched = true;
          break;
        }
      }
    }

    // g. 检查是否完成
    if (this._isComplete()) {
      this._log.push({
        step: this._step,
        action: 'complete',
        desc: '关卡通关',
        buffer: []
      });
      return {
        success: true,
        message: '验证成功：关卡可以通关',
        log: this._log,
        details: {
          remainingTarget: 0,
          remainingElement: 0,
          bufferCount: 0,
          reason: ''
        }
      };
    }

    // h. 检查是否死锁（暂存区满且无法消除）
    if (this._buffer.length >= 6) {
      this._log.push({
        step: this._step,
        action: 'buffer_full',
        desc: '暂存区已满(' + this._buffer.map(function(id) { return '颜色' + id; }).join(', ') + ')，无法继续',
        buffer: this._buffer.slice()
      });
      return {
        success: false,
        message: '验证失败：暂存区已满，无法继续移动',
        log: this._log,
        details: {
          remainingTarget: this._countRemainingTarget(),
          remainingElement: this._countRemainingElement(),
          bufferCount: this._buffer.length,
          reason: 'buffer_full'
        }
      };
    }
  }

  // 超过最大迭代次数
  return {
    success: false,
    message: '验证失败：超过最大迭代次数(' + MAX_ITERATIONS + ')，可能存在无限循环',
    log: this._log,
    details: {
      remainingTarget: this._countRemainingTarget(),
      remainingElement: this._countRemainingElement(),
      bufferCount: this._buffer.length,
      reason: 'max_iterations'
    }
  };
};

/**
 * 获取目标区最后N行的内容（从下往上取非全空行）
 * @param {number} n - 行数
 * @returns {Array<{rowIndex: number, cells: Array<number>}>}
 */
YarnLevel.LevelValidator.prototype._getTargetLastRows = function(n) {
  var result = [];
  for (var r = this._target.length - 1; r >= 0 && result.length < n; r--) {
    var row = this._target[r];
    var cells = [];
    for (var c = 0; c < row.length; c++) {
      cells.push(row[c].id);
    }
    result.unshift({ rowIndex: r, cells: cells });
  }
  return result;
};

/**
 * 统计目标区剩余颜色数（id > 0 的元素数量）
 * @returns {number}
 */
YarnLevel.LevelValidator.prototype._countRemainingTarget = function() {
  var count = 0;
  for (var r = 0; r < this._target.length; r++) {
    for (var c = 0; c < this._target[r].length; c++) {
      if (this._target[r][c].id > 0) {
        count++;
      }
    }
  }
  return count;
};

/**
 * 统计元素区剩余可移动元素数（id > 0 且非管道的元素数量）
 * @returns {number}
 */
YarnLevel.LevelValidator.prototype._countRemainingElement = function() {
  var count = 0;
  for (var r = 0; r < this._elements.length; r++) {
    for (var c = 0; c < this._elements[r].length; c++) {
      var elem = this._elements[r][c];
      if (elem.id > 0 && this._findTypeInRange(elem.type, 11, 14) === -1) {
        count++;
      }
    }
  }
  return count;
};
