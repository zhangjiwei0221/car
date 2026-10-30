/**
 * 大像素版毛线关卡 生成-审核-分析 网页版服务器
 * 零依赖：纯 Node 内置模块（http + ws手写 + fs + vm + child_process）
 * 启动：node server.js → 自动打开 http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const vm = require('vm');
const { execSync } = require('child_process');
const sorter = require('./sort_levels');
const CloseColorAudit = require('./lib/close-color-audit');

// 靠色审查：每种颜色至少出现多少次才算「实际使用」（默认 1=出现即算）。可用环境变量覆盖。
const CLOSE_COLOR_MIN_PIXELS = Number.parseInt(process.env.CLOSE_COLOR_MIN_PIXELS || '1', 10) || 1;

const PORT = 3000;
// bin/ 目录（所有代码与工具所在）
const BIN = __dirname;
// 包根目录（input_txt 与「日期-N关」输出文件夹所在，即 bin 的上一级）
const ROOT = path.dirname(__dirname);
const GENERATOR_DIR = path.join(BIN, '关卡生产工具大像素版48像素无黑块');
const SOLVER_DIR = path.join(BIN, '大像素毛线关卡求解器');
const DEAD_CHECK_DIR = path.join(BIN, '关卡卡死验证工具');
const OUTPUT_DIR = path.join(ROOT, 'output_json');     // 旧路径，仅作无运行时的兜底

// ===== 单次生产的输出位置（统一打包到一个「日期-输出关卡数」文件夹）=====
// 生产过程中先写入一个临时工作目录，完成时再按合格关卡数重命名为「YYYY-MM-DD-N关」。
// currentRun 记录最近一次生产的输出目录，供 /api/download、/api/results 使用。
let currentRun = null;

function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 在包根下为「日期-N关」选一个不冲突的名字（同日同数量时追加 _2、_3…）
function uniqueRunDir(stamp, count) {
  let base = path.join(ROOT, `${stamp}-${count}关`);
  if (!fs.existsSync(base)) return base;
  let i = 2;
  while (fs.existsSync(path.join(ROOT, `${stamp}-${count}关_${i}`))) i++;
  return path.join(ROOT, `${stamp}-${count}关_${i}`);
}

// ===== 加载求解器（启动时加载一次）=====
let YarnLevel, Validator, LevelActivityValidator;

function loadSolver() {
  const context = {
    console, setTimeout, clearTimeout,
    document: {
      createElement() { return { style: {}, classList: { add(){}, remove(){} }, appendChild(){}, removeChild(){}, addEventListener(){}, querySelectorAll(){ return []; }, set textContent(_){}, get textContent(){ return ''; } }; },
      head: { appendChild(){} }, body: { appendChild(){}, removeChild(){} },
      getElementById(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){}, readyState: 'loading',
    },
    window: {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(SOLVER_DIR, 'js/utils.js'), 'utf8'), context, { filename: 'utils.js' });
  vm.runInContext(fs.readFileSync(path.join(SOLVER_DIR, 'js/validator.js'), 'utf8'), context, { filename: 'validator.js' });
  YarnLevel = context.YarnLevel;
  Validator = YarnLevel.Validator;
}

function loadDeadChecker() {
  const appPath = path.join(DEAD_CHECK_DIR, 'validator/js/app.js');
  const source = fs.readFileSync(appPath, 'utf8');
  const context = { module: {}, exports: {}, require, console };
  context.global = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js' });
  LevelActivityValidator = context.LevelActivityValidator || context.module.exports;
}

// ===== WebSocket 连接管理 =====
const wsClients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    try { ws.send(msg); } catch (e) { wsClients.delete(ws); }
  }
}

// ===== HTTP 服务器 =====
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API: 上传文件
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const data = JSON.parse(Buffer.concat(body).toString());
      // data = { files: [{name, content}] }
      const inputDir = path.join(ROOT, 'input_txt');
      fs.mkdirSync(inputDir, { recursive: true });
      for (const f of data.files) {
        fs.writeFileSync(path.join(inputDir, f.name), f.content, 'utf8');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: data.files.length }));
    });
    return;
  }

  // API: 开始生产
  if (url.pathname === '/api/start' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const params = JSON.parse(Buffer.concat(body).toString());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      // 异步启动生产流程
      setTimeout(() => runPipeline(params), 100);
    });
    return;
  }

  // API: 下载合格JSON
  if (url.pathname.startsWith('/api/download/')) {
    const filename = decodeURIComponent(url.pathname.replace('/api/download/', ''));
    const dir = currentRun ? currentRun.qualifiedDir : OUTPUT_DIR;
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // API: 列出 input_txt 中已有的 .txt 图纸（供网页加载时自动识别，无需拖拽上传）
  if (url.pathname === '/api/inputs') {
    const inputDir = path.join(ROOT, 'input_txt');
    const files = fs.existsSync(inputDir)
      ? fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.txt')).sort()
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ files }));
    return;
  }

  // API: 列出结果
  if (url.pathname === '/api/results') {
    const dir = currentRun ? currentRun.qualifiedDir : OUTPUT_DIR;
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ files }));
    return;
  }

  // API: 分组排序（独立工具）——导入一批合格关卡(含 _analysis)，按参数分组排序+重命名输出
  if (url.pathname === '/api/sort-batch' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(Buffer.concat(body).toString()); }
      catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: '请求体解析失败' })); return; }
      const rawLevels = Array.isArray(payload.files) ? payload.files : [];
      const params = payload.params || {};
      const levels = [];
      const parseErrors = [];
      for (const f of rawLevels) {
        try { levels.push({ name: f.name, json: JSON.parse(f.content) }); }
        catch (e) { parseErrors.push(f.name); }
      }
      if (levels.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '没有可用的关卡 JSON', parseErrors }));
        return;
      }
      // 唯一输出目录：排序结果_日期[_2..]
      let outDir = path.join(ROOT, `排序结果_${dateStamp()}`);
      let i = 2;
      while (fs.existsSync(outDir)) { outDir = path.join(ROOT, `排序结果_${dateStamp()}_${i++}`); }
      try {
        const r = sorter.sortAndWriteFromLevels(levels, outDir, {
          groupSize: params.groupSize,
          bossThreshold: params.bossThreshold,
          startLevel: params.startLevel,
          bossAnchor: params.bossAnchor,
          bossInterval: params.bossInterval,
          nameTemplate: params.nameTemplate,
          keepAnalysis: params.keepAnalysis,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, folder: path.basename(outDir), written: r.written, total: r.total, missingAnalysis: r.missingAnalysis, parseErrors }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    });
    return;
  }

  // 静态文件
  let filePath = path.join(BIN, 'web', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
  res.end(fs.readFileSync(filePath));
});

// ===== WebSocket 升级 =====
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-5AB9FC11B85B').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');

  const ws = {
    send(data) {
      const buf = Buffer.from(data, 'utf8');
      let header;
      if (buf.length < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81;
        header[1] = buf.length;
      } else if (buf.length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(buf.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(buf.length), 2);
      }
      socket.write(Buffer.concat([header, buf]));
    }
  };
  wsClients.add(ws);
  socket.on('close', () => wsClients.delete(ws));
  socket.on('error', () => wsClients.delete(ws));
});

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
  if (!prev.hasScore && info.hasScore) { task._bestFail = info; return; }
  if (prev.hasScore && info.hasScore) {
    const gNew = _failGatesPassed(info), gOld = _failGatesPassed(prev);
    if (gNew > gOld || (gNew === gOld && (info.diff || 0) > (prev.diff || 0))) {
      task._bestFail = info;
    }
  }
}
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
// 仅难度强度/难度档/因子取最好那遍(scoreResult，与难度区间闸门同尺)。报告与实际审核一致，不再"合格却显示不符合预期"。
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
    totalSteps: run.totalSteps, totalTargetSpools: run.totalTargetSpools,
    eliminatedSpools: run.eliminatedSpools, progress: run.progress,
    maxBuffer: run.maxBuffer, avgBuffer: run.avgBuffer, avgBufferRatio: run.avgBufferRatio,
    avgRawResidence: run.avgRawResidence, avgResidence: run.avgResidence, maxResidence: run.maxResidence,
    completed: run.completed, passRate: run.passRate, attempts: run.attempts, misclicks: run.misclicks,
    bufferFinal: run.bufferFinal, bufferLimit: run.bufferLimit || 7,
  };
}
function buildFailReason(info, min, max) {
  if (!info) return '未产出可评估候选（生成或求解均未成功）';
  if (!info.hasScore) return '生成/求解失败，未能产出可评估候选';
  const parts = [];
  if (!info.difficultyOK) parts.push(`难度强度${info.diff}不在区间[${min},${max}]（标准①）`);
  if (!info.compliant) parts.push(`难度曲线不符合：${info.issueType || info.quality || '不符合预期'}（标准②）`);
  if (!info.omniPass) parts.push('全知版未通关（标准③）');
  if (!info.tierPass) parts.push('审核基准档未通关（标准④）');
  if (info.gatesPass && info.deadOk === false) {
    parts.push(`结构卡死${info.deadMsg ? '（' + info.deadMsg + '）' : ''}`);
  }
  let reason = parts.length ? parts.join('；') : '未知原因';
  if (info.artNote) reason += `｜美术建议：${info.artNote}`;
  return reason;
}

// ===== 动态难度平衡策略：按上一轮主要失败原因决定下一轮生成模式 =====
// normal=按轮次升压 / pressurize=过于简单→第4档加压 / relief1=前期峰值前移→后移冰块锁链 / relief2=仍前移→再减障碍比例
function nextStrategyMode(curMode, cats) {
  let early = 0, tooSimple = 0;
  for (const ca of (cats || [])) {
    if (ca === 'early') early++;
    else if (ca === 'tooSimple') tooSimple++;
  }
  if (early > 0 && early >= tooSimple) {
    return (curMode === 'relief1' || curMode === 'relief2') ? 'relief2' : 'relief1';
  }
  if (tooSimple > 0) return 'pressurize';
  return 'normal';
}

// ===== 生产流程核心 =====
function runPipeline(params) {
  const MAX_ROUNDS = params.maxRounds || 10;
  const CANDIDATES = params.candidatesPerRound || 5;
  // 审核基准档（互斥）：strong(高手,默认) / novice(菜鸟) / mid(中级)
  const AUDIT_TIER = params.auditTier === 'novice' ? 'novice' : (params.auditTier === 'mid' ? 'mid' : 'strong');
  const TIER_NAME = { strong: '高手', mid: '中级', novice: '菜鸟' }[AUDIT_TIER] || AUDIT_TIER;
  // 难度合格区间 [min,max]（含端点）。兼容旧参数 difficultyThreshold（作为下限）。
  // 默认下限：菜鸟 20，其余 30（UI 未显式传入时）。
  const DEFAULT_MIN = AUDIT_TIER === 'novice' ? 20 : 30;
  const D_MIN = (params.difficultyMin != null ? params.difficultyMin : (params.difficultyThreshold != null ? params.difficultyThreshold : DEFAULT_MIN));
  const D_MAX = (params.difficultyMax != null ? params.difficultyMax : 100);
  // 换球造卡点(两遍解):pass-1 无真卡点时，换中后期球颜色再审一遍尝试升级出真卡点。0=关闭(默认)，回测甜点≈0.25。
  const BALL_SWAP_RATIO = Math.max(0, Math.min(1, Number.parseFloat(params.ballSwapRatio) || 0));
  // 线轴容量贴图匹配参数（与 ballSwapRatio 同解析风格：Number.parseFloat + Math.max/min 钳制）。
  // SPOOL_MIN/MAX=容量下限/上限(钳 MAX≥MIN)；SPOOL_GAP=阻隔容忍度(钳≥0)；SPOOL_AVG=目标平均容量(0=不启用，>0 钳到[MIN,MAX])。
  const SPOOL_MIN = Math.max(1, Number.parseFloat(params.spoolMin) || 28);
  const SPOOL_MAX = Math.max(SPOOL_MIN, Number.parseFloat(params.spoolMax) || 58);
  const SPOOL_GAP = Math.max(0, Number.parseFloat(params.spoolGap) || 1);
  const _spoolAvgRaw = Number.parseFloat(params.spoolAvg) || 0;
  const SPOOL_AVG = _spoolAvgRaw > 0 ? Math.max(SPOOL_MIN, Math.min(SPOOL_MAX, _spoolAvgRaw)) : 0;
  // 合格闸门开关·趋势符合是否算合格：默认 true(路线B)；false=路线A(必须真卡点)。
  const ALLOW_TREND_COMPLIANT = params.allowTrendCompliant !== false;
  // 障碍参数（网页 UI 同步；缺省即原值）
  const OBS_ENV = {
    ICE_RATIO: String(params.iceRatio != null ? params.iceRatio : 0.15),
    QUESTION_RATIO: String(params.questionRatio != null ? params.questionRatio : 0.25),
    CHAIN_DIVISOR: String(params.chainDivisor != null ? params.chainDivisor : 20),
    BACK_ROW: String(params.backRow != null ? params.backRow : 0.4),
    ICE_BONUS_RATIO: String(params.iceBonus != null ? params.iceBonus : 0.10),
    // 管道内乱序参数（默认=推荐值：比例100%、swap2、层4-6；只动深层故不抬前期）；乱序区域随 obstaclePreset.pipeShuffle 透传
    PIPE_SHUFFLE_RATIO: String(params.pipeShuffleRatio != null ? params.pipeShuffleRatio : 1),
    PIPE_SHUFFLE_LAYER_LO: String(params.pipeShuffleLayerLo != null ? params.pipeShuffleLayerLo : 4),
    PIPE_SHUFFLE_LAYER_HI: String(params.pipeShuffleLayerHi != null ? params.pipeShuffleLayerHi : 6),
    PIPE_SHUFFLE_INTENSITY: (params.pipeShuffleIntensity === 'full' ? 'full' : 'swap2'),
  };
  // 障碍区域预设：UI 传了就用 UI 的（内联 JSON，覆盖配置文件）；没传则回退根目录配置文件
  if (params.obstaclePreset) OBS_ENV.OBSTACLE_PRESET_JSON = JSON.stringify(params.obstaclePreset);
  else OBS_ENV.OBSTACLE_PRESET_FILE = path.join(ROOT, '障碍区域预设.json');

  const inputDir = path.join(ROOT, 'input_txt');
  if (!fs.existsSync(inputDir)) { broadcast({ type: 'error', msg: 'input_txt/ 目录不存在' }); return; }

  const txtFiles = fs.readdirSync(inputDir).filter(f => f.endsWith('.txt')).sort();
  if (txtFiles.length === 0) { broadcast({ type: 'error', msg: '没有找到 .txt 文件' }); return; }

  // 本次生产的临时工作目录（完成时按合格关卡数重命名为「日期-N关」）。
  // 所有产物统一打包在这个目录内：合格关卡/（合格JSON+原图txt+两份CSV）、不合格关卡/（不合格JSON+标注+原图txt）。
  const workDir = path.join(ROOT, `__生产中_${Date.now()}`);
  const qualifiedDir = path.join(workDir, '合格关卡');
  fs.mkdirSync(qualifiedDir, { recursive: true });
  currentRun = { dir: workDir, qualifiedDir };

  const tasks = txtFiles.map((file, idx) => ({
    txtFile: file,
    txtPath: path.join(inputDir, file),
    baseName: file.replace('.txt', ''),
    batchNum: String(idx + 1).padStart(3, '0'),
    outputName: `${String(idx + 1).padStart(3, '0')}_${file.replace('.txt', '')}.json`,
  }));

  // 每次生产都是一个独立的新文件夹，因此全部关卡都需要处理（不跳过）。
  const pending = tasks.slice();
  const passedAnalysis = []; // 每关合格时的分析数据（最终数据）
  const auditData = {};      // 审核求解数据.json：{ 合格关卡文件名: {auditTier, solve(最好那遍), score} }

  broadcast({ type: 'init', total: tasks.length, pending: pending.length, tasks: tasks.map(t => ({ name: t.outputName, status: 'pending' })) });

  if (pending.length === 0) { broadcast({ type: 'done', msg: '没有需要处理的关卡' }); return; }

  // 异步逐步执行
  let remaining = pending.slice();
  let round = 0;

  function nextRound() {
    round++;
    if (round > MAX_ROUNDS || remaining.length === 0) {
      // 完成
      finalize(remaining);
      return;
    }

    const diffLevel = round <= 1 ? 1 : round <= 2 ? 2 : round <= 3 ? 3 : 4;
    broadcast({ type: 'round', round, remaining: remaining.length, diffLevel });

    let taskIdx = 0;
    const stillRemaining = [];

    function nextTask() {
      if (taskIdx >= remaining.length) {
        remaining = stillRemaining;
        setTimeout(nextRound, 50);
        return;
      }

      const task = remaining[taskIdx++];
      const mode = task._mode || 'normal';
      const modeLabel = { normal: '常规', pressurize: '加压', relief1: '减压①后移', relief2: '减压②减障碍' }[mode] || mode;
      broadcast({ type: 'task', name: task.outputName, round, status: 'processing', mode: modeLabel });

      // 动态难度平衡：按 task._mode 决定本轮该关的生成档与减压参数
      let genDiffLevel = round <= 1 ? 1 : round <= 2 ? 2 : round <= 3 ? 3 : 4;
      const strategyEnv = {};
      if (mode === 'pressurize') {
        genDiffLevel = 4;
        strategyEnv.STRATEGY_OVERRIDE_PRESET = '1';
      } else if (mode === 'relief1' || mode === 'relief2') {
        genDiffLevel = 1;
        strategyEnv.STRATEGY_OVERRIDE_PRESET = '1';
        strategyEnv.RELIEF_STAGE = (mode === 'relief2') ? '2' : '1';
        strategyEnv.BACK_ROW = '0.5';
        strategyEnv.ICE_BACK_FRACTION = '1.0';
      }
      const roundCats = [];
      const roundEarly = { count: 0, noObs: 0 }; // 本轮"前期峰值前移"失败候选数 / 其中前半区几乎无障碍的数

      let passed = false;
      let candidateIdx = 0;

      function nextCandidate() {
        candidateIdx++;
        if (candidateIdx > CANDIDATES || passed) {
          if (!passed) {
            // 靠色判废：美术图用了靠色，重生成无法修复 → 不放回下一轮，由 finalize 统一输出不合格。
            if (task._closeColorReject) {
              // 不 push 到 stillRemaining，结束该关处理。
            } else {
              // 前期压制·果断放弃：已进入减压(relief)，但本轮"前期峰值前移"的失败候选其前半区都几乎无可减压障碍(冰/链)，
              // 说明前期压力来自目标图/管道窄路而非棋盘障碍 → 不再纠缠，不放回下一轮，直接由 finalize 判不合格。
              const reliefFutile = (mode === 'relief1' || mode === 'relief2') &&
                roundEarly.count > 0 && roundEarly.noObs === roundEarly.count;
              if (reliefFutile) {
                task._giveUpNote = '前半区已无可减压障碍(冰/链)，前期压力源自目标图/管道窄路，减压无效，已提前判不合格';
              } else {
                task._mode = nextStrategyMode(mode, roundCats);
                stillRemaining.push(task);
              }
            }
          }
          broadcast({ type: 'task', name: task.outputName, round, status: passed ? 'passed' : ((task._giveUpNote || task._closeColorReject) ? 'failed_giveup' : 'failed_round') });
          setTimeout(nextTask, 10);
          return;
        }

        // 生成
        const tmpIn = path.join(workDir, '_tmp_in');
        const tmpOut = path.join(workDir, '_tmp_out');
        fs.mkdirSync(tmpIn, { recursive: true });
        fs.mkdirSync(tmpOut, { recursive: true });
        fs.copyFileSync(task.txtPath, path.join(tmpIn, task.txtFile));

        try {
          execSync(
            `"${process.execPath}" tool/scripts/run_batch_txt_node.js noblack "${tmpIn}" "${tmpOut}" json noextra`,
            {
              cwd: GENERATOR_DIR, stdio: 'pipe', timeout: 30000,
              env: {
                ...process.env,
                SINGLE_COLOR_EXTRACT_PERCENT: '5',
                SPOOL_MIN: String(SPOOL_MIN),
                SPOOL_MAX: String(SPOOL_MAX),
                SPOOL_GAP: String(SPOOL_GAP),
                SPOOL_AVG: String(SPOOL_AVG),
                FIRST_ROW_RANGE_MULTIPLIER: '1',
                NEXT_ROW_RANGE_MULTIPLIER: '1.1',
                DIFFICULTY_LEVEL: String(genDiffLevel),
                ...OBS_ENV,
                ...strategyEnv,
              },
            }
          );
        } catch (e) {
          fs.rmSync(tmpIn, { recursive: true, force: true });
          fs.rmSync(tmpOut, { recursive: true, force: true });
          recordFail(task, { hasScore: false, genFail: true });
          broadcast({ type: 'candidate', name: task.outputName, c: candidateIdx, result: '生成失败' });
          setTimeout(nextCandidate, 10);
          return;
        }

        const expectedJson = task.txtFile.replace('.txt', '.json');
        const jsonPath = path.join(tmpOut, expectedJson);
        if (!fs.existsSync(jsonPath)) {
          fs.rmSync(tmpIn, { recursive: true, force: true });
          fs.rmSync(tmpOut, { recursive: true, force: true });
          recordFail(task, { hasScore: false, genFail: true });
          broadcast({ type: 'candidate', name: task.outputName, c: candidateIdx, result: 'JSON未生成' });
          setTimeout(nextCandidate, 10);
          return;
        }

        const levelData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        fs.rmSync(tmpIn, { recursive: true, force: true });
        fs.rmSync(tmpOut, { recursive: true, force: true });

        // 靠色审查（最终审核新增项）：颜色集由美术图(输入txt)决定、候选间不变 →
        // 一旦命中靠色，重生成无法修复，立即判不合格（发现靠色，美术返图修改），不再生成余下候选/轮次。
        if (!task._closeColorReject) {
          const cc = CloseColorAudit.auditLevel(levelData, CLOSE_COLOR_MIN_PIXELS);
          if (cc.hasCloseColor) { cc.levelData = levelData; task._closeColorReject = cc; }
        }
        if (task._closeColorReject) {
          broadcast({ type: 'candidate', name: task.outputName, c: candidateIdx, result: '✗发现靠色' });
          candidateIdx = CANDIDATES; // 触发候选循环结束（不再生成余下候选）
          setTimeout(nextCandidate, 10);
          return;
        }

        // 求解
        const { spools, maprow, mapcol, blocks } = levelData;
        const seedOffset = round * 1000 + candidateIdx * 100;
        let omniResult, playerResult, dsAvg, scoreResult, bestRun;
        try {
          omniResult = Validator.analyzeOptimalSolution(spools, maprow, mapcol, blocks, seedOffset);
          playerResult = Validator.analyzePlayerSolution(spools, maprow, mapcol, blocks, seedOffset + 200000, AUDIT_TIER);
          // dsAvg: 3遍按球平均曲线判合格（稳定）；scoreResult: 最好那遍自洽算难度/曲线/卡点（导出+展示）
          dsAvg = Validator.computeDifficultyScore(playerResult, { omniResult, auditTier: AUDIT_TIER, curveMode: 'avg', allowTrendCompliant: ALLOW_TREND_COMPLIANT });
          bestRun = playerResult.tiers && playerResult.tiers[AUDIT_TIER] && playerResult.tiers[AUDIT_TIER].bestRun;
          scoreResult = bestRun
            ? Validator.computeDifficultyScore(bestRun, { omniResult, auditTier: AUDIT_TIER, allowTrendCompliant: ALLOW_TREND_COMPLIANT })
            : dsAvg;
        } catch (e) {
          recordFail(task, { hasScore: false, genFail: true });
          broadcast({ type: 'candidate', name: task.outputName, c: candidateIdx, result: '求解出错' });
          setTimeout(nextCandidate, 10);
          return;
        }

        const reportScore = buildReportScore(dsAvg, scoreResult); // 报告口径=审核口径(曲线取平均,难度取最好那遍)
        const diff = scoreResult.difficultyStrength;   // 客观难度 = 最好那遍(与难度区间闸门同尺)
        const avgIssue = dsAvg.issueType || '';          // 闸门/失败原因 = 平均口径
        const compliantAvg = dsAvg.compliant === true;   // 合格判定 = 平均曲线
        const omniPass = omniResult && omniResult.completed;
        const tierBase = playerResult.tiers && playerResult.tiers[AUDIT_TIER];
        const tierPass = !!(tierBase && tierBase.completed);
        const inRange = diff >= D_MIN && diff <= D_MAX;
        const isQualified = inRange && compliantAvg && omniPass && tierPass;

        // 输出口径（换球升级成功后会被换球版替换）
        let outLevel = levelData, outReport = reportScore, outBest = bestRun, swapped = false;
        let deadOk = true, deadMsg = '', finalPass = false;

        // [换球造卡点·两遍解 / 路线B] pass-1 无真卡点(含"趋势符合")且可救(难度/全知/该档过、非前期前移)
        // → 换中后期球再审一遍尝试升级出真卡点；升级成功(pass-2 出现真卡点 peakInZone)才用换球版，否则回落 pass-1。
        let upgraded = false;
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
              const ok2 = (diff2 >= D_MIN && diff2 <= D_MAX) && dsAvg2.compliant === true && dsAvg2.peakInZone === true && o2Pass && tb2Pass;
              if (ok2 && new LevelActivityValidator(lv2).validate().success) {
                upgraded = true; finalPass = true; deadOk = true;
                outLevel = lv2; outReport = report2; outBest = bestRun2; swapped = true;
              }
            } catch (e) { /* 第二遍求解出错 → 回落 pass-1 */ }
          }
        }

        // 回落 pass-1：换球未升级 → pass-1 本就合格(真卡点 或 趋势符合[闸门开]) 则死检后输出
        if (!upgraded && isQualified) {
          const dr = new LevelActivityValidator(levelData).validate();
          deadOk = dr.success;
          if (!deadOk) deadMsg = dr.message || '';
          finalPass = deadOk;
        }

        if (finalPass) {
          passed = true;
          outLevel._analysis = buildAnalysis(outReport);
          if (swapped) outLevel._analysis.swapEnhanced = true;
          fs.writeFileSync(path.join(qualifiedDir, task.outputName), JSON.stringify(outLevel, null, 2) + '\n', 'utf8');
          copySourceTxt(task.txtPath, qualifiedDir, task.outputName);
          // 审核求解数据：把"最好那遍"解法 + 审核口径结论按合格关卡文件名记下，供网页直接复用
          if (outBest) {
            auditData[task.outputName] = { auditTier: AUDIT_TIER, solve: pickSolve(outBest), score: outReport };
          }
          // 保存这一关合格时的分析数据（=审核口径，就是最终数据，不再重跑）
          passedAnalysis.push({
            name: task.outputName,
            difficulty: outReport.difficultyStrength,
            tier: outReport.difficultyTier,
            quality: outReport.curveQuality || '-',
            peakBand: outReport.peakBand || '-',
            peakInZone: outReport.peakInZone,
            zoneAvgBuf: outReport.zoneAvgBuf,
            zoneAvgRes: outReport.zoneAvgRes,
            earlyAvgBuf: outReport.earlyAvgBuf,
            earlyAvgRes: outReport.earlyAvgRes,
            issueType: outReport.issueType || '-',
            tierClearNote: outReport.tierClearNote || '全部通关',
            artNote: outReport.artNote || '',
            swapped,
            round, candidate: candidateIdx,
          });
        } else {
          // 归类失败原因（按平均口径闸门原因，供动态难度平衡决定下一轮策略）
          let failCat = 'other';
          if (avgIssue === '前期峰值前移') failCat = 'early';
          else if (avgIssue === '过于简单' || dsAvg.curveQuality === '异常(过于简单)') failCat = 'tooSimple';
          else if (!inRange && diff < D_MIN) failCat = 'tooSimple';
          roundCats.push(failCat);
          if (failCat === 'early') {
            roundEarly.count++;
            if (countFrontObstacles(levelData) <= FRONT_OBSTACLE_GIVEUP_MAX) roundEarly.noObs++;
          }
          // 未通过：记录这个候选的 4 套标准达成情况 + 卡死状态，供最终写明不合格理由
          recordFail(task, {
            hasScore: true,
            diff,
            difficultyOK: inRange,
            compliant: compliantAvg,
            omniPass: !!omniPass,
            tierPass: tierPass,
            gatesPass: isQualified,
            deadOk,
            deadMsg,
            issueType: avgIssue,
            quality: reportScore.curveQuality,
            artNote: reportScore.artNote,
            levelData,
            scoreResult,
            reportScore,
            bestRun,
          });
        }

        broadcast({
          type: 'candidate', name: task.outputName, c: candidateIdx,
          result: finalPass ? (swapped ? '✓合格(换球)' : '✓合格') : '✗不合格',
          difficulty: outReport.difficultyStrength, quality: outReport.curveQuality || '-',
          issue: avgIssue, omniPass, tierPass, deadOk,
        });

        setTimeout(nextCandidate, 10);
      }

      nextCandidate();
    }

    nextTask();
  }

  nextRound();

  function finalize(failedTasks) {
    // 直接用每关合格时保存的分析数据输出（不再重跑分析）
    broadcast({ type: 'phase', msg: '输出报告...' });

    // 批量分析结果CSV（用合格时那一刻的数据）
    if (passedAnalysis.length > 0) {
      const lines = [
        '排名,关卡名,难度强度,难度档,曲线质量,卡点区间,卡点达标,目标区平均暂存,目标区平均滞留,' +
        '前期平均暂存,前期平均滞留,问题类型,各档通关情况,调整建议(美术),命中轮次,命中候选'
      ];
      const sorted = passedAnalysis.slice().sort((a, b) => b.difficulty - a.difficulty);
      sorted.forEach((item, idx) => {
        lines.push([
          idx + 1,
          item.name.replace('.json', ''),
          item.difficulty,
          item.tier,
          item.quality,
          item.peakBand,
          item.peakInZone ? '是' : '否',
          typeof item.zoneAvgBuf === 'number' ? item.zoneAvgBuf.toFixed(2) : '-',
          typeof item.zoneAvgRes === 'number' ? item.zoneAvgRes.toFixed(2) : '-',
          typeof item.earlyAvgBuf === 'number' ? item.earlyAvgBuf.toFixed(2) : '-',
          typeof item.earlyAvgRes === 'number' ? item.earlyAvgRes.toFixed(2) : '-',
          item.issueType,
          '"' + item.tierClearNote + '"',
          '"' + item.artNote + '"',
          item.round,
          item.candidate
        ].join(','));
      });
      fs.writeFileSync(path.join(qualifiedDir, '批量分析结果.csv'), lines.join('\n') + '\n', 'utf8');
    }

    // ===== 审核求解数据.json：网页可直接复用的"最好那遍"解法+审核结论（按合格关卡文件名索引）=====
    if (Object.keys(auditData).length > 0) {
      fs.writeFileSync(path.join(qualifiedDir, '审核求解数据.json'), JSON.stringify(auditData) + '\n', 'utf8');
    }

    // 生产汇总报告
    const reportLines = ['关卡名,最终状态,难度,曲线质量,命中轮次,备注'];
    for (const p of passedAnalysis) {
      reportLines.push(`${p.name},合格,${p.difficulty},${p.quality},${p.round},`);
    }
    for (const t of tasks) {
      if (!passedAnalysis.find(p => p.name === t.outputName)) {
        // 靠色判废：原因固定为「发现靠色，美术返图修改」，统一输出不合格关卡(内嵌标注)+对齐原图txt+报告备注。
        if (t._closeColorReject) {
          const cc = t._closeColorReject;
          const failDir = path.join(workDir, '不合格关卡');
          const ccReason = CloseColorAudit.writeReject(failDir, t.outputName, t.txtPath, cc);
          reportLines.push([
            t.outputName, '不合格/需美术返图', '-', '-', '-',
            '"' + String(ccReason).replace(/"/g, '""') + '"'
          ].join(','));
          continue;
        }
        const bf = t._bestFail;
        const baseReason = buildFailReason(bf, D_MIN, D_MAX) + (t._giveUpNote ? '；' + t._giveUpNote : '');
        let savedNote = '';
        let q = '-';
        if (bf && bf.hasScore && bf.levelData) {
          const failDir = path.join(workDir, '不合格关卡');
          fs.mkdirSync(failDir, { recursive: true });
          const deadlock = bf.deadOk === false;
          // 不合格 JSON 内嵌问题标注（关卡文件自描述问题），并复制对应输入 txt 原图，便于美术按名返图
          bf.levelData._analysis = buildRejectAnalysis(bf.reportScore, baseReason, { deadlock, deadMessage: bf.deadMsg });
          fs.writeFileSync(path.join(failDir, t.outputName), JSON.stringify(bf.levelData, null, 2) + '\n', 'utf8');
          copySourceTxt(t.txtPath, failDir, t.outputName);
          q = bf.reportScore ? (bf.reportScore.curveQuality || '-') : '-';
          savedNote = '（已输出不合格关卡+原图txt到 不合格关卡/）';
        }
        const reason = baseReason + savedNote;
        reportLines.push([
          t.outputName, '不合格/需美术返图', (bf && bf.hasScore ? bf.diff : '-'), q, '-',
          '"' + String(reason).replace(/"/g, '""') + '"'
        ].join(','));
      }
    }
    fs.writeFileSync(path.join(qualifiedDir, '生产汇总报告.csv'), reportLines.join('\n') + '\n', 'utf8');

    const passCount = passedAnalysis.length;
    const failCount = tasks.length - passCount;

    // ===== 把本次所有产物统一打包重命名为「日期-N关」 =====
    let outFolderName = path.basename(workDir);
    try {
      const finalDir = uniqueRunDir(dateStamp(), passCount);
      fs.renameSync(workDir, finalDir);
      outFolderName = path.basename(finalDir);
      // 更新当前运行目录，使完成后的下载/列表指向重命名后的位置
      currentRun = {
        dir: finalDir,
        qualifiedDir: path.join(finalDir, '合格关卡'),
      };
    } catch (e) {
      broadcast({ type: 'phase', msg: '输出目录重命名失败，结果保留在临时目录：' + outFolderName });
    }

    broadcast({
      type: 'done',
      results: tasks.map(t => {
        const p = passedAnalysis.find(x => x.name === t.outputName);
        return { name: t.outputName, status: p ? '合格' : '不合格/需美术返图', difficulty: p ? p.difficulty : '-', quality: p ? p.quality : '-' };
      }),
      passed: passCount,
      failed: failCount,
      outputFolder: outFolderName
    });

    console.log(`\n=== 完成 === 合格: ${passCount}/${tasks.length} | 不合格: ${failCount}`);
    console.log(`输出: ${outFolderName}/（含 合格关卡/ 与 不合格关卡/，所有产物已统一打包）`);
  }
}

// ===== 启动 =====
console.log('加载求解器...');
loadSolver();
console.log('加载卡死检验器...');
loadDeadChecker();

server.listen(PORT, () => {
  console.log(`\n服务已启动: http://localhost:${PORT}\n`);
  // macOS 自动打开浏览器
  // 当由编排脚本(orchestrator.js)以 LAUNCHER_NO_AUTO_OPEN=1 启动时，跳过自行打开，
  // 由编排脚本统一负责跨平台打开浏览器，避免 mac 上重复打开。
  if (!process.env.LAUNCHER_NO_AUTO_OPEN) {
    exec(`open http://localhost:${PORT}`);
  }
});

// 端口被占用等监听错误：给出清晰的中文提示后退出，
// 避免抛出未捕获异常导致用户只看到一堆英文堆栈。
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用，无法启动后端。`);
    console.error('原因：通常是上一次启动的服务没有关闭，或有其它程序正在使用该端口。');
    console.error('解决：请关闭已经打开的本工具窗口/浏览器标签，或结束占用端口的程序，然后重新双击启动入口。\n');
  } else {
    console.error(`\n后端启动失败：${err && err.message ? err.message : String(err)}\n`);
  }
  process.exit(1);
});
