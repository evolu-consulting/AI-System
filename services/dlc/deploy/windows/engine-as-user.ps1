<#
Run the DLC engine with the rights of the signed-in Windows user (agents then use this user's git, cf, gh,
PATH and files) instead of LocalSystem. For a personal or test PC; a VPS keeps the dlc-engine service under a
dedicated account instead. No password is stored: a scheduled task starts the engine at this user's logon,
with the highest privileges (so it still reads <InstallRoot>\secrets and the service settings).

    pwsh -File engine-as-user.ps1 [-Root C:\DLC]            # switch (self-elevates once; log next to this script)
    pwsh -File engine-as-user.ps1 [-Root C:\DLC] -Revert    # back to the dlc-engine service (LocalSystem)

What it does:
  1. reads the dlc-engine service settings (<Root>\services\dlc-engine.xml): program, arguments, folder, env
  2. writes the env to <Root>\services\dlc-engine.env.json (Administrators + SYSTEM only); common.ps1's
     Set-ServiceEnv keeps it in step with the XML from then on (configure-claude-profile, upgrade-stack)
  3. stops dlc-engine, sets it Disabled (kept for -Revert), and drops dlc-fe's dependency on it
  4. registers task 'DLC Engine': at this user's logon, run level highest, no console (dlcw.exe, the
     windowless build, so stopping the task stops the engine), restarts on failure; waits for /api/health
  5. refreshes <Root>\bin\Start-DLC.ps1 / Stop-DLC.ps1 from startstop\ (they handle service and task)
#>
param([switch]$Revert, [string]$Root = "C:\DLC")
$ErrorActionPreference = 'Stop'
$Task = 'DLC Engine'                    # the name Start-DLC / Stop-DLC / common.ps1 / upgrade-stack look for
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Root', "`"$Root`"")
    if ($Revert) { $a += '-Revert' }
    Start-Process pwsh -Verb RunAs -Wait -ArgumentList $a
    Get-Content (Join-Path $PSScriptRoot 'engine-as-user-log.txt') -Tail 25
    exit
}
Start-Transcript -Path (Join-Path $PSScriptRoot 'engine-as-user-log.txt') -Force | Out-Null
$user = "$env:USERDOMAIN\$env:USERNAME"
$xmlPath = "$Root\services\dlc-engine.xml"
$envPath = "$Root\services\dlc-engine.env.json"
$log = "$Root\logs\dlc-engine.out.log"

function Wait-Engine {
    foreach ($i in 1..60) { try { $h = Invoke-RestMethod 'http://127.0.0.1:8796/api/health' -TimeoutSec 3; return $h } catch { Start-Sleep 2 } }
    throw "engine did not answer on 8796 - see $log"
}

function Stop-EngineProcesses {
    Get-Process dlc, dlcw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Root\apps\dlc\*" } | Stop-Process -Force
}

function Copy-StartStop {
    $src = Join-Path $PSScriptRoot 'startstop'
    if ((Test-Path "$Root\bin") -and (Test-Path $src)) {
        Copy-Item (Join-Path $src 'Start-DLC.ps1'), (Join-Path $src 'Stop-DLC.ps1') "$Root\bin" -Force
        Write-Host "  $Root\bin\Start-DLC.ps1, Stop-DLC.ps1 refreshed"
    }
}

try {
    if ($Revert) {
        Write-Host "=== back to the dlc-engine service (LocalSystem)"
        if (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $Task -Confirm:$false
        }
        Stop-EngineProcesses
        Set-Service dlc-engine -StartupType Manual
        sc.exe config dlc-fe depend= dlc-engine | Out-Null
        Copy-StartStop
        Start-Service dlc-engine
        $h = Wait-Engine; Write-Host "  engine $($h.version) up as LocalSystem"; Write-Host "DONE"
        return
    }
    Write-Host "=== 1. read the dlc-engine service settings"
    [xml]$x = Get-Content $xmlPath -Raw
    $svc = $x.service
    $exe = [string]$svc.executable
    $args0 = [string]$svc.arguments
    $wd = [string]$svc.workingdirectory
    $envs = [ordered]@{}
    foreach ($e in $svc.env) { $envs[$e.name] = $e.value }
    Write-Host "  program $exe $args0 (folder $wd), $($envs.Count) env entries"

    Write-Host "=== 2. env file (Administrators + SYSTEM only)"
    $envs | ConvertTo-Json | Set-Content -Path $envPath -Encoding utf8
    icacls $envPath /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null

    Write-Host "=== 3. service dlc-engine -> Disabled, dlc-fe no longer depends on it"
    if ((Get-Service dlc-engine).Status -ne 'Stopped') { Stop-Service dlc-engine -Force }
    Set-Service dlc-engine -StartupType Disabled
    sc.exe config dlc-fe depend= dlc-kh | Out-Null

    Write-Host "=== 4. task '$Task' for $user"
    # dlcw.exe: the windowless build next to dlc.exe, so stopping the task stops the engine itself
    $exew = Join-Path (Split-Path $exe) 'dlcw.exe'
    if (-not (Test-Path $exew)) { throw "missing $exew - upgrade to a DLC package that has dlcw.exe first (upgrade-stack.ps1)" }
    $taskArgs = "--env-file `"$envPath`" --log-file `"$log`" $args0"
    $action = New-ScheduledTaskAction -Execute $exew -Argument $taskArgs -WorkingDirectory $wd
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable
    # a running engine of an earlier task definition: stop it first, or it lives on next to the new one
    if (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue }
    Stop-EngineProcesses
    Start-Sleep 2
    # any other task that starts this engine (an earlier run under another name): remove it
    Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -ne $Task -and (($_.Actions.Execute + ' ' + ($_.Actions.Arguments -join ' ')) -like '*dlc*serve*') } |
        ForEach-Object { Stop-ScheduledTask -TaskName $_.TaskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false; Write-Host "  removed old task $($_.TaskName)" }
    Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $Task
    $h = Wait-Engine
    $p = Get-CimInstance Win32_Process -Filter "Name='dlcw.exe'" | Select-Object -First 1
    $owner = if ($p) { Invoke-CimMethod -InputObject $p -MethodName GetOwner } else { $null }
    Write-Host "  engine $($h.version) up, running as $($owner.Domain)\$($owner.User)"

    Write-Host "=== 5. Start-DLC / Stop-DLC"
    Copy-StartStop
    if ((Get-Service dlc-fe).Status -ne 'Running') { Start-Service dlc-fe }
    Write-Host "DONE"
} catch {
    Write-Host "FAILED: $_" -ForegroundColor Red
} finally {
    Stop-Transcript | Out-Null
}
