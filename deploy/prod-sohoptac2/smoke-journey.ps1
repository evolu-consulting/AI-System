# CR-159 · bai kiem hanh trinh that tren moi truong prod: goi deploy/smoke/smoke-journey.ps1 -Env prod (xem dau file do).
param([switch]$IKnowProd, [string]$Grep = "")
$a = @("-Env", "prod")
if ($IKnowProd) { $a += "-IKnowProd" }
if ($Grep) { $a += @("-Grep", $Grep) }
& powershell -NoProfile -File (Join-Path $PSScriptRoot "..\smoke\smoke-journey.ps1") @a
exit $LASTEXITCODE
