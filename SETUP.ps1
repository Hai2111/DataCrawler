# ChatGPT - DataCrawler Windows setup (PowerShell 5.1+).
[CmdletBinding()]
param(
    [string]$Root,
    [switch]$SkipUpdate,
    [switch]$SkipLogServer,
    [switch]$SkipBrowser
)

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/Hai2111/DataCrawler.git'
if (-not $Root) {
    if (Test-Path (Join-Path $PSScriptRoot '.git')) {
        $Root = $PSScriptRoot
    } else {
        $Root = 'D:\codex\DataCrawler'
    }
}
$Root = [System.IO.Path]::GetFullPath($Root)

function Invoke-Checked {
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Exe failed (exit $LASTEXITCODE): $($Arguments -join ' ')"
    }
}

function Test-LogBridge {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:32145/health' -TimeoutSec 2
        return ($health.ok -eq $true -and $health.service -eq 'facebook-demand-collector-dev-log')
    } catch {
        return $false
    }
}

foreach ($cmd in @('git', 'node')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Missing dependency: $cmd. Install Git for Windows and Node.js 22+ LTS first."
    }
}
$nodeVersion = & node -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.0.0') {
    throw 'Node.js 22 or newer is required.'
}

Write-Host '[1/5] Clone or update repository'
if (Test-Path (Join-Path $Root '.git')) {
    $origin = & git -C $Root remote get-url origin
    if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)Hai2111/DataCrawler(?:\.git)?/?$') {
        throw "Unexpected git origin in $Root. No update performed."
    }
    if (-not $SkipUpdate) {
        $branch = & git -C $Root branch --show-current
        if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
            throw 'Switch to main before updating, or use -SkipUpdate.'
        }
        $dirty = & git -C $Root status --porcelain
        if ($LASTEXITCODE -ne 0 -or $dirty) {
            throw 'Working tree is not clean. Commit/stash changes or use -SkipUpdate.'
        }
        Invoke-Checked -Exe git -Arguments @('-C', $Root, 'pull', '--ff-only', 'origin', 'main')
    }
} else {
    if ((Test-Path $Root) -and (Get-ChildItem -LiteralPath $Root -Force | Select-Object -First 1)) {
        throw "Destination is not an empty directory: $Root"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Root) | Out-Null
    Invoke-Checked -Exe git -Arguments @('clone', '--branch', 'main', $repo, $Root)
}

Push-Location -LiteralPath $Root
try {
    Write-Host '[2/5] Create local storage'
    foreach ($folder in @('collected_data\facebook', 'collected_data\linkedin', 'debug_logs', 'reports')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $Root $folder) | Out-Null
    }

    Write-Host '[3/5] Run regression tests'
    Invoke-Checked -Exe node -Arguments @('--test', 'tests/extractor-core.test.js', 'tests/linkedin-extractor-core.test.js')

    Write-Host '[4/5] Start local debug server'
    if (-not $SkipLogServer) {
        if (-not (Test-LogBridge)) {
            if (Get-NetTCPConnection -LocalPort 32145 -State Listen -ErrorAction SilentlyContinue) {
                throw 'Port 32145 is occupied by an unverified service. No process was stopped.'
            }
            $process = Start-Process -FilePath (Get-Command node).Source -WorkingDirectory $Root -ArgumentList 'tools/dev-log-server.js' -PassThru
            $ready = $false
            for ($i = 0; $i -lt 10; $i++) {
                Start-Sleep -Milliseconds 500
                if (Test-LogBridge) { $ready = $true; break }
                if ($process.HasExited) { break }
            }
            if (-not $ready) { throw 'Debug server failed its health check.' }
        }
        Write-Host 'Debug server healthy: http://127.0.0.1:32145/health'
    }

    Write-Host '[5/5] Open installation page'
    if (-not $SkipBrowser) {
        Start-Process explorer.exe -ArgumentList ('"' + $Root + '"')
        try {
            Start-Process chrome.exe -ArgumentList 'chrome://extensions/'
        } catch {
            Write-Warning 'Chrome could not be opened. Open chrome://extensions/ manually.'
        }
    }

    Write-Host 'DATACRAWLER SETUP COMPLETE' -ForegroundColor Green
    Write-Host "Facebook extension: $Root\facebook-group-probe-extension"
    Write-Host "Facebook exports:   $Root\collected_data\facebook"
    Write-Host "LinkedIn extension: $Root\linkedin-post-collector-extension"
    Write-Host "LinkedIn exports:   $Root\collected_data\linkedin"
    Write-Host 'Load unpacked (or Reload) both extensions in Chrome and select their export folders.'
    Write-Host 'Use only permitted sources; no collection is started automatically.'
} finally {
    Pop-Location
}
