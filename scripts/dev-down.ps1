# Tắt mọi tiến trình scripts\dev-up.ps1 đã bật (cả cây tiến trình con). Không tắt Postgres/Redis
# (docker compose stop, hoặc scripts\dev-db.ps1 -Stop).
$pidFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".data\dev-up\pids.txt"
if (-not (Test-Path $pidFile)) { "Không có gì để tắt."; return }
foreach ($line in Get-Content $pidFile) {
  $name, $id = $line -split " ", 2
  & taskkill /PID $id /T /F *> $null
  "{0,-14} pid {1} {2}" -f $name, $id, $(if ($LASTEXITCODE -eq 0) { "đã tắt" } else { "đã dừng từ trước" })
}
Remove-Item $pidFile
