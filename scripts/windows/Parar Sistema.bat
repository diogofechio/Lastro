@echo off
title Parar Lastro
echo Encerrando o servidor local do Lastro...
taskkill /F /IM node.exe >nul 2>&1
echo Lastro encerrado.
timeout /t 2 >nul
