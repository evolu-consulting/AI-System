<#
One-shot elevated install of the DLC Windows kit on this machine (runbook steps 2-5), each step's output appended
to install-log.txt next to this file; typed passwords and the token are never logged.

    pwsh -File run-install.ps1 -LessonsFile ..\lessons-customer.json [-UserName demo] [-SkipFirewall]
                               [-From 3] [-TokenFile <file with a setup-token, deleted after reading>]

  step 2 install-stack   step 3 configure-claude-profile (setup-token)   step 4 seed-stack (lessons, first user)
  step 5 verify-stack    (-From 3 resumes after a finished install-stack)
A masked prompt can come back empty when its output is piped to a log; -TokenFile avoids typing the token.
#>
param([int]$From = 2, [string]$TokenFile = "", [string]$Config = "", [string]$LessonsFile = "",
      [string]$UserName = "demo", [string[]]$UserRoles = @("dlc-user", "dlc-admin"), [switch]$SkipFirewall)
$ErrorActionPreference = "Stop"
$kit = $PSScriptRoot
$cfg = if ($Config) { $Config } else { Join-Path $kit "stack.config.psd1" }
$log = Join-Path $kit "install-log.txt"
"=== run-install $(Get-Date -Format s) from step $From" | Add-Content -Path $log

function Run([string]$title, [scriptblock]$body) {
    "`n===== $title =====" | Tee-Object -FilePath $log -Append
    & $body *>&1 | Tee-Object -FilePath $log -Append
}

try {
    if (-not (Test-Path $cfg)) { throw "config not found: $cfg (copy stack.config.example.psd1 and fill it in)" }
    if ($From -le 2) { Run "STEP 2 install-stack" { & (Join-Path $kit "install-stack.ps1") -Config $cfg -SkipFirewall:$SkipFirewall } }
    if ($From -le 3) {
        if (-not $TokenFile) { Write-Host "`nSTEP 3: paste a setup-token (from 'claude setup-token') at the prompt below." -ForegroundColor Yellow }
        Run "STEP 3 configure-claude-profile" { & (Join-Path $kit "configure-claude-profile.ps1") -Config $cfg -Mode Token -TokenFile $TokenFile }
    }
    if ($From -le 4) {
        Write-Host "`nSTEP 4: set the password of user '$UserName' when asked." -ForegroundColor Yellow
        $seed = @{ Config = $cfg; UserName = $UserName; UserRoles = $UserRoles }
        if ($LessonsFile) { $seed.LessonsFile = $LessonsFile }
        Run "STEP 4 seed-stack" { & (Join-Path $kit "seed-stack.ps1") @seed }
    }
    Write-Host "`nSTEP 5: type the password of '$UserName' again when asked." -ForegroundColor Yellow
    Run "STEP 5 verify-stack" { & (Join-Path $kit "verify-stack.ps1") -Config $cfg -UserName $UserName }
    "`n=== DONE $(Get-Date -Format s)" | Tee-Object -FilePath $log -Append
} catch {
    "`n=== FAILED: $($_.Exception.Message)`n$($_.ScriptStackTrace)" | Tee-Object -FilePath $log -Append
}
Read-Host "`nDone. Press Enter to close"
