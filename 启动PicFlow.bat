@echo off
rem PicFlow 图片管家 启动脚本
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo 首次运行需要安装依赖，请先执行: npm install
  pause
  exit /b
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
