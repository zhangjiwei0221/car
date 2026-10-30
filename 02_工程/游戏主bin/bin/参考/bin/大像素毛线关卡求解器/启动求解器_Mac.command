#!/bin/bash
# =============================================================================
# 启动求解器_Mac.command — 一键启动「大像素毛线 JSON 关卡求解器」(重置资源)
#
# 用途：关卡库导入过多导致页面内存卡顿/卡爆时，双击本文件一键"重置并启动"：
#   ① 释放本地服务端口（结束上次残留的服务进程）—— 重置本地服务资源
#   ② 启动零依赖本地静态服务（求解器本地服务.js）
#   ③ 用独立浏览器用户目录打开一个全新实例，避免旧标签页/旧浏览器进程继续占用内存
#
# 没装 Node 时回退为直接用浏览器打开 index.html（file:// 模式）。
# 关闭本终端窗口即停止本地服务。
# =============================================================================

cd "$(dirname "$0")" || {
  echo "无法定位求解器目录。"
  read -n1 -r -p "（按任意键关闭本窗口）"
  exit 1
}

PORT="${SOLVER_PORT:-8910}"
TS="$(date +%s)"

echo "=================================================="
echo "  大像素毛线 JSON 关卡求解器 · 重置并启动"
echo "=================================================="
echo

if command -v node >/dev/null 2>&1; then
  # ① 释放本地服务端口（结束残留进程）
  echo "▶ [1/3] 释放本地服务端口 ${PORT} ……"
  PIDS="$(lsof -ti tcp:${PORT} 2>/dev/null)"
  if [ -n "$PIDS" ]; then
    echo "    发现占用端口的进程：${PIDS}，正在结束……"
    kill ${PIDS} 2>/dev/null
    sleep 1
    PIDS2="$(lsof -ti tcp:${PORT} 2>/dev/null)"
    if [ -n "$PIDS2" ]; then
      kill -9 ${PIDS2} 2>/dev/null
      sleep 1
    fi
    echo "    ✔ 端口 ${PORT} 已释放"
  else
    echo "    端口 ${PORT} 未被占用"
  fi
  echo

  # ② 延时打开浏览器（等服务起来），用独立 Chrome 用户目录强制干净实例
  echo "▶ [2/3] 打开浏览器（独立干净实例）……"
  URL="http://localhost:${PORT}/?fresh=${TS}"
  PROFILE_DIR="/tmp/yarn-solver-chrome-profile-${TS}"
  if [ -d "/Applications/Google Chrome.app" ]; then
    ( sleep 1; open -na "Google Chrome" --args --user-data-dir="${PROFILE_DIR}" --no-first-run --new-window "${URL}" >/dev/null 2>&1 ) &
    echo "    使用独立 Chrome 用户目录：${PROFILE_DIR}"
  else
    ( sleep 1; open "${URL}" >/dev/null 2>&1 ) &
    echo "    未找到 Google Chrome，改用系统默认浏览器打开"
  fi
  echo "    ${URL}"
  echo "    提示：本次会使用独立浏览器实例；旧标签页即使卡住也不会污染新实例。"
  echo

  # ③ 前台启动本地静态服务（关闭本窗口即停止）
  echo "▶ [3/3] 启动本地静态服务（请勿关闭本窗口，关闭即停止服务）……"
  echo
  SOLVER_PORT="${PORT}" node "求解器本地服务.js"

  echo
  read -n1 -r -p "（服务已停止，按任意键关闭本窗口）"
  echo
else
  echo "未检测到 Node.js，改为直接用浏览器打开（file:// 模式）。"
  echo "提示：file:// 模式下建议先关掉旧标签页再打开，避免内存累积卡顿。"
  echo
  open "index.html"
  echo "已用浏览器打开 index.html，本窗口可关闭。"
fi
