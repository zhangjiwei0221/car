#!/bin/bash
# ------------------------------------------------------------------
# 蚂蚁拿块 · 一键启动（macOS 双击入口）
#
# 双击本文件 → 自动拉起本地生产服务 + 打开浏览器到生产器页面。
# 真正的启动逻辑（选端口 / 起服务 / 开浏览器）都在
#   完整主bin快照_20261012/网页启动器/启动.js
# 里，与 Windows 的 .bat 共用同一套，避免两处逻辑漂移。
#
# 双击没反应？用命令启动（不受执行权限 / 隔离属性影响）：
#     cd "/Users/red/Desktop/毛线汽车"
#     bash "一键启动生产器.command"
# 想先看到底哪里不对：
#     cd "完整主bin快照_20261012"
#     node "网页启动器/自检.js"
#
# 为什么必须用 http 打开、而不是双击 bin/index.html：
#   file:// 下浏览器禁用后台线程(Web Worker)、也没有落库服务，
#   只能整批跑完点 ZIP 下载，浏览器一崩就丢掉全部已完成关卡。
# 服务只监听本机 127.0.0.1，只允许写 输出文件/。
# 关闭：在本窗口按 Control + C。
# ------------------------------------------------------------------

set -u
SELF="$0"
HERE="$(cd "$(dirname "$SELF")" && pwd)"
PROJ="$HERE/完整主bin快照_20261012"

# 出错时停住窗口：双击运行的窗口会瞬间关掉，不停住等于没有报错
fail() {
  echo
  echo "✗ $1"
  [ -n "${2:-}" ] && echo "  $2"
  echo
  echo "也可以绕开双击、直接用命令启动："
  echo "    cd \"$PROJ\""
  echo "    node \"网页启动器/启动.js\""
  echo
  echo "按回车键关闭…"
  read -r _
  exit 1
}

# ---------- ① 自愈：执行权限 + macOS 隔离属性 ----------
# 跨机器拷贝/解压后这两样最容易丢或被加上，是"双击没反应/身份不明的开发者"的头号原因。
chmod +x "$SELF" 2>/dev/null
xattr -dr com.apple.quarantine "$HERE" 2>/dev/null

# ---------- ② 关键路径检查 ----------
[ -d "$PROJ" ] || fail "找不到工程目录：$PROJ" "请确认完整主bin快照_20261012 与本文件在同一层。"
[ -f "$PROJ/网页启动器/启动.js" ] || fail "找不到启动器：$PROJ/网页启动器/启动.js" "请确认快照目录完整（网页启动器/ 与 bin/ 都在）。"
[ -f "$PROJ/bin/index.html" ] || fail "找不到页面：$PROJ/bin/index.html" "请确认快照目录完整。"

# ---------- ③ 找 node ----------
NODE=""
if command -v node >/dev/null 2>&1; then
  NODE="node"
elif [ -x /opt/homebrew/bin/node ]; then
  NODE="/opt/homebrew/bin/node"
elif [ -x /usr/local/bin/node ]; then
  NODE="/usr/local/bin/node"
else
  fail "没找到 Node.js（本地生产服务需要它）。" \
       "安装：https://nodejs.org/  或  brew install node　装完再双击本文件。"
fi

# ---------- ④ 委托给跨平台启动器 ----------
cd "$PROJ" || fail "无法进入工程目录：$PROJ"
echo "工程目录：$PROJ"
exec "$NODE" "网页启动器/启动.js" "$@"
