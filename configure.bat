@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo(
echo   正在启动配置界面...
echo(

set "NODE_EXE="
where node >nul 2>&1
if %errorlevel% equ 0 (
  set "NODE_EXE=node"
) else if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
) else if exist "%LocalAppData%\Programs\node\node.exe" (
  set "NODE_EXE=%LocalAppData%\Programs\node\node.exe"
)

if not defined NODE_EXE (
  echo [错误] 未找到 Node.js，请先安装: https://nodejs.org/
  echo 安装后请重新打开此窗口，或确认 node 已加入 PATH。
  pause
  exit /b 1
)

"%NODE_EXE%" config-ui\server.mjs
if errorlevel 1 (
  echo(
  echo [错误] 配置服务启动失败
  pause
  exit /b 1
)
