[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$runtimeDir = Join-Path $projectRoot '.runtime'

function Stop-RecordedProcess([string]$PidFile, [string[]]$AllowedNames, [string]$Label) {
  if (-not (Test-Path -LiteralPath $PidFile -PathType Leaf)) {
    Write-Host "[INFO] PID $Label tidak tercatat."
    return
  }
  $recordedPid = [int](Get-Content -LiteralPath $PidFile -Raw).Trim()
  $process = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
  if ($process -and $AllowedNames -contains $process.ProcessName) {
    Stop-Process -Id $recordedPid -Force
    Write-Host "[OK] $Label dihentikan (PID $recordedPid)."
  } elseif ($process) {
    Write-Warning "PID $recordedPid bukan proses $Label; tidak dihentikan."
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

Stop-RecordedProcess (Join-Path $runtimeDir 'biznet-tunnel.pid') @('ssh') 'SSH tunnel Biznet'
Stop-RecordedProcess (Join-Path $runtimeDir 'dashboard.pid') @('python','python3') 'dashboard lokal'
