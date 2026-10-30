<#
.SYNOPSIS
    Install Graphify for the DLC engine: the agents then query a local code graph instead of reading code with the model.

.DESCRIPTION
    Graphify (Apache-2.0, PyPI package graphifyy, CLI graphify) parses a repository into a graph of files, classes,
    functions, calls and imports with a local AST pass: no model, no API key. The engine (line.codegraph) indexes
    each run's target repository with `graphify extract --code-only` (index kept outside the repository) and gives
    the agents a code_graph tool; without Graphify everything works as before.

    This script:
      1. finds Python 3.10+ (-Python, else `py -3`, else python on PATH)
      2. creates a venv at <InstallRoot>\apps\graphify and installs graphifyy==<Version> into it
         (-Wheelhouse <dir>: offline, from wheels downloaded beforehand with `pip download graphifyy==<Version>`)
      3. checks `graphify --help` and a real code-only scan of a tiny sample
      4. sets LINE_GRAPHIFY=<venv>\Scripts\graphify.exe on the dlc-engine service (and the 'DLC Engine' task's
         env file) and restarts the engine, unless -NoEngineEnv
    Safe to run again (the venv is reused; a different -Version is installed over it).

.EXAMPLE
    pwsh -File .\install-graphify.ps1 -Config .\stack.config.psd1
    pwsh -File .\install-graphify.ps1 -InstallRoot C:\DLC                      # no stack config at hand
    pwsh -File .\install-graphify.ps1 -InstallRoot C:\DLC -Wheelhouse D:\kit\graphify-wheels
#>
param(
    [string]$Config = "",
    [string]$InstallRoot = "",
    [string]$Version = "0.9.73",
    [string]$Python = "",
    [string]$Wheelhouse = "",
    [switch]$NoEngineEnv
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
Assert-Admin

if ($Config -or (Test-Path (Join-Path $PSScriptRoot "stack.config.psd1"))) {
    $c = Read-StackConfig $Config
} else {
    if (-not $InstallRoot) { $InstallRoot = "C:\DLC" }
    if (-not (Test-Path $InstallRoot)) { throw "install root not found: $InstallRoot (give -Config or -InstallRoot)" }
    $c = @{ Paths = @{ Root = $InstallRoot; Apps = (Join-Path $InstallRoot "apps"); Services = (Join-Path $InstallRoot "services") } }
}
$venv = Join-Path $c.Paths.Apps "graphify"
$exe = Join-Path $venv "Scripts\graphify.exe"

Step "Python"
function Get-PythonCmd {
    if ($Python) { return @($Python) }
    if (Get-Command py -ErrorAction SilentlyContinue) { return @("py", "-3") }
    if (Get-Command python -ErrorAction SilentlyContinue) { return @("python") }
    throw "Python 3.10+ not found: install it (python.org, 'Add to PATH') or give -Python <path to python.exe>"
}
$py = Get-PythonCmd
$pyArgs = @($py | Select-Object -Skip 1)
$ver = & $py[0] @pyArgs -c "import sys; print('%d.%d' % sys.version_info[:2]); sys.exit(0 if sys.version_info >= (3, 10) else 1)"
if ($LASTEXITCODE -ne 0) { throw "Python $ver is too old: Graphify needs 3.10+" }
Ok "python $ver ($($py -join ' '))"

Step "Graphify $Version"
if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
    & $py[0] @pyArgs -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw "could not create the venv at $venv" }
}
$vpy = Join-Path $venv "Scripts\python.exe"
$pip = @("-m", "pip", "install", "--disable-pip-version-check", "--quiet")
if ($Wheelhouse) {
    if (-not (Test-Path $Wheelhouse)) { throw "wheelhouse not found: $Wheelhouse" }
    $pip += @("--no-index", "--find-links", $Wheelhouse)
}
& $vpy @pip "graphifyy==$Version"
if ($LASTEXITCODE -ne 0) { throw "pip install graphifyy==$Version failed" }
if (-not (Test-Path $exe)) { throw "graphify.exe missing after install: $exe" }
$installed = & $vpy -c "import importlib.metadata as m; print(m.version('graphifyy'))"
if ($installed -ne $Version) { throw "graphifyy $installed installed, $Version expected" }
Ok "graphifyy $installed in $venv"

Step "Check"
& $exe --help | Out-Null
if ($LASTEXITCODE -ne 0) { throw "graphify --help failed" }
$tmp = Join-Path $env:TEMP ("dlc-graphify-check-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force (Join-Path $tmp "src") | Out-Null
@"
def save(note):
    return store(note)


def store(note):
    return note
"@ | Set-Content -Encoding utf8 (Join-Path $tmp "src\notes.py")
try {
    # code-only: local AST, no model; no key in the environment either
    $env:ANTHROPIC_API_KEY = $null; $env:OPENAI_API_KEY = $null; $env:GEMINI_API_KEY = $null
    $out = & $exe extract (Join-Path $tmp "src") --code-only --max-workers 1 --out (Join-Path $tmp "out") 2>&1 | Out-String
    $graph = Join-Path $tmp "out\graphify-out\graph.json"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $graph)) { throw "sample scan failed: $out" }
    $ex = & $exe explain "save" --graph $graph 2>&1 | Out-String
    if ($ex -notmatch "store") { throw "sample graph does not show save -> store: $ex" }
    Ok "code-only scan and explain answer (sample: save -> store)"
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }

if ($NoEngineEnv) {
    Warn "engine not changed (-NoEngineEnv): set LINE_GRAPHIFY=$exe for the engine yourself"
} elseif (-not (Test-Path (Join-Path $c.Paths.Services "dlc-engine.xml"))) {
    Warn "no dlc-engine service under $($c.Paths.Services): set LINE_GRAPHIFY=$exe for the engine yourself"
} else {
    Step "Engine"
    Set-ServiceEnv -Cfg $c -Id "dlc-engine" -Env @{ LINE_GRAPHIFY = $exe; LINE_CODEGRAPH = "auto" }
    Ok "LINE_GRAPHIFY set; engine restarted"
}
Write-Host "`nGraphify $Version installed. Each run's target is indexed at its start (run detail code_graph); agents get code_graph." -ForegroundColor Green
