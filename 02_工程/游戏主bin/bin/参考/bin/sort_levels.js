/**
 * 关卡分组排序模块
 *
 * 作用：把"合格关卡"按难度分组排序，从【第1关】开始顺序编号，
 *      输出排序好的关卡（第N关_原名.json）+ 排序清单.csv。
 *
 * 两种用法：
 *   1) 被流程自动调用：run.js / server.js 生产+审核完后自动排序输出（推荐）
 *   2) 单独手动运行：  node sort_levels.js
 *      —— 读取 output_json/批量分析结果.csv，排序后输出到 output_sorted/
 *
 * 排序规则（沿用本版分组算法，唯一改动：从第1关起算，不再手动保留1-5关）：
 *   · 全局按难度升序
 *   · 分两池：普通池(难度<55)、Boss池(难度≥55)
 *   · 每5关一组：前4关取自普通池，组末1关取自Boss池（作为本组Boss）
 *   · Boss池用完后，后续组全部由普通池填满
 *   · 组内按难度升序（组末即本组最难）
 *   · 末组不满5关时并入上一组
 *   · 关卡号从 1 连续编号，组号从 1 连续编号
 */
const fs = require('fs');
const path = require('path');

const BOSS_THRESHOLD = 55; // 难度≥此值进Boss池
const GROUP_SIZE = 5;      // 每组关卡数

// ---- 工具 ----
function fmt2(v) {
  return typeof v === 'number' && !isNaN(v) ? v.toFixed(2) : '-';
}

// 解析一行 CSV（支持双引号包裹的含逗号字段）
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * 核心：把分析项排序分组，返回带 level / group / isBoss 的有序数组。
 *
 * 采用「位置掩码 + 双流灌入」构造（见 design §3.2）：
 *   1) 全体稳定升序，按难度阈值拆「普通流」/「boss 流」（各自升序）；
 *   2) 按打点规则算出 boss 位掩码（哪些关号优先放 boss）；
 *   3) 两条已升序的流按关号从左到右灌入 —— 升序是构造性保证。
 *
 * @param {Array}  items 形如 {name, difficulty, tier, quality, peakBand,
 *                            zoneAvgBuf, zoneAvgRes, earlyAvgBuf, earlyAvgRes, _json?}
 *                        name 可带或不带 .json 后缀
 * @param {object} [opts] { groupSize, bossThreshold, startLevel, bossAnchor, bossInterval }
 *   - bossAnchor / bossInterval 任一非 null 即视为「自定义打点」（绝对关号语义）；
 *     两者都缺省时走默认策略（每组组末投放一个 boss），与旧逻辑关序逐关一致。
 * @returns {Array} 有序数组，每项追加 {level, group, isBoss}
 */
function buildOrder(items, opts) {
  opts = opts || {};

  // ---- 步骤 1：取默认值 ----
  const GS = opts.groupSize > 0 ? opts.groupSize : GROUP_SIZE;
  const T = (opts.bossThreshold != null) ? opts.bossThreshold : BOSS_THRESHOLD;
  const startLevel = opts.startLevel > 0 ? opts.startLevel : 1;
  const N = items.length;
  if (N === 0) return []; // 空输入直接返回（R10.2）

  // ---- 步骤 2：全体稳定升序 + 按阈值拆两条流 ----
  const asc = items.slice().sort((a, b) => a.difficulty - b.difficulty); // 稳定升序
  const normalSorted = asc.filter(x => x.difficulty < T);  // 普通流（升序）
  const bossSorted = asc.filter(x => x.difficulty >= T);   // boss 流（升序）
  const m = bossSorted.length;                             // boss 关总数

  // ---- 步骤 3：计算 boss 位（boss slot）的 idx 集合 ----
  const custom = (opts.bossAnchor != null) || (opts.bossInterval != null);
  let anchor, interval;
  if (custom) {
    anchor = Math.max(opts.bossAnchor, startLevel);            // 约束 ≥ startLevel（R5.5）
    interval = opts.bossInterval > 0 ? opts.bossInterval : GS; // 非法回退默认（R5.2 容错）
  } else {
    anchor = startLevel + GS - 1;   // 第一组组末关号（R4.1 默认）
    interval = GS;
  }
  const lastLevel = startLevel + N - 1;
  const slotIdxSet = new Set();
  // 由 anchor, anchor+interval, … 生成 slotLevels（≤ 末关号），映射 idx 并过滤越界（R5.6）
  for (let L = anchor; L <= lastLevel; L += interval) {
    const idx = L - startLevel;
    if (idx >= 0 && idx < N) slotIdxSet.add(idx);
  }
  const bossSlots = Array.from(slotIdxSet).sort((a, b) => a - b); // 升序去重
  const k = bossSlots.length;

  // ---- 步骤 4：选「boss 内容位」集合 bossContent，|bossContent| 必须 == m ----
  const bossContent = new Set();
  if (m <= k) {
    // boss 不足或正好：取关号最小的 m 个 boss 位（其余 boss 位用普通关填，R9.1）
    for (let i = 0; i < m; i++) bossContent.add(bossSlots[i]);
  } else {
    // boss 溢出：先纳入全部 k 个 boss 位，再从序列尾部往前补足到 m 个（R9.2）
    for (let i = 0; i < k; i++) bossContent.add(bossSlots[i]);
    let idx = N - 1;
    while (bossContent.size < m) {
      if (!bossContent.has(idx)) bossContent.add(idx);
      idx--;
    }
  }

  // ---- 步骤 5：双流从左到右灌入 ----
  const ordered = [];
  let bp = 0, np = 0;
  for (let idx = 0; idx < N; idx++) {
    const item = bossContent.has(idx) ? bossSorted[bp++] : normalSorted[np++];
    const level = startLevel + idx;
    const isBoss = item.difficulty >= T; // 按阈值判定（R11.6、决策⑥）
    ordered.push(Object.assign({}, item, { level, isBoss }));
  }

  // ---- 步骤 6：固定分组标号 + 末组并入（决策⑤、R7.1、R8）----
  for (let idx = 0; idx < ordered.length; idx++) {
    ordered[idx].group = Math.floor(idx / GS) + 1;
  }
  const totalGroups = Math.ceil(N / GS);
  if (N % GS !== 0 && totalGroups >= 2) {
    // 把最后那个不满 GS 的组并入上一组（仅改 group 标号，不改关序）
    for (const o of ordered) {
      if (o.group === totalGroups) o.group = totalGroups - 1;
    }
  }

  // ---- 步骤 7：返回 ----
  return ordered; // 每项含 { ...原元数据, level, group, isBoss }
}

/**
 * 把排序结果写出：复制并重命名 JSON + 生成排序清单.csv
 * @param {Array}  ordered       buildOrder 的返回值
 * @param {string} sourceJsonDir 合格关卡所在目录（output_json）
 * @param {string} sortedDir     排序输出目录（output_sorted）
 * @returns {number} 写出的关卡数
 */
function writeSorted(ordered, sourceJsonDir, sortedDir) {
  // 全量重建排序目录，避免残留旧关卡
  fs.rmSync(sortedDir, { recursive: true, force: true });
  fs.mkdirSync(sortedDir, { recursive: true });

  const lines = [
    '关卡号,文件名,原名,难度,难度档,曲线质量,所属组,目标区均暂存,目标区均滞留,前期均暂存,前期均滞留,卡点区间,是否Boss'
  ];

  let written = 0;
  for (const o of ordered) {
    const origName = String(o.name).replace(/\.json$/i, '');
    const newFile = `第${o.level}关_${origName}.json`;
    const src = path.join(sourceJsonDir, origName + '.json');
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(sortedDir, newFile));
      written++;
    }
    lines.push([
      o.level, newFile, origName, o.difficulty, o.tier || '-', o.quality || '-',
      '组' + o.group, fmt2(o.zoneAvgBuf), fmt2(o.zoneAvgRes),
      fmt2(o.earlyAvgBuf), fmt2(o.earlyAvgRes), o.peakBand || '-',
      o.isBoss ? '是' : '否'
    ].join(','));
  }

  fs.writeFileSync(path.join(sortedDir, '排序清单.csv'), lines.join('\n') + '\n', 'utf8');
  return written;
}

/**
 * 流程内调用入口：传入分析数据，直接完成排序+写出。
 * @param {Array}  analysisItems 分析项数组（见 buildOrder 的 items）
 * @param {string} sourceJsonDir 合格关卡所在目录（output_json）
 * @param {string} sortedDir     排序输出目录（output_sorted）
 * @param {object} [opts]        透传给 buildOrder 的可选参数（不传走默认策略，行为与现状一致）
 */
function sortAndWrite(analysisItems, sourceJsonDir, sortedDir, opts) {
  if (!analysisItems || analysisItems.length === 0) return 0;
  const ordered = buildOrder(analysisItems, opts);
  return writeSorted(ordered, sourceJsonDir, sortedDir);
}

/**
 * 单独运行入口：从 output_json/批量分析结果.csv 读数据并排序。
 */
function runStandalone() {
  const ROOT = __dirname;
  const sourceJsonDir = path.join(ROOT, 'output_json');
  const sortedDir = path.join(ROOT, 'output_sorted');
  const csvPath = path.join(sourceJsonDir, '批量分析结果.csv');

  if (!fs.existsSync(csvPath)) {
    console.log('未找到 output_json/批量分析结果.csv，请先生产关卡（node run.js）。');
    return;
  }

  const raw = fs.readFileSync(csvPath, 'utf8').trim();
  const rows = raw.split('\n');
  const items = [];
  // 列：0排名 1关卡名 2难度强度 3难度档 4曲线质量 5卡点区间 6卡点达标
  //     7目标区平均暂存 8目标区平均滞留 9前期平均暂存 10前期平均滞留 ...
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i].trim()) continue;
    const c = parseCsvLine(rows[i]);
    if (c.length < 11) continue;
    items.push({
      name: c[1],
      difficulty: parseFloat(c[2]),
      tier: c[3],
      quality: c[4],
      peakBand: c[5],
      zoneAvgBuf: parseFloat(c[7]),
      zoneAvgRes: parseFloat(c[8]),
      earlyAvgBuf: parseFloat(c[9]),
      earlyAvgRes: parseFloat(c[10]),
    });
  }

  const written = sortAndWrite(items, sourceJsonDir, sortedDir);
  console.log(`排序完成：共 ${items.length} 关，已输出 ${written} 个关卡到 output_sorted/`);
  console.log('排序清单：output_sorted/排序清单.csv');
}

/**
 * 独立分组排序入口（计划A）：直接吃"内存里的整关 JSON（含 _analysis）"，
 * 按可调参数分组排序、重命名写出 + 排序清单.csv。难度只读内嵌 _analysis，不重跑求解器。
 * @param {Array} levels [{ name, json }]，json 需含 json._analysis.difficulty
 * @param {string} outDir 输出目录（会清空重建）
 * @param {object} opts { groupSize, bossThreshold, startLevel, nameTemplate, keepAnalysis }
 *   nameTemplate 占位符：{level} 关卡号、{name} 原名（默认 "第{level}关_{name}"）
 * @returns {{written:number, total:number, missingAnalysis:string[]}}
 */
function sortAndWriteFromLevels(levels, outDir, opts) {
  opts = opts || {};
  const tmpl = opts.nameTemplate || '第{level}关_{name}';
  const keepAnalysis = opts.keepAnalysis !== false; // 默认保留内嵌分析
  const missingAnalysis = [];
  if (!levels || levels.length === 0) return { written: 0, total: 0, missingAnalysis };

  const items = levels.map(L => {
    const a = (L.json && L.json._analysis) || null;
    if (!a || typeof a.difficulty !== 'number') missingAnalysis.push(String(L.name));
    return {
      name: String(L.name).replace(/\.json$/i, ''),
      _json: L.json,
      difficulty: a && typeof a.difficulty === 'number' ? a.difficulty : 0,
      tier: a ? a.tier : '-',
      quality: a ? a.quality : '-',
      peakBand: a ? a.peakBand : '-',
      zoneAvgBuf: a ? a.zoneAvgBuf : undefined,
      zoneAvgRes: a ? a.zoneAvgRes : undefined,
      earlyAvgBuf: a ? a.earlyAvgBuf : undefined,
      earlyAvgRes: a ? a.earlyAvgRes : undefined,
    };
  });

  const ordered = buildOrder(items, opts);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const lines = [
    '关卡号,文件名,原名,难度,难度档,曲线质量,所属组,目标区均暂存,目标区均滞留,前期均暂存,前期均滞留,卡点区间,是否Boss'
  ];
  let written = 0;
  for (const o of ordered) {
    const newFile = tmpl.replace('{level}', o.level).replace('{name}', o.name) + '.json';
    const body = Object.assign({}, o._json);
    if (!keepAnalysis) delete body._analysis;
    fs.writeFileSync(path.join(outDir, newFile), JSON.stringify(body, null, 2) + '\n', 'utf8');
    written++;
    lines.push([
      o.level, newFile, o.name, o.difficulty, o.tier || '-', o.quality || '-',
      '组' + o.group, fmt2(o.zoneAvgBuf), fmt2(o.zoneAvgRes),
      fmt2(o.earlyAvgBuf), fmt2(o.earlyAvgRes), o.peakBand || '-',
      o.isBoss ? '是' : '否'
    ].join(','));
  }
  fs.writeFileSync(path.join(outDir, '排序清单.csv'), lines.join('\n') + '\n', 'utf8');
  return { written, total: ordered.length, missingAnalysis };
}

module.exports = { buildOrder, writeSorted, sortAndWrite, sortAndWriteFromLevels, BOSS_THRESHOLD, GROUP_SIZE };

if (require.main === module) runStandalone();
