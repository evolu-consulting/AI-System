# Chạy test:all trên máy chủ 149.202.83.5 trong project Docker RIÊNG "evotest" (xem README.md). Cần: ssh key, git, tar, scp.
#   pwsh deploy/evotest/run-tests.ps1 [-Step int|e2e|unit|py|all] [-Ref HEAD] [-Dirty] [-All: gồm cả suite module đóng băng (F1, kiểm tra hằng tháng); mặc định bỏ] [-Filter "tests/a tests/b" (int/perf) | "root,N1" (e2e: việc test:e2e:par)] [-Workers N (int)]; -Step perf = PERF=1, mặc định HD4; -Step py = pytest agent-runtime (Linux, python3.12 + uv sync --frozen; -Filter = đường dẫn/biểu thức pytest tương đối apps/agent-runtime; không nằm trong all) [-DryRun]
# -Exclusive (chỉ -Step perf, CR-115): chờ mọi slot rảnh (tối đa -ExclusiveTimeoutMin phút, mặc định 60; hết giờ => exit 3), giữ khoá toàn máy ~/workspace/evotest/.exclusive trong lúc đo (lượt khác xếp hàng),
#   nhả khoá cả khi lỗi/Ctrl-C; load/RAM lúc bắt đầu + kết thúc in ra và ghi vào <log>\exclusive.txt. Luật khoá: deploy/evotest/lock.sh.
# -Probe "runs=3,size=small" (CR-116, chỉ -Step perf|py): bật PERF_PROBE=1 + PERF_PROBE_OPTS trong container; -Exclusive cũng dùng được với -Step py. Điều khiển bởi `bun run perf:probe` (docs/WORKFLOW.md "Đo perf").
# -Filter + suite đóng băng (tool-test-select): đường dẫn int / tên việc e2e nêu TƯỜNG MINH luôn chạy, không cần -All (đóng băng chỉ lọc khi không có -Filter); 0 file ⇒ lỗi rõ, exit 2.
# tool-evotest-fast: nguồn đi qua MIRROR GIT trên máy chủ (~/workspace/evotest/mirror.git): `git push <sha>:refs/evotest/<stamp>` chỉ gửi phần chênh lệch,
#   remote.sh `git archive` ngay trên máy chủ (loại file nhị phân bằng chứng docs/** theo archive-exclude.txt). -Dirty = commit tạm (cây làm việc, index tạm) đẩy cùng đường;
#   đẩy lỗi / -NoMirror => dự phòng: git archive local (cùng danh sách loại) -> tgz -> scp như cũ. Mặc định IN TÓM TẮT GỌN (<= 15 dòng: bước, thời gian từng pha, pass/fail, CHỈ đỏ MỚI, đường dẫn log);
#   -Full = in cả log máy chủ. Log đầy đủ luôn ở <log>\console.log. -Step perf / -Exclusive / -Probe luôn in đầy đủ (perf-probe đọc console).
# git archive <Ref> (+ thay đổi chưa commit nếu -Dirty) -> scp -> remote.sh (build, chạy, dọn) -> log về .data/evotest/<giờ>/.
# tool-evotest-hang: -QuietMin K (mặc định 8): K phút máy chủ không gửi dòng nào ⇒ in CẢNH BÁO + lệnh xem log slot (không tự dọn). Phía container: test:int:par kill file treo (--hang-idle=120/--hang-file=300 s, INT_HANG_IDLE_S/INT_HANG_FILE_S).
# Thoát bằng mã test (0 xanh; 2 lỗi dựng/setup; 3 chờ slot quá 90 phút; 4 đĩa).
# tool-evotest-cache:
#   LƯỢT TOÀN BỘ (-Step int|e2e|all KHÔNG -Filter): từ chối chạy (exit 5) khi slot khác còn bận, trừ khi -Force; trong lúc nó chạy giữ khoá .exclusive nên lượt khác xếp hàng (lock.sh full_acquire).
#   -NoCache: tắt cache dựng web (/cache/build) + mẫu DB (dbtpl) cho lượt này (đo "trước", nghi cache sai).
#   -CachePrune [-Keep N=5] [-MaxGb G=6]: chỉ dọn cache chung trên máy chủ (giữ N ref dùng gần nhất, trần dung lượng) rồi thoát. Remote.sh cũng tự dọn cuối mỗi lượt.
#   CHIA SLOT (lượt toàn bộ -Step e2e|all): thay vì chạy tuần tự trong MỘT slot, run-tests.ps1 tự chia: int (chỉ -Step all) một slot, việc e2e chia các slot trống còn lại (cân theo thời lượng đã đo
#   ở ~/workspace/evotest/cache/e2e-timings.json), chạy SONG SONG bằng các tiến trình con (-InShard), rồi in MỘT bản tóm tắt gộp (thời lượng từng việc, 10 file int chậm nhất, mã thoát = ngăn xấu nhất; đỏ cũ known-red xử lý trong từng ngăn như trước).
#   -NoShard: chạy một slot như cũ (giữ .exclusive). -Jobs N: số việc e2e cùng lúc trong slot; -Cpus N: CPU runner mỗi slot (mặc định 2; chia slot tự đặt theo lõi máy chủ). -Slots tối đa 12.
param([ValidateSet("int", "e2e", "unit", "all", "perf", "py")][string]$Step = "int", [string]$Ref = "HEAD", [switch]$Dirty, [switch]$DryRun, [string]$Filter = "", [int]$Workers = 0, [switch]$All, [ValidateRange(1,12)][int]$Slots = 8, [ValidateRange(0,9)][int]$Jobs = 0, [ValidateRange(0,8)][int]$Cpus = 0, [switch]$NoShard, [switch]$InShard, [string]$OutDir = "",[ValidateSet("", "cw")][string]$Capture = "", [switch]$Exclusive, [ValidateRange(1,600)][int]$ExclusiveTimeoutMin = 60, [string]$Probe = "", [switch]$Force, [switch]$Wave, [switch]$Full, [switch]$NoMirror, [switch]$NoCache, [switch]$CachePrune, [ValidateRange(1,50)][int]$Keep = 5, [ValidateRange(1,100)][int]$MaxGb = 6, [ValidateRange(1,120)][int]$QuietMin = 8)
$ErrorActionPreference = "Stop"
$isFull = (($Step -in "int", "e2e", "all") -and -not $Filter -and -not $Exclusive -and -not $InShard)
if ($Force -and -not $isFull) { Write-Host "evotest: -Force chỉ có nghĩa với lượt toàn bộ (int|e2e|all không -Filter); bỏ qua" }
if ($Exclusive -and $Step -ne "perf" -and $Step -ne "py") { throw "-Exclusive chỉ dùng với -Step perf|py (đo hiệu năng cần máy yên)" }
if ($Probe -and $Step -ne "perf" -and $Step -ne "py") { throw "-Probe chỉ dùng với -Step perf|py" }
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Key = "F:\workspace\id_evoc_key"; $Server = "evoc@149.202.83.5"
$ssh = @("-i", $Key, "-o", "BatchMode=yes")
$commit = (git -C $Repo rev-parse --short $Ref).Trim() + $(if ($Dirty) { "+dirty" } else { "" })
$stamp = (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + $PID   # PID: các lượt cùng giây không đè thư mục tạm/file /tmp/log của nhau
$out = if ($OutDir) { $OutDir } else { Join-Path $Repo ".data\evotest\$stamp-$Step" }
$tmp = Join-Path $env:TEMP "evotest-$stamp"
$finished = $false
$sw = [Diagnostics.Stopwatch]::StartNew(); $ph = [ordered]@{}; $lastMark = 0.0
function Mark([string]$n) { $now = $sw.Elapsed.TotalSeconds; $ph[$n] = [math]::Round($now - $script:lastMark, 1); $script:lastMark = $now }

if ($CachePrune) {
  $cs = (Get-Content -Raw "$PSScriptRoot\cache.sh").Replace("`r`n", "`n"); $ct = Join-Path $env:TEMP "evotest-cache-$stamp.sh"
  [IO.File]::WriteAllText($ct, $cs, (New-Object Text.UTF8Encoding $false))
  try {
    scp @ssh $ct "${Server}:/tmp/evotest-cache-$stamp.sh"
    ssh @ssh $Server "R=`$HOME/workspace/evotest; C=`$R/cache; . /tmp/evotest-cache-$stamp.sh; cache_prune $Keep $MaxGb; unlink /tmp/evotest-cache-$stamp.sh" 2>&1
  } finally { Remove-Item -Force $ct -ErrorAction SilentlyContinue }
  return
}
# CHỐT PHẠM VI (tool-evotest-scope-guard, luật 5d/D4): worktree lát (evolu-wt\ hoặc nhánh slice/*) không được chạy rộng
# (không -Filter, > 30 file int, > 3 job e2e, > 60 spec) ⇒ dừng TRƯỚC khi upload, exit 6. Lối thoát cho điều phối: -Wave hoặc EVOTEST_WAVE=1
# (verify:wave tự truyền -Wave). Checkout chính không bị chặn. Ngăn con -InShard đã được lượt cha kiểm nên bỏ qua.
if ($Step -in "int", "e2e", "all" -and -not $InShard -and $Ref -eq "HEAD") {
  $sg = @("tools/scripts/src/evotest-scope.ts", "--step", $Step, "--repo", $Repo)
  if ($Filter) { $sg += @("--filter", $Filter) }   # chuỗi rỗng bị PS 5.1 bỏ khi truyền cho exe nên chỉ thêm khi có
  if ($All) { $sg += "--all" }; if ($Wave -or $env:EVOTEST_WAVE -eq "1") { $sg += "--wave" }
  Push-Location $Repo
  try { & bun @sg; $sgRc = $LASTEXITCODE } finally { Pop-Location }
  if ($sgRc -ne 0) { exit $sgRc }
}
if ($DryRun) {
  Write-Host "commit $commit, bước $Step -> $Server ~/workspace/evotest/slots/sN (N = slot trống đầu tiên trong $Slots); log: $out; luot toan bo: $isFull (-Force: $Force)"
  Write-Host "ssh: bash ~/workspace/evotest/boot.sh -> remote.sh $Step $commit (sau khi scp evotest-app.tgz + evotest-kit.tgz vào /tmp)"
  return
}
# Kiểm filter int NGAY tại máy (≈1 s, không tốn lượt upload): đường dẫn nêu tường minh luôn được chạy kể cả suite đóng băng (không cần -All);
# filter không khớp file nào ⇒ dừng với "Filter không khớp file nào: …" thay vì chạy 0 file im lặng trên máy chủ. Chỉ khi -Ref HEAD (cây local = thứ sẽ chạy).
if ($Step -eq "int" -and $Filter -and -not $InShard -and $Ref -eq "HEAD") {
  $chk = @("tools/scripts/src/test-int-par.ts", "--check-only") + @($Filter -split '\s+' | Where-Object { $_ })
  if (-not $All) { $chk += "--no-frozen" }
  Push-Location $Repo
  try { & bun @chk; $chkRc = $LASTEXITCODE } finally { Pop-Location }
  if ($chkRc -ne 0) { Write-Host "evotest: dừng trước khi upload - sửa -Filter (đường dẫn dùng /, tương đối gốc repo)"; exit 2 }
}
# Tải máy chủ + slot trước khi dựng (chỉ in, không chặn; boot.sh vẫn tự xếp hàng). Chi tiết: bun run res:check --server
$ErrorActionPreference = "Continue"
try {
  # tool-evotest-fast: cùng lượt ssh này tạo mirror git rỗng nếu chưa có (đẩy nguồn ở bước sau, không thêm vòng ssh)
  $loadProbe ='M=$HOME/workspace/evotest/mirror.git; [ -d $M ] || { mkdir -p $HOME/workspace/evotest && git init -q --bare $M; }; git --git-dir=$M config receive.shallowUpdate true; cat /proc/loadavg; nproc; grep MemAvailable /proc/meminfo; df -Pk $HOME | tail -1; for i in $(seq 1 ' + $Slots + '); do if [ $i = 1 ]; then l=$HOME/workspace/evotest/.lock; else l=$HOME/workspace/evotest/slots/s$i/.lock; fi; if [ -d $l ]; then echo busy$i; else echo free$i; fi; done'
  $p = @(ssh @ssh -o ConnectTimeout=8 $Server $loadProbe 2>$null)
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

# --- tool-evotest-cache: CHIA SLOT cho luot toan bo (-Step e2e|all khong -Filter) -------------------------------------------------
# Cac tien trinh con la chinh script nay voi -InShard (khong con la "luot toan bo" nen khong tu choi/giu .exclusive) va -OutDir rieng.
$freeSlots = if ($cores) { $Slots - @($busy | Where-Object { [int]$_.Substring(1) -le $Slots }).Count } else { 0 }
$shard = ($isFull -and ($Step -eq "e2e" -or $Step -eq "all") -and -not $NoShard -and $cores -and $freeSlots -ge 2)
if ($isFull -and ($Step -eq "e2e" -or $Step -eq "all") -and -not $shard -and -not $NoShard) { Write-Host "evotest: khong chia duoc slot (can >= 2 slot trong va doc duoc tai may chu) - chay trong 1 slot" }
if ($isFull -and $Step -eq "int" -and $cores -and -not $Workers) {
  # int day du trong 1 slot: workers = lõi (<= 8 lõi/slot), tránh mặc định 6 worker / 2 CPU
  $Cpus = [math]::Min(8, [math]::Max(2, [int]$cores - 2)); $Workers = $Cpus
}
if ($shard) {
  New-Item -ItemType Directory -Force $out | Out-Null
  $tj = Join-Path $env:TEMP "evotest-timings-$stamp.json"; $lj = Join-Path $env:TEMP "evotest-jobs-$stamp.json"
  Push-Location $Repo
  try {
    @(ssh @ssh $Server 'cat ~/workspace/evotest/cache/e2e-timings.json 2>/dev/null' 2>$null) | Set-Content -Encoding ascii $tj
    # KHONG gan mang 1 phan tu tu bieu thuc if roi splat: PS 5.1 mo thanh string, splat ra TUNG KY TU ("-","-","n"...) => co --no-frozen bi mat, job dong bang lot vao ngan
    $listArgs = @("tools/scripts/src/test-e2e-par.ts", "--list", "--timings=$tj")
    if (-not $All) { $listArgs += "--no-frozen" }
    @(bun @listArgs) | Set-Content -Encoding ascii $lj
    $plan = (@(bun tools/scripts/src/evotest-shard.ts plan --jobs $lj --free $freeSlots --cores $cores --step $Step) -join "") | ConvertFrom-Json
  } finally { Pop-Location; Remove-Item -Force $tj, $lj -ErrorAction SilentlyContinue }
  Write-Host ("evotest: CHIA SLOT - {0} slot trong: int {1} (cpus {2}, workers {3}) + e2e {4} ngan (moi ngan {5} cpus, {6} viec cung luc), du kien ngan e2e cham nhat ~{7} s; tong dong thoi {8}/{9} (= loi x 1.3), viec du xep hang trong ngan" -f $freeSlots, $plan.intShard, $plan.intCpus, $plan.intWorkers, $plan.e2eShards, $plan.e2eCpus, $plan.e2eJobs, $plan.estimateS, $plan.total, $plan.budget)
  $script = $MyInvocation.MyCommand.Path
  $kids = New-Object System.Collections.ArrayList
  function Start-Kid([string]$label, [string[]]$extra) {
    $d = Join-Path $out $label
    $a = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script, "-Ref", $Ref, "-Slots", "$Slots", "-InShard", "-OutDir", $d) + $extra
    if ($Dirty) { $a += "-Dirty" }; if ($All) { $a += "-All" }; if ($NoCache) { $a += "-NoCache" }
    $q = $a | ForEach-Object { '"' + $_ + '"' }
    $p = Start-Process powershell -ArgumentList $q -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $out "$label.stdout.log") -RedirectStandardError (Join-Path $out "$label.stderr.log")
    $null = $p.Handle
    [void]$kids.Add([pscustomobject]@{ Label = $label; Proc = $p; Dir = $d; T0 = Get-Date; Secs = 0 })
  }
  $t0 = Get-Date
  if ($plan.intShard) { Start-Kid "int" @("-Step", "int", "-Workers", "$($plan.intWorkers)", "-Cpus", "$($plan.intCpus)") }
  $i = 0
  foreach ($s in @($plan.shards)) { $i++; Start-Kid "e2e-$i" @("-Step", "e2e", "-Filter", $s.jobs, "-Jobs", "$($plan.e2eJobs)", "-Cpus", "$($plan.e2eCpus)") }
  Write-Host ("evotest: da mo {0} ngan song song; log tung ngan: {1}\<ngan>\console.log" -f $kids.Count, $out)
  $left = @($kids)
  while ($left.Count) {
    Start-Sleep -Seconds 15
    foreach ($k in @($left)) {
      if ($k.Proc.HasExited) { $k.Secs = [int]((Get-Date) - $k.T0).TotalSeconds; Write-Host ("evotest: ngan {0} xong, exit {1}, {2} s" -f $k.Label, $k.Proc.ExitCode, $k.Secs); $left = @($left | Where-Object { $_.Label -ne $k.Label }) }
    }
  }
  $wall = [int]((Get-Date) - $t0).TotalSeconds
  $worst = 0
  $sum = New-Object System.Collections.ArrayList
  [void]$sum.Add("evotest: TONG HOP chia slot - $($kids.Count) ngan, $wall s tong, tu choi/loi = ngan co exit != 0 (do cu known-red da duoc loai trong tung ngan)")
  foreach ($k in $kids) {
    $ex = [int]$k.Proc.ExitCode; if ($ex -gt $worst) { $worst = $ex }
    [void]$sum.Add(("  {0} {1}: exit {2}, {3} s" -f $(if ($ex -eq 0) { "OK  " } else { "LOI " }), $k.Label, $ex, $k.Secs))
    $cl = Join-Path $k.Dir "console.log"
    if (Test-Path $cl) {
      $lines = @(Get-Content $cl)
      foreach ($l in $lines) { if ($l -match 'test:(int|e2e):par:|build-cache:|^\s+\S \S+: \d+ pass') { [void]$sum.Add("      $l") } }
      for ($n = 0; $n -lt $lines.Count; $n++) { if ($lines[$n] -match 'ch.m nh.t:\s*$') { $hi = [math]::Min($n + 10, $lines.Count - 1); $lines[$n..$hi] | ForEach-Object { [void]$sum.Add("      $_") } } }
      if ($ex -ne 0) { [void]$sum.Add("      --- 25 dong cuoi (ngan loi) ---"); $lines | Select-Object -Last 25 | ForEach-Object { [void]$sum.Add("      $_") } }
    }
  }
  $sum | Set-Content -Encoding utf8 (Join-Path $out "summary.txt")
  if ($Full) { $sum | ForEach-Object { Write-Host $_ } }
  else {
    Push-Location $Repo
    try { bun tools/scripts/src/evotest-summary.ts --step $Step --commit $commit --exit $worst --wall $wall --out $out; Write-Host "  (tom tat day du cac ngan: $out\summary.txt)" } finally { Pop-Location }
  }
  exit $worst
}

$Full = $Full -or $Step -eq "perf" -or [bool]$Exclusive -or [bool]$Probe   # perf-probe doc console => luon day du
# Pathspec loai file nhi phan bang chung docs/** (khong test nao doc) - cung danh sach voi remote.sh (archive-exclude.txt)
$excl = @(Get-Content "$PSScriptRoot\archive-exclude.txt" | Where-Object { $_.Trim() })
# -Dirty: commit tam tu cay lam viec (index tam sao tu index that; .gitignore duoc ton trong, file xoa/moi/staged deu vao) - khong dung vao index/nhanh that
function New-DirtyCommit {
  $old = @{ I = $env:GIT_INDEX_FILE; N = $env:GIT_AUTHOR_NAME; E = $env:GIT_AUTHOR_EMAIL; CN = $env:GIT_COMMITTER_NAME; CE = $env:GIT_COMMITTER_EMAIL }
  $ea = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try {
    $idx = (git -C $Repo rev-parse --git-path index).Trim(); if (-not [IO.Path]::IsPathRooted($idx)) { $idx = Join-Path $Repo $idx }
    $ti = Join-Path $tmp "dirty.index"; $env:GIT_INDEX_FILE = $ti
    $head = (git -C $Repo rev-parse $Ref).Trim(); $cur = (git -C $Repo rev-parse HEAD).Trim()
    if ($head -eq $cur -and (Test-Path $idx)) { Copy-Item $idx $ti -Force } else { git -C $Repo read-tree $Ref 2>$null | Out-Null }
    git -C $Repo add -A 2>$null | Out-Null
    $tree = (git -C $Repo write-tree).Trim()
    $env:GIT_AUTHOR_NAME = "evotest"; $env:GIT_AUTHOR_EMAIL = "evotest@localhost"; $env:GIT_COMMITTER_NAME = "evotest"; $env:GIT_COMMITTER_EMAIL = "evotest@localhost"
    $c = (git -C $Repo commit-tree $tree -p $head -m "evotest dirty $stamp").Trim()
    if (-not $c) { throw "commit-tree loi" }
    return $c
  } finally {
    $ErrorActionPreference = $ea
    foreach ($kv in @(@("GIT_INDEX_FILE", "I"), @("GIT_AUTHOR_NAME", "N"), @("GIT_AUTHOR_EMAIL", "E"), @("GIT_COMMITTER_NAME", "CN"), @("GIT_COMMITTER_EMAIL", "CE"))) { [Environment]::SetEnvironmentVariable($kv[0], $old[$kv[1]]) }
  }
}

New-Item -ItemType Directory -Force $tmp, $out | Out-Null
$rc = 1
try {
  Mark "probe"
  $srcSha = if ($Dirty) { New-DirtyCommit } else { (git -C $Repo rev-parse $Ref).Trim() }
  # --- NGUON: day delta vao mirror git tren may chu; loi => du phong tgz ---
  $srcRef = ""
  if (-not $NoMirror) {
    $ea = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $oldGs = $env:GIT_SSH_COMMAND; $env:GIT_SSH_COMMAND = "ssh -i F:/workspace/id_evoc_key -o BatchMode=yes"
    try {
      $tryRef = "refs/evotest/$stamp"
      $null = git -C $Repo push -q "${Server}:workspace/evotest/mirror.git" "${srcSha}:$tryRef" 2>&1
      if ($LASTEXITCODE -eq 0) { $srcRef = $tryRef } else { Write-Host "evotest: day mirror loi (exit $LASTEXITCODE) - du phong tgz" }
    } catch { Write-Host "evotest: day mirror loi ($($_.Exception.Message)) - du phong tgz" }
    finally { $env:GIT_SSH_COMMAND = $oldGs; $ErrorActionPreference = $ea }
  }
  Mark "push"
  # Bo dung/chay lay tu thu muc nay (khong phu thuoc Ref co chua deploy/evotest hay khong); ep LF cho .sh. MOT tgz kit (gom ca boot.sh, lock.sh) = MOT lan scp.
  foreach ($f in "remote.sh", "in-container.sh", "boot.sh", "lock.sh", "cache.sh") {
    $t = [IO.File]::ReadAllText("$PSScriptRoot\$f").Replace("`r`n", "`n"); [IO.File]::WriteAllText("$tmp\$f", $t, (New-Object Text.UTF8Encoding $false))
  }
  Copy-Item "$PSScriptRoot\docker-compose.yml", "$PSScriptRoot\docker-compose.exclusive.yml", "$PSScriptRoot\Dockerfile", "$PSScriptRoot\archive-exclude.txt" $tmp; Copy-Item -Recurse "$PSScriptRoot\pg-init" $tmp
  tar.exe -czf "$tmp\evotest-kit-$stamp.tgz" -C $tmp docker-compose.yml docker-compose.exclusive.yml Dockerfile remote.sh in-container.sh cache.sh boot.sh lock.sh archive-exclude.txt pg-init
  $up = @("$tmp\evotest-kit-$stamp.tgz")
  if (-not $srcRef) {
    # du phong: archive local (cung danh sach loai) - -Dirty dung commit tam nen khong can chong file
    git -C $Repo archive --format=tar.gz -o "$tmp\evotest-app-$stamp.tgz" $srcSha -- . @excl
    $up += "$tmp\evotest-app-$stamp.tgz"
  }
  Mark "prep"
  scp -q @ssh @up "${Server}:/tmp/"
  Mark "upload"
  $t0 = Get-Date
  # Slot song song (mac dinh 8, doi bang -Slots): boot.sh chon slot trong dau tien (mkdir .lock nguyen tu, go lock mo coi), chi cho khi moi slot ban.
  # boot.sh + lock.sh nam trong kit: MOT lenh ssh giai ra /tmp roi chay (tranh loi PS 5.1 bo dau nhay kep khi truyen doi so ssh); 2>&1 phia may chu de PS 5.1 khong coi stderr la loi.
  $K = "/tmp/evotest-kit-$stamp.tgz"
  $boot = "tar xzf $K -O boot.sh > /tmp/evotest-boot-$stamp.sh; tar xzf $K -O lock.sh > /tmp/evotest-lock-$stamp.sh; EVO_SRC_REF='$srcRef' EVO_LOCKLIB=/tmp/evotest-lock-$stamp.sh EVO_EXCLUSIVE='$(if ($Exclusive) { 1 })' EVO_FULL_RUN='$(if ($isFull) { 1 })' EVO_FORCE='$(if ($Force) { 1 })' EVO_NOCACHE='$(if ($NoCache) { 1 })' EVO_JOBS='$(if ($Jobs) { $Jobs })' EVO_RUNNER_CPUS='$(if ($Cpus) { $Cpus })' EVO_RUNNER_MEM='$(if ($Cpus) { [math]::Max(6, 2 * $Cpus).ToString() + 'g' })' EVO_PG_CPUS='$(if ($Cpus -ge 4) { 2 })' EVO_EXCLUSIVE_TIMEOUT_S=$($ExclusiveTimeoutMin * 60) EVO_SLOTS=$Slots EVO_CAPTURE='$Capture' EVO_ALL='$(if ($All) { 1 })' EVO_WORKERS='$(if ($Workers) { $Workers })' EVO_FILTER='$Filter' EVO_PROBE='$Probe' bash /tmp/evotest-boot-$stamp.sh $Step $commit $stamp 2>&1; rc=`$?; unlink /tmp/evotest-boot-$stamp.sh; exit `$rc"
  $finished = $false
  # tool-evotest-hang: cảnh báo khi máy chủ im >= -QuietMin phút (timer .NET riêng, vì vòng ssh chặn luồng chính). Chỉ cảnh báo + in lệnh xem log; KHÔNG tự dọn slot (của người khác).
  if (-not ('EvoQuiet' -as [type])) {
    Add-Type -TypeDefinition @'
public class EvoQuiet : System.IDisposable {
  System.Threading.Timer t; long last; long warned; readonly long sec; public volatile string Slot = "?"; readonly string key, srv;
  public EvoQuiet(int minutes, string key, string srv) { sec = minutes * 60L; this.key = key; this.srv = srv; last = Now(); t = new System.Threading.Timer(Tick, null, 15000, 15000); }
  static long Now() { return System.Diagnostics.Stopwatch.GetTimestamp() / System.Diagnostics.Stopwatch.Frequency; }
  public void Touch() { last = Now(); warned = 0; }
  void Tick(object s) {
    long n = Now();
    if (n - last < sec || (warned != 0 && n - warned < sec)) return;
    warned = n;
    string sl = Slot, ssh = "ssh -i " + key + " " + srv + " ";
    System.Console.WriteLine("evotest: CANH BAO - " + ((n - last) / 60) + " phut khong co dong moi tu may chu (slot " + sl + "). Co the test int bi treo (bun quay 100% CPU). Xem: "
      + ssh + "\"tail -n 30 ~/workspace/evotest/slots/s" + sl + "/app/.data/int-s*.log; docker stats --no-stream\"  (khong tu don slot; neu chac chan la slot cua minh: docker compose -p evotest-s" + sl + " down)");
  }
  public void Dispose() { t.Dispose(); }
}
'@
  }
  $quiet = New-Object EvoQuiet($QuietMin, $Key, $Server)
  try {
    ssh @ssh $Server $boot | ForEach-Object { $quiet.Touch(); if ($_ -match '^\[evotest\] slot (\d+)/') { $quiet.Slot = $Matches[1] }; if ($Full) { Write-Host $_ }; $_ } | Out-File -Encoding utf8 -FilePath "$out\console.log"
  } finally { $quiet.Dispose() }
  $rc = $LASTEXITCODE
  $finished = $true
  Mark "server"
  if ($Exclusive) {
    $ex = @(Select-String -Path "$out\console.log" -Pattern "exclusive-(start|end|config)" | ForEach-Object { $_.Line })
    $ex | Set-Content -Encoding utf8 "$out\exclusive.txt"
    Write-Host "evotest: -Exclusive tai luc do (ghi o $out\exclusive.txt):"; $ex | ForEach-Object { Write-Host "  $_" }
  }
  $ErrorActionPreference = "Continue"
  scp -q @ssh "${Server}:/tmp/evotest-out-$stamp.tgz" "$out\out.tgz"   # remote.sh don out.tgz cu >3h (khong con ssh unlink rieng)
  if (Test-Path "$out\out.tgz") { tar.exe -xzf "$out\out.tgz" -C $out }
  Mark "fetch"
  $wall = [int]$sw.Elapsed.TotalSeconds
  $phs = ($ph.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value.ToString([Globalization.CultureInfo]::InvariantCulture) }) -join ","
  Push-Location $Repo
  try { bun tools/scripts/src/evotest-summary.ts --step $Step --commit $commit --exit $rc --wall $wall --phases $phs --out $out }
  catch { Write-Host ("evotest: buoc {0}, exit {1}, {2} s, log: {3}" -f $Step, $rc, $wall, $out) }
  finally { Pop-Location }
  exit $rc
} finally {
  # Ctrl-C/lỗi khi đang chờ/đo: bảo boot.sh trên máy chủ (owner khoá .exclusive có tag = $stamp) tự dọn (trap TERM nhả khoá + dừng container).
  if ($Exclusive -and -not $finished) {
    try { ssh @ssh -o ConnectTimeout=8 $Server "p=`$(awk -v s=$stamp '`$4==s{print `$1}' ~/workspace/evotest/.exclusive/owner 2>/dev/null); [ -n `$p ] && kill -TERM `$p; exit 0" 2>$null | Out-Null } catch {}
  }
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}