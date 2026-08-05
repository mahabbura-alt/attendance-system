@echo off
title START SERVER ABSENSI & PAYROLL (IP: 192.168.1.82)
color 0A
echo ============================================================
echo   MENJALANKAN SERVER ABSENSI & PAYROLL - PT. PRIMA INDOJAYA MANDIRI
echo   IP Komputer Target: 192.168.1.82
echo ============================================================
echo.

echo [1/3] Menyalakan Database PostgreSQL & Storage MinIO (Docker)...
docker compose up -d
echo.

echo [2/3] Menjalankan Dashboard Admin Web di Port 8080...
start /min cmd /c "cd /d %~dp0admin-dashboard && python -m http.server 8080"
echo.

echo [3/3] Menjalankan Server Backend API Node.js di Port 3000...
cd /d %~dp0backend
node src/server.js

pause
