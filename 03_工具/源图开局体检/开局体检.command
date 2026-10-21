#!/bin/bash
# 双击运行；也可以把一个或多个 .txt 目标图【直接拖到这个文件上】。
cd "$(dirname "$0")" || exit 1
if [ "$#" -eq 0 ]; then
  echo "把目标图 .txt（或关卡 .json）的路径粘进来，回车："
  read -r target
  set -- "$target"
fi
node "开局体检.js" "$@"
echo
echo "（按回车关闭窗口）"
read -r
