# Dựng toàn bộ AI System trên máy dev bằng một lệnh: lõi (admin-api, hub-api) + 5 web (ai-admin, chat, studio,
# Sổ Hợp Tác, Community). Chạy lại an toàn: bước nào đã xong thì bỏ qua. Log + PID ở .data\dev-up\. Tắt: scripts\dev-down.ps1.
#   scripts\dev-up.ps1              Postgres/Redis: dùng cái đang chạy, không có thì docker compose (hoặc dev-db.ps1)
#   scripts\dev-up.ps1 -Only core   chỉ admin-api + hub-api
#   scripts\dev-up.ps1 -Fresh       xoá DB dev rồi dựng lại (mất dữ liệu dev)
#   scripts\dev-up.ps1 -DbName ai_system_try   chạy trên DB riêng (tự tạo nếu chưa có), không đụng DB ai_system
#   scripts\dev-up.ps1 -SeedDemo    thêm tenant `demo` (demo-owner) + dữ liệu mẫu Sổ Hợp Tác, Community, flow duyệt — giống demo prod
# Các bước: bun install → .env.local (keys:dev) → Postgres/Redis → `hub:dev` (migrate, admin-api :3001, user demo, hub:seed,
# hub-api :4000; không bật agent-runtime) → web dev server. Web chỉ nhận biến PUBLIC_* + URL proxy, không nhận secret.
param([ValidateSet("all", "core")] [string]$Only = "all", [switch]$Fresh, [ValidatePattern('^[a-z][a-z0-9_]*$')] [string]$DbName = "ai_system",
  [switch]$SeedDemo, [int]$TimeoutS = 240)
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
  # Không dùng -RedirectStandard* (CreateProcess kế thừa handle ⇒ server giữ stdout của shell gọi, pipe/CI treo tới khi tắt
  # server): ShellExecute qua cmd tự ghi log; env tiến trình hiện tại vẫn được kế thừa.
  try {
    $cmd = "$($argv -join ' ') > `"$log`" 2> `"$log.err`""
    $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/d /c `"$cmd`"" -WorkingDirectory $cwd -WindowStyle Hidden -PassThru
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
# .env.local cũ (tạo trước khi .env.example thêm biến) ⇒ chép biến còn thiếu với giá trị mẫu; không đổi biến đã có
function Sync-EnvLocal([string]$example, [string]$local) {
  $have = @{}
  foreach ($l in Get-Content $local -Encoding UTF8) { if ($l -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') { $have[$matches[1]] = 1 } }
  $add = @(Get-Content $example -Encoding UTF8 | Where-Object { $_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=' -and -not $have.ContainsKey($matches[1]) })
  if ($add.Count -gt 0) {
    $kept = @(Get-Content $local -Encoding UTF8)
    [IO.File]::WriteAllLines($local, [string[]]($kept + "# thêm bởi dev-up từ .env.example" + $add), [Text.UTF8Encoding]::new($false))
    "  .env.local thiếu $($add.Count) biến so với .env.example ⇒ đã thêm: " + (($add | ForEach-Object { ($_ -split '=', 2)[0].Trim() }) -join ', ')
  }
}
Sync-EnvLocal (Join-Path $repo ".env.example") (Join-Path $repo ".env.local")

# 3. Postgres + Redis
if ((Test-Port 5432) -and (Test-Port 6379)) { "Postgres/Redis đã chạy" }
elseif (Get-Command docker -ErrorAction SilentlyContinue) { "docker compose up…"; docker compose up -d --wait; if ($LASTEXITCODE) { throw "docker compose lỗi" } }
elseif (Test-Path (Join-Path $PSScriptRoot "dev-db.ps1")) { & (Join-Path $PSScriptRoot "dev-db.ps1") -Wait }
else { throw "Cần Postgres :5432 + Redis :6379 — cài Docker Desktop rồi chạy lại." }
if (Test-Path $pidFile) { throw "Có phiên dev-up đang chạy ($pidFile) — chạy scripts\dev-down.ps1 trước." }

# DB khác mặc định: đổi tên DB trong mọi URL của .env.local (env tiến trình thắng --env-file), tạo DB nếu chưa có
# HUB_SEED_FIXTURES=1: hub:dev tạo tenant demo `evolu` + 5 user + agent/mẫu quy trình (mặc định seed tối giản không có demo)
# CONTRACTS_WEB_URL / COMMUNITY_WEB_URL: link chuyển app do hub-api trả (Community "Mở Sổ Hợp Tác"); vắng ⇒ "/" = về bảng tin
# Cờ dev bắt buộc (thắng .env.local): engine quy trình + module đóng băng bật ⇒ ai-admin có "Quy trình", "Nguồn"
$coreEnv = @{ HUB_DEV_RUNTIME = "none"; HUB_SEED_FIXTURES = "1"
  HUB_PROCESS_ENGINE = "on"; HUB_FROZEN_MODULES = "on"; ADMIN_FROZEN_MODULES = "on"
  CONTRACTS_WEB_URL = "http://localhost:3300"; COMMUNITY_WEB_URL = "http://localhost:3400"
  # duyệt HĐ trên engine (như prod demo): công tắc env + feature `contracts-approval-engine` (demo-packs cấp cho evolu/demo)
  CONTRACTS_APPROVAL_ENGINE = "on" }
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

# -SeedDemo: tenant `demo` giống demo prod (dữ liệu bịa, email example.invalid). Mọi bước idempotent; script seed tự từ chối
# APP_ENV=production / DB ngoài localhost. Mật khẩu demo-owner: DEMO_OWNER_PW trong .env.local (tự sinh lần đầu, không in).
if ($SeedDemo) {
  $envLocal = Join-Path $repo ".env.local"
  $hasPw = Select-String -Path $envLocal -Pattern '^\s*DEMO_OWNER_PW\s*=\s*\S{10,}' -Quiet
  if (-not $hasPw) {
    $alnum = [char[]]"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $bytes = New-Object byte[] 16; $rng.GetBytes($bytes)
    $pw = -join ($bytes | ForEach-Object { $alnum[$_ % $alnum.Length] })
    $kept = Get-Content $envLocal -Encoding UTF8 | Where-Object { $_ -notmatch '^\s*DEMO_OWNER_PW\s*=' }
    [IO.File]::WriteAllLines($envLocal, [string[]]($kept + "DEMO_OWNER_PW=$pw"), [Text.UTF8Encoding]::new($false))
    "  đã sinh DEMO_OWNER_PW vào .env.local"
  }
  Remove-Item env:DEMO_OWNER_PW -ErrorAction SilentlyContinue
  "seed demo: tenant demo + Community (đối tác, bài mẫu)…"
  bun --env-file=.env.local tools/scripts/src/seed-community-demo.ts --dev-fixture --apply --out (Join-Path $out "demo-partners.txt")
  if ($LASTEXITCODE) { throw "seed-community-demo lỗi" }
  "seed demo: phòng ban + gói Sổ Hợp Tác (deploy/tenants/demo.yaml)…"
  $actor = bun -e "import postgres from 'postgres'; const s = postgres(process.env.DATABASE_URL, { max: 1 }); const r = await s``select id from admin.users where role = 'platform_admin' and username = 'admin'``; console.log(r[0]?.id ?? ''); await s.end();"
  if (-not $actor) { throw "không tìm thấy platform admin" }
  bun --env-file=.env.local apps/admin-api/src/modules/tenant-onboard/tenant-onboard.cli.ts --file deploy/tenants/demo.yaml --actor $actor | Out-Null
  if ($LASTEXITCODE) { throw "onboard demo.yaml lỗi" }
  bun --env-file=.env.local tools/hub-dev/src/demo-packs.ts --tenant demo
  if ($LASTEXITCODE) { throw "bật gói cho demo lỗi" }
  "seed demo: hợp đồng mẫu Sổ Hợp Tác (seed-demo-v2)…"
  bun --env-file=.env.local tools/scripts/src/seed-demo-v2.ts --tenant demo --apply | Out-Null
  if ($LASTEXITCODE) { throw "seed-demo-v2 lỗi" }
  "seed demo: flow duyệt mẫu (seed-flow-showcase)…"
  bun --env-file=.env.local tools/scripts/src/seed-flow-showcase.ts --apply
  if ($LASTEXITCODE) { throw "seed-flow-showcase lỗi" }
}

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
  # mỗi app một origin như prod (host riêng): link chuyển app + SSO qua chat-web (prod: PUBLIC_SSO_URL = host chat)
  $common["PUBLIC_CONTRACTS_WEB_URL"] = "http://localhost:3300"
  $common["PUBLIC_SSO_URL"] = "http://localhost:3100"
  if (-not $common.ContainsKey("PUBLIC_COMMUNITY_API")) { $common["PUBLIC_COMMUNITY_API"] = "http" }
  $common["PUBLIC_FROZEN_MODULES"] = "on"
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
if ($SeedDemo) { "Tenant demo: mã công ty demo, demo-owner, mật khẩu = DEMO_OWNER_PW trong .env.local; mật khẩu tạm đối tác: $out\demo-partners.txt" }
