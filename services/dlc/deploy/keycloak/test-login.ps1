<#
.SYNOPSIS
    Prove that a user can sign in to a public PKCE client and that the access token is fit for the DLC engine:
    audience 'dlc-api' and the expected realm role. Runs the real authorization-code + PKCE flow against the
    Keycloak login page (no browser), prints the decoded claims, never prints the token itself.

.EXAMPLE
    .\test-login.ps1 -KeycloakUrl https://10.0.0.5:8443 -ClientId dlc-fe -RedirectUri http://10.0.0.5:8795/ -Username demo -Password 'S3cret!'
#>
param(
    [Parameter(Mandatory = $true)][string]$KeycloakUrl,
    [string]$Realm = "dlc",
    [string]$ClientId = "dlc-fe",
    [Parameter(Mandatory = $true)][string]$RedirectUri,
    [Parameter(Mandatory = $true)][string]$Username,
    [Parameter(Mandatory = $true)][string]$Password,
    [string]$ExpectAudience = "dlc-api",
    [string]$ExpectRole = "dlc-user",
    [string]$TokenFile = "",        # optional: write the access token here (for smoke tests with curl)
    [switch]$SkipCertificateCheck   # self-signed Keycloak certificate (pilot); needs PowerShell 7
)
$ErrorActionPreference = "Stop"
$tls = @{}; if ($SkipCertificateCheck) { $tls.SkipCertificateCheck = $true }
$KeycloakUrl = $KeycloakUrl.TrimEnd("/")
function B64Url([byte[]]$b) { [Convert]::ToBase64String($b).TrimEnd("=").Replace("+", "-").Replace("/", "_") }
function FromB64Url([string]$s) { $s = $s.Replace("-", "+").Replace("_", "/"); while ($s.Length % 4) { $s += "=" }; [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }

$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$buf = New-Object byte[] 32; $rng.GetBytes($buf); $verifier = B64Url $buf
$challenge = B64Url ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::ASCII.GetBytes($verifier)))
$state = [guid]::NewGuid().ToString("N")

$auth = "$KeycloakUrl/realms/$Realm/protocol/openid-connect/auth?response_type=code&client_id=$ClientId" +
        "&redirect_uri=$([uri]::EscapeDataString($RedirectUri))&scope=openid&state=$state" +
        "&code_challenge=$challenge&code_challenge_method=S256"
# One HttpClient with its own cookie jar and no auto-redirect, so the code can be read from the redirect.
Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $false
$handler.UseCookies = $true
$handler.CookieContainer = New-Object System.Net.CookieContainer
if ($SkipCertificateCheck) { $handler.ServerCertificateCustomValidationCallback = [System.Net.Http.HttpClientHandler]::DangerousAcceptAnyServerCertificateValidator }
$http = New-Object System.Net.Http.HttpClient($handler)
$page = $http.GetAsync($auth).Result
$html = $page.Content.ReadAsStringAsync().Result
if ($html -notmatch 'id="kc-form-login"[^>]*action="([^"]+)"') { throw "login form not found (HTTP $([int]$page.StatusCode); check client id / redirect uri)" }
$action = [System.Net.WebUtility]::HtmlDecode($Matches[1])
$form = New-Object 'System.Collections.Generic.Dictionary[string,string]'
$form["username"] = $Username; $form["password"] = $Password; $form["credentialId"] = ""
$post = $http.PostAsync($action, (New-Object System.Net.Http.FormUrlEncodedContent($form))).Result
$loc = if ($post.Headers.Location) { $post.Headers.Location.OriginalString } else { "" }
if ([int]$post.StatusCode -ne 302 -or -not $loc) {
    $body = $post.Content.ReadAsStringAsync().Result
    $msg = if ($body -match 'kc-feedback-text[^>]*>([^<]+)') { $Matches[1] } else { "HTTP $([int]$post.StatusCode)" }
    throw "login failed: $msg"
}
if ($loc -notmatch "[?&]code=([^&]+)") { throw "signed in, but Keycloak asks for another step first: $loc" }
$code = $Matches[1]

$tr = Invoke-RestMethod @tls -Method Post -Uri "$KeycloakUrl/realms/$Realm/protocol/openid-connect/token" `
      -ContentType "application/x-www-form-urlencoded" `
      -Body @{ grant_type = "authorization_code"; client_id = $ClientId; code = $code; redirect_uri = $RedirectUri; code_verifier = $verifier }
if ($TokenFile) { Set-Content -NoNewline -Encoding ASCII $TokenFile $tr.access_token; Write-Host "token : written to $TokenFile" }
$claims = (FromB64Url ($tr.access_token.Split(".")[1])) | ConvertFrom-Json
$aud = @($claims.aud)
$roles = @($claims.roles) + @($claims.realm_access.roles) | Where-Object { $_ } | Select-Object -Unique
Write-Host ("iss   : " + $claims.iss)
Write-Host ("sub   : " + $claims.sub + "  user: " + $claims.preferred_username)
Write-Host ("aud   : " + ($aud -join ", "))
Write-Host ("roles : " + ($roles -join ", "))
Write-Host ("exp in: " + ($claims.exp - [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) + " s")
$ok = ($aud -contains $ExpectAudience) -and ($roles -contains $ExpectRole)
if ($ok) { Write-Host "LOGIN OK: token carries aud $ExpectAudience and role $ExpectRole" -ForegroundColor Green; exit 0 }
Write-Host "LOGIN TOKEN NOT FIT: expected aud $ExpectAudience and role $ExpectRole" -ForegroundColor Red; exit 1
