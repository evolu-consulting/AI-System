@echo off
REM ============================================================
REM  KnowledgeHub - RAG / knowledge service (FastAPI, port 8000)
REM
REM  Usage:
REM    run.bat            Smart start: if KnowledgeHub is already
REM                       running & healthy, attach (no duplicate).
REM                       Otherwise kill any stale/wedged instance
REM                       (which holds the single-writer Kuzu lock)
REM                       and start fresh.
REM    run.bat restart    Force: always kill the old instance and
REM                       start a new one, even if it is healthy.
REM ============================================================
title KnowledgeHub

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

REM --- force-restart flag -------------------------------------------------
set "FORCEFLAG="
if /I "%~1"=="restart" set "FORCEFLAG=--force"
if /I "%~1"=="-f"      set "FORCEFLAG=--force"
if /I "%~1"=="force"   set "FORCEFLAG=--force"

REM --- virtualenv: auto-create on first run, else just activate -----------
set "VENV_DIR=%PROJECT_DIR%.venv"
set "VENV_ACTIVATE=%VENV_DIR%\Scripts\activate.bat"
if not exist "%VENV_ACTIVATE%" (
    echo Khong tim thay virtualenv - tao moi va cai requirements ...
    call :make_venv
    if errorlevel 1 goto :end
) else (
    echo Kich hoat virtualenv ...
    call "%VENV_ACTIVATE%"
)

REM --- port is owned by env / .env (app\config.py); run.bat never forces it. --
REM     Read the effective port from config for DISPLAY ONLY so the URLs below
REM     stay accurate whatever KH_PORT is set to in .env.
set "DISP_PORT="
for /f "delims=" %%p in ('python -c "from app.config import PORT;print(PORT)"') do set "DISP_PORT=%%p"
if not defined DISP_PORT set "DISP_PORT=8000"

REM --- smart preflight: attach-if-healthy, else kill stale & release lock --
python preflight.py %FORCEFLAG%
set "PRECODE=%ERRORLEVEL%"

if "%PRECODE%"=="10" (
    echo.
    echo KnowledgeHub da chay san va khoe manh tren http://localhost:%DISP_PORT%
    echo   - API docs : http://localhost:%DISP_PORT%/docs
    echo   - Health   : http://localhost:%DISP_PORT%/health
    echo Dung lai tien trinh cu, khong mo trung. ^(Dung "run.bat restart" de khoi dong lai.^)
    goto :end
)
if not "%PRECODE%"=="0" (
    echo.
    echo [ERROR] Preflight that bai ^(ma %PRECODE%^). Xem thong bao o tren.
    goto :end
)

echo Starting KnowledgeHub on http://localhost:%DISP_PORT% ...
python main.py

:end
echo.
echo KnowledgeHub da dung. Nhan phim bat ky de dong cua so.
pause >nul
goto :eof

REM ============================================================
REM  Helper: create the virtualenv and install requirements.
REM  Runs only when .venv does not exist yet (first launch).
REM  Returns errorlevel 1 on any failure.
REM ============================================================
:make_venv
set "BOOT_PY="
where python >nul 2>nul && set "BOOT_PY=python"
if not defined BOOT_PY (
    where py >nul 2>nul && set "BOOT_PY=py -3"
)
if not defined BOOT_PY (
    echo [ERROR] Khong tim thay Python tren PATH. Hay cai Python 3 truoc.
    exit /b 1
)

echo Dung "%BOOT_PY%" de tao virtualenv tai "%VENV_DIR%" ...
%BOOT_PY% -m venv "%VENV_DIR%"
if errorlevel 1 (
    echo [ERROR] Tao virtualenv that bai.
    exit /b 1
)

echo Kich hoat virtualenv ...
call "%VENV_ACTIVATE%"

echo Nang cap pip ...
python -m pip install --upgrade pip

echo Cai requirements (lan dau co the mat vai phut) ...
python -m pip install -r "%PROJECT_DIR%requirements.txt"
if errorlevel 1 (
    echo [ERROR] Cai requirements that bai.
    exit /b 1
)

echo Virtualenv da san sang.
exit /b 0
