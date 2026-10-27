# Bản sao NGOÀI máy chủ: kéo bản backup mới nhất của sohoptac2 (backup.sh chạy 02:30 UTC) về máy Windows này, giữ $Keep bản.
# Bản backup có .env + ADMIN_CREDENTIALS (600 trên máy chủ) ⇒ thư mục đích chỉ cho tài khoản Windows hiện tại đọc.
#   powershell -NoProfile -File deploy\prod-sohoptac2\pull-backup.ps1 [-Dest F:\backups\sohoptac2] [-Keep 14]
param(
  [string]$Dest = "F:\backups\sohoptac2",
  [int]$Keep = 14,
  [string]$Key = "F:\workspace\id_evoc_key",
  [string]$Server = "evoc@149.202.83.5",
  [string]$Log = "F:\workspace\tools\_logs\pull-backup.log"
)
$ErrorActionPreference = "Stop"
function Say($m) { "$(Get-Date -Format s) $m" | Tee-Object -FilePath $Log -Append }
try {
  if (-not (Test-Path $Dest)) {
    New-Item -ItemType Directory -Force $Dest | Out-Null
    & icacls $Dest /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
  }
  $latest = (& ssh -i $Key -o BatchMode=yes $Server 'ls -1d ~/workspace/sohoptac2/backups/2*/ 2>/dev/null | tail -1').Trim()
  if (-not $latest) { throw "khong thay ban backup tren may chu" }
  $name = Split-Path ($latest.TrimEnd('/')) -Leaf
  if (Test-Path (Join-Path $Dest $name)) { Say "da co $name, bo qua"; exit 0 }
  & scp -i $Key -o BatchMode=yes -r -q "${Server}:$latest" "$Dest\"
  if ($LASTEXITCODE -ne 0) { throw "scp loi ($LASTEXITCODE)" }
  Say "da keo $name"
  Get-ChildItem $Dest -Directory | Sort-Object Name -Descending | Select-Object -Skip $Keep |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force -Confirm:$false; Say "da xoa ban cu $($_.Name)" }
} catch {
  Say "LOI: $($_.Exception.Message)"
  exit 1
}
