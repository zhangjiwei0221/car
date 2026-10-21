#!/bin/bash
# 蚂蚁拿块关卡图修改工具 · 一键启动
# 任务：ANT-ARTTOOL-CLASSIFY-20260729 · 阶段3
# 2026-08-03 改为「工具目录自成一体」：求解器与生成器改用本目录下的 bin/js/（随工具打包的副本），
#   服务根目录从项目根改为本工具目录，这样整个「关卡图修改工具」文件夹可以直接拷到别处使用。
#
# 为什么要起本地服务：求解跑在 Web Worker 里，浏览器在 file:// 协议下会拦截 Worker 的 importScripts，
#   起一个静态服务再访问才能用上后台线程（不起服务也能用，但求解时页面会卡住）。
#
# 双击本文件即可：会在本工具目录起服务并自动打开页面。按 Ctrl+C 停止。

set -u
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

if [ ! -f "bin/js/solver.js" ]; then
  echo "❌ 找不到 bin/js/solver.js。"
  echo "   本工具需要自带的 bin/ 目录（求解器与生成器）。"
  echo "   如果这个目录缺失，请从项目根目录重新拷一份 bin/（js、css、index.html、文档）到本工具目录下。"
  echo "   当前工具目录推断为：$ROOT"
  read -r -p "按回车关闭…" _
  exit 1
fi

PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
  echo "❌ 未找到 python3。请安装后重试，或直接用浏览器打开本目录的 index.html（求解时页面会卡住）。"
  read -r -p "按回车关闭…" _
  exit 1
fi

# 每次启动随机挑一个空闲端口：端口变→localhost:端口 这个 origin 变→Safari 上旧端口的缓存碰不到（等于每次都在干净端口上跑）
BASE=8765; SPAN=36   # 8765..8800
PORT=$(( BASE + RANDOM % SPAN ))
tries=0
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$(( BASE + (PORT - BASE + 1) % SPAN ))
  tries=$((tries + 1))
  if [ "$tries" -ge "$SPAN" ]; then echo "❌ 8765-8800 端口都被占用"; read -r -p "按回车关闭…" _; exit 1; fi
done

URL="http://127.0.0.1:$PORT/index.html?v=$(date +%s)"   # 入口 URL 带启动时间戳：顶层文档每次也 cache miss（Safari 端口缓存兜底）

echo "==============================================="
echo " 蚂蚁拿块关卡图修改工具"
echo "-----------------------------------------------"
echo " 工具目录：  $ROOT"
echo " 求解器来源：本目录 bin/js/（正式代码的副本，可随文件夹整体迁移）"
echo "             正式来源仍是项目根目录的 bin/，同步方式见 bin/来源说明.md"
echo " 访问地址：  $URL"
echo " 停止服务：  在本窗口按 Ctrl+C"
echo "==============================================="
echo ""

# 优先用 Chrome 打开（Safari 对 localhost:端口 有顽固缓存，导入功能会加载到旧版本）；没装 Chrome 则回退默认浏览器
( sleep 1; open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL" ) &
# 无缓存静态服务：每次加载强制不走缓存 + 给本地 js/css 注入启动令牌 ?v=，避免加载旧版本
exec "$PY" "无缓存静态服务.py" "$PORT"
