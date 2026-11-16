@echo off
chcp 65001 >nul
title 教学文件管理
cd /d "%~dp0"
node server.js
if errorlevel 1 (
  echo.
  echo 启动失败：可能是没装 Node.js，或端口 7788 被别的程序占用。
  pause
)