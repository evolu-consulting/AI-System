# Start the DLC stack on demand (no elevation: grant-startstop.ps1 gave this user start/stop rights), wait until it
# answers, open the frontend. The engine runs either as the dlc-engine service or as the scheduled task 'DLC Engine'
# under the signed-in user (engine-as-user.ps1); both are handled. Settings: dlc-local.psd1 next to this file.
$ErrorActionPreference = 'Stop'
$cfgFile = Join-Path $PSScriptRoot 'dlc-local.psd1'
$c = if (Test-Path $cfgFile) { Import-PowerShellDataFile $cfgFile } else { @{} }
$ip = if ($c.Ip) { $c.Ip } else { '127.0.0.1' }
$fe = "http://${ip}:$(if ($c.FePort) { $c.FePort } else { 8795 })/"
$kc = "https://${ip}:$(if ($c.KeycloakPort) { $c.KeycloakPort } else { 8443 })/realms/dlc/.well-known/openid-configuration"
$kh = "http://127.0.0.1:$(if ($c.KhPort) { $c.KhPort } else { 9300 })/health"
$task = Get-ScheduledTask -TaskName 'DLC Engine' -ErrorAction SilentlyContinue
$tray = Join-Path (Split-Path $PSScriptRoot) 'apps\dlc\dlcw.exe'      # red while starting, green when ready (dlc tray)
# --fe: the address sign-in redirects back to (the configured IP, not 127.0.0.1, which the sign-in server refuses)
if (Test-Path $tray) { Start-Process $tray -ArgumentList 'tray', '--fe', $fe -WorkingDirectory (Split-Path $tray) }   # one per user

foreach ($id in 'dlc-keycloak', 'dlc-kh') { if ((Get-Service $id).Status -ne 'Running') { Start-Service $id; Write-Host "  started $id" } }
if ($task) {
    if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName 'DLC Engine'; Write-Host '  started DLC Engine (task)' }
} elseif ((Get-Service dlc-engine).Status -ne 'Running') { Start-Service dlc-engine; Write-Host '  started dlc-engine' }
if ((Get-Service dlc-fe).Status -ne 'Running') { Start-Service dlc-fe; Write-Host '  started dlc-fe' }

$ok = $false; foreach ($i in 1..90) { try { if ((Invoke-WebRequest $fe -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch { }; Start-Sleep 2 }
if (-not $ok) { Write-Host "Frontend did not answer within 3 minutes - see $(Split-Path $PSScriptRoot)\logs" -ForegroundColor Red; Read-Host 'Press Enter'; exit 1 }
foreach ($i in 1..60) { try { Invoke-WebRequest $kc -UseBasicParsing -TimeoutSec 3 | Out-Null; break } catch { Start-Sleep 2 } }
# the knowledge store loads its embedding model for a minute or two; the engine needs it before a run
Write-Host '  waiting for the knowledge store...'
$up = $false; foreach ($i in 1..120) { try { if ((Invoke-RestMethod $kh -TimeoutSec 3).status -eq 'ok') { $up = $true; break } } catch { }; Start-Sleep 2 }
if (-not $up) { Write-Host 'Knowledge store did not answer within 4 minutes - see logs\dlc-kh.err.log' -ForegroundColor Red; Read-Host 'Press Enter'; exit 1 }
Start-Process $fe
