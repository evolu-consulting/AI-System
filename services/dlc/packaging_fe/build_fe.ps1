<#
Build the delivered default frontend (Windows, one-folder) and its zip.

    pwsh -File packaging_fe/build_fe.ps1          # from Slaves/SDLC; needs Python 3.10+ with PyInstaller, node + pnpm

Output: dist/dlc-fe/dlc-fe.exe (+ _internal/, run-fe.cmd, fe.config.example.json) and dist/dlc-fe-<version>-win64.zip.
The build fails if any .py source ends up in the package.
#>
$ErrorActionPreference = 'Stop'
$sdlc = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $sdlc

Push-Location web
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
pnpm build
if ($LASTEXITCODE -ne 0) { throw "web build failed" }
Pop-Location

$version = (python -c "import fe_bff; print(fe_bff.VERSION)").Trim()
python -m PyInstaller --noconfirm --clean --distpath dist --workpath packaging_fe/.work packaging_fe/dlc_fe.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

Copy-Item packaging_fe/assets/* dist/dlc-fe/ -Force

# guard: no Python source of ours in the package
$leak = Get-ChildItem dist/dlc-fe -Recurse -Filter *.py
if ($leak) { $leak | ForEach-Object { Write-Host "SOURCE LEAK: $($_.FullName)" }; throw "python source found in the package" }
if (-not (Test-Path dist/dlc-fe/_internal/web/dist/index.html)) { throw "web app missing from the package" }

& dist/dlc-fe/dlc-fe.exe version
if ($LASTEXITCODE -ne 0) { throw "built dlc-fe.exe does not run" }
$zip = "dist/dlc-fe-$version-win64.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path dist/dlc-fe -DestinationPath $zip
Write-Host "built $zip ($([Math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)"
