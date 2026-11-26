@echo off
title StreamFlow IPTV - Windows Desktop
chcp 65001 >nul
cls
echo ======================================================
echo    📺  STREAMFLOW IPTV - VERSIÓN DE ESCRITORIO
echo ======================================================
echo.
echo Iniciando aplicación y verificando conexión...

if exist "StreamFlow-IPTV.exe" (
    start "" "StreamFlow-IPTV.exe"
    exit
)

echo Iniciando servidor en segundo plano...
start /b node server.js

timeout /t 2 /nobreak >nul

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="http://localhost:3000" --start-maximized --window-size=1366,768
    exit
)

if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app="http://localhost:3000" --start-maximized --window-size=1366,768
    exit
)

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app="http://localhost:3000" --start-maximized
    exit
)

start http://localhost:3000
exit
