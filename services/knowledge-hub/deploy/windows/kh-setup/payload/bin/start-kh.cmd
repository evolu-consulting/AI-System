@echo off
rem Starts the Knowledge Hub server (settings in kh\.env). Run by the scheduled task "KH Server".
rem KnowledgeHub.exe writes its own log to kh\logs\app.out.log.
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%\kh"
start "" /wait "%ROOT%\kh\KnowledgeHub.exe"
