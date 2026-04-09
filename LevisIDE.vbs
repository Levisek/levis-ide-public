Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\dev\levis-ide"
WshShell.Run "cmd /c npx electron .", 0, False
