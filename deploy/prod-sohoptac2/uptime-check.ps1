# Theo dõi sohoptac2 từ BÊN NGOÀI máy chủ (chạy trên máy Windows này, mỗi 5 phút qua Task Scheduler): GET các host prod.
# Lỗi 2 lượt liền ⇒ hiện cửa sổ báo (msg) + ghi log; hồi phục ⇒ báo một lần. Trạng thái giữa các lượt ở file .state cạnh log.
#   powershell -NoProfile -File deploy\prod-sohoptac2\uptime-check.ps1
param(
  [string[]]$Hosts = @("sohoptac", "ai", "ai-admin"),
  [string]$Domain = "evoluconsulting.com",
  [string]$Log = "F:\workspace\tools\_logs\uptime.log"
)
$state = "$Log.state"
$fails = 0
if (Test-Path $state) { $fails = [int](Get-Content $state -TotalCount 1) }
$bad = @()
foreach ($h in $Hosts) {
  try {
    $r = Invoke-WebRequest "https://$h.$Domain" -UseBasicParsing -TimeoutSec 20
    if ($r.StatusCode -ge 400) { $bad += "$h=$($r.StatusCode)" }
  } catch { $bad += "$h=down" }
}
$now = Get-Date -Format s
if ($bad.Count) {
  $fails++
  "$now LOI ($fails) $($bad -join ', ')" | Add-Content $Log
  if ($fails -eq 2) { & msg $env:USERNAME /TIME:0 "sohoptac2 KHONG truy cap duoc: $($bad -join ', ') ($now)" }
} else {
  if ($fails -ge 2) {
    "$now HOI PHUC" | Add-Content $Log
    & msg $env:USERNAME /TIME:0 "sohoptac2 da hoi phuc ($now)"
  }
  $fails = 0
}
Set-Content $state $fails
