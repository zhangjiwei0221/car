/**
 * 蚂蚁拿块求解器 - 工具函数模块
 * 颜色系统、关卡数据解析、BFS工具等
 */

var AntSolver = AntSolver || {};

// ==================== 颜色系统 ====================
// 真实毛线标准色库（34色）—— 源自 参考/ 毛线色库/标准色库毛线真实.txt
AntSolver.COLORS = [
  null,                          // 0 = 无色
  { name: '红色',   hex: '#FF3240' },   // 1
  { name: '浅红',   hex: '#FF269F' },   // 2
  { name: '粉红',   hex: '#FF5294' },   // 3
  { name: '暗粉',   hex: '#DF2455' },   // 4
  { name: '浅粉',   hex: '#FF98A3' },   // 5
  { name: '深红',   hex: '#F63C3F' },   // 6
  { name: '紫色',   hex: '#A073E7' },   // 7
  { name: '浅紫粉', hex: '#E749B6' },   // 8
  { name: '玫红',   hex: '#AD00AC' },   // 9
  { name: '灰紫',   hex: '#C538C3' },   // 10
  { name: '深紫',   hex: '#A032DC' },   // 11
  { name: '紫红',   hex: '#C60174' },   // 12
  { name: '天蓝',   hex: '#00ACF6' },   // 13
  { name: '浅蓝',   hex: '#00E1EF' },   // 14
  { name: '深棕',   hex: '#256A85' },   // 15
  { name: '深蓝',   hex: '#7074B6' },   // 16
  { name: '灰蓝',   hex: '#6F67DC' },   // 17
  { name: '蓝色',   hex: '#6B5BBA' },   // 18
  { name: '浅黄',   hex: '#95E502' },   // 19
  { name: '绿色',   hex: '#01CC64' },   // 20
  { name: '橄榄绿', hex: '#00AEAD' },   // 21
  { name: '青蓝',   hex: '#04DB01' },   // 22
  { name: '浅绿',   hex: '#02CBA9' },   // 23
  { name: '深绿',   hex: '#018441' },   // 24
  { name: '黄色',   hex: '#FFB900' },   // 25
  { name: '砖红',   hex: '#C15701' },   // 26
  { name: '浅橙',   hex: '#FF9F6A' },   // 27
  { name: '橙色',   hex: '#FF8002' },   // 28
  { name: '深棕2',  hex: '#F69602' },   // 29
  { name: '棕色',   hex: '#F9DA00' },   // 30
  { name: '浅灰',   hex: '#FDE8D6' },   // 31
  { name: '灰色',   hex: '#FFEAB2' },   // 32
  { name: '深灰',   hex: '#010101' },   // 33
  { name: '中灰',   hex: '#BBB6B7' }    // 34
];

// ColonyFlow 真机调色板（编号 0-21），映射到 id = CF_BASE + index，避免与内建色库冲突
AntSolver.CF_BASE = 100;
AntSolver.CF_COLORS = [
  { name: '黄色', hex: '#FEDB53' }, { name: '橙色', hex: '#FFB823' }, { name: '深橙', hex: '#FF8025' },
  { name: '红色', hex: '#E75862' }, { name: '深红', hex: '#B72F41' }, { name: '浅绿', hex: '#B0E85B' },
  { name: '绿色', hex: '#50BE5E' }, { name: '深绿', hex: '#1E7F54' }, { name: '浅蓝', hex: '#AEDDE5' },
  { name: '青蓝', hex: '#4EC5DD' }, { name: '粉色', hex: '#FFBDD7' }, { name: '洋红', hex: '#F56EC6' },
  { name: '紫色', hex: '#C23DFF' }, { name: '深紫', hex: '#5954B4' }, { name: '棕色', hex: '#A55946' },
  { name: '白色', hex: '#D7DFE0' }, { name: '黑色', hex: '#5A4A65' }, { name: '米色', hex: '#F1C5A7' },
  { name: '天蓝', hex: '#45A3F8' }, { name: '浅棕', hex: '#D17E4A' }, { name: '玫红', hex: '#DB3557' },
  { name: '浅黄', hex: '#F7E294' }
];

AntSolver.getColorCSS = function(id) {
  if (id >= AntSolver.CF_BASE) {
    var cf = AntSolver.CF_COLORS[id - AntSolver.CF_BASE];
    return cf ? cf.hex : '#333';
  }
  if (id <= 0 || id >= AntSolver.COLORS.length) return '#333';
  return AntSolver.COLORS[id].hex;
};

AntSolver.getColorName = function(id) {
  if (id >= AntSolver.CF_BASE) {
    var cf = AntSolver.CF_COLORS[id - AntSolver.CF_BASE];
    return cf ? cf.name : '未知';
  }
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
// 【v139·老冰下线】type:4 老冰已从本工程彻底删除（模拟器/求解器/生成器/审核都不再认它）。
//   唯一冰机制 = 数字冰 type:7：数值 = 还剩几个球（按"取走几个盒"倒计时），减到 0 破碎。
//   导入兼容：遇到官方 JSON 里的 type:4，按「老冰 ⇒ 数字冰」转换成下面的默认值（导出永不写 type:4）。
AntSolver.NUMICE_DEFAULT = 3;          // 老冰导入转数字冰时的默认数值（与旧老冰"3 步解冻"同量级）
// 生成器放数字冰时的数值下限（数值必须 ≥1，否则等于没放）
AntSolver.NUMICE_MIN = 1;

// ==================== 棋盘（元素区）模型 ====================
// 棋盘 = 蚂蚁盒所在的二维网格（复用毛线元素区）。障碍/管道均在棋盘上，不在目标图。
// 棋盘尺寸：9 行 × 9~19 列。
// cell 格式：
//   null                                    空格（可通行）
//   { t:'box', color, count, ice, chain, q, numice } 蚂蚁盒（ice=老冰耐久0/3；chain=配对组号0=无；q=问号隐藏色；
//                                                    numice=数字冰还剩几个球，0=无，见 v138）
//   { t:'black' }                            黑块（永久阻挡）
//   { t:'pipe', dir, queue, next }           管道（dir=11上/12右/13下/14左，queue=[{color,count}]，next=已释放数）
AntSolver.BOARD_ROWS = 9;
AntSolver.BOARD_COLS_MIN = 9;
AntSolver.BOARD_COLS_MAX = 19;
AntSolver.PIPE_DIRS = { 11: [-1, 0], 12: [0, 1], 13: [1, 0], 14: [0, -1] };

AntSolver.isBox = function(cell) { return !!cell && cell.t === 'box'; };
AntSolver.isBlack = function(cell) { return !!cell && cell.t === 'black'; };
AntSolver.isPipe = function(cell) { return !!cell && cell.t === 'pipe'; };
AntSolver.isEmptyCell = function(cell) { return !cell || cell.t === 'empty'; };

/**
 * 归一化单个 cell（容错：数字/旧格式 → 标准对象）。
 */
AntSolver.normCell = function(cell) {
  if (cell == null) return null;
  if (typeof cell === 'number') {
    if (cell <= 0) return null;
    return { t: 'box', color: cell, count: 1, chain: 0, q: false, numice: 0 };
  }
  if (cell.t === 'black' || cell.b === 1 || cell.id === -1) return { t: 'black' };
  if (cell.t === 'pipe' || cell.dir >= 11) {
    return { t: 'pipe', dir: cell.dir || 13, queue: (cell.queue || []).map(function(b) {
      return { color: b.color, count: b.count };
    }), next: cell.next || 0 };
  }
  if (cell.t === 'box' || cell.color != null) {
    // 【v139】老冰下线后的导入兼容：历史 关卡数据.json 里带 ice 字段的格子，
    //   按「老冰 ⇒ 数字冰」转成 NUMICE_DEFAULT（默认 3），避免旧数据导入后冰直接消失。
    var numice = cell.numice || 0;
    if (!numice && cell.ice > 0) numice = AntSolver.NUMICE_DEFAULT || 3;
    return {
      t: 'box',
      color: cell.color, count: cell.count || 1,
      chain: cell.chain || 0, q: !!cell.q,
      numice: numice                      // 数字冰（0=无）
    };
  }
  return null;
};

/**
 * 从 queues（旧格式）转换为 board：每条队列 = 一列，queue[0] 在顶部。
 */
AntSolver.boardFromQueues = function(queues) {
  var cols = queues.length;
  var rows = 0;
  for (var c = 0; c < cols; c++) rows = Math.max(rows, queues[c].length);
  var cells = [];
  for (var r = 0; r < rows; r++) {
    var row = [];
    for (var c2 = 0; c2 < cols; c2++) {
      var box = queues[c2][r];
      row.push(box ? { t: 'box', color: box.color, count: box.count, chain: 0, q: false, numice: 0 } : null);
    }
    cells.push(row);
  }
  return { rows: rows, cols: cols, cells: cells };
};

/**
 * 归一化 board（深拷贝 + 每格规范化）。
 */
AntSolver.normBoard = function(board) {
  var rows = board.rows || board.cells.length;
  var cols = board.cols || (board.cells[0] ? board.cells[0].length : 0);
  var cells = [];
  for (var r = 0; r < rows; r++) {
    var row = [];
    for (var c = 0; c < cols; c++) {
      row.push(AntSolver.normCell(board.cells[r] ? board.cells[r][c] : null));
    }
    cells.push(row);
  }
  return { rows: rows, cols: cols, cells: cells };
};

/**
 * 解析关卡数据
 */
AntSolver.parseLevel = function(json) {
  var level = {
    blocks: json.blocks || [],
    bufferLimit: json.bufferLimit || 5,
    rows: 0,
    cols: 0,
    totalPixels: 0,
    colorCounts: {},
    board: null,
    totalBoxes: 0
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

  // 棋盘：优先 json.board；否则从旧 queues 转换（向后兼容）
  if (json.board && json.board.cells) {
    level.board = AntSolver.normBoard(json.board);
  } else if (json.queues && json.queues.length) {
    level.board = AntSolver.boardFromQueues(json.queues);
  } else {
    level.board = { rows: 0, cols: 0, cells: [] };
  }

  // 统计棋盘蚂蚁盒总数（含管道内队列）
  var tb = 0;
  for (var br = 0; br < level.board.rows; br++) {
    for (var bc = 0; bc < level.board.cols; bc++) {
      var cell = level.board.cells[br][bc];
      if (AntSolver.isBox(cell)) tb++;
      else if (AntSolver.isPipe(cell)) tb += (cell.queue ? cell.queue.length : 0);
    }
  }
  level.totalBoxes = tb;

  AntSolver.BUFFER_LIMIT = level.bufferLimit;
  return level;
};

/**
 * 生成示例关卡（基于真实广告游戏数据）
 * 模拟蚂蚁拿块广告中的16×16目标图，4种颜色，多条队列
 * 
 * 游戏特点：
 * - 蚂蚁从外围向内消除（四方向flood-fill）
 * - 外层颜色先消，内层后消（洋葱结构）
 * - 暂存区上限5
 */
AntSolver.generateSampleLevel = function() {
  var rows = 12, cols = 12;
  var blocks = [];

  // 模拟广告游戏中蘑菇/食物造型的目标图
  // 使用4种颜色：红(1)、绿(4)、蓝(6)、黄(3)
  // 外层红色，中层绿色，内核蓝色，点缀黄色

  // 先填充空白
  for (var r = 0; r < rows; r++) {
    blocks.push(new Array(cols).fill(0));
  }

  // 画一个蘑菇造型
  // 帽子（上半部分，椭圆）
  var cx = 6, cy = 4;
  for (var r = 1; r < 8; r++) {
    for (var c = 1; c < 11; c++) {
      var dx = (c - cx) / 5;
      var dy = (r - cy) / 3.5;
      if (dx*dx + dy*dy <= 1) {
        // 外圈红色
        if (dx*dx + dy*dy > 0.5) blocks[r][c] = 1;
        // 中圈绿色
        else if (dx*dx + dy*dy > 0.2) blocks[r][c] = 4;
        // 内核蓝色
        else blocks[r][c] = 6;
      }
    }
  }
  // 蘑菇杆（下半部分）
  for (var r = 7; r < 11; r++) {
    for (var c = 4; c < 8; c++) {
      blocks[r][c] = 3; // 黄色
    }
  }
  // 点缀：帽子上的白点
  blocks[2][4] = 3; blocks[2][7] = 3;
  blocks[4][3] = 3; blocks[4][8] = 3;

  // 统计每色像素数
  var colorPixels = {};
  var totalPx = 0;
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var id = blocks[r][c];
      if (id > 0) {
        colorPixels[id] = (colorPixels[id] || 0) + 1;
        totalPx++;
      }
    }
  }

  // 生成队列：模拟真实游戏的多队列设计
  // 每个蚂蚁盒count=3~5（随机），分配到3条队列
  var allBoxes = [];
  for (var colorId in colorPixels) {
    var total = colorPixels[colorId];
    var remaining = total;
    while (remaining > 0) {
      var cnt = Math.min(3 + Math.floor(Math.random() * 3), remaining); // 3~5
      allBoxes.push({ color: parseInt(colorId), count: cnt });
      remaining -= cnt;
    }
  }

  // 洗牌（模拟真实游戏中颜色交替出现）
  for (var i = allBoxes.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = allBoxes[i]; allBoxes[i] = allBoxes[j]; allBoxes[j] = tmp;
  }

  // 分配到3条队列（轮流分配）
  var queues = [[], [], []];
  for (var i = 0; i < allBoxes.length; i++) {
    queues[i % 3].push(allBoxes[i]);
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

/**
 * 初始"已消除/可进入"矩阵：仅【与棋盘外部连通】的空格标记为 true（从四边 flood-fill 穿空格）。
 * 对齐 ColonyFlow 引擎 computeReach：封闭空腔(内部孔洞)不与外部连通 → 不算可达，
 * 因此不会让孔洞内壁的方块提前可消（真实关卡图无孔洞时与旧规则完全一致）。
 * blocks[r][c] <= 0 视为空格。
 */
AntSolver.outsideReachSeed = function(blocks, rows, cols, bottomOnly) {
  var elim = AntSolver.create2D(rows, cols, false);
  var q = [];
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      // 默认四边为外部开口；bottomOnly 仅【底边(r=rows-1)】开口，上/左/右封闭 → 目标图只能自底向上消除
      var edge = bottomOnly ? (r === rows - 1) : (r === 0 || c === 0 || r === rows - 1 || c === cols - 1);
      if (blocks[r][c] <= 0 && edge) { elim[r][c] = true; q.push([r, c]); }
    }
  }
  var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  for (var h = 0; h < q.length; h++) {
    var cr = q[h][0], cc = q[h][1];
    for (var d = 0; d < dirs.length; d++) {
      var nr = cr + dirs[d][0], nc = cc + dirs[d][1];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (elim[nr][nc]) continue;
      if (blocks[nr][nc] <= 0) { elim[nr][nc] = true; q.push([nr, nc]); }
    }
  }
  return elim;
};

/**
 * 全颜色消除顺序（由外围向中心、按消除距离/依赖逐轮推进）。
 * 逻辑：从"外部连通空格"起，每一轮在剩余颜色中
 * 选出【当前可达像素最多】的颜色，一次性消除其【全部当前可达像素】(最底最左次序)，
 * 如此逐轮向内推进——外层颜色先消、内层被外层封住的后消，天然反映强依赖顺序。
 *
 * @param {boolean} [bottomOnly=false] 目标图消除入口模式。
 *   false(默认)：四边开口，对齐默认版目标图消除口径——行为与本参数引入前完全一致。
 *   true       ：仅底边开口(上/左/右封闭)，对齐【仅底部入口】玩法。消除仍是底→上、
 *                仍按同一"可达最多色逐轮剥离"依赖启发，差别只是开局可达区少了上/左/右三个方向。
 *                供生成器底部模式的依赖顺序分支(baseFillBoxesBottom)取像素流用。
 *
 * 返回：
 *   seq[r][c]     每个彩色像素的【全局消除序号】(1..N)；背景(<=0)为 0。
 *   round[r][c]   该像素所属的消除轮次(第几轮被整片消除)。
 *   order         [{r,c,color,round,seq}] 全局消除顺序数组。
 *   colorGroups   {color: [{r,c,seq}...]} 每种颜色按消除先后的排序组。
 *   roundColors   [{color,count,round}] 每轮消除的颜色与数量。
 *   rounds/total  轮次数 / 参与编号的彩色像素总数。
 *   注：bottomOnly=true 且目标图存在【永久不可达】像素时，total < 彩色像素总数（剥离到无可消即停）。
 *      调用方需要"全图可达"保证时应先跑 Generator.checkBottomEntryFeasibility。
 * 用途：识别目标图的强依赖消除顺序，指导后续棋盘铺盒。
 */
AntSolver.eliminationOrder = function (blocks, rows, cols, bottomOnly) {
  var Sim = AntSolver.Simulator;
  bottomOnly = !!bottomOnly;
  // 四边开口(默认版口径) / bottomOnly 时仅底边开口
  var eliminated = AntSolver.outsideReachSeed(blocks, rows, cols, bottomOnly);
  var seq = AntSolver.create2D(rows, cols, 0);        // 全局消除序(参考)
  var round = AntSolver.create2D(rows, cols, 0);      // 全局轮次
  var colorRank = AntSolver.create2D(rows, cols, 0);  // 【同色内】消除排名(1..k)——主编号
  var colorSeg = AntSolver.create2D(rows, cols, 0);   // 【同色内】第几段(区域)：因闭合被隔开、分批消除的段号
  var order = [];
  var colorGroups = {};        // color -> [{r,c,rank,seg,seq}] 该色按消除先后
  var roundColors = [];        // 每轮 {color,count,round,seg}
  var colorRunning = {};       // 每色累计已编号数
  var colorSegCount = {};      // 每色已出现的段数
  var rnd = 0;
  var guard = rows * cols + 10;
  while (guard-- > 0) {
    // 剩余(未消)颜色
    var remaining = {};
    for (var r = 0; r < rows; r++)
      for (var c = 0; c < cols; c++)
        if (!eliminated[r][c] && blocks[r][c] > 0) remaining[blocks[r][c]] = true;
    var colors = Object.keys(remaining);
    if (!colors.length) break;
    // 选当前【可达像素最多】的颜色（与生成器 solverGuidedBoxes 同一依赖启发）
    var bestColor = null, bestReach = 0;
    for (var i = 0; i < colors.length; i++) {
      var scratch = [];
      for (var sr = 0; sr < rows; sr++) scratch.push(eliminated[sr].slice());
      var n = Sim.floodFillEliminate(scratch, blocks, rows, cols, parseInt(colors[i], 10), Infinity, null, null, bottomOnly);
      if (n > bestReach) { bestReach = n; bestColor = parseInt(colors[i], 10); }
    }
    if (bestColor === null || bestReach <= 0) break;
    // 一次性消除该色【当前全部可达像素】(=该色本段/本区域)，trace 记录消除次序(最底最左)
    var trace = [];
    Sim.floodFillEliminate(eliminated, blocks, rows, cols, bestColor, Infinity, trace, null, bottomOnly);
    rnd++;
    var seg = (colorSegCount[bestColor] = (colorSegCount[bestColor] || 0) + 1); // 该色第几段(区域)
    for (var t = 0; t < trace.length; t++) {
      var rr = trace[t][0], cc = trace[t][1];
      var gi = order.length + 1;
      var cr = (colorRunning[bestColor] = (colorRunning[bestColor] || 0) + 1);   // 同色内排名
      seq[rr][cc] = gi; round[rr][cc] = rnd;
      colorRank[rr][cc] = cr; colorSeg[rr][cc] = seg;
      order.push({ r: rr, c: cc, color: bestColor, round: rnd, seq: gi, rank: cr, seg: seg });
      (colorGroups[bestColor] = colorGroups[bestColor] || []).push({ r: rr, c: cc, rank: cr, seg: seg, seq: gi });
    }
    roundColors.push({ color: bestColor, count: trace.length, round: rnd, seg: seg });
  }
  // 每色段数汇总
  var colorSegments = {};
  for (var cid in colorSegCount) colorSegments[cid] = colorSegCount[cid];
  return {
    seq: seq, round: round, colorRank: colorRank, colorSeg: colorSeg,
    order: order, colorGroups: colorGroups, roundColors: roundColors,
    colorSegments: colorSegments, rounds: rnd, total: order.length
  };
};

/**
 * 按已确定的【盒序列】在 Simulator 的真实暂存状态中回放，产出序号视图数据。
 *
 * 规划盒序列只描述“首行左→右铺入”的基础棋盘；展示/验证必须再走一次真实状态机，
 * 因为盒未立即结算时会留在暂存槽，并在后续盒入场后由 autoReleaseBuffer 继续消除。
 * 此函数复用 createState/processAntBox：每盒按最左空槽取得起点、逐像素刷新、自动释放滞留盒。
 * 因而左侧编号、右侧基础盒序和按该盒序操作的就地模拟使用同一目标图状态口径。
 *
 * options 支持 { bufferLimit, useSlotStart, bottomOnly, boxSequence }；`boxSequence` 可传入
 * 求解器真实取盒序（元素为 { box, sourceBox }），以使序号与全知回放逐像素完全一致。
 * 为兼容旧调用，第五参数也可直接传 bottomOnly 布尔值。
 */
AntSolver.replayEliminationOrder = function (blocks, rows, cols, boxes, options) {
  var Sim = AntSolver.Simulator;
  options = typeof options === 'boolean' ? { bottomOnly: options } : (options || {});
  var bottomOnly = !!options.bottomOnly;
  var useSlotStart = options.useSlotStart !== false;
  var bufferLimit = Math.max(1, parseInt(options.bufferLimit, 10) || 5);
  var replaySequence = options.boxSequence || boxes;
  var totalPixels = 0;
  for (var pr = 0; pr < rows; pr++) for (var pc = 0; pc < cols; pc++) if (blocks[pr][pc] > 0) totalPixels++;

  // 不进入全局 Simulator 会话，避免重建序号视图时打断用户正在进行的模拟；
  // 但 state 本身来自同一 createState/processAntBox/autoReleaseBuffer 实现。
  var state = Sim.createState({
    blocks: blocks, rows: rows, cols: cols,
    totalPixels: totalPixels, totalBoxes: boxes.length,
    bufferLimit: bufferLimit,
    board: { rows: 0, cols: 0, cells: [] }
  }, { useSlotStart: useSlotStart, bottomOnly: bottomOnly });
  var seq = AntSolver.create2D(rows, cols, 0);
  var round = AntSolver.create2D(rows, cols, 0);
  var colorRank = AntSolver.create2D(rows, cols, 0);
  var colorSeg = AntSolver.create2D(rows, cols, 0);
  var order = [], colorGroups = {}, roundColors = [];
  var colorRunning = {}, colorSegCount = {}, keyInfo = {};
  var lastColor = null, currentRound = 0, currentSeg = 0, replayedBoxes = 0;

  function appendCell(cell, info, triggerBox) {
    var r = cell[0], c = cell[1], color = info.color;
    if (seq[r][c]) return; // 防御：状态机保证不重复消除，避免异常输入把序号覆盖。
    if (color !== lastColor) {
      currentRound++;
      currentSeg = (colorSegCount[color] = (colorSegCount[color] || 0) + 1);
      roundColors.push({ color: color, count: 0, round: currentRound, seg: currentSeg, firstBox: info.box, lastBox: info.box, triggerBox: triggerBox });
      lastColor = color;
    }
    var group = roundColors[roundColors.length - 1];
    group.count++; group.lastBox = info.box; group.triggerBox = triggerBox;
    var globalRank = order.length + 1;
    var rank = (colorRunning[color] = (colorRunning[color] || 0) + 1);
    seq[r][c] = globalRank; round[r][c] = currentRound;
    colorRank[r][c] = rank; colorSeg[r][c] = currentSeg;
    order.push({ r: r, c: c, color: color, round: currentRound, seq: globalRank, rank: rank, seg: currentSeg, box: info.box, triggerBox: triggerBox, slot: info.slot, start: info.start });
    (colorGroups[color] = colorGroups[color] || []).push({ r: r, c: c, rank: rank, seg: currentSeg, seq: globalRank, box: info.box, triggerBox: triggerBox });
  }

  for (var bi = 0; bi < replaySequence.length; bi++) {
    var entry = replaySequence[bi];
    var box = entry && entry.box ? entry.box : entry;
    var sourceBox = entry && entry.sourceBox != null ? entry.sourceBox : (bi + 1);
    if (!box || !(box.count > 0)) continue;
    // applyPick 在真实棋盘中会先增加步骤再 processAntBox；基础回放没有障碍机械层，
    // 这里显式同步该步数，使暂存滞留/统计与逐格点取一致。
    state.steps++;
    state.capture = true; state.capOps = [];
    Sim.processAntBox(state, { color: box.color, count: box.count });
    state.capture = false;
    replayedBoxes++;
    var ops = state.capOps || [];
    for (var oi = 0; oi < ops.length; oi++) {
      var op = ops[oi];
      if (op.t === 'add') {
        keyInfo[op.key] = { color: op.color, box: sourceBox, slot: op.slot, start: op.start };
      } else if (op.t === 'eat' && op.cells && keyInfo[op.key]) {
        for (var ci = 0; ci < op.cells.length; ci++) appendCell(op.cells[ci], keyInfo[op.key], bi + 1);
      }
    }
    // 正常的基础趋势盒不应溢出；若按既定铺入序已死亡，停止以忠实反映真实模拟，
    // 而不是继续用一个现实中已不可再取盒的状态伪造完整序号。
    // 【v160】满=死：达到上限即视为已死亡（原先是 "> 上限"，比规则晚一格）
    if (state.overflow || state.buffer.length >= state.bufferLimit) break;
  }
  return {
    seq: seq, round: round, colorRank: colorRank, colorSeg: colorSeg,
    order: order, colorGroups: colorGroups, roundColors: roundColors,
    colorSegments: colorSegCount, rounds: currentRound, boxes: boxes.length,
    replayedBoxes: replayedBoxes, total: order.length, eliminated: state.eliminated,
    completed: order.length === totalPixels && !state.overflow,
    overflow: !!state.overflow, buffer: state.buffer, useSlotStart: useSlotStart
  };
};

/**
 * 目标图基础消除趋势：以【底部→顶部】为主方向，同一行左→右。
 *
 * 用于“尚未加障碍”的基础铺盒：它表达视觉/依赖趋势，而非把当前可达最多的颜色整段排空。
 * 颜色不阻挡趋势扫描；真正执行时仍由 Simulator 的可达性、暂存槽起点和逐像素刷新决定每盒内部消除。
 */
AntSolver.bottomTrendPixels = function (blocks, rows, cols) {
  var pixels = [];
  for (var r = rows - 1; r >= 0; r--) {
    for (var c = 0; c < cols; c++) {
      if (blocks[r][c] > 0) pixels.push({ r: r, c: c, color: blocks[r][c], trend: pixels.length });
    }
  }
  return pixels;
};

/**
 * 把底→顶趋势像素流压缩为单色容量盒。
 *
 * 每色拥有一个“当前开箱”：像素在趋势流中到达时装入该色当前盒，达到 cap 后封箱；
 * 盒的 trendStart 是它接到第一个像素的位置，最终按 trendStart 排序。因此颜色可以跨行累计到容量，
 * 又不会像旧的“整色可达最多”策略那样把数百个同色盒全部压在最前。
 *
 * 尾盒仍执行合并平分：同色最后不足 cap 的盒与其前一盒重分容量，但保留两盒原来的趋势位置。
 */
AntSolver.buildTrendBoxes = function (blocks, rows, cols, cap) {
  cap = Math.max(2, parseInt(cap, 10) || 35);
  var pixels = AntSolver.bottomTrendPixels(blocks, rows, cols);
  var boxes = [], active = {}, perColor = {};
  for (var i = 0; i < pixels.length; i++) {
    var p = pixels[i], box = active[p.color];
    if (!box) {
      box = { color: p.color, count: 0, trendStart: p.trend, trendEnd: p.trend, pixels: [] };
      active[p.color] = box;
      boxes.push(box);
      (perColor[p.color] = perColor[p.color] || []).push(box);
    }
    box.count++; box.trendEnd = p.trend; box.pixels.push({ r: p.r, c: p.c });
    if (box.count >= cap) active[p.color] = null;
  }
  // 同色尾盒未满：与前盒合并后平分；两盒的趋势起点不动，因而棋盘趋势排序稳定。
  for (var color in perColor) {
    var group = perColor[color];
    if (group.length < 2) continue;
    var tail = group[group.length - 1], prev = group[group.length - 2];
    if (tail.count >= cap) continue;
    var total = prev.count + tail.count;
    prev.count = Math.ceil(total / 2); tail.count = Math.floor(total / 2);
  }
  boxes.sort(function (a, b) { return a.trendStart - b.trendStart; });
  for (var bi = 0; bi < boxes.length; bi++) boxes[bi].trendBox = bi + 1;
  return { pixels: pixels, boxes: boxes };
};


/* ==================== 程序端关卡文件结构 双向转换 ====================
 * 官方(程序端)关卡本体：{ toprow, blocks:[[数字色]], maprow, mapcol, spools:[[{id,type,param,count}]] }
 *   - spool: id=颜色(0空/-1黑块)，count=盒容量，type 功能，param 参数
 *   - 功能 type：0无 / 4老冰 / 5链条 / 6问号 / 7数字冰 / 11-14管道；多功能=升序数组，如 [5,6]
 *   - 链条 param=组ID(相同=共链)；冰只输出 type:4(耐久1+3逻辑在程序端)；管道 param=队列[{id,count}]
 *   - 【v138·数字冰】type:7 的 param 与实机（游戏里正在跑的 campaign99 那批）逐字段一致：
 *       仅数字冰            → param = 剩余球数（标量）      例 {"type":7,"param":11}
 *       数字冰 + 锁链/问号  → type 数组 + **同序 param 数组** 例 {"type":[5,7],"param":[2,42]}（[链组ID, 球数]）
 *                                                           例 {"type":[6,7],"param":[0,19]}（[0, 球数]）
 *     数字冰与老冰互斥：同一格有数字冰时不再输出 type:4。
 * 本体【不含】bufferLimit/难度/求解等——那些进 关卡数据.json（本地调试）。
 */

// 内部 level → 官方关卡本体（干净结构）
AntSolver.toGameFormat = function (level) {
  var board = level.board || { rows: 0, cols: 0, cells: [] };
  var rows = board.rows || 0, cols = board.cols || 0;
  function cellToSpool(cell) {
    if (!cell || cell.t === 'empty') return { id: 0, type: 0, param: 0, count: 0 };   // 空
    if (cell.t === 'black') return { id: -1, type: 0, param: 0, count: 0 };           // 黑块
    if (cell.t === 'pipe') {                                                          // 管道(本体 id/count=0)
      var q = (cell.queue || []).map(function (x) { return { id: x.color, count: x.count }; });
      return { id: 0, type: cell.dir || 11, param: q, count: 0 };
    }
    var types = [];                                                                  // 盒：收集功能
    if (cell.chain) types.push(5);
    if (cell.q) types.push(6);
    if (cell.numice) types.push(7);                // 数字冰：按剩几个球倒计时（唯一冰机制）
    var type = types.length === 0 ? 0 : (types.length === 1 ? types[0] : types);
    var param;
    if (cell.numice) {
      // 【与实机一致】单独数字冰 → 标量；与锁链/问号叠加 → 与 types 同序的 param 数组（无参数项填 0）
      param = (types.length === 1) ? cell.numice : types.map(function (t) {
        if (t === 5) return cell.chain || 0;
        if (t === 7) return cell.numice;
        return 0;
      });
    } else {
      param = cell.chain ? cell.chain : 0;   // 链条组ID→param(相同=共链)；问号不用参数（沿用原口径）
    }
    return { id: cell.color, type: type, param: param, count: cell.count || 0 };
  }
  var spools = [];
  for (var r = 0; r < rows; r++) {
    var row = [];
    for (var c = 0; c < cols; c++) row.push(cellToSpool(board.cells[r][c]));
    spools.push(row);
  }
  return {
    toprow: (level.blocks && level.blocks.length) || 0,
    blocks: level.blocks || [],
    maprow: rows, mapcol: cols, spools: spools
  };
};

// 官方关卡本体 → 内部 level（仅有本体时的还原）
//
// 【v139·老冰下线】type:4 老冰已删除，本函数不再产出 ice 字段。
//   导入兼容：旧关卡 JSON 里的 type:4（老冰）按「老冰 ⇒ 数字冰」转成 NUMICE_DEFAULT（默认 3），
//   即"再取走 3 个盒就破碎"，与老冰原本"3 步解冻"的节奏同量级；导出侧永不写 type:4。
// 注：若同时有 关卡数据.json（含完整内部 board），导入端应优先用之无损还原，届时不经本函数。
AntSolver.fromGameFormat = function (g) {
  var maprow = g.maprow || (g.spools ? g.spools.length : 0);
  var mapcol = g.mapcol || (g.spools && g.spools[0] ? g.spools[0].length : 0);
  function typeList(t) { return Array.isArray(t) ? t : (t === 0 || t == null ? [] : [t]); }
  function spoolToCell(sp) {
    if (!sp) return null;
    if (sp.id === -1) return { t: 'black' };
    var types = typeList(sp.type), pipeDir = null;
    for (var i = 0; i < types.length; i++) if (types[i] >= 11 && types[i] <= 14) pipeDir = types[i];
    if (pipeDir) {
      var q = (Array.isArray(sp.param) ? sp.param : []).map(function (x) { return { color: x.id, count: x.count }; });
      return { t: 'pipe', dir: pipeDir, queue: q, next: 0 };
    }
    if ((sp.id === 0 || sp.id == null) && types.length === 0) return null;   // 空
    // 【v138】数字冰 type:7 的两种 param 形态都要认（实机既有标量也有同序数组，见文件头说明）
    var numIce = 0;
    if (types.indexOf(7) >= 0) {
      if (Array.isArray(sp.param)) numIce = parseInt(sp.param[types.indexOf(7)], 10) || 0;
      else numIce = parseInt(sp.param, 10) || 0;      // 仅数字冰：param 是标量倒计时
    }
    var chain = 0;
    if (types.indexOf(5) >= 0) {
      chain = Array.isArray(sp.param) ? (parseInt(sp.param[types.indexOf(5)], 10) || 0)
                                      : (typeof sp.param === 'number' ? sp.param : 0);
    }
    // 【v139】老冰(type 4)已下线：导入时一律转成数字冰，且数值不足时补到 NUMICE_DEFAULT
    if (types.indexOf(4) >= 0 && numIce <= 0) numIce = AntSolver.NUMICE_DEFAULT || 3;
    return {
      t: 'box', color: sp.id, count: sp.count || 0,
      chain: chain,
      q: types.indexOf(6) >= 0,
      numice: numIce
    };
  }
  var cells = [];
  for (var r = 0; r < maprow; r++) {
    var row = [];
    for (var c = 0; c < mapcol; c++) row.push(spoolToCell(g.spools[r][c]));
    cells.push(row);
  }
  return {
    blocks: g.blocks || [],
    board: { rows: maprow, cols: mapcol, cells: cells },
    bufferLimit: g.bufferLimit || 5
  };
};
