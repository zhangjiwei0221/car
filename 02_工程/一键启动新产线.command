#!/bin/bash
cd "$(dirname "$0")/.."
echo "启动新产线服务…（关闭此窗口即停止）"
echo "浏览器将打开：http://127.0.0.1:8061/"
( sleep 2; open "http://127.0.0.1:8061/" ) &
exec node 03_工具/正式版/生产服务_v755.js --port 8061
