<#
Replace the Claude setup-token of the DLC engine from the clipboard, on the engine host.
(The same can be done in the web: Admin > Claude token, tested and used from the next agent call, no restart.)

1) run `claude setup-token` in any terminal and copy the token it prints (Ctrl+C)
2) run this script (right click > Run with PowerShell): it asks for admin, reads the token from the clipboard,
   sets it for the engine (service or 'DLC Engine' task), proves `claude -p` answers, restarts the engine and
   clears the clipboard. The token never goes to the screen or a log.

    pwsh -File set-claude-token.ps1 [-Config stack.config.psd1]
#>
param([string]$Config = "")
$ErrorActionPreference = "Stop"
$self = $MyInvocation.MyCommand.Path
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $a = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$self`"")
    if ($Config) { $a += @("-Config", "`"$Config`"") }
    Start-Process pwsh -Verb RunAs -ArgumentList $a
    return
}
. (Join-Path $PSScriptRoot "common.ps1")
$tmp = $null
try {
    $cfgPath = if ($Config) { $Config } else { Join-Path $PSScriptRoot "stack.config.psd1" }
    $c = Read-StackConfig $cfgPath
    $tok = "$(Get-Clipboard -Raw)".Trim()
    if ($tok -notmatch '^sk-ant-oat01-[A-Za-z0-9_\-]{40,}$') {
        throw "the clipboard does not hold a setup-token (expected sk-ant-oat01-...). Copy the token printed by 'claude setup-token' and run again."
    }
    $tmp = Join-Path $env:TEMP ("cc-token-" + [guid]::NewGuid().ToString("N") + ".txt")
    Set-Content -LiteralPath $tmp -Value $tok -NoNewline
    icacls $tmp /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" | Out-Null
    & (Join-Path $PSScriptRoot "configure-claude-profile.ps1") -Config $cfgPath -Mode Token -TokenFile $tmp
    Restart-Engine
    Set-Clipboard -Value $null
    Write-Host "`nOK: the engine uses the new token and was restarted; clipboard cleared." -ForegroundColor Green
} catch {
    Write-Host "`nFAILED: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Force }
}
Read-Host "`nPress Enter to close"
