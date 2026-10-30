# Shared helpers for the DLC stack scripts (dot-sourced). PowerShell 7 recommended (5.1 works except where noted).

function Read-StackConfig([string]$Path) {
    if (-not $Path) { $Path = Join-Path $PSScriptRoot "stack.config.psd1" }
    if (-not (Test-Path $Path)) { throw "config not found: $Path (copy stack.config.example.psd1 and fill it in)" }
    $c = Import-PowerShellDataFile $Path
    foreach ($k in "VpsIp", "InstallRoot", "KeycloakHttpsPort", "KhPort", "EnginePort", "FePort", "AppPorts") {
        if (-not $c.ContainsKey($k) -or -not "$($c[$k])") { throw "config: $k is required" }
    }
    $c.Paths = @{
        Root     = $c.InstallRoot
        Apps     = Join-Path $c.InstallRoot "apps"
        Data     = Join-Path $c.InstallRoot "data"
        Config   = Join-Path $c.InstallRoot "config"
        Services = Join-Path $c.InstallRoot "services"
        Logs     = Join-Path $c.InstallRoot "logs"
        Secrets  = Join-Path $c.InstallRoot "secrets"
    }
    $c.Urls = @{
        Keycloak = "https://$($c.VpsIp):$($c.KeycloakHttpsPort)"
        Issuer   = "https://$($c.VpsIp):$($c.KeycloakHttpsPort)/realms/dlc"
        Kh       = "http://127.0.0.1:$($c.KhPort)"
        Engine   = "http://$($c.VpsIp):$($c.EnginePort)"
        EngineLocal = "http://127.0.0.1:$($c.EnginePort)"
        Fe       = "http://$($c.VpsIp):$($c.FePort)"
    }
    return $c
}

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "run this script from an elevated (Administrator) PowerShell"
    }
}

function Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "  OK  $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "  !!  $m" -ForegroundColor Yellow }

function New-Secret([int]$Bytes = 24) {
    $b = New-Object byte[] $Bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return -join ($b | ForEach-Object { $_.ToString("x2") })
}

function Protect-Folder([string]$Path) {
    # Administrators + SYSTEM only (secrets, service XML files that carry tokens)
    New-Item -ItemType Directory -Force $Path | Out-Null
    icacls $Path /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
}

function Wait-Http([string]$Url, [int]$Seconds = 180, [switch]$Insecure) {
    $t0 = Get-Date
    while (((Get-Date) - $t0).TotalSeconds -lt $Seconds) {
        try {
            $args = @{ Uri = $Url; TimeoutSec = 5; UseBasicParsing = $true }
            if ($Insecure -and $PSVersionTable.PSVersion.Major -ge 7) { $args.SkipCertificateCheck = $true }
            $r = Invoke-WebRequest @args
            if ($r.StatusCode -lt 500) { return $true }
        } catch {
            $code = $_.Exception.Response.StatusCode.value__
            if ($code -and $code -lt 500) { return $true }
        }
        Start-Sleep 3
    }
    return $false
}

# ---------------------------------------------------------------- WinSW services

function Install-WinSwService {
    <#  One Windows service = <Services>\<Id>.exe (a copy of WinSW) + <Id>.xml.
        $Env: ordered hashtable of environment variables (written into the XML; the Services folder is ACL-protected). #>
    param(
        [Parameter(Mandatory = $true)] $Cfg,
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Executable,
        [string]$Arguments = "",
        [string]$WorkingDirectory = "",
        $Env = @{},
        [string]$Description = "",
        [string[]]$DependsOn = @()
    )
    $svcDir = $Cfg.Paths.Services
    Protect-Folder $svcDir
    $winsw = Join-Path $Cfg.ArtifactsDir $Cfg.WinSwExe
    if (-not (Test-Path $winsw)) { throw "WinSW not found: $winsw" }
    $exe = Join-Path $svcDir "$Id.exe"
    $xmlPath = Join-Path $svcDir "$Id.xml"
    if (Get-Service $Id -ErrorAction SilentlyContinue) {
        & $exe stop 2>$null | Out-Null
        & $exe uninstall 2>$null | Out-Null
        Start-Sleep 2
    }
    Copy-Item $winsw $exe -Force
    $esc = { param($s) [Security.SecurityElement]::Escape([string]$s) }
    $envXml = ($Env.GetEnumerator() | ForEach-Object { "  <env name=`"$(& $esc $_.Key)`" value=`"$(& $esc $_.Value)`" />" }) -join "`n"
    $depXml = ($DependsOn | ForEach-Object { "  <depend>$(& $esc $_)</depend>" }) -join "`n"
    $wd = if ($WorkingDirectory) { $WorkingDirectory } else { Split-Path $Executable }
    @"
<service>
  <id>$(& $esc $Id)</id>
  <name>$(& $esc $Name)</name>
  <description>$(& $esc $Description)</description>
  <executable>$(& $esc $Executable)</executable>
  <arguments>$(& $esc $Arguments)</arguments>
  <workingdirectory>$(& $esc $wd)</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>30 sec</stoptimeout>
  <logpath>$(& $esc $Cfg.Paths.Logs)</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
$depXml
$envXml
</service>
"@ | Set-Content -Encoding UTF8 $xmlPath
    & $exe install | Out-Null
    # a wrong WinSW file (e.g. a placeholder exe) exits 0 without registering anything
    if ($LASTEXITCODE -ne 0 -or -not (Get-Service $Id -ErrorAction SilentlyContinue)) { throw "service install failed: $Id (is $winsw the real WinSW 2.12.0?)" }
    Ok "service $Id installed"
}

function Set-ServiceEnv {
    <# Add or replace environment variables of an installed WinSW service, then restart it. #>
    param([Parameter(Mandatory = $true)] $Cfg, [Parameter(Mandatory = $true)][string]$Id, $Env = @{}, [switch]$NoRestart)
    $xmlPath = Join-Path $Cfg.Paths.Services "$Id.xml"
    [xml]$x = Get-Content $xmlPath
    foreach ($kv in $Env.GetEnumerator()) {
        $node = $x.service.env | Where-Object { $_.name -eq $kv.Key }
        if ($node) { $node.value = [string]$kv.Value }
        else {
            $n = $x.CreateElement("env"); $n.SetAttribute("name", $kv.Key); $n.SetAttribute("value", [string]$kv.Value)
            $x.service.AppendChild($n) | Out-Null
        }
    }
    $x.Save($xmlPath)
    # the engine run by a scheduled task under a person (engine-as-user.ps1) reads its env from <id>.env.json
    $envJson = Join-Path $Cfg.Paths.Services "$Id.env.json"
    if (Test-Path $envJson) {
        $j = [ordered]@{}
        (Get-Content $envJson -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $j[$_.Name] = $_.Value }
        foreach ($kv in $Env.GetEnumerator()) { $j[$kv.Key] = [string]$kv.Value }
        $j | ConvertTo-Json | Set-Content -Path $envJson -Encoding utf8      # an existing file keeps its ACL
    }
    if (-not $NoRestart) {
        if ($Id -eq 'dlc-engine') { Restart-Engine } else { & (Join-Path $Cfg.Paths.Services "$Id.exe") restart | Out-Null }
    }
}

function Test-EngineTask { return [bool](Get-ScheduledTask -TaskName 'DLC Engine' -ErrorAction SilentlyContinue) }

function Restart-Engine {
    <# The engine is the dlc-engine service, or the scheduled task 'DLC Engine' (engine-as-user.ps1). #>
    if (Test-EngineTask) {
        Stop-ScheduledTask -TaskName 'DLC Engine' -ErrorAction SilentlyContinue
        Start-Sleep 2
        Start-ScheduledTask -TaskName 'DLC Engine'
    } else { Restart-Service dlc-engine }
}

function Get-ServiceEnv([Parameter(Mandatory = $true)] $Cfg, [string]$Id, [string]$Name) {
    # the 'DLC Engine' task reads <id>.env.json, so that file is what the engine really gets
    $envJson = Join-Path $Cfg.Paths.Services "$Id.env.json"
    if ((Test-Path $envJson) -and (Test-EngineTask)) { return (Get-Content $envJson -Raw | ConvertFrom-Json).$Name }
    [xml]$x = Get-Content (Join-Path $Cfg.Paths.Services "$Id.xml")
    return ($x.service.env | Where-Object { $_.name -eq $Name }).value
}
