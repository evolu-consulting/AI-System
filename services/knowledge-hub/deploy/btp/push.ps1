<#
.SYNOPSIS
    Stage KnowledgeHub and push it to SAP BTP Cloud Foundry, with every store in a HANA schema.

.DESCRIPTION
    Runs on the operator's own machine (the "runner"): it builds a clean staging folder,
    then hands it to `cf push`, which builds the Python app on Cloud Foundry itself - no
    container registry is involved.

    Steps, each safe to repeat:
      1. Check that cf is logged in, and print the target so a wrong org is caught early.
      2. Create the HANA schema service instance if it is missing (plan `schema`: its user
         owns its schema, so KH can create its own tables).
      3. Stage: app code, the bundled embedding model and a generated requirements.txt that
         pins CPU-only torch (the CUDA build is several GB and useless on a CF cell).
      4. `cf push --no-start`, put back env vars set by hand on the app that the manifest removed
         (read before the push, e.g. KH_ACTING_ISSUERS), then either point KH at the sign-in service (-AuthIssuer) or
         set KH_API_KEY, then start. The key is read from, or generated into, a file
         OUTSIDE the repo, so it is never committed.

.EXAMPLE
    pwsh -NoProfile -File deploy/btp/push.ps1 -ExpectOrg ticketing-system-simplemdg
#>
param(
    [string]$AppName     = "knowledge-hub",
    # Production's data lives in kh-hana-v2. The manifest sets KH_HANA_SERVICE from this value, so
    # the old default (kh-hana) silently pointed prod at an old schema on 2026-10-09.
    [string]$HanaService = "kh-hana-v2",
    [string]$HanaPlan    = "schema",
    [Parameter(Mandatory = $true)][string]$ExpectOrg,
    [string]$KeyFile     = (Join-Path $HOME ".kh\btp_api_key.txt"),
    # Keycloak realm URL. When given, KH requires SSO sign-in with per-project permissions
    # (app/auth.py) and the shared API key is removed; see tools/kh-helper for the client side.
    [string]$AuthIssuer  = "",
    [string]$Memory      = "8G"
)
$ErrorActionPreference = "Stop"

$KhRoot  = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Stage   = Join-Path $PSScriptRoot ".build"
$Model   = "bge-small-en-v1.5"

# -- 1. target check ----------------------------------------------------------------------
$target = (cf target) -join "`n"
if ($LASTEXITCODE -ne 0) { throw "cf is not logged in. Run: cf login -a <api> --sso" }
Write-Host $target
if ($target -notmatch "org:\s+$([regex]::Escape($ExpectOrg))\s") {
    throw "cf is targeting a different org than '$ExpectOrg'. Refusing to push."
}

# Env vars set by hand on the app (cf set-env), e.g. KH_ACTING_ISSUERS: applying the manifest removes every
# var it does not list (found 2026-10-23), so they are read now and put back right after the push.
$appGuid = (cf app $AppName --guid 2>$null | Select-Object -Last 1)
$prevEnv = $null
if ($LASTEXITCODE -eq 0 -and $appGuid) {
    $prevEnv = (cf curl "/v3/apps/$appGuid/environment_variables" | Out-String | ConvertFrom-Json).var
    if ($LASTEXITCODE -ne 0) { throw "could not read the app's env vars; refusing to push and lose them" }
}

# -- 2. HANA schema service ---------------------------------------------------------------
cf service $HanaService *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating service $HanaService (hana/$HanaPlan) ..."
    cf create-service hana $HanaPlan $HanaService
    if ($LASTEXITCODE -ne 0) { throw "cf create-service failed" }
}

# -- 3. stage -----------------------------------------------------------------------------
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force $Stage | Out-Null
foreach ($f in "main.py", "preflight.py", "VERSION") {
    Copy-Item (Join-Path $KhRoot $f) $Stage
}
foreach ($d in "app", "seeds") {
    Copy-Item -Recurse (Join-Path $KhRoot $d) (Join-Path $Stage $d)
}
# The worker's jobs, run in-process by learn back (app/learnback.py) when KH_LEARNBACK_LLM is set.
New-Item -ItemType Directory -Force (Join-Path $Stage "worker") | Out-Null
Copy-Item -Recurse (Join-Path $KhRoot "worker\kh_worker") (Join-Path $Stage "worker\kh_worker")
Get-ChildItem $Stage -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
# The kh-helper wheel, served without sign-in at /auth/download/<file> and linked from /auth/help.
python -m pip wheel (Join-Path $KhRoot "tools\kh-helper") --no-deps --quiet -w (Join-Path $Stage "downloads")
if ($LASTEXITCODE -ne 0) { throw "building the kh-helper wheel failed" }
New-Item -ItemType Directory -Force (Join-Path $Stage "models") | Out-Null
Copy-Item -Recurse (Join-Path $KhRoot "models\$Model") (Join-Path $Stage "models\$Model")

# requirements.txt, generated from the repo's own pin list:
#   - torch pinned to its +cpu build from the PyTorch CPU index
#   - pystray dropped (system tray; the container runs headless under uvicorn)
$req = @("--extra-index-url https://download.pytorch.org/whl/cpu")
foreach ($line in Get-Content (Join-Path $KhRoot "requirements.txt")) {
    if ($line -match '^\s*pystray') { continue }
    if ($line -match '^\s*torch==([^\s#+]+)') { $line = "torch==$($Matches[1])+cpu" }
    $req += $line
}
# Learn back's model door (KH_LEARNBACK_LLM=anthropic): the SDK pin of worker/requirements.txt.
foreach ($line in Get-Content (Join-Path $KhRoot "worker\requirements.txt")) {
    if ($line -match '^\s*anthropic') { $req += ($line -replace '\s*#.*$', '') }
}
Set-Content -Encoding utf8 (Join-Path $Stage "requirements.txt") $req
# The Python buildpack reads runtime.txt, not .python-version (it silently fell back to
# 3.10, where scikit-learn 1.9 does not install).
Set-Content -Encoding ascii (Join-Path $Stage "runtime.txt") "python-3.12.x"
Set-Content -Encoding ascii (Join-Path $Stage "VERSION") (Get-Content (Join-Path $KhRoot "VERSION"))

# -- 4. push, key, start ------------------------------------------------------------------
cf push -f (Join-Path $PSScriptRoot "manifest.yml") -p $Stage --no-start `
    --var "app_name=$AppName" --var "hana_service=$HanaService" --var "memory=$Memory"
if ($LASTEXITCODE -ne 0) { throw "cf push failed" }

# Put back the hand-set vars the manifest just removed (KH_API_KEY is managed below). To drop one for good,
# `cf unset-env` it before deploying.
if ($prevEnv) {
    $nowEnv = (cf curl "/v3/apps/$appGuid/environment_variables" | Out-String | ConvertFrom-Json).var
    $restore = @{}
    foreach ($p in $prevEnv.PSObject.Properties) {
        if ($p.Name -eq "KH_API_KEY") { continue }
        if (-not ($nowEnv -and $nowEnv.PSObject.Properties[$p.Name])) { $restore[$p.Name] = [string]$p.Value }
    }
    if ($restore.Count) {
        $bodyFile = [System.IO.Path]::GetTempFileName()
        Set-Content -Encoding utf8NoBOM $bodyFile (@{ var = $restore } | ConvertTo-Json -Compress -Depth 5)
        cf curl -X PATCH "/v3/apps/$appGuid/environment_variables" -d "@$bodyFile" | Out-Null
        $failed = $LASTEXITCODE -ne 0
        Remove-Item $bodyFile -Force
        if ($failed) { throw "could not restore env vars: $($restore.Keys -join ', ') - set them with cf set-env before cf start" }
        Write-Host "Restored hand-set env vars: $($restore.Keys -join ', ')"
    }
}

if ($AuthIssuer) {
    cf set-env $AppName KH_AUTH_ISSUER $AuthIssuer | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "cf set-env failed" }
    cf unset-env $AppName KH_API_KEY | Out-Null
    cf start $AppName
    if ($LASTEXITCODE -ne 0) { throw "cf start failed - read: cf logs $AppName --recent" }
    cf app $AppName
    return
}

if (-not (Test-Path $KeyFile)) {
    New-Item -ItemType Directory -Force (Split-Path $KeyFile) | Out-Null
    $bytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    Set-Content -NoNewline -Encoding ascii $KeyFile ([Convert]::ToHexString($bytes).ToLower())
    Write-Host "Generated a new API key in $KeyFile"
}
$key = (Get-Content -Raw $KeyFile).Trim()
cf set-env $AppName KH_API_KEY $key | Out-Null
if ($LASTEXITCODE -ne 0) { throw "cf set-env failed" }

cf start $AppName
if ($LASTEXITCODE -ne 0) { throw "cf start failed - read: cf logs $AppName --recent" }
cf app $AppName
