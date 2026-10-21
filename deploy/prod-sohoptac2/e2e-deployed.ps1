# e2e TRIEN KHAI tren sohoptac2 (tenant demo, du lieu gia): mo SSH tunnel -> doc mat khau demo tren may chu (trong bo nho) -> chay Playwright -> dong tunnel.
#   powershell -File deploy/prod-sohoptac2/e2e-deployed.ps1 [-Grep <regex>] [-Spec <file>] [-User demo-owner]
# Mat khau KHONG in/ghi/commit: chi nam trong bien moi truong DEMO_PW cua tien trinh con. Khong dung nginx host/ten mien: web chia theo CONG.
param(
  [string]$Grep = "",
  [string]$Spec = "",
  [string]$User = "demo-owner",
  [string]$Domain = "",   # vd evoluconsulting.com: chay qua https host (DEP_DOMAIN), KHONG mo tunnel
  [ValidateSet("test", "prod")][string]$Hosts = "test",   # DEP_HOSTS: prod = sohoptac./ai./ai-admin./ai-hub. (dung voi -Domain)
  [string]$Key ="F:\workspace\id_evoc_key",
  [string]$Server = "evoc@149.202.83.5"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$tunnel = $null
try {
  # Tunnel: tham so tung phan tu, khong co dau nhay kep trong tham so ssh.
  $sshArgs = @("-i", $Key, "-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=20",
    "-L", "18431:127.0.0.1:18431", "-L", "18432:127.0.0.1:18432", "-L", "18433:127.0.0.1:18433", "-L", "18434:127.0.0.1:18434", $Server)
  $env:DEP_HOSTS = $Hosts
  if ($Domain) { $env:DEP_DOMAIN = $Domain } else {
  $tunnel = Start-Process -FilePath "ssh" -ArgumentList $sshArgs -WindowStyle Hidden -PassThru
  $ok = $false
  for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
    if ($tunnel.HasExited) { throw "ssh tunnel thoat som (cong 1843x dang bi dung?)" }
    try { $c = New-Object Net.Sockets.TcpClient; $c.Connect("127.0.0.1", 18434); $c.Close(); $ok = $true } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $ok) { throw "tunnel khong mo duoc" }
  }

  # Mat khau demo: doc tren may chu, chi giu trong bien moi truong cua tien trinh nay.
  # [[:space:]] thay dau cach de khong can dau nhay kep trong tham so ssh (PowerShell 5.1 bo dau nhay).
  $remote = 'grep -E ^' + $User + '[[:space:]]/[[:space:]] ~/workspace/sohoptac2/DEMO_CREDENTIALS.txt'
  $line = & ssh -i $Key -o BatchMode=yes $Server $remote
  if (-not $line) { throw "khong tim thay tai khoan demo $User" }
  $env:DEMO_PW = ($line -split " / ")[1].Split(" ")[0].Trim()
  $env:DEMO_USER = $User
  $line = $null
  # Mat khau platform admin (chi trong bo nho tien trinh con): e2e doc lich su chay Dify qua Admin API de xac minh tool that su duoc goi.
  $aline = & ssh -i $Key -o BatchMode=yes $Server 'grep -E ^password: ~/workspace/sohoptac2/ADMIN_CREDENTIALS.txt'
  if ($aline) { $env:ADMIN_PW = ($aline -replace '^password:[[:space:]]*', '').Trim() }
  $aline = $null

  Set-Location $root
  # Node that (khong qua shim Bun): xem tools/scripts/src/run-playwright.ts
  $pw = @("tools/scripts/src/run-playwright.ts", "e2e/deployed/deployed.config.ts")
  if ($Spec) { $pw += $Spec }
  if ($Grep) { $pw += @("--grep", $Grep) }
  & bun @pw
  $code = $LASTEXITCODE
}
finally {
  $env:DEMO_PW = $null
  $env:ADMIN_PW = $null
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
}
exit $code
