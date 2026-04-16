@echo off
REM Instalace zavislosti projektu
setlocal

cd /d "%~dp0"
echo === npm install ===
call npm install
if errorlevel 1 (
  echo [CHYBA] npm install selhal
  pause
  exit /b 1
)

echo.
echo OK - zavislosti nainstalovany
pause
endlocal
