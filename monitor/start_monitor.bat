@echo off
rem 《中国人能飞》本地监测系统启动脚本
cd /d "%~dp0"
start "" powershell -WindowStyle Hidden -Command "Start-Sleep 1; Start-Process 'http://localhost:8765'"
node server.js
pause
