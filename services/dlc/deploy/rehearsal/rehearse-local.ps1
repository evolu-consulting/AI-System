# Rehearsal of install-stack.ps1 + seed-stack.ps1 on a NON-elevated dev machine, from the built kit only.
# Same steps and environment as the real scripts; processes instead of Windows services, SSL_CERT_FILE instead of
# the machine certificate store, separate ports so a running dev stack is untouched.
param([string]$Kit = "E:\lw\dlc-kit", [string]$Root = "E:\lw\rh-final", [string]$Ip = "192.168.0.188",
      [int]$KcPort = 18443, [int]$KhPort = 19300, [int]$EnginePort = 18796, [int]$FePort = 18795, [string]$AppPorts = "19100-19199",
      [string]$DemoPassword = "Demo!2026x")
$ErrorActionPreference = "Stop"
$kitScripts = Join-Path $Kit "kit"
function Step($m) { Write-Host "`n=== $m ===" }
function Ok($m) { Write-Host "  OK  $m" }
function WaitHttp($u, $s = 240) { $t = (Get-Date).AddSeconds($s); while ((Get-Date) -lt $t) { try { $r = Invoke-WebRequest -Uri $u -SkipCertificateCheck -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -lt 500) { return $true } } catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -lt 500) { return $true } }; Start-Sleep 2 }; return $false }
function Secret { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ }) }
function Expand($zip, $dest) { $tmp = Join-Path $env:TEMP ("rh-" + [guid]::NewGuid().ToString("N")); Expand-Archive (Join-Path $Kit $zip) $tmp -Force; $in = Get-ChildItem $tmp; $src = if ($in.Count -eq 1 -and $in[0].PSIsContainer) { $in[0].FullName } else { $tmp }; New-Item -ItemType Directory -Force $dest | Out-Null; robocopy $src $dest /E /NFL /NDL /NJH /NJS /NP | Out-Null; Remove-Item -Recurse -Force $tmp; Ok "unpacked $zip" }
function StartProc($name, $exe, $argList, $wd, $envMap) {
    foreach ($k in $envMap.Keys) { [Environment]::SetEnvironmentVariable($k, [string]$envMap[$k]) }
    $p = Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $wd -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $Root "logs\$name.out.log") -RedirectStandardError (Join-Path $Root "logs\$name.err.log")
    Set-Content (Join-Path $Root "logs\$name.pid") $p.Id
    Ok "$name pid $($p.Id)"
}
foreach ($k in @(Get-ChildItem env: | Where-Object { $_.Name -eq "CLAUDECODE" -or $_.Name -like "CLAUDE_CODE_*" })) { Remove-Item "env:$($k.Name)" }

Step "Folders"
$A = Join-Path $Root "apps"; $D = Join-Path $Root "data"; $C = Join-Path $Root "config"; $S = Join-Path $Root "secrets"
foreach ($dir in $A, $D, $C, $S, (Join-Path $Root "logs"), (Join-Path $D "dlc"), (Join-Path $D "fe")) { New-Item -ItemType Directory -Force $dir | Out-Null }

Step "Unpack (from the kit only)"
$jdk = Join-Path $A "jdk21"; Expand "OpenJDK21U-jdk_x64_windows_hotspot.zip" $jdk
$kc = Join-Path $A "keycloak"; Expand "keycloak-26.0.7.zip" $kc
$kh = Join-Path $A "kh"; Expand "KnowledgeHub-win64.zip" $kh
$dlc = Join-Path $A "dlc"; Expand "dlc-0.1.0-win64.zip" $dlc
$fe = Join-Path $A "fe"; Expand "dlc-fe-0.2.0-win64.zip" $fe

Step "Keycloak https $KcPort"
$p12 = Join-Path $S "keycloak-tls.p12"; $pw = Secret; $cer = Join-Path $C "keycloak-tls.cer"
& (Join-Path $jdk "bin\keytool.exe") -genkeypair -alias keycloak -keyalg RSA -keysize 2048 -validity 825 -storetype PKCS12 -keystore $p12 -storepass $pw -dname "CN=$Ip" -ext "SAN=ip:$Ip,ip:127.0.0.1,dns:localhost" | Out-Null
& (Join-Path $jdk "bin\keytool.exe") -exportcert -alias keycloak -keystore $p12 -storepass $pw -rfc -file $cer | Out-Null
$adminPw = Secret; Set-Content -NoNewline (Join-Path $S "keycloak-admin.txt") $adminPw
New-Item -ItemType Directory -Force (Join-Path $kc "data\import") | Out-Null
& (Join-Path $kitScripts "keycloak\render-realm.ps1") -VpsIp $Ip -FePort $FePort -EnginePort $EnginePort -CustomerFeOrigin "http://${Ip}:3000" -CustomerFeRedirect "http://${Ip}:3000/*" -Out (Join-Path $kc "data\import\realm-dlc.json")
@"
hostname=https://${Ip}:$KcPort
https-port=$KcPort
http-enabled=false
https-key-store-file=$($p12 -replace '\\','/')
https-key-store-password=$pw
db=dev-file
health-enabled=true
"@ | Set-Content -Encoding ASCII (Join-Path $kc "conf\keycloak.conf")
StartProc "keycloak" (Join-Path $env:SystemRoot "System32\cmd.exe") "/c `"$(Join-Path $kc 'bin\kc.bat')`" start --import-realm" $kc @{ JAVA_HOME = $jdk; KC_BOOTSTRAP_ADMIN_USERNAME = "admin"; KC_BOOTSTRAP_ADMIN_PASSWORD = $adminPw }
$issuer = "https://${Ip}:$KcPort/realms/dlc"

Step "KH 127.0.0.1:$KhPort"
$key = Join-Path $Kit "kh-signing-key.pem"
$khEnv = (Get-Content -Raw (Join-Path $kitScripts "windows\kh.agents.env")) -replace "__KH_PORT__", $KhPort
$khEnv += "`nKH_PRINCIPAL_SIGNING_KEY=`"$(((Get-Content $key) -join '\n'))`"`n"
Set-Content -Encoding UTF8 (Join-Path $kh ".env") $khEnv
StartProc "kh" (Join-Path $kh "KnowledgeHub.exe") @() $kh @{ KH_NO_TRAY = "1" }
$khUrl = "http://127.0.0.1:$KhPort"
if (-not (WaitHttp "$khUrl/health" 300)) { throw "KH not up" }; Ok "KH up"
if (-not (WaitHttp "$issuer/.well-known/openid-configuration" 300)) { throw "Keycloak not up" }; Ok "Keycloak up"

Step "Seed: projects + namespace + client"
foreach ($pj in @(@{ id = "dlc"; name = "DLC delivery" }, @{ id = "lesson-learned"; name = "Lessons learned" })) { try { Invoke-RestMethod -Method Post -Uri "$khUrl/projects" -ContentType "application/json" -Body ($pj | ConvertTo-Json) | Out-Null } catch { }; Ok "project $($pj.id)" }
$ns = Invoke-RestMethod -Method Put -Uri "$khUrl/v1/admin/ns/dlc_line" -ContentType "application/json" -Body (@{ projects = @("dlc", "lesson-learned"); display = "DLC engine" } | ConvertTo-Json)
$client = Invoke-RestMethod -Method Post -Uri "$khUrl/v1/admin/ns/dlc_line:client" -ContentType "application/json" -Body "{}"
$tok = Invoke-RestMethod -Method Post -Uri "$khUrl/v1/token" -ContentType "application/json" -Body (@{ grant_type = "client_credentials"; client_id = $client.client_id; client_secret = $client.client_secret } | ConvertTo-Json)
if (-not $tok.access_token) { throw "token exchange failed" }; Ok "namespace $($ns.state), client works"

Step "Engine $EnginePort"
$dd = Join-Path $D "dlc"; foreach ($s2 in "work", "packs", "targets") { New-Item -ItemType Directory -Force (Join-Path $dd $s2) | Out-Null }
$ragLocal = Join-Path $C "rag.local.json"
@{ rag_url = $khUrl; rag_ns = "dlc_line"; project = "dlc"; pack_id = "spec"; header_run = "X-KH-Run"; header_unit = "X-KH-Unit"; header_attempt = "X-KH-Attempt"; header_lease = "X-KH-Lease"; header_epoch = "X-KH-Epoch"; redaction_packs = @("kh-default@1") } | ConvertTo-Json | Set-Content -Encoding UTF8 $ragLocal
$engineEnv = [ordered]@{
    LINE_HOST = "0.0.0.0"; LINE_PORT = "$EnginePort"; LINE_DB = (Join-Path $dd "line.db"); LINE_WORKROOT = (Join-Path $dd "work")
    LINE_LLM = "cli"; LINE_MAX_USD_RUN = "3"; LINE_MAX_PARALLEL_UNITS = "3"
    LINE_HUMAN_MODE = "decide"; LINE_FGRAPH = "1"; LINE_AUTO_RESUME = "1"; LINE_PROFILE = "agents"; LINE_MAX_ACTIVE_AGENTS = "10"
    LINE_RAG = "http"; LINE_RAG_LOCAL = $ragLocal; LINE_RAG_URL = $khUrl; LINE_RAG_NS = "dlc_line"
    LINE_RAG_CLIENT_ID = $client.client_id; LINE_RAG_CLIENT_SECRET = $client.client_secret
    LINE_AUTH_ISSUER = $issuer; LINE_AUTH_AUDIENCE = "dlc-api"; LINE_AUTH_ROLE_USER = "dlc-user"; LINE_AUTH_ROLE_ADMIN = "dlc-admin"; LINE_AUTH_BOARD_CLIENT = "dlc-fe"
    LINE_CORS_ORIGINS = "http://${Ip}:$FePort,http://${Ip}:3000"; LINE_PUBLIC_HOST = $Ip; LINE_APP_PORTS = $AppPorts
    DLC_HOME = $dd; PYTHONIOENCODING = "utf-8"; SSL_CERT_FILE = $cer
}
foreach ($k in $engineEnv.Keys) { [Environment]::SetEnvironmentVariable($k, [string]$engineEnv[$k]) }
$m = & (Join-Path $dlc "dlc.exe") rag-manifest apply 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "manifest apply failed: $m" }; Ok "manifest: $($m.Trim())"
StartProc "engine" (Join-Path $dlc "dlc.exe") "serve --resume" $dd $engineEnv
if (-not (WaitHttp "http://127.0.0.1:$EnginePort/api/health" 120)) { throw "engine not up" }; Ok "engine up"

Step "Lessons"
& (Join-Path $kitScripts "windows\import-lessons.ps1") -KhUrl $khUrl -File (Join-Path $Kit "lessons-customer.json")

Step "Frontend $FePort"
$fd = Join-Path $D "fe"
$feEnv = [ordered]@{ SDLC_HOST = "0.0.0.0"; SDLC_PORT = "$FePort"; SDLC_DATA_DIR = $fd; SDLC_DB = (Join-Path $fd "sdlc.db"); SDLC_ENGINE_URL = "http://127.0.0.1:$EnginePort"; SDLC_AUTH_ISSUER = $issuer; SDLC_AUTH_CLIENT = "dlc-fe"; SDLC_AUTH_AUDIENCE = "dlc-api"; SDLC_PUBLIC_URL = "http://${Ip}:$FePort"; PYTHONIOENCODING = "utf-8"; SSL_CERT_FILE = $cer }
foreach ($k in $feEnv.Keys) { [Environment]::SetEnvironmentVariable($k, [string]$feEnv[$k]) }
$o = & (Join-Path $fe "dlc-fe.exe") seed-flows 2>&1 | Out-String; Ok "flows: $($o.Trim())"
StartProc "fe" (Join-Path $fe "dlc-fe.exe") "serve" $fd $feEnv
if (-not (WaitHttp "http://127.0.0.1:$FePort/" 120)) { throw "FE not up" }; Ok "FE up"

Step "First user + login"
& (Join-Path $kitScripts "keycloak\new-user.ps1") -KeycloakUrl "https://${Ip}:$KcPort" -AdminPassword $adminPw -Username demo -Password $DemoPassword -Roles dlc-user, dlc-admin -SkipCertificateCheck
& (Join-Path $kitScripts "keycloak\test-login.ps1") -KeycloakUrl "https://${Ip}:$KcPort" -ClientId dlc-fe -RedirectUri "http://${Ip}:$FePort/" -Username demo -Password $DemoPassword -SkipCertificateCheck -TokenFile (Join-Path $Root "user.token")
Write-Host "`nREHEARSAL STACK UP"
