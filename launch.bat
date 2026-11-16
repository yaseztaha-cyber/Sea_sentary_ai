@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Sea Sentry AI

echo ============================================================
echo   SEA SENTRY AI - local launch
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 20+ is required but "node" was not found.
  echo Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm was not found. Reinstall Node.js with npm included.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set NODE_MAJOR=%%v
if not defined NODE_MAJOR set NODE_MAJOR=0
if %NODE_MAJOR% LSS 20 (
  echo ERROR: Node.js 20 or newer is required. Found:
  node -v
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  >".env" echo DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
  echo Created .env with the default local PostgreSQL URL.
  echo Edit .env if your PostgreSQL user/password is different.
  echo.
)

REM If an instance is already healthy, just open it.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 2; if ($r.ok) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
  echo Sea Sentry AI is already running on port 3000.
  start "" "http://127.0.0.1:3000/app"
  powershell -NoProfile -Command "Start-Sleep -Seconds 2"
  exit /b 0
)

set PORT=3000
for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=3000; while($p -lt 3030 -and (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)){$p++}; $p"') do set PORT=%%P
if "%PORT%"=="3030" (
  echo ERROR: No free port between 3000 and 3029.
  echo Close the application using those ports and try again.
  echo.
  pause
  exit /b 1
)
echo Port: %PORT%

echo Checking PostgreSQL on 127.0.0.1:5432...
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 1 }"
if errorlevel 1 (
  echo PostgreSQL is not responding. Attempting to start the Windows service...
  net start postgresql-x64-16 >nul 2>&1
  powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 1 }"
  if errorlevel 1 (
    echo.
    echo ERROR: PostgreSQL is not reachable on 127.0.0.1:5432.
    echo Start the PostgreSQL service, or edit DATABASE_URL in .env.
    echo If this is a first run, run scripts\setup.ps1 once.
    echo.
    pause
    exit /b 1
  )
)
echo PostgreSQL reachable.

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo ERROR: npm install failed.
    echo.
    pause
    exit /b 1
  )
)

node -e "require('dotenv').config(); const { Client } = require('pg'); const c = new Client({ connectionString: process.env.DATABASE_URL }); c.connect().then(() => c.end()).catch(e => { console.error('DB_ERROR: ' + e.message); process.exit(1); });"
if errorlevel 1 (
  echo.
  echo ERROR: Cannot connect to the database defined by DATABASE_URL in .env.
  echo Verify PostgreSQL credentials and that the "app_db" database exists.
  echo Run scripts\setup.ps1 once if this is a fresh installation.
  echo.
  pause
  exit /b 1
)
echo Database connection OK.

set NEED_BUILD=0
if not exist ".next\BUILD_ID" set NEED_BUILD=1
if "%NEED_BUILD%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$b = (Get-Item '.next/BUILD_ID').LastWriteTimeUtc; $n = Get-ChildItem 'src','public','package.json','next.config.ts','postcss.config.mjs','tsconfig.json' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTimeUtc -gt $b } | Select-Object -First 1; if ($n) { exit 1 } else { exit 0 }"
  if errorlevel 1 set NEED_BUILD=1
)
if "%NEED_BUILD%"=="1" (
  echo Building production bundle...
  call npm run build
  if errorlevel 1 (
    echo.
    echo ERROR: Build failed. See the output above.
    echo.
    pause
    exit /b 1
  )
) else (
  echo Using existing production build.
)

echo.
echo ============================================================
echo   Sea Sentry AI is starting
echo   Website: http://127.0.0.1:%PORT%/
echo   Console: http://127.0.0.1:%PORT%/app
echo.
echo   Keep this window open. Press Ctrl+C to stop the server.
echo ============================================================
echo.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://127.0.0.1:%PORT%/app'"
set NEXT_TELEMETRY_DISABLED=1
call npm start -- -p %PORT% -H 127.0.0.1
if errorlevel 1 (
  echo.
  echo The server stopped with an error. Check the output above.
  pause
  exit /b 1
)

echo.
echo Server stopped.
pause
endlocal
