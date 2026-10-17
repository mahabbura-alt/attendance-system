@echo off
setlocal
cd /d "%~dp0"
title OMOS - STOP BIZNET SSH TUNNEL
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\biznet\windows\stop-biznet-tunnel.ps1"
pause
