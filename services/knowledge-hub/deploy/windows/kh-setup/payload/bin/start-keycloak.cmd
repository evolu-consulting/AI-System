@echo off
rem Starts the KH Keycloak (HANA/PostgreSQL fork + KH extension) with the bundled Java 21.
rem Run by the scheduled task "KH Keycloak"; settings are in keycloak\conf\keycloak.conf.
setlocal
set "ROOT=%~dp0.."
set "JAVA_HOME=%ROOT%\jre"
set "PATH=%JAVA_HOME%\bin;%PATH%"
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
call "%ROOT%\keycloak\bin\kc.bat" start --optimized >> "%ROOT%\logs\keycloak.log" 2>&1
