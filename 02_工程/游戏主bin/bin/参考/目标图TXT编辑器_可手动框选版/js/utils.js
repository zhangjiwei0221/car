/**
 * 毛线关卡生成工具 - 工具函数和常量
 */

// 全局命名空间
var YarnLevel = YarnLevel || {};

// ==================== 图片路径常量 ====================
YarnLevel.IMAGE_PATHS = {
  TARGET_ZONE: '拆毛线占位元素/颜色/',
  SPECIAL: '拆毛线占位元素/其他内容/'
};

// ==================== 颜色映射表（唯一数据源） ====================
// 维护说明：
//   - 调整颜色顺序：改变数组中对象的位置即可
//   - 修改颜色编码：修改对应对象的 id 字段
//   - 加新颜色：在数组末尾（或任意位置）添加新对象
//   - 图片名称：targetImage 可独立维护
//   - cssColor：用于颜色选择面板和网格单元格的背景色
YarnLevel.COLOR_MAP = [
  { id: 1,  name: '红色',     cssColor: '#F64942', targetImage: '目标区颜色1.png' },
  { id: 2,  name: '浅红',     cssColor: '#FF51B0', targetImage: '目标区颜色2.png' },
  { id: 3,  name: '粉红',     cssColor: '#FF5381', targetImage: '目标区颜色3.png' },
  { id: 4,  name: '暗粉',     cssColor: '#A53950', targetImage: '目标区颜色4.png' },
  { id: 5,  name: '浅粉',     cssColor: '#FFA5AD', targetImage: '目标区颜色5.png' },
  { id: 6,  name: '深红',     cssColor: '#D5514C', targetImage: '目标区颜色6.png' },
  { id: 7,  name: '紫色',     cssColor: '#8A6CD4', targetImage: '目标区颜色7.png' },
  { id: 8,  name: '浅紫粉',   cssColor: '#C054A6', targetImage: '目标区颜色8.png' },
  { id: 9,  name: '玫红',     cssColor: '#8D0084', targetImage: '目标区颜色9.png' },
  { id: 10, name: '灰紫',     cssColor: '#A03CAE', targetImage: '目标区颜色10.png' },
  { id: 11, name: '深紫',     cssColor: '#7135A4', targetImage: '目标区颜色11.png' },
  { id: 12, name: '紫红',     cssColor: '#A31A6B', targetImage: '目标区颜色12.png' },
  { id: 13, name: '天蓝',     cssColor: '#0E9CE6', targetImage: '目标区颜色13.png' },
  { id: 14, name: '浅蓝',     cssColor: '#41DBEA', targetImage: '目标区颜色14.png' },
  { id: 15, name: '深棕',     cssColor: '#38647A', targetImage: '目标区颜色15.png' },
  { id: 16, name: '深蓝',     cssColor: '#62679E', targetImage: '目标区颜色16.png' },
  { id: 17, name: '灰蓝',     cssColor: '#5C5ABC', targetImage: '目标区颜色17.png' },
  { id: 18, name: '蓝色',     cssColor: '#5A51A3', targetImage: '目标区颜色18.png' },
  { id: 19, name: '浅黄',     cssColor: '#B2F200', targetImage: '目标区颜色19.png' },
  { id: 20, name: '绿色',     cssColor: '#03B361', targetImage: '目标区颜色20.png' },
  { id: 21, name: '橄榄绿',   cssColor: '#009A9B', targetImage: '目标区颜色21.png' },
  { id: 22, name: '青蓝',     cssColor: '#00BB21', targetImage: '目标区颜色22.png' },
  { id: 23, name: '浅绿',     cssColor: '#01BA9C', targetImage: '目标区颜色23.png' },
  { id: 24, name: '深绿',     cssColor: '#016F3C', targetImage: '目标区颜色24.png' },
  { id: 25, name: '黄色',     cssColor: '#FFC407', targetImage: '目标区颜色25.png' },
  { id: 26, name: '砖红',     cssColor: '#AC5716', targetImage: '目标区颜色26.png' },
  { id: 27, name: '浅橙',     cssColor: '#FFB78B', targetImage: '目标区颜色27.png' },
  { id: 28, name: '橙色',     cssColor: '#FF7E01', targetImage: '目标区颜色28.png' },
  { id: 29, name: '深棕2',    cssColor: '#E59A1D', targetImage: '目标区颜色29.png' },
  { id: 30, name: '棕色',     cssColor: '#FFE900', targetImage: '目标区颜色30.png' },
  { id: 31, name: '浅灰',     cssColor: '#F4ECE1', targetImage: '目标区颜色31.png' },
  { id: 32, name: '灰色',     cssColor: '#FFF6CE', targetImage: '目标区颜色32.png' },
  { id: 33, name: '深灰',     cssColor: '#53647D', targetImage: '目标区颜色33.png' },
  { id: 34, name: '中灰',     cssColor: '#A3A3A3', targetImage: '目标区颜色34.png' }
];

// 构建快速查找索引（id -> 映射对象）
YarnLevel._colorIndex = {};
(function() {
  for (var i = 0; i < YarnLevel.COLOR_MAP.length; i++) {
    var entry = YarnLevel.COLOR_MAP[i];
    YarnLevel._colorIndex[entry.id] = entry;
  }
})();

// 获取颜色映射条目
YarnLevel.getColorEntry = function(colorId) {
  return YarnLevel._colorIndex[colorId] || null;
};

// 获取所有颜色ID列表（按映射表顺序）
YarnLevel.getAllColorIds = function() {
  return YarnLevel.COLOR_MAP.map(function(entry) { return entry.id; });
};

// 获取颜色总数
YarnLevel.getColorCount = function() {
  return YarnLevel.COLOR_MAP.length;
};

YarnLevel.SPECIAL_IMAGE_MAP = {
  11: '11_管道_向上.png',
  12: '12_管道_向右.png',
  13: '13_管道_向下.png',
  14: '14_管道_向左.png',
  21: '21_钥匙1.png',
  22: '22_钥匙2.png',
  23: '23_钥匙3.png',
  24: '24_钥匙4.png',
  25: '25_钥匙5.png',
  31: '31_锁1.png',
  32: '32_锁2.png',
  33: '33_锁3.png',
  34: '34_锁4.png',
  35: '35_锁5.png',
  4: '4_冰块.png',
  5: '5_链条.png',
  1: '1_目标区问号.png'
};

// ==================== 颜色验证和图片获取 ====================
YarnLevel.isValidColorId = function(colorId) {
  return Number.isInteger(colorId) && !!YarnLevel._colorIndex[colorId];
};

YarnLevel.getTargetImage = function(colorId) {
  if (colorId === 0) return null;
  var entry = YarnLevel.getColorEntry(colorId);
  if (!entry) return null;
  return YarnLevel.IMAGE_PATHS.TARGET_ZONE + entry.targetImage;
};


YarnLevel.getSpecialImage = function(typeId) {
  var imageName = YarnLevel.SPECIAL_IMAGE_MAP[typeId];
  return imageName ? YarnLevel.IMAGE_PATHS.SPECIAL + imageName : null;
};

// ==================== 动态注入颜色CSS ====================
(function() {
  var style = document.createElement('style');
  style.id = 'yarn-color-styles';
  var css = '';
  for (var i = 0; i < YarnLevel.COLOR_MAP.length; i++) {
    var entry = YarnLevel.COLOR_MAP[i];
    css += '.color-' + entry.id + ' { background-color: ' + entry.cssColor + '; }\n';
  }
  style.textContent = css;
  document.head.appendChild(style);
})();

// ==================== ParseError 类 ====================
YarnLevel.ParseError = function(message) {
  this.error = true;
  this.message = message;
};

YarnLevel.isParseError = function(result) {
  return result instanceof YarnLevel.ParseError || (result && result.error === true);
};

// ==================== 辅助函数 ====================
YarnLevel.createTargetBlock = function(id, type) {
  return { id: id || 0, type: type || 0 };
};

YarnLevel.cloneTargetBlock = function(block) {
  return { id: block.id, type: block.type };
};

YarnLevel.cloneBlocks = function(blocks) {
  return blocks.map(function(row) {
    return row.map(function(block) { return YarnLevel.cloneTargetBlock(block); });
  });
};

YarnLevel.createSpoolElement = function(id, type, param) {
  return { id: id || 0, type: type || 0, param: param || 0 };
};

YarnLevel.cloneSpoolElement = function(element) {
  return {
    id: element.id,
    type: Array.isArray(element.type) ? element.type.slice() : element.type,
    param: Array.isArray(element.param) ? element.param.slice() : element.param
  };
};

YarnLevel.cloneSpools = function(spools) {
  return spools.map(function(row) {
    return row.map(function(element) { return YarnLevel.cloneSpoolElement(element); });
  });
};

YarnLevel.cloneTerrain = function(terrain) {
  return terrain.map(function(row) { return row.slice(); });
};

YarnLevel.shuffleArray = function(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
};
