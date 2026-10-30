@echo off
rem Knowledge Hub + Keycloak installer. Run from an elevated Command Prompt ("Run as administrator").
rem   install-kh.cmd --admin-email you@company.com [--admin-first Jane --admin-last Doe] [--public-host kh-server.corp.local]
rem All options: install-kh.cmd --help
"%~dp0payload\python\python.exe" "%~dp0payload\setup\install.py" %*
exit /b %errorlevel%
