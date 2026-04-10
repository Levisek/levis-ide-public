Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\dev\levis-ide-public"
WshShell.Run "cmd /c npx electron .", 0, False
