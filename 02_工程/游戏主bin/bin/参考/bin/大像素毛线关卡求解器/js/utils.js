/**
 * 毛线JSON关卡编辑器 - 工具函数和常量
 */

// 全局命名空间
var YarnLevel = YarnLevel || {};

// ==================== 颜色映射表（唯一数据源） ====================
YarnLevel.COLOR_MAP = [
  { id: 1,  name: '红色',     cssColor: '#FF3240' },
  { id: 2,  name: '玫粉',     cssColor: '#FF269F' },
  { id: 3,  name: '粉红',     cssColor: '#FF5294' },
  { id: 4,  name: '暗粉',     cssColor: '#DF2455' },
  { id: 5,  name: '浅粉',     cssColor: '#FF98A3' },
  { id: 6,  name: '深红',     cssColor: '#F63C3F' },
  { id: 7,  name: '紫色',     cssColor: '#A073E7' },
  { id: 8,  name: '紫粉',     cssColor: '#E749B6' },
  { id: 9,  name: '玫红',     cssColor: '#AD00AC' },
  { id: 10, name: '亮紫',     cssColor: '#C538C3' },
  { id: 11, name: '深紫',     cssColor: '#A032DC' },
  { id: 12, name: '紫红',     cssColor: '#C60174' },
  { id: 13, name: '天蓝',     cssColor: '#00ACF6' },
  { id: 14, name: '浅蓝',     cssColor: '#00E1EF' },
  { id: 15, name: '深青',     cssColor: '#256A85' },
  { id: 16, name: '灰蓝',     cssColor: '#7074B6' },
  { id: 17, name: '蓝紫',     cssColor: '#6F67DC' },
  { id: 18, name: '蓝色',     cssColor: '#6B5BBA' },
  { id: 19, name: '黄绿',     cssColor: '#95E502' },
  { id: 20, name: '绿色',     cssColor: '#01CC64' },
  { id: 21, name: '青绿',     cssColor: '#00AEAD' },
  { id: 22, name: '亮绿',     cssColor: '#04DB01' },
  { id: 23, name: '浅绿',     cssColor: '#02CBA9' },
  { id: 24, name: '深绿',     cssColor: '#018441' },
  { id: 25, name: '黄色',     cssColor: '#FFB900' },
  { id: 26, name: '砖红',     cssColor: '#C15701' },
  { id: 27, name: '浅橙',     cssColor: '#FF9F6A' },
  { id: 28, name: '橙色',     cssColor: '#FF8002' },
  { id: 29, name: '金橙',     cssColor: '#F69602' },
  { id: 30, name: '金黄',     cssColor: '#F9DA00' },
  { id: 31, name: '米白',     cssColor: '#FDE8D6' },
  { id: 32, name: '浅黄',     cssColor: '#FFEAB2' },
  { id: 33, name: '黑色',     cssColor: '#010101' },
  { id: 34, name: '灰色',     cssColor: '#BBB6B7' }
];

// ==================== 特殊元素类型 ====================
YarnLevel.TYPE_MAP = {
  0:  { name: '普通', icon: '' },
  4:  { name: '冰块', icon: '❄' },
  5:  { name: '链条', icon: '🔗' },
  6:  { name: '问号', icon: '❓' },
  11: { name: '管道↑', icon: '↑' },
  12: { name: '管道→', icon: '→' },
  13: { name: '管道↓', icon: '↓' },
  14: { name: '管道←', icon: '←' }
};

// 管道类型集合
YarnLevel.PIPE_TYPES = [11, 12, 13, 14];

// 特殊覆盖类型（可叠加）
YarnLevel.OVERLAY_TYPES = [4, 5, 6];

// ==================== 构建快速查找索引 ====================
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

// 获取颜色CSS
YarnLevel.getColorCSS = function(colorId) {
  var entry = YarnLevel._colorIndex[colorId];
  return entry ? entry.cssColor : null;
};

// 获取颜色名称
YarnLevel.getColorName = function(colorId) {
  if (colorId === 0) return '空';
  if (colorId === -1) return '黑块';
  var entry = YarnLevel._colorIndex[colorId];
  return entry ? entry.name + '(' + colorId + ')' : '未知(' + colorId + ')';
};

// 判断是否管道类型
YarnLevel.isPipeType = function(type) {
  if (Array.isArray(type)) {
    for (var i = 0; i < type.length; i++) {
      if (YarnLevel.PIPE_TYPES.indexOf(type[i]) !== -1) return true;
    }
    return false;
  }
  return YarnLevel.PIPE_TYPES.indexOf(type) !== -1;
};

// 获取管道方向类型值
YarnLevel.getPipeDirection = function(type) {
  if (Array.isArray(type)) {
    for (var i = 0; i < type.length; i++) {
      if (YarnLevel.PIPE_TYPES.indexOf(type[i]) !== -1) return type[i];
    }
    return null;
  }
  return YarnLevel.PIPE_TYPES.indexOf(type) !== -1 ? type : null;
};

// 获取类型显示文本
YarnLevel.getTypeDisplay = function(type) {
  if (Array.isArray(type)) {
    return type.map(function(t) {
      var info = YarnLevel.TYPE_MAP[t];
      return info ? info.name : String(t);
    }).join('+');
  }
  var info = YarnLevel.TYPE_MAP[type];
  return info ? info.name : String(type);
};

// 获取类型覆盖图标
YarnLevel.getTypeIcons = function(type) {
  var icons = [];
  var types = Array.isArray(type) ? type : [type];
  for (var i = 0; i < types.length; i++) {
    var info = YarnLevel.TYPE_MAP[types[i]];
    if (info && info.icon) icons.push(info.icon);
  }
  return icons;
};

// ==================== 深拷贝辅助 ====================
YarnLevel.deepClone = function(obj) {
  return JSON.parse(JSON.stringify(obj));
};

// 创建空的spool元素
YarnLevel.createEmptySpool = function() {
  return { id: 0, type: 0, param: 0 };
};

// ==================== 目标区block取色辅助（兼容两种格式） ====================
// 旧格式：{id: 26, type: 0}；新大像素格式：纯数字 26
YarnLevel.getBlockId = function(block) {
  if (block === null || block === undefined) return 0;
  if (typeof block === 'number') return block;
  if (typeof block === 'object') return block.id || 0;
  return 0;
};

// ==================== 线轴订单量辅助 ====================
// 每个线轴需要消除的目标像素数（新大像素规则，基础48上下浮动）。
// 旧关卡无 count 字段 → 回退到默认值3（保持旧关卡兼容）。
YarnLevel.DEFAULT_ORDER = 3;

YarnLevel.getSpoolCount = function(spool) {
  if (spool && typeof spool.count === 'number' && spool.count > 0) return spool.count;
  return YarnLevel.DEFAULT_ORDER;
};

// 管道param元素的颜色id（兼容：新格式 {id,count}，旧格式纯数字）
YarnLevel.getPipeItemId = function(item) {
  if (item === null || item === undefined) return 0;
  if (typeof item === 'number') return item;
  if (typeof item === 'object') return item.id || 0;
  return 0;
};

// 管道param元素的订单量count（旧格式纯数字 → 默认值）
YarnLevel.getPipeItemCount = function(item) {
  if (item && typeof item === 'object' && typeof item.count === 'number' && item.count > 0) return item.count;
  return YarnLevel.DEFAULT_ORDER;
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
  // 特殊颜色
  css += '.color-0 { background-color: transparent; }\n';
  css += '.color--1 { background-color: #000000; }\n';
  style.textContent = css;
  document.head.appendChild(style);
})();
