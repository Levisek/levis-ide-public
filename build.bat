@echo off
REM TypeScript build — zkompiluje do dist/
setlocal

cd /d "%~dp0"
echo === npx tsc ===
call npx tsc
if errorlevel 1 (
  echo [CHYBA] tsc nasel chyby
  pause
  exit /b 1
)

echo.
echo OK - zkompilovano do dist/
pause
endlocal
