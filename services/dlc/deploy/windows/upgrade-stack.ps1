<#
.SYNOPSIS
    Upgrade an installed DLC stack to the packages of a new kit, keeping everything that was set up.

.DESCRIPTION
    Re-running install-stack.ps1 over a live install resets the Claude token, the services' start mode, their
    ACLs (Start/Stop for a user) and the engine's run mode. This script only swaps the programs:

      - engine (DlcZip) and frontend (FeZip): their _internal folders mirrored, data / config / logs untouched
      - knowledge store (KhZip) only with -WithKnowledgeStore (copied over, its data and .env kept)
      - engine settings that come from the config are applied (DLC_WORKSPACE_ROOT), both for the dlc-engine
        service and for the 'DLC Engine' task (engine-as-user.ps1)
      - the engine is stopped and started the way it runs (service or task); backups go to <InstallRoot>\backup
      - Keycloak's sign-in theme (keycloak\themes\dlc) copied in and set on realm dlc (install-theme.ps1); Keycloak is
        restarted only when the theme changed

    Kept: secrets, Claude token, Keycloak's data and users, the knowledge store's data, services' start mode and ACLs,
    the run mode. SHA256SUMS in ArtifactsDir is checked when present.

.EXAMPLE
    pwsh -File upgrade-stack.ps1 -Config .\stack.config.psd1 [-WithKnowledgeStore]
#>
param([string]$Config = "", [switch]$WithKnowledgeStore)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
Assert-Admin
$c = Read-StackConfig $Config
$P = $c.Paths
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = Join-Path $P.Root "backup\apps-$ts"
$task = Test-EngineTask

Step "Kit"
$zips = @($c.DlcZip, $c.FeZip) + $(if ($WithKnowledgeStore) { @($c.KhZip) } else { @() })
foreach ($z in $zips) { if (-not (Test-Path (Join-Path $c.ArtifactsDir $z))) { throw "artifact missing: $(Join-Path $c.ArtifactsDir $z)" } }
$sums = Join-Path $c.ArtifactsDir "SHA256SUMS"
if (Test-Path $sums) {
    foreach ($line in Get-Content $sums) {
        $h, $name = ($line -split '\s+\*?', 2)
        if ($name -and ($zips -contains $name.Trim())) {
            $got = (Get-FileHash (Join-Path $c.ArtifactsDir $name.Trim()) -Algorithm SHA256).Hash
            if ($got -ne $h.ToUpper()) { throw "SHA256 mismatch for $name (kit damaged or mixed)" }
            Ok "sha256 $name"
        }
    }
} else { Warn "no SHA256SUMS in $($c.ArtifactsDir): packages not verified" }

function Expand-Package([string]$Zip) {
    $tmp = Join-Path $env:TEMP ("dlc-upgrade-" + [guid]::NewGuid().ToString("N"))
    Expand-Archive -Path (Join-Path $c.ArtifactsDir $Zip) -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp
    return $(if ($inner.Count -eq 1 -and $inner[0].PSIsContainer) { $inner[0].FullName } else { $tmp })
}

function Copy-Program([string]$From, [string]$To) {
    # programs (*.exe and the like) copied over, _internal mirrored (no stale libraries), everything else kept
    robocopy $From $To /E /XD (Join-Path $From "_internal") /R:5 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "copy $From -> $To failed ($LASTEXITCODE)" }
    if (Test-Path (Join-Path $From "_internal")) {
        robocopy (Join-Path $From "_internal") (Join-Path $To "_internal") /MIR /R:5 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "copy _internal -> $To failed ($LASTEXITCODE)" }
    }
}

Step "Stop"
if ((Get-Service dlc-fe).Status -ne 'Stopped') { Stop-Service dlc-fe -Force; Ok "stopped dlc-fe" }
if ($task) {
    Stop-ScheduledTask -TaskName 'DLC Engine' -ErrorAction SilentlyContinue
    Get-Process dlc, dlcw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$($P.Apps)\dlc\*" } | Stop-Process -Force
    Ok "stopped task DLC Engine"
} elseif ((Get-Service dlc-engine).Status -ne 'Stopped') { Stop-Service dlc-engine -Force; Ok "stopped dlc-engine" }
if ($WithKnowledgeStore -and (Get-Service dlc-kh).Status -ne 'Stopped') { Stop-Service dlc-kh -Force; Ok "stopped dlc-kh" }
# the tray (dlcw.exe tray, one per signed-in user) runs from the engine folder too: its locked files made robocopy
# retry for ever (/R:5 now bounds that); the user starts it again (Start DLC, or the next sign-in)
$trays = @(Get-CimInstance Win32_Process -Filter "Name='dlcw.exe'" | Where-Object { $_.CommandLine -match '\stray(\s|$)' })
foreach ($t in $trays) { Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue }
if ($trays) { Ok "stopped the tray ($($trays.Count))" }
Start-Sleep 2

Step "Backup -> $bak"
New-Item -ItemType Directory -Force $bak | Out-Null
foreach ($n in @("dlc", "fe") + $(if ($WithKnowledgeStore) { @("kh") } else { @() })) {
    robocopy (Join-Path $P.Apps $n) (Join-Path $bak $n) /E /XD (Join-Path $P.Apps "$n\data") /NFL /NDL /NJH /NJS /NP | Out-Null
}
foreach ($f in "dlc-engine.xml", "dlc-engine.env.json") { if (Test-Path (Join-Path $P.Services $f)) { Copy-Item (Join-Path $P.Services $f) $bak -Force } }
Ok "programs and engine settings saved"

Step "Programs"
$src = Expand-Package $c.DlcZip; Copy-Program $src (Join-Path $P.Apps "dlc"); Ok "engine <- $($c.DlcZip)"
$src = Expand-Package $c.FeZip; Copy-Program $src (Join-Path $P.Apps "fe"); Ok "frontend <- $($c.FeZip)"
if ($WithKnowledgeStore) {
    $src = Expand-Package $c.KhZip
    robocopy $src (Join-Path $P.Apps "kh") /E /NFL /NDL /NJH /NJS /NP | Out-Null   # its data and .env are not in the package
    if ($LASTEXITCODE -ge 8) { throw "copy knowledge store failed ($LASTEXITCODE)" }
    Ok "knowledge store <- $($c.KhZip)"
}
if ($task -and -not (Test-Path (Join-Path $P.Apps "dlc\dlcw.exe"))) { throw "this engine package has no dlcw.exe, which the 'DLC Engine' task runs" }

Step "Engine settings from the config"
Set-ServiceEnv -Cfg $c -Id "dlc-engine" -Env ([ordered]@{ DLC_WORKSPACE_ROOT = "$($c.WorkspaceRoot)" }) -NoRestart
Ok "DLC_WORKSPACE_ROOT = '$($c.WorkspaceRoot)'"
if ($c.PythonExe) {
    # the engine service (LocalSystem) has no per-user Python on its PATH: the test gate and the agents' shells
    # get this interpreter (LINE_PYTHON) and its folders first on PATH (WinSW expands %PATH%)
    if (-not (Test-Path $c.PythonExe)) { throw "PythonExe not found: $($c.PythonExe)" }
    $pyDir = Split-Path $c.PythonExe -Parent
    # prepend to the service's own PATH (it holds <InstallRoot>\bin, where claude.exe is); never replace it
    [xml]$sx = Get-Content (Join-Path $c.Paths.Services "dlc-engine.xml")
    $cur = [string](($sx.service.env | Where-Object { $_.name -eq "PATH" }).value)
    if (-not $cur) { $cur = "%PATH%" }
    $keep = @($cur -split ';' | Where-Object { $_ -and $_ -ne $pyDir -and $_ -ne "$pyDir\Scripts" })
    Set-ServiceEnv -Cfg $c -Id "dlc-engine" -Env ([ordered]@{ LINE_PYTHON = "$($c.PythonExe)"; PATH = (@($pyDir, "$pyDir\Scripts") + $keep) -join ';' }) -NoRestart
    Ok "LINE_PYTHON = '$($c.PythonExe)'"
}

Step "Keycloak sign-in theme"
& (Join-Path $PSScriptRoot "..\keycloak\install-theme.ps1") -KeycloakHome (Join-Path $P.Apps "keycloak") -KeycloakUrl $c.Urls.Keycloak `
    -AdminPasswordFile (Join-Path $P.Secrets "keycloak-admin.txt") -SkipCertificateCheck
Ok "theme dlc on realm dlc"

Step "Start"
if ($WithKnowledgeStore) { Start-Service dlc-kh; Ok "started dlc-kh" }
if ($task) { Start-ScheduledTask -TaskName 'DLC Engine'; Ok "started task DLC Engine" } else { Start-Service dlc-engine; Ok "started dlc-engine" }
Start-Service dlc-fe; Ok "started dlc-fe"
$h = $null
foreach ($i in 1..60) { try { $h = Invoke-RestMethod "$($c.Urls.EngineLocal)/api/health" -TimeoutSec 3; break } catch { Start-Sleep 2 } }
if (-not $h) { throw "engine did not answer on $($c.Urls.EngineLocal) - see $($P.Logs)" }
Ok "engine $($h.version) up"
foreach ($i in 1..60) { try { if ((Invoke-WebRequest "http://127.0.0.1:$($c.FePort)/" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { Ok "frontend up"; break } } catch { Start-Sleep 2 } }
Write-Host "`nUpgraded. Backup: $bak  (verify-stack.ps1 for a full check)" -ForegroundColor Green
