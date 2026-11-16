Set-Location (Join-Path $PSScriptRoot "..")
if (Test-Path "data/server.pid") {
  $id = [int](Get-Content "data/server.pid")
  Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $id } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  Remove-Item "data/server.pid"
  Write-Host "Sea Sentry AI stopped." -ForegroundColor Green
} else {
  Write-Host "No running instance recorded (data/server.pid not found)."
}
