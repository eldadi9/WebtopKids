Dim appDir
appDir = "c:\Users\Master_PC\Desktop\Projects Eldad\01_Active_Projects\n8n\Webtop_APP"

Dim nodePath
nodePath = "C:\Program Files\nodejs\node.exe"

Dim scriptPath
scriptPath = appDir & "\push_loop.mjs"

' Run node silently (no console window)
Dim wsh
Set wsh = CreateObject("WScript.Shell")
wsh.CurrentDirectory = appDir
wsh.Run """" & nodePath & """ """ & scriptPath & """", 0, False
Set wsh = Nothing
