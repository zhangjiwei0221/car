/**
 * ==================== 碎色率检查（修图工具侧包装层） ====================
 *
 * 任务：ANT-ARTTOOL-FRAGMENT-QUOTA-20260825（接入）+ ANT-ARTTOOL-BIN-SYNC-V105-20260825（改为转调）。
 * 用户 2026-08-25：「将碎色率检查接入到修图工具，用来提醒美术应该修改到什么程度」
 *                 「给到 18% 作为碎色率上限，同时将碎色率作为可调参数，方便美术随时可调整」。
 *
 * 【本文件不含碎色算法】
 *   碎色率一律由 `AntSolver.Generator.computeFragmentation` 计算 —— 那就是生产端
 *   生产前置碎色闸门用的同一个函数（`bin/js/generator.js`，工具目录下是它的同步副本）。
 *   本文件只做工具专属的包装：
 *     · perColor —— 分色碎色明细（按碎色率降序，告诉美术先修哪个颜色）
 *     · fragCells —— 碎色像素坐标清单（供画布高亮）
 *     · GRADES/gradeOf —— 五级分级刻度（08-24 上线 345 关实测）
 *     · assess —— 达标提示（还差几个百分点、至少要救回多少像素）
 *     · 阈值记忆 —— 美术自选的阈值存 localStorage，下次打开仍是上次的值
 *
 * 【为什么从「算法副本」改成「转调」】
 *   接入时（08-25 上午）工具的 `bin/js` 快照停在 v100，里面还没有 `computeFragmentation`
 *   （它是 v102 才加的），所以当时只能把那个函数逐行复制进来，并靠 `来源说明.md` 记录同步义务。
 *   本轮把工具 `bin/js` 对齐到 v105 后，副本里已自带该函数，再留一份复制品就是**主动制造
 *   第二份算法**、且要靠人记得同步。改为转调后，一致性从「靠人同步」变成「天然一致」——
 *   不可能再出现「工具说达标、生产端照样卡掉」。
 *
 * 【依赖】
 *   `AntSolver.Generator.computeFragmentation`（必须在本文件之前载入 bin/js/generator.js）。
 *   取不到时 `computeFragmentation` 返回 null，调用方（js/app.js）会显示「碎色模块未就绪」而不是静默出 0。
 */
window.AntFragment = (function () {
  'use strict';

  // ==================== 口径参数默认值 ====================
  // 与 bin/js/generator.js 的 DEFAULT_CONFIG 同值。这里只作**展示**用（面板要写出"什么算碎色"），
  // 实际计算一律走 Generator.computeFragmentation 的内部默认值，不由本文件决定。
  // ⚠ 这四个值定义了「什么算碎色」。08-24 标定出的阈值只在这套口径下成立，改了必须重新标定。
  var DEFAULTS = {
    fragmentIsoMax: 1,        // 孤立块：像素数 ≤ 此值
    fragmentSmallMax: 7,      // 小色块：isoMax < 像素数 ≤ 此值（"小于8" —— 用户 2026-08-25 放宽）
    fragmentBarrierPx: 3,     // 隔断厚度门限（夹在两同色块之间的异色像素数）
    fragmentBarrierKinds: 1   // 隔断种类门限（夹着几种异色）
  };

  function gen() {
    return (window.AntSolver && window.AntSolver.Generator) || null;
  }

  /** 碎色模块是否可用（bin/js/generator.js 已载入且版本含 computeFragmentation）。 */
  function ready() {
    var G = gen();
    return !!(G && typeof G.computeFragmentation === 'function');
  }

  /**
   * 计算碎色率 + 取正式块级明细。**全部指标与明细都来自 `Generator.computeFragmentation`。**
   *
   * 【2026-08-25 修复】任务 ANT-GEN-FRAGMENT-DETAIL-20260825。
   *   此前本包装层自己按"块自身大小"近似出一份定位清单（`locateSmallBlocks`），
   *   因为拿不到正式口径的「并簇 + 长期隔断过滤 + 整簇救回」结果，
   *   把**视觉上连续的条带**也标成了碎色 —— 用户实机反馈：
   *   「高亮的孤立色统计了一些视觉上并不孤立的像素，例如连续的边缘带、间隔一个条带的同色条带」。
   *   6 张真实图实测误标 608 块，其中与最近同色块只隔 1 像素的占 559 块、条带形状占 427 块。
   *   现改为向正式函数索取明细（`cfg.fragmentDetail = true`），近似逻辑已删除，
   *   高亮与分色明细从此与碎色率**同口径**。
   *
   * @param {Array<Array<number>>} blocks 目标图
   * @param {object} [cfg] 覆盖口径参数（原样转给正式函数）
   * @returns {object|null} 正式返回值（含 fragCells / fragBlockList / perColorDetail）
   *                        + `perColor` 别名；碎色模块未就绪时返回 null
   */
  function computeFragmentation(blocks, cfg) {
    var G = gen();
    if (!G || typeof G.computeFragmentation !== 'function') return null;
    var opt = {};
    if (cfg) Object.keys(cfg).forEach(function (k) { opt[k] = cfg[k]; });
    opt.fragmentDetail = true;                  // 索取块级明细（正式口径，已并簇救回）
    var frag = G.computeFragmentation(blocks, opt);
    // 旧版正式函数（v105 之前的副本）不支持明细 → 如实降级，不静默出错
    if (!frag.fragCells) {
      frag.fragCells = [];
      frag.perColorDetail = [];
      frag.detailUnavailable = true;
    }
    frag.perColor = frag.perColorDetail || [];  // 面板沿用 perColor 这个名字
    return frag;
  }

  // ==================== 达标阈值 ====================
  // 【当前默认 18%】用户 2026-08-25 裁决：「给到 18% 作为碎色率上限」。
  //   生产端 `bin/index.html` 的 `#gen-frag-max` 默认值同步为 18 —— 两边必须一致，
  //   否则「工具说达标、生产端照样卡掉」，这个提示就变成误导。
  //
  // ⚠⚠ 【2026-08-25 口径变更后阈值语义已改变，必读】
  //   小色块放宽到「小于 8」后，同一张图的碎色率普遍下降约 4.3 个百分点，
  //   所以 18% 在新口径下比在旧口径下宽松得多。344 关实测对照：
  //
  //     阈值    新口径过闸    旧口径过闸    新口径下过闸集的好关率 / 差关率 / 严重差关率
  //     15.16%    55.5%        25.3%        30.4% / 23.6% /  6.3%
  //     18.00%    79.1%        43.0%        28.7% / 27.9% /  8.1%   ← 当前采用
  //     20.47%    91.3%        60.8%        27.7% / 29.6% /  8.0%
  //
  //   全样本基础率是 好关 27.0% / 差关 31.7%。18% 过闸集的好关率 28.7% 已经非常接近基础率，
  //   意味着**在新口径下 18% 的筛选力很弱**（放过近八成图）。
  //   若要保持「好关率最高档上界」这个原始设计强度，新口径下的对应值是
  //     四等分 Q1 上界 = 0.1147（11.47%，好关率 32.6%、严重差关率 3.5%）
  //     五等分 L1 上界 = 0.1054（10.54%，好关率 33.8%、严重差关率 1.5%）
  //   这属于阈值裁决，未擅自改动 —— 18% 是用户明确定的值，保持不变。
  //   重标定脚本：`_kiro临时/08.25-碎色口径重标定/_重标定small7.js`
  var GATE_DEFAULT = 0.18;     // ← 用户裁决的上限，与生产端 UI 默认值一致
  var GATE_Q1 = 0.1147;        // 新口径四等分「好关率最高档」上界（等效于旧口径 0.1516 的设计强度）
  var GATE_STRICT = 0.1054;    // 新口径五等分最整档上界（严重差关率仅 1.5%）
  var GATE_LOOSE = 0.1879;     // 旧 Q2 上界，保留为备选
  var GATE_BREAK = 0.2047;     // 旧五级刻度的差关率断点，保留为备选

  // 美术自选阈值的记忆（用户：「方便美术随时可调整」）。
  //   只存一个数字，几十字节，不占待导出库配额；刷新/重开工具都保持上次选的值。
  var GATE_STORAGE_KEY = 'antArtTool_fragGate_v1';
  function loadSavedGate() {
    try {
      var v = parseFloat(localStorage.getItem(GATE_STORAGE_KEY));
      if (!isNaN(v) && v > 0 && v < 1) return v;
    } catch (e) { /* 隐私模式等禁用 localStorage：退回默认值，不报错 */ }
    return null;
  }
  function saveGate(rate) {
    try { localStorage.setItem(GATE_STORAGE_KEY, String(rate)); return true; }
    catch (e) { return false; }
  }

  // ==================== 碎色程度分级刻度 ====================
  // 【2026-08-25 按新口径重标定】用户把小色块放宽到「小于 8」（smallMax 10 → 7）后，
  //   碎色率整体下降（344 关实测平均降 4.32 个百分点、中位 0.1892 → 0.1453），
  //   旧刻度（按 smallMax=10 的百分位切的）已经不适用，故整表重算。
  //
  // 数据：上线 345 关（排除第 1 关，实得 344 关），按新口径碎色率的 20/40/60/80 百分位切五级。
  //   脚本 `_kiro临时/08.25-碎色口径重标定/_重标定small7.js`；
  //   好关/差关标签取自用户提供的线上分析 `蚂蚁搬家分组3_好坏关分阶段判定.csv`，不是本工具判的。
  //   全样本基础率：差关 31.7%、好关 27.0%。
  //
  // ⚠ 这是【现象观察】的分级刻度，不是因果结论，也不是"该不该判不合格"的判据。
  //   用户 2026-08-24 明确：「我们只观察现象，不要陷入因果证明的陷阱」。
  var GRADES = [
    { name: '很整', max: 0.1054, bad: 23.5, severe: 1.5, good: 33.8, cls: 'fragOK' },
    { name: '偏整', max: 0.1342, bad: 23.5, severe: 8.8, good: 32.4, cls: 'fragOK' },
    { name: '中等', max: 0.1557, bad: 25.0, severe: 11.8, good: 27.9, cls: 'fragMid' },
    { name: '偏碎', max: 0.1797, bad: 39.7, severe: 10.3, good: 20.6, cls: 'fragBad' },
    { name: '很碎', max: Infinity, bad: 45.8, severe: 13.9, good: 20.8, cls: 'fragBad' }
  ];

  function gradeOf(rate) {
    for (var i = 0; i < GRADES.length; i++) if (rate <= GRADES[i].max) return GRADES[i];
    return GRADES[GRADES.length - 1];
  }

  /**
   * 给美术的整体评估：当前碎色率、所处等级、与阈值的距离、还需要"救回"多少像素。
   * 「还需救回」= 要把碎色率降到目标阈值以下，至少得让多少个碎色像素并入正常块。
   *   推导：设总像素 T、当前碎色 F、目标阈值 t，需要 F' ≤ t×T，故至少减少 F − ⌊t×T⌋ 个。
   *   这是**下界**而非精确施工量：实际把一个孤立像素并进邻近同色块，往往会连带救回同簇的其他块，
   *   所以真实需要改动的像素数通常小于这个数。
   */
  function assess(frag, gate) {
    if (!frag || !frag.totalPixels) return null;
    var limit = (gate != null && gate > 0) ? gate : GATE_DEFAULT;
    var g = gradeOf(frag.rate);
    var allow = Math.floor(limit * frag.totalPixels);
    return {
      rate: frag.rate,
      ratePct: +(frag.rate * 100).toFixed(2),
      grade: g.name,
      gradeCls: g.cls,
      gradeStats: g,
      limit: limit,
      limitPct: +(limit * 100).toFixed(2),
      pass: frag.rate <= limit,
      gapPp: +((frag.rate - limit) * 100).toFixed(2),      // 正数=超出多少个百分点
      allowFragPixels: allow,
      needFixPixels: Math.max(0, frag.fragPixels - allow),  // 至少要救回多少个碎色像素（下界）
      gates: { def: GATE_DEFAULT, q1: GATE_Q1, strict: GATE_STRICT, loose: GATE_LOOSE, breakPoint: GATE_BREAK }
    };
  }

  return {
    ready: ready,
    computeFragmentation: computeFragmentation,
    assess: assess,
    gradeOf: gradeOf,
    GRADES: GRADES,
    DEFAULTS: DEFAULTS,
    GATE_DEFAULT: GATE_DEFAULT,
    GATE_Q1: GATE_Q1,
    GATE_STRICT: GATE_STRICT,
    GATE_LOOSE: GATE_LOOSE,
    GATE_BREAK: GATE_BREAK,
    GATE_STORAGE_KEY: GATE_STORAGE_KEY,
    loadSavedGate: loadSavedGate,
    saveGate: saveGate
  };
})();
