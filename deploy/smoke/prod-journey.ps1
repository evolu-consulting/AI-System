# [prod-journey] · Bo Playwright chay toi moi truong DA DEPLOY (3 cong ty that evolu / nitigroup / preschool).
#   $env:PJ_PW = "<mat khau chung ban dau>"; powershell -File deploy/smoke/prod-journey.ps1 -Env test
#   $env:PJ_PW = "..."; powershell -File deploy/smoke/prod-journey.ps1 -Env prod -IKnowProd    # prod BAT BUOC co co -IKnowProd (nguoi dung dong y tung lan)
# Mat khau nhan qua bien moi truong PJ_PW do nguoi goi dat san (script KHONG hoi, KHONG in, KHONG ghi dia). Tai khoan moi bi ep doi mat khau lan dau: bo test tu doi sang mat khau tam ngau nhien (chi trong bo nho).
# CHU Y: bo nay TAO du lieu that (hop dong, ket noi doi tac) va DOI mat khau ba cong ty ⇒ chi chay khi DB duoc phep xoa sach sau do.
# Ket qua: anh + trace o .data/prod-journey/. Thoat 0 = moi ca dat.
param(
  [Parameter(Mandatory = $true)][ValidateSet("test", "prod")][string]$Env,
  [switch]$IKnowProd,
  [string]$Grep = ""
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($Env -eq "prod" -and -not $IKnowProd) { Write-Host "prod: bat buoc co co -IKnowProd (xin nguoi dung dong y truoc)."; exit 2 }
if (-not $env:PJ_PW) { Write-Host "Chua dat bien moi truong PJ_PW (mat khau chung ban dau)."; exit 2 }
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$cw = if ($Env -eq "prod") { "https://app.evoluconsulting.com" } else { "https://app-test.evoluconsulting.com" }
$run = (Get-Date).ToString("yyyyMMdd-HHmmss")
$out = Join-Path $root ".data/prod-journey/$run"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$env:PJ_CW = $cw
$env:PJ_OUT = $out
Write-Host "== prod-journey $run  moi truong=$Env  ($cw)  anh: $out"
Push-Location $root
try {
  $pwArgs = @("node_modules/@playwright/test/cli.js", "test", "-c", "e2e/prod-journey/playwright.prod-journey.config.ts")
  if ($Grep) { $pwArgs += @("-g", $Grep) }
  & node @pwArgs
  exit $LASTEXITCODE
} finally { Pop-Location }
