@echo off
setlocal
REM ===== Generic portable CDP launcher template =====
REM Copy this file, rename it, then edit the 4 lines marked EDIT below.
REM Works for any Chromium-based browser (360 / 2345 / Quark / Brave / Vivaldi ...).
REM Only Chromium-kernel browsers support --remote-debugging-port.
REM Firefox does NOT support CDP and cannot be used by the AI control channel.

set "BASE=%~dp0"

REM --- EDIT 1: debug port, must be unique across all browsers (9222-9229) ---
set "PORT=9226"
REM --- EDIT 2: profile folder name under .\profiles\ ---
set "PROFILE=%BASE%profiles\custom"
REM --- EDIT 3: browser exe paths, add more fallback lines as needed ---
set "EXE=%ProgramFiles(x86)%\MyBrowser\Application\browser.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles%\MyBrowser\Application\browser.exe"
if not exist "%EXE%" set "EXE=%LOCALAPPDATA%\MyBrowser\Application\browser.exe"
REM --- EDIT 4 (optional): display name ---
set "NAME=Custom Browser"
REM --- end edits ---

if not exist "%EXE%" (
  echo [ERROR] %NAME% not found. Edit EXE paths in this bat.
  pause
  exit /b 1
)

netstat -ano | findstr ":%PORT% " >nul 2>&1
if not errorlevel 1 (
  echo [WARN] Port %PORT% is already in use. Edit PORT in this bat.
  pause
  exit /b 1
)

if not exist "%PROFILE%" mkdir "%PROFILE%"
echo Browser : %NAME%
echo Port    : %PORT%
echo Profile : %PROFILE%
echo.
start "" "%EXE%" --user-data-dir="%PROFILE%" --remote-debugging-port=%PORT% --remote-allow-origins=* --no-first-run --no-default-browser-check
echo Started. Log in today's shop, then tell the AI: CDP_PORT=%PORT%
timeout /t 4 >nul
