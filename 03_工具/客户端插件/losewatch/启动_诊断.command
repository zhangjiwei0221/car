#!/bin/bash
# 带「判输诊断」插件启动桌面版游戏（不改游戏本体）
APP="$HOME/Desktop/ParkPassenger.app"
DYL="$HOME/Desktop/毛线汽车/03_工具/客户端插件/losewatch/liblosewatch.dylib"
echo "日志：/tmp/pp_lose.log"
rm -f /tmp/pp_lose.log
cd "$APP/Contents/Resources" || exit 1
DYLD_INSERT_LIBRARIES="$DYL" "$APP/Contents/MacOS/ParkPassenger"
