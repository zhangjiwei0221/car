@echo off
REM ===========================================================================
REM 启动求解器_Windows.bat — 一键启动「大像素毛线 JSON 关卡求解器」(重置资源)
REM
REM 用途：关卡库导入过多导致页面卡顿/卡爆时，双击一键"重置并启动"：
REM   (1) 释放本地服务端口（结束上次残留的服务进程）—— 重置本地服务资源
REM   (2) 启动零依赖本地静态服务（求解器本地服务.js）
REM   (3) 用独立浏览器用户目录打开一个全新实例，避免旧标签页继续占用内存
REM
REM 没装 Node 时回退为直接用浏览器打开 index.html。关闭本窗口即停止服务。
REM ===========================================================================

chcp 65001 >nul
cd /d "%~dp0"

set PORT=8910

echo ==================================================
echo   大像素毛线 JSON 关卡求解器 . 重置并启动
echo ==================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo 未检测到 Node.js，改为直接用浏览器打开 index.html（file:// 模式）。
  echo 提示：建议先关掉旧标签页再打开，避免内存累积卡顿。
  start "" "index.html"
  exit /b 0
)

echo [1/3] 释放本地服务端口 %PORT% ...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT%" ^| findstr LISTENING') do (
  echo     结束占用端口的进程 PID=%%P
  taskkill /F /PID %%P >nul 2>&1
)
echo.

echo [2/3] 打开浏览器（独立干净实例）...
set FRESH=%RANDOM%%RANDOM%
set URL=http://localhost:%PORT%/?fresh=%FRESH%
set PROFILE_DIR=%TEMP%\yarn-solver-chrome-profile-%FRESH%
echo     %URL%
where chrome >nul 2>&1
if errorlevel 1 (
  echo     未找到 chrome 命令，改用系统默认浏览器打开。
  start "" "%URL%"
) else (
  echo     使用独立 Chrome 用户目录：%PROFILE_DIR%
  start "" chrome --user-data-dir="%PROFILE_DIR%" --no-first-run --new-window "%URL%"
)
echo     提示：本次会使用独立浏览器实例；旧标签页即使卡住也不会污染新实例。
echo.

echo [3/3] 启动本地静态服务（请勿关闭本窗口，关闭即停止服务）...
echo.
set SOLVER_PORT=%PORT%
node "求解器本地服务.js"

echo.
pause
