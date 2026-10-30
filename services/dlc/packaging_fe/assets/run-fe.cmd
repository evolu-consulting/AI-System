@echo off
rem Start the default DLC frontend. Settings come from fe.config.json next to this file (copy
rem fe.config.example.json and fill it in); environment variables with the same names win over the file.
setlocal
cd /d "%~dp0"
if not exist fe.config.json (
  echo fe.config.json is missing: copy fe.config.example.json to fe.config.json and fill it in.
  exit /b 2
)
set SDLC_CONFIG=%~dp0fe.config.json
dlc-fe.exe seed-flows
dlc-fe.exe serve
