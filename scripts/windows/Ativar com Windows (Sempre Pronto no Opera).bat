@echo off
setlocal
title Iniciar Lastro com o Windows
echo Configurando a inicializacao automatica...
set "SCRIPT=%TEMP%\lastro-startup.vbs"
echo Set ws = WScript.CreateObject("WScript.Shell") > "%SCRIPT%"
echo link = ws.SpecialFolders("Startup") ^& "\Lastro.lnk" >> "%SCRIPT%"
echo Set shortcut = ws.CreateShortcut(link) >> "%SCRIPT%"
echo shortcut.TargetPath = "wscript.exe" >> "%SCRIPT%"
echo shortcut.Arguments = """" ^& "%~dp0Iniciar (Sem Terminal).vbs" ^& """" >> "%SCRIPT%"
echo shortcut.WorkingDirectory = "%~dp0..\.." >> "%SCRIPT%"
echo shortcut.Description = "Servidor local do Lastro" >> "%SCRIPT%"
echo shortcut.Save >> "%SCRIPT%"
cscript //nologo "%SCRIPT%"
del "%SCRIPT%"
echo Inicializacao automatica configurada.
pause
