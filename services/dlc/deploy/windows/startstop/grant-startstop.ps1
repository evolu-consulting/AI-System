<#
ONE-TIME, ELEVATED (a test or dev machine that runs DLC only when wanted):
  - copies Start-DLC.ps1 / Stop-DLC.ps1 to <InstallRoot>\bin and writes bin\dlc-local.psd1 (address and ports)
  - sets the dlc-* services to Manual start
  - lets the given Windows user (default: the one running this) start / stop them without elevation

    pwsh -File grant-startstop.ps1 -Config ..\stack.config.psd1 [-Sid S-1-...]
Then, NOT elevated: make-shortcuts.ps1 for desktop shortcuts 'Start DLC' / 'Stop DLC'.
#>
param([string]$Config = "", [string]$Sid = "")
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot "..\common.ps1")
Assert-Admin
$c = Read-StackConfig $(if ($Config) { $Config } else { Join-Path $PSScriptRoot "..\stack.config.psd1" })
if (-not $Sid) { $Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
$bin = Join-Path $c.InstallRoot 'bin'
New-Item -ItemType Directory -Force $bin | Out-Null

Step "Start / Stop scripts -> $bin"
Copy-Item (Join-Path $PSScriptRoot 'Start-DLC.ps1'), (Join-Path $PSScriptRoot 'Stop-DLC.ps1') $bin -Force
@"
@{
    Ip           = '$($c.VpsIp)'
    FePort       = $($c.FePort)
    KeycloakPort = $($c.KeycloakHttpsPort)
    KhPort       = $($c.KhPort)
    EnginePort   = $($c.EnginePort)
}
"@ | Set-Content -Path (Join-Path $bin 'dlc-local.psd1') -Encoding utf8
Ok "Start-DLC.ps1, Stop-DLC.ps1, dlc-local.psd1"

Step "services: Manual start, user $Sid may start / stop them"
foreach ($id in 'dlc-keycloak', 'dlc-kh', 'dlc-engine', 'dlc-fe') {
    if (-not (Get-Service $id -ErrorAction SilentlyContinue)) { Warn "$id not installed"; continue }
    if ((Get-Service $id).StartType -ne 'Disabled') { sc.exe config $id start= demand | Out-Null }   # engine-as-user disables dlc-engine
    $sd = (sc.exe sdshow $id | Where-Object { $_ }) -join ''
    if ($sd -notlike "*$Sid*") {
        $i = $sd.IndexOf('S:'); $ace = "(A;;LCRPWPRC;;;$Sid)"
        $new = if ($i -ge 0) { $sd.Insert($i, $ace) } else { $sd + $ace }
        sc.exe sdset $id $new | Out-Null
    }
    Ok "$id"
}
Write-Host "`nNext, not elevated: pwsh -File make-shortcuts.ps1 -Root $($c.InstallRoot)"
