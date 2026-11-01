#!/bin/bash
cd "$(dirname "$0")/.."
echo "启动产线服务（编辑器 + 产线，同一端口）…"
echo "编辑器：http://127.0.0.1:8061/bin/index.html"
( sleep 2; open "http://127.0.0.1:8061/bin/index.html" ) &
exec node 03_工具/正式版/生产服务_v755.js --port 8061
