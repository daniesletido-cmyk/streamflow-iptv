@echo off
title StreamFlow IPTV Server
cd /d "%~dp0"
echo ======================================================
echo    Iniciando StreamFlow IPTV...
echo ======================================================
start http://localhost:3000
node server.js
pause
