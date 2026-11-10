#!/usr/bin/env node
'use strict';
/**
 * 项目根静态服务（仅供本地预览编辑器 / 实验关卡）
 * 用法：node .claude/editor_static.js [port]
 * 默认 8082，只监听 127.0.0.1；根目录 = 项目根。
 * 编辑器地址：http://127.0.0.1:8082/02_工程/游戏主bin/bin/index.html
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.EDITOR_PREVIEW_PORT || 8082);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT)) { res.statusCode = 403; return res.end('forbidden'); }
  fs.readFile(f, (e, d) => {
    if (e) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream');
    res.end(d);
  });
}).listen(PORT, '127.0.0.1', () => console.log('editor static ' + PORT + ' root=' + ROOT));
