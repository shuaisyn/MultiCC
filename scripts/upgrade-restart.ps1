param(
  [int]$Port = 3000,
  [string]$Node = "C:\Program Files\nodejs\node.exe",
  [int]$HealthTimeoutSec = 30,
  [switch]$SkipUpgrade
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $RepoRoot "logs"
$OutLog = Join-Path $LogDir "multicc.out.log"
$ErrLog = Join-Path $LogDir "multicc.err.log"

function Get-ListeningPids {
  param([int]$TargetPort)
  @(Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -and $_ -gt 0 })
}

function Stop-MultiCCService {
  $pids = Get-ListeningPids -TargetPort $Port
  if (!$pids.Count) {
    Write-Output "MultiCC is not listening on port $Port"
    return
  }

  foreach ($pidValue in $pids) {
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($process) {
      Write-Output "Stopping MultiCC process pid=$pidValue on port $Port"
      Stop-Process -Id $pidValue -Force
    }
  }

  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    if (!(Get-ListeningPids -TargetPort $Port).Count) {
      Write-Output "MultiCC stopped"
      return
    }
    Start-Sleep -Milliseconds 300
  }

  throw "Timed out waiting for port $Port to stop listening"
}

function Invoke-MultiCCUpgrade {
  Push-Location $RepoRoot
  try {
    git remote add upstream https://github.com/lsjwzh/MultiCC.git 2>$null
    git fetch upstream
    if ($LASTEXITCODE -eq 0) { git checkout main }
    if ($LASTEXITCODE -eq 0) { git merge --ff-only upstream/main }
    if ($LASTEXITCODE -eq 0) { git push origin main }
    return $LASTEXITCODE
  } finally {
    Pop-Location
  }
}

function Start-MultiCCService {
  if ((Get-ListeningPids -TargetPort $Port).Count) {
    Write-Output "MultiCC is already listening on port $Port"
    return
  }

  if (!(Test-Path -LiteralPath $Node)) {
    $Node = "node"
  }

  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Write-Output "Starting MultiCC on port $Port"
  Start-Process -FilePath $Node `
    -ArgumentList "server.js" `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog

  $healthUrl = "http://127.0.0.1:$Port/manage"
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        $pidText = (Get-ListeningPids -TargetPort $Port) -join ","
        Write-Output "MultiCC started on $healthUrl pid=$pidText"
        return
      }
    } catch {
      Start-Sleep -Milliseconds 700
    }
  }

  throw "MultiCC did not become healthy at $healthUrl"
}

$upgradeExitCode = 0
try {
  Stop-MultiCCService
  if ($SkipUpgrade) {
    Write-Output "Skipping git upgrade because -SkipUpgrade was provided"
  } else {
    $upgradeExitCode = Invoke-MultiCCUpgrade
    if ($upgradeExitCode -ne 0) {
      Write-Output "Upgrade failed with exit code $upgradeExitCode; service restart will still be attempted"
    }
  }
} finally {
  Start-MultiCCService
}

exit $upgradeExitCode
