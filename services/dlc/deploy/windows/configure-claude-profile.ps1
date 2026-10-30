<#
.SYNOPSIS
    Give the DLC engine service its own Claude Code credentials and prove that a non-interactive call works.

.DESCRIPTION
    Two ways, pick one:
      -Mode Token  (recommended for a service) run `claude setup-token` yourself in any terminal, sign in in the
                   browser, paste the printed token when asked; it is stored only in the engine service definition
                   (ACL: Administrators + SYSTEM) as CLAUDE_CODE_OAUTH_TOKEN.
      -Mode Login  sign in once into the engine's own profile folder (<InstallRoot>\claude-profile); the service
                   reads the same folder through CLAUDE_CONFIG_DIR.
    Then the script runs `claude -p` with exactly the service's environment and checks the answer.

.EXAMPLE
    pwsh -File .\configure-claude-profile.ps1 -Config .\stack.config.psd1 -Mode Token
#>
param([string]$Config = "", [ValidateSet("Token", "Login")][string]$Mode = "Token", [string]$TokenFile = "")
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
Assert-Admin
$c = Read-StackConfig $Config

Step "Claude Code CLI"
$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) {
    foreach ($p in "$env:USERPROFILE\.local\bin\claude.exe", "$env:ProgramFiles\nodejs\claude.cmd", "$env:APPDATA\npm\claude.cmd") {
        if (Test-Path $p) { $claude = $p; break }
    }
}
if (-not $claude) { throw "claude CLI not found. Install it first: irm https://claude.ai/install.ps1 | iex   (or npm i -g @anthropic-ai/claude-code)" }
# a service does not see the installing user's PATH: copy the CLI next to the services so its path never moves
$binDir = Join-Path $c.Paths.Root "bin"
New-Item -ItemType Directory -Force $binDir | Out-Null
if ($claude -like "*.exe") { Copy-Item $claude (Join-Path $binDir "claude.exe") -Force; $claude = Join-Path $binDir "claude.exe" }
Ok "CLI: $claude ($(& $claude --version))"

$profileDir = Join-Path $c.Paths.Root "claude-profile"
New-Item -ItemType Directory -Force $profileDir | Out-Null
$envAdd = [ordered]@{ CLAUDE_CONFIG_DIR = $profileDir; PATH = "$binDir;%PATH%" }

if ($Mode -eq "Token") {
    Step "Token"
    if ($TokenFile) {
        # token handed over in a file (masked paste can fail in some consoles); the file is deleted right away
        $tok = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
        Remove-Item -LiteralPath $TokenFile -Force
    } else {
        Write-Host "  In another terminal run:  claude setup-token   (sign in in the browser, copy the token it prints)"
        $sec = Read-Host -AsSecureString "  Paste the token"
        $tok = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)).Trim()
    }
    if ($tok.Length -lt 20) { throw "that does not look like a token" }
    $envAdd.CLAUDE_CODE_OAUTH_TOKEN = $tok
} else {
    Step "Login into $profileDir"
    Write-Host "  A Claude session opens with the engine's profile. Type /login, finish in the browser, then /exit."
    $old = $env:CLAUDE_CONFIG_DIR; $env:CLAUDE_CONFIG_DIR = $profileDir
    try { & $claude } finally { $env:CLAUDE_CONFIG_DIR = $old }
    icacls $profileDir /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
}

Step "Check a non-interactive call with the service's environment"
$saved = @{}
foreach ($k in $envAdd.Keys) { if ($k -ne "PATH") { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $envAdd[$k]) } }
try {
    $out = & $claude -p "Reply with exactly the word: ready" --max-turns 1 2>&1 | Out-String
} finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }
if ($out -notmatch "ready") { throw "claude -p did not answer as expected:`n$out" }
Ok "claude -p answers: $($out.Trim())"

Step "Engine service"
Set-ServiceEnv -Cfg $c -Id "dlc-engine" -Env $envAdd -NoRestart
Ok "dlc-engine has the Claude settings ($Mode); start it with: Start-Service dlc-engine"
