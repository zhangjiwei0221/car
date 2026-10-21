@echo off
chcp 65001 >nul
rem ------------------------------------------------------------------
rem 蚂蚁拿块 · 一键启动（Windows 双击入口）
rem
rem 双击本文件 → 自动拉起本地生产服务 + 打开浏览器到生产器页面。
rem 真正的启动逻辑（选端口 / 起服务 / 开浏览器）都在
rem   完整主bin快照_20261012\网页启动器\启动.js
rem 里，与 macOS 的 .command 共用同一套，避免两处逻辑漂移。
rem
rem 双击没反应？直接在命令行里启动：
rem     cd /d "<交接包根目录>\完整主bin快照_20261012"
rem     node "网页启动器\启动.js"
rem 想先看到底哪里不对：
rem     node "网页启动器\自检.js"
rem
rem 为什么必须用 http 打开、而不是双击 bin\index.html：
rem   file:// 下浏览器禁用后台线程(Web Worker)、也没有落库服务，
rem   只能整批跑完点 ZIP 下载，浏览器一崩就丢掉全部已完成关卡。
rem 服务只监听本机 127.0.0.1，只允许写 输出文件\。
rem 关闭：在本窗口按 Control + C。
rem ------------------------------------------------------------------

setlocal
set "HERE=%~dp0"
set "PROJ=%HERE%完整主bin快照_20261012"
set "LAUNCHER=%PROJ%\网页启动器\启动.js"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [x] 没找到 Node.js（本地生产服务需要它）。
  echo     安装：https://nodejs.org/   装完重开命令行再双击本文件。
  echo.
  pause
  exit /b 1
)

if not exist "%LAUNCHER%" (
  echo.
  echo [x] 找不到启动器：%LAUNCHER%
  echo     请确认 完整主bin快照_20261012\网页启动器\启动.js 与本文件在同一层目录下。
  echo.
  pause
  exit /b 1
)

if not exist "%PROJ%\bin\index.html" (
  echo.
  echo [x] 找不到页面：%PROJ%\bin\index.html
  echo     请确认快照目录完整（网页启动器\ 与 bin\ 都在）。
  echo.
  pause
  exit /b 1
)

echo 工程目录：%PROJ%
cd /d "%PROJ%"
node "%LAUNCHER%" %*
if errorlevel 1 (
  echo.
  echo [x] 启动失败。可以先跑自检看原因：
  echo     node "网页启动器\自检.js"
  echo.
  pause
)
endlocal
