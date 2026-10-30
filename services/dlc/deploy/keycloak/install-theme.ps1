<#
.SYNOPSIS
    Put the DLC sign-in theme (themes\dlc, the web's style 24) into an installed Keycloak and make realm 'dlc' use it.

.DESCRIPTION
    A theme folder alone changes nothing; four things have to line up, and each one has bitten before:
      1. themes\dlc mirrored into <KeycloakHome>\themes\dlc
      2. stale copies dropped: Keycloak serves theme files from a gzip cache under data\tmp\kc-gzip-cache that
         outlives a restart, and its resource URL (/resources/<version>/...) only changes with the Keycloak
         version, so browsers keep the old file for 30 days. When the theme changed, Keycloak is stopped, the cache
         emptied, and the stylesheet link in theme.properties gets ?v=<hash of the theme files> so browsers fetch it again
      3. realm loginTheme set to 'dlc' (a realm imported before the theme existed, or set by hand, keeps its own)
      4. the live sign-in page checked: it must link this exact stylesheet version
    Run it again any time: it changes nothing when everything is already in place.

.EXAMPLE
    pwsh -File install-theme.ps1 -KeycloakHome C:\DLC\apps\keycloak -KeycloakUrl https://10.0.0.5:8443 `
        -AdminPasswordFile C:\DLC\secrets\keycloak-admin.txt -SkipCertificateCheck
#>
param(
    [Parameter(Mandatory = $true)][string]$KeycloakHome,
    [Parameter(Mandatory = $true)][string]$KeycloakUrl,
    [Parameter(Mandatory = $true)][string]$AdminPasswordFile,
    [string]$Realm = "dlc",
    [string]$Theme = "dlc",
    [string]$ServiceId = "dlc-keycloak",
    [switch]$SkipCertificateCheck   # self-signed Keycloak certificate (pilot); needs PowerShell 7
)
$ErrorActionPreference = "Stop"
if ($SkipCertificateCheck) {
    $PSDefaultParameterValues["Invoke-RestMethod:SkipCertificateCheck"] = $true
    $PSDefaultParameterValues["Invoke-WebRequest:SkipCertificateCheck"] = $true
}
$KeycloakUrl = $KeycloakUrl.TrimEnd("/")
$src = Join-Path $PSScriptRoot "themes\$Theme"
$dst = Join-Path $KeycloakHome "themes\$Theme"
if (-not (Test-Path $src)) { throw "theme not found: $src" }

# the version stamp: a hash over every theme file, so any change (css, font, text) gives browsers a new URL
$files = Get-ChildItem $src -Recurse -File | Sort-Object FullName
$sha = [Security.Cryptography.SHA256]::Create()
$all = foreach ($f in $files) { $f.FullName.Substring($src.Length); (Get-FileHash $f.FullName -Algorithm SHA256).Hash }
$ver = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($all -join "`n")))) -replace '-', '').Substring(0, 10).ToLower()
$props = (Get-Content -Raw (Join-Path $src "login\theme.properties")) -replace 'css/dlc\.css(\?v=\w+)?', "css/dlc.css?v=$ver"
$propsDst = Join-Path $dst "login\theme.properties"
$changed = -not (Test-Path $propsDst) -or ((Get-Content -Raw $propsDst) -ne $props)

$svc = Get-Service $ServiceId -ErrorAction SilentlyContinue
$running = $svc -and $svc.Status -eq 'Running'
if ($changed) {
    if ($running) { Stop-Service $ServiceId; Write-Host "  stopped $ServiceId" }
    robocopy $src $dst /MIR /R:5 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "copy theme $src -> $dst failed ($LASTEXITCODE)" }
    [IO.File]::WriteAllText($propsDst, $props, (New-Object Text.UTF8Encoding $false))
    $gz = Join-Path $KeycloakHome "data\tmp\kc-gzip-cache"
    if (Test-Path $gz) { Remove-Item -Recurse -Force $gz; Write-Host "  emptied $gz" }
    Write-Host "  theme '$Theme' v=$ver -> $dst"
    if ($running) { Start-Service $ServiceId; Write-Host "  started $ServiceId" }
} else { Write-Host "  theme '$Theme' v=$ver already in $dst" }

foreach ($i in 1..150) {
    try { Invoke-RestMethod "$KeycloakUrl/realms/$Realm/.well-known/openid-configuration" -TimeoutSec 3 | Out-Null; $up = $true; break }
    catch { $up = $false; Start-Sleep 2 }
}
if (-not $up) { throw "Keycloak did not answer on $KeycloakUrl within 5 minutes" }

$pw = (Get-Content -Raw $AdminPasswordFile).Trim()
$tok = (Invoke-RestMethod -Method Post -Uri "$KeycloakUrl/realms/master/protocol/openid-connect/token" `
        -ContentType "application/x-www-form-urlencoded" `
        -Body @{ grant_type = "password"; client_id = "admin-cli"; username = "admin"; password = $pw }).access_token
$h = @{ Authorization = "Bearer $tok" }
$cur = (Invoke-RestMethod -Uri "$KeycloakUrl/admin/realms/$Realm" -Headers $h).loginTheme
if ($cur -ne $Theme) {
    Invoke-RestMethod -Method Put -Uri "$KeycloakUrl/admin/realms/$Realm" -Headers $h -ContentType "application/json" `
        -Body (@{ loginTheme = $Theme } | ConvertTo-Json) | Out-Null
    Write-Host "  realm '$Realm' loginTheme '$cur' -> '$Theme'"
} else { Write-Host "  realm '$Realm' already uses '$Theme'" }

# the live sign-in page must link this version of the stylesheet, and serve that file, not a cached one
$auth = "$KeycloakUrl/realms/$Realm/protocol/openid-connect/auth?client_id=account-console&response_type=code&scope=openid" +
    "&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256" +
    "&redirect_uri=$([uri]::EscapeDataString("$KeycloakUrl/realms/$Realm/account/"))"
$page = (Invoke-WebRequest -Uri $auth -UseBasicParsing -MaximumRedirection 0 -SkipHttpErrorCheck).Content
$link = [regex]::Match($page, "/resources/[^`"]+/login/$Theme/css/dlc\.css\?v=$ver").Value
if (-not $link) { throw "the sign-in page of realm '$Realm' does not link the '$Theme' theme v=$ver" }
$served = Invoke-WebRequest -Uri ($KeycloakUrl + $link) -UseBasicParsing
$text = if ($served.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($served.Content) } else { $served.Content }
$want = (Get-Content -Raw (Join-Path $src "login\resources\css\dlc.css")) -replace "`r", ""
if (($text -replace "`r", "") -ne $want) { throw "Keycloak serves an old dlc.css (cache): $link" }
Write-Host "  sign-in page serves the '$Theme' theme v=$ver"
