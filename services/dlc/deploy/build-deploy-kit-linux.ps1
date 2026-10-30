<#
.SYNOPSIS
    On the BUILD machine (Windows + Docker Desktop): build the Linux packages and gather the Linux deploy kit
    into one folder (copy it to the server, e.g. /opt/dlc-install, then follow linux/README in the kit).

.DESCRIPTION
    Builds (unless -SkipBuild) the three Linux x64 packages in Docker:
      dlc-<v>-linux-x64.tar.gz, dlc-fe-<v>-linux-x64.tar.gz   (packaging/linux/Dockerfile)
      KnowledgeHub-linux-x64.tar.gz                          (KnowledgeHub/deploy/linux/Dockerfile)
    then adds Temurin JDK 21 (Linux x64), Keycloak, a fresh Ed25519 signing key for the knowledge store, the
    lessons file and the install scripts (kit/linux/*, kit/keycloak/realm-dlc.template.json). Nothing from the
    source tree is copied except these scripts and templates.

.EXAMPLE
    pwsh -File .\build-deploy-kit-linux.ps1 -Out E:\lw\dlc-kit-linux -LessonsFile ..\docs\internal\deploy\seed\lessons-customer.json
#>
param(
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$LessonsFile = "",
    [string]$KeycloakVersion = "26.0.7",
    [string]$KeycloakZipFrom = "",          # reuse an already downloaded keycloak-<v>.zip (e.g. from the Windows kit)
    [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$sdlc = Resolve-Path (Join-Path $PSScriptRoot "..")
$kh = Resolve-Path (Join-Path $sdlc "..\KnowledgeHub")
New-Item -ItemType Directory -Force $Out | Out-Null

if (-not $SkipBuild) {
    Write-Host "=== build: engine + frontend (Linux x64)"
    docker build -f (Join-Path $sdlc "packaging\linux\Dockerfile") --target out --output "type=local,dest=$(Join-Path $sdlc 'dist\linux')" $sdlc
    if ($LASTEXITCODE -ne 0) { throw "engine/frontend Linux build failed" }
    Write-Host "=== build: knowledge store (Linux x64)"
    docker build -f (Join-Path $kh "deploy\linux\Dockerfile") --target out --output "type=local,dest=$(Join-Path $kh 'dist\linux')" $kh
    if ($LASTEXITCODE -ne 0) { throw "knowledge store Linux build failed" }
}

function Get-File([string]$Url, [string]$Dest) {
    if (Test-Path $Dest) { Write-Host "  have $(Split-Path -Leaf $Dest)"; return }
    Write-Host "  download $Url"; Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
}
Write-Host "=== third-party downloads"
Get-File "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" (Join-Path $Out "OpenJDK21U-jdk_x64_linux_hotspot.tar.gz")
$kcZip = Join-Path $Out "keycloak-$KeycloakVersion.zip"
if ($KeycloakZipFrom -and -not (Test-Path $kcZip)) { Copy-Item $KeycloakZipFrom $kcZip }
Get-File "https://github.com/keycloak/keycloak/releases/download/$KeycloakVersion/keycloak-$KeycloakVersion.zip" $kcZip

Write-Host "=== our packages"
$pk = @(Get-ChildItem (Join-Path $sdlc "dist\linux") -Filter "dlc-*-linux-x64.tar.gz") + @(Get-Item (Join-Path $kh "dist\linux\KnowledgeHub-linux-x64.tar.gz"))
if ($pk.Count -lt 3) { throw "Linux packages missing (run without -SkipBuild)" }
foreach ($f in $pk) { Copy-Item $f.FullName (Join-Path $Out $f.Name) -Force; Write-Host "  $($f.Name)  $([Math]::Round($f.Length / 1MB, 1)) MB" }
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

Write-Host "=== scripts (LF line endings)"
$kit = Join-Path $Out "kit"
New-Item -ItemType Directory -Force (Join-Path $kit "linux"), (Join-Path $kit "keycloak") | Out-Null
$files = @(Get-ChildItem (Join-Path $PSScriptRoot "linux") -File | Where-Object { $_.Name -ne ".gitattributes" }) +
         @(Get-Item (Join-Path $kh "deploy\windows\kh.agents.env"))
foreach ($f in $files) {
    $text = [IO.File]::ReadAllText($f.FullName) -replace "`r`n", "`n"
    [IO.File]::WriteAllText((Join-Path $kit "linux\$($f.Name)"), $text, (New-Object Text.UTF8Encoding $false))
}
Copy-Item (Join-Path $PSScriptRoot "keycloak\realm-dlc.template.json") (Join-Path $kit "keycloak") -Force
Copy-Item (Join-Path $PSScriptRoot "keycloak\themes") (Join-Path $kit "keycloak") -Recurse -Force   # sign-in theme dlc

Write-Host "=== checksums"
$sums = Get-ChildItem $Out -File | Where-Object { $_.Name -notin "kh-signing-key.pem", "SHA256SUMS" } | ForEach-Object {
    "{0}  {1}" -f (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLower(), $_.Name }
[IO.File]::WriteAllText((Join-Path $Out "SHA256SUMS"), (($sums -join "`n") + "`n"))
Write-Host "kit ready: $Out  (copy the whole folder to the server; chmod +x kit/linux/*.sh)"
