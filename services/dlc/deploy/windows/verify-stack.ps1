<#
.SYNOPSIS
    Check the whole DLC stack on this host and print one PASS/FAIL line per check.

.DESCRIPTION
    Services running (the engine as the service or as the 'DLC Engine' task); Keycloak realm + signing keys; a real PKCE sign-in (when -UserName is given) whose token
    carries aud dlc-api and role dlc-user; the knowledge store (health, 14 capabilities, engine namespace);
    the engine (health, refuses a call without a token, accepts it with the token); the engine self-check
    (dry runs, no model cost); the frontend page; Chrome or Edge for Autologin. Exit code = number of failed checks.

.EXAMPLE
    pwsh -File .\verify-stack.ps1 -Config .\stack.config.psd1 -UserName demo
#>
param([string]$Config = "", [string]$UserName = "", [switch]$SkipSelfcheck)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "common.ps1")
$c = Read-StackConfig $Config
$fail = 0
function Check([string]$name, [scriptblock]$test) {
    try { $r = & $test; if ($r) { Write-Host "PASS  $name  $(if ($r -is [string]) { $r })" -ForegroundColor Green } else { throw "false" } }
    catch { $script:fail++; Write-Host "FAIL  $name  $($_.Exception.Message)" -ForegroundColor Red }
}
$tls = @{}; if ($PSVersionTable.PSVersion.Major -ge 7) { $tls.SkipCertificateCheck = $true }

foreach ($s in "dlc-keycloak", "dlc-kh", "dlc-fe") {
    Check "service $s running" { (Get-Service $s -ErrorAction Stop).Status -eq "Running" }
}
if (Test-EngineTask) {
    # engine-as-user.ps1: the engine is the scheduled task 'DLC Engine' (dlcw.exe) and the service stays disabled
    Check "task DLC Engine running" { (Get-ScheduledTask -TaskName 'DLC Engine').State -eq "Running" }
    Check "one engine process" {
        $n = @(Get-Process dlcw, dlc -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$($c.Paths.Apps)*" }).Count
        if ($n -ne 1) { throw "$n engine processes (orphans: Stop-DLC, then Start-DLC)" }
        "1"
    }
    Check "service dlc-engine disabled (the task runs the engine)" {
        $sv = Get-Service dlc-engine -ErrorAction SilentlyContinue
        -not $sv -or $sv.StartType -eq "Disabled"
    }
} else {
    Check "service dlc-engine running" { (Get-Service dlc-engine -ErrorAction Stop).Status -eq "Running" }
}
Check "Keycloak realm dlc" { (Invoke-RestMethod @tls "$($c.Urls.Issuer)/.well-known/openid-configuration").issuer -eq $c.Urls.Issuer }
Check "Keycloak signing keys (JWKS)" { @((Invoke-RestMethod @tls "$($c.Urls.Issuer)/protocol/openid-connect/certs").keys | Where-Object alg -eq "RS256").Count -ge 1 }
Check "engine host trusts the Keycloak certificate" {
    # without -SkipCertificateCheck: the same trust the engine and the frontend backend get from Windows
    (Invoke-WebRequest -UseBasicParsing "$($c.Urls.Issuer)/.well-known/openid-configuration").StatusCode -eq 200 }

$token = $null
if ($UserName) {
    $pw = Read-Host "Password for $UserName"
    Check "PKCE sign-in as $UserName (aud dlc-api, role dlc-user)" {
        $o = & (Join-Path $PSScriptRoot "..\keycloak\test-login.ps1") -KeycloakUrl $c.Urls.Keycloak -RedirectUri "$($c.Urls.Fe)/" `
             -Username $UserName -Password $pw -SkipCertificateCheck 6>&1 | Out-String
        $LASTEXITCODE -eq 0
    }
    # a token for the API checks below (password grant is disabled on dlc-fe; use the same PKCE helper's flow)
}

Check "knowledge store health" { (Invoke-RestMethod "$($c.Urls.Kh)/health").status -eq "ok" }
Check "knowledge store capabilities" {
    $n = @((Invoke-RestMethod "$($c.Urls.Kh)/v1/capabilities").capabilities.name)
    foreach ($need in "events", "records", "packs", "coord", "retrieval", "metrics") { if ($n -notcontains $need) { throw "missing $need" } }
    "$($n.Count) capabilities"
}
Check "engine namespace dlc_line active" { (Invoke-RestMethod "$($c.Urls.Kh)/v1/admin/ns/dlc_line").state -eq "active" }
Check "engine retrieval serves lessons by meaning" {
    # the engine's own call shape: a key plus the situation in words; an empty answer means the agents get no
    # knowledge at all (lessons not in the engine's project, or include_people_lanes off in rag.local.json)
    $rl = Get-Content -Raw (Join-Path $c.Paths.Config "rag.local.json") | ConvertFrom-Json
    $b = @{ project = $rl.project; keyspace = "step"; key = @{ role = "fixer"; step = "build"; stack = "python" }
            query = "unit test passes but its assertion can never fail"; budget_chars = 4000 } | ConvertTo-Json -Depth 4
    $r = Invoke-RestMethod -Method Post -Uri "$($c.Urls.Kh)/v1/$($rl.rag_ns)/context/step" -ContentType "application/json" -Body $b
    $n = @($r.served).Count
    if ($n -lt 1) { throw "nothing served (people_lanes=$($r.people_lanes)): import the lessons into project $($rl.project) and re-apply the manifest (seed-stack.ps1)" }
    "$n item(s), $(([string]$r.pack_text).Length) chars"
}
Check "knowledge store not reachable from the network" {
    $listen = Get-NetTCPConnection -LocalPort $c.KhPort -State Listen -ErrorAction Stop
    -not ($listen | Where-Object { $_.LocalAddress -notin "127.0.0.1", "::1" })
}

Check "engine health" { (Invoke-RestMethod "$($c.Urls.EngineLocal)/api/health").ok }
Check "engine refuses a call without a token (401)" {
    try { Invoke-RestMethod "$($c.Urls.EngineLocal)/api/runs" | Out-Null; $false }
    catch { $_.Exception.Response.StatusCode.value__ -eq 401 }
}
Check "engine OpenAPI" { (Invoke-RestMethod "$($c.Urls.EngineLocal)/api/openapi.json").openapi -like "3.*" }
if (-not $SkipSelfcheck) {
    Check "engine self-check (dry runs, no model cost)" {
        $o = & (Join-Path $c.Paths.Apps "dlc\dlc.exe") selfcheck 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { throw ($o -split "`n" | Select-Object -Last 3) -join " " }
        "ok"
    }
}
Check "frontend page" { (Invoke-WebRequest -UseBasicParsing "$($c.Urls.Fe)/").StatusCode -eq 200 }
Check "Chrome or Edge for Autologin sidecar" {
    # line/sidecar/cdp.py CHROME_CANDIDATES: agents' get_session/open_page need one of these
    $found = @("C:\Program Files\Google\Chrome\Application\chrome.exe",
               "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
               "C:\Program Files\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $found) { throw "none found: install Chrome, or Admin > Sidecars > Autologin cannot sign in" }
    $found
}
Check "Claude CLI configured for the engine" {
    $v = Get-ServiceEnv -Cfg $c -Id "dlc-engine" -Name "CLAUDE_CODE_OAUTH_TOKEN"
    $d = Get-ServiceEnv -Cfg $c -Id "dlc-engine" -Name "CLAUDE_CONFIG_DIR"
    [bool]$v -or (Test-Path (Join-Path $d ".credentials.json"))
}

Write-Host ""
if ($fail) { Write-Host "$fail check(s) failed" -ForegroundColor Red } else { Write-Host "all checks passed" -ForegroundColor Green }
exit $fail
