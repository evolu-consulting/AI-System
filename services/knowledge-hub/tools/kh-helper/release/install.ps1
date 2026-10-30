<#
.SYNOPSIS
    Install or upgrade the Knowledge Hub helper (kh-helper) for one CLI profile. Safe to run again.
.DESCRIPTION
    Uses the wheel next to this script. Creates <profile>\kh-helper (its own Python environment) when missing,
    installs the wheel, signs in when there is no sign-in yet (a browser page), and connects the CLI (setup).
    Profile: -ProfileDir, else $env:CLAUDE_CONFIG_DIR, else ~\.claude (Claude Code).
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install.ps1
#>
param(
    [string]$ProfileDir = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }),
    [string]$KhUrl = "https://knowledge-hub.cfapps.br10.hana.ondemand.com"
)
$ErrorActionPreference = "Stop"
$wheel = Get-ChildItem -Path $PSScriptRoot -Filter "kh_helper-*.whl" | Select-Object -First 1
if (-not $wheel) { throw "no kh_helper wheel next to this script" }
$home_ = Join-Path $ProfileDir "kh-helper"
$kh = Join-Path $home_ "Scripts\python.exe"

if (-not (Test-Path $kh)) {
    $py = $null
    foreach ($candidate in @(@("py", "-3"), @("python"), @("python3"))) {
        try {
            $ok = & $candidate[0] @($candidate | Select-Object -Skip 1) -c "import sys; print(sys.version_info >= (3, 10))" 2>$null
            if ($ok -eq "True") { $py = $candidate; break }
        } catch { }
    }
    if (-not $py) {
        throw "Python 3.10 or newer is needed: winget install -e --id Python.Python.3.12 --scope user, then run this again in a new terminal"
    }
    Write-Host "Creating $home_ ..."
    & $py[0] @($py | Select-Object -Skip 1) -m venv $home_
}
Write-Host "Installing $($wheel.Name) ..."
& $kh -m pip install --upgrade --quiet $wheel.FullName
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

$status = & $kh -m kh_helper.cli status | ConvertFrom-Json
if (-not $status.signed_in) {
    Write-Host "Sign in to Knowledge Hub in the browser page that opens ..."
    & $kh -m kh_helper.cli login --kh-url $KhUrl
}
$setup = & $kh -m kh_helper.cli setup | ConvertFrom-Json
# The hooks must start in the shell Claude Code runs them with (Git Bash, else PowerShell).
$broken = @($setup.hook_shells.PSObject.Properties | Where-Object { $_.Value -ne "ok" })
foreach ($shell in $broken) { Write-Warning "KH hooks cannot start in $($shell.Name): $($shell.Value)" }
if ($broken) { Write-Warning "Fix that, then run: & `"$kh`" -m kh_helper.cli setup" }
& $kh -m pip show kh-helper | Select-String "^Version"
Write-Host "Done. Close your CLI (e.g. Claude Code) and open it again to use the new helper."
