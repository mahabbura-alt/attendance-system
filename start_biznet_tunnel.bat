@echo off
setlocal
cd /d "%~dp0"
title OMOS - BIZNET SSH TUNNEL
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\biznet\windows\start-biznet-tunnel.ps1"
if errorlevel 1 (
  echo.
  echo Gagal menyiapkan tunnel Biznet. Baca pesan ERROR di atas.
  pause
  exit /b 1
)
echo.
echo Tunnel Biznet aktif. Window ini boleh ditutup; proses tunnel berjalan tersembunyi.
pause
