# Instala o conector UniPlus como tarefa do Windows: liga junto com o computador da loja,
# roda em segundo plano (sem janela) e reinicia sozinho se cair.
#
# Uso (PowerShell como Administrador, na pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File scripts\instalar-conector.ps1
# Remover:
#   powershell -ExecutionPolicy Bypass -File scripts\instalar-conector.ps1 -Remover
# Ver o log:  data\conector.log

param([switch]$Remover)

$ErrorActionPreference = 'Stop'
$nome = 'Shopping Rural - Conector UniPlus'
$pasta = Split-Path -Parent $PSScriptRoot

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Abra o PowerShell como Administrador e rode de novo.' -ForegroundColor Red; exit 1 }

if ($Remover) {
  Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarefa '$nome' removida."
  exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host 'Node.js não encontrado. Instale a versão LTS em https://nodejs.org.' -ForegroundColor Red; exit 1 }

$envFile = Join-Path $pasta '.env'
if (-not (Test-Path $envFile)) { Write-Host 'Crie o arquivo .env (copie de .env.example).' -ForegroundColor Red; exit 1 }
$envText = Get-Content $envFile -Raw
foreach ($chave in 'UNIPLUS_API_URL', 'PORTAL_URL', 'CONNECTOR_TOKEN') {
  if ($envText -notmatch "(?m)^\s*$chave\s*=\s*\S+") { Write-Host "Preencha $chave no .env." -ForegroundColor Red; exit 1 }
}

New-Item -ItemType Directory -Force (Join-Path $pasta 'data') | Out-Null
$log = Join-Path $pasta 'data\conector.log'
$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$node`" connector\uniplus-sync.js >> `"$log`" 2>&1`"" -WorkingDirectory $pasta
$gatilho = New-ScheduledTaskTrigger -AtStartup
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$usuario = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $config -Principal $usuario -Force | Out-Null
Start-ScheduledTask -TaskName $nome
Write-Host "Conector instalado e iniciado. Ele liga sozinho com o Windows." -ForegroundColor Green
Write-Host "Log: $log"
