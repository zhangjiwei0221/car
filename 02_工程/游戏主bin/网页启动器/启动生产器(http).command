#!/bin/bash
# 蚂蚁拿块 · 生产器本地服务启动器（macOS 双击入口）
# ------------------------------------------------------------------
# 双击本文件，即可用 http:// 方式打开生产器页面。
#
# 本文件只做三件事：① 自愈（补执行权限、清 macOS 隔离属性）；② 找到 node；③ 委托给 网页启动器/启动.js。
# 真正的启动逻辑（选端口 / 起服务 / 开浏览器）都在 启动.js 里，跨平台共用一套，避免两处逻辑漂移。
#
# 换电脑后双击没反应？直接用命令启动，不受执行权限与隔离属性影响：
#     cd "<项目根目录>"
#     node "网页启动器/启动.js"
# 想先看看到底哪里不对：
#     node "网页启动器/自检.js"
#
# 为什么必须用 http 打开、而不是双击 bin/index.html：
#   ① file:// 下浏览器禁用后台线程(Web Worker) → 批量生产退回主线程，界面卡、"停止"不即时生效；
#   ② file:// 下没有落库服务 → 只能整批跑完点 ZIP 下载，浏览器崩溃就丢掉全部已完成的关卡。
#   用 http 打开才有"每关生产完立刻写盘、写盘确认后才生产下一关"。
# 服务只监听本机(127.0.0.1)，只允许写 输出文件/ 目录。关闭：本窗口按 Control+C 或直接关掉窗口。
# ------------------------------------------------------------------

SELF="$0"
HERE="$(cd "$(dirname "$SELF")" && pwd)"

# 出错时停住窗口，让人看得见原因（双击运行的窗口会瞬间关掉，不停住等于没有报错）
fail() {
  echo
  echo "✗ $1"
  [ -n "$2" ] && echo "  $2"
  echo
  echo "也可以绕开双击、直接用命令启动（不受执行权限/隔离属性影响）："
  echo "    cd \"$(cd "$HERE/.." && pwd)\""
  echo "    node \"网页启动器/启动.js\""
  echo
  echo "按回车键关闭…"
  read -r _
  exit 1
}

# ---------- ① 自愈：执行权限 + macOS 隔离属性 ----------
# 跨机器拷贝/解压后这两样最容易丢或被加上，是"双击没反应/报身份不明开发者"的头号原因。
chmod +x "$SELF" 2>/dev/null
xattr -d com.apple.quarantine "$SELF" 2>/dev/null
xattr -d com.apple.quarantine "$HERE/启动.js" 2>/dev/null
xattr -d com.apple.quarantine "$HERE/生产服务.js" 2>/dev/null
xattr -d com.apple.quarantine "$HERE/自检.js" 2>/dev/null

# ---------- ② 找 node ----------
NODE=""
if command -v node >/dev/null 2>&1; then
  NODE="node"
elif [ -x /opt/homebrew/bin/node ]; then
  NODE="/opt/homebrew/bin/node"
elif [ -x /usr/local/bin/node ]; then
  NODE="/usr/local/bin/node"
else
  fail "没找到 Node.js（本地生产服务需要它）。" \
       "安装：https://nodejs.org/  或 Homebrew：brew install node　装完再双击本文件。"
fi

# ---------- ③ 委托给跨平台启动器 ----------
LAUNCHER="$HERE/启动.js"
[ -f "$LAUNCHER" ] || fail "找不到启动器：$LAUNCHER" "请确认 网页启动器/启动.js 一起拷过来了。"

cd "$HERE/.." || fail "无法进入项目根目录"
exec "$NODE" "$LAUNCHER" "$@"
