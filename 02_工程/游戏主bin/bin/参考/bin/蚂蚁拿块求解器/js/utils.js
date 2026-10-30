/**
 * 蚂蚁拿块求解器 - 工具函数模块
 * 颜色系统、关卡数据解析、BFS工具等
 */

var AntSolver = AntSolver || {};

// ==================== 颜色系统 ====================
// 使用与毛线相同的34色标准色库
AntSolver.COLORS = [
  null,                         // 0 = 无色
  { name: '红色',   hex: '#FF0000' },   // 1
  { name: '橙色',   hex: '#FF8C00' },   // 2
  { name: '黄色',   hex: '#FFD700' },   // 3
  { name: '绿色',   hex: '#00C853' },   // 4
  { name: '青色',   hex: '#00BCD4' },   // 5
  { name: '蓝色',   hex: '#2196F3' },   // 6
  { name: '紫色',   hex: '#9C27B0' },   // 7
  { name: '粉色',   hex: '#FF4081' },   // 8
  { name: '棕色',   hex: '#795548' },   // 9
  { name: '深红',   hex: '#B71C1C' },   // 10
  { name: '深绿',   hex: '#1B5E20' },   // 11
  { name: '深蓝',   hex: '#0D47A1' },   // 12
  { name: '浅绿',   hex: '#76FF03' },   // 13
  { name: '浅蓝',   hex: '#80D8FF' },   // 14
  { name: '浅粉',   hex: '#F8BBD0' },   // 15
  { name: '橄榄',   hex: '#827717' },   // 16
  { name: '靛蓝',   hex: '#3F51B5' },   // 17
  { name: '金色',   hex: '#FFC107' },   // 18
  { name: '珊瑚',   hex: '#FF7043' },   // 19
  { name: '薄荷',   hex: '#00E5FF' },   // 20
  { name: '玫红',   hex: '#E91E63' },   // 21
  { name: '藏青',   hex: '#1A237E' },   // 22
  { name: '草绿',   hex: '#4CAF50' },   // 23
  { name: '天蓝',   hex: '#03A9F4' },   // 24
  { name: '土黄',   hex: '#F9A825' },   // 25
  { name: '灰色',   hex: '#9E9E9E' },   // 26
  { name: '深紫',   hex: '#4A148C' },   // 27
  { name: '淡黄',   hex: '#FFF9C4' },   // 28
  { name: '墨绿',   hex: '#004D40' },   // 29
  { name: '酒红',   hex: '#880E4F' },   // 30
  { name: '橘红',   hex: '#E65100' },   // 31
  { name: '湖蓝',   hex: '#006064' },   // 32
  { name: '黑色',   hex: '#010101' },   // 33
  { name: '白色',   hex: '#FAFAFA' }    // 34
];

AntSolver.getColorCSS = function(id) {
  if (id <= 0 || id >= AntSolver.COLORS.length) return '#333';
  return AntSolver.COLORS[id].hex;
};

AntSolver.getColorName = function(id) {
  if (id <= 0 || id >= AntSolver.COLORS.length) return '未知';
  return AntSolver.COLORS[id].name;
};

// ==================== 关卡数据模型 ====================
/**
 * 关卡JSON格式:
 * {
 *   "blocks": [[1,2,3,...], ...],        // 目标图 (rows x cols), 数字=颜色id
 *   "queues": [                           // 蚂蚁盒队列数组
 *     [
 *       { "color": 1, "count": 3 },      // 每个蚂蚁盒：颜色+蚂蚁数量
 *       { "color": 2, "count": 3 },
 *       ...
 *     ],
 *     ...
 *   ],
 *   "bufferLimit": 5,                    // 暂存区上限（默认5）
 *   "obstacles": []                       // 障碍物（可选，后续扩展）
 * }
 */

AntSolver.BUFFER_LIMIT = 5;

/**
 * 解析关卡数据
 */
AntSolver.parseLevel = function(json) {
  var level = {
    blocks: json.blocks || [],
    queues: json.queues || [],
    bufferLimit: json.bufferLimit || 5,
    obstacles: json.obstacles || [],
    rows: 0,
    cols: 0,
    totalPixels: 0,
    colorCounts: {}
  };

  if (level.blocks.length > 0) {
    level.rows = level.blocks.length;
    level.cols = level.blocks[0].length;
  }

  // 统计目标区颜色
  for (var r = 0; r < level.rows; r++) {
    for (var c = 0; c < level.cols; c++) {
      var id = level.blocks[r][c];
      if (id > 0) {
        level.totalPixels++;
        level.colorCounts[id] = (level.colorCounts[id] || 0) + 1;
      }
    }
  }

  AntSolver.BUFFER_LIMIT = level.bufferLimit;
  return level;
};

/**
 * 生成示例关卡（用于测试）
 * 8x8目标图，3种颜色，4条队列
 */
AntSolver.generateSampleLevel = function() {
  var rows = 8, cols = 8;
  var colors = [1, 4, 6]; // 红、绿、蓝
  var blocks = [];

  // 生成简单的条纹目标图
  for (var r = 0; r < rows; r++) {
    var row = [];
    for (var c = 0; c < cols; c++) {
      row.push(colors[(r + c) % colors.length]);
    }
    blocks.push(row);
  }

  // 统计每色像素数
  var colorPixels = {};
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var id = blocks[r][c];
      colorPixels[id] = (colorPixels[id] || 0) + 1;
    }
  }

  // 生成队列：确保每色的蚂蚁总数 = 该色像素数
  // 每个蚂蚁盒count=4，计算需要多少个盒子
  var queues = [[], [], [], []];
  var qIdx = 0;
  for (var colorId in colorPixels) {
    var total = colorPixels[colorId];
    var perBox = 4;
    var numBoxes = Math.ceil(total / perBox);
    for (var i = 0; i < numBoxes; i++) {
      var cnt = Math.min(perBox, total - i * perBox);
      queues[qIdx % 4].push({ color: parseInt(colorId), count: cnt });
      qIdx++;
    }
  }

  return {
    blocks: blocks,
    queues: queues,
    bufferLimit: 5
  };
};

// ==================== BFS工具 ====================

/**
 * 获取2D数组中某格的四方向邻居
 */
AntSolver.getNeighbors = function(r, c, rows, cols) {
  var result = [];
  var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  for (var d = 0; d < dirs.length; d++) {
    var nr = r + dirs[d][0], nc = c + dirs[d][1];
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
      result.push([nr, nc]);
    }
  }
  return result;
};

/**
 * 计算已消除区域的边界格子（与已消除区域四方向相邻的、尚未消除的格子）
 * @param {Array<Array<boolean>>} eliminated - 已消除矩阵
 * @param {Array<Array<number>>} blocks - 目标图
 * @returns {Array} [{row, col, colorId}]
 */
AntSolver.getBorderCells = function(eliminated, blocks, rows, cols) {
  var border = [];
  var visited = {};
  var dirs = [[-1,0],[1,0],[0,-1],[0,1]];

  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      if (!eliminated[r][c]) continue; // 只看已消除的格子
      for (var d = 0; d < dirs.length; d++) {
        var nr = r + dirs[d][0], nc = c + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (eliminated[nr][nc]) continue; // 已消除的不算边界
        var key = nr + ',' + nc;
        if (visited[key]) continue;
        visited[key] = true;
        var colorId = blocks[nr][nc];
        if (colorId > 0) {
          border.push({ row: nr, col: nc, colorId: colorId });
        }
      }
    }
  }
  return border;
};

/**
 * 深拷贝
 */
AntSolver.deepClone = function(obj) {
  return JSON.parse(JSON.stringify(obj));
};

/**
 * 创建2D布尔矩阵
 */
AntSolver.create2D = function(rows, cols, val) {
  var arr = [];
  for (var r = 0; r < rows; r++) {
    arr.push(new Array(cols).fill(val));
  }
  return arr;
};
