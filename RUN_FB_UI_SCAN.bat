@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Facebook UI Reconnaissance - Codex
echo ==========================================
echo.

where codex >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Codex CLI was not found in PATH.
  echo Install/update Codex CLI first, then run this file again.
  pause
  exit /b 1
)

if not exist "CODEX_FB_UI_SCAN.md" (
  echo [ERROR] CODEX_FB_UI_SCAN.md is missing from this folder.
  pause
  exit /b 1
)

if not exist "fb_ui_probe" mkdir "fb_ui_probe"

echo [INFO] Running one reconnaissance pass only.
echo [INFO] No continuous collection should start in this run.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Get-Content -Raw -Encoding UTF8 '.\CODEX_FB_UI_SCAN.md'; $p | codex exec --skip-git-repo-check --output-last-message '.\fb_ui_probe\codex_last_message.txt' -"

set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo [ERROR] Codex exited with code %ERR%.
  echo Check fb_ui_probe\codex_last_message.txt and terminal output.
) else (
  echo [DONE] Reconnaissance run finished.
  echo Expected outputs are under:
  echo   %CD%\fb_ui_probe\
)
echo.
pause
exit /b %ERR%
