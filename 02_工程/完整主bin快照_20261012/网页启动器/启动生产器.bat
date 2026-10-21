@echo off
chcp 65001 >nul
rem ------------------------------------------------------------------
rem 蚂蚁拿块 · 生产器本地服务启动器（Windows 双击入口）
rem
rem 本文件只做两件事：找到 node，然后委托给 网页启动器\启动.js。
rem 真正的启动逻辑（选端口 / 起服务 / 开浏览器）都在 启动.js 里，与 macOS 共用一套。
rem
rem 双击没反应？直接在命令行里启动：
rem     cd /d "<项目根目录>"
rem     node "网页启动器\启动.js"
rem 想先看看哪里不对：
rem     node "网页启动器\自检.js"
rem
rem 为什么必须用 http 打开、而不是双击 bin\index.html：
rem   file:// 下浏览器禁用后台线程(Web Worker)，批量生产退回主线程、界面卡、停止不即时；
rem   而且没有落库服务，只能整批跑完点 ZIP 下载，浏览器崩溃就丢掉全部已完成关卡。
rem 服务只监听本机 127.0.0.1，只允许写 输出文件\ 目录。关闭：本窗口按 Control+C。
rem ------------------------------------------------------------------

setlocal
set "HERE=%~dp0"
set "LAUNCHER=%HERE%启动.js"

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
  echo     请确认 网页启动器\启动.js 一起拷过来了。
  echo.
  pause
  exit /b 1
)

cd /d "%HERE%.."
node "%LAUNCHER%" %*
if errorlevel 1 (
  echo.
  echo [x] 启动失败。可以先跑自检看原因：
  echo     node "网页启动器\自检.js"
  echo.
  pause
)
endlocal
