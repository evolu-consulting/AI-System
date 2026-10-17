# Chạy spike ADR-0017 trên máy chủ 149.202.83.5, project Docker RIÊNG "evostaging" (không đụng "aisystem").
#   powershell -File deploy\staging\run-spike.ps1 -DryRun        # chỉ in lệnh sẽ chạy, không SSH
#   powershell -File deploy\staging\run-spike.ps1 [-LoadN 10000] [-Keep]
# Gửi git archive HEAD + bộ staging → build runner trên máy chủ → chạy (pg/redis riêng, giới hạn CPU/RAM) → lấy báo cáo
# về .data\staging-<giờ>\ → `docker compose down -v` + xoá thư mục (trừ khi -Keep). Tránh khung 00:16 UTC (máy chủ khởi động lại).
param([int]$LoadN = 10000, [switch]$Keep, [switch]$DryRun)
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Key = "F:\workspace\id_evoc_key"; $Server = "evoc@149.202.83.5"; $Dir = "~/workspace/evostaging"
$commit = git -C $Repo rev-parse --short HEAD
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$outLocal = Join-Path $Repo ".data\staging-$stamp"
$tmp = $env:TEMP

$remoteRun = "set -e; mkdir -p $Dir; cd $Dir; rm -rf app out; mkdir app out; tar xzf /tmp/evo-app.tgz -C app; " +
  "tar xzf /tmp/evo-kit.tgz; unlink /tmp/evo-app.tgz; unlink /tmp/evo-kit.tgz; echo '$commit' > app/VERSION; " +
  "LOAD_N=$LoadN docker compose -p evostaging up --build --abort-on-container-exit --exit-code-from runner runner 2>&1 | tail -n 60; " +
  "tar czf /tmp/evo-out.tgz -C out ."
$remoteDown = "cd $Dir && docker compose -p evostaging down -v --remove-orphans && cd ~ && rm -rf $Dir; " +
  "docker image rm evostaging-runner 2>/dev/null || true"

if ($DryRun) {
  Write-Host "commit: $commit  ·  LOAD_N=$LoadN  ·  máy chủ: $Server"
  Write-Host "1) git archive HEAD + deploy/staging → scp /tmp/evo-app.tgz, /tmp/evo-kit.tgz"
  Write-Host "2) ssh: $remoteRun"
  Write-Host "3) scp /tmp/evo-out.tgz → $outLocal"
  if (-not $Keep) { Write-Host "4) ssh: $remoteDown" }
  return
}

git -C $Repo archive --format=tar.gz -o "$tmp\evo-app.tgz" HEAD
tar.exe -czf "$tmp\evo-kit.tgz" -C "$PSScriptRoot" docker-compose.yml Dockerfile run-spike.sh pg-init
scp -i $Key -o BatchMode=yes "$tmp\evo-app.tgz" "$tmp\evo-kit.tgz" "${Server}:/tmp/"
try {
  ssh -i $Key -o BatchMode=yes $Server $remoteRun
  New-Item -ItemType Directory -Force $outLocal | Out-Null
  scp -i $Key -o BatchMode=yes "${Server}:/tmp/evo-out.tgz" "$outLocal\out.tgz"
  tar.exe -xzf "$outLocal\out.tgz" -C $outLocal
  ssh -i $Key -o BatchMode=yes $Server "unlink /tmp/evo-out.tgz"
} finally {
  if (-not $Keep) { ssh -i $Key -o BatchMode=yes $Server $remoteDown }
  Remove-Item "$tmp\evo-app.tgz", "$tmp\evo-kit.tgz" -ErrorAction SilentlyContinue
}
Write-Host "Báo cáo: $outLocal (summary.txt, spike-load-$LoadN.json, *.log)"
