<#
.SYNOPSIS
    Remove the DLC services and firewall rules. Data, secrets and program files are KEPT unless -RemoveFiles.

.EXAMPLE
    pwsh -File .\uninstall-stack.ps1 -Config .\stack.config.psd1            # services + firewall only
    pwsh -File .\uninstall-stack.ps1 -Config .\stack.config.psd1 -RemoveFiles   # everything under InstallRoot
#>
param([string]$Config = "", [switch]$RemoveFiles)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "common.ps1")
Assert-Admin
$c = Read-StackConfig $Config
foreach ($id in "dlc-fe", "dlc-engine", "dlc-kh", "dlc-keycloak") {
    $exe = Join-Path $c.Paths.Services "$id.exe"
    if (Test-Path $exe) { & $exe stop | Out-Null; & $exe uninstall | Out-Null; Ok "service $id removed" }
}
foreach ($n in "DLC Keycloak", "DLC Frontend", "DLC Engine", "DLC Apps") {
    Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}
Ok "firewall rules removed"
$cer = Join-Path $c.Paths.Config "keycloak-tls.cer"
if (Test-Path $cer) {
    $thumb = (New-Object Security.Cryptography.X509Certificates.X509Certificate2 $cer).Thumbprint
    Get-ChildItem Cert:\LocalMachine\Root | Where-Object Thumbprint -eq $thumb | Remove-Item
    Ok "Keycloak certificate removed from the trusted roots"
}
if ($RemoveFiles) {
    $answer = Read-Host "Delete EVERYTHING under $($c.Paths.Root) (data included)? type DELETE"
    if ($answer -eq "DELETE") { Remove-Item -Recurse -Force $c.Paths.Root; Ok "removed $($c.Paths.Root)" }
    else { Warn "files kept" }
}
