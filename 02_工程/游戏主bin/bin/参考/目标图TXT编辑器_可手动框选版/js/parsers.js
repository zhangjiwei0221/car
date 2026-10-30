/**
 * 目标图 TXT 编辑器 - 解析和序列化
 */

var YarnLevel = YarnLevel || {};

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
  for (var r = matrixStartIndex; r < lines.length; r++) {
    var line = lines[r].trim();
    if (line === '') continue;
    var values = line.split(/[\s,]+/).filter(function(v) { return v !== ''; });
    if (values.length === 0) continue;
    var row = [];
    for (var c = 0; c < values.length; c++) {
      var num = parseInt(values[c], 10);
      if (!isNaN(num)) row.push(num);
    }
    if (row.length > 0) matrix.push(row);
  }
  if (matrix.length === 0) return new YarnLevel.ParseError('文件格式错误：未找到像素矩阵');
  var width = matrix[0].length;
  for (var i = 1; i < matrix.length; i++) {
    if (matrix[i].length !== width) return new YarnLevel.ParseError('文件格式错误：像素矩阵每行宽度不一致');
  }
  return matrix;
};

YarnLevel.serializeTXT = function(blocks) {
  // 标准 TXT 格式（田耿确认）：
  // 第一行固定为「像素矩阵」；后续每行使用空格分隔数字；文件末尾保留换行。
  var lines = ['像素矩阵'];
  blocks = Array.isArray(blocks) ? blocks : [];
  for (var i = 0; i < blocks.length; i++) {
    var row = Array.isArray(blocks[i]) ? blocks[i] : [];
    var rowValues = row.map(function(block) {
      if (typeof block === 'number') return block;
      if (block && typeof block.id === 'number') return block.id;
      return 0;
    });
    lines.push(rowValues.join(' '));
  }
  return lines.join('\n') + '\n';
};
