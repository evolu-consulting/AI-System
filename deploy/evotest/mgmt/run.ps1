# I1 · chạy importer mgmt-import trên bản sao mgmt-app CÓ SEED (project Docker riêng `evotest-mgmt` trên evotest). KHÔNG đụng
# sohoptac-* (dữ liệu thật). Giữ khoá ~/workspace/evotest/.lock (xếp hàng với run-tests.ps1, không chồng ngân sách CPU/RAM).
#   powershell -File deploy/evotest/mgmt/run.ps1 [-Ref HEAD] [-MgmtRepo F:\workspace\mgmt-app]
# Gửi: git archive <Ref> của repo này + git archive HEAD:api của mgmt-app (Dockerfile + mã, không .venv/data). Kết quả: .data/evotest-mgmt/<giờ>/.
#   -Tenant nitigroup: onboarding deploy/tenants/nitigroup.yaml (gắn org seed) rồi importer `--into-tenant` (niti-onboard).
param([string]$Ref = "HEAD", [string]$MgmtRepo = "F:\workspace\mgmt-app", [string]$Tenant = "")
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$Key = "F:\workspace\id_evoc_key"; $Server = "evoc@149.202.83.5"
$ssh = @("-i", $Key, "-o", "BatchMode=yes")
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$mcommit = (git -C $MgmtRepo rev-parse --short HEAD).Trim()
$out = Join-Path $Repo ".data\evotest-mgmt\$stamp"
$tmp = Join-Path $env:TEMP "evotest-mgmt-$stamp"
New-Item -ItemType Directory -Force $tmp, $out | Out-Null
try {
  git -C $Repo archive --format=tar.gz -o "$tmp\evotest-mgmt-app-$stamp.tgz" $Ref
  git -C $MgmtRepo archive --format=tar.gz -o "$tmp\evotest-mgmt-api-$stamp.tgz" "HEAD:api"
  $t = [IO.File]::ReadAllText("$PSScriptRoot\remote.sh").Replace("`r`n", "`n")
  [IO.File]::WriteAllText("$tmp\remote-mgmt-$stamp.sh", $t, (New-Object Text.UTF8Encoding $false))
  scp @ssh "$tmp\evotest-mgmt-app-$stamp.tgz" "$tmp\evotest-mgmt-api-$stamp.tgz" "$tmp\remote-mgmt-$stamp.sh" "${Server}:/tmp/"
  $t0 = Get-Date
  $boot = "cd ~/workspace/evotest && { n=0; until mkdir .lock 2>/dev/null; do [ `$n -eq 0 ] && echo 'evotest đang bận, xếp hàng...'; n=1; sleep 5; done; trap 'rmdir .lock' EXIT; bash /tmp/remote-mgmt-$stamp.sh $stamp $mcommit $Tenant; r=`$?; unlink /tmp/remote-mgmt-$stamp.sh; exit `$r; } 2>&1"
  ssh @ssh $Server $boot | Tee-Object -FilePath "$out\console.log"
  $rc = $LASTEXITCODE
  $ErrorActionPreference = "Continue"
  scp @ssh "${Server}:/tmp/evotest-mgmt-out-$stamp.tgz" "$out\out.tgz"
  if (Test-Path "$out\out.tgz") { tar.exe -xzf "$out\out.tgz" -C $out; ssh @ssh $Server "unlink /tmp/evotest-mgmt-out-$stamp.tgz" }
  Write-Host ("evotest-mgmt: exit {0}, {1:N0} s, kết quả: {2}" -f $rc, ((Get-Date) - $t0).TotalSeconds, $out)
  exit $rc
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
