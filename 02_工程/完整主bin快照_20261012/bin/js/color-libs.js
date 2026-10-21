/**
 * 蚂蚁拿块求解器 - 【色库 v154】两套色库 + 新老互转
 *
 * 为什么需要这个模块
 * ------------------
 * 本工程历史上只有一套色库：「真实毛线标准色库」34 色（编号 1-34，0 = 空位），
 * 也就是 js/utils.js 里的 AntSolver.COLORS。
 * 2026-10 拿到官方 JSON 提取出来的 300 关，用的是**另一套** 22 色官方色库：
 *   编号 0-21（0 = 黄色，-1 = 空位），Hex 与 34 色库**无一相同**（已逐一比对）。
 * 两套色库的编号空间互相冲突（旧的 0=空、新的 0=黄），直接混读会把「黄像素」读成空位。
 *
 * 本模块做的事
 * ------------
 *   1. 把两套色库的权威色值内置（来源：bin/参考/色库/，见下），供识别/预览/转换使用；
 *   2. 自动识别一张目标图 TXT 用的是哪套色库（依据空位标记与出现过的编号）；
 *   3. 新老互转（按 Hex 最近色，双向往返都是一张确定性的映射表，不做人工猜测）：
 *        · toSolver  : 官方 0-21（-1 空位） → 本工程 1-34（0 空位），供生成器/模拟器直接吃；
 *        · toOfficial: 本工程 1-34（0 空位） → 官方 0-21（-1 空位），供交回实机/存档。
 *
 * 求解器内部一律只跑 34 色库编号，所以转换只发生在【导入/导出 TXT 的边界】上，
 * 不影响生成器、模拟器、分析等任何既有逻辑。
 *
 * 数据来源（两处内容一致，任一处改动都要同步）
 *   · bin/参考/色库/标准色库/标准色库_colors_0-21.txt ................ 官方 22 色
 *   · bin/参考/色库/official_json_original_color_matrices/original_color_library.txt
 *   · bin/参考/色库/标准色库/标准色库毛线真实.txt ..................... 本工程 34 色
 *     （同一份也在 bin/参考/ 毛线色库/标准色库毛线真实.txt，与 js/utils.js 的 COLORS 对齐）
 */
(function (root) {
  'use strict';

  var CL = {};

  // ==================== 一、本工程色库（老·真实毛线 34 色，编号 1-34，0 = 空位）====================
  // 与 js/utils.js 的 AntSolver.COLORS 严格同源；此处内置一份便于本模块独立做识别/转换。
  CL.OLDER_ID = 'older';
  CL.OLDER_NAME = '真实毛线标准色库（老·34色）';
  CL.OLDER_EMPTY = 0;
  CL.OLDER_MIN = 1;
  CL.OLDER_MAX = 34;
  CL.OLDER = {
    id: CL.OLDER_ID,
    label: '老色库 · 34色',
    short: '34色',
    empty: 0,               // 空位标记
    min: 1, max: 34,
    colors: [               // 下标 = 颜色编号（0 号占位 = 空）
      null,
      { name: '红色',   hex: '#FF3240' }, { name: '浅红',   hex: '#FF269F' },
      { name: '粉红',   hex: '#FF5294' }, { name: '暗粉',   hex: '#DF2455' },
      { name: '浅粉',   hex: '#FF98A3' }, { name: '深红',   hex: '#F63C3F' },
      { name: '紫色',   hex: '#A073E7' }, { name: '浅紫粉', hex: '#E749B6' },
      { name: '玫红',   hex: '#AD00AC' }, { name: '灰紫',   hex: '#C538C3' },
      { name: '深紫',   hex: '#A032DC' }, { name: '紫红',   hex: '#C60174' },
      { name: '天蓝',   hex: '#00ACF6' }, { name: '浅蓝',   hex: '#00E1EF' },
      { name: '深棕',   hex: '#256A85' }, { name: '深蓝',   hex: '#7074B6' },
      { name: '灰蓝',   hex: '#6F67DC' }, { name: '蓝色',   hex: '#6B5BBA' },
      { name: '浅黄',   hex: '#95E502' }, { name: '绿色',   hex: '#01CC64' },
      { name: '橄榄绿', hex: '#00AEAD' }, { name: '青蓝',   hex: '#04DB01' },
      { name: '浅绿',   hex: '#02CBA9' }, { name: '深绿',   hex: '#018441' },
      { name: '黄色',   hex: '#FFB900' }, { name: '砖红',   hex: '#C15701' },
      { name: '浅橙',   hex: '#FF9F6A' }, { name: '橙色',   hex: '#FF8002' },
      { name: '深棕2',  hex: '#F69602' }, { name: '棕色',   hex: '#F9DA00' },
      { name: '浅灰',   hex: '#FDE8D6' }, { name: '灰色',   hex: '#FFEAB2' },
      { name: '深灰',   hex: '#010101' }, { name: '中灰',   hex: '#BBB6B7' }
    ]
  };

  // ==================== 二、官方色库（新·官方 22 色，编号 0-21，-1 = 空位）====================
  CL.OFFICIAL_ID = 'official';
  CL.OFFICIAL_NAME = '官方色库（新·0-21）';
  CL.OFFICIAL_EMPTY = -1;
  CL.OFFICIAL_MIN = 0;
  CL.OFFICIAL_MAX = 21;
  CL.OFFICIAL = {
    id: CL.OFFICIAL_ID,
    label: '新色库 · 官方0-21',
    short: '官方22色',
    empty: -1,              // 空位标记（官方 JSON 用 -1，避免与 0 号黄色冲突）
    min: 0, max: 21,
    colors: [
      { name: '黄色',   hex: '#FFEB33' }, { name: '橙黄',   hex: '#FFBF24' },
      { name: '橙色',   hex: '#FF8025' }, { name: '暗红',   hex: '#E75862' },
      { name: '深红',   hex: '#D52C21' }, { name: '浅绿',   hex: '#AEDB6F' },
      { name: '深绿',   hex: '#1F9D12' }, { name: '墨绿',   hex: '#178459' },
      { name: '浅蓝',   hex: '#61D6F0' }, { name: '天蓝',   hex: '#3B90F9' },
      { name: '浅粉',   hex: '#FFB1BE' }, { name: '粉紫',   hex: '#F97AFF' },
      { name: '紫色',   hex: '#9746EC' }, { name: '深蓝',   hex: '#2513BA' },
      { name: '深棕',   hex: '#793A1D' }, { name: '白色',   hex: '#D7DFE0' },
      { name: '黑色',   hex: '#48494D' }, { name: '米色',   hex: '#F3C4A7' },
      { name: '蓝色',   hex: '#3150FF' }, { name: '棕色',   hex: '#985B2E' },
      { name: '玫红',   hex: '#DE1B5F' }, { name: '米黄',   hex: '#F2E58A' }
    ]
  };

  CL.LIBS = {};
  CL.LIBS[CL.OLDER_ID] = CL.OLDER;
  CL.LIBS[CL.OFFICIAL_ID] = CL.OFFICIAL;

  /**
   * 取一套色库。接受库对象本身（防调用方误传对象造成"静默回落到默认库"）或 id 字符串；
   * 'auto' / undefined / 未知值一律回落到老色库（＝求解器内部编号空间）。
   */
  CL.get = function (which) {
    if (which === CL.OLDER || which === CL.OFFICIAL) return which;
    return CL.LIBS[which] || CL.OLDER;
  };

  // ==================== 三、色值工具 ====================

  /** '#RRGGBB' → [r,g,b]。 */
  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  CL.hexToRgb = hexToRgb;

  /** 两色 RGB 欧氏距离（0-441），与 参考/靠色色库.md 的口径一致。 */
  CL.rgbDist = function (hexA, hexB) {
    var a = hexToRgb(hexA), b = hexToRgb(hexB);
    var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  CL.colorOf = function (lib, id) {
    var L = CL.get(lib);
    if (id < L.min || id > L.max) return null;   // 含老色库的 0（空位）与官方色库的 -1
    return L.colors[id < 0 ? 0 : (L === CL.OLDER ? id : id)] || null;
  };

  CL.hexOf = function (lib, id) {
    var c = CL.colorOf(lib, id);
    return c ? c.hex : null;
  };

  CL.nameOf = function (lib, id) {
    var L = CL.get(lib);
    if (id === L.empty) return '空位';
    var c = CL.colorOf(lib, id);
    return c ? c.name : ('未知(' + id + ')');
  };

  // ==================== 四、识别：一张目标图 TXT 用的是哪套色库 ====================
  /**
   * 判据（按证据强度排序）—— 全部来自对官方 300 关的实测：
   *   · 官方 300 关里 185 关带 -1 空位；另 115 关是「实心图形」，压根没有空位（既无 -1 也无 0）。
   *     所以**不能**把「没有 -1」当成「不是官方色库」。
   *   · 官方色库有 0 号色（黄）；老色库的 0 是空位。两者都靠 0 判断，这一项是歧义的唯一来源。
   *   · 两套色库**没有一个同 Hex 的色**（已逐一比对），所以「读成哪套」会实打实改变颜色。
   *
   *   1) 出现负数          → 官方（只有官方用 -1 当空位）
   *   2) 出现 >21 的编号   → 老色库（只有 34 色库有 22-34）
   *   3) 无 0 无负、编号全在 1-21 → **判据不足**：这种实心图在两套色库里都是合法编号，
   *      无法从数据本身区分（实测官方 300 关里有 63 关是这样）。标 confident=false，
   *      按「读图色库」下拉的当前选择处理，界面会提示需要人工确认。
   *   4) 有 0 无负 → 看 0 的占比：0 占比高 = 大面积为空（老色库）／占比低 = 黄色底（官方）。
   *
   * @param {Array<Array<number>>} matrix 目标图矩阵（原样数字，未做任何转换）
   * @returns {{lib:string, confident:boolean, reason:string, maxVal:number,
   *            hasNeg:boolean, hasZero:boolean, usedCount:number, zeroRatio:number}}
   *   lib        'official' | 'older' —— 判定结果（存疑时给更可能的那个）
   *   confident  false = 判据不足，界面会标「存疑」，用户可在「读图色库」下拉里改
   */
  CL.detect = function (matrix) {
    var maxVal = -Infinity, hasNeg = false, hasZero = false, used = {};
    var zero = 0, total = 0;
    var rows = matrix || [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || [];
      for (var c = 0; c < row.length; c++) {
        var v = row[c];
        if (typeof v !== 'number' || !isFinite(v)) continue;
        total++;
        if (v > maxVal) maxVal = v;
        if (v < 0) hasNeg = true;
        if (v === 0) { hasZero = true; zero++; }
        if (v >= 0) used[v] = 1;
      }
    }
    if (maxVal === -Infinity) maxVal = 0;
    var usedCount = Object.keys(used).length;
    var zeroRatio = total ? zero / total : 0;
    var base = { maxVal: maxVal, hasNeg: hasNeg, hasZero: hasZero, usedCount: usedCount, zeroRatio: zeroRatio };

    // 1) 出现负数：只有官方色库用 -1 当空位 → 铁证。
    if (hasNeg && maxVal <= 21) {
      return Object.assign(base, { lib: CL.OFFICIAL_ID, confident: true,
        reason: '出现 -1（官方色库的空位标记）' });
    }
    // 2) 出现 >21 的编号：只可能是 34 色老色库。
    if (maxVal > 21) {
      return Object.assign(base, { lib: CL.OLDER_ID, confident: true,
        reason: '出现编号 ' + maxVal + ' > 21，只可能来自 34 色老色库' });
    }
    // 3) 0 与 -1 都没出现 → 实心图，两套色库都是合法编号，判据不足。
    if (!hasZero && !hasNeg) {
      return Object.assign(base, { lib: CL.OLDER_ID, confident: false,
        reason: '无 -1、无 0，编号全在 1-' + maxVal + '：实心图，两套色库都能解释，需人工确认（按当前「读图色库」选择处理）' });
    }
    // 4) 有 0 没负数：官方色库的 0 是黄色，老色库的 0 是空位 → 看 0 的占比。
    if (zeroRatio >= 0.5) {
      return Object.assign(base, { lib: CL.OLDER_ID, confident: true,
        reason: '0 占 ' + Math.round(zeroRatio * 100) + '%（大面积为空）→ 按老色库读，0 = 空位' });
    }
    return Object.assign(base, { lib: CL.OFFICIAL_ID, confident: true,
      reason: '有 0 且只占 ' + Math.round(zeroRatio * 100) + '%（不是大面积空位）→ 按官方色库读，0 = 黄色' });
  };

  // ==================== 五、转换：新老互转 ====================
  /**
   * 映射策略：**官方 22 色 → 老色库 22 个互不相同的色（单射）**
   *
   * 为什么不直接用「各自取最近色」：两套色库无一色相同，纯最近色会让 4 组官方色
   * 抢同一个老色号（实测：官方3/4→老6、官方6/7→老24、官方14/19→老26、官方17/21→老32），
   * 而 300 关里有 141 关同时用到了这些撞色的两个色 —— 撞色等于把两个不同颜色的像素
   * 合成一个，目标图直接失真。所以这里用**最小代价单射分配**（匈牙利算法，
   * 22×34 规模，毫秒级）：保证 22 个官方色落到 22 个互不相同的老色号上。
   * 实测代价只比纯最近色高 7%（1334.3 vs 1242.7），换来 141 关不撞色，划算。
   *
   * 反向（老 → 官方）用同一个分配表的逆 + 其余老色取最近色，并显式保证这 22 个老色
   * 都能原样变回自己的官方号 —— 所以「新→老→新」是逐像素无损的（300 关已全量校验）。
   */
  var _assign = null;    // { official:[22] -> 老色号, officialToOld:{}, oldToOfficial:{} , rows:[] }

  /**
   * 最小代价单射分配（指派问题）：n 行（官方 22 色）各分到一个互不相同的列（老色号）。
   *
   * 实现 = 逐行加入 + Dijkstra 带势能找最小代价增广路（Jonker-Volgenant / 匈牙利法同族），
   * 全部用 1 基下标、`p[j]` 存「列 j 是哪一行占的」，与 O(n^3) 标准写法一一对应。
   * 关键点：每加一行都会**重排已有分配**（增广沿交替路回退旧行），所以是全局最优，
   * 不是「每行各取自己最近的空列」那种贪心。
   *
   * @param {number[][]} cost cost[i][j]（0 起）= 第 i 行分到第 j 列的代价
   * @returns {number[]} pick[i]（0 起）= 第 i 行分到的列下标
   */
  function minCostAssign(cost) {
    var n = cost.length, m = cost[0].length;
    var INF = Infinity;
    // u[i]/v[j] = 第 i 行 / 第 j 列的势能；p[j] = 列 j 当前由哪一行占用（0 = 空）
    var u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0);

    for (var i = 1; i <= n; i++) {
      p[0] = i;
      var j0 = 0;
      var minv = new Array(m + 1).fill(INF), way = new Array(m + 1).fill(0);
      var used = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        var i0 = p[j0], delta = INF, j1 = 0;
        for (var j = 1; j <= m; j++) {
          if (used[j]) continue;
          var cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (var j2 = 0; j2 <= m; j2++) {
          if (used[j2]) { u[p[j2]] += delta; v[j2] -= delta; }
          else { minv[j2] -= delta; }
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do {
        var j3 = way[j0];
        p[j0] = p[j3];
        j0 = j3;
      } while (j0 !== 0);
    }

    var pick = new Array(n).fill(-1);
    for (var j4 = 1; j4 <= m; j4++) if (p[j4] !== 0) pick[p[j4] - 1] = j4 - 1;
    return pick;
  }

  /** 建/取官方↔老 的单射分配（含两个方向的完整映射表）。 */
  function assignment() {
    if (_assign) return _assign;
    var O = CL.OFFICIAL, L = CL.OLDER;

    // 同 Hex 先直接锁定（本工程两套色库无一相同，这里是为将来加了同色也仍然正确）
    var cost = [], exactPairs = {};
    for (var i = O.min; i <= O.max; i++) {
      var row = [];
      for (var j = L.min; j <= L.max; j++) {
        var d = CL.rgbDist(O.colors[i].hex, L.colors[j].hex);
        if (O.colors[i].hex.toUpperCase() === L.colors[j].hex.toUpperCase()) { d = -1e6; exactPairs[i] = j; }
        row.push(d);
      }
      cost.push(row);
    }
    var pick = minCostAssign(cost);   // pick[k] = 列下标（0-based，对应老色号 = 下标+1）

    var officialToOld = {}, oldToOfficial = {}, rows = [];
    for (var k = 0; k < pick.length; k++) {
      var oid = O.min + k, lid = L.min + pick[k];
      officialToOld[oid] = lid;
      oldToOfficial[lid] = oid;         // 这 22 个老色号有唯一逆
    }
    // 其余老色号（老色库多出来的 12 个）：取最近官方色
    var extra = [];
    for (var lid2 = L.min; lid2 <= L.max; lid2++) {
      if (oldToOfficial[lid2] !== undefined) continue;
      var best = null, bd = Infinity;
      for (var oid2 = O.min; oid2 <= O.max; oid2++) {
        var d2 = CL.rgbDist(L.colors[lid2].hex, O.colors[oid2].hex);
        if (d2 < bd) { bd = d2; best = oid2; }
      }
      oldToOfficial[lid2] = best;
      extra.push({ old: lid2, official: best, dist: bd });
    }

    // 统一成 rows（供面板展示）
    for (var oid3 = O.min; oid3 <= O.max; oid3++) {
      var l3 = officialToOld[oid3];
      rows.push({
        from: oid3, fromName: O.colors[oid3].name, fromHex: O.colors[oid3].hex,
        to: l3, toName: L.colors[l3].name, toHex: L.colors[l3].hex,
        dist: CL.rgbDist(O.colors[oid3].hex, L.colors[l3].hex), exact: exactPairs[oid3] !== undefined
      });
    }
    _assign = {
      officialToOld: officialToOld, oldToOfficial: oldToOfficial, rows: rows, extra: extra,
      maxDist: rows.reduce(function (a, r) { return Math.max(a, r.dist); }, 0),
      maxFrom: rows.reduce(function (a, r) { return a.dist >= r.dist ? a : r; }, rows[0]).from,
      totalDist: rows.reduce(function (a, r) { return a + r.dist; }, 0)
    };
    return _assign;
  }

  /**
   * 取一个方向的映射表。签名与旧版兼容：buildMap(fromLib, toLib)。
   * @returns {{from,to,map,rows,exactCount,maxDist,maxFrom,misses,totalDist,injective}}
   */
  CL.buildMap = function (fromLib, toLib) {
    var F = CL.get(fromLib), T = CL.get(toLib);
    // 两套库分辨不清时（例如误把 'auto' 当来源）会退化成"自己转自己"，
    // 那种表看着能用但毫无意义 —— 这里直接报错，免得静默出错图。
    if (F.id === T.id) throw new Error('色库转换：来源与目标相同（' + F.id + '），无法建映射表');
    var A = assignment();
    var map, rows = [], exactCount = 0, maxDist = -1, maxFrom = null, totalDist = 0;
    var src = F.min === CL.OFFICIAL.min && F.max === CL.OFFICIAL.max ? 'official' : 'older';

    if (src === 'official') {
      map = {};
      for (var k in A.officialToOld) map[k] = A.officialToOld[k];
      for (var i = 0; i < A.rows.length; i++) {
        var r = A.rows[i];
        rows.push(r);
        if (r.exact) exactCount++;
        totalDist += r.dist;
        if (r.dist > maxDist) { maxDist = r.dist; maxFrom = r.from; }
      }
    } else {
      map = {};
      for (var lid in A.oldToOfficial) map[lid] = A.oldToOfficial[lid];
      for (var lid2 = F.min; lid2 <= F.max; lid2++) {
        var fc = F.colors[lid2];
        if (!fc) continue;
        var tid = map[lid2], tc = CL.colorOf(T, tid) || {};
        var d = CL.rgbDist(fc.hex, tc.hex);
        var isExact = fc.hex.toUpperCase() === (tc.hex || '').toUpperCase();
        rows.push({ from: lid2, fromName: fc.name, fromHex: fc.hex,
                    to: tid, toName: tc.name, toHex: tc.hex,
                    dist: d, exact: isExact, inverse: A.officialToOld[tid] === lid2 });
        if (isExact) exactCount++;
        totalDist += d;
        if (d > maxDist) { maxDist = d; maxFrom = lid2; }
      }
    }
    return { from: F.id, to: T.id, map: map, rows: rows, exactCount: exactCount,
             maxDist: maxDist, maxFrom: maxFrom, misses: 0, totalDist: totalDist,
             injective: src === 'official' };
  };

  // 两张方向表都算一次并缓存（色库是静态数据，算一次就够）。
  var _maps = {};
  CL.map = function (fromLib, toLib) {
    var F = CL.get(fromLib), T = CL.get(toLib);
    var key = F.id + '>' + T.id;
    if (!_maps[key]) _maps[key] = CL.buildMap(F.id, T.id);
    return _maps[key];
  };
  CL.mapOfficialToSolver = function () { return CL.map(CL.OFFICIAL_ID, CL.OLDER_ID); };
  CL.mapSolverToOfficial = function () { return CL.map(CL.OLDER_ID, CL.OFFICIAL_ID); };
  /** 单射分配表（官方 22 色 → 老色库 22 个互不相同的色号）。 */
  CL.assignment = assignment;

  /**
   * 转换一张目标图矩阵。
   * 约定：**输出矩阵一律用「老色库/求解器」编号空间时 emptyOut=0**，
   *       输出官方格式时 emptyOut=-1 —— 调用方不用自己记这个。
   *
   * @param {Array<Array<number>>} matrix 输入矩阵（源色库编号）
   * @param {string} fromLib 'official' | 'older'
   * @param {string} toLib   'official' | 'older'
   * @returns {{matrix:Array<Array<number>>, stats:object}}
   */
  CL.convertMatrix = function (matrix, fromLib, toLib) {
    var F = CL.get(fromLib), T = CL.get(toLib);
    var M = CL.map(F.id, T.id);
    var out = [], changed = 0, colorsSeen = {}, unmapped = 0, total = 0, empty = 0;
    // 从老色库转到官方色库时，必须补 -1 让官方端认得出空位；反向则用 0。
    var emptyOut = (T === CL.OFFICIAL) ? CL.OFFICIAL_EMPTY : CL.OLDER_EMPTY;

    for (var r = 0; r < matrix.length; r++) {
      var row = matrix[r] || [], orow = [];
      for (var c = 0; c < row.length; c++) {
        var v = row[c];
        if (typeof v !== 'number' || !isFinite(v)) v = F.empty;
        total++;
        if (v === F.empty) { orow.push(emptyOut); empty++; continue; }
        var t = M.map[v];
        if (t === undefined) { orow.push(F.empty === 0 ? 0 : emptyOut); unmapped++; continue; }
        colorsSeen[v] = (colorsSeen[v] || 0) + 1;
        if (t !== v) changed++;
        orow.push(t);
      }
      out.push(orow);
    }
    return {
      matrix: out,
      stats: {
        from: F.id, to: T.id, total: total, empty: empty,
        colors: Object.keys(colorsSeen).length,
        changed: changed, unmapped: unmapped,
        map: M,
        // 本次实际用到的颜色 → 目标编号，供预览表只显示「真用到的」
        used: colorsSeen
      }
    };
  };

  /** 便捷入口：官方 → 求解器（34 色，0 空位）。 */
  CL.toSolver = function (matrix) { return CL.convertMatrix(matrix, CL.OFFICIAL_ID, CL.OLDER_ID); };
  /** 便捷入口：求解器（34 色，0 空位）→ 官方（0-21，-1 空位）。 */
  CL.toOfficial = function (matrix) { return CL.convertMatrix(matrix, CL.OLDER_ID, CL.OFFICIAL_ID); };

  /** 按指定色库把矩阵转成求解器内部编号空间（0 = 空位，1-34 = 颜色）。 */
  CL.intoSolver = function (matrix, fromLib) {
    var F = CL.get(fromLib);
    if (F === CL.OLDER) return { matrix: matrix, stats: null, already: true };
    return CL.toSolver(matrix);
  };

  // ==================== 六、TXT 读写（与 generator.blocksFromTXT 同一套口径）====================
  /** 目标图 TXT 文本 → 数字矩阵（原样保留编号，不做转换）。 */
  CL.parseTXT = function (txt) {
    var lines = String(txt == null ? '' : txt).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    var start = 0;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t === '' || !/^-?\d/.test(t)) start = i + 1; else break;
    }
    var blocks = [];
    for (var j = start; j < lines.length; j++) {
      var line = lines[j].trim();
      if (line === '') continue;
      var row = line.split(/\s+/).map(function (s) { var n = parseInt(s, 10); return isNaN(n) ? 0 : n; });
      if (row.length > 0) blocks.push(row);
    }
    return blocks;
  };

  /** 数字矩阵 → 目标图 TXT 文本（首行写标题行，兼容官方文件格式）。 */
  CL.renderTXT = function (matrix, title) {
    var out = [title || '像素矩阵'];
    for (var r = 0; r < (matrix || []).length; r++) out.push((matrix[r] || []).join(' '));
    return out.join('\n') + '\n';
  };

  // ==================== 七、色卡行（给面板画小色块用）====================
  /** 该色库的色卡数组（不含空位），[{id,name,hex}]。 */
  CL.swatches = function (lib) {
    var L = CL.get(lib), out = [];
    for (var id = L.min; id <= L.max; id++) {
      var c = L.colors[id];
      if (c) out.push({ id: id, name: c.name, hex: c.hex });
    }
    return out;
  };

  root.AntSolver = root.AntSolver || {};
  root.AntSolver.ColorLibs = CL;
  if (typeof module !== 'undefined' && module.exports) module.exports = CL;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
