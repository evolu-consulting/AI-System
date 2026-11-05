# sohoptac2-cr118 · day ma nguon + kit UAT len ~/workspace/sohoptac2-cr118 tren host (KHONG build, KHONG chay gi, KHONG dung ~/workspace/sohoptac2).
#   powershell -File deploy/stg-cr118/push.ps1 -Ref slice/cr118-deploy-kit [-DryRun] [-Key F:\workspace\id_evoc_key]
# Sau do tren host: cd ~/workspace/sohoptac2-cr118 && bash build.sh && bash up.sh   (README.md). Chi chay khi nguoi dung xac nhan UAT.
param([Parameter(Mandatory = $true)][string]$Ref, [switch]$DryRun, [string]$Key = "F:\workspace\id_evoc_key")
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Server = "evoc@149.202.83.5"; $Dir = "~/workspace/sohoptac2-cr118"
$kit = @("docker-compose.yml", "gen-env.sh", "lib.sh", "build.sh", "up.sh", "down.sh", "stg-seed.ts", "README.md")
function Assert-Exit([string]$What) { if ($LASTEXITCODE -ne 0) { throw "push: $What loi (exit $LASTEXITCODE)" } }
if ($Ref -match "latest") { throw "push: ref khong hop le" }
$commit = "$(git -C $Repo rev-parse --short $Ref)".Trim(); Assert-Exit "git rev-parse $Ref"
if ($DryRun) { Write-Host "push[dry-run]: $commit ($Ref) + kit [$($kit -join ', ')] -> ${Server}:$Dir (khong ket noi, khong ghi)"; return }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"; $tmp = Join-Path $env:TEMP "s2cr118-$stamp"
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  git -C $Repo archive --format=tar.gz -o "$tmp\app.tgz" $Ref; Assert-Exit "git archive"
  foreach ($f in $kit) { $t = [IO.File]::ReadAllText("$PSScriptRoot\$f").Replace("`r`n", "`n"); [IO.File]::WriteAllText("$tmp\$f", $t, (New-Object Text.UTF8Encoding $false)) }
  tar.exe -czf "$tmp\kit.tgz" -C $tmp @kit; Assert-Exit "tar kit"
  $ssh = @("-i", $Key, "-o", "BatchMode=yes")
  ssh @ssh $Server "mkdir -p $Dir && chmod 700 $Dir"; Assert-Exit "ssh mkdir"
  scp @ssh "$tmp\app.tgz" "$tmp\kit.tgz" "${Server}:/tmp/"; Assert-Exit "scp"
  ssh @ssh $Server "set -eo pipefail; cd $Dir; tar xzf /tmp/kit.tgz; rm -rf build/app.new; mkdir -p build/app.new; tar xzf /tmp/app.tgz -C build/app.new; rm -rf build/app; mv build/app.new build/app; cp build/app/deploy/prod-sohoptac2/Dockerfile build/app/deploy/prod-sohoptac2/nginx.conf build/; unlink /tmp/kit.tgz; unlink /tmp/app.tgz; echo $commit > REF"; Assert-Exit "ssh giai nen"
  Write-Host "push: da day $commit len $Dir. Tiep: ssh ... 'cd $Dir && bash build.sh && bash up.sh'; tunnel: -L 28531:127.0.0.1:28531 ..."
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }