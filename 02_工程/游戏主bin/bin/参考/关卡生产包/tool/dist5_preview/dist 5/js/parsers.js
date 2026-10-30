/**
 * 毛线关卡生成工具 - 解析器模块
 */

var YarnLevel = YarnLevel || {};

// ==================== LevelParser 模块 ====================
YarnLevel.REQUIRED_FIELDS = ['toprow', 'blocks', 'maprow', 'mapcol', 'spools'];

YarnLevel.validateTargetBlock = function(block, rowIndex, colIndex) {
  if (typeof block !== 'object' || block === null) {
    return new YarnLevel.ParseError('数据类型错误：blocks[' + rowIndex + '][' + colIndex + ']应为对象');
  }
  if (typeof block.id !== 'number') {
    return new YarnLevel.ParseError('数据类型错误：blocks[' + rowIndex + '][' + colIndex + '].id应为数字');
  }
  if (typeof block.type !== 'number') {
    return new YarnLevel.ParseError('数据类型错误：blocks[' + rowIndex + '][' + colIndex + '].type应为数字');
  }
  return null;
};

YarnLevel.validateSpoolElement = function(element, rowIndex, colIndex) {
  if (typeof element !== 'object' || element === null) {
    return new YarnLevel.ParseError('数据类型错误：spools[' + rowIndex + '][' + colIndex + ']应为对象');
  }
  if (typeof element.id !== 'number') {
    return new YarnLevel.ParseError('数据类型错误：spools[' + rowIndex + '][' + colIndex + '].id应为数字');
  }
  if (typeof element.type !== 'number' && !Array.isArray(element.type)) {
    return new YarnLevel.ParseError('数据类型错误：spools[' + rowIndex + '][' + colIndex + '].type应为数字或数组');
  }
  if (typeof element.param !== 'number' && !Array.isArray(element.param)) {
    return new YarnLevel.ParseError('数据类型错误：spools[' + rowIndex + '][' + colIndex + '].param应为数字或数组');
  }
  return null;
};

YarnLevel.validateBlocks = function(blocks) {
  if (!Array.isArray(blocks)) return new YarnLevel.ParseError('数据类型错误：blocks应为数组');
  for (var i = 0; i < blocks.length; i++) {
    if (!Array.isArray(blocks[i])) return new YarnLevel.ParseError('数据类型错误：blocks[' + i + ']应为数组');
    for (var j = 0; j < blocks[i].length; j++) {
      var error = YarnLevel.validateTargetBlock(blocks[i][j], i, j);
      if (error) return error;
    }
  }
  return null;
};

YarnLevel.validateSpools = function(spools) {
  if (!Array.isArray(spools)) return new YarnLevel.ParseError('数据类型错误：spools应为数组');
  for (var i = 0; i < spools.length; i++) {
    if (!Array.isArray(spools[i])) return new YarnLevel.ParseError('数据类型错误：spools[' + i + ']应为数组');
    for (var j = 0; j < spools[i].length; j++) {
      var error = YarnLevel.validateSpoolElement(spools[i][j], i, j);
      if (error) return error;
    }
  }
  return null;
};

YarnLevel.parseLevelJSON = function(content) {
  if (!content || content.trim() === '') return new YarnLevel.ParseError('文件为空');
  var data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    return new YarnLevel.ParseError('文件格式错误：无效的JSON格式');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return new YarnLevel.ParseError('文件格式错误：无效的JSON格式');
  }
  for (var i = 0; i < YarnLevel.REQUIRED_FIELDS.length; i++) {
    var field = YarnLevel.REQUIRED_FIELDS[i];
    if (!(field in data)) return new YarnLevel.ParseError('文件格式错误：缺少必要字段' + field);
  }
  if (typeof data.toprow !== 'number') return new YarnLevel.ParseError('数据类型错误：toprow应为数字');
  if (typeof data.maprow !== 'number') return new YarnLevel.ParseError('数据类型错误：maprow应为数字');
  if (typeof data.mapcol !== 'number') return new YarnLevel.ParseError('数据类型错误：mapcol应为数字');
  var blocksError = YarnLevel.validateBlocks(data.blocks);
  if (blocksError) return blocksError;
  var spoolsError = YarnLevel.validateSpools(data.spools);
  if (spoolsError) return spoolsError;
  return { toprow: data.toprow, blocks: data.blocks, maprow: data.maprow, mapcol: data.mapcol, spools: data.spools };
};

// ==================== TiledParser 模块 ====================
YarnLevel.parseTiledJSON = function(content) {
  if (!content || content.trim() === '') return new YarnLevel.ParseError('文件为空');
  var data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    return new YarnLevel.ParseError('文件格式错误：无效的JSON格式');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return new YarnLevel.ParseError('文件格式错误：无效的JSON格式');
  }
  if (!Array.isArray(data.layers)) return new YarnLevel.ParseError('文件格式错误：缺少layers数组');
  var boardLayer = null;
  for (var i = 0; i < data.layers.length; i++) {
    if (data.layers[i].name === 'Board') {
      boardLayer = data.layers[i];
      break;
    }
  }
  if (!boardLayer) return new YarnLevel.ParseError('未找到Board层');
  if (typeof boardLayer.width !== 'number' || boardLayer.width <= 0) {
    return new YarnLevel.ParseError('数据类型错误：Board层width应为正整数');
  }
  if (typeof boardLayer.height !== 'number' || boardLayer.height <= 0) {
    return new YarnLevel.ParseError('数据类型错误：Board层height应为正整数');
  }
  if (!Array.isArray(boardLayer.data)) return new YarnLevel.ParseError('数据类型错误：Board层data应为数组');
  var width = boardLayer.width, height = boardLayer.height, flatData = boardLayer.data;
  if (flatData.length !== width * height) {
    return new YarnLevel.ParseError('数据错误：data数组长度与width*height不匹配');
  }
  var grid = [];
  for (var row = 0; row < height; row++) {
    var rowData = [];
    for (var col = 0; col < width; col++) {
      rowData.push(flatData[row * width + col]);
    }
    grid.push(rowData);
  }
  return { width: width, height: height, grid: grid };
};

// ==================== TxtParser 模块 ====================
YarnLevel.parseTXT = function(content) {
  if (!content || content.trim() === '') return new YarnLevel.ParseError('文件为空');
  var lines = content.split(/\r?\n/);
  var matrixStartIndex = -1;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('像素矩阵') !== -1) {
      matrixStartIndex = i + 1;
      break;
    }
  }
  if (matrixStartIndex === -1) return new YarnLevel.ParseError('文件格式错误：未找到像素矩阵');
  var matrix = [];
  for (var i = matrixStartIndex; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line === '') continue;
    var values = line.split(/[\s,]+/).filter(function(v) { return v !== ''; });
    if (values.length === 0) continue;
    var row = [];
    for (var j = 0; j < values.length; j++) {
      var num = parseInt(values[j], 10);
      if (!isNaN(num)) row.push(num);
    }
    if (row.length > 0) matrix.push(row);
  }
  if (matrix.length === 0) return new YarnLevel.ParseError('文件格式错误：未找到像素矩阵');
  return matrix;
};

// ==================== TerrainParser 模块 ====================
YarnLevel.parseTerrainJSON = function(content) {
  if (!content || content.trim() === '') return new YarnLevel.ParseError('文件为空');
  var data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    return new YarnLevel.ParseError('文件格式错误：无效的JSON格式');
  }
  if (!Array.isArray(data)) return new YarnLevel.ParseError('数据类型错误：地形数据应为二维数组');
  for (var i = 0; i < data.length; i++) {
    if (!Array.isArray(data[i])) return new YarnLevel.ParseError('数据类型错误：地形数据应为二维数组');
    for (var j = 0; j < data[i].length; j++) {
      var value = data[i][j];
      if (typeof value !== 'number') return new YarnLevel.ParseError('数据类型错误：地形数据[' + i + '][' + j + ']应为数字');
      if (value !== 0 && value !== 1) return new YarnLevel.ParseError('元素值错误：地形数据[' + i + '][' + j + ']的值必须为0或1');
    }
  }
  return data.map(function(row) { return row.slice(); });
};

// ==================== Serializers 模块 ====================
YarnLevel.serializeLevelJSON = function(levelData) {
  var output = {
    toprow: levelData.toprow,
    blocks: levelData.blocks.map(function(row) {
      return row.map(function(block) { return { id: block.id, type: block.type }; });
    }),
    maprow: levelData.maprow,
    mapcol: levelData.mapcol,
    spools: levelData.spools.map(function(row) {
      return row.map(function(element) { return { id: element.id, type: element.type, param: element.param }; });
    })
  };
  return JSON.stringify(output, null, 2);
};

// Canonical TXT export confirmed by Tian Geng on 2026-05-14.
// Format:
// 像素矩阵
// 1 2 3 ...
YarnLevel.serializeLevelTXT = function(levelData) {
  var source = (levelData && Array.isArray(levelData.spools) && levelData.spools.length > 0)
    ? levelData.spools
    : ((levelData && Array.isArray(levelData.blocks)) ? levelData.blocks : []);
  var lines = ['像素矩阵'];
  for (var i = 0; i < source.length; i++) {
    var row = source[i] || [];
    var values = [];
    for (var j = 0; j < row.length; j++) {
      var cell = row[j];
      var id = 0;
      if (typeof cell === 'number') id = cell;
      else if (cell && typeof cell.id === 'number') id = cell.id;
      values.push(String(id));
    }
    lines.push(values.join(' '));
  }
  return lines.join('\n') + '\n';
};

YarnLevel.serializeTerrainJSON = function(terrainData) {
  if (!terrainData || !Array.isArray(terrainData)) return '[]';
  var output = terrainData.map(function(row) {
    if (!Array.isArray(row)) return [];
    return row.map(function(cell) { return cell === 1 ? 1 : 0; });
  });
  return JSON.stringify(output, null, 2);
};
