# Chạy đêm (Task Scheduler LOCAL của máy này; không cron/cấu hình trên máy chủ): test:all trên evotest cho platform/gd0.
#   powershell -File deploy/evotest/nightly.ps1 [-Ref platform/gd0]
# Gọi run-tests.ps1 -Step all (project evotest, trần 6 CPU/24 GB, nice 19 do remote.sh/compose giữ), rồi ghi
# .data/evotest/nightly-<ngày>.md: mã thoát, thời gian, thư mục log, vài dòng cuối + dòng pass/fail.
param([string]$Ref = "platform/gd0")
$ErrorActionPreference = "Continue"
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Data = Join-Path $Repo ".data\evotest"
New-Item -ItemType Directory -Force $Data | Out-Null
$t0 = Get-Date
$commit = (git -C $Repo rev-parse --short $Ref).Trim()
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\run-tests.ps1" -Step all -Ref $Ref | Out-Null
$rc = $LASTEXITCODE
$secs = [int]((Get-Date) - $t0).TotalSeconds
$dir = Get-ChildItem $Data -Directory -Filter "*-all" | Where-Object { $_.CreationTime -ge $t0.AddMinutes(-1) } | Sort-Object CreationTime | Select-Object -Last 1
$tail = @(); $marks = @()
if ($dir -and (Test-Path "$($dir.FullName)\console.log")) {
  $log = Get-Content "$($dir.FullName)\console.log" -Encoding UTF8
  $tail = $log | Select-Object -Last 15
  $marks = $log | Where-Object { $_ -match '^\s*(\d+ (pass|fail)|Ran \d+ tests|FAIL|✗|✘)' } | Select-Object -Last 15
}
$status = if ($rc -eq 0) { "XANH" } else { "ĐỎ/LỖI (exit $rc; 2 dựng/setup, 3 bận, 4 đĩa)" }
$md = @("# evotest nightly $(Get-Date -Format yyyy-MM-dd)", "",
  "- Ref: $Ref ($commit), bước: all", "- Kết quả: $status", "- Thời gian: $secs s (bắt đầu $($t0.ToString('HH:mm')))",
  "- Log đầy đủ: $(if ($dir) { $dir.FullName } else { '(không tìm thấy)' })", "", "## Dòng pass/fail", '```', $marks, '```', "", "## 15 dòng cuối", '```', $tail, '```')
[IO.File]::WriteAllText("$Data\nightly-$(Get-Date -Format yyyy-MM-dd).md", ($md -join "`n") + "`n", (New-Object Text.UTF8Encoding $false))
exit $rc
