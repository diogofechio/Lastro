Option Explicit

Dim fso, shell, projectRoot, nodePath, launcherPath, stateDirectory
Dim launchId, command, readyPath, errorPath, attempt, readyStream, appUrl
Dim errorStream, errorMessage

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projectRoot = fso.GetParentFolderName(WScript.ScriptFullName)
launcherPath = fso.BuildPath(projectRoot, "scripts\browser-launcher.mjs")
stateDirectory = fso.BuildPath(shell.ExpandEnvironmentStrings("%LOCALAPPDATA%"), "LastroBrowserLauncher")

If Not fso.FileExists(launcherPath) Then
  MsgBox "Não encontrei o inicializador do Lastro. Deixe este arquivo na pasta do projeto.", vbExclamation, "Lastro"
  WScript.Quit 1
End If

nodePath = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
If Not fso.FileExists(nodePath) Then nodePath = "node.exe"

Randomize
launchId = Replace(Replace(Replace(CStr(Now), "/", ""), ":", ""), " ", "") & "-" & Hex(Int(Rnd * 1000000))
readyPath = fso.BuildPath(stateDirectory, "ready-" & launchId & ".txt")
errorPath = fso.BuildPath(stateDirectory, "error-" & launchId & ".txt")
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & launcherPath & Chr(34) & " " & Chr(34) & launchId & Chr(34)

On Error Resume Next
shell.Run command, 0, False
If Err.Number <> 0 Then
  MsgBox "Não consegui iniciar o Node.js. Instale o Node.js 22 ou superior e tente novamente.", vbExclamation, "Lastro"
  WScript.Quit 1
End If
On Error GoTo 0

For attempt = 1 To 80
  If fso.FileExists(readyPath) Then Exit For
  If fso.FileExists(errorPath) Then Exit For
  WScript.Sleep 250
Next

If fso.FileExists(errorPath) Then
  Set errorStream = fso.OpenTextFile(errorPath, 1, False)
  errorMessage = errorStream.ReadAll
  errorStream.Close
  fso.DeleteFile errorPath, True
  MsgBox "O Lastro não iniciou." & vbCrLf & errorMessage, vbExclamation, "Lastro"
  WScript.Quit 1
End If

If Not fso.FileExists(readyPath) Then
  MsgBox "O Lastro demorou demais para iniciar. Tente novamente.", vbExclamation, "Lastro"
  WScript.Quit 1
End If

Set readyStream = fso.OpenTextFile(readyPath, 1, False)
appUrl = readyStream.ReadLine
readyStream.Close
fso.DeleteFile readyPath, True
On Error Resume Next
shell.Run appUrl, 1, False
If Err.Number <> 0 Then
  MsgBox "O servidor iniciou, mas o navegador não abriu automaticamente. Copie este endereço para o navegador:" & vbCrLf & appUrl, vbExclamation, "Lastro"
End If
On Error GoTo 0
