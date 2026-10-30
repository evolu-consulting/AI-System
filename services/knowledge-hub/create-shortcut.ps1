<#
    Create a Windows shortcut that launches KnowledgeHub in the system tray with
    NO console window (via the venv's pythonw.exe). A .lnk shortcut is native and
    is not blocked by antivirus the way a .vbs script is.

    Usage:
        # Create "KnowledgeHub.lnk" in the project folder (default):
        powershell -ExecutionPolicy Bypass -File create-shortcut.ps1

        # Also add it to the current user's Startup folder (auto-start on login):
        powershell -ExecutionPolicy Bypass -File create-shortcut.ps1 -Startup
#>
param(
    [switch]$Startup
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pyw  = Join-Path $projectDir ".venv\Scripts\pythonw.exe"
$tray = Join-Path $projectDir "main.py"
$ico  = Join-Path $projectDir "assets\kh.ico"

if (-not (Test-Path $pyw)) {
    Write-Error "Khong tim thay $pyw. Hay tao virtualenv va cai requirements truoc."
    exit 1
}

function New-KHShortcut([string]$linkPath) {
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($linkPath)
    $sc.TargetPath       = $pyw
    $sc.Arguments        = "`"$tray`""
    $sc.WorkingDirectory = $projectDir
    $sc.WindowStyle      = 7            # 7 = minimized (pythonw has no window anyway)
    $sc.Description      = "Start KnowledgeHub in the system tray (no console)"
    if (Test-Path $ico) { $sc.IconLocation = $ico }
    $sc.Save()
    Write-Host "Created: $linkPath"
}

$local = Join-Path $projectDir "KnowledgeHub.lnk"
New-KHShortcut $local

if ($Startup) {
    $startupDir = [Environment]::GetFolderPath("Startup")
    New-KHShortcut (Join-Path $startupDir "KnowledgeHub.lnk")
    Write-Host "Da them vao Startup - KnowledgeHub se tu chay khi dang nhap Windows."
}

Write-Host ""
Write-Host "Xong. Double-click 'KnowledgeHub.lnk' de khoi dong (chi hien tray icon, khong co cua so)."
