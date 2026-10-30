@echo off
rem Connects Claude Code on this machine to KH (kh-helper, sign-in, hooks + MCP). No administrator rights needed.
rem   setup-kh-helper.cmd --kh-url http://<host>:9000 [--no-login]
"%~dp0python\python.exe" "%~dp0setup_kh_helper.py" %*
exit /b %errorlevel%
