@echo off
title Desativar inicio automatico do Lastro
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Lastro.lnk" >nul 2>&1
echo Inicializacao automatica do Lastro desativada.
pause
