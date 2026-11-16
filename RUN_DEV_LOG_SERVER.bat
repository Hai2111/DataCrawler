@echo off
setlocal
cd /d "%~dp0"
node "%~dp0tools\dev-log-server.js"
endlocal
