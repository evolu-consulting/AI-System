<#
.SYNOPSIS
    Install the DLC stack on one Windows Server: Keycloak (https), the knowledge store (KH), the DLC engine and the
    default frontend, each as an automatic Windows service (WinSW), plus firewall rules.

.DESCRIPTION
    Idempotent: re-running replaces the program files and the service definitions, keeps data and secrets.
    Order: folders -> unpack -> Keycloak (cert, realm, service) -> KH (.env, service) -> engine (env, service)
    -> frontend (env, service) -> firewall -> summary. Then run configure-claude-profile.ps1, seed-stack.ps1 and
    verify-stack.ps1.

.EXAMPLE
    pwsh -File .\install-stack.ps1 -Config .\stack.config.psd1
#>
param([string]$Config = "", [switch]$SkipFirewall)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
Assert-Admin
$c = Read-StackConfig $Config
$P = $c.Paths

Step "Folders"
foreach ($d in $P.Apps, $P.Data, $P.Config, $P.Logs, (Join-Path $P.Data "dlc"), (Join-Path $P.Data "fe")) { New-Item -ItemType Directory -Force $d | Out-Null }
Protect-Folder $P.Secrets
Protect-Folder $P.Services
Ok $P.Root

function Expand-Fresh([string]$Zip, [string]$Dest, [switch]$KeepData) {
    $src = Join-Path $c.ArtifactsDir $Zip
    if (-not (Test-Path $src)) { throw "artifact missing: $src" }
    $tmp = Join-Path $env:TEMP ("dlc-unpack-" + [guid]::NewGuid().ToString("N"))
    Expand-Archive -Path $src -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp
    $root = if ($inner.Count -eq 1 -and $inner[0].PSIsContainer) { $inner[0].FullName } else { $tmp }
    New-Item -ItemType Directory -Force $Dest | Out-Null
    # robocopy keeps data folders that are not in the package (e.g. KH's chroma_data, hooks.db, .env)
    robocopy $root $Dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
    Remove-Item -Recurse -Force $tmp
    Ok "unpacked $Zip -> $Dest"
}

Step "Unpack"
$jdk = Join-Path $P.Apps "jdk21";   Expand-Fresh $c.JdkZip $jdk
$kc  = Join-Path $P.Apps "keycloak"; Expand-Fresh $c.KeycloakZip $kc
$kh  = Join-Path $P.Apps "kh";      Expand-Fresh $c.KhZip $kh
$dlc = Join-Path $P.Apps "dlc";     Expand-Fresh $c.DlcZip $dlc
$fe  = Join-Path $P.Apps "fe";      Expand-Fresh $c.FeZip $fe

# ------------------------------------------------------------------ Keycloak
Step "Keycloak (https $($c.KeycloakHttpsPort))"
$keytool = Join-Path $jdk "bin\keytool.exe"
$p12 = Join-Path $P.Secrets "keycloak-tls.p12"
$p12pw = Join-Path $P.Secrets "keycloak-tls.pass"
if (-not (Test-Path $p12)) {
    $pw = New-Secret 16; Set-Content -NoNewline -Path $p12pw -Value $pw
    & $keytool -genkeypair -alias keycloak -keyalg RSA -keysize 2048 -validity 825 -storetype PKCS12 `
        -keystore $p12 -storepass $pw -dname "CN=$($c.VpsIp)" -ext "SAN=ip:$($c.VpsIp),ip:127.0.0.1,dns:localhost" | Out-Null
    $cer = Join-Path $P.Config "keycloak-tls.cer"
    & $keytool -exportcert -alias keycloak -keystore $p12 -storepass $pw -rfc -file $cer | Out-Null
    # trust it on this host so the engine and the frontend backend can fetch the signing keys over https
    Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
    Ok "self-signed certificate for $($c.VpsIp) created and trusted on this host ($cer)"
} else { Ok "certificate kept ($p12)" }
$pw = Get-Content -Raw $p12pw

$adminFile = Join-Path $P.Secrets "keycloak-admin.txt"
if (-not (Test-Path $adminFile)) { Set-Content -NoNewline -Path $adminFile -Value (New-Secret 16) }
$adminPw = Get-Content -Raw $adminFile

# sign-in theme (the web's style 24); the realm template names it (loginTheme), so it must be there before the import
robocopy (Join-Path $PSScriptRoot "..\keycloak\themes") (Join-Path $kc "themes") /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copy Keycloak themes failed ($LASTEXITCODE)" }

& (Join-Path $PSScriptRoot "..\keycloak\render-realm.ps1") -VpsIp $c.VpsIp -FePort $c.FePort -EnginePort $c.EnginePort `
    -CustomerFeOrigin $c.CustomerFeOrigin -CustomerFeRedirect $c.CustomerFeRedirect -Out (Join-Path $kc "data\import\realm-dlc.json")

@"
# written by install-stack.ps1
hostname=https://$($c.VpsIp):$($c.KeycloakHttpsPort)
https-port=$($c.KeycloakHttpsPort)
http-enabled=false
https-key-store-file=$($p12 -replace '\\','/')
https-key-store-password=$pw
db=dev-file
health-enabled=true
"@ | Set-Content -Encoding ASCII (Join-Path $kc "conf\keycloak.conf")

Install-WinSwService -Cfg $c -Id "dlc-keycloak" -Name "DLC Keycloak" -Description "Identity provider (realm dlc)" `
    -Executable (Join-Path $env:SystemRoot "System32\cmd.exe") -Arguments "/c `"$(Join-Path $kc 'bin\kc.bat')`" start --import-realm" -WorkingDirectory $kc `
    -Env ([ordered]@{ JAVA_HOME = $jdk; PATH = "$jdk\bin;%PATH%"; KC_BOOTSTRAP_ADMIN_USERNAME = "admin"; KC_BOOTSTRAP_ADMIN_PASSWORD = $adminPw })
Start-Service dlc-keycloak
if (Wait-Http "$($c.Urls.Issuer)/.well-known/openid-configuration" 300 -Insecure) { Ok "Keycloak up: $($c.Urls.Issuer)" }
else { Warn "Keycloak did not answer within 5 minutes - see $($P.Logs)\dlc-keycloak.*.log" }

# ------------------------------------------------------------------ KH
Step "Knowledge store (127.0.0.1:$($c.KhPort))"
$keyFile = Join-Path $c.ArtifactsDir $c.KhSigningKeyFile
if (-not (Test-Path $keyFile)) { throw "signing key missing: $keyFile (make it on the build machine: openssl genpkey -algorithm ed25519 > kh-signing-key.pem)" }
$keyOneLine = ((Get-Content $keyFile) -join "\n")
$khEnvTemplate = Join-Path $PSScriptRoot "kh.agents.env"                       # deploy kit layout
if (-not (Test-Path $khEnvTemplate)) { $khEnvTemplate = Join-Path $PSScriptRoot "..\..\..\KnowledgeHub\deploy\windows\kh.agents.env" }
$khEnv = (Get-Content -Raw $khEnvTemplate) -replace "__KH_PORT__", $c.KhPort
$khEnv += "`nKH_PRINCIPAL_SIGNING_KEY=`"$keyOneLine`"`n"
Set-Content -Encoding UTF8 (Join-Path $kh ".env") $khEnv
icacls (Join-Path $kh ".env") /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" | Out-Null
Install-WinSwService -Cfg $c -Id "dlc-kh" -Name "DLC Knowledge store" -Description "Knowledge store for the DLC agents (local only)" `
    -Executable (Join-Path $kh "KnowledgeHub.exe") -WorkingDirectory $kh -Env ([ordered]@{ KH_NO_TRAY = "1" })
Start-Service dlc-kh
if (Wait-Http "$($c.Urls.Kh)/health" 300) { Ok "KH up: $($c.Urls.Kh)" } else { Warn "KH did not answer - see $kh\logs\app.log" }

# ------------------------------------------------------------------ DLC engine
Step "DLC engine ($($c.EnginePort))"
$dd = Join-Path $P.Data "dlc"
foreach ($s in "work", "packs", "targets") { New-Item -ItemType Directory -Force (Join-Path $dd $s) | Out-Null }
$ragLocal = Join-Path $P.Config "rag.local.json"
if (-not (Test-Path $ragLocal)) {
    @{ rag_url = $c.Urls.Kh; rag_ns = "dlc_line"; project = "dlc"; pack_id = "spec"
       header_run = "X-KH-Run"; header_unit = "X-KH-Unit"; header_attempt = "X-KH-Attempt"
       header_lease = "X-KH-Lease"; header_epoch = "X-KH-Epoch"; redaction_packs = @("kh-default@1")
       include_people_lanes = $true } |
        ConvertTo-Json | Set-Content -Encoding UTF8 $ragLocal
}
# this knowledge store serves only the engine: its project knowledge (the imported lessons) is matched by meaning
$rl = Get-Content -Raw $ragLocal | ConvertFrom-Json
if ($null -eq $rl.include_people_lanes) {
    $rl | Add-Member -NotePropertyName include_people_lanes -NotePropertyValue $true
    $rl | ConvertTo-Json | Set-Content -Encoding UTF8 $ragLocal
}
$claudeDir = Join-Path $P.Root "claude-profile"
New-Item -ItemType Directory -Force $claudeDir | Out-Null
$engineEnv = [ordered]@{
    LINE_HOST = "0.0.0.0"; LINE_PORT = "$($c.EnginePort)"
    LINE_DB = (Join-Path $dd "line.db"); LINE_WORKROOT = (Join-Path $dd "work")
    LINE_LLM = "cli"; LINE_MAX_USD_RUN = "$($c.MaxUsdRun)"; LINE_MAX_PARALLEL_UNITS = "$($c.MaxParallelUnits)"
    LINE_HUMAN_MODE = $c.HumanMode; LINE_FGRAPH = "1"; LINE_AUTO_RESUME = "1"; LINE_PROFILE = "agents"; LINE_MAX_ACTIVE_AGENTS = "10"
    LINE_LEARN = "1"                                             # distil keyed lessons from the engine's own failures
    LINE_LEARN_SERVE_MAX_CHARS = "4000"                          # lessons + knowledge per prompt (default 1500)
    LINE_RAG = "off"; LINE_RAG_LOCAL = $ragLocal                 # seed-stack.ps1 switches this to http
    LINE_AUTH_ISSUER = $c.Urls.Issuer; LINE_AUTH_AUDIENCE = "dlc-api"
    LINE_AUTH_ROLE_USER = "dlc-user"; LINE_AUTH_ROLE_ADMIN = "dlc-admin"; LINE_AUTH_BOARD_CLIENT = "dlc-fe"
    LINE_CORS_ORIGINS = "$($c.Urls.Fe),$($c.CustomerFeOrigin)"
    LINE_PUBLIC_HOST = $c.VpsIp; LINE_APP_PORTS = $c.AppPorts
    DLC_HOME = $dd; DLC_WORKSPACE_ROOT = "$($c.WorkspaceRoot)"; CLAUDE_CONFIG_DIR = $claudeDir; PYTHONIOENCODING = "utf-8"
    SSL_CERT_FILE = (Join-Path $P.Config "keycloak-tls.cer")   # trust for the Keycloak signing keys (also in the Windows store)
}
Install-WinSwService -Cfg $c -Id "dlc-engine" -Name "DLC Engine" -Description "DLC delivery engine (API + board)" `
    -Executable (Join-Path $dlc "dlc.exe") -Arguments "serve --resume" -WorkingDirectory $dd -Env $engineEnv -DependsOn @("dlc-kh")
# not started yet: the Claude profile (configure-claude-profile.ps1) comes first

# ------------------------------------------------------------------ frontend
Step "Default frontend ($($c.FePort))"
$fd = Join-Path $P.Data "fe"
$feEnv = [ordered]@{
    SDLC_HOST = "0.0.0.0"; SDLC_PORT = "$($c.FePort)"; SDLC_DATA_DIR = $fd; SDLC_DB = (Join-Path $fd "sdlc.db")
    SDLC_ENGINE_URL = $c.Urls.EngineLocal; SDLC_AUTH_ISSUER = $c.Urls.Issuer; SDLC_AUTH_CLIENT = "dlc-fe"
    SDLC_AUTH_AUDIENCE = "dlc-api"; SDLC_PUBLIC_URL = $c.Urls.Fe; PYTHONIOENCODING = "utf-8"
    SSL_CERT_FILE = (Join-Path $P.Config "keycloak-tls.cer")
}
Install-WinSwService -Cfg $c -Id "dlc-fe" -Name "DLC Frontend" -Description "Default DLC frontend" `
    -Executable (Join-Path $fe $c.FeExe) -Arguments $c.FeArgs -WorkingDirectory $fd -Env $feEnv -DependsOn @("dlc-engine")

# ------------------------------------------------------------------ firewall
if (-not $SkipFirewall) {
    Step "Firewall"
    $rules = @(
        @{ n = "DLC Keycloak";  p = "$($c.KeycloakHttpsPort)"; r = "Any" },
        @{ n = "DLC Frontend";  p = "$($c.FePort)";            r = "Any" },
        @{ n = "DLC Engine";    p = "$($c.EnginePort)";        r = $c.EngineAllowedRemote },
        @{ n = "DLC Apps";      p = $c.AppPorts;               r = "Any" }
    )
    foreach ($r in $rules) {
        Get-NetFirewallRule -DisplayName $r.n -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        New-NetFirewallRule -DisplayName $r.n -Direction Inbound -Protocol TCP -LocalPort $r.p -RemoteAddress $r.r -Action Allow | Out-Null
        Ok "$($r.n): TCP $($r.p) from $($r.r)"
    }
    Ok "KH port $($c.KhPort) stays closed (bound to 127.0.0.1)"
}

Step "Done"
Write-Host @"
  Keycloak admin : $($c.Urls.Keycloak)/admin   user 'admin', password in $adminFile
  Frontend       : $($c.Urls.Fe)  (starts after the engine)
  Engine         : $($c.Urls.Engine)
  Next           : configure-claude-profile.ps1  ->  seed-stack.ps1  ->  verify-stack.ps1
"@
