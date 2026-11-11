#!/bin/bash
# 一键打开关卡指标仪表盘（MetricDashboard）
# 双击运行：已在跑就只开浏览器；没跑就先起服务，等就绪后自动打开。
# 可选参数：端口，默认 8070。例：./一键打开指标仪表盘.command 8071
cd "$(dirname "$0")/.." || exit 1
PORT="${1:-8070}"
URL="http://127.0.0.1:${PORT}"

if ! command -v node >/dev/null 2>&1; then
  echo "找不到 node。请先确认终端里能运行 node，或在本文件里写死 node 的完整路径。"
  echo "按回车关闭…"; read -r _
  exit 1
fi

# 已经是本仪表盘在跑：直接开浏览器
if curl -s --max-time 1 "$URL/api/examples" | grep -q "path"; then
  echo "仪表盘已在运行：$URL"
  open "$URL"
  exit 0
fi

echo "启动关卡指标仪表盘…"
echo "地址：$URL"
echo "关闭这个终端窗口或按 Ctrl-C 即可停止服务。"
( for _ in $(seq 1 60); do
    if curl -s --max-time 1 "$URL/api/examples" | grep -q "path"; then open "$URL"; exit 0; fi
    sleep 0.25
  done
  echo "服务 15 秒内没有就绪，请检查上面的报错。"
) &
exec node 03_工具/正式版/MetricDashboard_v1.js --port "$PORT"
