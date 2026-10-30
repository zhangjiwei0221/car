'use strict';
/**
 * 求解器本地服务.js —「大像素毛线 JSON 关卡求解器」的零依赖本地静态服务
 *
 * 仅用 Node 内置模块（http + fs + path），把本文件所在目录作为站点根，
 * 供浏览器通过 http://localhost:<PORT>/ 访问 index.html。
 *
 * 由「启动求解器_Mac.command / 启动求解器_Windows.bat」拉起（启动器会先释放端口
 * 再启动本服务，实现"重置本地服务资源"）；也可单独运行：node 求解器本地服务.js
 *
 * 端口：默认 8910，可用环境变量 SOLVER_PORT 覆盖。关闭运行窗口即停止服务。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.env.SOLVER_PORT || '8910', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  } catch (e) {
    pathname = '/';
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  // 防目录穿越：规整后必须仍在站点根目录内
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n✘ 端口 ${PORT} 已被占用，本地服务无法启动。`);
    console.error('  请双击「启动求解器_Mac.command」(或 Windows 的「启动求解器_Windows.bat」)，');
    console.error(`  它会先释放端口 ${PORT} 再启动；或手动结束占用该端口的进程后重试。`);
  } else {
    console.error('\n✘ 本地服务启动失败：', err && err.message ? err.message : err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`求解器本地服务已启动：http://localhost:${PORT}/`);
  console.log('关闭本窗口即停止服务。');
});
