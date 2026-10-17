[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$runtimeDir = Join-Path $projectRoot '.runtime'
$keyPath = Join-Path $projectRoot 'omos-key.pem'
$dashboardDir = Join-Path $projectRoot 'admin-dashboard'
$sshHost = '103.58.101.240'
$sshUser = 'adminbiznet'
$apiPort = 13000
$databasePort = 15432
$dashboardPort = 8080
$tunnelPidFile = Join-Path $runtimeDir 'biznet-tunnel.pid'
$dashboardPidFile = Join-Path $runtimeDir 'dashboard.pid'

function Test-ListeningPort([int]$Port) {
  return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Wait-ApiHealth([int]$Port, [int]$Attempts = 15) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return $true }
    } catch {
      Start-Sleep -Milliseconds 700
    }
  }
  return $false
}

if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf)) {
  throw "Private key tidak ditemukan: $keyPath"
}
if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) {
  throw 'OpenSSH Client (ssh.exe) tidak tersedia.'
}
if (-not (Get-Command python.exe -ErrorAction SilentlyContinue)) {
  throw 'Python tidak tersedia untuk dashboard statis lokal.'
}
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

$sshBase = @(
  '-i', $keyPath,
  '-o', 'IdentitiesOnly=yes',
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  '-o', 'StrictHostKeyChecking=accept-new'
)

Write-Host '[1/4] Memverifikasi SSH Biznet...'
$sshCheck = & ssh.exe @sshBase "$sshUser@$sshHost" 'printf SSH_OK'
if ($LASTEXITCODE -ne 0 -or $sshCheck -ne 'SSH_OK') {
  throw 'SSH Biznet gagal. Periksa koneksi internet, firewall, Fail2Ban, dan private key.'
}

Write-Host '[2/4] Menentukan endpoint PostgreSQL internal...'
$databaseIp = (& ssh.exe @sshBase "$sshUser@$sshHost" "docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' omos-postgres-staging").Trim()
if ($LASTEXITCODE -ne 0 -or $databaseIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
  throw 'IP internal PostgreSQL Biznet tidak dapat ditentukan.'
}

$apiHealthy = (Test-ListeningPort $apiPort) -and (Wait-ApiHealth $apiPort 1)
if (-not $apiHealthy) {
  if (Test-ListeningPort $apiPort) { throw "Port lokal $apiPort dipakai proses lain." }
  if (Test-ListeningPort $databasePort) { throw "Port lokal $databasePort dipakai proses lain." }

  Write-Host '[3/4] Membuka tunnel API dan database pada loopback...'
  $tunnelArgs = @(
    '-N', '-T',
    '-i', $keyPath,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-L', "127.0.0.1:${apiPort}:127.0.0.1:3000",
    '-L', "127.0.0.1:${databasePort}:${databaseIp}:5432",
    "$sshUser@$sshHost"
  )
  $tunnelProcess = Start-Process -FilePath 'ssh.exe' -ArgumentList $tunnelArgs -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $tunnelPidFile -Value $tunnelProcess.Id -Encoding ascii
  if (-not (Wait-ApiHealth $apiPort)) {
    if (-not $tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id -Force }
    throw 'Tunnel terbentuk tetapi API Biznet tidak merespons melalui port 13000.'
  }
} else {
  Write-Host '[3/4] Tunnel API yang sehat sudah aktif; memakai proses tersebut.'
}

Write-Host '[4/4] Menyiapkan dashboard lokal...'
if (-not (Test-ListeningPort $dashboardPort)) {
  $dashboardProcess = Start-Process -FilePath 'python.exe' -ArgumentList @('-m','http.server',"$dashboardPort") -WorkingDirectory $dashboardDir -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $dashboardPidFile -Value $dashboardProcess.Id -Encoding ascii
  Start-Sleep -Seconds 1
}

if (-not (Test-ListeningPort $dashboardPort)) {
  throw "Dashboard lokal gagal listen pada port $dashboardPort."
}

Write-Host ''
Write-Host '[OK] OMOS lokal terhubung langsung ke API Biznet melalui SSH.' -ForegroundColor Green
Write-Host "Dashboard : http://localhost:$dashboardPort/?api_mode=biznet"
Write-Host "API tunnel: http://127.0.0.1:$apiPort"
Write-Host "DB tunnel : 127.0.0.1:$databasePort (loopback only)"
Write-Host 'Credential database tetap dikelola di secret server dan tidak dicetak.'
Start-Process "http://localhost:$dashboardPort/?api_mode=biznet"
