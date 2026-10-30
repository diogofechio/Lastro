Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set http = CreateObject("MSXML2.XMLHTTP")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
WshShell.CurrentDirectory = projectDir

' Do not start a second server if this project is already running.
On Error Resume Next
http.Open "GET", "http://localhost:3000/api/investments", False
http.Send
serverReady = (Err.Number = 0 And http.Status = 200)
Err.Clear
On Error GoTo 0
If Not serverReady Then WshShell.Run "node server.js", 0, False
