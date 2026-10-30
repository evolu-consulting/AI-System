<#
.SYNOPSIS
    Create (or update) a user in the 'dlc' realm and give it realm roles, through the Keycloak admin REST API.

.EXAMPLE
    .\new-user.ps1 -KeycloakUrl https://10.0.0.5:8443 -AdminUser admin -Username demo -Password 'S3cret!' -Roles dlc-user
    (the admin password is asked for when -AdminPassword is not given; nothing is written to disk)
#>
param(
    [Parameter(Mandatory = $true)][string]$KeycloakUrl,
    [string]$Realm = "dlc",
    [string]$AdminUser = "admin",
    [string]$AdminPassword = "",
    [Parameter(Mandatory = $true)][string]$Username,
    [Parameter(Mandatory = $true)][string]$Password,
    [string]$Email = "",
    [string]$FirstName = "",
    [string]$LastName = "",
    [string[]]$Roles = @("dlc-user"),
    [switch]$Temporary,
    [switch]$SkipCertificateCheck   # self-signed Keycloak certificate (pilot); needs PowerShell 7
)
$ErrorActionPreference = "Stop"
if ($SkipCertificateCheck) { $PSDefaultParameterValues["Invoke-RestMethod:SkipCertificateCheck"] = $true }
$KeycloakUrl = $KeycloakUrl.TrimEnd("/")
if (-not $AdminPassword) {
    $sec = Read-Host -AsSecureString "Keycloak admin password for '$AdminUser'"
    $AdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$tok = (Invoke-RestMethod -Method Post -Uri "$KeycloakUrl/realms/master/protocol/openid-connect/token" `
        -ContentType "application/x-www-form-urlencoded" `
        -Body @{ grant_type = "password"; client_id = "admin-cli"; username = $AdminUser; password = $AdminPassword }).access_token
$h = @{ Authorization = "Bearer $tok" }
$base = "$KeycloakUrl/admin/realms/$Realm"

# Keycloak 24+ asks for a complete profile (first name, last name, e-mail) on the first sign-in unless it is set;
# fill it so the user lands straight in the app.
if (-not $Email) { $Email = "$Username@dlc.local" }
if (-not $FirstName) { $FirstName = $Username }
if (-not $LastName) { $LastName = "User" }
$found = Invoke-RestMethod -Uri "$base/users?username=$([uri]::EscapeDataString($Username))&exact=true" -Headers $h
if ($found.Count -eq 0) {
    $body = @{ username = $Username; enabled = $true; emailVerified = $true }
    if ($Email) { $body.email = $Email }
    Invoke-RestMethod -Method Post -Uri "$base/users" -Headers $h -ContentType "application/json" -Body ($body | ConvertTo-Json) | Out-Null
    $found = Invoke-RestMethod -Uri "$base/users?username=$([uri]::EscapeDataString($Username))&exact=true" -Headers $h
    Write-Host "created user $Username"
} else { Write-Host "user $Username exists - updating password and roles" }
$id = $found[0].id
$upd = @{ email = $Email; emailVerified = $true; firstName = $FirstName; lastName = $LastName; enabled = $true; requiredActions = @() } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$base/users/$id" -Headers $h -ContentType "application/json" -Body $upd | Out-Null

$cred = @{ type = "password"; value = $Password; temporary = [bool]$Temporary } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$base/users/$id/reset-password" -Headers $h -ContentType "application/json" -Body $cred | Out-Null

$all = Invoke-RestMethod -Uri "$base/roles" -Headers $h
$want = @($all | Where-Object { $Roles -contains $_.name } | ForEach-Object { @{ id = $_.id; name = $_.name } })
if ($want.Count -ne $Roles.Count) { throw "unknown role in: $($Roles -join ', ') (realm has: $(($all.name) -join ', '))" }
Invoke-RestMethod -Method Post -Uri "$base/users/$id/role-mappings/realm" -Headers $h -ContentType "application/json" `
    -Body (ConvertTo-Json -InputObject $want -Depth 3) | Out-Null
Write-Host "roles set: $($Roles -join ', ')"
