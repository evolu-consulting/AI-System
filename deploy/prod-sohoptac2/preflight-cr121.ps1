# Kiem truoc deploy CR-120 + CR-121 tren sohoptac2 (CHI DOC). Chay tu may dev, chi sau khi nguoi dung dong y:
#   powershell -File deploy/prod-sohoptac2/preflight-cr121.ps1 [-Ref platform/gd0] [-DryRun]
# Doc journal migration cua $Ref (git show) -> scp preflight-cr121.sh + .sql vao ~/workspace/sohoptac2 -> ssh chay tren may chu (SQL trong BEGIN READ ONLY..ROLLBACK).
# -DryRun: chi in so lieu journal + lenh se chay, KHONG ket noi.
param([string]$Ref = "platform/gd0", [switch]$DryRun, [string]$Key = "F:\workspace\id_evoc_key")
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Server = "evoc@149.202.83.5"; $Dir = "~/workspace/sohoptac2"
$ssh = @("-i", $Key, "-o", "BatchMode=yes")
function Assert-Exit([string]$What) { if ($LASTEXITCODE -ne 0) { throw "preflight: $What loi (exit $LASTEXITCODE)" } }

# journal repo: (so entry, `when` cuoi) cua tung bo migration
function Get-Journal([string]$dir) {
  $raw = git -C $Repo show "${Ref}:packages/db/$dir/meta/_journal.json"; Assert-Exit "git show journal $dir"
  $e = @(($raw -join "`n" | ConvertFrom-Json).entries)
  return @{ n = $e.Count; when = [decimal]$e[-1].when }
}
$hub = Get-Journal "migrations-hub"; $pack = Get-Journal "migrations-pack-contracts"; $admin = Get-Journal "migrations"
$envs = "PREFLIGHT_HUB_WHEN=$($hub.when) PREFLIGHT_HUB_N=$($hub.n) PREFLIGHT_PACK_WHEN=$($pack.when) PREFLIGHT_PACK_N=$($pack.n) PREFLIGHT_ADMIN_WHEN=$($admin.when) PREFLIGHT_ADMIN_N=$($admin.n)"
Write-Host "preflight: journal $Ref -> hub $($hub.n), pack-contracts $($pack.n), admin $($admin.n)"
if ($DryRun) { Write-Host "preflight: DryRun - se chay: ssh ${Server} 'cd $Dir && $envs bash preflight-cr121.sh'"; return }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tmp = Join-Path $env:TEMP "s2-preflight-$stamp"
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  foreach ($f in "preflight-cr121.sh", "preflight-cr121.sql") {   # ep LF (chay tren Linux)
    $t = [IO.File]::ReadAllText("$PSScriptRoot\$f").Replace("`r`n", "`n"); [IO.File]::WriteAllText("$tmp\$f", $t, (New-Object Text.UTF8Encoding $false))
  }
  # chep vao thu muc project (docker compose can compose file o cwd); xoa sau khi chay; exit 2 = co [CHAN]
  scp @ssh "$tmp\preflight-cr121.sh" "$tmp\preflight-cr121.sql" "${Server}:workspace/sohoptac2/"; Assert-Exit "scp"
  ssh @ssh $Server "cd $Dir && $envs bash preflight-cr121.sh; rc=`$?; unlink preflight-cr121.sh; unlink preflight-cr121.sql; exit `$rc"
  $rc = $LASTEXITCODE
  if ($rc -eq 2) { Write-Warning "preflight: co muc [CHAN] - KHONG deploy"; exit 2 }
  Assert-Exit "ssh preflight"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
