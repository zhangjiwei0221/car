@echo off
REM ===========================================================================
REM launch.bat — Windows 第 1 层引导脚本（Bootstrap，不依赖 node）
REM
REM 设计参考：design.md
REM   - "Components › 4. 共享 Batch 引导逻辑 launch.bat"
REM   - "Windows 启动时序（含已知限制）"
REM   - "Error Handling"（E1 / E6 / E14 / E15 等）
REM
REM 职责（与 launch.sh 对应的 Windows 镜像）：
REM   ① 校验包根存在 server.js / run.js / input_txt（缺失 -> 中文报错并停止，R1.6）
REM   ② 架构探测 %PROCESSOR_ARCHITECTURE%（AMD64 / ARM64）
REM   ③ 系统 Node 探测：node -v -> for /f 解析主版本 -> 数值比较 >= 18（R3.1）
REM   ④ 便携 Node：当前 .node-portable 归档仅为 mac(darwin-arm64) 二进制，
REM      在 Windows 上无法直接运行，因此无可用系统 Node 时直接走安装指引（R4.4）
REM   ⑤ 系统 Node 可用 -> 交接 "%NODE%" 启动器\orchestrator.js（R3.2）
REM   ⑥ 无可用 Node -> 展示内嵌 Windows 安装指引并写 如何安装Node.js.txt（R8.1/8.3/8.7/8.8）
REM
REM 窗口保持策略（R7.2 / R8.6）：
REM   本脚本由第 0 层入口 启动_Windows.bat 调用，真正供用户"看清错误后关闭"的
REM   外层 pause 位于入口脚本（见 tasks 9.2）。但为防止本脚本在 stop / guide 路径
REM   被独立运行（或入口未 call 而是直接转移控制）时窗口一闪而过，本脚本在所有
REM   "停止 / 安装指引" 分支也会自行 pause，确保用户能看清提示。成功交接路径下
REM   不 pause：orchestrator 为长生命周期进程，退出后控制返回入口由其 pause。
REM ===========================================================================

REM chcp 65001：切换到 UTF-8 代码页，使中文正确显示（>nul 抑制 "Active code page" 提示）
chcp 65001 >nul

setlocal enabledelayedexpansion

REM 本脚本位于 bin\，%~dp0 即 bin\（含尾部反斜杠），其上一级为包根。
REM 代码文件（server.js / run.js / orchestrator.js / .node-portable）都在 bin\ 内；
REM input_txt 与「日期-N关」输出在包根。
set "BIN=%~dp0"

REM --- 切换工作目录到包根 ----------------------------------------------------
REM %~dp0.. 即包根。切到包根使 input_txt 与输出文件夹、安装指引文件都落在用户可见处（R1.4）。
cd /d "%~dp0.." 2>nul
if errorlevel 1 (
    echo [失败] 步骤 切换工作目录：无法切换到产出包根目录。
    echo         失败原因：目录访问被拒绝或路径不存在。
    echo         建议操作：请确认整个产出包文件夹完整、未被移动到受限位置后重试。
    goto :halt
)

echo ============================================================
echo   关卡生产自动审核产出包 - Windows 启动器
echo   当前目录：%CD%
echo ============================================================
echo.

REM === 步骤 ① 校验包文件 =====================================================
echo [进行中] 步骤 1/3 校验产出包文件（bin\server.js / bin\run.js / input_txt）...
set "MISSING="
if not exist "%BIN%server.js" set "MISSING=bin\server.js"
if not exist "%BIN%run.js" (
    if defined MISSING (set "MISSING=!MISSING!、bin\run.js") else (set "MISSING=bin\run.js")
)
if not exist "input_txt" (
    if defined MISSING (set "MISSING=!MISSING!、input_txt") else (set "MISSING=input_txt")
)
if defined MISSING (
    echo [失败] 步骤 1/3 校验产出包文件：缺少必要项 -- !MISSING!
    echo         失败原因：产出包内找不到上述文件或文件夹。
    echo         建议操作：请确认产出包解压完整、未删除任何文件（含 bin 文件夹与 input_txt），然后重试。
    REM R1.6：缺失即停止，不创建或修改任何文件。
    goto :halt
)
echo [已完成] 步骤 1/3 校验产出包文件：bin\server.js / bin\run.js / input_txt 均存在。
echo.

REM === 步骤 ② 架构探测 =======================================================
echo [进行中] 步骤 2/3 检测系统与 CPU 架构...
set "ARCH=%PROCESSOR_ARCHITECTURE%"
if not defined ARCH set "ARCH=未知"
echo [已完成] 步骤 2/3 检测系统与 CPU 架构：操作系统 = Windows，架构 = !ARCH!。
echo.

REM === 步骤 ③ 系统 Node 探测 =================================================
echo [进行中] 步骤 3/3 检测系统已安装的 Node.js...
REM 采集 node -v 输出。node -v 正常情况下瞬时返回；此处用 for /f 捕获其首行输出，
REM 输出为空（命令不存在 / 执行失败）即视为"系统 Node 不存在"。2^>nul 抑制错误输出。
set "NODE_VER="
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"

if not defined NODE_VER (
    echo [已完成] 步骤 3/3 检测系统 Node.js：未检测到系统 Node.js。
    echo          说明：将尝试使用包内便携 Node 运行时。
    goto :portable
)

REM 去掉前导 'v'（node -v 形如 v22.11.0），再以 '.' 分割取主版本号。
set "VER_NUM=!NODE_VER:v=!"
set "MAJOR="
for /f "tokens=1 delims=." %%a in ("!VER_NUM!") do set "MAJOR=%%a"

REM 校验 MAJOR 为纯数字；含非数字字符则视为"无法读取主版本号"。
set "NON_NUM="
if defined MAJOR for /f "delims=0123456789" %%x in ("!MAJOR!") do set "NON_NUM=%%x"
if not defined MAJOR set "NON_NUM=1"

if defined NON_NUM (
    REM R3.5：存在但无法读取主版本号 -> 按不可用处理并提示已回退至便携运行时。
    echo [已完成] 步骤 3/3 检测系统 Node.js：检测到 Node.js 但无法读取其主版本号（!NODE_VER!）。
    echo          说明：已按系统 Node 不可用处理，回退至包内便携 Node 运行时。
    goto :portable
)

if !MAJOR! GEQ 18 (
    REM R3.2：系统 Node 主版本 >= 18，选用系统 node 作为运行时。
    set "NODE=node"
    echo [已完成] 步骤 3/3 检测系统 Node.js：检测到 !NODE_VER!（主版本 !MAJOR! ^>= 18），将使用系统 Node.js。
    echo.
    goto :handoff
) else (
    REM R3.3：系统 Node 版本过低，转便携流程。
    echo [已完成] 步骤 3/3 检测系统 Node.js：检测到 !NODE_VER!，主版本 !MAJOR! 低于所需的 18。
    echo          说明：将尝试使用包内便携 Node 运行时。
    goto :portable
)

REM === 便携 Node 流程（Windows 已知限制） ===================================
:portable
REM 已知限制（design.md "Windows 启动时序（含已知限制）" / R4.4）：
REM   当前 .node-portable\node.tar.xz 内仅含 node-v22.11.0-darwin-arm64（macOS 二进制），
REM   在 Windows 上没有可运行的 node.exe，便携 Node 对当前平台不可用。
REM   因此此处直接判定便携 Node 不可用，转入安装指引（R8.1）。
echo.
echo [进行中] 准备包内便携 Node 运行时...
echo [失败] 包内便携 Node 不支持当前平台：便携运行时仅包含 macOS 版本，无法在 Windows 上运行。
echo         保留 .node-portable 现有内容不做改动。
echo.
goto :install_guide

REM === 交接到 Node 编排脚本 =================================================
:handoff
REM 已定位可运行的系统 Node，将富逻辑交给第 2 层编排脚本（位于 bin\）。
echo [进行中] 启动编排脚本（bin\orchestrator.js）...
"!NODE!" "%BIN%orchestrator.js"
REM 编排脚本退出后控制返回（由入口脚本 启动_Windows.bat 负责最终 pause）。
endlocal
goto :eof

REM === 安装指引（无可用 Node） ==============================================
:install_guide
REM R8.1 / R8.3 / R8.7 / R8.8：
REM   终端完整输出 Windows 中文安装指引，并在包根写入 如何安装Node.js.txt；
REM   写入失败时仍完整打印指引并追加一条写入失败提示。
REM   指引内容与 launcher-core.js 的 buildInstallGuide('windows') 保持一致。

REM 先尝试写文件（重定向整个子过程的输出到文件），再以是否生成文件判断写入是否成功。
call :emit_guide > "如何安装Node.js.txt" 2>nul
set "GUIDE_WRITE_OK="
if exist "如何安装Node.js.txt" set "GUIDE_WRITE_OK=1"

REM 终端完整展示指引（R8.7）。
echo.
call :emit_guide
echo.
if defined GUIDE_WRITE_OK (
    echo 已将完整安装指引写入文件：如何安装Node.js.txt（位于产出包根目录），窗口关闭后仍可查阅。
) else (
    REM R8.8：写文件失败仍完整展示，并追加写入失败提示。
    echo [提示] 安装指引文件 如何安装Node.js.txt 写入失败（可能是权限不足或磁盘读写错误）。
    echo        请直接参考上方终端中显示的安装指引完成 Node.js 安装。
)
goto :halt

REM === 子过程：输出 Windows 安装指引文本 ====================================
REM 仅 echo 到标准输出，调用方通过重定向决定输出到文件还是终端，避免内容重复定义。
REM 文本与 buildInstallGuide('windows') 一致：含下载地址、最低主版本 18、.msi、重启动说明。
:emit_guide
echo ===== 如何安装 Node.js（Windows）=====
echo.
echo 本工具需要 Node.js 运行时才能启动。当前电脑未检测到可用的 Node.js，
echo 且包内便携 Node 不支持当前平台，请按以下步骤手动安装（需要 Node.js 18 或更高主版本）：
echo.
echo 第 1 步：打开浏览器，访问 Node.js 官方下载页面：https://nodejs.org/zh-cn/download
echo 第 2 步：下载 Windows 安装包（.msi 格式）。请选择 LTS 版本，其主版本不低于 18。
echo 第 3 步：双击下载好的 .msi 安装包，按照提示完成安装。
echo 第 4 步：安装完成后重新双击 启动_Windows.bat，启动器会自动检测到新安装的 Node.js 并继续启动流程。
echo.
echo 提示：安装完成后无需做任何额外配置，重新双击 启动_Windows.bat 即可。
goto :eof

REM === 停止 / 错误统一出口 ==================================================
:halt
REM 在停止 / 安装指引路径自行 pause，确保被独立运行时窗口不一闪而过（R7.2 / R8.6）。
echo.
echo （按任意键关闭本窗口）
pause >nul
endlocal
goto :eof
