'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 靠色审查模块（从「目标图TXT编辑器_可手动框选版 / js/batch.js」迁移）
 *
 * 作用：作为关卡生成的最终审核项之一，检查一关里是否同时出现「靠近色」(玩家容易混淆的两色)。
 *       命中即整关判不合格，原因固定为「发现靠色，美术返图修改」。
 *
 * 数据源（与原靠色功能一致）：
 *   - 靠色对 _CLOSE_PAIRS：手动维护、按颜色编号判定（基于线轴实际颜色人工确定，共 4 对）。
 *   - 颜色编号↔名称：取自求解器 COLOR_MAP（同一套色值；本模块只内置参与靠色判定的 8 个颜色名）。
 *
 * 说明：靠色判定不依赖 RGB 距离，完全以下面手写的 4 对为准。
 *       新增/删除靠色对 → 改 CLOSE_PAIRS，键名格式 '小编号,大编号'。
 */

// ==================== 靠色对（手动维护，共 6 对；键名 '小编号,大编号'） ====================
// 【2026-09-02 统一】本清单与 `关卡图修改工具/js/core.js` 的 CLOSE_COLOR_PAIRS 原本**各有 5 对且不一致**：
//   本模块缺 `31,32`（浅灰↔灰色），修图工具缺 `15,16`（本轮新增）→ 一张图在修图工具里过关、
//   到产线审查却判不合格，或反之。用户 2026-09-02 裁定统一为**并集 6 对**，两处必须同时维护。
const CLOSE_PAIRS = {
  '2,3': true,    // 浅红(2)   ↔ 粉红(3)   —— 粉色/粉红
  '15,16': true,  // 深棕(15)  ↔ 深蓝(16)  —— 用户 2026-09-02 补录
  '17,18': true,  // 灰蓝(17)  ↔ 蓝色(18)  —— 深蓝/紫
  '20,22': true,  // 绿色(20)  ↔ 青蓝(22)  —— 绿色/浅绿
  '28,29': true,  // 橙色(28)  ↔ 深棕2(29) —— 橙色/橙黄
  '31,32': true,  // 浅灰(31)  ↔ 灰色(32)  —— 2026-09-02 从修图工具清单并入
};

// 仅收录参与靠色判定的颜色名。
// 【2026-09-02 校准】编号↔名称改以**主 bin 权威色表** `bin/js/utils.js` 的 `AntSolver.COLORS` 为准。
//   原先 2/17/20/22/28/29 六项名称与主色表不一致（写作玫粉/蓝紫/亮绿/金橙），
//   会让不合格报告里的色名与工具界面、美术沟通口径对不上。名称仅用于报告展示，不参与判定。
const COLOR_NAME = {
  2: '浅红', 3: '粉红',
  15: '深棕', 16: '深蓝',
  17: '灰蓝', 18: '蓝色',
  20: '绿色', 22: '青蓝',
  28: '橙色', 29: '深棕2',
  31: '浅灰', 32: '灰色',
};

function colorName(id) {
  return COLOR_NAME[id] || ('色' + id);
}

/**
 * 从一关数据中提取「颜色编号 → 出现次数」。
 * 覆盖：目标图 blocks（纯数字或 {id}）、棋盘 spools（cell.id）、管道 cell.param（{id} 或纯数字）。
 * 只统计正整数颜色编号（忽略 0 空位 / -1 黑块）。
 *
 * @param {object} levelData 关卡 JSON（含 blocks / spools）
 * @returns {Object<number, number>} { 颜色编号: 出现次数 }
 */
function collectColorCounts(levelData) {
  const counts = {};
  const add = (v) => {
    let id = null;
    if (typeof v === 'number') id = v;
    else if (v && typeof v === 'object' && typeof v.id === 'number') id = v.id;
    if (id !== null && id > 0) counts[id] = (counts[id] || 0) + 1;
  };

  if (!levelData) return counts;

  // 目标图（美术图）
  if (Array.isArray(levelData.blocks)) {
    for (const row of levelData.blocks) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) add(cell);
    }
  }

  // 棋盘 + 管道内元素
  if (Array.isArray(levelData.spools)) {
    for (const row of levelData.spools) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (!cell) continue;
        if (typeof cell === 'number') { add(cell); continue; }
        add(cell.id);
        if (Array.isArray(cell.param)) {
          for (const item of cell.param) add(item);
        }
      }
    }
  }

  return counts;
}

/**
 * 判断两个颜色是否互为靠色。
 */
function areCloseColors(id1, id2) {
  if (id1 === id2) return false;
  const key = Math.min(id1, id2) + ',' + Math.max(id1, id2);
  return CLOSE_PAIRS[key] === true;
}

/**
 * 审查一关是否存在靠色（任一靠色对的两个颜色都达到最小出现阈值即判命中）。
 *
 * @param {object} levelData 关卡 JSON
 * @param {number} [minPixels=1] 每种颜色至少出现多少次才算「实际使用」（默认出现即算）
 * @returns {{ hasCloseColor: boolean, pairs: Array, detail: string }}
 *          pairs: [{ id1, id2, name1, name2, count1, count2 }]
 *          detail: 形如 "玫粉(2)↔粉红(3)、绿色(20)↔亮绿(22)"
 */
function auditLevel(levelData, minPixels) {
  const min = (typeof minPixels === 'number' && minPixels > 0) ? minPixels : 1;
  const counts = collectColorCounts(levelData);
  const pairs = [];

  for (const key of Object.keys(CLOSE_PAIRS)) {
    if (CLOSE_PAIRS[key] !== true) continue;
    const parts = key.split(',');
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    const ca = counts[a] || 0;
    const cb = counts[b] || 0;
    if (ca >= min && cb >= min) {
      pairs.push({ id1: a, id2: b, name1: colorName(a), name2: colorName(b), count1: ca, count2: cb });
    }
  }

  const hasCloseColor = pairs.length > 0;
  const detail = pairs
    .map((p) => `${p.name1}(${p.id1})↔${p.name2}(${p.id2})`)
    .join('、');

  return { hasCloseColor, pairs, detail };
}

// ==================== 不合格产出（供产线最终审核统一调用） ====================

/** 生产报告备注/不合格原因文案（含命中的靠色对明细）。 */
function rejectReason(cc) {
  return `发现靠色，美术返图修改（靠色对：${cc && cc.detail ? cc.detail : ''}）`;
}

/** 关卡 JSON 内嵌的不合格标注（与其它不合格关卡的 _analysis 同形）。 */
function buildRejectAnalysis(cc) {
  return {
    rejected: true,
    reason: '发现靠色，美术返图修改',
    closeColor: true,
    closeColorPairs: (cc && cc.pairs) || [],
    scoredAt: new Date().toISOString(),
  };
}

/**
 * 把「发现靠色」的关卡按统一规则写入不合格目录：
 *   1) 关卡 JSON（内嵌 _analysis 标注）→ <failDir>/<outputName>
 *   2) 对齐的原图 txt（改名与 json 同前缀）→ <failDir>/原图txt/<outputName 去json加txt>
 * 返回可直接写进「生产汇总报告」备注列的文案（含已落盘说明）。
 *
 * @param {string} failDir   不合格关卡目录（如 <workDir>/不合格关卡）
 * @param {string} outputName 关卡输出文件名（如 001_xxx.json）
 * @param {string} txtPath    对应输入原图 txt 的完整路径
 * @param {object} cc         auditLevel 的返回结果（需含 levelData / pairs / detail）
 * @returns {string} 报告备注文案
 */
function writeReject(failDir, outputName, txtPath, cc) {
  fs.mkdirSync(failDir, { recursive: true });

  // 1) 关卡 JSON + 内嵌标注
  const lv = (cc && cc.levelData) || {};
  lv._analysis = buildRejectAnalysis(cc);
  fs.writeFileSync(path.join(failDir, outputName), JSON.stringify(lv, null, 2) + '\n', 'utf8');

  // 2) 对齐的原图 txt → 不合格关卡/原图txt/，改名与 json 同前缀（美术按名返图）
  if (txtPath && fs.existsSync(txtPath)) {
    const txtDir = path.join(failDir, '原图txt');
    fs.mkdirSync(txtDir, { recursive: true });
    const txtName = outputName.replace(/\.json$/i, '.txt');
    fs.copyFileSync(txtPath, path.join(txtDir, txtName));
  }

  return rejectReason(cc) + '（已输出不合格关卡+原图txt到 不合格关卡/）';
}

module.exports = {
  CLOSE_PAIRS,
  COLOR_NAME,
  colorName,
  areCloseColors,
  collectColorCounts,
  auditLevel,
  rejectReason,
  buildRejectAnalysis,
  writeReject,
};
