#!/bin/bash
# 带「警示条」「实墙」两个插件启动（不改游戏本体）
APP="$HOME/Desktop/游戏版本/ParkPassenger_2/ParkPassenger.app"
D1="$HOME/Desktop/毛线汽车/03_工具/客户端插件/goodeyes/libwall.dylib"
D2="$HOME/Desktop/毛线汽车/03_工具/客户端插件/goodeyes/libborder.dylib"
echo "墙日志：/tmp/pp_wall.log    边框日志：/tmp/pp_border.log"
rm -f /tmp/pp_wall.log /tmp/pp_border.log
cd "$APP/Contents/Resources" || exit 1
DYLD_INSERT_LIBRARIES="$D1:$D2" "$APP/Contents/MacOS/ParkPassenger"
