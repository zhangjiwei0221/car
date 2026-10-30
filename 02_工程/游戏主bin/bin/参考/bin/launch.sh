#!/usr/bin/env bash
# =============================================================================
# launch.sh — 第 1 层 · macOS 引导脚本（Bootstrap）
#
# 设计参考：design.md
#   - "Components › 3. 共享 Shell 引导逻辑 launch.sh"
#   - "macOS 启动时序"
#   - "Error Handling"
#
# 职责（不依赖 node 即可运行）：在机器上「找到一个可运行的 node」。
#   1. verify_package      校验包根存在 server.js / run.js / input_txt
#   2. detect_arch         uname -m → arm64 / x86_64
#   3. detect_system_node  node -v（5s 上限）解析主版本，≥18 选系统 node
#   4. setup_portable_node 解压 .node-portable、定位 bin/node、试运行
#   5. handoff             exec "$NODE" 启动器/orchestrator.js
#   6. show_install_guide  无可用 node 时输出 macOS 安装指引并写文件
#
# 兼容性：纯 shell（bash/zsh 兼容），不调用 node；不使用 GNU 专有特性。
# 注意：本脚本只负责「定位 node 并交接」；保持窗口不自动关闭由双击入口
#       （启动_Mac.command 的末尾 read）负责。失败时本脚本以非零码返回。
# =============================================================================

# 不开启 set -e / set -u：本脚本控制流复杂、大量探测命令预期会失败，
# 由各函数显式判断返回码，避免因单条命令失败导致整脚本意外退出。

# ---- 全局状态（LauncherContext，见 design.md › Data Models）-----------------
PACKAGE_ROOT=""
ARCH=""
NODE=""
NODE_SOURCE=""

# 脚本自身所在目录（bin/，所有代码与便携 Node 资产都在这里）
SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
# 包根目录（input_txt 与「日期-N关」输出所在，即 bin 的上一级）
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd)"

# 固定的便携 Node 资产路径（位于 bin/.node-portable，用绝对路径以免受 cwd 影响）
PORTABLE_ARCHIVE="$SCRIPT_DIR/.node-portable/node.tar.xz"
PORTABLE_EXTRACT_ROOT="$SCRIPT_DIR/.node-portable"
PORTABLE_NODE_DIR="$SCRIPT_DIR/.node-portable/node-v22.11.0-darwin-arm64"
PORTABLE_NODE_BIN="$SCRIPT_DIR/.node-portable/node-v22.11.0-darwin-arm64/bin/node"

# Node 最低主版本（Node_Version_Floor）
NODE_VERSION_FLOOR=18

# =============================================================================
# 通用：中文步骤状态输出（R1.7 / R7.3）
# 每步开始标记「进行中」，结束标记「已完成」或「失败」。
# =============================================================================
step_start() {
  echo ""
  echo "▶ [$1] 进行中……"
}

step_done() {
  echo "✔ [$1] 已完成"
}

step_fail() {
  echo "✘ [$1] 失败"
}

# 统一的失败说明三件套：失败步骤名 + 失败原因 + 可执行的下一步建议（R7.1）
print_error_block() {
  # $1 = 步骤名, $2 = 失败原因, $3 = 建议操作
  echo ""
  echo "────────────────────────────────────────────────"
  echo "✘ 启动失败"
  echo "  失败步骤：$1"
  echo "  失败原因：$2"
  echo "  建议操作：$3"
  echo "────────────────────────────────────────────────"
  echo ""
}

# =============================================================================
# 通用：带 5s 上限运行命令（macOS 可能无 GNU timeout）
# 实现方式：后台运行命令 + 看门狗子进程（sleep N 后 kill）。
# 命令标准输出回显到本函数的 stdout；返回命令退出码（被杀则非零）。
# =============================================================================
run_with_timeout() {
  local seconds="$1"
  shift

  local outfile
  outfile="$(mktemp 2>/dev/null)"
  if [ -z "$outfile" ]; then
    outfile="/tmp/launch_node_$$_$RANDOM"
  fi

  # 后台运行目标命令
  "$@" >"$outfile" 2>/dev/null &
  local cmd_pid=$!

  # 看门狗：到点强杀目标命令
  ( sleep "$seconds"; kill -9 "$cmd_pid" 2>/dev/null ) &
  local watchdog_pid=$!

  wait "$cmd_pid" 2>/dev/null
  local rc=$?

  # 取消看门狗并回收
  kill -9 "$watchdog_pid" 2>/dev/null
  wait "$watchdog_pid" 2>/dev/null

  cat "$outfile" 2>/dev/null
  rm -f "$outfile" 2>/dev/null
  return $rc
}

# 从 "vM.m.p" 风格输出中解析主版本号；无法解析则输出空串。
# 容忍前后空白/换行与可选前导 v。
parse_major() {
  printf '%s' "$1" | sed -n 's/^[[:space:]]*v\{0,1\}\([0-9][0-9]*\)\..*/\1/p' | head -n1
}

# 试运行某个 node 可执行文件（带 5s 上限）；可正常返回版本则 rc=0。
test_run_node() {
  run_with_timeout 5 "$1" -v >/dev/null 2>&1
}

# =============================================================================
# 切换到包根（R1.4 / R1.6）
# 由脚本自身位置推导 PACKAGE_ROOT（launch.sh 位于 <root>/启动器/）。
# =============================================================================
goto_package_root() {
  if [ -z "$PACKAGE_ROOT" ] || ! cd "$PACKAGE_ROOT" 2>/dev/null; then
    print_error_block "切换到包根目录" \
      "无法切换到产出包根目录。" \
      "请确认产出包未被移动到受限目录、且有读取权限，然后重新双击 启动_Mac.command。"
    return 1
  fi
  return 0
}

# =============================================================================
# 步骤 ① 校验产出包文件（R1.5 / R1.6）
# 缺失任一项 → 中文报错并停止，且不创建或修改任何文件。
# 注意：代码文件在 bin/（SCRIPT_DIR），input_txt 在包根。
# =============================================================================
verify_package() {
  step_start "校验产出包文件"

  local missing=""
  [ -f "$SCRIPT_DIR/server.js" ] || missing="${missing} bin/server.js"
  [ -f "$SCRIPT_DIR/run.js" ]    || missing="${missing} bin/run.js"
  [ -d "$PACKAGE_ROOT/input_txt" ] || missing="${missing} input_txt"

  if [ -n "$missing" ]; then
    step_fail "校验产出包文件"
    print_error_block "校验产出包文件" \
      "产出包缺少必要项：${missing# }。" \
      "请确认你拷贝/解压了完整的产出包（含 bin/ 文件夹与 input_txt 文件夹），然后重新双击启动。"
    return 1
  fi

  step_done "校验产出包文件"
  echo "  已找到：bin/server.js、bin/run.js、input_txt。"
  return 0
}

# =============================================================================
# 步骤 ② 检测 CPU 架构（R2.2）
# =============================================================================
detect_arch() {
  step_start "检测 CPU 架构"

  ARCH="$(uname -m 2>/dev/null)"
  case "$ARCH" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64|amd64)  ARCH="x86_64" ;;
  esac

  step_done "检测 CPU 架构"
  echo "  当前架构：${ARCH:-未知}"
  return 0
}

# =============================================================================
# 步骤 ③ 检测系统 Node（R3.1 / R3.2 / R3.3 / R3.4 / R3.5）
# 返回 0 ⇒ 选用系统 node（NODE 已设置）；返回 1 ⇒ 回退便携流程。
# =============================================================================
detect_system_node() {
  step_start "检测系统 Node.js"

  # node 完全不存在 → 直接回退便携流程（R3.4）
  if ! command -v node >/dev/null 2>&1; then
    step_done "检测系统 Node.js"
    echo "  未检测到系统 Node.js，将尝试使用包内便携 Node 运行时。"
    return 1
  fi

  # node 存在：带 5s 上限读取版本（R3.1）
  local out major
  out="$(run_with_timeout 5 node -v)"
  major="$(parse_major "$out")"

  # 超时或无法读取主版本 → 视为不可用并提示已回退（R3.5）
  if [ -z "$major" ]; then
    step_done "检测系统 Node.js"
    echo "  系统 Node.js 版本探测超时或无法读取，已回退至便携运行时。"
    return 1
  fi

  if [ "$major" -ge "$NODE_VERSION_FLOOR" ]; then
    # 主版本达标 → 选用系统 node（R3.2）
    NODE="node"
    NODE_SOURCE="system"
    step_done "检测系统 Node.js"
    echo "  检测到系统 Node.js 主版本 ${major}（≥ ${NODE_VERSION_FLOOR}），将使用系统 Node。"
    return 0
  fi

  # 主版本过低 → 回退便携流程（R3.3）
  step_done "检测系统 Node.js"
  echo "  系统 Node.js 主版本 ${major} 低于所需的 ${NODE_VERSION_FLOOR}，已回退至便携运行时。"
  return 1
}

# =============================================================================
# 步骤 ④ 准备便携 Node（R4.1 / R4.2 / R4.3 / R4.4 / R4.5 / R4.6）
# 返回 0 ⇒ NODE 指向可运行的便携 node；返回 1 ⇒ 已展示指引，停止启动。
# =============================================================================
setup_portable_node() {
  step_start "准备便携 Node 运行时"

  # (R4.2) 已存在且可运行 → 跳过解压，直接使用
  if [ -f "$PORTABLE_NODE_BIN" ] && test_run_node "$PORTABLE_NODE_BIN"; then
    NODE="$PORTABLE_NODE_BIN"
    NODE_SOURCE="portable"
    step_done "准备便携 Node 运行时"
    echo "  已检测到可用的便携 Node（跳过解压）。"
    return 0
  fi

  # (R4.5) 归档文件缺失 → 提示缺失 + 安装系统 Node 指引，保留现有内容，停止
  if [ ! -f "$PORTABLE_ARCHIVE" ]; then
    step_fail "准备便携 Node 运行时"
    print_error_block "准备便携 Node 运行时" \
      "包内便携 Node 文件缺失（未找到 ${PORTABLE_ARCHIVE}）。" \
      "请按下方安装指引安装系统 Node.js（≥ ${NODE_VERSION_FLOOR}），或重新获取完整的产出包后再试。"
    show_install_guide
    return 1
  fi

  # (R4.1) 解压归档到固定子目录
  echo "  正在解压便携 Node 运行时（首次启动较慢，请稍候）……"
  if ! tar -xJf "$PORTABLE_ARCHIVE" -C "$PORTABLE_EXTRACT_ROOT" 2>/dev/null; then
    # (R4.6) 解压失败：归档损坏或读写错误 → 删除不完整解压目录，停止
    step_fail "准备便携 Node 运行时"
    rm -rf "$PORTABLE_NODE_DIR" 2>/dev/null
    print_error_block "准备便携 Node 运行时" \
      "便携 Node 解压失败（压缩包可能损坏，或磁盘读写/权限异常）。" \
      "请重新获取完整的产出包，或按下方安装指引安装系统 Node.js（≥ ${NODE_VERSION_FLOOR}）后再试。"
    show_install_guide
    return 1
  fi

  # (R4.6) 解压后在固定子目录中找不到 node 可执行文件 → 删除不完整目录，停止
  if [ ! -f "$PORTABLE_NODE_BIN" ]; then
    step_fail "准备便携 Node 运行时"
    rm -rf "$PORTABLE_NODE_DIR" 2>/dev/null
    print_error_block "准备便携 Node 运行时" \
      "便携 Node 解压完成，但未在 ${PORTABLE_NODE_DIR}/bin 下找到 node 可执行文件。" \
      "请重新获取完整的产出包，或按下方安装指引安装系统 Node.js（≥ ${NODE_VERSION_FLOOR}）后再试。"
    show_install_guide
    return 1
  fi

  chmod +x "$PORTABLE_NODE_BIN" 2>/dev/null

  # (R4.3 / R4.4) 试运行：可运行则采用；不可运行（多为架构不匹配）→ 展示安装指引
  if ! test_run_node "$PORTABLE_NODE_BIN"; then
    # (R4.4 / R8.1) 保留 .node-portable/ 现有内容不做改动
    step_fail "准备便携 Node 运行时"
    print_error_block "准备便携 Node 运行时" \
      "包内便携 Node 不支持当前平台或 CPU 架构（当前架构：${ARCH:-未知}），无法运行。" \
      "请按下方安装指引从 nodejs.org 安装 LTS 版本的系统 Node.js（≥ ${NODE_VERSION_FLOOR}）后重新双击启动。"
    show_install_guide
    return 1
  fi

  NODE="$PORTABLE_NODE_BIN"
  NODE_SOURCE="portable"
  step_done "准备便携 Node 运行时"
  echo "  便携 Node 已就绪。"
  return 0
}

# =============================================================================
# macOS 安装指引文本（无 node 场景的 shell 内嵌镜像）
# 内容与 launcher-core.js › buildInstallGuide('macos') 保持一致：
#   含下载地址、最低主版本 18、.pkg 安装包类型、重新双击 启动_Mac.command 说明。
# =============================================================================
build_install_guide_macos() {
cat <<'GUIDE'
===== 如何安装 Node.js（macOS）=====

本工具需要 Node.js 运行时才能启动。当前电脑未检测到可用的 Node.js，
且包内便携 Node 不支持当前平台，请按以下步骤手动安装（需要 Node.js 18 或更高主版本）：

第 1 步：打开浏览器，访问 Node.js 官方下载页面：https://nodejs.org/zh-cn/download
第 2 步：下载 macOS 安装包（.pkg 格式）。请选择 LTS 版本，其主版本不低于 18。
第 3 步：双击下载好的 .pkg 安装包，按照提示完成安装。
第 4 步：安装完成后重新双击 启动_Mac.command，启动器会自动检测到新安装的 Node.js 并继续启动流程。

提示：安装完成后无需做任何额外配置，重新双击 启动_Mac.command 即可。
GUIDE
}

# =============================================================================
# 步骤 ⑥ 展示安装指引（R8.1 / R8.7 / R8.8）
# 终端完整输出 + 在包根写 如何安装Node.js.txt；写失败仍打印并追加提示。
# =============================================================================
show_install_guide() {
  step_start "生成 Node.js 安装指引"

  local guide_file="如何安装Node.js.txt"
  local guide
  guide="$(build_install_guide_macos)"

  # (R8.7) 终端完整展示
  echo ""
  printf '%s\n' "$guide"
  echo ""

  # (R8.7) 写入安装指引文件
  if printf '%s\n' "$guide" >"$guide_file" 2>/dev/null; then
    step_done "生成 Node.js 安装指引"
    echo "  已将安装指引保存到：${PACKAGE_ROOT}/${guide_file}"
  else
    # (R8.8) 写入失败：仍完整终端展示（上方已打印）并追加写入失败提示
    step_fail "生成 Node.js 安装指引"
    echo "  ⚠ 安装指引文件写入失败（可能是磁盘只读或权限不足）。"
    echo "    上方已在终端完整显示安装指引，请直接按上方步骤操作。"
  fi
  return 0
}

# =============================================================================
# 步骤 ⑤ 交接至 Node 编排脚本（R1.x 收尾）
# 使用选定运行时执行 启动器/orchestrator.js（exec 替换当前进程）。
# =============================================================================
handoff() {
  step_start "启动生产服务（交接至编排脚本）"
  echo "  使用运行时：${NODE}（来源：${NODE_SOURCE:-system}）"

  exec "$NODE" "$SCRIPT_DIR/orchestrator.js"

  # 仅当 exec 失败（运行时不可执行）才会到达此处（R7.4 未识别原因兜底）
  step_fail "启动生产服务（交接至编排脚本）"
  print_error_block "启动生产服务" \
    "无法以选定的运行时执行编排脚本（${NODE}）。" \
    "请重新双击 启动_Mac.command 重试；若仍失败，请按提示安装系统 Node.js 后再试，或联系工具提供者。"
  return 1
}

# =============================================================================
# 主流程
# =============================================================================
main() {
  echo "================================================"
  echo "  关卡生产自动审核产出包 · 启动器（macOS）"
  echo "================================================"

  # R1.4：先切换到包根
  goto_package_root || return 1

  # 步骤 ①
  verify_package || return 1

  # 步骤 ②
  detect_arch

  # 步骤 ③ → ④：优先系统 node，否则回退便携 node
  if detect_system_node; then
    : # 系统 node 已选定（NODE/NODE_SOURCE 已设置）
  else
    setup_portable_node || return 1
  fi

  # 步骤 ⑤：交接（成功则不返回）
  handoff
  return 1
}

main
exit $?
