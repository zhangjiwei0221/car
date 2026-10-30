/**
 * StackSort 求解器 - 颜色模块
 *
 * 关卡 JSON 用 (colorId, shadeIndex) 标识颜色。
 * 颜色色值来自项目组《色值表格.xlsx》，仅采用【有美术资源（K列="是"）】的颜色，
 * 保证网页模拟展示的颜色与项目真实色库一一对应。
 *
 *  - HEX：全部 26 个"有资源"色 (colorId_shadeIndex → 真实色值)，用于渲染/显示。
 *  - LIBRARY：关卡生成色库——每个颜色族取 1 个最具代表性的资源档，共 10 色，
 *             两两 RGB 对比度高；单关最多 8 列=8 色，从中按对比度挑高反差子集。
 */
var SS = SS || {};

SS.Colors = (function () {

  function hex2rgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function dist2(a, b) {
    var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;   // RGB 欧氏距离的平方（比大小够用，省开方）
  }

  // ===== 真实色库（仅"有资源=是"的 26 色） colorId_shadeIndex → 色值 =====
  var HEX = {
    '2_0': '#3e3e3e',                                                             // Black
    '3_0': '#e5e0dd',                                                             // White
    '10_1': '#fea5a2', '10_2': '#f7716e', '10_3': '#d53c38', '10_5': '#501a1a',   // Red
    '11_0': '#37af21', '11_2': '#bffb95', '11_3': '#7dcc63',                      // Green
    '12_0': '#40b9fe', '12_1': '#d7fafe', '12_2': '#8cf2fe',
    '12_3': '#6cb6fe', '12_4': '#3c7cfe', '12_5': '#1b3196',                      // Blue
    '13_1': '#f2e78f', '13_3': '#fec232', '13_4': '#f5912f',                      // Yellow
    '14_0': '#bb28fd', '14_2': '#bfabfe', '14_3': '#745cc7',                      // Purple
    '15_0': '#ff6dee',                                                            // Pink
    '17_0': '#2d46da',                                                            // NavyBlue
    '19_2': '#f9c188', '19_3': '#e3a063', '19_4': '#9f7a51'                       // Brown
  };

  // ===== 关卡生成色库（10 色：每族 1 个高对比代表档） =====
  // 取档依据：在该族"有资源"的明度档里，使全库两两 RGB 对比度最大化。
  var LIBRARY = [
    { name: 'Black',    colorId: 2,  shadeIndex: 0, hex: '#3e3e3e' },
    { name: 'White',    colorId: 3,  shadeIndex: 0, hex: '#e5e0dd' },
    { name: 'Red',      colorId: 10, shadeIndex: 3, hex: '#d53c38' },
    { name: 'Green',    colorId: 11, shadeIndex: 0, hex: '#37af21' },
    { name: 'Blue',     colorId: 12, shadeIndex: 0, hex: '#40b9fe' },
    { name: 'Yellow',   colorId: 13, shadeIndex: 3, hex: '#fec232' },
    { name: 'Purple',   colorId: 14, shadeIndex: 0, hex: '#bb28fd' },
    { name: 'Pink',     colorId: 15, shadeIndex: 0, hex: '#ff6dee' },
    { name: 'NavyBlue', colorId: 17, shadeIndex: 0, hex: '#2d46da' },
    { name: 'Brown',    colorId: 19, shadeIndex: 3, hex: '#e3a063' }
  ];
  LIBRARY.forEach(function (e) { e.rgb = hex2rgb(e.hex); e.key = e.colorId + '_' + e.shadeIndex; });

  function colorKey(colorId, shadeIndex) {
    return colorId + '_' + (shadeIndex || 0);
  }

  // 从生成色库挑 n 个【两两 RGB 对比度最高】的颜色：随机起点 + 贪心 max-min。
  // 随机起点让各关配色有变化，max-min 保证所选颜色互相反差大（避免撞色）。
  // 返回 [{colorId, shadeIndex}, ...]（长度 = min(n, 库容量)）。
  function pickContrastColors(n) {
    n = Math.max(1, Math.min(n, LIBRARY.length));
    var pool = LIBRARY.slice();
    var chosen = [];
    chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);   // 随机起点
    while (chosen.length < n) {
      var bestIdx = 0, bestMin = -1;
      for (var i = 0; i < pool.length; i++) {
        var mn = Infinity;
        for (var j = 0; j < chosen.length; j++) {
          var d = dist2(pool[i].rgb, chosen[j].rgb);
          if (d < mn) mn = d;
        }
        if (mn > bestMin) { bestMin = mn; bestIdx = i; }   // 选"到已选集合最小距离最大"的
      }
      chosen.push(pool.splice(bestIdx, 1)[0]);
    }
    return chosen.map(function (e) { return { colorId: e.colorId, shadeIndex: e.shadeIndex }; });
  }

  // 兜底调色板：仅用于显示未登记到 HEX 的旧关卡色键（如早期用占位 id 生成的关），保证不崩、可区分。
  var FALLBACK = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6',
    '#bfef45', '#fabed4', '#469990', '#dcbeff', '#9a6324', '#800000', '#808000', '#000075'
  ];
  var fbSlot = {}, fbNext = 0;

  function cssForKey(key) {
    if (key === 'rainbow') return null;       // 万能牌单独渲染
    if (HEX[key]) return HEX[key];            // 真实色库命中
    if (fbSlot[key] === undefined) { fbSlot[key] = fbNext % FALLBACK.length; fbNext++; }
    return FALLBACK[fbSlot[key]];             // 未登记 → 兜底循环色
  }

  // 重置兜底槽位（切换关卡库时调用，保证旧关卡兜底色分配稳定）。真实色库走 HEX 查表，与此无关。
  function reset() {
    fbSlot = {};
    fbNext = 0;
  }

  return {
    HEX: HEX,
    LIBRARY: LIBRARY,
    colorKey: colorKey,
    cssForKey: cssForKey,
    pickContrastColors: pickContrastColors,
    reset: reset
  };
})();
