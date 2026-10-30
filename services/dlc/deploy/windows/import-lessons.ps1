<#
.SYNOPSIS
    Seed the knowledge store with the lessons-learned file (JSON) into project 'lesson-learned'.

.DESCRIPTION
    Accepts a JSON array, or an object with 'lessons' / 'rows' / 'items'. Each entry needs the lesson text in
    'text' (or 'source_text'); 'metadata' is kept (project and scope are forced). Safe to run again: the store
    derives a row id from the content, so the same lesson is stored once. Reads each row back.

.EXAMPLE
    pwsh -File .\import-lessons.ps1 -KhUrl http://127.0.0.1:9300 -File .\lessons-customer.json
#>
param(
    [string]$KhUrl = "http://127.0.0.1:9300",
    [Parameter(Mandatory = $true)][string]$File,
    [string]$Project = "lesson-learned",
    [switch]$WhatIf
)
$ErrorActionPreference = "Stop"
$KhUrl = $KhUrl.TrimEnd("/")
$doc = Get-Content -Raw -Encoding UTF8 $File | ConvertFrom-Json
$rows = if ($doc -is [array]) { $doc } elseif ($doc.lessons) { $doc.lessons } elseif ($doc.rows) { $doc.rows } elseif ($doc.items) { $doc.items } else { throw "no lessons array in $File" }

# make sure the project exists (201/200 on create, 409/400 when it is already there)
try { Invoke-RestMethod -Method Post -Uri "$KhUrl/projects" -ContentType "application/json" -Body (@{ id = $Project; name = "Lessons learned" } | ConvertTo-Json) | Out-Null } catch { }

$ok = 0; $skipped = 0; $failed = 0
foreach ($r in $rows) {
    $text = if ($r.text) { $r.text } elseif ($r.source_text) { $r.source_text } else { $null }
    if (-not $text) { $skipped++; continue }
    $meta = @{}
    if ($r.metadata) { $r.metadata.PSObject.Properties | ForEach-Object { if ($_.Name -notin "emb_model", "emb_ver", "emb_dim", "source_text") { $meta[$_.Name] = $_.Value } } }
    $meta.project = $Project; $meta.scope = "knowledge"
    if (-not $meta.kind) { $meta.kind = "lesson" }
    if ($r.id -or $r.vector_id) { $meta.seed_id = if ($r.id) { $r.id } else { $r.vector_id } }
    if ($WhatIf) { $ok++; continue }
    try {
        $body = @{ text = $text; scope = "knowledge"; metadata = $meta } | ConvertTo-Json -Depth 8
        $res = Invoke-RestMethod -Method Post -Uri "$KhUrl/vector/add" -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body))
        $back = Invoke-RestMethod -Method Post -Uri "$KhUrl/vector/scroll" -ContentType "application/json" `
            -Body (@{ scope = "knowledge"; project = $Project; ids = @($res.vector_id) } | ConvertTo-Json)
        if ($back.count -ge 1) { $ok++ } else { $failed++; Write-Warning "not read back: $($res.vector_id)" }
    } catch { $failed++; Write-Warning "failed: $($_.Exception.Message)" }
}
Write-Host "lessons: stored $ok, skipped $skipped (no text), failed $failed, total $($rows.Count)"
if ($failed) { exit 1 }
