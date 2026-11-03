@echo off
rem Roda o conector UniPlus nesta janela (para testar). Para deixar ligado sempre,
rem use scripts\instalar-conector.ps1 (tarefa do Windows).
cd /d "%~dp0"
title Conector UniPlus - Shopping Rural

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org.
  pause
  exit /b 1
)
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Arquivo .env criado. Preencha UNIPLUS_API_URL, PORTAL_URL e CONNECTOR_TOKEN e abra de novo.
  notepad ".env"
  exit /b 0
)
if not exist "node_modules" call npm install --no-audit --no-fund

node connector\uniplus-sync.js
pause
