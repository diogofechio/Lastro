@echo off
cd /d "%~dp0..\.."
title Lastro - servidor local
echo Iniciando o servidor local do Lastro.
echo Quando aparecer a mensagem de pronto, abra http://localhost:3000.
node server.js
pause
