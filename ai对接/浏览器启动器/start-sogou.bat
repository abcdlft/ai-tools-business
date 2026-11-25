@echo off
setlocal
REM ===== Portable CDP launcher: Sogou Explorer (搜狗高速浏览器) =====
REM Double-click this bat. It auto-detects the USB drive letter it lives on.

set "BASE=%~dp0"
set "PORT=9225"
set "PROFILE=%BASE%profiles\sogou"

set "EXE=%ProgramFiles(x86)%\Sogou\SogouExplorer\SogouExplorer.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles%\Sogou\SogouExplorer\SogouExplorer.exe"
if not exist "%EXE%" set "EXE=%LOCALAPPDATA%\Sogou\SogouExplorer\SogouExplorer.exe"
if not exist "%EXE%" (
  echo [ERROR] Sogou Explorer not found on this PC.
  pause
  exit /b 1
)

netstat -ano | findstr ":%PORT% " >nul 2>&1
if not errorlevel 1 (
  echo [WARN] Port %PORT% is already in use. Close the previous debug session, or edit PORT in this bat.
  pause
  exit /b 1
)

if not exist "%PROFILE%" mkdir "%PROFILE%"
echo Browser : Sogou Explorer
echo Port    : %PORT%
echo Profile : %PROFILE%
echo USB dir : %BASE%
echo.
start "" "%EXE%" --user-data-dir="%PROFILE%" --remote-debugging-port=%PORT% --remote-allow-origins=* --no-first-run --no-default-browser-check
echo Started. Log in today's shop, then tell the AI: CDP_PORT=%PORT%
timeout /t 4 >nul
