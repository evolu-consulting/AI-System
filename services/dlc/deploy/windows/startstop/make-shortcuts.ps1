# NOT elevated, as the user who clicks the shortcuts: desktop shortcuts 'Start DLC' / 'Stop DLC' for the scripts
# grant-startstop.ps1 put in <InstallRoot>\bin. Works with a OneDrive-redirected desktop.
param([string]$Root = "C:\DLC")
$desk = [Environment]::GetFolderPath('Desktop'); $pw = (Get-Command pwsh).Source; $w = New-Object -ComObject WScript.Shell
foreach ($n in @(@{f = 'Start DLC'; s = 'Start-DLC.ps1'; i = '%SystemRoot%\System32\imageres.dll,101'},
                 @{f = 'Stop DLC';  s = 'Stop-DLC.ps1';  i = '%SystemRoot%\System32\imageres.dll,100'})) {
    $l = $w.CreateShortcut((Join-Path $desk "$($n.f).lnk")); $l.TargetPath = $pw
    $l.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Root\bin\$($n.s)`""
    $l.WorkingDirectory = $Root; $l.IconLocation = $n.i; $l.Save()
    "created $(Join-Path $desk "$($n.f).lnk")"
}
# the tray icon (dlcw.exe tray: red while the stack starts, green when ready, click opens it) at every sign-in, and now
$tray = "$Root\apps\dlc\dlcw.exe"
if (Test-Path $tray) {
    # it opens the frontend at the configured address (bin\dlc-local.psd1 of grant-startstop.ps1): sign-in redirects
    # back only to that one, so http://127.0.0.1 ends on the sign-in server's 'invalid redirect' page
    $local = "$Root\bin\dlc-local.psd1"
    $c = if (Test-Path $local) { Import-PowerShellDataFile $local } else { @{} }
    $fe = "http://$(if ($c.Ip) { $c.Ip } else { '127.0.0.1' }):$(if ($c.FePort) { $c.FePort } else { 8795 })/"
    # the Run key, not a Startup shortcut: it needs no COM (blocked where PowerShell runs in constrained language mode)
    Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'DLC Tray' -Value "`"$tray`" tray --fe $fe"
    Start-Process $tray -ArgumentList 'tray', '--fe', $fe -WorkingDirectory "$Root\apps\dlc"      # one per user: a second one exits
    "registered DLC Tray at sign-in (HKCU Run) and started the tray"
}
