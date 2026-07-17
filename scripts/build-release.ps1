<#
.SYNOPSIS
    Builds a distributable release zip for the JoinFS-EuroScope bridge.

.DESCRIPTION
    Bundles the app, packages it as a standalone .exe (via npm run build:exe),
    then stages the .exe, a fresh config.json (from config.example.json),
    README.md and a rendered README.html into a "JoinFS-EuroScope-bridge"
    folder and zips it up. Extracting the resulting zip produces that same
    folder, ready to hand to end users.
#>

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$releaseName = 'JoinFS-EuroScope-bridge'
$releaseDir = Join-Path $root 'release'
$stagingDir = Join-Path $releaseDir $releaseName

$zipPath = Join-Path $releaseDir "$releaseName.zip"

Write-Host "==> Building standalone executable (npm run build:exe)..." -ForegroundColor Cyan
npm run build:exe
if ($LASTEXITCODE -ne 0) {
    throw "build:exe failed with exit code $LASTEXITCODE"
}

Write-Host "==> Preparing staging folder: $stagingDir" -ForegroundColor Cyan
if (Test-Path $stagingDir) {
    Remove-Item $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stagingDir 'docs') | Out-Null

Write-Host "==> Copying executable..." -ForegroundColor Cyan
Copy-Item (Join-Path $root 'dist\joinfs-euroscope-bridge.exe') $stagingDir

Write-Host "==> Copying config.json (from config.example.json)..." -ForegroundColor Cyan
Copy-Item (Join-Path $root 'config.example.json') (Join-Path $stagingDir 'config.json')

Write-Host "==> Copying README.md..." -ForegroundColor Cyan
Copy-Item (Join-Path $root 'README.md') $stagingDir

$screenshotPath = Join-Path $root 'docs\connect-dialog.png'
if (Test-Path $screenshotPath) {
    Copy-Item $screenshotPath (Join-Path $stagingDir 'docs\connect-dialog.png')
} else {
    Write-Warning "docs\connect-dialog.png not found - README will reference a missing image. Add it and rebuild."
}

Write-Host "==> Rendering README.html..." -ForegroundColor Cyan
node (Join-Path $root 'scripts\render-readme.js') (Join-Path $stagingDir 'README.md') (Join-Path $stagingDir 'README.html')
if ($LASTEXITCODE -ne 0) {
    throw "render-readme.js failed with exit code $LASTEXITCODE"
}

Write-Host "==> Creating zip: $zipPath" -ForegroundColor Cyan
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}
Compress-Archive -Path (Join-Path $stagingDir '*') -DestinationPath $zipPath

Write-Host ""
Write-Host "Done. Release zip: $zipPath" -ForegroundColor Green
Write-Host "Extracting it produces a '$releaseName' folder with the .exe, config.json, README.md and README.html."
