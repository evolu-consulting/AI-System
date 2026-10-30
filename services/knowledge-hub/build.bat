@echo off
REM ============================================================
REM  KnowledgeHub - build to a standalone ONE-DIR, windowed
REM  (no-console) app folder: dist\KnowledgeHub\KnowledgeHub.exe
REM
REM  Batch launcher (no PowerShell) so it works even on machines
REM  that enforce PowerShell Constrained Language Mode (AppLocker /
REM  WDAC), where build.ps1 fails with "different language mode".
REM  It just drives KnowledgeHub.spec with the project venv.
REM
REM  Usage:
REM    build.bat            Clean build (pyinstaller --clean).
REM    build.bat fast       Reuse the previous build cache (faster).
REM ============================================================
setlocal
title KnowledgeHub build

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

REM --- clean flag (default: clean; "fast" reuses cache) -------------------
set "CLEANFLAG=--clean"
if /I "%~1"=="fast"    set "CLEANFLAG="
if /I "%~1"=="noclean" set "CLEANFLAG="

REM --- locate the venv python (deps must already be installed) ------------
set "PY=%PROJECT_DIR%.venv\Scripts\python.exe"
if not exist "%PY%" (
    echo [ERROR] Khong tim thay virtualenv tai "%PY%".
    echo         Tao truoc:  python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
    goto :fail
)

REM --- core deps sanity check ---------------------------------------------
echo === Kiem tra runtime deps ===
"%PY%" -c "import torch,transformers,chromadb,sentence_transformers,fastapi,uvicorn" 2>nul
if errorlevel 1 (
    echo [ERROR] Thieu runtime deps trong .venv.
    echo         Chay:  .venv\Scripts\pip install -r requirements.txt
    goto :fail
)
echo     runtime deps OK

REM --- ensure PyInstaller is present --------------------------------------
"%PY%" -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo PyInstaller chua co -^> cai vao .venv ...
    "%PY%" -m pip install pyinstaller
    if errorlevel 1 (
        echo [ERROR] Cai pyinstaller that bai.
        goto :fail
    )
)

REM --- build (log to logs\build.log) --------------------------------------
if not exist "%PROJECT_DIR%logs" mkdir "%PROJECT_DIR%logs"
echo === Building KnowledgeHub.spec (vai phut - torch/transformers rat nang) ===
"%PY%" -m PyInstaller --noconfirm %CLEANFLAG% "%PROJECT_DIR%KnowledgeHub.spec"
if errorlevel 1 (
    echo [ERROR] PyInstaller that bai. Xem log o tren.
    goto :fail
)

REM --- report -------------------------------------------------------------
set "APPEXE=%PROJECT_DIR%dist\KnowledgeHub\KnowledgeHub.exe"
if exist "%APPEXE%" (
    echo.
    echo [OK] Da build xong ^(one-dir, windowed / no-console^):
    echo      %APPEXE%
    echo      Phan phoi CA thu muc dist\KnowledgeHub\ . Copy .env vao cung thu muc.
    echo      Runtime state ^(logs, chroma_data, kuzu_data^) tao ben trong khi chay lan dau.
) else (
    echo [WARN] Build bao thanh cong nhung khong thay %APPEXE%
)
goto :end

:fail
endlocal
exit /b 1

:end
endlocal
echo.
echo Nhan phim bat ky de dong cua so.
pause >nul
