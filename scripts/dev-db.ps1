# Bật Postgres 16 (:5432) và Redis giả lập fakeredis (:6379, có Streams) cho dev local KHÔNG cần Docker/WSL.
# Công cụ ở F:\workspace\tools (pgsql-16 bản zip; fakeredis trong venv Python; Garnet 2.1.8 KHÔNG dùng vì thiếu Streams); dữ liệu Postgres ở tools\pgdata-16; log ở tools\_logs.
#   scripts\dev-db.ps1          bật cái chưa chạy (chạy lại an toàn)
#   scripts\dev-db.ps1 -Wait    ... và chờ tới khi cả hai cổng trả lời
#   scripts\dev-db.ps1 -Stop    tắt cả hai
# Tạo tiến trình bằng WMI (Win32_Process.Create), như mgmt-app/scripts/dev-db.ps1: tiến trình không thuộc job object của
# shell gọi nên không bị tắt theo khi phiên của tool/IDE kết thúc.
# Cài lần đầu (đã làm 2026-10-17): giải nén PostgreSQL 16.15 binaries (EnterpriseDB) vào tools\pgsql-16, initdb user ai/ai_dev_pw;
# tạo venv tools\fakeredis\.venv bằng Python 3.12 rồi pip install "fakeredis>=2.26,<3". fakeredis chỉ để dev/test (bộ nhớ, một tiến trình).
param([switch]$Stop, [switch]$Wait, [string]$Tools = "F:\workspace\tools")

$pgBin = Join-Path $Tools "pgsql-16\bin"
$pgData = Join-Path $Tools "pgdata-16"
$fakeRedisPy = Join-Path $Tools "fakeredis\.venv\Scripts\python.exe"
$fakeRedisSrv = Join-Path $PSScriptRoot "fakeredis_server.py"
$logs = Join-Path $Tools "_logs"
New-Item -ItemType Directory -Force $logs | Out-Null

function Test-Port([int]$port) {
    $c = New-Object Net.Sockets.TcpClient
    try { $c.ConnectAsync("127.0.0.1", $port).Wait(300) -and $c.Connected } catch { $false } finally { $c.Dispose() }
}

function Start-Detached([string]$name, [string]$cmdline) {
    $cmd = "cmd.exe /d /c `"$cmdline > `"$logs\$name.log`" 2> `"$logs\$name.err.log`"`""
    $si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
    $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; ProcessStartupInformation = $si }
    if ($r.ReturnValue -ne 0) { throw "không bật được $name (WMI $($r.ReturnValue))" }
    "đã bật $name (pid $($r.ProcessId))"
}

if ($Stop) {
    if (Test-Path (Join-Path $pgData "postmaster.pid")) { & (Join-Path $pgBin "pg_ctl.exe") -D $pgData stop -m fast }
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape($fakeRedisSrv) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "đã tắt fakeredis $($_.ProcessId)" }
    return
}

if (Test-Port 5432) { "postgres đã chạy" }
else { Start-Detached "postgres" "`"$(Join-Path $pgBin 'postgres.exe')`" -D `"$pgData`"" }

if (Test-Port 6379) { "redis đã chạy" }
else { Start-Detached "fakeredis" "`"$fakeRedisPy`" `"$fakeRedisSrv`" 6379" }

if ($Wait) {
    foreach ($p in 5432, 6379) {
        $ok = $false
        for ($i = 0; $i -lt 60; $i++) { if (Test-Port $p) { $ok = $true; break }; Start-Sleep -Milliseconds 500 }
        if ($ok) { "cổng $p sẵn sàng" } else { throw "cổng $p không lên, xem $logs" }
    }
}
