/**
 * Stack Sort 关卡调制平台 - 极简本地静态服务器（零依赖，仅用 Node 内置模块）
 *
 * 作用：把当前求解器目录作为静态站点，绑定本机 127.0.0.1 + 系统自动分配的空闲端口，
 *       启动后自动用默认浏览器打开 index.html。
 *
 * 为什么用本地服务器（而非直接双击 index.html）：
 *   - 浏览器的 File System Access API（方案文件「自动写回」）只在 http://localhost / 127.0.0.1
 *     这种 secure context 下可用，file:// 下不可用。
 *   - 每次启动都是一个【全新进程 = 全新内存】，历史记忆资源不会累积 → 天然解决「资源爆」。
 *
 * 安全：只监听 127.0.0.1（仅本机可访问），并限制只能读取本目录内的文件（防路径穿越）。
 * 用法：node server.js          （启动并自动打开浏览器）
 *       node server.js --no-open （只启动，不打开浏览器，便于自检）
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;

var ROOT = __dirname;
var HOST = '127.0.0.1';
var OPEN_BROWSER = process.argv.indexOf('--no-open') === -1;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    // 禁用浏览器缓存：每次都拿最新文件，避免改了代码却加载到旧缓存
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  res.end(body);
}

var server = http.createServer(function (req, res) {
  var pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://' + HOST).pathname || '/');
  } catch (e) {
    return send(res, 400, '400 Bad Request');
  }
  if (pathname === '/') pathname = '/index.html';

  // 防路径穿越：规范化后必须仍在 ROOT 内
  var filePath = path.join(ROOT, path.normalize(pathname));
  if (filePath !== ROOT && filePath.indexOf(ROOT + path.sep) !== 0) {
    return send(res, 403, '403 Forbidden');
  }

  fs.stat(filePath, function (err, st) {
    if (err || !st.isFile()) return send(res, 404, '404 Not Found: ' + pathname);
    var ext = path.extname(filePath).toLowerCase();
    var type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    var stream = fs.createReadStream(filePath);
    stream.on('error', function () { send(res, 500, '500 Internal Server Error'); });
    stream.pipe(res);
  });
});

// 端口 0 = 让系统自动分配一个空闲端口，永不冲突
server.listen(0, HOST, function () {
  var port = server.address().port;
  var addr = 'http://' + HOST + ':' + port + '/index.html';
  console.log('========================================');
  console.log('  Stack Sort 关卡调制平台 已启动');
  console.log('  地址: ' + addr);
  console.log('  保持本窗口开启 = 服务器运行中');
  console.log('  关闭本窗口 / 按 Ctrl+C = 停止服务器');
  console.log('========================================');
  if (OPEN_BROWSER) {
    // macOS 用 open 命令拉起默认浏览器
    exec('open "' + addr + '"', function (e) {
      if (e) console.log('（自动打开浏览器失败，请手动复制上面的地址到浏览器）');
    });
  }
});

server.on('error', function (e) {
  console.error('服务器启动失败：' + (e && e.message || e));
  process.exit(1);
});
