<#
.SYNOPSIS
    Stage the kh-events sidecar: KH's app/ code with only the packages the sidecar needs (no torch, no model).

.EXAMPLE
    pwsh -NoProfile -File deploy/btp/kh-events/stage.ps1
    cf push -f deploy/btp/kh-events/manifest.yml -p deploy/btp/kh-events/.build
#>
$ErrorActionPreference = "Stop"
$KhRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$Stage  = Join-Path $PSScriptRoot ".build"
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force $Stage | Out-Null
Copy-Item -Recurse (Join-Path $KhRoot "app") (Join-Path $Stage "app")
Get-ChildItem $Stage -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
# The versions KH itself pins (requirements.txt), only the ones the sidecar imports.
$want = "fastapi", "starlette", "uvicorn", "pydantic", "pydantic_core", "requests", "hdbcli", "jsonschema",
        "python-dotenv", "PyJWT"
$pins = Get-Content (Join-Path $KhRoot "requirements.txt") | Where-Object {
    $name = ($_ -split "[=<>\[ ]")[0].Trim()
    $want -contains $name
}
Set-Content -Encoding ascii (Join-Path $Stage "requirements.txt") ($pins -join "`n")
# The Python buildpack reads runtime.txt (deploy/btp/push.ps1 uses the same line).
Set-Content -Encoding ascii (Join-Path $Stage "runtime.txt") "python-3.12.x"
Write-Host "staged $Stage with:"; Get-Content (Join-Path $Stage "requirements.txt")
