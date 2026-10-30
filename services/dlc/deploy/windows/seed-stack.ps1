<#
.SYNOPSIS
    Connect the DLC engine to the knowledge store and seed data: projects, the engine's namespace and client,
    the engine manifest, the lessons learned, the default flows of the frontend, and a first user.

.DESCRIPTION
    Safe to run again. The namespace client secret goes only into the engine service definition
    (LINE_RAG_CLIENT_ID / LINE_RAG_CLIENT_SECRET); it is rotated on every run (the engine restarts with it).

.EXAMPLE
    pwsh -File .\seed-stack.ps1 -Config .\stack.config.psd1 -LessonsFile .\lessons-customer.json -UserName demo
#>
param(
    [string]$Config = "",
    [string]$LessonsFile = "",
    [string]$UserName = "",
    [string[]]$UserRoles = @("dlc-user"),
    [string]$Namespace = "dlc_line"
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
Assert-Admin
$c = Read-StackConfig $Config
$kh = $c.Urls.Kh

Step "Knowledge store: projects + engine namespace"
if (-not (Wait-Http "$kh/health" 120)) { throw "knowledge store not answering on $kh" }
foreach ($pj in @(@{ id = "dlc"; name = "DLC delivery" }, @{ id = "lesson-learned"; name = "Lessons learned" })) {
    try { Invoke-RestMethod -Method Post -Uri "$kh/projects" -ContentType "application/json" -Body ($pj | ConvertTo-Json) | Out-Null } catch { }
    Ok "project $($pj.id)"
}
$ns = Invoke-RestMethod -Method Put -Uri "$kh/v1/admin/ns/$Namespace" -ContentType "application/json" `
      -Body (@{ projects = @("dlc", "lesson-learned"); display = "DLC engine" } | ConvertTo-Json)
Ok "namespace $Namespace ($($ns.state))"
$client = Invoke-RestMethod -Method Post -Uri "$kh/v1/admin/ns/$Namespace`:client" -ContentType "application/json" -Body "{}"
if (-not $client.client_secret) { throw "no client secret returned: $($client | ConvertTo-Json -Compress)" }
$tok = Invoke-RestMethod -Method Post -Uri "$kh/v1/token" -ContentType "application/json" `
       -Body (@{ grant_type = "client_credentials"; client_id = $client.client_id; client_secret = $client.client_secret } | ConvertTo-Json)
if (-not $tok.access_token) { throw "token exchange failed" }
Ok "client $($client.client_id) works (token $($tok.expires_in) s)"

Step "Engine: switch to the knowledge store"
Set-ServiceEnv -Cfg $c -Id "dlc-engine" -NoRestart -Env ([ordered]@{
    LINE_RAG = "http"; LINE_RAG_URL = $kh; LINE_RAG_NS = $Namespace
    LINE_RAG_CLIENT_ID = $client.client_id; LINE_RAG_CLIENT_SECRET = $client.client_secret })
$dlcExe = Join-Path $c.Paths.Apps "dlc\dlc.exe"
# manifest: same environment as the service
[xml]$x = Get-Content (Join-Path $c.Paths.Services "dlc-engine.xml")
$saved = @{}
foreach ($e in $x.service.env) { if ($e.name -ne "PATH") { $saved[$e.name] = [Environment]::GetEnvironmentVariable($e.name); [Environment]::SetEnvironmentVariable($e.name, $e.value) } }
try { $m = & $dlcExe rag-manifest apply 2>&1 | Out-String } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }
if ($LASTEXITCODE -ne 0) { throw "manifest apply failed:`n$m" }
Ok "manifest applied: $($m.Trim())"
Restart-Service dlc-engine -ErrorAction SilentlyContinue
if ((Get-Service dlc-engine).Status -ne "Running") { Start-Service dlc-engine }
if (Wait-Http "$($c.Urls.EngineLocal)/api/health" 120) { Ok "engine up: $($c.Urls.EngineLocal)" } else { Warn "engine not answering - see $($c.Paths.Logs)\dlc-engine.*.log" }

if ($LessonsFile) {
    Step "Lessons learned"
    # into the engine's own project: retrieval matches them by meaning there (rag.local.json include_people_lanes)
    & (Join-Path $PSScriptRoot "import-lessons.ps1") -KhUrl $kh -File $LessonsFile -Project "dlc"
}

Step "Frontend: default flows"
$feExe = Join-Path $c.Paths.Apps ("fe\" + $c.FeExe)
[xml]$fx = Get-Content (Join-Path $c.Paths.Services "dlc-fe.xml")
$saved = @{}
foreach ($e in $fx.service.env) { if ($e.name -ne "PATH") { $saved[$e.name] = [Environment]::GetEnvironmentVariable($e.name); [Environment]::SetEnvironmentVariable($e.name, $e.value) } }
try { $o = & $feExe seed-flows 2>&1 | Out-String } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }
Ok "flows: $($o.Trim())"
Start-Service dlc-fe -ErrorAction SilentlyContinue
if (Wait-Http "$($c.Urls.Fe)/" 120) { Ok "frontend up: $($c.Urls.Fe)" } else { Warn "frontend not answering - see $($c.Paths.Logs)\dlc-fe.*.log" }

if ($UserName) {
    Step "First user"
    $pw = Read-Host "  Password for $UserName"
    $adminPw = Get-Content -Raw (Join-Path $c.Paths.Secrets "keycloak-admin.txt")
    $skip = @{}; if ($PSVersionTable.PSVersion.Major -ge 7) { $skip.SkipCertificateCheck = $true }
    & (Join-Path $PSScriptRoot "..\keycloak\new-user.ps1") -KeycloakUrl $c.Urls.Keycloak -AdminPassword $adminPw `
        -Username $UserName -Password $pw -Roles $UserRoles @skip
}
Step "Done - run verify-stack.ps1"
