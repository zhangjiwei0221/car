/**
 * 蚂蚁拿块 · 本地生产服务（零依赖 Node）
 *
 * 两个职责：
 *   1) 静态托管项目根目录（供浏览器以 http:// 打开 bin/index.html，从而启用 Web Worker）；
 *   2) 提供 /api/production/* 落库接口：网页每生产完一关就 POST 过来，服务写盘成功后才回 persisted=true，
 *      网页收到确认才派发下一关 —— 杜绝"整批跑完再集中打包下载"带来的内存峰值与崩溃丢失。
 *
 * 安全边界（硬约束）：
 *   - 只监听 127.0.0.1，不对外网开放；
 *   - 写入只允许落在 <项目根>/输出文件/ 之内，且路径经二次清洗 + realpath 前缀校验；
 *   - 拒绝绝对路径、`..` 跳转、路径分隔符与系统非法字符；
 *   - 只接受本次服务启动时下发的批次令牌（batchToken）；
 *   - 限制单次请求体大小；不执行任何客户端传入的命令。
 *
 * 落库目录（每批次）：
 *   输出文件/<批次名>-MM-DD[-2,-3…]/
 *     ├── txt图/              合格关卡的源图
 *     ├── 合格关卡/            程序端干净关卡 JSON
 *     ├── 不合格关卡/          带失败分类后缀的关卡 JSON
 *     ├── 不合格txt图/         不合格 + 无关卡结构异常的源图
 *     └── 生产文档/
 *           ├── 批次配置.json / 生产状态.json / 逐关记录.jsonl / 分析报告.csv / 生产报告.md
 *           └── 关卡数据/<名>.json   完整内部 board/solve/audit/generationEval/fallback（调试用）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');            // 项目根（本文件位于 网页启动器/ 下）
const OUT_ROOT = path.join(ROOT, '输出文件');           // 唯一允许写入的根
const MAX_BODY = 64 * 1024 * 1024;                     // 单请求体上限 64MB（单关完整数据足够）
const SERVER_TOKEN = crypto.randomBytes(16).toString('hex');   // 本次启动的令牌
const batches = new Map();                             // batchId → 批次运行态

// ───────────────────────── 工具：命名清洗 / 安全路径 ─────────────────────────

/** 文件/目录名清洗：去掉路径分隔符与系统非法字符、控制字符、首尾空白点，限长。 */
function safeName(raw, fallback) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/[\\/:*?"<>|]/g, '_');                 // 路径分隔符 + Windows 非法字符
  s = s.replace(/[\u0000-\u001f\u007f]/g, '');         // 控制字符
  s = s.replace(/\.{2,}/g, '_');                       // 连续点（.. 等）压成下划线：路径分隔符已被替换，此处只为文件名整洁无歧义
  s = s.replace(/^[\s.]+|[\s.]+$/g, '');               // 首尾空白与点（防 . / ..）
  if (!s) s = fallback || 'unnamed';
  if (s.length > 120) s = s.slice(0, 120);
  return s;
}

/** 断言目标路径确实位于 OUT_ROOT 之内（防 .. 跳转与符号链接逃逸）。 */
function assertInsideOutRoot(p) {
  const resolved = path.resolve(p);
  const base = fs.realpathSync(OUT_ROOT);
  // 逐级向上找到已存在的祖先做 realpath，避免未创建目录时 realpath 抛错
  let probe = resolved;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realProbe = fs.existsSync(probe) ? fs.realpathSync(probe) : probe;
  if (realProbe !== base && !realProbe.startsWith(base + path.sep)) {
    throw new Error('拒绝写入：目标路径不在 输出文件/ 之内 → ' + resolved);
  }
  return resolved;
}

function two(n) { return (n < 10 ? '0' : '') + n; }
function monthDay(d) { d = d || new Date(); return two(d.getMonth() + 1) + '-' + two(d.getDate()); }

/** 原子写入：临时文件 → fsync → rename 覆盖，避免半截文件。 */
function atomicWrite(file, text) {
  assertInsideOutRoot(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/** 追加写入（JSONL / CSV）：写完再返回，保证服务回成功时数据已落盘。 */
function appendLine(file, line) {
  assertInsideOutRoot(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeFileSync(fd, line.endsWith('\n') ? line : line + '\n');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

// ───────────────────────── 批次目录 ─────────────────────────

const SUBDIRS = ['txt图', '合格关卡', '不合格关卡', '不合格txt图', '生产文档', path.join('生产文档', '关卡数据')];

/** 创建唯一批次目录：<批次名>-MM-DD，重名追加 -2/-3…（目录名由服务决定并回传）。 */
function createBatchDir(rawName) {
  const base = safeName(rawName, '') || ('蚂蚁关卡生产');
  const stem = base + '-' + monthDay();
  let dirName = stem, n = 1;
  while (fs.existsSync(path.join(OUT_ROOT, dirName))) { n++; dirName = stem + '-' + n; }
  const abs = assertInsideOutRoot(path.join(OUT_ROOT, dirName));
  SUBDIRS.forEach(d => fs.mkdirSync(path.join(abs, d), { recursive: true }));
  return { dirName, abs };
}

function docPath(b, name) { return path.join(b.abs, '生产文档', name); }

// ───────────────────────── CSV ─────────────────────────

// v110（用户 2026-08-26 批准 q1）：新增「入口模式」列。
// 此前 app.js 的 genPersistPayload 已把 entryMode 发过来，但服务端 JSONL 与 CSV 都没接，
// 于是走本地服务落库的批次【事后无法从产物判断玩法】——例如 输出文件/底部消除 两批的
// 逐关记录首行 28 个字段、零个入口模式字段。而浏览器侧 ZIP 导出的 CSV 一直有这列，
// 两条导出路径口径不一致。本轮把服务端对齐过来。
const CSV_HEADER = ['批次ID', '输入序号', '关卡', '落库状态', '入口模式', '结果分类', '合格档', '是否兜底', '兜底类型',
  '尺寸', '棋盘', '盒数', '可解', '难度分', '难度等级', '障碍', '峰值暂存', '均暂存', '50%后均暂', '50%后峰窗',
  '玩家通关', '卡点@', '前期峰窗', '中期峰窗', '后期峰窗',
  '单关耗时ms', '建盘次数', '基础候选', '卡点变体', 'solve调用', '贪心遍', '树遍', '玩家模拟', '停止原因',
  '卡点类型', '卡点数', 'BOSS规格',
  '输出相对路径', '不合格原因',
  // v115（任务 ANT-GEN-PARAM-RANGE-CHOKE-PROB-20260827）：参数区间化后同一批次里各关参数不再相同，
  // 不落这几列就无法回答「这关的冰/黑/链/问号/管道/可用空间取了区间里的哪个值」；
  // 卡点类型数改概率机制后同理，只有 chokeCount 无法区分「参数设小」与「抽样波动」。
  // 新列一律追加在表尾：v114 起的批次若中途 resume，旧表头仍能对齐前 39 列。
  '采样冰%', '采样黑%', '采样锁链', '采样问号%', '采样管道数', '采样队列深度', '采样可用空间',
  '卡点检查次数', '卡点概率', '卡点命中', '卡点期望', '卡点池',
  // v116（任务 ANT-GEN-USABLE-REPORT-CHOKE-WINDOW-20260827）：用户反馈「当前报告内没有可用空间的指标」。
  // 设了 usableSpaceTarget 却无法从产物核对是否兑现，只能事后自己解 JSON 重数格子。
  // 这 12 列全部是【从最终 board.cells 现场重数】的实测值，口径与 generator 出口闸门一致：
  //   可用空间 = (总格 − 墙 − 管道格) / 总格。
  // 管道藏盒两列是「进度感偏移」的量化：管道里的球计入全局进度但玩家看不见。
  '总格', '墙数', '墙占比%', '管道格', '盘面盒', '可用空间', '可用空间目标', '可用空间偏差pp',
  '管道想要', '管道档', '管道藏盒', '藏盒占比%',
  // v116：合格门口径随版本变化，必须把版本与卡点区间落库，否则跨批次比较 hasChoke 率会得出错误结论。
  // 注意：上面「前期峰窗/中期峰窗/后期峰窗/卡点@」四列的**区间语义随 gateVersion 变**——
  //   v116 起 中期=20~30%、后期(卡点区)=30~80%（v104~v115 为 20~50% 与 50~100%）。
  //   为不打断按列位取值的旧脚本，这四列位置与名称保留不动，改动靠这里的版本与区间列自证。
  '合格门版本', '卡点区间', '旧峰窗50-100', '旧口径有卡点',
  // v118：阶段重划为 前期[0,30%] / 中后期[30,80%] / 后期[80,100%]，中期段移除。
  // 因此上面「中期峰窗」列自 v118 起**恒为 0**（字段保留仅为兼容旧报告读取），
  // 后期段是新增的、只记录不判定，另加两列；卡点线与前期区间也落库，避免事后靠版本号猜口径。
  '后期峰窗80-100', '后期峰位%', '卡点线', '前期区间',
  // v119：卡点判定区终点 80% → 100%（后期段纳入判定）。此后「后期峰窗」列（= a.lateMax）是
  //   **整个卡点区 30~100% 的判定值**，而 30~80% 与 80~100% 两个子段分别由下面这列与上面的
  //   「后期峰窗80-100」记录 —— 三者一起才能看出卡点出在前半还是尾巴上。
  '中后期峰窗30-80', '中后期峰位%',
  // v120（任务 ANT-GEN-CHOKE-TYPE-PARAMS-20260827）：卡点类型逐类参数化 + 位置记录。
  // CSV 只放**摘要**（类型×数量、首个坐标、进度带），全量坐标在 逐关记录.jsonl 的「卡点位置」里 ——
  // 一格塞不下十几个坐标，硬塞会让表在 Excel 里没法筛。
  '卡点落地摘要', '卡点首位', '卡点进度带',
  // v238：每步"能吃满"的曲线 —— 压力最直接的来源（不是事后指标，是设计时就能算的量）。
  //   实测 31 关：合格关「吃满≤1 的步」占 44~81%、中位 1 辆；太松的不合格关只占 2~21%、中位 3~7。
  '吃满中位', '吃满<=1占比', '被迫点30-80%',
  // v273：用户选 A 后，合格要看"中段压得住"——30~80% 进度里暂存 ≥3 的样本占比
  '30-80暂存≥3%'];

/**
 * 目标图入口模式的中文名（v110）。取值由 bin/js/generator.js 的 produceDispatch 在唯一出口打上，
 * 经 app.js genPersistPayload 送到服务端。三种互斥：四边入口 / 仅底部入口 / 四方向瞬时连锁。
 * 与 bin/js/app.js 的 entryModeCN 保持同一套字样，便于两条导出路径（服务落库 / 浏览器 ZIP）对照。
 * 缺值按 'fourSide' 处理 —— v110 之前的批次没有这个字段，读旧批次时不应显示为空白。
 */
function entryModeCN(m) {
  if (m === 'bottomOnly') return '仅底部入口';
  if (m === 'fourSideInstantChain') return '四方向瞬时连锁';
  return '四边入口';
}

function csvCell(v) {
  const s = (v == null ? '' : String(v));
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * CSV 数值单元格（v115）：缺值写空串而不是 0 —— 0 在这些列里是有意义的取值
 * （如 `采样管道数=0` 表示不铺管道、`卡点检查次数=0` 表示不启用类型化），
 * 把缺值也写成 0 会让「旧批次没这列」和「本关确实取 0」无法区分。
 * 小数按 4 位截断，避免 usableSpaceTarget 这类连续采样值写出一长串浮点尾数。
 */
function num(v) {
  if (v == null || typeof v !== 'number' || !isFinite(v)) return '';
  return Number.isInteger(v) ? String(v) : String(+v.toFixed(4));
}

/**
 * 【v120】卡点落地摘要：把 chokeMarks 压成「中文名×数量」的一格文本（如 `窄路墙缺口×2 冰块簇聚集×3`）。
 * 全量坐标在 逐关记录.jsonl 的「卡点位置」里，CSV 只放摘要 —— 一格塞十几个坐标会让表没法筛。
 */
function chokeSummary(marks) {
  if (!Array.isArray(marks) || !marks.length) return '';
  const cnt = {};
  marks.forEach(m => { const k = m.cn || m.type; cnt[k] = (cnt[k] || 0) + 1; });
  return Object.keys(cnt).map(k => k + '×' + cnt[k]).join(' ');
}

// ───────────────────────── 状态 / 报告 ─────────────────────────

function writeStatus(b) {
  atomicWrite(docPath(b, '生产状态.json'), JSON.stringify({
    batchId: b.batchId, 批次目录: b.dirName,
    总输入数: b.totalInputs, 已处理数: b.processed, 已落库数: b.persisted,
    合格数: b.qualified, 不合格数: b.unqualified, 异常数: b.errors,
    前置闸门跳过数: b.skipped || 0, 跳过原因: b.skipReasons || {},
    当前输入索引: b.currentIndex, 当前关名: b.currentName,
    已完成输入索引: Array.from(b.doneIndexes).sort((x, y) => x - y),
    开始时间: b.startedAt, 最近更新时间: new Date().toISOString(),
    批次状态: b.state, 最后错误: b.lastError || null
  }, null, 2));
}

function writeReport(b) {
  let md = '# 生产报告\n\n';
  md += '- 批次目录：`输出文件/' + b.dirName + '`\n';
  md += '- 批次ID：`' + b.batchId + '`\n';
  md += '- 开始时间：' + b.startedAt + '\n';
  md += '- 最近更新：' + new Date().toISOString() + '\n';
  md += '- 批次状态：**' + b.state + '**\n\n';
  md += '## 计数\n\n';
  md += '| 项 | 数量 |\n|---|---:|\n';
  md += '| 总输入 | ' + b.totalInputs + ' |\n';
  md += '| 已落库 | ' + b.persisted + ' |\n';
  md += '| 正常合格 | ' + b.qualified + '（有卡点 ' + b.hardPass + ' / 简单关·趋势过平 ' + b.easyPass + '） |\n';
  md += '| 兜底（有关卡但不合格） | ' + b.fallbackCount + ' |\n';
  md += '| 普通不合格 | ' + (b.unqualified - b.fallbackCount) + ' |\n';
  md += '| 无关卡结构异常 | ' + b.errors + '（含看门狗 ' + b.watchdogCount + '） |\n';
  md += '| 前置闸门跳过 | ' + (b.skipped || 0) + '（生成候选前即判定源图不适合，未消耗生产预算） |\n\n';
  if (b.skipped) {
    md += '### 前置闸门跳过明细\n\n| 原因 | 张数 |\n|---|---:|\n';
    Object.keys(b.skipReasons || {}).forEach(k => { md += '| ' + k + ' | ' + b.skipReasons[k] + ' |\n'; });
    md += '\n';
  }
  md += '## 说明\n\n';
  md += '- 逐关明细见 `生产文档/逐关记录.jsonl`，量化表见 `生产文档/分析报告.csv`。\n';
  md += '- 每个有关卡结构的结果，完整内部数据（board/solve/audit/generationEval/fallback）见 `生产文档/关卡数据/`。\n';
  md += '- 合格关卡在 `合格关卡/`（源图在 `txt图/`）；不合格在 `不合格关卡/`（源图在 `不合格txt图/`，文件名带失败分类）。\n';
  md += '- 本批次为**逐关落库**：每关写盘确认后才生产下一关，不生成整批 ZIP。\n';
  if (b.lastError) md += '\n> 最后错误：' + b.lastError + '\n';
  atomicWrite(docPath(b, '生产报告.md'), md);
}

// ───────────────────────── 分类与落库 ─────────────────────────

/** 判定结果分类：qualified / fallback / unqualified。合格必须四项同时满足。 */
function classify(rec) {
  // 【前置闸门跳过】ANT-GEN-FRAGMENT-GATE-20260824：源图在生成候选之前就被判定不适合生产
  //   （碎色超限 / 底部入口不可达）。它既不是"不可解"也不是"结构异常"——根本没进生产，
  //   因此单独归一类，避免污染合格率与异常数的口径。
  if (rec.status === 'GATE_SKIPPED') {
    return { kind: 'skipped', label: rec.gateReasonCN || '前置闸门跳过' };
  }
  const a = rec.audit || {};
  const tier = a.tier || '';
  const omniWon = !!(rec.omniWon), playerWon = !!(rec.playerWon);
  // 【v464】结构门 qGate 是交付口径；旧 audit/playerWon 只报告。
  //   qGatePass=true → qualified（不看 playerWon / audit.tier）
  //   qGatePass=false → unqualified（结构门未过）
  //   老批次没有 qGatePass 字段 → 回退旧口径。
  if (rec.fallback === true) {
    const t = rec.fallbackType === 'timeout' ? '超时兜底' : (rec.fallbackType === 'exhausted' ? '遍历兜底' : '兜底');
    return { kind: 'fallback', label: t };
  }
  if (rec.qGatePass === true && rec.valid === true && omniWon) {
    return { kind: 'qualified', label: rec.qLabel || '合格' };
  }
  if (rec.qGatePass === false) {
    return { kind: 'unqualified', label: '结构门未过' };
  }
  // v104 合格门语义重置：档次字样由「困难合格/简单合格」改为「合格/简单关·趋势过平」。
  //   两套字样都认——新批次用新字样，历史批次重放(resumeBatch)时仍是旧字样，不能因此判成不合格。
  const QUALIFIED_TIERS = ['合格', '简单关·趋势过平', '困难合格', '简单合格'];
  const isQualified = rec.valid === true && omniWon && playerWon &&
    QUALIFIED_TIERS.indexOf(tier) >= 0 && rec.fallback !== true;
  if (isQualified) return { kind: 'qualified', label: tier };
  if (rec.valid !== true) return { kind: 'unqualified', label: '不可解' };
  if (!playerWon) return { kind: 'unqualified', label: '玩家不合格' };
  return { kind: 'unqualified', label: '审核不合格' };
}

function persistResult(b, payload) {
  const idx = Number(payload.inputIndex);
  const rec = payload.record || {};
  const baseName = safeName(String(rec.name || '').replace(/\.txt$/i, ''), 'level_' + idx);

  // 幂等：同一 batchId+inputIndex 重复提交 → 不重复写文件、不重复追加行
  if (b.doneIndexes.has(idx)) {
    return { persisted: true, idempotent: true, paths: b.pathsByIndex[idx] || {} };
  }

  const cls = classify(rec);
  const cleanLevel = rec.gameLevel || null;             // 程序端干净关卡（由网页用 toGameFormat 生成）
  const srcTxt = typeof rec.txt === 'string' ? rec.txt : '';
  const paths = {};

  // 唯一化文件名（同名不同输入时用序号，稳定不随机）
  function uniqueName(dir, stem, ext) {
    let nm = stem, k = 1;
    while (fs.existsSync(path.join(dir, nm + ext))) { k++; nm = stem + '_' + k; }
    return nm + ext;
  }

  if (cleanLevel) {
    if (cls.kind === 'qualified') {
      const dir = path.join(b.abs, '合格关卡');
      const fn = uniqueName(dir, baseName, '.json');
      atomicWrite(path.join(dir, fn), JSON.stringify(cleanLevel, null, 2));
      paths.level = '合格关卡/' + fn;
      if (srcTxt) { const t = uniqueName(path.join(b.abs, 'txt图'), baseName, '.txt'); atomicWrite(path.join(b.abs, 'txt图', t), srcTxt); paths.txt = 'txt图/' + t; }
    } else {
      const dir = path.join(b.abs, '不合格关卡');
      const fn = uniqueName(dir, baseName + '__' + cls.label, '.json');
      atomicWrite(path.join(dir, fn), JSON.stringify(cleanLevel, null, 2));
      paths.level = '不合格关卡/' + fn;
      if (srcTxt) { const t = uniqueName(path.join(b.abs, '不合格txt图'), baseName, '.txt'); atomicWrite(path.join(b.abs, '不合格txt图', t), srcTxt); paths.txt = '不合格txt图/' + t; }
    }
    // 完整内部数据（替代旧 关卡数据.json 的字段完整性）
    if (rec.debugData) {
      const dir = path.join(b.abs, '生产文档', '关卡数据');
      const fn = uniqueName(dir, baseName, '.json');
      atomicWrite(path.join(dir, fn), JSON.stringify(rec.debugData, null, 2));
      paths.debug = '生产文档/关卡数据/' + fn;
    }
  } else {
    // 无关卡结构：不造假关卡，只存源图 + 记录失败
    if (srcTxt) { const t = uniqueName(path.join(b.abs, '不合格txt图'), baseName, '.txt'); atomicWrite(path.join(b.abs, '不合格txt图', t), srcTxt); paths.txt = '不合格txt图/' + t; }
  }

  // 计数
  b.processed++; b.persisted++;
  b.doneIndexes.add(idx); b.pathsByIndex[idx] = paths;
  if (cls.kind === 'skipped') {
    b.skipped = (b.skipped || 0) + 1;                     // 前置闸门跳过：不计入异常，也不计入不合格
    b.skipReasons = b.skipReasons || {};
    b.skipReasons[cls.label] = (b.skipReasons[cls.label] || 0) + 1;
  } else if (!cleanLevel) {
    b.errors++;
    if (rec.status === 'WATCHDOG_TIMEOUT') b.watchdogCount++;
  } else if (cls.kind === 'qualified') {
    b.qualified++;
    // v104：'合格'(有实际卡点)计入 hardPass；'简单关·趋势过平' 计入 easyPass(简单关名额)。
    //   旧字样 '困难合格'/'简单合格' 同样归位，保证历史批次口径不变。
    if (cls.label === '合格' || cls.label === '困难合格') b.hardPass++; else b.easyPass++;
  } else {
    b.unqualified++;
    if (cls.kind === 'fallback') b.fallbackCount++;
  }

  // 逐关记录（JSONL，一关一行，追加）
  const a = rec.audit || {}, p = rec.perf || {}, ps = p.solver || {}, pp = p.playerSim || {};
  appendLine(docPath(b, '逐关记录.jsonl'), JSON.stringify({
    batchId: b.batchId, 输入序号: idx, 原图名: rec.name || '', 输出基础名: baseName,
    开始时间: rec.startedAt || null, 结束时间: rec.finishedAt || null, 耗时ms: rec.elapsedMs != null ? rec.elapsedMs : null,
    结果: cls.kind === 'skipped' ? '跳过' : (cleanLevel ? (cls.kind === 'qualified' ? '合格' : '不合格') : '异常'),
    // 目标图入口模式（v110，用户批准 q1）：关卡本体不含此字段，只能靠批次记录追溯玩法。
    // 同时存中文名与原始键：中文名给人看，原始键给程序判定（避免中文字样变更打断下游解析）。
    入口模式: entryModeCN(rec.entryMode), 入口模式键: rec.entryMode || 'fourSide',
    // 卡点类型（ANT-GEN-CHOKE-TYPES-20260824）：本关实际抽中的类型与 BOSS 规格标记。
    // isBossSlot 供后续排序阶段把这些关放到「逢5」位——生产顺序≠上线顺序，不看这个标记就落不到位。
    卡点类型: (rec.chokeTypesCN && rec.chokeTypesCN.length) ? rec.chokeTypesCN.join('+') : null,
    卡点类型键: rec.chokeTypes || null, 卡点数: rec.chokeCount != null ? rec.chokeCount : null,
    BOSS规格: rec.isBossSlot === true, 卡点落地: rec.chokeStat || null,
    // 【v120】卡点手段的落地位置清单（用户：报告与模拟游玩的关卡信息要显示卡点类型的信息和位置）。
    //   每条 {type,cn,r,c,detail}，detail 里是该类型的实际参数取值。
    //   坐标必须进 JSONL：CSV 一格塞不下全量坐标，那边只放「类型×数量」摘要与首个坐标。
    卡点位置: rec.chokeMarks || null,
    // 【v115】卡点概率机制的设定与实测（ANT-GEN-PARAM-RANGE-CHOKE-PROB-20260827）：
    //   rolls/prob 是设定，hits 是本关实际命中次数，expected 是理论期望（含池截断的精确式），pool 是可抽类型数。
    //   卡点数量改为随机量后，缺这几项就无法把批量实测均值与期望对照，也分不清参数设小与抽样波动。
    卡点计划: rec.chokePlan || null,
    // 【v115】本关最终候选实际采样到的一组区间参数。批次内每个候选各采一组 →
    //   不记录则参数波动了却无从追溯（同批次各关参数不再相同）。
    //   注意：后段自动削减（黑×0.85/冰×0.9/链×0.85）作用在这些值之上，故棋盘实际障碍量可能低于此处数值。
    采样参数: rec.sampledConfig || null,
    // 【v116】棋盘结构实测（ANT-GEN-USABLE-REPORT-CHOKE-WINDOW-20260827）：
    //   可用空间/墙/管道/盘面盒/藏盒，全部现场从最终 board.cells 重数，不抄结构候选阶段的记录值
    //   （最终 board 可能来自卡点变体或压力重生成，现场数才是真正交付的样子）。
    //   同时带上配额层记录的 quotaUsable/quotaBlackTarget/quotaBreachLevel/quotaRealUsable，
    //   两者不一致本身就是有价值的信号（例如「余格补黑」会让实际墙数超过配额目标）。
    棋盘结构: rec.boardStat || null,
    结果分类: cls.label, 状态: rec.status || (cleanLevel ? 'OK' : 'ERROR'),
    合格档: rec.qGatePass === true ? (rec.qLabel || '合格') : (a.tier || null),
    fallback: !!rec.fallback, fallbackTier: rec.fallbackTier != null ? rec.fallbackTier : null,
    fallbackType: rec.fallbackType || null, fallbackReason: rec.fallbackReason || null,
    难度分: rec.difficulty != null ? rec.difficulty : null, 难度等级: rec.grade || null,
    全知通关: rec.omniWon === true, 玩家通关: rec.playerWon === true,
    暂存峰值: rec.maxBuffer != null ? rec.maxBuffer : null,
    卡点at: a.lateAt != null ? a.lateAt : null, 前期峰窗: a.earlyMax, 中期峰窗: a.midMax, 后期峰窗: a.lateMax,
    // 【v116】合格门口径版本与卡点区间：三个峰窗字段的**区间语义随版本变化**
    //   （v116 起 中期=20~30%、后期即卡点区=30~80%；v104~v115 为 20~50% 与 50~100%）。
    //   不落版本与区间，跨批次比较 hasChoke 率就会把口径差异误读成产出变化。
    //   旧口径峰窗一并记录，只作对照、不参与判定。
    合格门版本: a.gateVersion || null,
    卡点区间: (a.chokeLo != null && a.chokeHi != null) ? { lo: a.chokeLo, hi: a.chokeHi } : null,
    // v118：阶段重划为三段（中期移除）。上面「中期峰窗」自 v118 起恒 0，真实分段看这里。
    //   后期段只记录不判定 —— 它达到卡点线也不算合格（用户口径：卡点要出在 30~80%）。
    // v119：卡点判定区 = [chokeLo, chokeHi] = 30~100%（后期段已纳入判定）。
    //   子段只用于分析「卡点出在前半还是尾巴」，不是独立判据。
    阶段划分: (a.earlyHi != null) ? {
      前期: [0, a.earlyHi], 卡点判定区: [a.chokeLo, a.chokeHi],
      子段_中后期: [a.chokeLo, a.tailLo != null ? a.tailLo : 0.8],
      子段_后期: [a.tailLo != null ? a.tailLo : 0.8, 1],
      中期: null, 窗口宽: a.winLate, 卡点线: a.high, 中压线: a.mid
    } : null,
    // ⚠ 命名必须避开上面的「后期峰窗」——那个字段自 v104 起就是 a.lateMax（卡点区峰窗），
    //   叫同一个名字会在同一个对象字面量里形成重复键、后者静默覆盖前者，把卡点区峰窗弄丢。
    //   （本轮初版就踩了这个坑，靠端到端落库验证的「旧字段未受影响」一项抓出来。）
    //   故 v118 新增的 80~100% 段叫「尾段峰窗」。
    尾段峰窗: a.tailMax != null ? a.tailMax : null, 尾段峰位: a.tailAt != null ? a.tailAt : null,
    中后期峰窗: a.midLateMax != null ? a.midLateMax : null, 中后期峰位: a.midLateAt != null ? a.midLateAt : null,
    旧口径: (a.lateMaxLegacy != null) ? {
      峰窗50到100: a.lateMaxLegacy, 峰位: a.lateAtLegacy,
      中期峰窗20到50: a.midMaxLegacy, 卡点线: a.highLegacy, 有卡点: a.hasChokeLegacy
    } : null,
    性能: { 建盘: p.boardBuilds, 管道重铺: p.pipeRebuilds, 基础候选: p.baseCandidates, 卡点变体: p.chokeVariants,
      重生成: p.regenVariants, 评价: p.evalCalls, solve调用: ps.solveCalls, 贪心遍: ps.greedyRuns, 树遍: ps.treeRuns,
      玩家模拟: pp.runs, 建盘ms: p.boardMs, 求解ms: ps.solveMs, 评价ms: p.evalMs, 玩家ms: pp.ms, 总ms: p.totalMs,
      停止原因: p.stopReason },
    输出路径: paths, 错误: rec.error || null, 落库完成时间: new Date().toISOString()
  }));

  // 分析报告 CSV（追加一行）
  const sc = rec.sampledConfig || {}, cpl = rec.chokePlan || {};   // v115 采样参数 / 卡点概率计划
  const bs = rec.boardStat || {};                                  // v116 棋盘结构实测
  appendLine(docPath(b, '分析报告.csv'), [
    b.batchId, idx, rec.name || '', 'PERSISTED', entryModeCN(rec.entryMode), cls.label, (rec.qGatePass === true ? (rec.qLabel || '合格') : (a.tier || '')),
    rec.fallback ? '是' : '否', rec.fallbackType || '-',
    rec.size || '', rec.boardSize || '', rec.totalBoxes != null ? rec.totalBoxes : '',
    rec.valid ? '是' : '否', rec.difficulty != null ? rec.difficulty : '', rec.grade || '',
    rec.obstacleNames || '', rec.maxBuffer != null ? rec.maxBuffer : '',
    rec.avgAll != null ? rec.avgAll : '', rec.avg50 != null ? rec.avg50 : '', rec.maxWin != null ? rec.maxWin : '',
    rec.playerWon ? '是' : '否', a.lateAt != null ? a.lateAt + '%' : '-', a.earlyMax, a.midMax, a.lateMax,
    p.totalMs != null ? p.totalMs : '', p.boardBuilds, p.baseCandidates, p.chokeVariants,
    ps.solveCalls, ps.greedyRuns, ps.treeRuns, pp.runs, p.stopReason || '',
    (rec.chokeTypesCN && rec.chokeTypesCN.length) ? rec.chokeTypesCN.join('+') : '',
    rec.chokeCount != null ? rec.chokeCount : '', rec.isBossSlot === true ? '是' : '',
    paths.level || paths.txt || '', (a.reasons || []).join('；'),
    // v115 追加列：采样参数 7 项 + 卡点概率机制 5 项（顺序须与 CSV_HEADER 尾部一致）
    num(sc.icePercent), num(sc.blackPercent), num(sc.chainCount), num(sc.questionPercent),
    num(sc.minPipes), num(sc.pipeMaxDepth), num(sc.usableSpaceTarget),
    num(cpl.rolls), num(cpl.prob), num(cpl.hits), num(cpl.expected), num(cpl.pool),
    // v116 追加列：棋盘结构实测 12 项（顺序须与 CSV_HEADER 尾部一致）
    num(bs.cells), num(bs.black), num(bs.blackPct), num(bs.pipeCells), num(bs.boardBoxes),
    num(bs.usable), num(bs.usableTarget), num(bs.usableDevPp),
    num(bs.pipeWant), bs.pipeTier || '', num(bs.hiddenBoxes), num(bs.hiddenPct),
    a.gateVersion || '',
    (a.chokeLo != null && a.chokeHi != null) ? (Math.round(a.chokeLo * 100) + '~' + Math.round(a.chokeHi * 100) + '%') : '',
    num(a.lateMaxLegacy), a.hasChokeLegacy === true ? '是' : (a.hasChokeLegacy === false ? '否' : ''),
    // v118 追加列：后期段（只记录不判定）+ 本关实际用的卡点线与前期区间
    num(a.tailMax), num(a.tailAt), num(a.high),
    (a.earlyHi != null) ? ('0~' + Math.round(a.earlyHi * 100) + '%') : '',
    // v119 追加：中后期子段 30~80%（「后期峰窗」列已变成整个卡点区 30~100% 的判定值）
    num(a.midLateMax), num(a.midLateAt),
    // v120 追加：卡点落地摘要（类型×数量）、首个卡点坐标、卡点进度带
    chokeSummary(rec.chokeMarks),
    (rec.chokeMarks && rec.chokeMarks.length) ? ('(' + rec.chokeMarks[0].r + ',' + rec.chokeMarks[0].c + ')' + rec.chokeMarks[0].cn) : '',
    (rec.chokeStat && rec.chokeStat.chokePos)
      ? (Math.round(rec.chokeStat.chokePos.min * 100) + '~' + Math.round(rec.chokeStat.chokePos.max * 100) + '%')
      : '',
    // v238 追加：吃满曲线（顺序须与 CSV_HEADER 尾部一致）
    num(rec.fillCurve && rec.fillCurve.medFull),
    num(rec.fillCurve && rec.fillCurve.lowPct),
    num(rec.fillCurve && rec.fillCurve.forcedMid),
    num(rec.persist && rec.persist.band3Pct)
  ].map(csvCell).join(','));

  b.currentIndex = idx; b.currentName = rec.name || '';
  writeStatus(b); writeReport(b);
  return { persisted: true, idempotent: false, paths: paths, classification: cls };
}

// ───────────────────────── HTTP ─────────────────────────

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('请求体超过上限 ' + MAX_BODY + ' 字节')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('请求体不是合法 JSON：' + e.message)); }
    });
    req.on('error', reject);
  });
}

function requireBatch(body) {
  const b = batches.get(String(body.batchId || ''));
  if (!b) throw new Error('未知 batchId（服务可能已重启；可调 /api/production/resume 恢复该批次目录后继续）');
  if (body.batchToken !== b.batchToken) throw new Error('批次令牌不匹配，拒绝写入');
  return b;
}

/**
 * 恢复一个【已存在于盘上】的批次目录，使其可以继续追加落库。
 * 任务 ANT-GEN-PARALLEL-WORKERPOOL-20260820，用户 2026-08-20 批准。
 *
 * 为什么需要：batches 只存在内存、batchToken 每次启动随机、createBatchDir 遇同名目录直接跳号，
 * 因此服务一重启（或页面一刷新换了新 batchId），原批次目录就再也写不进去 —— 已经跑完的关卡
 * 只能作废重跑。恢复接口把内存态从盘上重建出来，让同一目录能接着写。
 *
 * 计数与 doneIndexes 一律以【逐关记录.jsonl 的实际行】为准（那是每关落库时真实追加的），
 * 不信任 生产状态.json 里的汇总数字 —— 状态文件是快照，可能停在崩溃前的旧值。
 * 分类计数用与 persistResult 相同的 classify 口径重算，保证恢复前后报告口径一致。
 */
function resumeBatch(dirName) {
  const safe = safeName(String(dirName || ''), '');
  if (!safe) throw new Error('缺少批次目录名');
  const abs = assertInsideOutRoot(path.join(OUT_ROOT, safe));
  if (!fs.existsSync(abs)) throw new Error('批次目录不存在：输出文件/' + safe);
  const jsonl = path.join(abs, '生产文档', '逐关记录.jsonl');
  if (!fs.existsSync(jsonl)) throw new Error('该目录没有 生产文档/逐关记录.jsonl，无法确认已完成关卡，拒绝恢复');

  // 读原批次配置拿总输入数与开始时间（缺失则退化为未知，不阻断恢复）
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(abs, '生产文档', '批次配置.json'), 'utf8')); } catch (e) {}

  const b = {
    batchId: crypto.randomBytes(8).toString('hex'),
    batchToken: crypto.randomBytes(12).toString('hex'),
    dirName: safe, abs: abs,
    totalInputs: Array.isArray(cfg.输入清单) ? cfg.输入清单.length : 0,
    processed: 0, persisted: 0, qualified: 0, unqualified: 0, errors: 0,
    hardPass: 0, easyPass: 0, fallbackCount: 0, watchdogCount: 0,
    skipped: 0, skipReasons: {},
    currentIndex: -1, currentName: '',
    doneIndexes: new Set(), pathsByIndex: {},
    startedAt: cfg.开始时间 || new Date().toISOString(), state: 'RUNNING', lastError: null
  };

  // 重放 JSONL 重建计数（每行一关；同一 idx 只算一次，容忍历史重复行）
  const lines = fs.readFileSync(jsonl, 'utf8').split('\n').filter(l => l.trim());
  for (const line of lines) {
    let r;
    try { r = JSON.parse(line); } catch (e) { continue; }
    const idx = Number(r.输入序号);
    if (!Number.isInteger(idx) || b.doneIndexes.has(idx)) continue;
    b.doneIndexes.add(idx);
    b.pathsByIndex[idx] = r.输出路径 || {};
    b.processed++; b.persisted++;
    const label = r.结果分类 || '';
    if (r.状态 === 'GATE_SKIPPED' || r.结果 === '跳过') {
      b.skipped++;
      b.skipReasons[label] = (b.skipReasons[label] || 0) + 1;
    } else if (r.结果 === '异常') {
      b.errors++;
      if (r.状态 === 'WATCHDOG_TIMEOUT') b.watchdogCount++;
    } else if (label === '合格' || label === '简单关·趋势过平' || label === '困难合格' || label === '简单合格') {
      b.qualified++;
      if (label === '合格' || label === '困难合格') b.hardPass++; else b.easyPass++;
    } else {
      b.unqualified++;
      if (r.fallback === true) b.fallbackCount++;
    }
  }
  // 目录可能缺子目录（老批次或手工移动过）→ 补齐，保证后续写入不因缺目录失败
  SUBDIRS.forEach(d => fs.mkdirSync(path.join(abs, d), { recursive: true }));
  batches.set(b.batchId, b);
  writeStatus(b); writeReport(b);
  const done = Array.from(b.doneIndexes).sort((x, y) => x - y);
  console.log('[批次恢复] ' + safe + '  batchId=' + b.batchId + '  已完成 ' + done.length +
    ' 关（最大下标 ' + (done.length ? done[done.length - 1] : -1) + '），总输入 ' + b.totalInputs);
  return b;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function handleApi(req, res, urlPath) {
  if (req.method !== 'POST' && urlPath !== '/api/production/status' && urlPath !== '/api/production/ping') {
    return sendJson(res, 405, { ok: false, error: '只接受 POST' });
  }
  try {
    if (urlPath === '/api/production/ping') {
      return sendJson(res, 200, { ok: true, service: 'ant-production', serverToken: SERVER_TOKEN, outRoot: '输出文件' });
    }
    if (urlPath === '/api/production/status') {
      const u = new URL(req.url, 'http://127.0.0.1');
      const b = batches.get(String(u.searchParams.get('batchId') || ''));
      if (!b) return sendJson(res, 404, { ok: false, error: '未知 batchId' });
      return sendJson(res, 200, {
        ok: true, batchId: b.batchId, dirName: b.dirName, state: b.state,
        totalInputs: b.totalInputs, persisted: b.persisted, qualified: b.qualified,
        unqualified: b.unqualified, errors: b.errors,
        doneIndexes: Array.from(b.doneIndexes).sort((x, y) => x - y),
        currentIndex: b.currentIndex, lastError: b.lastError || null
      });
    }

    const body = await readBody(req);

    if (urlPath === '/api/production/start') {
      const created = createBatchDir(body.batchName);
      const batchId = crypto.randomBytes(8).toString('hex');
      const b = {
        batchId: batchId, batchToken: crypto.randomBytes(12).toString('hex'),
        dirName: created.dirName, abs: created.abs,
        totalInputs: Array.isArray(body.inputs) ? body.inputs.length : 0,
        processed: 0, persisted: 0, qualified: 0, unqualified: 0, errors: 0,
        hardPass: 0, easyPass: 0, fallbackCount: 0, watchdogCount: 0,
        skipped: 0, skipReasons: {},                     // 前置闸门跳过（ANT-GEN-FRAGMENT-GATE-20260824）
        currentIndex: -1, currentName: '', doneIndexes: new Set(), pathsByIndex: {},
        startedAt: new Date().toISOString(), state: 'RUNNING', lastError: null
      };
      batches.set(batchId, b);
      atomicWrite(docPath(b, '批次配置.json'), JSON.stringify({
        batchId: batchId, 请求批次名: body.batchName || '', 实际目录名: b.dirName, 开始时间: b.startedAt,
        输入清单: body.inputs || [], 生成参数: body.config || {},
        页面版本: body.pageVersion || null, 随机种子策略: body.seedPolicy || 'Math.random（未固定）',
        口径版本: body.rulesVersion || null
      }, null, 2));
      appendLine(docPath(b, '分析报告.csv'), '\ufeff' + CSV_HEADER.map(csvCell).join(','));   // 表头只写一次
      writeStatus(b); writeReport(b);
      console.log('[批次开始] ' + b.dirName + '  batchId=' + batchId + '  输入 ' + b.totalInputs + ' 张');
      return sendJson(res, 200, { ok: true, batchId: batchId, batchToken: b.batchToken, dirName: b.dirName, relDir: '输出文件/' + b.dirName, doneIndexes: [] });
    }

    if (urlPath === '/api/production/resume') {
      // 与 /start 同一安全模型：服务只监听 127.0.0.1，写入范围由 safeName + assertInsideOutRoot 双重约束，
      // 不另设令牌（resume 只能指向 输出文件/ 内已存在的批次目录，且不接受绝对路径与 .. 跳转）。
      const b = resumeBatch(body.dirName);
      const done = Array.from(b.doneIndexes).sort((x, y) => x - y);
      return sendJson(res, 200, {
        ok: true, batchId: b.batchId, batchToken: b.batchToken, dirName: b.dirName,
        relDir: '输出文件/' + b.dirName, totalInputs: b.totalInputs,
        doneIndexes: done, persisted: b.persisted,
        qualified: b.qualified, unqualified: b.unqualified, errors: b.errors
      });
    }

    if (urlPath === '/api/production/result' || urlPath === '/api/production/error') {
      const b = requireBatch(body);
      const out = persistResult(b, body);
      const idx = Number(body.inputIndex);
      console.log('  [落库' + (out.idempotent ? '·幂等跳过' : '') + '] #' + (idx + 1) + ' ' +
        ((body.record && body.record.name) || '') + ' → ' + (out.paths.level || out.paths.txt || '(仅记录)'));
      return sendJson(res, 200, Object.assign({ ok: true }, out));
    }

    if (urlPath === '/api/production/stop') {
      const b = requireBatch(body);
      b.state = 'STOPPED'; b.lastError = body.reason || null;
      writeStatus(b); writeReport(b);
      console.log('[批次停止] ' + b.dirName + '  已落库 ' + b.persisted + '/' + b.totalInputs);
      return sendJson(res, 200, { ok: true, state: b.state, persisted: b.persisted });
    }

    if (urlPath === '/api/production/finish') {
      const b = requireBatch(body);
      b.state = 'COMPLETED';
      writeStatus(b); writeReport(b);
      console.log('[批次完成] ' + b.dirName + '  合格 ' + b.qualified + ' / 不合格 ' + b.unqualified + ' / 异常 ' + b.errors);
      return sendJson(res, 200, {
        ok: true, state: b.state, relDir: '输出文件/' + b.dirName,
        persisted: b.persisted, qualified: b.qualified, unqualified: b.unqualified, errors: b.errors
      });
    }

    return sendJson(res, 404, { ok: false, error: '未知接口 ' + urlPath });
  } catch (e) {
    // 落库失败必须让网页看到，网页据此暂停派发并提供重试
    console.error('  [落库失败] ' + urlPath + '：' + e.message);
    return sendJson(res, 500, { ok: false, persisted: false, error: e.message });
  }
}

// 强不缓存头：Safari/浏览器会缓存旧 js/html，改了代码不清缓存就加载到旧版本（表现为「功能失效」）。
// no-store + 不发 Last-Modified/ETag → 浏览器无法走 304，每次都重新拉全量。
const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0'
};
// 给 html 里本地 js/css 引用设为单一 ?v=<本次启动令牌>（剥掉页面里写死的旧 ?v=，绕开已存在缓存条目）。
const SRC_RE = /((?:src|href)\s*=\s*")(?!https?:\/\/|\/\/|data:)([^"?#]+\.(?:js|css))(?:\?[^"#]*)?(["#])/gi;
function bustHtml(text) {
  return text.replace(SRC_RE, (m, a, p, z) => a + p + '?v=' + SERVER_TOKEN + z);
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.replace(/^\/+/, ''));
  if (!rel) rel = 'bin/index.html';
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('403'); }
  fs.stat(abs, function (err, st) {
    if (err || !st) { res.writeHead(404); return res.end('404 ' + rel); }
    const file = st.isDirectory() ? path.join(abs, 'index.html') : abs;
    fs.readFile(file, function (e2, data) {
      if (e2) { res.writeHead(404); return res.end('404'); }
      const ext = path.extname(file).toLowerCase();
      const headers = Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream' }, NO_CACHE_HEADERS);
      // .html 注入启动令牌 → 本地脚本/样式每次启动 URL 变化，彻底绕开旧缓存
      if (ext === '.html') {
        const body = Buffer.from(bustHtml(data.toString('utf8')), 'utf8');
        res.writeHead(200, headers);
        return res.end(body);
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
}

const server = http.createServer(function (req, res) {
  const urlPath = req.url.split('?')[0];
  if (urlPath.indexOf('/api/') === 0) { handleApi(req, res, urlPath); return; }
  serveStatic(req, res, urlPath);
});

// 长连接保活：生产时两次落库请求之间可能间隔好几分钟（单关生产很慢）。
//   Node 默认 keepAliveTimeout=5s 会把空闲连接关掉，客户端复用这条已被关闭的连接就会报 "socket hang up"、
//   导致明明写得好好的一关落库失败。这里把保活放宽到 10 分钟，并相应放宽头部/请求超时（0=不限，容纳大请求体）。
server.keepAliveTimeout = 10 * 60 * 1000;
server.headersTimeout = 11 * 60 * 1000;
server.requestTimeout = 0;

const PORT = parseInt(process.argv[2] || process.env.ANT_PORT || '8000', 10);
fs.mkdirSync(OUT_ROOT, { recursive: true });
server.listen(PORT, '127.0.0.1', function () {
  console.log('──────────────────────────────────────────────');
  console.log('  蚂蚁拿块 · 本地生产服务（逐关落库）');
  console.log('  项目根：' + ROOT);
  console.log('  输出根：输出文件/（唯一可写目录）');
  console.log('  地址：  http://localhost:' + PORT + '/bin/index.html');
  console.log('  关闭：  Control + C');
  console.log('──────────────────────────────────────────────');
});
server.on('error', function (e) { console.error('服务启动失败：' + e.message); process.exit(1); });
