# Chạy test:all trên máy chủ 149.202.83.5 trong project Docker RIÊNG "evotest" (xem README.md). Cần: ssh key, git, tar, scp.
#   pwsh deploy/evotest/run-tests.ps1 [-Step int|e2e|unit|all] [-Ref HEAD] [-Dirty] [-Filter "tests/a tests/b" (chỉ int)] [-DryRun]
# git archive <Ref> (+ thay đổi chưa commit nếu -Dirty) -> scp -> remote.sh (build, chạy, dọn) -> log về .data/evotest/<giờ>/.
# Thoát bằng mã test (0 xanh; 2 lỗi dựng/setup; 3 đang có lượt khác; 4 đĩa).
param([ValidateSet("int", "e2e", "unit", "all")][string]$Step = "int", [string]$Ref = "HEAD", [switch]$Dirty, [switch]$DryRun, [string]$Filter = "")
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Key = "F:\workspace\id_evoc_key"; $Server = "evoc@149.202.83.5"
$ssh = @("-i", $Key, "-o", "BatchMode=yes")
$commit = (git -C $Repo rev-parse --short $Ref).Trim() + $(if ($Dirty) { "+dirty" } else { "" })
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $Repo ".data\evotest\$stamp-$Step"
$tmp = Join-Path $env:TEMP "evotest-$stamp"

if ($DryRun) {
  Write-Host "commit $commit, bước $Step -> $Server ~/workspace/evotest; log: $out"
  Write-Host "ssh: bash ~/workspace/evotest/remote.sh $Step $commit (sau khi scp evotest-app.tgz + evotest-kit.tgz vào /tmp)"
  return
}
New-Item -ItemType Directory -Force $tmp, $out | Out-Null
try {
  git -C $Repo archive --format=tar.gz -o "$tmp\evotest-app.tgz" $Ref
  if ($Dirty) {
    # chồng thay đổi chưa commit (đã sửa + chưa theo dõi, trừ file bị ignore) lên bản archive; file đã xoá thì xoá khỏi bản sao
    $src = "$tmp\src"; New-Item -ItemType Directory $src | Out-Null
    tar.exe -xzf "$tmp\evotest-app.tgz" -C $src
    $changed = git -C $Repo -c core.quotepath=off ls-files -m -o --exclude-standard
    foreach ($f in $changed) {
      $p = Join-Path $Repo $f
      if (Test-Path -LiteralPath $p) { $t = Join-Path $src $f; New-Item -ItemType Directory -Force (Split-Path $t) | Out-Null; Copy-Item -LiteralPath $p $t -Force }
      else { Remove-Item -LiteralPath (Join-Path $src $f) -Force -ErrorAction SilentlyContinue }
    }
    tar.exe -czf "$tmp\evotest-app.tgz" -C $src .
  }
  # Bộ dựng/chạy lấy từ thư mục này (không phụ thuộc Ref có chứa deploy/evotest hay không); ép LF cho .sh
  foreach ($f in "remote.sh", "in-container.sh") {
    $t = [IO.File]::ReadAllText("$PSScriptRoot\$f").Replace("`r`n", "`n"); [IO.File]::WriteAllText("$tmp\$f", $t, (New-Object Text.UTF8Encoding $false))
  }
  Copy-Item "$PSScriptRoot\docker-compose.yml", "$PSScriptRoot\Dockerfile" $tmp; Copy-Item -Recurse "$PSScriptRoot\pg-init" $tmp
  tar.exe -czf "$tmp\evotest-kit.tgz" -C $tmp docker-compose.yml Dockerfile remote.sh in-container.sh pg-init
  ssh @ssh $Server "mkdir -p ~/workspace/evotest"
  scp @ssh "$tmp\evotest-app.tgz" "$tmp\evotest-kit.tgz" "${Server}:/tmp/"
  $t0 = Get-Date
  # remote.sh nằm trong kit: giải kit (trừ khi đang có lượt khác) rồi chạy; 2>&1 phía máy chủ để PS 5.1 không coi stderr là lỗi
  $boot = "cd ~/workspace/evotest && { [ -d .lock ] && echo 'evotest đang chạy (.lock)' && exit 3; tar xzf /tmp/evotest-kit.tgz && EVO_FILTER='$Filter' bash remote.sh $Step $commit; } 2>&1"
  ssh @ssh $Server $boot | Tee-Object -FilePath "$out\console.log"
  $rc = $LASTEXITCODE
  $ErrorActionPreference = "Continue"
  scp @ssh "${Server}:/tmp/evotest-out.tgz" "$out\out.tgz"
  if (Test-Path "$out\out.tgz") { tar.exe -xzf "$out\out.tgz" -C $out; ssh @ssh $Server "unlink /tmp/evotest-out.tgz" }
  Write-Host ("evotest: bước {0}, exit {1}, {2:N0} s, log đầy đủ: {3}" -f $Step, $rc, ((Get-Date) - $t0).TotalSeconds, $out)
  exit $rc
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
