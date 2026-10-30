<#
DEV wrapper: runs `dlc flow <mode>` from the source tree (the delivered application ships `dlc flow` itself).
Inputs, output and exit codes are those of line/flowhelper.py (see its docstring).
#>
param([Parameter(Mandatory = $true)][ValidateSet('new', 'enhance', 'bug', 'wait', 'migrate', 'migwait', 'migresume')][string]$Mode)
$sdlc = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$env:PYTHONPATH = if ($env:PYTHONPATH) { "$sdlc;$env:PYTHONPATH" } else { $sdlc }
& python -m line.app_main flow $Mode
exit $LASTEXITCODE
