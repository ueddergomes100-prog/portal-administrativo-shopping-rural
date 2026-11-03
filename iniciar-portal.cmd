@echo off
rem Inicia o Portal Shopping Rural na maquina da loja.
rem Duplo clique para abrir. Feche esta janela para desligar o portal.
cd /d "%~dp0"
title Portal Shopping Rural

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e abra este arquivo de novo.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Arquivo .env criado a partir do exemplo. Ajuste UNIPLUS_API_URL e SESSION_SECRET e abra de novo.
  notepad ".env"
  exit /b 0
)

if not exist "node_modules" (
  echo Instalando dependencias...
  call npm install --no-audit --no-fund
)

echo Abrindo o portal em http://localhost:4173
start "" http://localhost:4173
node server.js
pause
