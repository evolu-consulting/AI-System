# Deploy AI System + gói contracts lên 149.202.83.5 thành project Docker RIÊNG "sohoptac2" (~/workspace/sohoptac2). Xem README.md.
#   powershell -File deploy/prod-sohoptac2/deploy.ps1 [-Ref platform/gd0] [-DryRun] [-Domain evoluconsulting.com|none] [-Force]
# -Domain: che do ten mien (URL https, CORS gom ca tunnel) - gen-env.sh nhan S2_DOMAIN; none = ve tunnel. Bat routing edge: enable-domain.sh (README).
# git archive <Ref> + bộ kit này -> scp -> giải nén vào build/app -> gen-env.sh (bí mật một lần, trên máy chủ) -> docker compose build
# -> setup.sh (migrate, seed, chạy, /health). Không đụng project khác; không đổi routing/TLS của host; dữ liệu (volume pgdata,
# data/, claude-home/, .env, ADMIN_CREDENTIALS.txt) giữ nguyên giữa các lần deploy.
# -Hosts prod|test: bo hostname cong khai (prod = sohoptac./ai-admin./ai./ai-hub. (+ community.); test = ...-test); CORS luon gom ca hai bo + tunnel. Can -Domain (hoac da co trong .env).
# fix-migrate-guard (su co 2026-10-30): moi lenh native (git/tar/ssh/scp) loi => throw (PS 5.1 khong tu throw theo exit code);
# build loi => dung; VERSION tren may chu chi ghi SAU KHI setup.sh xong; tu choi deploy khi commit trong VERSION khong phai to tien
# cua -Ref (vd prod dang chay nhanh khac) tru khi -Force (in canh bao).
param([string]$Ref = "platform/gd0", [switch]$DryRun, [string]$Domain = "", [ValidateSet("", "prod", "test")][string]$Hosts = "", [switch]$Force)
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Key = "F:\workspace\id_evoc_key"; $Server = "evoc@149.202.83.5"; $Dir = "~/workspace/sohoptac2"
$ssh = @("-i", $Key, "-o", "BatchMode=yes")

# Goi ngay sau moi lenh native: exit code khac 0 => throw (PS 5.1 khong tu throw theo exit code).
function Assert-Exit([string]$What) { if ($LASTEXITCODE -ne 0) { throw "deploy: $What loi (exit $LASTEXITCODE)" } }

$commit = git -C $Repo rev-parse --short $Ref; Assert-Exit "git rev-parse $Ref"
$commit = "$commit".Trim()
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tmp = Join-Path $env:TEMP "sohoptac2-$stamp"
if ($Domain -and $Domain -ne "none" -and $Domain -notmatch '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$') { throw "-Domain khong hop le: $Domain" }
$envDomain = $(if ($Domain) { "S2_DOMAIN=$Domain " } else { "" }) + $(if ($Hosts) { "S2_HOSTS=$Hosts " } else { "" })
$kit = @("docker-compose.yml", "Dockerfile", "nginx.conf", "gen-env.sh", "filebox-env.sh", "setup.sh", "backup.sh", "ops-host-status.sh", "restore-test.sh", "smoke-ai.ts", "env.template", "README.md", "enable-domain.sh", "disable-domain.sh", "cutover.sh", "rollback-cutover.sh", "edge-lib.sh", "edge/sohoptac2.conf")

# Ban dang chay (dong dau VERSION, "<commit> (<ref>)") phai la to tien cua $Ref: deploy nhanh khac len prod roi deploy $Ref se mat
# tinh nang/migration cua nhanh kia (su co 0064_agent_hooks). Han che: VERSION do ban deploy.ps1 cu ghi TRUOC khi build/migrate,
# nen sau mot lan deploy hong no co the noi sai (vd 2026-10-30 ghi 3f5e6b8c du container van chay ban cu).
function Assert-PrevIsAncestor {
  $prev = @(ssh @ssh $Server "head -n 1 $Dir/VERSION 2>/dev/null || true"); Assert-Exit "ssh doc VERSION"; $prev = "$($prev[0])".Trim()
  $prevCommit = if ($prev) { ($prev -split '\s+')[0] } else { "" }
  if (-not $prevCommit) { Write-Host "deploy: chua co VERSION tren may chu (lan dau) - bo qua kiem to tien"; return }
  $ErrorActionPreference = "Continue"
  git -C $Repo merge-base --is-ancestor $prevCommit $Ref 2>$null
  $rc = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($rc -eq 0) { Write-Host "deploy: ban dang chay $prevCommit la to tien cua $Ref ($commit) - OK"; return }
  $why = if ($rc -eq 1) { "khong phai to tien cua $Ref" } else { "khong co trong repo nay (nhanh khac/may khac?)" }
  if ($Force) { Write-Warning "deploy: ban dang chay $prevCommit $why - -Force: VAN deploy, tinh nang/migration chi co o $prevCommit se mat"; return }
  throw "deploy: ban dang chay tren may chu ($prev) $why. Gop nhanh do vao $Ref truoc, hoac chay lai voi -Force neu chap nhan mat no."
}

if ($DryRun) { Write-Host "commit $commit ($Ref) -> ${Server}:$Dir"; return }
Assert-PrevIsAncestor
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  git -C $Repo archive --format=tar.gz -o "$tmp\s2-app-$stamp.tgz" $Ref; Assert-Exit "git archive"
  # Kit lấy từ thư mục này; ép LF (chạy trên Linux)
  foreach ($f in $kit) {
    New-Item -ItemType Directory -Force (Split-Path "$tmp\$f") | Out-Null
    $t = [IO.File]::ReadAllText("$PSScriptRoot\$f").Replace("`r`n", "`n"); [IO.File]::WriteAllText("$tmp\$f", $t, (New-Object Text.UTF8Encoding $false))
  }
  tar.exe -czf "$tmp\s2-kit-$stamp.tgz" -C $tmp @kit; Assert-Exit "tar kit"
  ssh @ssh $Server "mkdir -p $Dir && chmod 700 $Dir"; Assert-Exit "ssh mkdir"
  scp @ssh "$tmp\s2-app-$stamp.tgz" "$tmp\s2-kit-$stamp.tgz" "${Server}:/tmp/"; Assert-Exit "scp"
  # set -eo pipefail: buoc nao loi (build, migrate trong setup.sh) => ssh exit != 0 => throw; VERSION chi ghi khi da xong.
  $remote = "set -eo pipefail; cd $Dir; tar xzf /tmp/s2-kit-$stamp.tgz; mkdir -p build; rm -rf build/app.new; mkdir build/app.new; " +
    "tar xzf /tmp/s2-app-$stamp.tgz -C build/app.new; rm -rf build/app; mv build/app.new build/app; cp Dockerfile nginx.conf build/; " +
    "unlink /tmp/s2-app-$stamp.tgz; unlink /tmp/s2-kit-$stamp.tgz; " +
    "${envDomain}bash gen-env.sh; " +
    "if ! S2_APP_VERSION='$commit' docker compose -p sohoptac2 build > build.log 2>&1; then tail -n 60 build.log; echo 'deploy: docker compose build LOI'; exit 1; fi; " +
    "grep -E 'Built' build.log || true; bash setup.sh 2>&1; " +
    "echo '$commit ($Ref)' > VERSION; bash ./ops-host-status.sh || true"
  ssh @ssh $Server $remote; Assert-Exit "ssh build + setup.sh (migrate/seed/chay)"
  Write-Host "sohoptac2: đã deploy $commit ($Ref). Tunnel: ssh -i $Key -N -L 18431:127.0.0.1:18431 -L 18432:127.0.0.1:18432 -L 18433:127.0.0.1:18433 -L 18434:127.0.0.1:18434 -L 18435:127.0.0.1:18435 $Server"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
