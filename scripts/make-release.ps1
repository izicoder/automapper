# Builds the portable Windows release zip.
#
# The only thing inside is the single executable: Node.js, the program, the UI
# page and the conversion worker all live in automapper.exe. The user extracts
# the zip and double-clicks.
#
#   pwsh -File scripts/make-release.ps1 -Version 1.0.0 -Exe build/automapper.exe
#
# Output: release/automapper-<version>-win-x64.zip and release/SHA256SUMS.txt

param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Exe = "build/automapper.exe",
  [string]$Destination = "release"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root $Exe
$outDir = Join-Path $root $Destination
$stage = Join-Path $outDir "automapper-$Version"
$zip = Join-Path $outDir "automapper-$Version-win-x64.zip"

if (-not (Test-Path $source)) {
  throw "$Exe is missing: run 'npm run build:exe' first"
}

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Copy-Item $source (Join-Path $stage "automapper.exe")
Copy-Item (Join-Path $root "LICENSE") $stage
Copy-Item (Join-Path $root "NOTICE") $stage

# The program creates these on first start; shipping them empty shows where
# the songs go.
New-Item -ItemType Directory -Path (Join-Path $stage "INPUT") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "OUTPUT") -Force | Out-Null

$readme = @"
automapper $Version
$('=' * ("automapper $Version".Length))

Nothing to install. Node.js, the program and the web page are all inside
automapper.exe. Windows may warn about an unknown publisher the first time:
choose "More info" and then "Run anyway".

START THE WEB PAGE

    double-click automapper.exe

It opens a local page in your browser. Drag songs, packs or .zip archives
onto the page, pick what to convert, press Convert selected. Results land in
OUTPUT\ next to the .exe. Close the black window to stop.

CONVERT WITHOUT THE UI

    1. put songs, packs or .zip archives into INPUT\
    2. in a terminal in this folder:  automapper.exe convert
    3. take the .osz files from OUTPUT\

     automapper.exe convert --keys 4,10,18
     automapper.exe convert --force
     automapper.exe --help

INPUT\ and OUTPUT\ always sit next to automapper.exe. Everything the UI shows
is also written to automapper.log, so an error from an earlier run can still
be read.

License: GNU GPL v3 (LICENSE). The key-count automapper is a port of rizu
(NOTICE). Source and issues: https://github.com/izicoder/automapper
"@
Set-Content -Path (Join-Path $stage "README.txt") -Value $readme -Encoding utf8

Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal

$hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
Set-Content -Path (Join-Path $outDir "SHA256SUMS.txt") -Value "$hash  $(Split-Path -Leaf $zip)" -Encoding ascii

$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "release: $zip ($size MB)"
Write-Host "sha256 : $hash"
