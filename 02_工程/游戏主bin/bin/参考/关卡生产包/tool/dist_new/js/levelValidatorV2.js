/**
 * 毛线关卡生成工具 - 关卡验证器V2
 * 方案二：目标区驱动的验证算法
 * 从目标区出发，先分析需要什么颜色，再从元素区找对应元素移动
 * 消除规则：优先最下一行横向凑3个，再列内纵向凑3个
 */

var YarnLevel = YarnLevel || {};

// 复用V1的常量
// var PIPE_DIRECTION_OFFSET 和 KEY_LOCK_MAP 已在 levelValidator.js 中定义

// ==================== LevelValidatorV2 构造函数 ====================

YarnLevel.LevelValidatorV2 = function(targetData, elementData) {
  this._target = YarnLevel.cloneBlocks(targetData);
  this._elements = YarnLevel.cloneSpools(elementData);
  this._buffer = [];
  this._activeMap = [];
  this._iceCountMap = [];
  this._lockMap = {};
  this._pipeState = [];
  this._chainPairs = [];
  this._log = [];
  this._step = 0;
};

// ==================== 公开方法 ====================

YarnLevel.LevelValidatorV2.prototype.validate = function() {
  try {
    var preconditionResult = this._checkPreconditions();
    if (!preconditionResult.success) {
      preconditionResult.log = [];
      return preconditionResult;
    }
    this._initActiveState();
    this._initSpecialState();
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

// ==================== 复用V1的基础方法 ====================
// 以下方法逻辑与V1完全一致，直接复用

YarnLevel.LevelValidatorV2.prototype._initActiveState =
  YarnLevel.LevelValidator.prototype._initActiveState;

YarnLevel.LevelValidatorV2.prototype._activateAdjacent =
  YarnLevel.LevelValidator.prototype._activateAdjacent;

YarnLevel.LevelValidatorV2.prototype._checkPreconditions =
  YarnLevel.LevelValidator.prototype._checkPreconditions;

YarnLevel.LevelValidatorV2.prototype._hasType =
  YarnLevel.LevelValidator.prototype._hasType;

YarnLevel.LevelValidatorV2.prototype._findTypeInRange =
  YarnLevel.LevelValidator.prototype._findTypeInRange;

YarnLevel.LevelValidatorV2.prototype._initSpecialState =
  YarnLevel.LevelValidator.prototype._initSpecialState;

YarnLevel.LevelValidatorV2.prototype._processIceDamage =
  YarnLevel.LevelValidator.prototype._processIceDamage;

YarnLevel.LevelValidatorV2.prototype._processPipes =
  YarnLevel.LevelValidator.prototype._processPipes;

YarnLevel.LevelValidatorV2.prototype._processKeyUnlock =
  YarnLevel.LevelValidator.prototype._processKeyUnlock;

YarnLevel.LevelValidatorV2.prototype._canMove =
  YarnLevel.LevelValidator.prototype._canMove;

YarnLevel.LevelValidatorV2.prototype._moveElement =
  YarnLevel.LevelValidator.prototype._moveElement;

YarnLevel.LevelValidatorV2.prototype._isComplete =
  YarnLevel.LevelValidator.prototype._isComplete;

YarnLevel.LevelValidatorV2.prototype._getTargetLastRows =
  YarnLevel.LevelValidator.prototype._getTargetLastRows;

YarnLevel.LevelValidatorV2.prototype._countRemainingTarget =
  YarnLevel.LevelValidator.prototype._countRemainingTarget;

YarnLevel.LevelValidatorV2.prototype._countRemainingElement =
  YarnLevel.LevelValidator.prototype._countRemainingElement;


// ==================== V2 新增：收集可移动元素列表 ====================

/**
 * 收集所有可移动元素，按从左到右、从上到下顺序
 * @returns {Array<{row: number, col: number, colorId: number}>}
 */
YarnLevel.LevelValidatorV2.prototype._collectMovableElements = function() {
  var list = [];
  for (var r = 0; r < this._elements.length; r++) {
    for (var c = 0; c < this._elements[r].length; c++) {
      if (this._canMove(r, c)) {
        list.push({ row: r, col: c, colorId: this._elements[r][c].id });
      }
    }
  }
  return list;
};

// ==================== V2 新增：分析目标区需求（带优先级） ====================

/**
 * 分析目标区最下一行，构建等待删除列表（带优先级）
 * 高优先级：最下一行直接凑齐3个同色
 * 低优先级：最下一行1-2个 + 列内向上延伸凑齐3个
 * @returns {Array<{colorId: number, priority: number, positions: Array}>}
 */
YarnLevel.LevelValidatorV2.prototype._analyzeTargetNeeds = function() {
  var targetRows = this._target.length;
  var targetCols = 0;
  for (var r = 0; r < targetRows; r++) {
    if (this._target[r].length > targetCols) {
      targetCols = this._target[r].length;
    }
  }

  // 1. 找到每列最下方的非空元素
  var bottomElements = []; // [{col, row, colorId}]
  for (var c = 0; c < targetCols; c++) {
    for (var r = targetRows - 1; r >= 0; r--) {
      if (c < this._target[r].length && this._target[r][c].id > 0) {
        var elem = this._target[r][c];
        // 问号元素在最下一行时可识别颜色
        bottomElements.push({ col: c, row: r, colorId: elem.id });
        break;
      }
    }
  }

  // 2. 统计最下一行各颜色出现次数
  var colorBottomCount = {};
  var colorBottomPositions = {};
  for (var i = 0; i < bottomElements.length; i++) {
    var be = bottomElements[i];
    var cid = be.colorId;
    if (!colorBottomCount[cid]) {
      colorBottomCount[cid] = 0;
      colorBottomPositions[cid] = [];
    }
    colorBottomCount[cid]++;
    colorBottomPositions[cid].push({ row: be.row, col: be.col });
  }

  var needs = [];

  // 3. 高优先级：最下一行直接凑齐3个
  for (var cid in colorBottomCount) {
    if (colorBottomCount.hasOwnProperty(cid) && colorBottomCount[cid] >= 3) {
      needs.push({
        colorId: Number(cid),
        priority: 1,
        positions: colorBottomPositions[cid].slice(0, 3)
      });
    }
  }

  // 4. 低优先级：最下一行1-2个，列内向上延伸凑齐3个
  for (var cid in colorBottomCount) {
    if (!colorBottomCount.hasOwnProperty(cid)) continue;
    var count = colorBottomCount[cid];
    if (count >= 3) continue; // 已在高优先级处理

    var totalMatchable = count;
    // 对每个底部位置，向上检查临近2行
    var positions = colorBottomPositions[cid].slice();
    for (var p = 0; p < positions.length; p++) {
      var pos = positions[p];
      for (var up = 1; up <= 2 && totalMatchable < 3; up++) {
        var checkRow = pos.row - up;
        if (checkRow < 0 || pos.col >= this._target[checkRow].length) break;
        var upperElem = this._target[checkRow][pos.col];
        if (upperElem.id <= 0) break;
        if (upperElem.id === Number(cid)) {
          totalMatchable++;
        } else {
          break;
        }
      }
    }

    if (totalMatchable >= 3) {
      needs.push({
        colorId: Number(cid),
        priority: 2,
        positions: colorBottomPositions[cid]
      });
    }
  }

  // 按优先级排序（1高于2）
  needs.sort(function(a, b) { return a.priority - b.priority; });

  return needs;
};

// ==================== V2 新增：目标区驱动的元素选择 ====================

/**
 * 根据目标区需求，从可移动列表中选择最佳元素
 * @returns {{row: number, col: number}|null}
 */
YarnLevel.LevelValidatorV2.prototype._selectBestMovableElement = function() {
  var movableList = this._collectMovableElements();
  if (movableList.length === 0) return null;

  // 分析目标区需求
  var needs = this._analyzeTargetNeeds();

  // 按优先级匹配
  for (var i = 0; i < needs.length; i++) {
    var need = needs[i];
    for (var j = 0; j < movableList.length; j++) {
      if (movableList[j].colorId === need.colorId) {
        return { row: movableList[j].row, col: movableList[j].col };
      }
    }
  }

  // 无匹配，选第一个可移动元素
  return { row: movableList[0].row, col: movableList[0].col };
};


// ==================== V2 新增：目标区消除（新规则） ====================

/**
 * 暂存区元素与目标区匹配消除（V2规则）
 * 优先在最下一行横向删除3个同色，删除后统一列下移
 * 如果最下一行凑不齐3个，再按列内纵向凑
 * @param {number} colorId - 要匹配的颜色ID
 */
YarnLevel.LevelValidatorV2.prototype._matchAndEliminate = function(colorId) {
  var targetRows = this._target.length;
  var targetCols = 0;
  for (var r = 0; r < targetRows; r++) {
    if (this._target[r].length > targetCols) {
      targetCols = this._target[r].length;
    }
  }

  // 1. 找到每列最下方的非空元素
  var bottomPositions = []; // 最下一行中匹配colorId的位置
  for (var c = 0; c < targetCols; c++) {
    for (var r = targetRows - 1; r >= 0; r--) {
      if (c < this._target[r].length && this._target[r][c].id > 0) {
        if (this._target[r][c].id === colorId) {
          bottomPositions.push({ row: r, col: c });
        }
        break;
      }
    }
  }

  // 2. 优先横向：最下一行直接凑齐3个
  if (bottomPositions.length >= 3) {
    var toDelete = bottomPositions.slice(0, 3);
    this._eliminatePositions(toDelete, colorId);
    return;
  }

  // 3. 横向不够，尝试列内纵向延伸凑齐
  var allMatchPositions = [];
  for (var i = 0; i < bottomPositions.length; i++) {
    var pos = bottomPositions[i];
    allMatchPositions.push(pos);
    // 向上检查同列
    for (var up = 1; up <= 2 && allMatchPositions.length < 3; up++) {
      var checkRow = pos.row - up;
      if (checkRow < 0 || pos.col >= this._target[checkRow].length) break;
      var upperElem = this._target[checkRow][pos.col];
      if (upperElem.id <= 0) break;
      if (upperElem.id === colorId) {
        allMatchPositions.push({ row: checkRow, col: pos.col });
      } else {
        break;
      }
    }
    if (allMatchPositions.length >= 3) break;
  }

  // 4. 如果还不够3个，尝试V1的逐列扫描方式
  if (allMatchPositions.length < 3) {
    allMatchPositions = [];
    for (var c = 0; c < targetCols; c++) {
      var bottomRow = -1;
      for (var r = targetRows - 1; r >= 0; r--) {
        if (c < this._target[r].length && this._target[r][c].id > 0) {
          bottomRow = r;
          break;
        }
      }
      if (bottomRow === -1) continue;
      if (this._target[bottomRow][c].id !== colorId) continue;

      allMatchPositions.push({ row: bottomRow, col: c });
      for (var up = 1; up <= 2 && allMatchPositions.length < 3; up++) {
        var checkRow = bottomRow - up;
        if (checkRow < 0 || c >= this._target[checkRow].length) break;
        if (this._target[checkRow][c].id === colorId) {
          allMatchPositions.push({ row: checkRow, col: c });
        } else {
          break;
        }
      }
      if (allMatchPositions.length >= 3) break;
    }
  }

  if (allMatchPositions.length >= 3) {
    this._eliminatePositions(allMatchPositions.slice(0, 3), colorId);
  }
  // 不够3个则不消除，元素留在暂存区
};

/**
 * 一次性删除指定位置的目标区元素，然后统一执行列下移
 * @param {Array<{row: number, col: number}>} positions - 要删除的位置列表
 * @param {number} colorId - 被消除的颜色ID
 */
YarnLevel.LevelValidatorV2.prototype._eliminatePositions = function(positions, colorId) {
  // 按列分组，每列内按行从大到小排序（从下往上删）
  var colGroups = {};
  for (var i = 0; i < positions.length; i++) {
    var p = positions[i];
    if (!colGroups[p.col]) colGroups[p.col] = [];
    colGroups[p.col].push(p.row);
  }

  for (var col in colGroups) {
    if (!colGroups.hasOwnProperty(col)) continue;
    var rows = colGroups[col];
    rows.sort(function(a, b) { return b - a; }); // 从下往上

    var c = Number(col);
    for (var i = 0; i < rows.length; i++) {
      var deleteRow = rows[i];
      // 列下移：从删除行开始，上方元素依次下移
      for (var shiftRow = deleteRow; shiftRow > 0; shiftRow--) {
        if (c < this._target[shiftRow - 1].length) {
          this._target[shiftRow][c].id = this._target[shiftRow - 1][c].id;
          this._target[shiftRow][c].type = this._target[shiftRow - 1][c].type;
        } else {
          this._target[shiftRow][c].id = 0;
          this._target[shiftRow][c].type = 0;
        }
      }
      // 最顶行变为空
      if (c < this._target[0].length) {
        this._target[0][c].id = 0;
        this._target[0][c].type = 0;
      }

      // 后续同列的删除行需要+1（因为上方元素已下移）
      for (var j = i + 1; j < rows.length; j++) {
        if (rows[j] < deleteRow) {
          rows[j]++;
        }
      }
    }
  }

  // 从暂存区移除该颜色
  var bufferIndex = this._buffer.indexOf(colorId);
  if (bufferIndex !== -1) {
    this._buffer.splice(bufferIndex, 1);
  }

  var colDesc = positions.map(function(p) { return '(' + p.row + ',' + p.col + ')'; }).join('、');
  var lastRows = this._getTargetLastRows(2);
  this._log.push({
    step: this._step,
    action: 'eliminate',
    desc: '目标区消除颜色' + colorId + ' ×3：' + colDesc + ' → 暂存区移除颜色' + colorId,
    targetLastRows: lastRows,
    buffer: this._buffer.slice()
  });
};


// ==================== V2 新增：死锁判定 ====================

YarnLevel.LevelValidatorV2.prototype._isDeadlock = function() {
  if (this._buffer.length >= 6) return true;
  var best = this._selectBestMovableElement();
  if (best === null && !this._isComplete()) return true;
  return false;
};

// ==================== V2 模拟主循环 ====================

YarnLevel.LevelValidatorV2.prototype._runSimulation = function() {
  var MAX_ITERATIONS = 10000;

  for (var iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    this._step = iteration + 1;

    // a. 选择最佳可移动元素（目标区驱动）
    var best = this._selectBestMovableElement();

    // b. 无可移动元素
    if (best === null) {
      if (this._isComplete()) {
        return {
          success: true,
          message: '验证成功：关卡可以通关（方案二）',
          log: this._log,
          details: {
            remainingTarget: 0,
            remainingElement: 0,
            bufferCount: 0,
            reason: ''
          }
        };
      }
      this._log.push({
        step: this._step,
        action: 'deadlock',
        desc: '无可移动元素，关卡死锁',
        buffer: this._buffer.slice()
      });
      return {
        success: false,
        message: '验证失败：无可移动元素，关卡死锁（方案二）',
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

    // f. 匹配消除：循环直到无更多匹配
    var matched = true;
    while (matched) {
      matched = false;
      for (var i = 0; i < this._buffer.length; i++) {
        var prevLen = this._buffer.length;
        this._matchAndEliminate(this._buffer[i]);
        if (this._buffer.length < prevLen) {
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
        desc: '关卡通关（方案二）',
        buffer: []
      });
      return {
        success: true,
        message: '验证成功：关卡可以通关（方案二）',
        log: this._log,
        details: {
          remainingTarget: 0,
          remainingElement: 0,
          bufferCount: 0,
          reason: ''
        }
      };
    }

    // h. 暂存区满
    if (this._buffer.length >= 6) {
      this._log.push({
        step: this._step,
        action: 'buffer_full',
        desc: '暂存区已满(' + this._buffer.map(function(id) { return '颜色' + id; }).join(', ') + ')，无法继续',
        buffer: this._buffer.slice()
      });
      return {
        success: false,
        message: '验证失败：暂存区已满，无法继续移动（方案二）',
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

  return {
    success: false,
    message: '验证失败：超过最大迭代次数(' + MAX_ITERATIONS + ')（方案二）',
    log: this._log,
    details: {
      remainingTarget: this._countRemainingTarget(),
      remainingElement: this._countRemainingElement(),
      bufferCount: this._buffer.length,
      reason: 'max_iterations'
    }
  };
};
