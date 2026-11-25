@echo off
setlocal
REM ===== Portable CDP launcher: Microsoft Edge =====
REM Double-click this bat. It auto-detects the USB drive letter it lives on.
REM One browser = one shop = one debug port. Do not run two on the same port.

set "BASE=%~dp0"
set "UDISK=%~d0"
set "PORT=9222"
REM Keep the existing Edge profile so the current login state is preserved.
set "PROFILE=%UDISK%\edge-cdp-profile"

set "EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EXE%" (
  echo [ERROR] Microsoft Edge not found on this PC.
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
echo Browser : Microsoft Edge
echo Port    : %PORT%
echo Profile : %PROFILE%
echo USB dir : %BASE%
echo.
start "" "%EXE%" --user-data-dir="%PROFILE%" --remote-debugging-port=%PORT% --remote-allow-origins=* --no-first-run --no-default-browser-check
echo Started. Log in today's shop, then tell the AI: CDP_PORT=%PORT%
timeout /t 4 >nul
