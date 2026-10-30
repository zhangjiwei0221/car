#!/bin/bash
# Stack Sort 关卡调制平台 - 双击启动器（macOS）
# 二合一：检测到 Node 就走本地服务器模式（方案文件可自动写回）；
#         没有 Node 就回退 file:// 直开模式（方案文件需手动导入/导出）。
# 两种情况都会自动打开浏览器。关闭本终端窗口即停止服务器。

# 切到脚本所在目录（无论从哪里双击都能正确定位 index.html / server.js）
cd "$(dirname "$0")" || exit 1

echo "正在启动 Stack Sort 关卡调制平台 ..."
echo

if command -v node >/dev/null 2>&1; then
  echo "[模式] 本地服务器（方案文件自动写回已启用）"
  echo "提示：请勿关闭本窗口，关闭即停止服务器。"
  echo
  node server.js
else
  echo "[模式] 文件直开（未检测到 Node；方案文件需手动 导出/导入 对齐）"
  echo "如需启用方案文件自动写回，请先安装 Node.js: https://nodejs.org"
  echo
  open index.html
  echo "已用浏览器打开。本窗口可关闭。"
fi
