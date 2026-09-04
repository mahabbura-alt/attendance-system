@echo off
title START SERVER OMOS - MINING PRODUCTION ^& ABSENSI (IP: 192.168.1.82)
color 0A
echo ============================================================
echo   MENJALANKAN SERVER OMOS (ONE MINING, ONE SYSTEM)
echo   PT. PRIMA INDOJAYA MANDIRI - IP: 192.168.1.82
echo ============================================================
echo.

echo [1/3] Memastikan Database PostgreSQL ^& Storage MinIO Aktif...
docker start absensi_postgres absensi_minio >nul 2>&1
if errorlevel 1 (
    docker compose up -d >nul 2>&1
)
echo.

echo [2/3] Menjalankan Dashboard Admin Web di Port 8080...
start /min cmd /c "cd /d %~dp0admin-dashboard && python -m http.server 8080"
echo.

echo [3/3] Menjalankan Server Backend API Node.js di Port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
cd /d %~dp0backend
node src/server.js

pause
