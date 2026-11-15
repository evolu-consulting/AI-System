# CR-159 · bai kiem hanh trinh that tren moi truong test: goi deploy/smoke/smoke-journey.ps1 -Env test (xem dau file do).
param([switch]$IKnowProd, [string]$Grep = "")
$a = @("-Env", "test")
if ($IKnowProd) { $a += "-IKnowProd" }
if ($Grep) { $a += @("-Grep", $Grep) }
& powershell -NoProfile -File (Join-Path $PSScriptRoot "..\smoke\smoke-journey.ps1") @a
exit $LASTEXITCODE
