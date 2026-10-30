Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set http = CreateObject("MSXML2.XMLHTTP")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
WshShell.CurrentDirectory = projectDir

' Start the local server without showing a terminal.
WshShell.Run "node server.js", 0, False

' Wait for the server before opening the app window.
ready = False
For attempt = 1 To 40
  On Error Resume Next
  http.Open "GET", "http://localhost:3000/api/investments", False
  http.Send
  If Err.Number = 0 And http.Status = 200 Then ready = True
  Err.Clear
  On Error GoTo 0
  If ready Then Exit For
  WScript.Sleep 250
Next

If Not ready Then
  MsgBox "O servidor do Lastro não iniciou. Confira se o Node.js está instalado e tente novamente.", 48, "Lastro"
  WScript.Quit 1
End If

operaPath = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Opera GX\opera.exe"
If fso.FileExists(operaPath) Then
  WshShell.Run """" & operaPath & """ --app=http://localhost:3000"
Else
  WshShell.Run "http://localhost:3000"
End If
