@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title OMOS LOCAL DEVELOPMENT SERVER
color 0A
set "DASHBOARD_PORT=8080"
set "BACKEND_PORT=3000"
set "LAN_IP=localhost"
set "API_MODE=local"

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$routes=@(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue);if($routes.Count -gt 0){$addresses=@(Get-NetIPAddress -InterfaceIndex $routes[0].InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue);if($addresses.Count -gt 0){$addresses[0].IPAddress}}"`) do set "LAN_IP=%%i"

echo ============================================================
echo   OMOS LOCAL DEVELOPMENT SERVER
echo ============================================================
echo Dashboard lokal : http://localhost:%DASHBOARD_PORT%
echo Dashboard LAN   : http://%LAN_IP%:%DASHBOARD_PORT%
echo Backend API     : http://localhost:%BACKEND_PORT%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js tidak ditemukan di PATH.
  goto :failed
)

powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:13000/health' -TimeoutSec 2; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }"
if not errorlevel 1 (
  set "API_MODE=biznet"
  echo [INFO] Tunnel Biznet sehat; dashboard akan memakai database Biznet.
)
where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python tidak ditemukan di PATH.
  goto :failed
)
if not exist "%~dp0backend\node_modules" (
  echo [ERROR] Dependency backend belum tersedia. Jalankan: cd backend ^&^& npm install
  goto :failed
)

if /i "%~1"=="check" goto :check_only

echo [1/3] Memeriksa sumber database lokal...
findstr /I /C:"supabase.co" "%~dp0backend\.env" >nul 2>&1
if not errorlevel 1 (
  echo [WARNING] backend\.env masih memakai database Supabase lama.
  echo           Server dapat hidup, tetapi data terbaru Biznet tidak akan tampil.
)
findstr /I /C:"localhost:5432" /C:"127.0.0.1:5432" "%~dp0backend\.env" >nul 2>&1
if not errorlevel 1 (
  docker info >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Database lokal dipilih tetapi Docker Desktop belum berjalan.
    goto :failed
  )
  docker compose up -d postgres minio
  if errorlevel 1 goto :failed
) else (
  echo [INFO] Database remote terkonfigurasi; Docker lokal tidak diperlukan.
)
echo.

echo [2/3] Menjalankan Dashboard Admin Web...
call :is_listening %DASHBOARD_PORT%
if defined PORT_LISTENING (
  echo [INFO] Port %DASHBOARD_PORT% sudah aktif; memakai proses yang tersedia.
) else (
  start "OMOS Dashboard :%DASHBOARD_PORT%" /min cmd /c "cd /d ""%~dp0admin-dashboard"" && python -m http.server %DASHBOARD_PORT%"
)
echo.

echo [3/3] Menjalankan Backend API...
call :is_listening %BACKEND_PORT%
if defined PORT_LISTENING (
  echo [INFO] Restart backend lama agar perubahan source terbaru dimuat.
  for /f "tokens=5" %%p in ('netstat -aon ^| findstr /R /C:":%BACKEND_PORT% .*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
  timeout /t 1 /nobreak >nul
)
start "OMOS Backend :%BACKEND_PORT%" /min cmd /k "cd /d ""%~dp0backend"" && node src/server.js"

timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%BACKEND_PORT%/health' -TimeoutSec 5; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }"
if errorlevel 1 (
  echo [ERROR] Backend tidak merespons di port %BACKEND_PORT%.
  echo         Buka window 'OMOS Backend' untuk melihat error aslinya.
  goto :failed
)

echo.
echo [OK] Dashboard dan Backend aktif.
echo      PC ini : http://localhost:%DASHBOARD_PORT%
echo      Jaringan: http://%LAN_IP%:%DASHBOARD_PORT%
echo      Sumber API: %API_MODE%
start "" "http://localhost:%DASHBOARD_PORT%/?api_mode=%API_MODE%"
goto :done

:check_only
echo [CHECK] Node.js:
node --version
echo [CHECK] Python:
python --version
echo [CHECK] Port aktif:
netstat -aon | findstr /R /C:":%DASHBOARD_PORT% .*LISTENING" /C:":%BACKEND_PORT% .*LISTENING"
echo [CHECK] Selesai. Tidak ada proses yang diubah.
goto :done

:is_listening
set "PORT_LISTENING="
for /f "tokens=5" %%p in ('netstat -aon ^| findstr /R /C:":%~1 .*LISTENING"') do set "PORT_LISTENING=1"
exit /b 0

:failed
echo.
echo Server OMOS belum siap. Perbaiki pesan ERROR di atas lalu jalankan ulang.
exit /b 1

:done
echo.
pause
exit /b 0
