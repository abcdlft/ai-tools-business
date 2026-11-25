@echo off
setlocal
REM ===== Portable CDP launcher: QQ Browser (QQ浏览器) =====
REM Double-click this bat. It auto-detects the USB drive letter it lives on.

set "BASE=%~dp0"
set "PORT=9224"
set "PROFILE=%BASE%profiles\qqbrowser"

set "EXE=%ProgramFiles%\Tencent\QQBrowser\QQBrowser.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles(x86)%\Tencent\QQBrowser\QQBrowser.exe"
if not exist "%EXE%" set "EXE=%LOCALAPPDATA%\Tencent\QQBrowser\QQBrowser.exe"
if not exist "%EXE%" (
  echo [ERROR] QQ Browser not found on this PC.
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
echo Browser : QQ Browser
echo Port    : %PORT%
echo Profile : %PROFILE%
echo USB dir : %BASE%
echo.
start "" "%EXE%" --user-data-dir="%PROFILE%" --remote-debugging-port=%PORT% --remote-allow-origins=* --no-first-run --no-default-browser-check
echo Started. Log in today's shop, then tell the AI: CDP_PORT=%PORT%
timeout /t 4 >nul
