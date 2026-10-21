#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
蚂蚁拿块 · 无缓存静态服务（替代 python -m http.server）

目的：Safari/浏览器会缓存旧的 js/html。改了正式代码或引擎副本后不清缓存，就会加载到旧版本，
      表现为「功能突然失效」。本服务等价于「每次加载前清历史缓存」，做两件事：
  ① 所有响应带强不缓存头：Cache-Control: no-store, no-cache, must-revalidate, max-age=0
     + Pragma: no-cache + Expires: 0，且【不发 Last-Modified/ETag】→ 浏览器无法走 304，必须重新拉全量；
  ② 对 .html 页面，把本地 <script src="js/x.js"> / <link href="x.css"> 自动加上 ?v=<本次启动令牌>，
     不同令牌 = 不同 URL → 直接绕开浏览器里已存在的旧缓存条目（Safari 对 no-store 有历史 bug，靠这层兜底）。

用法：python3 无缓存静态服务.py <port>   （服务根 = 当前工作目录，与 python -m http.server 一致）
"""
import sys, os, re, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
TOKEN = str(int(time.time()))   # 每次启动唯一 → 强制所有本地脚本/样式 URL 变化

# 给 html 里的本地 js/css 引用设为单一的 ?v=TOKEN（剥掉页面里已写死的旧 ?v=；跳过 http(s)://、//、data:）
_SRC = re.compile(r'((?:src|href)\s*=\s*")(?!https?://|//|data:)([^"?#]+\.(?:js|css))(?:\?[^"#]*)?(["#])', re.I)
def bust_html(text):
    return _SRC.sub(lambda m: m.group(1) + m.group(2) + '?v=' + TOKEN + m.group(3), text)

class NoCacheHandler(SimpleHTTPRequestHandler):
    def send_header(self, key, value):
        if key.lower() == 'last-modified':
            return                      # 不发 Last-Modified → 浏览器无法用 If-Modified-Since 走 304
        super().send_header(key, value)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            idx = os.path.join(path, 'index.html')
            if os.path.exists(idx):
                path = idx
        if path.lower().endswith('.html') and os.path.isfile(path):
            try:
                with open(path, 'rb') as f:
                    body = bust_html(f.read().decode('utf-8')).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception:
                pass   # 出问题退回默认处理，不影响可用性
        return super().do_GET()

    def log_message(self, fmt, *args):
        pass   # 静音访问日志

if __name__ == '__main__':
    httpd = ThreadingHTTPServer(('127.0.0.1', PORT), NoCacheHandler)
    print('  无缓存服务已启动（本次缓存令牌 v=%s）' % TOKEN)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
