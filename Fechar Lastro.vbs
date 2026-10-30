Option Explicit

Dim fso, shell, stateDirectory, statePath, stateStream, appUrl, token, http

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
stateDirectory = fso.BuildPath(shell.ExpandEnvironmentStrings("%LOCALAPPDATA%"), "LastroBrowserLauncher")
statePath = fso.BuildPath(stateDirectory, "session.txt")

If Not fso.FileExists(statePath) Then
  MsgBox "O servidor local do Lastro já está fechado.", vbInformation, "Lastro"
  WScript.Quit 0
End If

Set stateStream = fso.OpenTextFile(statePath, 1, False)
appUrl = stateStream.ReadLine
token = stateStream.ReadLine
stateStream.Close

On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "POST", appUrl & "/api/launcher/close", False
http.setRequestHeader "X-Lastro-Launcher-Token", token
http.Send ""
If Err.Number <> 0 Or http.Status <> 200 Then
  MsgBox "Não consegui fechar o servidor local do Lastro. Tente abrir o app e fechar novamente.", vbExclamation, "Lastro"
  WScript.Quit 1
End If
On Error GoTo 0

MsgBox "Servidor do Lastro fechado. Você já pode fechar a aba do navegador.", vbInformation, "Lastro"
