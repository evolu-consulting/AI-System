<#
.SYNOPSIS
    Build KnowledgeHub into a standalone one-DIR, windowed (no-console) app folder
    the CORRECT way (PyInstaller + spec). Output: dist\KnowledgeHub\KnowledgeHub.exe.

.DESCRIPTION
    auto-py-to-exe / a bare `pyinstaller main.py` FAIL at runtime for this project
    because the heavy ML deps (torch, transformers, chromadb, sentence-transformers,
    huggingface_hub, PIL) ship data files and hidden imports that must be collected
    explicitly. KnowledgeHub.spec already does that via collect_all(...). This script
    just drives that spec with the project venv.

    Steps:
      1. Locate the project .venv (must exist with deps installed).
      2. Ensure pyinstaller is present in the venv (auto-install if missing).
      3. Run: pyinstaller --noconfirm --clean KnowledgeHub.spec
      4. Report the produced exe under dist\.

.PARAMETER Spec
    Spec file to build. Default: KnowledgeHub.spec (next to this script).

.PARAMETER NoClean
    Skip PyInstaller's --clean (reuse the previous build cache; faster rebuilds).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\build.ps1
#>
[CmdletBinding()]
param(
    [string] $Spec = "KnowledgeHub.spec",
    [switch] $NoClean
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
Set-Location $here

function Info($m) { Write-Host "    $m" -ForegroundColor Gray }
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# -- 1. venv --------------------------------------------------------------------
$py = Join-Path $here ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    throw "No .venv found at $py. Create it first:  python -m venv .venv ; .venv\Scripts\pip install -r requirements.txt"
}

$specPath = Join-Path $here $Spec
if (-not (Test-Path $specPath)) { throw "Spec file not found: $specPath" }

# -- 2. core deps sanity check ----------------------------------------------------
Step "Checking build dependencies"
& $py -c "import torch,transformers,chromadb,sentence_transformers,fastapi,uvicorn" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Runtime deps missing in .venv. Run:  .venv\Scripts\pip install -r requirements.txt"
}
Info "runtime deps OK"

# -- 3. ensure PyInstaller --------------------------------------------------------
& $py -c "import PyInstaller" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Info "PyInstaller missing -> installing into .venv"
    & $py -m pip install pyinstaller
    if ($LASTEXITCODE -ne 0) { throw "pip install pyinstaller failed" }
}
$pyi = Join-Path $here ".venv\Scripts\pyinstaller.exe"

# -- 4. build ---------------------------------------------------------------------
Step "Building $Spec (this can take a few minutes - torch/transformers are large)"
$logDir = Join-Path $here "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "build.log"

$args = @("--noconfirm")
if (-not $NoClean) { $args += "--clean" }
$args += $specPath

& $pyi @args 2>&1 | Tee-Object -FilePath $log
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed (exit $LASTEXITCODE). See $log" }

# -- 5. report --------------------------------------------------------------------
Step "Done"
# One-DIR build: PyInstaller emits a folder, dist\KnowledgeHub\, whose entry point
# is KnowledgeHub.exe. Ship the WHOLE folder, not just the exe.
$appDir = Join-Path $here "dist\KnowledgeHub"
$exe    = Join-Path $appDir "KnowledgeHub.exe"
if (Test-Path $exe) {
    $sizeMB = [math]::Round(((Get-ChildItem $appDir -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
    Write-Host "    [OK] $exe" -ForegroundColor Green
    Write-Host "    [OK] folder: $appDir  ($sizeMB MB total)" -ForegroundColor Green
    Info "Windowed build (console=False): double-clicking KnowledgeHub.exe shows only the"
    Info "  tray icon - no terminal window. Output goes to logs\app.out.log."
    Info "Distribute the ENTIRE dist\KnowledgeHub\ folder. Runtime state (logs, chroma_data,"
    Info "  kuzu_data) is created inside it on first run. Copy .env into the folder too."
} else {
    Write-Host "    [WARN] build reported success but $exe not found" -ForegroundColor Yellow
}
