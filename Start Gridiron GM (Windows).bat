@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org ^(the LTS version^), install it, then double-click this file again.
  pause
  exit /b 1
)
start "" http://localhost:3000
node server.js
pause
