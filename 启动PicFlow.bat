@echo off
rem PicFlow 启动脚本（开发模式，直接从源码运行）
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo 首次运行需要安装依赖，请先执行: npm install
  pause
  exit /b
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
