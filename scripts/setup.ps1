$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "Sea Sentry AI — setup" -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20+ is required (https://nodejs.org)." }
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { throw "Node.js 20 or newer is required. Found $(node -v)." }

if (-not (Test-Path ".env")) {
  Set-Content ".env" "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db"
  Write-Host "Created .env — edit DATABASE_URL if your PostgreSQL credentials differ." -ForegroundColor Yellow
}

npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host "Applying database schema..."
npx drizzle-kit push --force
if ($LASTEXITCODE -ne 0) { throw "Database schema push failed. Is PostgreSQL running and DATABASE_URL correct?" }

foreach ($f in @("public/models/coco-ssd-lite/model.json", "public/video/demo.mp4", "public/fonts/ClashDisplay-Variable.woff2")) {
  if (-not (Test-Path $f)) { throw "Missing required artifact: $f" }
}
Write-Host "Model artifacts verified (COCO-SSD lite, see MODEL_CARD.md)." -ForegroundColor Green

npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
Write-Host "Camera access is provided by the browser. Open /app and press 'Connect camera' to verify your webcam." -ForegroundColor Green
