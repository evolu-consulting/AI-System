<#
.SYNOPSIS
    Fill the realm template (realm-dlc.template.json) with this host's address and ports and write the import file.

.EXAMPLE
    .\render-realm.ps1 -VpsIp 203.0.113.10 -FePort 8795 -EnginePort 8796 -Out C:\DLC\apps\keycloak\data\import\realm-dlc.json
#>
param(
    [Parameter(Mandatory = $true)][string]$VpsIp,
    [int]$FePort = 8795,
    [int]$EnginePort = 8796,
    [string]$CustomerFeOrigin = "http://localhost:3000",
    [string]$CustomerFeRedirect = "http://localhost:3000/*",
    [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = "Stop"
$t = Get-Content -Raw (Join-Path $PSScriptRoot "realm-dlc.template.json")
$t = $t.Replace("__VPS_IP__", $VpsIp).Replace("__FE_PORT__", "$FePort").Replace("__ENGINE_PORT__", "$EnginePort")
$t = $t.Replace("__CUSTOMER_FE_ORIGIN__", $CustomerFeOrigin).Replace("__CUSTOMER_FE_REDIRECT__", $CustomerFeRedirect)
$null = $t | ConvertFrom-Json          # fail here, not inside Keycloak, if the result is not valid JSON
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
Set-Content -Encoding UTF8 $Out $t
Write-Host "realm written: $Out"
