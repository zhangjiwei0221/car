#!/bin/bash
# 蚂蚁拿块关卡图修改工具 · 一键启动
# 2026-10-28 起本工具只做图纸修改/提取/拼接，不再需要求解器与生成器流程。
# 依赖仅剩本目录 bin/js/utils.js（颜色表）与 bin/js/generator.js（TXT 解析 / 碎色口径）。
#
# 起本地服务的目的：让图纸库的 localStorage 固定在同一 origin 上，并避免 file:// 下
# 浏览器对本地文件/下载的限制。直接用浏览器打开 index.html 也能用。
#
# 双击本文件即可：会在本工具目录起服务并自动打开页面。按 Ctrl+C 停止。

set -u
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

if [ ! -f "bin/js/utils.js" ] || [ ! -f "bin/js/generator.js" ]; then
  echo "❌ 找不到 bin/js/utils.js 或 bin/js/generator.js。"
  echo "   本工具只用这两份做颜色表、TXT 解析和碎色率，不需要求解器。"
  echo "   如果目录缺失，请从项目根目录重新拷一份 bin/js/ 下的 utils.js、generator.js。"
  echo "   当前工具目录推断为：$ROOT"
  read -r -p "按回车关闭…" _
  exit 1
fi

PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
  echo "❌ 未找到 python3。请安装后重试，或直接用浏览器打开本目录的 index.html。"
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
echo " 图纸依赖：  本目录 bin/js/utils.js + generator.js（颜色表 / TXT 解析 / 碎色率）"
echo " 不加载：    求解器、模拟器、PlayerSim、生成器流程"
echo " 访问地址：  $URL"
echo " 停止服务：  在本窗口按 Ctrl+C"
echo "==============================================="
echo ""

# 优先用 Chrome 打开（Safari 对 localhost:端口 有顽固缓存，导入功能会加载到旧版本）；没装 Chrome 则回退默认浏览器
( sleep 1; open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL" ) &
# 无缓存静态服务：每次加载强制不走缓存 + 给本地 js/css 注入启动令牌 ?v=，避免加载旧版本
exec "$PY" "无缓存静态服务.py" "$PORT"
