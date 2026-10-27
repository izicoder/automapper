@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :failed
)

echo Building...
call npm run build
if errorlevel 1 goto :failed

node dist\src\ui\server.js %*
if errorlevel 1 pause
exit /b 0

:failed
echo.
echo Build failed, see the messages above.
pause
exit /b 1
