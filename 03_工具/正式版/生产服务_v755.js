#!/usr/bin/env node
'use strict';
/**
 * 生产服务_v755 —— 本地关造服务（给网页用）
 * 用法：node 03_工具/正式版/生产服务_v755.js [--port 8061]
 * 打开 http://127.0.0.1:8061/  → 上传/选择目标图 → 生成 → 看指标 → 试玩
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const PORT = Number((() => { const i = process.argv.indexOf('--port'); return i > 0 ? process.argv[i + 1] : 8061; })());
const jobs = new Map(); let seq = 0;

function json(res, obj, code = 200) { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(b); }
function readBody(req) { return new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); }); }

function startJob(name, content, tier, layer) {
  const id = ++seq;
  const job = { id, name, log: '', result: null, running: true, t0: Date.now() };
  jobs.set(id, job);
  let target = name;
  if (content && String(content).trim()) {
    const tmp = path.join('关卡', '_上传_' + Date.now() + '.txt');
    fs.writeFileSync(path.join(ROOT, tmp), content);
    target = tmp;
  }
  const args = ['03_工具/正式版/_ProduceOne_v747.js', '--target', target, '--outdir', '输出/网页批次/' + id, '--tier', tier || 'std'];
  if (layer) args.push('--layer', '--contract', '输出/契约_默认.json');
  const ch = spawn(process.execPath, args, { cwd: ROOT });
  ch.stdout.on('data', d => { job.log += d.toString(); });
  ch.stderr.on('data', d => { job.log += d.toString(); });
  ch.on('close', () => {
    job.running = false;
    const line = job.log.split('\n').filter(l => l.startsWith('RESULT ')).pop();
    if (line) { try { job.result = JSON.parse(line.slice(7)); } catch (e) {} }
  });
  return id;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/files') {
    const list = fs.readdirSync(path.join(ROOT, '关卡')).filter(f => f.endsWith('.txt')).slice(0, 300);
    return json(res, list);
  }
  if (u.pathname === '/api/produce' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}');
    const id = startJob(body.name || '', body.content || '', body.tier || 'std', !!body.layer);
    return json(res, { id });
  }
  if (u.pathname === '/api/job') {
    const j = jobs.get(Number(u.searchParams.get('id')));
    if (!j) return json(res, { error: 'no such job' }, 404);
    return json(res, { running: j.running, log: j.log.slice(-4000), result: j.result, seconds: Math.round((Date.now() - j.t0) / 1000) });
  }
  if (u.pathname === '/api/level') {
    const p = path.join(ROOT, u.searchParams.get('path') || '');
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) return json(res, { error: 'not found' }, 404);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(fs.readFileSync(p));
  }
  // 静态页
  const html = path.join(__dirname, 'producer.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(html));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`生产服务已启动：http://127.0.0.1:${PORT}/`);
});
