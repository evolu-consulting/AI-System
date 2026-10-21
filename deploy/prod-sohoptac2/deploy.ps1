# Deploy AI System + gói contracts lên 149.202.83.5 thành project Docker RIÊNG "sohoptac2" (~/workspace/sohoptac2). Xem README.md.
#   powershell -File deploy/prod-sohoptac2/deploy.ps1 [-Ref platform/gd0] [-DryRun] [-Domain evoluconsulting.com|none]
# -Domain: che do ten mien (URL https, CORS gom ca tunnel) - gen-env.sh nhan S2_DOMAIN; none = ve tunnel. Bat routing edge: enable-domain.sh (README).
# git archive <Ref> + bộ kit này -> scp -> giải nén vào build/app -> gen-env.sh (bí mật một lần, trên máy chủ) -> docker compose build
# -> setup.sh (migrate, seed, chạy, /health). Không đụng project khác; không đổi routing/TLS của host; dữ liệu (volume pgdata,
# data/, claude-home/, .env, ADMIN_CREDENTIALS.txt) giữ nguyên giữa các lần deploy.
param([string]$Ref = "platform/gd0", [switch]$DryRun, [string]$Domain = "")
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Key = "F:\workspace\id_evoc_key"; $Server = "evoc@149.202.83.5"; $Dir = "~/workspace/sohoptac2"
$ssh = @("-i", $Key, "-o", "BatchMode=yes")
$commit = (git -C $Repo rev-parse --short $Ref).Trim()
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tmp = Join-Path $env:TEMP "sohoptac2-$stamp"
if ($Domain -and $Domain -ne "none" -and $Domain -notmatch '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$') { throw "-Domain khong hop le: $Domain" }
$envDomain = if ($Domain) { "S2_DOMAIN=$Domain " } else { "" }
$kit = @("docker-compose.yml", "Dockerfile", "nginx.conf", "gen-env.sh", "filebox-env.sh", "setup.sh", "backup.sh", "restore-test.sh", "smoke-ai.ts", "env.template", "README.md", "enable-domain.sh", "disable-domain.sh", "edge/sohoptac2.conf")

if ($DryRun) { Write-Host "commit $commit ($Ref) -> ${Server}:$Dir"; return }
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  git -C $Repo archive --format=tar.gz -o "$tmp\s2-app-$stamp.tgz" $Ref
  # Kit lấy từ thư mục này; ép LF (chạy trên Linux)
  foreach ($f in $kit) {
    New-Item -ItemType Directory -Force (Split-Path "$tmp\$f") | Out-Null
    $t = [IO.File]::ReadAllText("$PSScriptRoot\$f").Replace("`r`n", "`n"); [IO.File]::WriteAllText("$tmp\$f", $t, (New-Object Text.UTF8Encoding $false))
  }
  tar.exe -czf "$tmp\s2-kit-$stamp.tgz" -C $tmp @kit
  ssh @ssh $Server "mkdir -p $Dir && chmod 700 $Dir"
  scp @ssh "$tmp\s2-app-$stamp.tgz" "$tmp\s2-kit-$stamp.tgz" "${Server}:/tmp/"
  $remote = "set -e; cd $Dir; tar xzf /tmp/s2-kit-$stamp.tgz; mkdir -p build; rm -rf build/app.new; mkdir build/app.new; " +
    "tar xzf /tmp/s2-app-$stamp.tgz -C build/app.new; rm -rf build/app; mv build/app.new build/app; cp Dockerfile nginx.conf build/; " +
    "unlink /tmp/s2-app-$stamp.tgz; unlink /tmp/s2-kit-$stamp.tgz; echo '$commit ($Ref)' > VERSION; " +
    "${envDomain}bash gen-env.sh; S2_APP_VERSION='$commit' docker compose -p sohoptac2 build 2>&1 | grep -E 'ERROR|error:|Built' || true; bash setup.sh 2>&1"
  ssh @ssh $Server $remote
  Write-Host "sohoptac2: đã deploy $commit ($Ref). Tunnel: ssh -i $Key -N -L 18431:127.0.0.1:18431 -L 18432:127.0.0.1:18432 -L 18433:127.0.0.1:18433 -L 18434:127.0.0.1:18434 $Server"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
