/**
 * 大像素版毛线关卡 生成-审核-分析 一体化工具
 * 
 * 使用方法：
 *   1. 把待生成的 .txt 图纸放入 input_txt/
 *   2. 执行: node run.js
 *   3. 合格关卡输出到 output_json/
 * 
 * 流程：生成→求解分析→合格判定→卡死检验→输出
 * 每关每轮生成5个候选，最多10轮（50次尝试）
 * 合格条件：难度∈[MIN,MAX] + 符合预期/趋势符合 + 全知通关 + 审核基准档通关 + 不卡死
 * 审核基准档由环境变量 AUDIT_TIER 切换：strong(高手,默认) / novice(菜鸟) / mid(中级)
 *   - 菜鸟档额外严格约束：前50%进度最高5%窗口平均暂存必须<3.5（压低前期峰值/难度跳升）
 *   - 用法：AUDIT_TIER=novice node run.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');
const CloseColorAudit = require('./lib/close-color-audit');

// 靠色审查：每种颜色至少出现多少次才算「实际使用」（默认 1=出现即算）。可用环境变量覆盖。
const CLOSE_COLOR_MIN_PIXELS = Number.parseInt(process.env.CLOSE_COLOR_MIN_PIXELS || '1', 10) || 1;

// ===== 路径配置 =====
// 代码与工具都在 bin/（本脚本所在）；input_txt 与「日期-N关」输出在包根（bin 的上一级）。
const BIN = __dirname;
const ROOT = path.dirname(__dirname);
// 输入目录：默认 包根/input_txt；可用 RUN_INPUT_DIR 指向其它目录（用于定量批测，不动正式 input_txt）。
const INPUT_DIR = process.env.RUN_INPUT_DIR ? path.resolve(process.env.RUN_INPUT_DIR) : path.join(ROOT, 'input_txt');
const GENERATOR_DIR = path.join(BIN, '关卡生产工具大像素版48像素无黑块');
const SOLVER_DIR = path.join(BIN, '大像素毛线关卡求解器');
const DEAD_CHECK_DIR = path.join(BIN, '关卡卡死验证工具');

// 本次运行的输出目录：先写入临时工作目录，结束时按合格关卡数重命名为「日期-N关」。
let WORK_DIR = '';
let OUTPUT_DIR = '';    // = WORK_DIR/合格关卡（合格JSON + 原图txt + 两份CSV）
let FAIL_DIR = '';      // = WORK_DIR/不合格关卡（不合格JSON+标注 + 原图txt）

function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function uniqueRunDir(stamp, count) {
  let base = path.join(ROOT, `${stamp}-${count}关`);
  if (!fs.existsSync(base)) return base;
  let i = 2;
  while (fs.existsSync(path.join(ROOT, `${stamp}-${count}关_${i}`))) i++;
  return path.join(ROOT, `${stamp}-${count}关_${i}`);
}

// ===== 参数 =====
const MAX_ROUNDS = 10;
const CANDIDATES_PER_ROUND = 5;
// 审核基准档：'strong'(高手,默认) / 'novice'(菜鸟) / 'mid'(中级)。互斥切换。
// 用法示例：AUDIT_TIER=novice node run.js
const AUDIT_TIER = (process.env.AUDIT_TIER || 'strong').trim();
const TIER_NAME = { strong: '高手', mid: '中级', novice: '菜鸟' }[AUDIT_TIER] || AUDIT_TIER;
// 难度合格区间 [min, max]（含端点）。窄区间可精准命中某难度段。
// 默认下限：菜鸟档 20，其余档 30。可用环境变量 DIFFICULTY_MIN/MAX 覆盖。
const DEFAULT_DIFF_MIN = AUDIT_TIER === 'novice' ? '20' : '30';
const DIFFICULTY_MIN = Number.parseFloat(process.env.DIFFICULTY_MIN || DEFAULT_DIFF_MIN);
const DIFFICULTY_MAX = Number.parseFloat(process.env.DIFFICULTY_MAX || '100');
// 换球造卡点(两遍解):pass-1 无真卡点时，换中后期球颜色再审一遍尝试升级出真卡点。0=关闭(默认)，回测甜点≈0.25。
const BALL_SWAP_RATIO = Math.max(0, Math.min(1, Number.parseFloat(process.env.BALL_SWAP_RATIO || '0') || 0));
// 合格闸门开关·趋势符合是否算合格：默认开(路线B，趋势符合无卡点也算合格)；设 ALLOW_TREND_COMPLIANT=0 → 路线A(必须真卡点)。
const ALLOW_TREND_COMPLIANT = process.env.ALLOW_TREND_COMPLIANT !== '0';

// ===== 不合格理由记录 =====
// 4 套评分标准（合格闸门）：① 难度强度∈区间 ② 难度曲线符合(符合预期/趋势符合)
//                          ③ 全知版通关 ④ 审核基准档(AUDIT_TIER)通关；另有结构卡死检验。
// 对每一关，保留"最接近合格"的那个失败候选（通过闸门最多者，平手取难度更高者），
// 以便在汇总报告里写明它到底卡在 4 套标准的哪几条。
function _failGatesPassed(info) {
  if (!info || !info.hasScore) return -1;
  return (info.difficultyOK ? 1 : 0) + (info.compliant ? 1 : 0) +
         (info.omniPass ? 1 : 0) + (info.tierPass ? 1 : 0);
}
function recordFail(task, info) {
  const prev = task._bestFail;
  if (!prev) { task._bestFail = info; return; }
  // 有评分的候选永远优先于纯生成/求解失败的占位
  if (!prev.hasScore && info.hasScore) { task._bestFail = info; return; }
  if (prev.hasScore && info.hasScore) {
    const gNew = _failGatesPassed(info), gOld = _failGatesPassed(prev);
    if (gNew > gOld || (gNew === gOld && (info.diff || 0) > (prev.diff || 0))) {
      task._bestFail = info;
    }
  }
}
// 把合格时那一刻的分析数据固化成可内嵌到关卡 JSON 的报告（去除求解器随机性，供后续分组排序直接读取）
function buildAnalysis(sr) {
  if (!sr) return null;
  return {
    difficulty: sr.difficultyStrength,
    tier: sr.difficultyTier,
    quality: sr.curveQuality,
    issueType: sr.issueType || '',
    peakBand: sr.peakBand || '-',
    peakInZone: !!sr.peakInZone,
    zoneAvgBuf: sr.zoneAvgBuf,
    zoneAvgRes: sr.zoneAvgRes,
    earlyAvgBuf: sr.earlyAvgBuf,
    earlyAvgRes: sr.earlyAvgRes,
    totalSpools: sr.totalSpools,
    scoredAt: new Date().toISOString(),
  };
}

// 报告/展示口径 = 审核实际判定口径：曲线/合规/卡点/各档通关 全部取平均曲线(dsAvg，与判合格同一把尺)，
// 仅难度强度/难度档/因子取最好那遍(scoreResult，与难度区间闸门同尺)。
// → 报告与实际审核完全一致，不再出现"判合格了却显示不符合预期"。
function buildReportScore(dsAvg, scoreResult) {
  if (!dsAvg) return scoreResult || null;
  if (!scoreResult) return dsAvg;
  return Object.assign({}, dsAvg, {
    difficultyStrength: scoreResult.difficultyStrength,
    difficultyTier: scoreResult.difficultyTier,
    factors: scoreResult.factors,
  });
}

// 换球造卡点(两遍解的核心):按 pass-1 求解的 pickOrder 定位"进度≥50%消耗的棋盘球 + 管道深层球(层4-6)"，
// 打乱其中 ratio 比例的 {id,count}(整体交换→保持各色总数不变、不破坏颜色守恒、零卡死)。原地改 level.spools。
// 经回测验证:换球(颜色结构)是唯一能顶起后期卡点的杠杆;甜点比例 ~0.25。返回实际换了几个球。
function swapMidLateBalls(level, pickOrder, ratio) {
  if (!(ratio > 0) || !Array.isArray(pickOrder) || pickOrder.length < 4) return 0;
  const sp = level.spools, L = pickOrder.length;
  const isPipe = (cell) => { const t = cell && cell.type; return Array.isArray(t) ? t.some(x => x >= 11 && x <= 14) : (t >= 11 && t <= 14); };
  const positions = [], seen = new Set();
  for (let k = Math.floor(0.5 * L); k < L; k++) {
    const pk = pickOrder[k];
    if (pk && pk.source === 'cell') {
      const key = pk.row + ',' + pk.col;
      if (!seen.has(key)) { const cell = sp[pk.row] && sp[pk.row][pk.col]; if (cell && cell.id > 0 && cell.type === 0) { seen.add(key); positions.push({ kind: 'cell', r: pk.row, c: pk.col }); } }
    }
  }
  for (let r = 0; r < sp.length; r++) for (let c = 0; c < sp[r].length; c++) {
    const cell = sp[r][c];
    if (isPipe(cell) && Array.isArray(cell.param)) for (let idx = 3; idx <= 5 && idx < cell.param.length; idx++) { const e = cell.param[idx]; if (e && e.id > 0) positions.push({ kind: 'pipe', r: r, c: c, idx: idx }); }
  }
  if (positions.length < 4) return 0;
  const getC = (p) => p.kind === 'cell' ? sp[p.r][p.c] : sp[p.r][p.c].param[p.idx];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = a[i]; a[i] = a[j]; a[j] = x; } return a; };
  const sel = shuffle(positions.slice()).slice(0, Math.max(2, Math.round(ratio * positions.length)));
  const pool = sel.map(p => { const o = getC(p); return { id: o.id, count: o.count }; });
  shuffle(pool);
  sel.forEach((p, idx) => { const o = getC(p); o.id = pool[idx].id; o.count = pool[idx].count; });
  return sel.length;
}

// 不合格关卡内嵌的标注：固化被判不合格的原因 + 关键指标(平均口径)，供美术返图对照，关卡文件自描述问题。
function buildRejectAnalysis(rs, reason, opts) {
  opts = opts || {};
  const out = { rejected: true, reason: reason || '不合格', scoredAt: new Date().toISOString() };
  if (rs) {
    out.difficulty = rs.difficultyStrength;
    out.tier = rs.difficultyTier;
    out.quality = rs.curveQuality;
    out.issueType = rs.issueType || '';
    out.peakBand = rs.peakBand || '-';
    out.peakInZone = !!rs.peakInZone;
    out.zoneAvgBuf = rs.zoneAvgBuf;
    out.zoneAvgRes = rs.zoneAvgRes;
    out.earlyAvgBuf = rs.earlyAvgBuf;
    out.earlyAvgRes = rs.earlyAvgRes;
    out.totalSpools = rs.totalSpools;
  }
  if (opts.deadlock) { out.deadlock = true; out.deadMessage = opts.deadMessage || ''; }
  return out;
}

// 把输入 txt 原图纸复制到产出目录下独立的「原图txt」子文件夹（不与关卡 json 混放），
// 并改名与对应 json 同前缀(如 001_xxx.txt ↔ 001_xxx.json)，便于全路径对应回溯（美术返图后照名替换）。
function copySourceTxt(srcTxtPath, categoryDir, outputName) {
  try {
    if (!srcTxtPath || !fs.existsSync(srcTxtPath)) return;
    const txtDir = path.join(categoryDir, '原图txt');
    fs.mkdirSync(txtDir, { recursive: true });
    const txtName = outputName.replace(/\.json$/i, '.txt');
    fs.copyFileSync(srcTxtPath, path.join(txtDir, txtName));
  } catch (e) { /* 复制 txt 失败不影响主流程 */ }
}

// 统计棋盘「前半区」(上半部行=前期游玩区，后区=高行号)的可减压障碍(冰块type4 / 锁链type5)数量。
// 减压(relief)只后移/减少冰块与锁链("问号不动"，管道是疑似病因不计)；若前半区此类障碍≈0，
// 说明前期压力并非来自棋盘障碍(无可后移/可减的目标)，而是目标图/管道窄路所致 → relief 无能为力。
const FRONT_OBSTACLE_GIVEUP_MAX = 1; // 前半区可减压障碍 ≤ 此值 视为"几乎没有"
function countFrontObstacles(levelData) {
  try {
    const sp = levelData && levelData.spools;
    const maprow = levelData && levelData.maprow;
    if (!Array.isArray(sp) || !maprow) return 0;
    const frontRows = Math.max(1, Math.floor(maprow / 2));
    let n = 0;
    for (let r = 0; r < frontRows && r < sp.length; r++) {
      const row = sp[r];
      if (!Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell && (cell.type === 4 || cell.type === 5)) n++;
      }
    }
    return n;
  } catch (e) { return 0; }
}

// 从一遍求解结果里抽出网页直接复用所需的"解法"字段（路线 + 逐步曲线 + 指标）
function pickSolve(run) {
  if (!run) return null;
  return {
    pickOrder: run.pickOrder || null,
    stepBufferHistory: run.stepBufferHistory || null,
    stepElimHistory: run.stepElimHistory || null,
    stepResidenceHistory: run.stepResidenceHistory || null,
    totalSteps: run.totalSteps,
    totalTargetSpools: run.totalTargetSpools,
    eliminatedSpools: run.eliminatedSpools,
    progress: run.progress,
    maxBuffer: run.maxBuffer,
    avgBuffer: run.avgBuffer,
    avgBufferRatio: run.avgBufferRatio,
    avgRawResidence: run.avgRawResidence,
    avgResidence: run.avgResidence,
    maxResidence: run.maxResidence,
    completed: run.completed,
    passRate: run.passRate,
    attempts: run.attempts,
    misclicks: run.misclicks,
    bufferFinal: run.bufferFinal,
    bufferLimit: run.bufferLimit || 7,
  };
}

// 依据保留下来的失败候选，逐条对照 4 套评分标准生成可读的不合格理由。
function buildFailReason(info, min, max) {
  if (!info) return '未产出可评估候选（生成或求解均未成功）';
  if (!info.hasScore) return '生成/求解失败，未能产出可评估候选';
  const parts = [];
  if (!info.difficultyOK) parts.push(`难度强度${info.diff}不在区间[${min},${max}]（标准①）`);
  if (!info.compliant) parts.push(`难度曲线不符合：${info.issueType || info.quality || '不符合预期'}（标准②）`);
  if (!info.omniPass) parts.push('全知版未通关（标准③）');
  if (!info.tierPass) parts.push(`${TIER_NAME}档未通关（标准④）`);
  if (info.gatesPass && info.deadOk === false) {
    parts.push(`结构卡死${info.deadMsg ? '（' + info.deadMsg + '）' : ''}`);
  }
  let reason = parts.length ? parts.join('；') : '未知原因';
  if (info.artNote) reason += `｜美术建议：${info.artNote}`;
  return reason;
}

// ===== 动态难度平衡策略：按上一轮主要失败原因决定下一轮生成模式 =====
// normal     —— 按轮次升压（原加压阶梯，diffLevel 随轮次 1→4）
// pressurize —— 过于简单为主：直接执行第4档加压（后区加冰/加链），并绕过区域预设
// relief1    —— 前期峰值前移为主：后移冰块/锁链（减压一阶）
// relief2    —— 减压一阶后仍前期峰值前移：在后移基础上再减少冰/链障碍比例（减压二阶）
// cats: 本轮各失败候选的归类数组（'early' | 'tooSimple' | 'other'）
function nextStrategyMode(curMode, cats) {
  let early = 0, tooSimple = 0;
  for (const ca of (cats || [])) {
    if (ca === 'early') early++;
    else if (ca === 'tooSimple') tooSimple++;
  }
  if (early > 0 && early >= tooSimple) {
    // 前期压力跳升为主 → 减压；若已在减压则逐级加深到二阶
    return (curMode === 'relief1' || curMode === 'relief2') ? 'relief2' : 'relief1';
  }
  if (tooSimple > 0) return 'pressurize';
  return 'normal';
}

// ===== 加载求解器 =====
function loadSolver() {
  const context = {
    console, setTimeout, clearTimeout,
    document: {
      createElement() {
        return {
          style: {}, classList: { add() {}, remove() {} },
          appendChild() {}, removeChild() {}, addEventListener() {},
          querySelectorAll() { return []; },
          set textContent(_) {}, get textContent() { return ''; },
        };
      },
      head: { appendChild() {} },
      body: { appendChild() {}, removeChild() {} },
      getElementById() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
      readyState: 'loading',
    },
    window: {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(SOLVER_DIR, 'js/utils.js'), 'utf8'), context, { filename: 'utils.js' });
  vm.runInContext(fs.readFileSync(path.join(SOLVER_DIR, 'js/validator.js'), 'utf8'), context, { filename: 'validator.js' });
  return context.YarnLevel;
}

// ===== 加载卡死检验器 =====
function loadDeadChecker() {
  const appPath = path.join(DEAD_CHECK_DIR, 'validator/js/app.js');
  const source = fs.readFileSync(appPath, 'utf8');
  const context = { module: {}, exports: {}, require, console };
  context.global = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  // LevelActivityValidator 应挂在 global 或 root 上
  if (context.LevelActivityValidator) return context.LevelActivityValidator;
  if (context.module && context.module.exports) return context.module.exports;
  throw new Error('无法加载 LevelActivityValidator');
}

// ===== 主逻辑 =====
function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  大像素版毛线关卡 生成-审核-分析 一体化工具    ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // 扫描输入目录
  if (!fs.existsSync(INPUT_DIR)) {
    fs.mkdirSync(INPUT_DIR, { recursive: true });
    console.log('已创建 input_txt/ 目录，请放入 .txt 文件后重新运行。');
    return;
  }
  const txtFiles = fs.readdirSync(INPUT_DIR)
    .filter(f => f.endsWith('.txt'))
    .sort();

  if (txtFiles.length === 0) {
    console.log('input_txt/ 目录为空，请放入 .txt 文件后重新运行。');
    return;
  }

  console.log(`发现 ${txtFiles.length} 个 TXT 文件\n`);

  // 加载工具
  console.log(`加载求解器（审核基准档=${TIER_NAME} + 趋势符合判定）...`);
  console.log(`审核配置: AUDIT_TIER=${AUDIT_TIER}(${TIER_NAME}) | 难度区间=[${DIFFICULTY_MIN},${DIFFICULTY_MAX}]${AUDIT_TIER === 'novice' ? ' | 菜鸟前期严格约束<3.5' : ''}`);
  const YarnLevel = loadSolver();
  const Validator = YarnLevel.Validator;

  console.log('加载卡死检验器...');
  const LevelActivityValidator = loadDeadChecker();

  // 创建本次运行的输出工作目录（结束时重命名为「日期-N关」）
  WORK_DIR = path.join(ROOT, `__生产中_${Date.now()}`);
  OUTPUT_DIR = path.join(WORK_DIR, '合格关卡');
  FAIL_DIR = path.join(WORK_DIR, '不合格关卡');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 构建任务列表（按文件排序编号）
  const tasks = txtFiles.map((file, index) => {
    const baseName = file.replace('.txt', '');
    const batchNum = String(index + 1).padStart(3, '0');
    return {
      txtFile: file,
      txtPath: path.join(INPUT_DIR, file),
      baseName,
      batchNum,
      outputName: `${batchNum}_${baseName}.json`,
    };
  });

  // 每次运行都是独立的新文件夹，全部关卡都需要处理（不跳过）。
  const pending = tasks.slice();

  if (pending.length === 0) {
    console.log('没有需要处理的关卡。');
    return;
  }

  console.log(`需处理: ${pending.length} 关\n`);

  // ===== 生成+分析循环 =====
  const results = [];
  const qualifiedData = []; // {task, levelData, scoreResult, reportScore, bestRun, round, candidate}
  const auditData = {};     // 审核求解数据.json：{ 合格关卡文件名: {auditTier, solve(最好那遍), score(最好那遍ds)} }
  let remaining = pending.slice();

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (remaining.length === 0) break;
    console.log(`\n══════ 第 ${round} 轮 ══════ 剩余 ${remaining.length} 关`);

    const stillRemaining = [];

    for (const task of remaining) {
      const mode = task._mode || 'normal';
      const modeLabel = { normal: '常规', pressurize: '加压', relief1: '减压①后移', relief2: '减压②减障碍' }[mode] || mode;
      console.log(`\n  ▶ [${task.batchNum}] ${task.baseName} (第${round}轮 · ${modeLabel})`);
      let passed = false;
      const roundCats = []; // 本轮各失败候选归类，用于决定下一轮策略
      const roundEarly = { count: 0, noObs: 0 }; // 本轮"前期峰值前移"失败候选数 / 其中前半区几乎无障碍的数

      for (let c = 1; c <= CANDIDATES_PER_ROUND; c++) {
        // --- 生成（动态难度平衡策略：按 task._mode + 轮次 调整本轮生成）---
        // 加压：normal 按轮次升压(1→4)；pressurize 直接到第4档加压。减压：relief 用第1档 + 后移/减障碍。
        let diffLevel = round <= 1 ? 1 : round <= 2 ? 2 : round <= 3 ? 3 : 4;
        const strategyEnv = {};
        if (mode === 'pressurize') {
          diffLevel = 4;
          strategyEnv.STRATEGY_OVERRIDE_PRESET = '1';
        } else if (mode === 'relief1' || mode === 'relief2') {
          diffLevel = 1; // 减压：不加压，靠后移/减障碍压低前期
          strategyEnv.STRATEGY_OVERRIDE_PRESET = '1';
          strategyEnv.RELIEF_STAGE = (mode === 'relief2') ? '2' : '1';
          strategyEnv.BACK_ROW = '0.5';        // 后区起点后移
          strategyEnv.ICE_BACK_FRACTION = '1.0'; // 冰块尽量全后移
        }
        const tmpIn = path.join(OUTPUT_DIR, '_tmp_in');
        const tmpOut = path.join(OUTPUT_DIR, '_tmp_out');
        fs.mkdirSync(tmpIn, { recursive: true });
        fs.mkdirSync(tmpOut, { recursive: true });
        fs.copyFileSync(task.txtPath, path.join(tmpIn, task.txtFile));

        try {
          execSync(
            '"' + process.execPath + '" tool/scripts/run_batch_txt_node.js noblack "' + tmpIn + '" "' + tmpOut + '" json noextra',
            {
              cwd: GENERATOR_DIR, stdio: 'pipe', timeout: 30000,
              env: {
                ...process.env,
                SINGLE_COLOR_EXTRACT_PERCENT: '5',
                // 线轴容量贴图匹配：透传容量范围参数（默认 28/58/1/0），不再写死 SPOOL_BASE_PIXEL_COUNT=48 覆盖
                SPOOL_MIN: String(process.env.SPOOL_MIN || '28'),
                SPOOL_MAX: String(process.env.SPOOL_MAX || '58'),
                SPOOL_GAP: String(process.env.SPOOL_GAP || '1'),
                SPOOL_AVG: String(process.env.SPOOL_AVG || '0'),
                FIRST_ROW_RANGE_MULTIPLIER: '1',
                NEXT_ROW_RANGE_MULTIPLIER: '1.1',
                DIFFICULTY_LEVEL: String(diffLevel),
                OBSTACLE_PRESET_FILE: path.join(ROOT, '障碍区域预设.json'),
                // 管道内乱序：命令行经环境变量透传（如 PIPE_SHUFFLE_RATIO=0 node run.js 可关闭）；
                // 默认=推荐值 比例100%/swap2/层4-6（只动深层故不抬前期）；乱序区域写在 障碍区域预设.json 的 pipeShuffle 类目。
                PIPE_SHUFFLE_RATIO: String(process.env.PIPE_SHUFFLE_RATIO || '1'),
                PIPE_SHUFFLE_LAYER_LO: String(process.env.PIPE_SHUFFLE_LAYER_LO || '4'),
                PIPE_SHUFFLE_LAYER_HI: String(process.env.PIPE_SHUFFLE_LAYER_HI || '6'),
                PIPE_SHUFFLE_INTENSITY: String(process.env.PIPE_SHUFFLE_INTENSITY || 'swap2'),
                ...strategyEnv,
              },
            }
          );
        } catch (e) {
          console.log(`    候选${c}: 生成失败`);
          recordFail(task, { hasScore: false, genFail: true });
          fs.rmSync(tmpIn, { recursive: true, force: true });
          fs.rmSync(tmpOut, { recursive: true, force: true });
          continue;
        }

        const expectedJson = task.txtFile.replace('.txt', '.json');
        const jsonPath = path.join(tmpOut, expectedJson);
        if (!fs.existsSync(jsonPath)) {
          console.log(`    候选${c}: JSON未生成`);
          recordFail(task, { hasScore: false, genFail: true });
          fs.rmSync(tmpIn, { recursive: true, force: true });
          fs.rmSync(tmpOut, { recursive: true, force: true });
          continue;
        }

        const levelData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        fs.rmSync(tmpIn, { recursive: true, force: true });
        fs.rmSync(tmpOut, { recursive: true, force: true });

        // --- 靠色审查（最终审核新增项）---
        // 颜色集合由美术图(输入txt)决定、候选间不变 → 一旦命中靠色，整关无法靠重生成修复，
        // 立即判不合格（原因：发现靠色，美术返图修改），不再空跑余下候选/轮次。检测一次即短路。
        if (!task._closeColorReject) {
          const cc = CloseColorAudit.auditLevel(levelData, CLOSE_COLOR_MIN_PIXELS);
          if (cc.hasCloseColor) { cc.levelData = levelData; task._closeColorReject = cc; }
        }
        if (task._closeColorReject) break; // 跳出候选循环，交由下方 !passed 分支统一判废输出

        // --- 求解分析 ---
        const { spools, maprow, mapcol, blocks } = levelData;
        const seedOffset = round * 1000 + c * 100;

        let omniResult, playerResult;
        try {
          omniResult = Validator.analyzeOptimalSolution(spools, maprow, mapcol, blocks, seedOffset);
          playerResult = Validator.analyzePlayerSolution(spools, maprow, mapcol, blocks, seedOffset + 200000, AUDIT_TIER);
        } catch (e) {
          console.log(`    候选${c}: 求解出错 - ${e.message}`);
          recordFail(task, { hasScore: false, genFail: true });
          continue;
        }

        const omniPass = omniResult && omniResult.completed;
        const tierBase = playerResult.tiers && playerResult.tiers[AUDIT_TIER];
        const tierPass = !!(tierBase && tierBase.completed);

        // 评分：dsAvg 用"3遍按球平均曲线"判合格（稳定）；scoreResult 用"最好的一遍"自洽算难度/曲线/卡点（导出+展示）
        let dsAvg, scoreResult, bestRun;
        try {
          dsAvg = Validator.computeDifficultyScore(playerResult, { omniResult, auditTier: AUDIT_TIER, curveMode: 'avg', allowTrendCompliant: ALLOW_TREND_COMPLIANT });
          bestRun = tierBase && tierBase.bestRun;
          scoreResult = bestRun
            ? Validator.computeDifficultyScore(bestRun, { omniResult, auditTier: AUDIT_TIER, allowTrendCompliant: ALLOW_TREND_COMPLIANT })
            : dsAvg;
        } catch (e) {
          console.log(`    候选${c}: 评分出错`);
          recordFail(task, { hasScore: false, genFail: true });
          continue;
        }

        const reportScore = buildReportScore(dsAvg, scoreResult); // 报告口径=审核口径(曲线取平均,难度取最好那遍)
        const diff = scoreResult.difficultyStrength;   // 客观难度 = 最好那遍(与难度区间闸门同尺)
        const quality = reportScore.curveQuality || ''; // 展示曲线质量 = 平均口径(与判合格同尺)
        const avgIssue = dsAvg.issueType || '';          // 闸门/失败原因 = 平均口径
        const compliantAvg = dsAvg.compliant === true;   // 合格判定 = 平均曲线

        // --- 判定：合格(compliant)用平均曲线；难度区间用最好那遍 ---
        const inRange = diff >= DIFFICULTY_MIN && diff <= DIFFICULTY_MAX;
        const isQualified = inRange && compliantAvg && omniPass && tierPass;

        const reason = [];
        if (!inRange) reason.push(`难度${diff}不在[${DIFFICULTY_MIN},${DIFFICULTY_MAX}]`);
        if (!compliantAvg) reason.push(avgIssue || '不符合预期');
        if (!omniPass) reason.push('全知未通关');
        if (!tierPass) reason.push(`${TIER_NAME}未通关`);

        const tag = isQualified ? '✓合格' : '✗';
        console.log(`    候选${c}: ${tag} | 难度=${diff} | ${quality}${reason.length ? ' | ' + reason.join(', ') : ''}`);

        // [换球造卡点·两遍解 / 路线B] pass-1 无真卡点(含"趋势符合")且可救(难度/全知/该档过、非前期前移)
        // → 换中后期球再审一遍，尝试升级出真卡点；升级成功才用换球版，否则回落 pass-1。
        if (BALL_SWAP_RATIO > 0 && inRange && omniPass && tierPass && !dsAvg.peakInZone && avgIssue !== '前期峰值前移') {
          const lv2 = JSON.parse(JSON.stringify(levelData));
          const swN = swapMidLateBalls(lv2, tierBase && tierBase.pickOrder, BALL_SWAP_RATIO);
          if (swN > 0) {
            try {
              const o2 = Validator.analyzeOptimalSolution(lv2.spools, lv2.maprow, lv2.mapcol, lv2.blocks, seedOffset + 500000);
              const p2 = Validator.analyzePlayerSolution(lv2.spools, lv2.maprow, lv2.mapcol, lv2.blocks, seedOffset + 700000, AUDIT_TIER);
              const o2Pass = o2 && o2.completed;
              const tb2 = p2.tiers && p2.tiers[AUDIT_TIER];
              const tb2Pass = !!(tb2 && tb2.completed);
              const dsAvg2 = Validator.computeDifficultyScore(p2, { omniResult: o2, auditTier: AUDIT_TIER, curveMode: 'avg', allowTrendCompliant: ALLOW_TREND_COMPLIANT });
              const bestRun2 = tb2 && tb2.bestRun;
              const score2 = bestRun2 ? Validator.computeDifficultyScore(bestRun2, { omniResult: o2, auditTier: AUDIT_TIER, allowTrendCompliant: ALLOW_TREND_COMPLIANT }) : dsAvg2;
              const report2 = buildReportScore(dsAvg2, score2);
              const diff2 = score2.difficultyStrength;
              // 升级成功 = pass-2 真的造出卡点(peakInZone) + 难度区间 + 合规 + 全知 + 该档
              const ok2 = (diff2 >= DIFFICULTY_MIN && diff2 <= DIFFICULTY_MAX) && dsAvg2.compliant === true && dsAvg2.peakInZone === true && o2Pass && tb2Pass;
              console.log(`    候选${c}: 换球${swN}球再审 → ${ok2 ? '✓升级出卡点' : '✗未升级'} | 难度=${diff2} | ${report2.curveQuality || ''}`);
              if (ok2) {
                qualifiedData.push({ task, levelData: lv2, scoreResult: score2, reportScore: report2, bestRun: bestRun2, round, candidate: c, swapped: true });
                passed = true;
                break;
              }
            } catch (e) { /* 第二遍求解出错 → 回落 pass-1 */ }
          }
        }

        // 回落 pass-1：换球未升级(或不适用)，pass-1 本就合格(真卡点 或 趋势符合[闸门开]) → 输出 pass-1
        if (isQualified) {
          qualifiedData.push({ task, levelData, scoreResult, reportScore, bestRun, round, candidate: c });
          passed = true;
          break;
        }
        // 归类本候选的主要失败原因（按平均口径的闸门原因，供动态难度平衡决定下一轮策略）
        let failCat = 'other';
        if (avgIssue === '前期峰值前移') failCat = 'early';
        else if (avgIssue === '过于简单' || dsAvg.curveQuality === '异常(过于简单)') failCat = 'tooSimple';
        else if (!inRange && diff < DIFFICULTY_MIN) failCat = 'tooSimple';
        roundCats.push(failCat);
        if (failCat === 'early') {
          roundEarly.count++;
          if (countFrontObstacles(levelData) <= FRONT_OBSTACLE_GIVEUP_MAX) roundEarly.noObs++;
        }

        // 未合格：记录这个候选的 4 套标准达成情况 + 关卡数据（供"最接近合格"兜底输出）
        recordFail(task, {
          hasScore: true,
          diff,
          difficultyOK: inRange,
          compliant: compliantAvg,
          omniPass: !!omniPass,
          tierPass: tierPass,
          gatesPass: false,
          issueType: avgIssue,
          quality,
          artNote: reportScore.artNote,
          levelData,
          scoreResult,
          reportScore,
          bestRun,
        });
      }

      if (!passed) {
        // 靠色审查不合格：美术图用了靠色，重生成无法修复 → 立即判不合格并停止处理该关（不进入下一轮）。
        // 统一产出：不合格关卡 JSON(内嵌标注) + 对齐原图txt + 生产报告备注「发现靠色，美术返图修改」。
        if (task._closeColorReject) {
          const cc = task._closeColorReject;
          const failReason = CloseColorAudit.writeReject(FAIL_DIR, task.outputName, task.txtPath, cc);
          results.push({
            outputName: task.outputName, baseName: task.baseName, batchNum: task.batchNum,
            status: '不合格/需美术返图重修', round,
            difficulty: '-', quality: '-',
            failReason,
          });
          console.log(`    ⏹ [${task.batchNum}] 发现靠色 → 美术返图修改：${cc.detail}`);
          continue; // 不放回 stillRemaining，结束该关处理
        }

        // 前期压制·果断放弃：已进入减压(relief)，但本轮"前期峰值前移"的失败候选其前半区都几乎无可减压障碍(冰/链)，
        // 说明前期压力来自目标图/管道窄路而非棋盘障碍，relief 无能为力 → 不再纠缠，直接判不合格。
        const reliefFutile = (mode === 'relief1' || mode === 'relief2') &&
          roundEarly.count > 0 && roundEarly.noObs === roundEarly.count;

        if (round === MAX_ROUNDS || reliefFutile) {
          // 输出"最接近合格"的关卡到 不合格关卡/（JSON 内嵌问题标注）+ 复制对应输入 txt 原图，便于美术按名返图。
          const bf = task._bestFail;
          let failReason = buildFailReason(bf, DIFFICULTY_MIN, DIFFICULTY_MAX);
          if (reliefFutile) {
            failReason += '；前半区已无可减压障碍(冰/链)，前期压力源自目标图/管道窄路，减压无效，已提前判不合格';
          }
          let savedNote = '';
          if (bf && bf.hasScore && bf.levelData) {
            fs.mkdirSync(FAIL_DIR, { recursive: true });
            bf.levelData._analysis = buildRejectAnalysis(bf.reportScore, failReason);
            fs.writeFileSync(path.join(FAIL_DIR, task.outputName), JSON.stringify(bf.levelData, null, 2) + '\n', 'utf8');
            copySourceTxt(task.txtPath, FAIL_DIR, task.outputName);
            savedNote = '（已输出不合格关卡+原图txt到 不合格关卡/）';
          }
          if (reliefFutile && round < MAX_ROUNDS) {
            console.log(`    ⏹ 第${round}轮放弃：前半区无可减压障碍，问题在目标图/管道 → 判不合格`);
          }
          results.push({
            outputName: task.outputName, baseName: task.baseName, batchNum: task.batchNum,
            status: '不合格/需美术返图重修', round,
            difficulty: bf && bf.hasScore ? bf.diff : '-',
            quality: (bf && bf.hasScore && bf.reportScore) ? bf.reportScore.curveQuality : '-',
            failReason: failReason + savedNote,
          });
        } else {
          // 动态难度平衡：依据本轮主要失败原因决定下一轮生成模式
          task._mode = nextStrategyMode(mode, roundCats);
          stillRemaining.push(task);
        }
      }
    }

    remaining = stillRemaining;
  }

  // ===== 第3步：卡死检验 =====
  console.log(`\n\n══════ 卡死检验 ══════ 共 ${qualifiedData.length} 关待检`);

  const passedItems = []; // 通过卡死检验的

  for (const item of qualifiedData) {
    const rs = item.reportScore || item.scoreResult; // 报告口径(曲线平均+难度最好那遍)
    const validator = new LevelActivityValidator(item.levelData);
    const deadResult = validator.validate();

    if (deadResult.success) {
      // 通过 → 合格输出（内嵌固化分析报告=审核口径）+ 复制对应输入 txt 原图
      item.levelData._analysis = buildAnalysis(rs);
      if (item.swapped) item.levelData._analysis.swapEnhanced = true; // 标记:经"换球造卡点"二次审核合格
      const outPath = path.join(OUTPUT_DIR, item.task.outputName);
      fs.writeFileSync(outPath, JSON.stringify(item.levelData, null, 2) + '\n', 'utf8');
      copySourceTxt(item.task.txtPath, OUTPUT_DIR, item.task.outputName);
      passedItems.push(item);
      // 审核求解数据：把"最好那遍"的解法 + 审核口径结论按合格关卡文件名记下，供网页直接复用
      if (item.bestRun) {
        auditData[item.task.outputName] = {
          auditTier: AUDIT_TIER,
          solve: pickSolve(item.bestRun),
          score: rs,
        };
      }
      results.push({
        outputName: item.task.outputName, baseName: item.task.baseName, batchNum: item.task.batchNum,
        status: '合格', round: item.round, candidate: item.candidate,
        difficulty: rs.difficultyStrength,
        quality: rs.curveQuality,
        peakBand: rs.peakBand,
        zoneAvgBuf: rs.zoneAvgBuf,
      });
      console.log(`  ✓ ${item.task.outputName} — 通过卡死检验`);
    } else {
      // 卡死 → 归入不合格关卡（JSON 内嵌标注）+ 复制对应输入 txt 原图
      const failReason = '结构卡死：' + (deadResult.message || '');
      fs.mkdirSync(FAIL_DIR, { recursive: true });
      item.levelData._analysis = buildRejectAnalysis(rs, failReason, { deadlock: true, deadMessage: deadResult.message });
      fs.writeFileSync(path.join(FAIL_DIR, item.task.outputName), JSON.stringify(item.levelData, null, 2) + '\n', 'utf8');
      copySourceTxt(item.task.txtPath, FAIL_DIR, item.task.outputName);
      results.push({
        outputName: item.task.outputName, baseName: item.task.baseName, batchNum: item.task.batchNum,
        status: '不合格/需美术返图重修', round: item.round,
        difficulty: rs.difficultyStrength,
        quality: rs.curveQuality,
        failReason: failReason + '（已输出不合格关卡+原图txt到 不合格关卡/）',
      });
      console.log(`  ✗ ${item.task.outputName} — 卡死: ${deadResult.message}（已归入不合格关卡）`);
    }
  }

  // ===== 审核求解数据.json：网页可直接复用的"最好那遍"解法+审核结论（按合格关卡文件名索引）=====
  if (Object.keys(auditData).length > 0) {
    const auditPath = path.join(OUTPUT_DIR, '审核求解数据.json');
    fs.writeFileSync(auditPath, JSON.stringify(auditData) + '\n', 'utf8');
    console.log(`  审核求解数据已输出: 合格关卡/审核求解数据.json（${Object.keys(auditData).length} 关）`);
  }

  // ===== 第4步：对合格关卡跑完整批量分析 =====
  if (passedItems.length > 0) {
    console.log(`\n\n══════ 批量分析（合格关卡） ══════ 共 ${passedItems.length} 关`);

    const analysisLines = [
      '排名,关卡名,难度强度,难度档,曲线质量,卡点区间,卡点达标,目标区平均暂存,目标区平均滞留,' +
      '前期平均暂存,前期平均滞留,问题类型,各档通关情况,调整建议(美术),' +
      `${TIER_NAME}占用%,总球数`
    ];

    // 收集分析数据并按难度排序
    const analysisData = [];
    for (const item of passedItems) {
      const sr = item.reportScore || item.scoreResult;
      const strongT = item.levelData.spools ? item.levelData.spools.length + 'x' + (item.levelData.spools[0] || []).length : '-';
      analysisData.push({
        name: item.task.outputName.replace('.json', ''),
        difficulty: sr.difficultyStrength,
        tier: sr.difficultyTier,
        quality: sr.curveQuality || '-',
        peakBand: sr.peakBand || '-',
        capValid: sr.peakInZone ? '是' : '否',
        zoneAvgBuf: sr.zoneAvgBuf || 0,
        zoneAvgRes: sr.zoneAvgRes || 0,
        earlyAvgBuf: sr.earlyAvgBuf || 0,
        earlyAvgRes: sr.earlyAvgRes || 0,
        issueType: sr.issueType || '-',
        tierClear: sr.tierClearNote || '全部通关',
        artNote: sr.artNote || '',
        strongRatio: sr.factors ? (sr.factors.f2_bufRatio * 50).toFixed(1) : '-',
        totalSpools: sr.totalSpools || '-',
      });
    }

    analysisData.sort((a, b) => b.difficulty - a.difficulty);

    analysisData.forEach((d, idx) => {
      analysisLines.push([
        idx + 1, d.name, d.difficulty, d.tier, d.quality, d.peakBand, d.capValid,
        d.zoneAvgBuf, d.zoneAvgRes, d.earlyAvgBuf, d.earlyAvgRes,
        d.issueType, `"${d.tierClear}"`, `"${d.artNote}"`, d.strongRatio, d.totalSpools
      ].join(','));
    });

    const analysisPath = path.join(OUTPUT_DIR, '批量分析结果.csv');
    fs.writeFileSync(analysisPath, analysisLines.join('\n') + '\n', 'utf8');
    console.log(`  批量分析已输出: 合格关卡/批量分析结果.csv`);
  }

  // ===== 输出汇总报告 =====
  results.sort((a, b) => a.batchNum.localeCompare(b.batchNum));
  const reportLines = ['批次序号,输出文件名,原名,状态,命中轮次,难度强度,曲线质量,卡点区间,目标区均暂存,不合格原因'];
  for (const r of results) {
    const reasonText = r.status === '合格' ? '' : (r.failReason || '');
    reportLines.push([
      r.batchNum, r.outputName, r.baseName, r.status, r.round || '-',
      r.difficulty || '-', r.quality || '-', r.peakBand || '-', r.zoneAvgBuf || '-',
      '"' + String(reasonText).replace(/"/g, '""') + '"'
    ].join(','));
  }
  const reportPath = path.join(OUTPUT_DIR, '生产汇总报告.csv');
  fs.writeFileSync(reportPath, reportLines.join('\n') + '\n', 'utf8');

  // 清理临时目录
  const tmpIn = path.join(OUTPUT_DIR, '_tmp_in');
  const tmpOut = path.join(OUTPUT_DIR, '_tmp_out');
  if (fs.existsSync(tmpIn)) fs.rmSync(tmpIn, { recursive: true, force: true });
  if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut, { recursive: true, force: true });

  // 统计（产出只分两类：合格 / 不合格<含需返图重修+结构卡死>）
  const passed = results.filter(r => r.status === '合格').length;
  const failed = results.filter(r => r.status === '不合格/需美术返图重修').length;

  // ===== 把本次所有产物统一打包重命名为「日期-N关」 =====
  let outFolderName = path.basename(WORK_DIR);
  try {
    const finalDir = uniqueRunDir(dateStamp(), passed);
    fs.renameSync(WORK_DIR, finalDir);
    outFolderName = path.basename(finalDir);
  } catch (e) {
    console.log('  输出目录重命名失败，结果保留在临时目录：' + outFolderName);
  }

  console.log('\n\n╔══════════════════════════════════════════════════╗');
  console.log('║  完成                                            ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  合格输出: ${passed} 关`);
  console.log(`║  不合格(需美术返图/卡死): ${failed} 关`);
  console.log(`║  总计: ${results.length} 关`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  所有产物已打包到文件夹: ${outFolderName}/`);
  console.log(`║    ├─ 合格关卡/（合格 JSON + 报告 CSV；原图 txt 在 原图txt/ 子文件夹）`);
  console.log(`║    └─ 不合格关卡/（不合格 JSON+标注；原图 txt 在 原图txt/ 子文件夹）`);
  console.log('╚══════════════════════════════════════════════════╝');
}

main();
