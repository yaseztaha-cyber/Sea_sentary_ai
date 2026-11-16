$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
Write-Host "Type generation..." ; npx next typegen; if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "TypeScript..."      ; npm exec tsc -- --noEmit --pretty false; if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "Production build..."; npm run build; if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "All automated checks passed. Camera, AI and visual tests are manual: open /app, connect a webcam, run AI, press 'Run TEST observation'." -ForegroundColor Green
