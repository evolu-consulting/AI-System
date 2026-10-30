# Stop the DLC stack (no elevation needed after grant-startstop.ps1). Handles the engine as a service or as the
# scheduled task 'DLC Engine' (engine-as-user.ps1).
if ((Get-ScheduledTask -TaskName 'DLC Engine' -ErrorAction SilentlyContinue).State -eq 'Running') {
    Stop-ScheduledTask -TaskName 'DLC Engine'; Write-Host '  stopped DLC Engine (task)'
}
foreach ($id in 'dlc-fe', 'dlc-engine', 'dlc-kh', 'dlc-keycloak') {
    $s = Get-Service $id -ErrorAction SilentlyContinue
    if ($s -and $s.Status -ne 'Stopped') { Stop-Service $id -Force; Write-Host "  stopped $id" }
}
