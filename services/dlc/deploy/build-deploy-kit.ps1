<#
.SYNOPSIS
    On the BUILD machine: gather everything the VPS needs into one folder (copy it to the VPS as C:\DLC-install).

.DESCRIPTION
    Output folder holds: the JDK 21 zip, the Keycloak zip, WinSW, the knowledge store zip (from its dist folder),
    the DLC engine zip, the frontend zip, a fresh Ed25519 signing key for the knowledge store, the lessons file,
    the install scripts (windows\*, keycloak\*, kh.agents.env) and SHA256SUMS of the packages. Nothing from the
    source tree is copied except these scripts and templates.
    -Build first builds the three packages from source (KnowledgeHub\build.ps1, packaging\build_dlc.ps1,
    packaging_fe\build_fe.ps1); without it the newest zips already in dist\ are used.

.EXAMPLE
    pwsh -File .\build-deploy-kit.ps1 -Out C:\lw\windows -Build -LessonsFile C:\...\lessons-customer.json
#>
param(
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$KhDist = (Join-Path $PSScriptRoot "..\..\KnowledgeHub\dist\KnowledgeHub"),
    [string]$DlcZip = "",                 # default: newest dist\dlc-<version>-win64.zip
    [string]$FeZip = "",                  # default: newest dist\dlc-fe-<version>-win64.zip
    [switch]$Build,
    [string]$LessonsFile = "",
    [string]$KeycloakVersion = "26.0.7",
    [string]$WinSwVersion = "v2.12.0"
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Out | Out-Null
$sdlc = Resolve-Path (Join-Path $PSScriptRoot "..")
function Invoke-Build([string]$Script) {
    Write-Host "  build $Script"
    Push-Location (Split-Path $Script)
    try { & pwsh -NoProfile -ExecutionPolicy Bypass -File $Script } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "build failed: $Script" }
}
if ($Build) {
    Write-Host "=== build from source"
    Invoke-Build (Join-Path $sdlc "..\KnowledgeHub\build.ps1")
    Invoke-Build (Join-Path $sdlc "packaging\build_dlc.ps1")
    Invoke-Build (Join-Path $sdlc "packaging_fe\build_fe.ps1")
}
function Get-Newest([string]$Filter, [string]$Not = "") {
    $f = Get-ChildItem (Join-Path $sdlc "dist") -Filter $Filter -ErrorAction SilentlyContinue |
        Where-Object { -not $Not -or $_.Name -notlike $Not } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $f) { throw "no dist\$Filter (run with -Build)" }
    return $f.FullName
}
if (-not $DlcZip) { $DlcZip = Get-Newest "dlc-*-win64.zip" -Not "dlc-fe-*" }
if (-not $FeZip) { $FeZip = Get-Newest "dlc-fe-*-win64.zip" }
function Get-File([string]$Url, [string]$Dest) {
    if (Test-Path $Dest) { Write-Host "  have $(Split-Path -Leaf $Dest)"; return }
    Write-Host "  download $Url"; Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
}
Write-Host "=== third-party downloads"
Get-File "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse" (Join-Path $Out "OpenJDK21U-jdk_x64_windows_hotspot.zip")
Get-File "https://github.com/keycloak/keycloak/releases/download/$KeycloakVersion/keycloak-$KeycloakVersion.zip" (Join-Path $Out "keycloak-$KeycloakVersion.zip")
Get-File "https://github.com/winsw/winsw/releases/download/$WinSwVersion/WinSW-x64.exe" (Join-Path $Out "WinSW-x64.exe")
# WinSW 2.12 x64 is a ~17 MB self-contained exe; a small file here is a placeholder that installs no service
if ((Get-Item (Join-Path $Out "WinSW-x64.exe")).Length -lt 5MB) { throw "WinSW-x64.exe in $Out is not WinSW (too small): delete it and run again" }

Write-Host "=== our packages"
if (-not (Test-Path (Join-Path $KhDist "KnowledgeHub.exe"))) { throw "knowledge store not built: $KhDist (run its build.ps1)" }
$khZip = Join-Path $Out "KnowledgeHub-win64.zip"
if (Test-Path $khZip) { Remove-Item $khZip }
# ship the program only: no data, logs or .env that a local test run may have left in dist
$stage = Join-Path $env:TEMP ("kh-stage-" + [guid]::NewGuid().ToString("N")); New-Item -ItemType Directory $stage | Out-Null
# Exclude runtime folders by FULL path: a bare name such as "data" also drops library folders like
# _internal\torch\utils\data, and the exe then fails to start (found in the 2026-10-12 rehearsal).
$xd = @("logs", "chroma_data", "kuzu_data", "kuzu_projects", "projects", "data") | ForEach-Object { Join-Path $KhDist $_ }
$xf = @(".env", "hooks.db", "hooks.db-wal", "hooks.db-shm") | ForEach-Object { Join-Path $KhDist $_ }
robocopy $KhDist (Join-Path $stage "KnowledgeHub") /E /XD @xd /XF @xf /NFL /NDL /NJH /NJS /NP | Out-Null
if (-not (Test-Path (Join-Path $stage "KnowledgeHub\_internal\torch\utils\data"))) { throw "staged knowledge store is incomplete (torch\utils\data missing)" }
Compress-Archive -Path (Join-Path $stage "KnowledgeHub") -DestinationPath $khZip -CompressionLevel Optimal
Remove-Item -Recurse -Force $stage
Write-Host "  $khZip"
Copy-Item $DlcZip (Join-Path $Out (Split-Path -Leaf $DlcZip)) -Force
Copy-Item $FeZip (Join-Path $Out (Split-Path -Leaf $FeZip)) -Force
if ($LessonsFile) { Copy-Item $LessonsFile (Join-Path $Out (Split-Path -Leaf $LessonsFile)) -Force }

Write-Host "=== signing key for the knowledge store"
$key = Join-Path $Out "kh-signing-key.pem"
if (-not (Test-Path $key)) {
    $openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
    if (-not $openssl -and (Test-Path "C:\Program Files\Git\usr\bin\openssl.exe")) { $openssl = "C:\Program Files\Git\usr\bin\openssl.exe" }
    if (-not $openssl) { throw "openssl not found (install Git for Windows) - needed once to make the Ed25519 key" }
    & $openssl genpkey -algorithm ed25519 -out $key
}
Write-Host "  $key  (keep it secret; it signs the engine's tokens)"

Write-Host "=== scripts"
$kit = Join-Path $Out "kit"
New-Item -ItemType Directory -Force (Join-Path $kit "windows"), (Join-Path $kit "keycloak") | Out-Null
Copy-Item (Join-Path $PSScriptRoot "windows\*") (Join-Path $kit "windows") -Recurse -Force
Copy-Item (Join-Path $PSScriptRoot "keycloak\*") (Join-Path $kit "keycloak") -Recurse -Force   # themes\dlc too
Copy-Item (Join-Path $PSScriptRoot "..\..\KnowledgeHub\deploy\windows\kh.agents.env") (Join-Path $kit "windows") -Recurse -Force
Write-Host "=== SHA256SUMS (upgrade-stack.ps1 checks them)"
$pk = @("OpenJDK21U-jdk_x64_windows_hotspot.zip", "keycloak-$KeycloakVersion.zip", "WinSW-x64.exe", "KnowledgeHub-win64.zip",
        (Split-Path -Leaf $DlcZip), (Split-Path -Leaf $FeZip))
($pk | ForEach-Object { "$((Get-FileHash (Join-Path $Out $_) -Algorithm SHA256).Hash.ToLower())  $_" }) |
    Set-Content -Path (Join-Path $Out "SHA256SUMS") -Encoding ascii
Write-Host "  DlcZip = $(Split-Path -Leaf $DlcZip), FeZip = $(Split-Path -Leaf $FeZip) (stack.config.psd1 must name these)"
Write-Host "kit ready: $Out  (copy the whole folder to the VPS as C:\DLC-install)"
