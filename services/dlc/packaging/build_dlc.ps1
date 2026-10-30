<#
Build the delivered DLC application (Windows, one-folder) and its zip.

    pwsh -File packaging/build_dlc.ps1          # from Slaves/SDLC; needs Python 3.10+ with PyInstaller

Output: dist/dlc/dlc.exe (+ _internal/) and dist/dlc-<version>-win64.zip. The zip carries the frozen engine
only: the build fails if any engine .py source ends up in it (sample target apps used by `dlc selfcheck`
are data, not engine code).
#>
$ErrorActionPreference = 'Stop'
$sdlc = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $sdlc
$version = (python -c "import line; print(line.__version__)").Trim()
python -m PyInstaller --noconfirm --clean --distpath dist --workpath packaging/.work packaging/dlc.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

# guard: no engine source in the package (sample apps under line/samples are allowed data)
$leak = Get-ChildItem dist/dlc -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'line.samples' }
if ($leak) { $leak | ForEach-Object { Write-Host "SOURCE LEAK: $($_.FullName)" }; throw "engine source found in the package" }

& dist/dlc/dlc.exe version
if ($LASTEXITCODE -ne 0) { throw "built dlc.exe does not run" }
$zip = "dist/dlc-$version-win64.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path dist/dlc -DestinationPath $zip
Write-Host "built $zip ($([Math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)"
