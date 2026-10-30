@echo off
setlocal
title Criar atalho do Lastro
echo Criando atalho na Area de Trabalho...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = [IO.Path]::GetFullPath((Join-Path '%~dp0' '..\..')); $desktop = [Environment]::GetFolderPath('Desktop'); $target = Join-Path $root 'scripts\windows\Abrir Informes.vbs'; $shortcutPath = Join-Path $desktop 'Lastro.lnk'; $ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut($shortcutPath); $s.TargetPath = 'wscript.exe'; $s.Arguments = ('"' + $target + '"'); $s.WorkingDirectory = $root; $s.Description = 'Abrir Lastro'; $s.Save(); Write-Host 'Atalho criado:' $shortcutPath -ForegroundColor Green"
pause
