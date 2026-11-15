# CR-159 · BAI KIEM HANH TRINH THAT tren moi truong da deploy (ban test / prod): "ban giao la dung duoc, khong phai tu cau hinh gi".
#   powershell -File deploy/smoke/smoke-journey.ps1 -Env test
#   powershell -File deploy/smoke/smoke-journey.ps1 -Env prod -IKnowProd     # prod BAT BUOC co co -IKnowProd (nguoi dung dong y tung lan)
# Cach lam: SSH vao may chu -> xoa sach smoke-a/smoke-b con sot -> tao 2 cong ty TAM smoke-a / smoke-b (tenant-onboard + quy trinh) voi MAT KHAU TAM
# ngau nhien (chi o bo nho tien trinh nay + bien moi truong cua tien trinh con; KHONG ghi dia/log) -> chay Playwright tu may nay toi URL cong khai ->
# XOA SACH hai cong ty tam (tenant-purge --apply --confirm) ke ca khi loi (finally). Khong dung toi evolu/nitigroup/preschool (khoa cung o smoke-flows.ts + smoke-server.sh).
# Ket qua: bang Dat/Khong dat tung buoc + anh chup o .data/smoke/<luot>/. Thoat 0 = moi buoc san pham dat; 1 = co buoc khong dat; 2 = khong dung duoc moi truong tam.
# Buoc "AI doc hop dong" bao RIENG (loi AI khong lam hong ca bai). Buoc tin nhan chi chay khi CR-169 da co tren moi truong (kiem truoc, khong co thi bo qua + ghi ro).
param(
  [Parameter(Mandatory = $true)][ValidateSet("test", "prod")][string]$Env,
  [switch]$IKnowProd,
  [string]$Key = "$HOME\.ssh\evoc_key",
  [string]$Server = "evoc@149.202.83.5",
  [string]$Grep = ""
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding $false  # khong BOM khi pipe sang ssh
if ($Env -eq "prod" -and -not $IKnowProd) { Write-Host "prod: bat buoc co co -IKnowProd (xin nguoi dung dong y truoc)."; exit 2 }
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
if ($Env -eq "test") {
  $dir = "workspace/sohoptac2-staging"; $proj = "sohoptac2-staging"
  $urls = @{ cw = "https://app-test.evoluconsulting.com"; admin = "https://ai-test-admin.evoluconsulting.com"; chat = "https://ai-test.evoluconsulting.com" }
} else {
  $dir = "workspace/sohoptac2"; $proj = "sohoptac2"
  $urls = @{ cw = "https://app.evoluconsulting.com"; admin = "https://ai-admin.evoluconsulting.com"; chat = "https://ai.evoluconsulting.com" }
}
$run = (Get-Date).ToString("yyyyMMdd-HHmmss")
$out = Join-Path $root ".data/smoke/$run"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$sshOpt = @("-i", $Key, "-o", "BatchMode=yes", "-o", "ConnectTimeout=20")

# Mat khau tam: 24 ky tu chu-so ngau nhien (RNG mat ma), chi trong bo nho.
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$alpha = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
$pw = -join ($bytes | ForEach-Object { $alpha[$_ % $alpha.Length] })

function Invoke-Remote([string]$mode) {
  # Mat khau di qua STDIN (dong dau), khong vao tham so lenh / khong ghi dia.
  $cmd = "cd ~/$dir && sed -i 's/\r$//' smoke-src/smoke-server.sh smoke-src/smoke-flows.ts smoke-src/tenants/*.yaml && bash smoke-src/smoke-server.sh $mode ~/$dir $proj"
  $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  $script:remoteOut = @()
  try { $script:remoteOut = @($pw | & ssh @sshOpt $Server $cmd 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $prev }
  $rc = $LASTEXITCODE
  if ($mode -ne "probe") { $script:remoteOut | ForEach-Object { Write-Host "  [$mode] $_" } }
  return $rc
}

$code = 0
$setupOk = $false
try {
  Write-Host "== smoke-journey $run  moi truong=$Env  ($($urls.cw))"
  & ssh @sshOpt $Server "mkdir -p ~/$dir/smoke-src/tenants"
  if ($LASTEXITCODE -ne 0) { throw "khong SSH duoc toi $Server" }
  # Chep file bang base64 qua stdin (scp tren Windows loi khi duong dan khoa SSH co dau cach).
  $files = @(
    @((Join-Path $PSScriptRoot "smoke-server.sh"), "smoke-server.sh"),
    @((Join-Path $root "tools/scripts/src/smoke-flows.ts"), "smoke-flows.ts"),
    @((Join-Path $PSScriptRoot "tenants/smoke-a.yaml"), "tenants/smoke-a.yaml"),
    @((Join-Path $PSScriptRoot "tenants/smoke-b.yaml"), "tenants/smoke-b.yaml"))
  foreach ($f in $files) {
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($f[0])) | & ssh @sshOpt $Server "tr -cd 'A-Za-z0-9+/=' | base64 -d > ~/$dir/smoke-src/$($f[1])"
    if ($LASTEXITCODE -ne 0) { throw "chep $($f[1]) len may chu loi" }
  }
  $rc = Invoke-Remote "setup"
  if ($rc -ne 0) { throw "dung cong ty tam that bai (exit $rc) - xem dong [setup] o tren" }
  $setupOk = $true
  foreach ($l in $script:remoteOut) { if ($l -match "^DIRECTORY smoke-([ab]) (on|off)") { Set-Item -Path ("env:SMOKE_DIR_" + $Matches[1].ToUpper()) -Value $Matches[2] } }

  $null = Invoke-Remote "probe"
  $env:SMOKE_CR169 = $(if (($script:remoteOut | Select-Object -Last 1) -match "1") { "1" } else { "0" })
  Write-Host "CR-169 (tin nhan) tren moi truong: $env:SMOKE_CR169"
  $env:SMOKE_PW = $pw
  $env:SMOKE_CW = $urls.cw; $env:SMOKE_ADMIN = $urls.admin; $env:SMOKE_CHAT = $urls.chat
  $env:SMOKE_OUT = $out; $env:SMOKE_ENV = $Env
  Set-Location $root
  $pwArgs = @("node_modules/@playwright/test/cli.js", "test", "-c", "e2e/smoke-journey/playwright.smoke.config.ts")
  if ($Grep) { $pwArgs += @("--grep", $Grep) }
  & node @pwArgs
  if ($LASTEXITCODE -ne 0) { $code = 1 }
}
catch {
  Write-Host "LOI: $($_.Exception.Message)"
  $code = 2
}
finally {
  $env:SMOKE_PW = $null; $env:SMOKE_CR169 = $null; $env:SMOKE_DIR_A = $null; $env:SMOKE_DIR_B = $null
  Write-Host "== don cong ty tam (smoke-a, smoke-b)"
  $rc = Invoke-Remote "purge"
  if ($rc -ne 0) { Write-Host "CANH BAO: don smoke-a/smoke-b chua xong (exit $rc) - chay lai: powershell -File deploy/smoke/smoke-journey.ps1 -Env $Env (tu xoa sach luc dau)"; if ($code -eq 0) { $code = 2 } }
  & ssh @sshOpt $Server "rm -rf ~/$dir/smoke-src" 2>$null
  $pw = $null
}
$res = Join-Path $out "results.json"
if (Test-Path $res) {
  Write-Host ""
  Write-Host "== KET QUA (anh chup + results.json: $out)"
  $rows = Get-Content -Raw -Encoding UTF8 $res | ConvertFrom-Json
  foreach ($r in $rows) { Write-Host ("{0,-10} {1,-4} {2}{3}" -f $r.status, $r.id, $r.name, $(if ($r.note) { "  -- " + ($r.note -replace "[[0-9;]*m", "") } else { "" })) }
}
exit $code
