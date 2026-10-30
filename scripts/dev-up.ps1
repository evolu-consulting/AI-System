# Dựng toàn bộ AI System trên máy dev bằng một lệnh: lõi (admin-api, hub-api) + 5 web (ai-admin, chat, studio,
# Sổ Hợp Tác, Community). Chạy lại an toàn: bước nào đã xong thì bỏ qua. Log + PID ở .data\dev-up\. Tắt: scripts\dev-down.ps1.
#   scripts\dev-up.ps1              Postgres/Redis: dùng cái đang chạy, không có thì docker compose (hoặc dev-db.ps1)
#   scripts\dev-up.ps1 -Only core   chỉ admin-api + hub-api
#   scripts\dev-up.ps1 -Fresh       xoá DB dev rồi dựng lại (mất dữ liệu dev)
#   scripts\dev-up.ps1 -DbName ai_system_try   chạy trên DB riêng (tự tạo nếu chưa có), không đụng DB ai_system
# Các bước: bun install → .env.local (keys:dev) → Postgres/Redis → `hub:dev` (migrate, admin-api :3001, user demo, hub:seed,
# hub-api :4000; không bật agent-runtime) → web dev server. Web chỉ nhận biến PUBLIC_* + URL proxy, không nhận secret.
param([ValidateSet("all", "core")] [string]$Only = "all", [switch]$Fresh, [ValidatePattern('^[a-z][a-z0-9_]*$')] [string]$DbName = "ai_system",
  [int]$TimeoutS = 240)
$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
$out = Join-Path $repo ".data\dev-up"
New-Item -ItemType Directory -Force $out | Out-Null
$pidFile = Join-Path $out "pids.txt"

# rsbuild dev nghe `localhost`, trên Windows có thể chỉ là ::1 ⇒ thử cả IPv4 lẫn IPv6
function Test-Port([int]$port) {
  foreach ($h in "127.0.0.1", "::1") {
    $c = New-Object Net.Sockets.TcpClient([Net.Sockets.AddressFamily]$(if ($h -eq "::1") { "InterNetworkV6" } else { "InterNetwork" }))
    try { if ($c.ConnectAsync($h, $port).Wait(300) -and $c.Connected) { return $true } } catch {} finally { $c.Dispose() }
  }
  $false
}
function Wait-Port([int]$port, [string]$name, [string]$log, [Diagnostics.Process]$proc) {
  $deadline = (Get-Date).AddSeconds($TimeoutS)
  while (-not (Test-Port $port)) {
    if ($proc.HasExited) { Get-Content "$log.err" -Tail 15 -Encoding UTF8; throw "${name}: tiến trình đã thoát (mã $($proc.ExitCode)) — xem $log.err" }
    if ((Get-Date) -gt $deadline) { throw "$name không lên cổng $port sau $TimeoutS s — xem $log" }
    Start-Sleep -Milliseconds 500
  }
  "  $name sẵn sàng (:$port)"
}
function Start-Bg([string]$name, [string]$cwd, [string[]]$argv, [hashtable]$envVars) {
  $log = Join-Path $out "$name.log"
  $saved = @{}
  foreach ($k in $envVars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $envVars[$k]) }
  try {
    $p = Start-Process -FilePath $argv[0] -ArgumentList $argv[1..($argv.Count - 1)] -WorkingDirectory $cwd -WindowStyle Hidden `
      -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru
  } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }
  Add-Content $pidFile "$name $($p.Id)"
  Write-Host "  bật $name (pid $($p.Id), log $log)"
  $p
}

# 1. công cụ + phụ thuộc
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw "Chưa có Bun (https://bun.sh) — cài Bun 1.3+ rồi chạy lại." }
if (-not (Test-Path (Join-Path $repo "node_modules"))) { "bun install…"; bun install --frozen-lockfile; if ($LASTEXITCODE) { throw "bun install lỗi" } }

# 2. env: .env.local sinh từ .env.example với khoá dev mới (không in giá trị)
if (-not (Test-Path (Join-Path $repo ".env.local"))) { "tạo .env.local (bun run keys:dev)…"; bun run keys:dev; if ($LASTEXITCODE) { throw "keys:dev lỗi" } }

# 3. Postgres + Redis
if ((Test-Port 5432) -and (Test-Port 6379)) { "Postgres/Redis đã chạy" }
elseif (Get-Command docker -ErrorAction SilentlyContinue) { "docker compose up…"; docker compose up -d --wait; if ($LASTEXITCODE) { throw "docker compose lỗi" } }
elseif (Test-Path (Join-Path $PSScriptRoot "dev-db.ps1")) { & (Join-Path $PSScriptRoot "dev-db.ps1") -Wait }
else { throw "Cần Postgres :5432 + Redis :6379 — cài Docker Desktop rồi chạy lại." }
if (Test-Path $pidFile) { throw "Có phiên dev-up đang chạy ($pidFile) — chạy scripts\dev-down.ps1 trước." }

# DB khác mặc định: đổi tên DB trong mọi URL của .env.local (env tiến trình thắng --env-file), tạo DB nếu chưa có
# HUB_SEED_FIXTURES=1: hub:dev tạo tenant demo `evolu` + 5 user + agent/mẫu quy trình (mặc định seed tối giản không có demo)
$coreEnv = @{ HUB_DEV_RUNTIME = "none"; HUB_SEED_FIXTURES = "1" }
if ($DbName -ne "ai_system") {
  foreach ($line in Get-Content (Join-Path $repo ".env.local") -Encoding UTF8) {
    if ($line -match '^\s*((ADMIN_API_|HUB_|AGENT_RT_)?DATABASE_URL)\s*=\s*(\S+/)ai_system\s*$') { $coreEnv[$matches[1]] = "$($matches[3])$DbName" }
  }
  if (-not $coreEnv["DATABASE_URL"]) { throw "Không đọc được DATABASE_URL (…/ai_system) trong .env.local" }
  $env:DEVUP_OWNER_URL = $coreEnv["DATABASE_URL"] -replace "/$DbName$", "/postgres"
  $env:DEVUP_DB = $DbName
  Push-Location (Join-Path $repo "packages\db")
  try {
    bun -e "import postgres from 'postgres'; const s = postgres(process.env.DEVUP_OWNER_URL, { max: 1 }); const n = process.env.DEVUP_DB; const r = await s``select 1 from pg_database where datname = `${n}``; if (!r.length) { await s.unsafe('create database ' + n); console.log('tạo DB ' + n); } await s.end();"
    if ($LASTEXITCODE) { throw "không tạo được DB $DbName" }
  } finally { Pop-Location; Remove-Item env:DEVUP_OWNER_URL, env:DEVUP_DB }
}
foreach ($k in $coreEnv.Keys) { Set-Item "env:$k" $coreEnv[$k] }
if ($Fresh) { "xoá DB dev (db:reset:dev)…"; bun run db:reset:dev; if ($LASTEXITCODE) { throw "db:reset:dev lỗi" } }
# migrate + seed platform_admin (idempotent; hub:dev chỉ migrate, không tạo platform_admin)
"db:migrate + db:seed…"
bun run db:setup; if ($LASTEXITCODE) { throw "db:setup lỗi (migrate-guard lệch? thử -DbName <db mới> hoặc -Fresh)" }

# 4. lõi: migrate + admin-api + user demo + hub:seed + hub-api (dùng lại `hub:dev`, không bật agent-runtime)
"lõi (hub:dev, DB $DbName)…"
$core = Start-Bg "core" $repo @("bun", "run", "hub:dev") $coreEnv
Wait-Port 3001 "admin-api" (Join-Path $out "core.log") $core
Wait-Port 4000 "hub-api" (Join-Path $out "core.log") $core

# Sổ Hợp Tác + Community cho tenant demo `evolu` (hub:dev chỉ tạo tenant + user)
bun --env-file=.env.local tools/hub-dev/src/demo-packs.ts
if ($LASTEXITCODE) { throw "bật gói demo lỗi" }

# 5. web dev server — chỉ biến công khai + đích proxy (giống combine:dev, plan R2)
if ($Only -eq "all") {
  $pub = @{}
  foreach ($line in Get-Content (Join-Path $repo ".env.local") -Encoding UTF8) {
    if ($line -match '^\s*(PUBLIC_[A-Z0-9_]+)\s*=(.*)$') { $pub[$matches[1]] = $matches[2].Trim().Trim('"') }
  }
  $common = $pub.Clone()
  $common["ADMIN_API_URL"] = "http://localhost:3001"
  $common["HUB_URL"] = "http://localhost:4000"
  $common["AUTH_URL"] = "http://localhost:3001"
  $common["PUBLIC_HUB_URL"] = "http://localhost:4000"
  $common["PUBLIC_ADMIN_WEB_URL"] = "http://localhost:3000"
  $common["PUBLIC_CHAT_WEB_URL"] = "http://localhost:3100"
  $common["PUBLIC_STUDIO_URL"] = "http://localhost:3200"
  if (-not $common.ContainsKey("PUBLIC_COMMUNITY_API")) { $common["PUBLIC_COMMUNITY_API"] = "http" }
  $webs = [ordered]@{ "admin-web" = 3000; "chat-web" = 3100; "studio-web" = 3200; "contracts-web" = 3300; "community-web" = 3400 }
  $procs = @{}
  foreach ($w in $webs.Keys) { $procs[$w] = Start-Bg $w (Join-Path $repo "apps\$w") @("bun", "run", "dev") $common }
  foreach ($w in $webs.Keys) { Wait-Port $webs[$w] $w (Join-Path $out "$w.log") $procs[$w] }
}

""
"AI System đang chạy (tắt: scripts\dev-down.ps1)"
"  ai-admin      http://localhost:3000"
if ($Only -eq "all") {
  "  chat          http://localhost:3100"
  "  studio        http://localhost:3200"
  "  Sổ Hợp Tác    http://localhost:3300"
  "  Community     http://localhost:3400"
}
"  admin-api     http://localhost:3001   hub-api http://localhost:4000"
"Tài khoản dev: xem docs/guides/local-setup.md (mục Tài khoản)."
