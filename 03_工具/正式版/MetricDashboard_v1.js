#!/usr/bin/env node
'use strict';
/**
 * MetricDashboard_v1 —— 关卡指标可视化（本地 Node 服务 + 浏览器仪表盘）
 *
 * 用法：
 *   node 03_工具/正式版/MetricDashboard_v1.js [--port 8070]
 *   浏览器打开 http://127.0.0.1:8070
 *
 * 导入关卡 JSON 后，调用现有工具：
 *   ArlCheck / ClickSettlePolicyCheck / ChoiceSpaceCheck / RouteTimeline(freefirst|solver)
 * 返回指标卡 + 两条路线的时间线（M/C/F/D、buffer、每步选项后果）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TOOLS = path.join(ROOT, '03_工具', '正式版');
const STATIC = path.join(TOOLS, 'dashboard');
const PORT = Number((() => { const i = process.argv.indexOf('--port'); return i > 0 ? process.argv[i + 1] : 8070; })()) || 8070;
const CACHE = path.join('/tmp', 'metric_dashboard_cache');
const CACHE_VERSION = 'v1.1';
fs.mkdirSync(CACHE, { recursive: true });
const EXAMPLES = [
  { name: 'G2 L2（原）', path: '/Users/red/Desktop/拟导入的关卡/总关卡/分组2/G2_bq_level_2.json' },
  { name: 'G3A L2（温和）', path: path.join(ROOT, '实验关/产线v3/G3/3A_温和/G2_bq_level_2.json') },
  { name: 'G3B L2（激进）', path: path.join(ROOT, '实验关/产线v3/G3/3B_激进/G2_bq_level_2.json') }
];
const ALLOW_PREFIX = [ROOT, '/Users/red/Desktop/拟导入的关卡'];
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const clone = x => JSON.parse(JSON.stringify(x));

function run(tool, args, timeout) {
  const r = spawnSync(process.execPath, [path.join(TOOLS, tool), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: timeout || 300000, maxBuffer: 64 * 1024 * 1024
  });
  return { out: (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : ''), status: r.status, error: r.error };
}
const num = (re, out) => { const m = re.exec(out); return m ? Number(m[1]) : -1; };
function parseArl(out) {
  const can = /可通关（最小路线）[\s\S]{0,60}?([✓✗])/.exec(out);
  return {
    pass: /→\s*通过/.test(out) && !/→\s*不通过/.test(out),
    peak: num(/峰值=4\s+(\d+)/, out), mid: num(/玩家中段 45–80%\s+\d+ 步（占比 (\d+)%）/, out),
    tol: num(/容错 55–75%\s+(\d+)\/20/, out), open: num(/开局可点≥5\s+(\d+)/, out),
    at4: num(/at4≥5\s+(\d+)/, out), canPass: can ? can[1] : '?'
  };
}
function parsePolicy(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')); const r = (j.rows || [])[0] || {};
    return {
      policy0: !!r.policy0, policy2: !!r.policy2,
      win0: (r.results || []).filter(x => x.cap === 0 && x.won).map(x => x.strategy),
      freeFirst0: (r.results || []).some(x => x.cap === 0 && x.won && x.strategy === 'free-first')
    };
  } catch (e) { return { error: String(e.message || e) }; }
}
function parseChoice(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')); const r = (j.rows || [])[0] || {};
    return { M: r.avgM, H: r.avgEntropy, fake: r.fakeChoiceSteps, forced: r.forcedSteps };
  } catch (e) { return { error: String(e.message || e) }; }
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function difficulty(arl, ffSummary, choice) {
  const C0 = Number(ffSummary.c0AtBufLt5 || 0), F0 = Number(ffSummary.f0AtBuf3 || 0);
  const openM = Number(ffSummary.openM || 0);
  const M = Number(choice.M || 0), H = Number(choice.H || 0);
  const s = {
    C0: clamp(C0 / 2, 0, 1), F0: clamp(F0 / 4, 0, 1),
    M: clamp((8 - M) / 5, 0, 1), H: clamp((1.5 - H) / 0.5, 0, 1),
    open: clamp((6 - openM) / 3, 0, 1), tol: clamp((18 - arl.tol) / 16, 0, 1),
    midH: clamp((arl.mid - 70) / 20, 0, 1)
  };
  let d = 100 * (0.25 * s.C0 + 0.20 * s.F0 + 0.15 * s.M + 0.20 * s.H + 0.05 * s.open + 0.10 * s.tol + 0.05 * s.midH);
  const pen = [];
  if (arl.canPass !== '✓') { d += 20; pen.push('can✗+20'); }
  if (arl.peak <= 2 && arl.mid >= 70) { d += 15; pen.push('flatLong+15'); }
  if (arl.mid >= 80) { d += 15; pen.push('mid>=80+15'); }
  d = clamp(d, 0, 100);
  return { D: +d.toFixed(1), band: d >= 60 ? 'hard' : d >= 40 ? 'mid-hard' : d >= 20 ? 'mid-easy' : 'easy', penalties: pen };
}
function paletteFor(blocks) {
  const used = new Set();
  for (const row of blocks) for (const v of row) if (v > 0) used.add(v);
  const out = {};
  for (const id of used) { const c = A.COLORS[id]; out[id] = c ? { name: c.name, hex: c.hex } : { name: '色' + id, hex: '#999999' }; }
  return out;
}

function analyze(name, content) {
  const hash = crypto.createHash('sha256').update(content + '|' + CACHE_VERSION).digest('hex').slice(0, 16);
  const levelFile = path.join(CACHE, hash + '.json');
  const cacheFile = path.join(CACHE, hash + '.dashboard.json');
  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); cached.name = name; return cached;
  }
  let g; try { g = JSON.parse(content); } catch (e) { return { ok: false, error: '不是 JSON：' + e.message }; }
  if (!g || !Array.isArray(g.blocks) || !Array.isArray(g.spools)) return { ok: false, error: '不是关卡 JSON（缺 blocks/spools）' };
  fs.writeFileSync(levelFile, content);
  const arl = parseArl(run('ArlCheck_v793.js', [levelFile]).out);
  const policyFile = path.join(CACHE, hash + '.policy.json');
  run('ClickSettlePolicyCheck_v1.js', [levelFile, '--out', policyFile]);
  const policy = parsePolicy(policyFile);
  const choiceFile = path.join(CACHE, hash + '.choice.json');
  run('ChoiceSpaceCheck_v1.js', [levelFile, '--out', choiceFile]);
  const choice = parseChoice(choiceFile);
  const ffFile = path.join(CACHE, hash + '.ff.json');
  const solFile = path.join(CACHE, hash + '.solver.json');
  run('RouteTimeline_v1.js', [levelFile, '--mode', 'freefirst', '--out', ffFile]);
  run('RouteTimeline_v1.js', [levelFile, '--mode', 'solver', '--out', solFile]);
  let ff = null, solver = null;
  try { ff = JSON.parse(fs.readFileSync(ffFile, 'utf8')); } catch (e) { }
  try { solver = JSON.parse(fs.readFileSync(solFile, 'utf8')); } catch (e) { }
  const ffSummary = ff ? ff.summary : {};
  ffSummary.openM = ff && ff.timeline && ff.timeline[0] ? ff.timeline[0].M : null;
  const diff = difficulty(arl, ffSummary, choice);
  const result = {
    ok: true, id: hash, name,
    level: { toprow: g.toprow, maprow: g.maprow, mapcol: g.mapcol, blocks: g.blocks, spools: g.spools },
    palette: paletteFor(g.blocks),
    metrics: { arl, policy, choice, difficulty: diff },
    routes: { freefirst: ff, solver }
  };
  fs.writeFileSync(cacheFile, JSON.stringify(result));
  return result;
}

function serveStatic(req, res) {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = path.join(STATIC, p.replace(/^\/+/, ''));
  if (!file.startsWith(STATIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  const ext = path.extname(file);
  const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'application/javascript; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
}
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/api/examples')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(EXAMPLES));
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/api/analyze-path')) {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      const p = u.searchParams.get('path') || '';
      const ok = ALLOW_PREFIX.some(pre => p.startsWith(pre));
      if (!ok || !p.endsWith('.json') || !fs.existsSync(p)) throw new Error('路径不允许或不存在：' + p);
      const content = fs.readFileSync(p, 'utf8');
      const ex = EXAMPLES.find(e => e.path === p);
      const r = analyze(ex ? ex.name : path.basename(p), content);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(r));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return;
  }
  if (req.method === 'GET') return serveStatic(req, res);
  if (req.method === 'POST' && req.url === '/api/analyze') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const r = analyze(j.name || '未命名', j.content || '');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(r));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('MetricDashboard: http://127.0.0.1:' + PORT);
  console.log('static: ' + STATIC);
});
