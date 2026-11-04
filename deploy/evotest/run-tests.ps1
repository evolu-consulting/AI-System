# Chạy test:all trên máy chủ 149.202.83.5 trong project Docker RIÊNG "evotest" (xem README.md). Cần: ssh key, git, tar, scp.
#   pwsh deploy/evotest/run-tests.ps1 [-Step int|e2e|unit|py|all] [-Ref HEAD] [-Dirty] [-All: gồm cả suite module đóng băng (F1, kiểm tra hằng tháng); mặc định bỏ] [-Filter "tests/a tests/b" (int/perf) | "root,N1" (e2e: việc test:e2e:par)] [-Workers N (int)]; -Step perf = PERF=1, mặc định HD4; -Step py = pytest agent-runtime (Linux, python3.12 + uv sync --frozen; -Filter = đường dẫn/biểu thức pytest tương đối apps/agent-runtime; không nằm trong all) [-DryRun]
# -Exclusive (chỉ -Step perf, CR-115): chờ mọi slot rảnh (tối đa -ExclusiveTimeoutMin phút, mặc định 60; hết giờ => exit 3), giữ khoá toàn máy ~/workspace/evotest/.exclusive trong lúc đo (lượt khác xếp hàng),
#   nhả khoá cả khi lỗi/Ctrl-C; load/RAM lúc bắt đầu + kết thúc in ra và ghi vào <log>\exclusive.txt. Luật khoá: deploy/evotest/lock.sh.
# -Probe "runs=3,size=small" (CR-116, chỉ -Step perf|py): bật PERF_PROBE=1 + PERF_PROBE_OPTS trong container; -Exclusive cũng dùng được với -Step py. Điều khiển bởi `bun run perf:probe` (docs/WORKFLOW.md "Đo perf").
# git archive <Ref> (+ thay đổi chưa commit nếu -Dirty) -> scp -> remote.sh (build, chạy, dọn) -> log về .data/evotest/<giờ>/.
# Thoát bằng mã test (0 xanh; 2 lỗi dựng/setup; 3 chờ slot quá 90 phút; 4 đĩa).
# tool-evotest-cache:
#   LƯỢT TOÀN BỘ (-Step int|e2e|all KHÔNG -Filter): từ chối chạy (exit 5) khi slot khác còn bận, trừ khi -Force; trong lúc nó chạy giữ khoá .exclusive nên lượt khác xếp hàng (lock.sh full_acquire).
#   -NoCache: tắt cache dựng web (/cache/build) + mẫu DB (dbtpl) cho lượt này (đo "trước", nghi cache sai).
#   -CachePrune [-Keep N=5] [-MaxGb G=6]: chỉ dọn cache chung trên máy chủ (giữ N ref dùng gần nhất, trần dung lượng) rồi thoát. Remote.sh cũng tự dọn cuối mỗi lượt.
param([ValidateSet("int", "e2e", "unit", "all", "perf", "py")][string]$Step = "int", [string]$Ref = "HEAD", [switch]$Dirty, [switch]$DryRun, [string]$Filter = "", [int]$Workers = 0, [switch]$All, [ValidateRange(1,8)][int]$Slots = 8, [ValidateSet("", "cw")][string]$Capture = "", [switch]$Exclusive, [ValidateRange(1,600)][int]$ExclusiveTimeoutMin = 60, [string]$Probe = "", [switch]$Force, [switch]$NoCache, [switch]$CachePrune, [ValidateRange(1,50)][int]$Keep = 5, [ValidateRange(1,100)][int]$MaxGb = 6)
$ErrorActionPreference = "Stop"
$isFull = (($Step -in "int", "e2e", "all") -and -not $Filter -and -not $Exclusive)
if ($Force -and -not $isFull) { Write-Host "evotest: -Force chỉ có nghĩa với lượt toàn bộ (int|e2e|all không -Filter); bỏ qua" }
if ($Exclusive -and $Step -ne "perf" -and $Step -ne "py") { throw "-Exclusive chỉ dùng với -Step perf|py (đo hiệu năng cần máy yên)" }
if ($Probe -and $Step -ne "perf" -and $Step -ne "py") { throw "-Probe chỉ dùng với -Step perf|py" }
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Key = "F:\workspace\id_evoc_key"; $Server = "evoc@149.202.83.5"
$ssh = @("-i", $Key, "-o", "BatchMode=yes")
$commit = (git -C $Repo rev-parse --short $Ref).Trim() + $(if ($Dirty) { "+dirty" } else { "" })
$stamp = (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + $PID   # PID: các lượt cùng giây không đè thư mục tạm/file /tmp/log của nhau
$out = Join-Path $Repo ".data\evotest\$stamp-$Step"
$tmp = Join-Path $env:TEMP "evotest-$stamp"
$finished = $false

if ($CachePrune) {
  $cs = (Get-Content -Raw "$PSScriptRoot\cache.sh").Replace("`r`n", "`n"); $ct = Join-Path $env:TEMP "evotest-cache-$stamp.sh"
  [IO.File]::WriteAllText($ct, $cs, (New-Object Text.UTF8Encoding $false))
  try {
    scp @ssh $ct "${Server}:/tmp/evotest-cache-$stamp.sh"
    ssh @ssh $Server "R=`$HOME/workspace/evotest; C=`$R/cache; . /tmp/evotest-cache-$stamp.sh; cache_prune $Keep $MaxGb; unlink /tmp/evotest-cache-$stamp.sh" 2>&1
  } finally { Remove-Item -Force $ct -ErrorAction SilentlyContinue }
  return
}
if ($DryRun) {
  Write-Host "commit $commit, bước $Step -> $Server ~/workspace/evotest/slots/sN (N = slot trống đầu tiên trong $Slots); log: $out$(if ($isFull) { '; LƯỢT TOÀN BỘ' + $(if ($Force) { ' (-Force)' } else { ' (từ chối nếu slot khác bận)' }) })"
  Write-Host "ssh: bash ~/workspace/evotest/boot.sh -> remote.sh $Step $commit (sau khi scp evotest-app.tgz + evotest-kit.tgz vào /tmp)"
  return
}
# Tải máy chủ + slot trước khi dựng (chỉ in, không chặn; boot.sh vẫn tự xếp hàng). Chi tiết: bun run res:check --server
$ErrorActionPreference = "Continue"
try {
  $probe ='cat /proc/loadavg; nproc; grep MemAvailable /proc/meminfo; df -Pk $HOME | tail -1; for i in $(seq 1 ' + $Slots + '); do if [ $i = 1 ]; then l=$HOME/workspace/evotest/.lock; else l=$HOME/workspace/evotest/slots/s$i/.lock; fi; if [ -d $l ]; then echo busy$i; else echo free$i; fi; done'
  $p = @(ssh @ssh -o ConnectTimeout=8 $Server $probe 2>$null)
  if ($LASTEXITCODE -eq 0 -and $p.Count -ge 4) {
    $load = ($p[0] -split ' ')[0]; $cores = $p[1]
    $ramGb = [math]::Round((($p[2] -split '\s+')[1]) / 1MB, 1); $diskGb = [math]::Round((($p[3] -split '\s+')[3]) / 1MB, 0)
    $busy = @($p | Where-Object { $_ -like 'busy*' } | ForEach-Object { 's' + $_.Substring(4) })
    Write-Host ("evotest: máy chủ load {0}/{1} lõi, RAM trống {2} GB, đĩa trống {3} GB, slot bận {4}/{5} {6} (chi tiết: bun run res:check --server)" -f $load, $cores, $ramGb, $diskGb, $busy.Count, $Slots, ($busy -join ','))
    if ($isFull -and $busy.Count -gt 0 -and -not $Force) {
      Write-Host "evotest: LƯỢT TOÀN BỘ ($Step không -Filter) từ chối - slot đang bận: $($busy -join ','). Chạy lại khi rảnh (bun run res:check --server) hoặc thêm -Force."
      exit 5
    }
    if ($busy.Count -ge $Slots) { Write-Warning "evotest: mọi slot đều bận - lượt này sẽ xếp hàng (tối đa 90 phút)" }
    elseif ([double]$load -gt [double]$cores) { Write-Warning "evotest: máy chủ đang quá tải (load $load > $cores lõi)" }
  } else { Write-Host "evotest: không đọc được tải máy chủ (bỏ qua; boot.sh vẫn xếp hàng)" }
} catch { Write-Host "evotest: không đọc được tải máy chủ ($($_.Exception.Message))" }
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $tmp, $out | Out-Null
try {
  git -C $Repo archive --format=tar.gz -o "$tmp\evotest-app-$stamp.tgz" $Ref
  if ($Dirty) {
    # chồng thay đổi chưa commit (đã sửa + chưa theo dõi, trừ file bị ignore) lên bản archive; file đã xoá thì xoá khỏi bản sao
    $src = "$tmp\src"; New-Item -ItemType Directory $src | Out-Null
    tar.exe -xzf "$tmp\evotest-app-$stamp.tgz" -C $src
    $changed = @(git -C $Repo -c core.quotepath=off ls-files -m -o --exclude-standard) + @(git -C $Repo -c core.quotepath=off diff --cached --name-only) | Sort-Object -Unique   # gồm cả file đã stage (F-02)
    foreach ($f in $changed) {
      $p = Join-Path $Repo $f
      if (Test-Path -LiteralPath $p) { $t = Join-Path $src $f; New-Item -ItemType Directory -Force (Split-Path $t) | Out-Null; Copy-Item -LiteralPath $p $t -Force }
      else { Remove-Item -LiteralPath (Join-Path $src $f) -Force -ErrorAction SilentlyContinue }
    }
    tar.exe -czf "$tmp\evotest-app-$stamp.tgz" -C $src .
  }
  # Bộ dựng/chạy lấy từ thư mục này (không phụ thuộc Ref có chứa deploy/evotest hay không); ép LF cho .sh
  foreach ($f in "remote.sh", "in-container.sh", "boot.sh", "lock.sh", "cache.sh") {
    $t = [IO.File]::ReadAllText("$PSScriptRoot\$f").Replace("`r`n", "`n"); [IO.File]::WriteAllText("$tmp\$f", $t, (New-Object Text.UTF8Encoding $false))
  }
  Copy-Item "$PSScriptRoot\docker-compose.yml", "$PSScriptRoot\docker-compose.exclusive.yml", "$PSScriptRoot\Dockerfile" $tmp; Copy-Item -Recurse "$PSScriptRoot\pg-init" $tmp
  tar.exe -czf "$tmp\evotest-kit-$stamp.tgz" -C $tmp docker-compose.yml docker-compose.exclusive.yml Dockerfile remote.sh in-container.sh cache.sh pg-init
  ssh @ssh $Server "mkdir -p ~/workspace/evotest"
  scp @ssh "$tmp\evotest-app-$stamp.tgz" "$tmp\evotest-kit-$stamp.tgz" "${Server}:/tmp/"
  $t0 = Get-Date
  # Slot song song (mặc định 8, đổi bằng -Slots): boot.sh chọn slot trống đầu tiên (mkdir .lock nguyên tử, gỡ lock mồ côi), chỉ chờ khi mọi slot bận.
  # boot.sh scp lên /tmp (tránh lỗi PS 5.1 bỏ dấu nháy kép khi truyền đối số ssh); 2>&1 phía máy chủ để PS 5.1 không coi stderr là lỗi.
  scp @ssh "$tmp\boot.sh" "${Server}:/tmp/evotest-boot-$stamp.sh"
  scp @ssh "$tmp\lock.sh" "${Server}:/tmp/evotest-lock-$stamp.sh"
  $boot = "EVO_LOCKLIB=/tmp/evotest-lock-$stamp.sh EVO_EXCLUSIVE='$(if ($Exclusive) { 1 })' EVO_FULL_RUN='$(if ($isFull) { 1 })' EVO_FORCE='$(if ($Force) { 1 })' EVO_NOCACHE='$(if ($NoCache) { 1 })' EVO_EXCLUSIVE_TIMEOUT_S=$($ExclusiveTimeoutMin * 60) EVO_SLOTS=$Slots EVO_CAPTURE='$Capture' EVO_ALL='$(if ($All) { 1 })' EVO_WORKERS='$(if ($Workers) { $Workers })' EVO_FILTER='$Filter' EVO_PROBE='$Probe' bash /tmp/evotest-boot-$stamp.sh $Step $commit $stamp 2>&1; rc=`$?; unlink /tmp/evotest-boot-$stamp.sh; exit `$rc"
  $finished = $false
  ssh @ssh $Server $boot | Tee-Object -FilePath "$out\console.log"
  $rc = $LASTEXITCODE
  $finished = $true
  if ($Exclusive) {
    $ex = @(Select-String -Path "$out\console.log" -Pattern "exclusive-(start|end|config)" | ForEach-Object { $_.Line })
    $ex | Set-Content -Encoding utf8 "$out\exclusive.txt"
    Write-Host "evotest: -Exclusive tải lúc đo (ghi ở $out\exclusive.txt):"; $ex | ForEach-Object { Write-Host "  $_" }
  }
  $ErrorActionPreference = "Continue"
  scp @ssh "${Server}:/tmp/evotest-out-$stamp.tgz" "$out\out.tgz"
  if (Test-Path "$out\out.tgz") { tar.exe -xzf "$out\out.tgz" -C $out; ssh @ssh $Server "unlink /tmp/evotest-out-$stamp.tgz" }
  Write-Host ("evotest: bước {0}, exit {1}, {2:N0} s, log đầy đủ: {3}" -f $Step, $rc, ((Get-Date) - $t0).TotalSeconds, $out)
  exit $rc
} finally {
  # Ctrl-C/lỗi khi đang chờ/đo: bảo boot.sh trên máy chủ (owner khoá .exclusive có tag = $stamp) tự dọn (trap TERM nhả khoá + dừng container).
  if ($Exclusive -and -not $finished) {
    try { ssh @ssh -o ConnectTimeout=8 $Server "p=`$(awk -v s=$stamp '`$4==s{print `$1}' ~/workspace/evotest/.exclusive/owner 2>/dev/null); [ -n `$p ] && kill -TERM `$p; exit 0" 2>$null | Out-Null } catch {}
  }
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
