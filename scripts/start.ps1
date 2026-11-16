$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Test-PortFree([int]$p) { -not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) }
$port = 3000
while (-not (Test-PortFree $port) -and $port -lt 3020) { $port++ }
if (-not (Test-PortFree $port)) { throw "No free port between 3000 and 3019." }

New-Item -ItemType Directory -Force -Path "data" | Out-Null
if (-not (Test-Path ".next")) { npm run build; if ($LASTEXITCODE -ne 0) { throw "Build failed" } }

$proc = Start-Process -FilePath "npx.cmd" -ArgumentList "next", "start", "-p", $port, "-H", "127.0.0.1" -PassThru -WindowStyle Hidden -RedirectStandardOutput "data/server.log" -RedirectStandardError "data/server.err.log"
Set-Content "data/server.pid" $proc.Id

$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 750
  try { if ((Invoke-RestMethod "http://127.0.0.1:$port/api/health").ok) { $ok = $true; break } } catch {}
}
if (-not $ok) { throw "Health check failed. See data/server.err.log" }
Write-Host "Sea Sentry AI is running" -ForegroundColor Green
Write-Host "  Website:  http://127.0.0.1:$port"
Write-Host "  Platform: http://127.0.0.1:$port/app"
Write-Host "  Health:   http://127.0.0.1:$port/api/health"
