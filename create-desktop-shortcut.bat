@echo off
REM Vytvori zastupce LevisIDE na plose (dev rezim, cili na electron.exe + cestu k projektu)
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
if "!ROOT:~-1!"=="\" set "ROOT=!ROOT:~0,-1!"

set "TARGET=!ROOT!\node_modules\electron\dist\electron.exe"
set "ICON=!ROOT!\assets\icon.ico"
set "LNK=%USERPROFILE%\Desktop\LevisIDE.lnk"

if not exist "!TARGET!" (
  echo [CHYBA] Nenalezen Electron runtime: !TARGET!
  echo Nejdriv spust: npm install
  pause
  exit /b 1
)

if not exist "!ICON!" (
  echo [WARN] Ikona nenalezena: !ICON!  — pouziji default z exe
  set "ICON=!TARGET!"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$s = $ws.CreateShortcut('%LNK%');" ^
  "$s.TargetPath = '!TARGET!';" ^
  "$s.Arguments = '\"!ROOT!\"';" ^
  "$s.WorkingDirectory = '!ROOT!';" ^
  "$s.IconLocation = '!ICON!,0';" ^
  "$s.Description = 'LevisIDE - Project Hub';" ^
  "$s.Save()"

if errorlevel 1 (
  echo [CHYBA] Vytvoreni zastupce selhalo
  pause
  exit /b 1
)

echo OK - zastupce vytvoren: %LNK%
pause
endlocal
