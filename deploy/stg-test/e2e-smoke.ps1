# Smoke e2e STAGING chi doc (CR-126): doc tai khoan tu .data/staging-for-pm.md (gitignored) vao bien moi truong STG_ACCOUNTS
# cua tien trinh con, chay rieng spec e2e/deployed/stg-smoke.ro.deployed.ts qua https host -test, xoa env o finally.
#   powershell -File deploy/stg-test/e2e-smoke.ps1
# Moi tai khoan dang nhap dung 1 lan (gioi han IP 30 luot / 10 phut). Mat khau KHONG in/ghi.
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$file = Join-Path $root ".data\staging-for-pm.md"
if (-not (Test-Path $file)) { throw "thieu .data/staging-for-pm.md" }
try {
  $accs = @()
  foreach ($l in [IO.File]::ReadAllLines($file, [Text.Encoding]::UTF8)) {
    if (-not $l.StartsWith("|")) { continue }
    $tok = @([regex]::Matches($l, '`([^`]+)`') | ForEach-Object { $_.Groups[1].Value })
    if ($tok.Count -lt 2) { continue }
    $pw = $tok[$tok.Count - 1]
    if ($tok.Count -ge 3) { $tenant = $tok[0]; $login = $tok[1] } else { $tenant = "demo"; $login = $tok[0] }
    if ($login -notmatch '^[a-z][a-z0-9-]+$' -or $pw.Length -lt 8) { continue }
    $role = if ($tenant -eq "platform") { "platform" } elseif ($login -like "doitac-*") { "partner" } else { ($login -replace '^demo-', '') }
    $accs += [pscustomobject]@{ role = $role; login = $login; password = $pw; tenant = $tenant }
  }
  if ($accs.Count -eq 0) { throw "khong doc duoc tai khoan nao" }
  Write-Host ("tai khoan: " + (($accs | ForEach-Object { $_.login }) -join ", "))
  $env:STG_ACCOUNTS = ConvertTo-Json -InputObject @($accs) -Compress
  $accs = $null
  $env:DEP_DOMAIN = "evoluconsulting.com"
  $env:DEP_HOSTS = "test"
  Set-Location $root
  & bun tools/scripts/src/run-playwright.ts e2e/deployed/deployed.config.ts e2e/deployed/stg-smoke.ro.deployed.ts --project ro --workers 1
  $code = $LASTEXITCODE
}
finally {
  $env:STG_ACCOUNTS = $null
  $env:DEP_DOMAIN = $null
  $env:DEP_HOSTS = $null
}
exit $code
