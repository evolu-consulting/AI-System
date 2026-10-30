@echo off
rem Removes this KH install (tasks, service, firewall rules). Add --delete-data to remove the folder too.
rem Run from an elevated Command Prompt when it was installed with services (the default).
"%~dp0python\python.exe" "%~dp0setup\uninstall.py" %*
exit /b %errorlevel%
