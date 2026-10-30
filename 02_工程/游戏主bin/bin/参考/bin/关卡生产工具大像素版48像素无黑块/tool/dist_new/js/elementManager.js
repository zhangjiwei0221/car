/**
 * 像素毛线关卡生成工具 - 元素区管理器
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
      row.push(YarnLevel.createSpoolElement(0, 0, 0, 0));
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
        this._spools[row][col].count = 0;
      }
    }
  }
};

YarnLevel.ElementZoneManager.prototype.updateCell = function(row, col, colorId) {
  if (row < 0 || row >= this._spools.length) return false;
  if (col < 0 || col >= this._spools[row].length) return false;
  if (typeof colorId !== 'number') return false;
  if (this._spools[row][col].id === -1) return false;
  if (this.isPipeElement(row, col)) {
    this._spools[row][col].type = 0;
    this._spools[row][col].param = 0;
  }
  this._spools[row][col].id = colorId;
  this._spools[row][col].count = 0;
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
  this._spools[row][col].param = [];
  this._spools[row][col].count = 0;
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
  this._spools[row][col].count = 0;
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
  this._spools[row][col].count = 0;
  return true;
};

YarnLevel.ElementZoneManager.prototype.resetElements = function() {
  // 清空所有颜色元素和自动生成的特殊功能（冰块4、链条5、问号6），保留黑块和手动放置的特殊元素
  for (var row = 0; row < this._spools.length; row++) {
    for (var col = 0; col < this._spools[row].length; col++) {
      var cell = this._spools[row][col];
      if (cell.id === -1) continue;  // 保留黑块
      
      var originalType = cell.type;

      // 清空颜色
      cell.id = 0;
      cell.param = this.isPipeElement(row, col) ? [] : 0;
      cell.count = 0;
      
      // 只清空自动生成的特殊功能（冰块4、链条5、问号6）
      var type = originalType;
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
  if (this.isPipeElement(row, col)) return false;
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
  this._spools[row][col].param = YarnLevel.clonePipeParam(elements);
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
 * 从数组前部候选范围随机抽取指定数量。
 */
YarnLevel.ElementZoneManager.prototype._pickFromCandidateRange = function(list, rangeSize, count) {
  var actualRange = Math.min(rangeSize, list.length);
  var actualCount = Math.min(count, actualRange);
  var picked = [];
  for (var i = 0; i < actualCount; i++) {
    var randomIndex = Math.floor(Math.random() * actualRange);
    picked.push(list[randomIndex]);
    list.splice(randomIndex, 1);
    actualRange--;
  }
  return { picked: picked, remainder: Math.max(0, actualRange) };
};

YarnLevel.ElementZoneManager.prototype._placeSpool = function(row, col, spool) {
  this._spools[row][col].id = spool.id;
  this._spools[row][col].type = 0;
  this._spools[row][col].param = 0;
  this._spools[row][col].count = spool.count;
};

/**
 * 同色 4 邻接连通块识别（含 GAP 阻隔容忍，消除栈方向为主判定）。
 *
 * 纯函数、无副作用：仅读取传入的像素矩阵 data，不读写任何实例状态，
 * 作为 _buildPixelSpoolList（任务 1.4）「块切球」的输入。
 *
 * 连通规则：
 *  - 上下左右 4 邻接：相邻的同色像素直接相连。
 *  - GAP > 0 时，仅在「消除栈方向」（同一列、上下相邻）做阻隔容忍：
 *    同一列里相邻的两个同色像素之间夹的非同色单元格数 ≤ GAP 时，仍判为连通并归入同块；
 *    跨列的水平方向不做 GAP 主判定（仅 4 邻接直接相连）。
 *  - GAP = 0 时退化为纯 4 邻接（同一列也只认直接相邻）。
 *  这贴合「底行先消、同列自底向上」的实际消除规则。
 *
 * @param {Array.<Array.<number>>} data 目标图二维像素矩阵（targetManager.getData() 形态），
 *        元素为颜色 id，<= 0 视为空。
 * @param {number} color 目标颜色 id（有效像素恒 > 0）。
 * @param {number} [GAP=1] 阻隔容忍度（整数 >= 0），默认 1；非法/缺省回落到 1。
 * @returns {Array.<Array.<{row:number, col:number}>>} 该颜色的连通块列表，
 *        每块为一组同色像素坐标 [{row, col}, ...]，不重复、不漏。
 */
YarnLevel.ElementZoneManager.prototype.findColorComponents = function(data, color, GAP) {
  if (!data || data.length === 0) return [];
  // GAP 钳制：整数且 >= 0 才采用，否则回落默认 1
  var gap = (typeof GAP === 'number' && isFinite(GAP) && GAP >= 0) ? Math.floor(GAP) : 1;
  var rows = data.length;

  // visited 标记（按行建子数组，兼容不规则行宽），保证不重复归块
  var visited = [];
  for (var vr = 0; vr < rows; vr++) visited[vr] = [];

  var components = [];

  for (var startRow = 0; startRow < rows; startRow++) {
    var startRowArr = data[startRow];
    if (!startRowArr) continue;
    for (var startCol = 0; startCol < startRowArr.length; startCol++) {
      if (startRowArr[startCol] !== color || visited[startRow][startCol]) continue;

      // 从该同色像素出发，BFS 收集一个连通块
      var comp = [];
      var queue = [{ row: startRow, col: startCol }];
      visited[startRow][startCol] = true;

      while (queue.length > 0) {
        var cell = queue.shift();
        var cr = cell.row;
        var cc = cell.col;
        comp.push({ row: cr, col: cc });

        var width = data[cr].length;

        // —— 水平方向：纯 4 邻接（不做 GAP 主判定）——
        if (cc - 1 >= 0 && data[cr][cc - 1] === color && !visited[cr][cc - 1]) {
          visited[cr][cc - 1] = true;
          queue.push({ row: cr, col: cc - 1 });
        }
        if (cc + 1 < width && data[cr][cc + 1] === color && !visited[cr][cc + 1]) {
          visited[cr][cc + 1] = true;
          queue.push({ row: cr, col: cc + 1 });
        }

        // —— 垂直方向（消除栈方向）：GAP 主判定 ——
        // 向上扫描同一列：累计夹的非同色单元格数，遇同色则连通并停止；
        // 一旦夹的数量超过 GAP 即停止（不连通）。仅连相邻（连续）的同色像素。
        var blockersUp = 0;
        for (var nr = cr - 1; nr >= 0; nr--) {
          if (cc >= data[nr].length) break; // 不规则行：该列在此行不存在，停止
          if (data[nr][cc] === color) {
            if (!visited[nr][cc]) {
              visited[nr][cc] = true;
              queue.push({ row: nr, col: cc });
            }
            break; // 连到本列向上最近的同色像素即止，其余由该像素继续 BFS
          }
          blockersUp++;
          if (blockersUp > gap) break;
        }
        // 向下扫描同一列：同理
        var blockersDown = 0;
        for (var dr = cr + 1; dr < rows; dr++) {
          if (cc >= data[dr].length) break;
          if (data[dr][cc] === color) {
            if (!visited[dr][cc]) {
              visited[dr][cc] = true;
              queue.push({ row: dr, col: cc });
            }
            break;
          }
          blockersDown++;
          if (blockersDown > gap) break;
        }
      }

      components.push(comp);
    }
  }

  return components;
};

/**
 * 块 → 球：把一个同色连通块按容量上下限切成线轴（球），超 MAX 沿消除顺序切段。
 *
 * 纯函数、无副作用：仅读取传入的连通块坐标数组，不读写实例状态。
 * 作为 _buildPixelSpoolList（任务 1.4）「块切球」的一步：1.4 对每色每个连通块调用本函数，
 * 把返回的 spools 累加进该色待分配队列，把 smalls 累加进该色小块表（留待任务 1.3 mergeSmalls 合并）。
 *
 * 设 S = 块像素数（component.length）：
 *  - S ∈ [MIN, MAX]：整块作 1 个球 → spools=[{count:S, cells:[...]}]，smalls=[]。
 *  - S < MIN：太小，本块不出球 → spools=[]，smalls=[component]（cells 已按 elimOrder 排序）。
 *  - S > MAX：沿消除顺序把块切成 k 段，先消的段在前，每段尽量均衡并落在 [MIN, MAX]。
 *      段数 k：
 *        · TARGET_AVG = 0（不启用）：k = ceil(S/MAX)，再 while(k>1 且 floor(S/k)<MIN) k--（保证每段≥MIN）。
 *        · TARGET_AVG > 0：k ≈ round(S/TARGET_AVG)，再钳到合法区间 [ceil(S/MAX), max(1,floor(S/MIN))]
 *          （先夹上界 hi 再夹下界 lo，使 MAX 上界优先，避免段超 MAX）。
 *      均分法：base = floor(S/k)，前 rem = S%k 段各 base+1，其余各 base。
 *
 * 消除顺序口径（elimOrder）：
 *  - 若传入函数，则作为 cells 的比较器 (a,b)=>number 使用（由调用方 1.4 定义全局口径）。
 *  - 否则采用默认口径：自底向上（末行→第 0 行，即 row 降序）、行内左到右（col 升序），
 *    与现有 _seq 扫描方向一致，使每个球对应「先后消除的一段」。
 *
 * 返回结构 { spools, smalls }：
 *  - spools：[{ count:number, cells:[{row,col}...] }]，按消除顺序，先消的段在前。
 *      只带 count 与 cells；id 与 _seq 由调用方 1.4 注入（cells 为坐标信息，供 1.4 排序/对齐时按需使用，
 *      不需要则可忽略）。
 *  - smalls：[component...]，每个元素是一块 <MIN 的小块（cells 已按 elimOrder 排序），留待 1.3 合并。
 *
 * @param {Array.<{row:number, col:number}>} component 一个连通块（findColorComponents 的输出元素）。
 * @param {number} MIN 容量下限（软约束）。
 * @param {number} MAX 容量上限。
 * @param {(Function|*)} [elimOrder] 消除顺序口径：传入比较器函数则用之，否则用默认（末行先、行内左到右）。
 * @param {number} [TARGET_AVG=0] 目标平均容量，0=不启用（纯贴图切分）。
 * @returns {{spools: Array.<{count:number, cells:Array}>, smalls: Array.<Array>}}
 */
YarnLevel.ElementZoneManager.prototype.blockToSpools = function(component, MIN, MAX, elimOrder, TARGET_AVG) {
  if (!component || component.length === 0) return { spools: [], smalls: [] };

  // 参数防御：非法值回落到设计默认（MIN=28、MAX=58）；TARGET_AVG 仅 >0 才启用
  var min = (typeof MIN === 'number' && isFinite(MIN) && MIN >= 1) ? Math.floor(MIN) : 28;
  var max = (typeof MAX === 'number' && isFinite(MAX) && MAX >= min) ? Math.floor(MAX) : Math.max(min, 58);
  var avg = (typeof TARGET_AVG === 'number' && isFinite(TARGET_AVG) && TARGET_AVG > 0) ? TARGET_AVG : 0;

  // 消除顺序比较器：优先用调用方传入的口径，否则默认 末行先(row 降序)、行内左到右(col 升序)
  var cmp = (typeof elimOrder === 'function') ? elimOrder : function(a, b) {
    if (a.row !== b.row) return b.row - a.row;
    return a.col - b.col;
  };

  var S = component.length;
  // 按消除顺序排好（不修改入参，先复制）
  var ordered = component.slice().sort(cmp);

  // S ∈ [MIN, MAX]：整块 1 球
  if (S <= max) {
    if (S >= min) {
      return { spools: [{ count: S, cells: ordered }], smalls: [] };
    }
    // S < MIN：太小，留待合并
    return { spools: [], smalls: [ordered] };
  }

  // S > MAX：切段
  var lo = Math.ceil(S / max);                 // 段数下界：保证每段 ≤ MAX
  var hi = Math.max(1, Math.floor(S / min));    // 段数上界：保证每段 ≥ MIN
  var k;
  if (avg > 0) {
    // 朝 TARGET_AVG 靠拢的段数，再钳到 [lo, hi]；先夹 hi 再夹 lo，使 MAX 上界优先
    k = Math.round(S / avg);
    if (k > hi) k = hi;
    if (k < lo) k = lo;
  } else {
    // 纯贴图：ceil(S/MAX) 起步，再缩段数直到 floor(S/k) ≥ MIN
    k = Math.ceil(S / max);
    while (k > 1 && Math.floor(S / k) < min) k--;
  }
  if (k < 1) k = 1;

  // 均分：前 rem 段各 base+1，其余各 base
  var base = Math.floor(S / k);
  var rem = S % k;
  var spools = [];
  var idx = 0;
  for (var i = 0; i < k; i++) {
    var segSize = base + (i < rem ? 1 : 0);
    spools.push({ count: segSize, cells: ordered.slice(idx, idx + segSize) });
    idx += segSize;
  }
  return { spools: spools, smalls: [] };
};

/**
 * 小块合并：把各色 <MIN 的小块按消除顺序相邻累加，合并成落在 [MIN, MAX] 的球。
 *
 * 纯函数、无副作用：仅读取传入的 smallsByColor，不读写任何实例状态。
 * 作为 _buildPixelSpoolList（任务 1.4）的第 3 步：1.4 先用 1.1 找连通块、1.2 块切球，
 * 把每色 <MIN 的小块收进 smallsByColor，再调用本函数得到「额外球」并入各色待分配队列。
 *
 * 与任务 1.2 的衔接（重要）：
 *  - smallsByColor 的结构 = { 颜色id: [ 小块, 小块, ... ] }，键为颜色 id，值为该色小块数组；
 *    其中每个「小块」是 1.2 产出的 smalls 元素，即一块 <MIN 的连通块坐标数组 [{row,col}...]，
 *    且已按 elimOrder 排好序（1.2 在返回前对 cells 做过 ordered 排序）。
 *  - 本函数仍会按 elimOrder 对「同色各小块之间」重排（以每块最先消除的代表像素为序），
 *    再相邻累加，故对 1.2 是否已排序、以及小块内部顺序均不敏感。
 *
 * 合并规则（每个颜色独立处理）：
 *  - 把该色的小块按消除顺序排列（以每块「最先消除的代表像素」= 块内 cmp 最小者为序），
 *    相邻(顺序紧邻)的累加。
 *  - 合并目标 target：
 *      · TARGET_AVG = 0（不启用）：target = MIN，累计 ≥ MIN 即收一个球、重置累计。
 *      · TARGET_AVG > 0：target = clamp(TARGET_AVG, MIN, MAX)，累计 ≥ target 即收。
 *  - 上界保护：若把下一块并入当前累计会超过 MAX，则先收掉当前累计、再用该块开新球，
 *    使收下的球始终不突破 [MIN, MAX] 硬上界（小块恒 <MIN<=MAX，单块独立时不会越界）。
 *  - 破例小球：某色累加到最后仍有余量（该色总量本就 <MIN 且无可并者，或尾段未达 target），
 *    保留为单个小球（允许 <MIN，软约束破例，忠实反映目标图）。
 *
 * @param {Object.<(string|number), Array.<Array.<{row:number, col:number}>>>} smallsByColor
 *        各色的小块列表（键=颜色 id，值=该色 <MIN 小块数组，每个小块为坐标数组）。
 * @param {number} MIN 容量下限（软约束）。
 * @param {number} MAX 容量上限（硬约束，收下的球不破此上界）。
 * @param {(Function|*)} [elimOrder] 消除顺序口径：传入比较器函数 (a,b)=>number 则用之，
 *        否则用默认（末行先 row 降序、行内左到右 col 升序），与 blockToSpools / _seq 扫描一致。
 * @param {number} [TARGET_AVG=0] 目标平均容量，0=不启用（target=MIN）；>0 时 target=clamp(TARGET_AVG,MIN,MAX)。
 * @returns {Array.<{id:number, count:number, cells:Array.<{row:number, col:number}>}>}
 *        合并后产生的额外球列表（id、count 必填；cells 为按 elimOrder 拼接的坐标，供 1.4 衔接；
 *        _seq 不在此注入，由 1.4 自底向上扫描分配）。
 */
YarnLevel.ElementZoneManager.prototype.mergeSmalls = function(smallsByColor, MIN, MAX, elimOrder, TARGET_AVG) {
  if (!smallsByColor || typeof smallsByColor !== 'object') return [];

  // 参数防御：与 blockToSpools 保持一致，非法值回落到设计默认（MIN=28、MAX=58）；TARGET_AVG 仅 >0 启用
  var min = (typeof MIN === 'number' && isFinite(MIN) && MIN >= 1) ? Math.floor(MIN) : 28;
  var max = (typeof MAX === 'number' && isFinite(MAX) && MAX >= min) ? Math.floor(MAX) : Math.max(min, 58);
  var avg = (typeof TARGET_AVG === 'number' && isFinite(TARGET_AVG) && TARGET_AVG > 0) ? TARGET_AVG : 0;

  // 合并目标：TARGET_AVG=0 → MIN；TARGET_AVG>0 → clamp(TARGET_AVG, MIN, MAX)
  var target = min;
  if (avg > 0) {
    target = avg;
    if (target < min) target = min;
    if (target > max) target = max;
  }

  // 消除顺序比较器：优先用调用方传入口径，否则默认 末行先(row 降序)、行内左到右(col 升序)
  var cmp = (typeof elimOrder === 'function') ? elimOrder : function(a, b) {
    if (a.row !== b.row) return b.row - a.row;
    return a.col - b.col;
  };
  // 块间排序比较器（按各块代表像素的消除顺序）；提到循环外避免每色重建
  var repCmp = function(x, y) { return cmp(x.rep, y.rep); };

  var extraSpools = [];

  for (var color in smallsByColor) {
    if (!Object.prototype.hasOwnProperty.call(smallsByColor, color)) continue;
    var blocks = smallsByColor[color];
    if (!Array.isArray(blocks) || blocks.length === 0) continue;

    var id = parseInt(color, 10);

    // 过滤空块；为每块取「最先消除的代表像素」(块内 cmp 最小者)用于块间排序
    var usable = [];
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      if (!Array.isArray(blk) || blk.length === 0) continue;
      var rep = blk[0];
      for (var ci = 1; ci < blk.length; ci++) {
        if (cmp(blk[ci], rep) < 0) rep = blk[ci];
      }
      usable.push({ cells: blk, size: blk.length, rep: rep });
    }
    if (usable.length === 0) continue;

    // 同色小块按消除顺序排列（代表像素先消者在前）
    usable.sort(repCmp);

    var acc = 0;
    var accCells = [];
    for (var u = 0; u < usable.length; u++) {
      var s = usable[u].size;
      // 上界保护：再并入会超过 MAX 时，先收当前累计、再用该块开新球（不破 [MIN, MAX] 上界）
      if (acc > 0 && acc + s > max) {
        extraSpools.push({ id: id, count: acc, cells: accCells });
        acc = 0;
        accCells = [];
      }
      acc += s;
      accCells = accCells.concat(usable[u].cells);
      // 累计达到合并目标即收一个球
      if (acc >= target) {
        extraSpools.push({ id: id, count: acc, cells: accCells });
        acc = 0;
        accCells = [];
      }
    }
    // 尾部余量：保留为单个小球（可能 <MIN，软约束破例）
    if (acc > 0) {
      extraSpools.push({ id: id, count: acc, cells: accCells });
    }
  }

  return extraSpools;
};

/**
 * 总装配：把目标图同色连通块切分成线轴（球）列表，并维持消除顺序序号 _seq。
 *
 * 三步装配（调用任务 1.1/1.2/1.3 的已就绪辅助函数）：
 *   1) findColorComponents(data, color, GAP)  —— 按色找同色 4 邻接连通块（含 GAP 阻隔容忍）。
 *   2) blockToSpools(comp, MIN, MAX, elimOrder, TARGET_AVG) —— 每块切球：spools 累加进该色待分配队列，
 *      smalls(<MIN) 收进 smallsByColor。
 *   3) mergeSmalls(smallsByColor, MIN, MAX, elimOrder, TARGET_AVG) —— 小块合并成额外球，并入各色队列。
 * 然后沿用现有「自底向上（末行→第 0 行）、行内左到右首现」扫描，为每球分配连续 _seq，输出 sorted。
 *
 * 各色队列在扫描前按消除顺序（以每球最先消除的代表像素为序）排好，使先消的球（底部块）先被分配 _seq，
 * 球容量与其所在块对齐。扫描取色判定沿用现状：data[r][c] 直接是颜色 id（<=0 视为空）。
 *
 * 接口契约（保持不变）：返回数组元素 { id, count, _seq }，已按消除顺序升序排好；下游摆球/灌管道不改。
 *
 * 四不变量：
 *   ① 守恒：每色所有球 count 之和 = 该色像素总数（辅助函数保证）。
 *   ② 容量边界：除「该色总量本就 <MIN 且无可并」的破例小球外，每球 count ∈ [MIN, MAX]。
 *   ③ 顺序契约：_seq 为 0..(球数-1) 连续无重复、升序。
 *   ④ 结构契约：每项含 id、count、_seq。
 *
 * 参数签名兼容：
 *   - 新签名：opts 对象 { spoolMin, spoolMax, spoolGap, spoolAvg }。
 *   - 向后兼容：若第二参传入的是数字（旧的 spoolBasePixelCount，如 48），按 design 风险条第 4 点
 *     「等价默认范围映射」从简处理——直接采用默认范围 MIN=28 / MAX=58 / GAP=1 / AVG=0（不以该数字为中心）。
 *   - 默认值：MIN=28、MAX=58、GAP=1、AVG=0（不启用）。边界钳制：MAX≥MIN；GAP≥0；AVG>0 时钳到 [MIN, MAX]。
 *   （注：任务 1.5 会改 generateBaseElements 改传 opts；本任务先让此函数同时接受 opts 与旧数字，过渡期不报错。）
 *
 * @param {Object} targetManager 目标图管理器，提供 getData() 返回二维像素矩阵（元素为颜色 id，<=0 为空）。
 * @param {(Object|number)} [opts] 切分参数 { spoolMin, spoolMax, spoolGap, spoolAvg }；
 *        或旧的 spoolBasePixelCount 数字（兼容入参，映射为默认范围）。
 * @returns {Array.<{id:number, count:number, _seq:number}>} 按消除顺序升序排好的球列表。
 */
YarnLevel.ElementZoneManager.prototype._buildPixelSpoolList = function(targetManager, opts) {
  var data = targetManager.getData();
  if (!data || data.length === 0) return [];

  // —— 参数解析 + 向后兼容 ——
  // 默认 MIN=28 / MAX=58 / GAP=1 / AVG=0（不启用）。
  var MIN = 28, MAX = 58, GAP = 1, TARGET_AVG = 0;
  if (opts && typeof opts === 'object') {
    if (typeof opts.spoolMin === 'number' && isFinite(opts.spoolMin) && opts.spoolMin >= 1) MIN = Math.floor(opts.spoolMin);
    if (typeof opts.spoolMax === 'number' && isFinite(opts.spoolMax) && opts.spoolMax >= 1) MAX = Math.floor(opts.spoolMax);
    if (typeof opts.spoolGap === 'number' && isFinite(opts.spoolGap) && opts.spoolGap >= 0) GAP = Math.floor(opts.spoolGap);
    if (typeof opts.spoolAvg === 'number' && isFinite(opts.spoolAvg) && opts.spoolAvg > 0) TARGET_AVG = opts.spoolAvg;
  }
  // 旧数字入参（spoolBasePixelCount，如 48）：等价默认范围映射，不读取其它字段，MIN/MAX/GAP/AVG 保持默认。
  // 边界钳制
  if (MAX < MIN) MAX = MIN;
  if (GAP < 0) GAP = 0;
  if (TARGET_AVG > 0) {
    if (TARGET_AVG < MIN) TARGET_AVG = MIN;
    if (TARGET_AVG > MAX) TARGET_AVG = MAX;
  }

  // 消除顺序比较器：末行先（row 降序）、行内左到右（col 升序），与下方 _seq 扫描方向一致。
  var elimOrder = function(a, b) {
    if (a.row !== b.row) return b.row - a.row;
    return a.col - b.col;
  };

  // —— 统计出现的颜色（去重）——
  var colorPresent = {};
  for (var r = 0; r < data.length; r++) {
    var presentRow = data[r];
    if (!presentRow) continue;
    for (var c = 0; c < presentRow.length; c++) {
      var cid0 = presentRow[c];
      if (cid0 > 0) colorPresent[cid0] = true;
    }
  }

  // —— 步骤 1 + 2：按色找连通块 → 块切球；收集 smalls ——
  var queues = {};        // { colorKey: [{ id, count, cells }, ...] } 各色待分配球队列
  var smallsByColor = {}; // { colorKey: [ [{row,col}...], ... ] } 各色 <MIN 小块
  for (var colorKey in colorPresent) {
    if (!Object.prototype.hasOwnProperty.call(colorPresent, colorKey)) continue;
    var color = parseInt(colorKey, 10);
    var comps = this.findColorComponents(data, color, GAP);
    queues[colorKey] = [];
    for (var ki = 0; ki < comps.length; ki++) {
      var res = this.blockToSpools(comps[ki], MIN, MAX, elimOrder, TARGET_AVG);
      var spoolsArr = res.spools || [];
      for (var si = 0; si < spoolsArr.length; si++) {
        queues[colorKey].push({ id: color, count: spoolsArr[si].count, cells: spoolsArr[si].cells });
      }
      var smallsArr = res.smalls || [];
      if (smallsArr.length > 0) {
        if (!smallsByColor[colorKey]) smallsByColor[colorKey] = [];
        for (var mi = 0; mi < smallsArr.length; mi++) smallsByColor[colorKey].push(smallsArr[mi]);
      }
    }
  }

  // —— 步骤 3：小块合并 → 额外球，并入各色队列 ——
  var extra = this.mergeSmalls(smallsByColor, MIN, MAX, elimOrder, TARGET_AVG);
  for (var ei = 0; ei < extra.length; ei++) {
    var eKey = String(extra[ei].id);
    if (!queues[eKey]) queues[eKey] = [];
    queues[eKey].push({ id: extra[ei].id, count: extra[ei].count, cells: extra[ei].cells });
  }

  // —— 各色队列按消除顺序排序（以每球「最先消除的代表像素」为序）——
  // 使自底向上扫描时，先消的球（底部块）先被分配 _seq，球容量与其所在块对齐。
  var repSortCmp = function(x, y) {
    if (x._rep && y._rep) return elimOrder(x._rep, y._rep);
    if (x._rep) return -1;
    if (y._rep) return 1;
    return 0;
  };
  for (var qKey in queues) {
    if (!Object.prototype.hasOwnProperty.call(queues, qKey)) continue;
    var q = queues[qKey];
    for (var qi = 0; qi < q.length; qi++) {
      var ball = q[qi];
      var rep = null;
      var cells = ball.cells;
      if (cells && cells.length > 0) {
        rep = cells[0];
        for (var pi = 1; pi < cells.length; pi++) {
          if (elimOrder(cells[pi], rep) < 0) rep = cells[pi];
        }
      }
      ball._rep = rep;
    }
    q.sort(repSortCmp);
  }

  // —— 总装配：自底向上扫描，为每球分配连续 _seq，输出 sorted ——
  // 取色判定沿用现状：data[r][c] 直接是颜色 id。输出项只保留契约字段 { id, count, _seq }。
  var sorted = [];
  var activeByColor = {};
  var _seq = 0;
  for (var rowIndex = data.length - 1; rowIndex >= 0; rowIndex--) {
    var targetRow = data[rowIndex];
    if (!targetRow) continue;
    for (var colIndex = 0; colIndex < targetRow.length; colIndex++) {
      var cid = targetRow[colIndex];
      if (cid <= 0) continue;
      var key = String(cid);
      var active = activeByColor[key];
      if (!active || active.used >= active.spool.count) {
        var next = queues[key] && queues[key].shift();
        if (!next) continue;
        // _seq = 该球在消除顺序队列中的原始下标（目标图自下而上扫描序），供灌入管道前按消除顺序重排
        var outBall = { id: next.id, count: next.count, _seq: _seq++ };
        active = { spool: outBall, used: 0 };
        activeByColor[key] = active;
        sorted.push(outBall);
      }
      active.used++;
    }
  }
  return sorted;
};

YarnLevel.ElementZoneManager.prototype.generateBaseElements = function(params) {
  var targetManager = params && params.targetManager;
  if (!targetManager) throw new Error('必须提供目标区管理器');
  if (this._spools.length === 0) throw new Error('请先生成基础棋盘');
  var singleColorExtractPercent = params && typeof params.singleColorExtractPercent === 'number' ? params.singleColorExtractPercent : 33.33;
  if (singleColorExtractPercent < 0) singleColorExtractPercent = 0;
  if (singleColorExtractPercent > 100) singleColorExtractPercent = 100;
  // —— 线轴容量参数解析 + 边界钳制（任务 1.5）——
  // 新参数：spoolMin(默认28) / spoolMax(默认58) / spoolGap(默认1) / spoolAvg(默认0=不启用)。
  // 仅接受合法数字，非法或缺省值回落各自默认（需求 5.4、5.7）。
  var spoolMin = 28, spoolMax = 58, spoolGap = 1, spoolAvg = 0;
  if (params && typeof params.spoolMin === 'number' && isFinite(params.spoolMin) && params.spoolMin >= 1) spoolMin = Math.floor(params.spoolMin);
  if (params && typeof params.spoolMax === 'number' && isFinite(params.spoolMax) && params.spoolMax >= 1) spoolMax = Math.floor(params.spoolMax);
  if (params && typeof params.spoolGap === 'number' && isFinite(params.spoolGap) && params.spoolGap >= 0) spoolGap = Math.floor(params.spoolGap);
  if (params && typeof params.spoolAvg === 'number' && isFinite(params.spoolAvg) && params.spoolAvg > 0) spoolAvg = params.spoolAvg;
  // 边界钳制：MAX≥MIN（需求 5.5）；GAP≥0（需求 5.6）；AVG=0 不启用（需求 5.10），>0 时钳到 [MIN, MAX]（需求 5.11）。
  if (spoolMax < spoolMin) spoolMax = spoolMin;
  if (spoolGap < 0) spoolGap = 0;
  if (spoolAvg > 0) {
    if (spoolAvg < spoolMin) spoolAvg = spoolMin;
    if (spoolAvg > spoolMax) spoolAvg = spoolMax;
  }
  // 旧入参 spoolBasePixelCount（如 48）兼容：保留读取、不报错；不以其为切分基准，仍按默认范围映射，
  // 同时存在新旧参数时以上面解析出的 MIN/MAX/GAP/AVG 为准（需求 9.1、9.2）。
  void (params && params.spoolBasePixelCount);
  var firstRowRangeMultiplier = params && typeof params.firstRowRangeMultiplier === 'number' ? params.firstRowRangeMultiplier : 3;
  if (firstRowRangeMultiplier < 0) firstRowRangeMultiplier = 3;
  var nextRowRangeMultiplier = params && typeof params.nextRowRangeMultiplier === 'number' ? params.nextRowRangeMultiplier : 2;
  if (nextRowRangeMultiplier < 0) nextRowRangeMultiplier = 2;

  var list1 = this._buildPixelSpoolList(targetManager, { spoolMin: spoolMin, spoolMax: spoolMax, spoolGap: spoolGap, spoolAvg: spoolAvg });
  if (list1.length === 0) return { pipeParams: [], unplacedCount: 0 };

  var colorSpoolCounts = {};
  for (var i = 0; i < list1.length; i++) {
    colorSpoolCounts[list1[i].id] = (colorSpoolCounts[list1[i].id] || 0) + 1;
  }

  var list2 = [];
  for (var colorId in colorSpoolCounts) {
    var count = colorSpoolCounts[colorId];
    if (count <= 3) continue;
    var takeCount = Math.ceil(count * singleColorExtractPercent / 100);
    if (takeCount <= 0) continue;
    var candidates = [];
    for (var i = 0; i < list1.length; i++) {
      if (list1[i].id === parseInt(colorId, 10)) candidates.push(i);
    }
    for (var t = 0; t < takeCount && candidates.length > 0; t++) {
      var candidateIndex = Math.floor(Math.random() * candidates.length);
      var listIndex = candidates[candidateIndex];
      list2.push(list1[listIndex]);
      list1.splice(listIndex, 1);
      candidates.splice(candidateIndex, 1);
      for (var c = 0; c < candidates.length; c++) {
        if (candidates[c] > listIndex) candidates[c]--;
      }
    }
  }

  if (list2.length > 0) {
    YarnLevel.shuffleArray(list2);
    var positions = this._getAvailablePositions().filter(function(pos) {
      return this._spools[pos.row][pos.col].id === 0;
    }, this);
    YarnLevel.shuffleArray(positions);
    while (list2.length > 0 && positions.length > 0) {
      var pos = positions.shift();
      var spool = list2.shift();
      this._placeSpool(pos.row, pos.col, spool);
    }
    while (list2.length > 0) list1.push(list2.shift());
  }

  var previousRemainder = 0;
  for (var elementRow = 0; elementRow < this._rows && list1.length > 0; elementRow++) {
    var emptyPositions = this._getRowAvailablePositions(elementRow).filter(function(pos) {
      return this._spools[pos.row][pos.col].id === 0;
    }, this);
    if (emptyPositions.length === 0) {
      previousRemainder = 0;
      continue;
    }

    var range = elementRow === 0 ?
      Math.ceil(emptyPositions.length * firstRowRangeMultiplier) :
      Math.ceil(emptyPositions.length * nextRowRangeMultiplier) + previousRemainder;
    var pickResult = this._pickFromCandidateRange(list1, range, emptyPositions.length);
    previousRemainder = pickResult.remainder;
    YarnLevel.shuffleArray(emptyPositions);
    for (var p = 0; p < pickResult.picked.length; p++) {
      var targetPos = emptyPositions[p];
      this._placeSpool(targetPos.row, targetPos.col, pickResult.picked[p]);
    }
  }

  var pipeResult = this._distributeToPipes(list1);
  return { pipeParams: pipeResult.pipeParams, unplacedCount: pipeResult.unplacedCount };
};

/**
 * 将剩余组信息分配到管道
 * 按管道位置顺序（从上到下，从左到右），依次放入组信息
 * 保持归纳容器中的顺序不变
 */
YarnLevel.ElementZoneManager.prototype._distributeToPipes = function(remainingSpools) {
  var result = { pipeParams: [], unplacedCount: 0 };
  if (!remainingSpools || remainingSpools.length === 0) return result;

  // 灌入管道前，按"目标图消除顺序"(_seq，越小越先消除)稳定升序重排剩余球，
  // 使最先消除的球落到管道浅层(param[0]，最先释放)，逐层加深。无 _seq 的排到末尾、保持相对序。
  // 可由 YarnLevel._fillReorderEnabled = false 关闭（对照测试用；默认开启）。
  if (YarnLevel._fillReorderEnabled !== false) {
    remainingSpools = remainingSpools.slice().sort(function(a, b) {
      var sa = (a && typeof a._seq === 'number') ? a._seq : Infinity;
      var sb = (b && typeof b._seq === 'number') ? b._seq : Infinity;
      return sa - sb;
    });
  }

  var pipes = this.getPipeElements();
  if (pipes.length === 0) {
    result.unplacedCount = remainingSpools.length;
    return result;
  }
  
  // 管道按位置排序（从上到下，从左到右）
  pipes.sort(function(a, b) {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });
  
  // 初始化每个管道的线轴数组
  var pipeSpoolArrays = [];
  for (var i = 0; i < pipes.length; i++) {
    pipeSpoolArrays.push([]);
  }
  
  var pipeIndex = 0;
  for (var i = 0; i < remainingSpools.length; i++) {
    pipeSpoolArrays[pipeIndex].push(YarnLevel.createPipeEntry(remainingSpools[i].id, remainingSpools[i].count));
    pipeIndex++;
    if (pipeIndex >= pipes.length) pipeIndex = 0;
  }
  
  // 设置每个管道的参数
  for (var i = 0; i < pipes.length; i++) {
    var pipe = pipes[i];
    var pipeSpools = pipeSpoolArrays[i];
    
    if (pipeSpools.length > 0) {
      this.setPipeParam(pipe.row, pipe.col, pipeSpools);
      result.pipeParams.push({ row: pipe.row, col: pipe.col, count: pipeSpools.length });
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

YarnLevel.ElementZoneManager.prototype._isChainDeadBlock = function(row, col) {
  if (row < 0 || row >= this._rows) return true;
  if (col < 0 || col >= this._cols) return true;
  if (!this._spools[row] || !this._spools[row][col]) return true;
  var cell = this._spools[row][col];
  if (cell.id === -1) return true;
  if (this.isPipeElement(row, col)) return true;
  return false;
};

YarnLevel.ElementZoneManager.prototype._hasChainDirectionDeadBlock = function(row1, col1, row2, col2) {
  if (row1 === row2) {
    return this._isChainDeadBlock(row1 - 1, col1) ||
      this._isChainDeadBlock(row1 + 1, col1) ||
      this._isChainDeadBlock(row2 - 1, col2) ||
      this._isChainDeadBlock(row2 + 1, col2);
  }
  if (col1 === col2) {
    return this._isChainDeadBlock(row1, col1 - 1) ||
      this._isChainDeadBlock(row1, col1 + 1) ||
      this._isChainDeadBlock(row2, col2 - 1) ||
      this._isChainDeadBlock(row2, col2 + 1);
  }
  return true;
};

YarnLevel.ElementZoneManager.prototype.placeChainPair = function(row1, col1, row2, col2) {
  if (!this.areAdjacent(row1, col1, row2, col2)) return false;
  if (!this.canPlaceChainAt(row1, col1)) return false;
  if (!this.canPlaceChainAt(row2, col2)) return false;
  if (this._hasChainDirectionDeadBlock(row1, col1, row2, col2)) return false;
  if (this.hasChainInSurrounding(row1, col1, row2, col2)) return false;
  var result1 = this.placeSpecialElement(row1, col1, 5);
  if (!result1) return false;
  var result2 = this.placeSpecialElement(row2, col2, 5);
  if (!result2) { this.removeSpecialElement(row1, col1, 5); return false; }
  return true;
};

YarnLevel.ElementZoneManager.prototype._findCandidateChainPairs = function() {
  var pairs = [];
  for (var row = 0; row < this._rows; row++) {
    for (var col = 0; col < this._cols; col++) {
      if (!this.canPlaceChainAt(row, col)) continue;
      if (col + 1 < this._cols && this.canPlaceChainAt(row, col + 1)) {
        pairs.push({ row1: row, col1: col, row2: row, col2: col + 1 });
      }
      if (row + 1 < this._rows && this.canPlaceChainAt(row + 1, col)) {
        pairs.push({ row1: row, col1: col, row2: row + 1, col2: col });
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
    return pos.row > 0; // 排除第一行
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
