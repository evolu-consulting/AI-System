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
  [string]$Server = "evoc@149.202.83.5",
  [int]$RwDelay = 600   # giay: toi thieu tu luc bat dau ro+ai toi luc rw dang nhap (cua so gioi han IP 10 phut); 0 = khong cho
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
  # Ba lượt (xem đầu deployed.config.ts): ro (chỉ đọc, 4 worker) SONG SONG ai (chat AI, 2 worker, outputDir riêng), rồi rw (ghi, 1 worker).
  # -Spec/-Grep áp cho cả ba. Lượt không có test khớp (-Spec thuộc project khác) ⇒ bỏ qua.
  $code = 0
  function Test-Lane($name) {
    # PS 5.1: stderr cua lenh native + ErrorActionPreference=Stop => throw (lane khong co test khop -Spec); tam ha xuong Continue.
    $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try { $list = & bun @pw --project $name --list 2>$null } finally { $ErrorActionPreference = $prev }
    return ($LASTEXITCODE -eq 0 -and ($list -match "Total: [1-9]"))
  }
  $t0 = Get-Date
  $aiProc = $null
  $aiLog = Join-Path $env:TEMP ("e2e-deployed-ai-" + [guid]::NewGuid().ToString("N") + ".log")
  if (Test-Lane "ai") {
    Write-Host "== e2e deployed: project ai (workers 2) chay song song voi ro; log: ai-lane (in sau khi xong)"
    $aiProc = Start-Process -FilePath "bun" -ArgumentList ($pw + @("--project", "ai", "--workers", "2", "--output", "test-results/deployed-ai")) `
      -NoNewWindow -PassThru -RedirectStandardOutput $aiLog -RedirectStandardError "$aiLog.err"
  }
  if (Test-Lane "ro") {
    Write-Host "== e2e deployed: project ro (workers 4)"
    & bun @pw --project ro --workers 4
    if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
  } else { Write-Host "(khong co test khop o project ro)" }
  if ($aiProc) {
    $aiProc.WaitForExit()
    Write-Host "== e2e deployed: ket qua project ai"
    Get-Content $aiLog -Tail 200 | Write-Host
    if ($aiProc.ExitCode -ne 0) { $code = $aiProc.ExitCode }
    Remove-Item $aiLog, "$aiLog.err" -ErrorAction SilentlyContinue
  }
  # Gioi han dang nhap IP 30 luot / 10 phut: ro+ai da dung ~22; cho het cua so truoc khi rw dang nhap (RwDelay=0 de bo).
  $left = [int]($RwDelay - ((Get-Date) - $t0).TotalSeconds)
  if ($left -gt 0 -and (Test-Lane "rw")) { Write-Host "(cho $left s cho het cua so gioi han dang nhap truoc rw)"; Start-Sleep -Seconds $left }
  if (Test-Lane "rw") {
    Write-Host "== e2e deployed: project rw (workers 1)"
    & bun @pw --project rw --workers 1
    if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
  } else { Write-Host "(khong co test khop o project rw)" }

}
finally {
  $env:DEMO_PW = $null
  $env:ADMIN_PW = $null
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
}
exit $code
