#!/bin/bash
# 带 GoodEyes 插件启动游戏（不改游戏本体）
APP="$HOME/Desktop/游戏版本/ParkPassenger_2/ParkPassenger.app"
DYL="$HOME/Desktop/毛线汽车/03_工具/客户端插件/goodeyes/libgoodeyes.dylib"
echo "日志：/tmp/pp_ge.log"
rm -f /tmp/pp_ge.log
cd "$APP/Contents/Resources" || exit 1
DYLD_INSERT_LIBRARIES="$DYL" "$APP/Contents/MacOS/ParkPassenger"
