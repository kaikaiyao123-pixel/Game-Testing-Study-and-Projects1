@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 18+ is required but not found in PATH.
  echo         Install from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

echo Starting blog auth service ...
echo Open http://127.0.0.1:3000/login.html in your browser.
echo.
node server/app.js
pause
