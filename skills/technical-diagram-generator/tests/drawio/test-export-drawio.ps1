param(
    [string] $DrawioExecutable = 'C:\Program Files\draw.io\draw.io.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [Parameter(Mandatory)] [bool] $Condition,
        [Parameter(Mandatory)] [string] $Message
    )

    if (-not $Condition) {
        throw "ASSERTION FAILED: $Message"
    }
}

function Get-PngDimensions {
    param([Parameter(Mandatory)] [string] $Path)

    [byte[]] $bytes = [System.IO.File]::ReadAllBytes($Path)
    Assert-True ($bytes.Length -ge 24) "PNG is too short: $Path"
    [byte[]] $signature = 137, 80, 78, 71, 13, 10, 26, 10
    for ($index = 0; $index -lt $signature.Length; $index++) {
        Assert-True ($bytes[$index] -eq $signature[$index]) "Invalid PNG signature: $Path"
    }

    $width = ([int] $bytes[16] -shl 24) -bor ([int] $bytes[17] -shl 16) -bor ([int] $bytes[18] -shl 8) -bor [int] $bytes[19]
    $height = ([int] $bytes[20] -shl 24) -bor ([int] $bytes[21] -shl 16) -bor ([int] $bytes[22] -shl 8) -bor [int] $bytes[23]
    return [pscustomobject]@{ Width = $width; Height = $height }
}

function Get-FileSnapshot {
    param([Parameter(Mandatory)] [string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ Exists = $false; Length = $null; LastWriteTicks = $null; Hash = $null }
    }

    $item = Get-Item -LiteralPath $Path
    return [pscustomobject]@{
        Exists = $true
        Length = $item.Length
        LastWriteTicks = $item.LastWriteTimeUtc.Ticks
        Hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    }
}

function Get-DrawioProcessIds {
    return @(Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -in @('draw.io', 'drawio') } |
        ForEach-Object { $_.Id })
}

$testDirectory = $PSScriptRoot
$skillDirectory = (Get-Item (Join-Path $testDirectory '..\..')).FullName
$exporter = Join-Path $skillDirectory 'scripts\export-drawio.ps1'
$sourceFixture = Join-Path $testDirectory 'valid-formal-flow.drawio'
$drawio = $DrawioExecutable
Write-Host "DRAWIO_EXECUTABLE=$drawio"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("drawio export test " + [guid]::NewGuid().ToString('N'))
$inputDirectory = Join-Path $testRoot 'input fixture'
$fixture = Join-Path $inputDirectory 'valid formal flow.drawio'
$outputDirectory = Join-Path $testRoot 'render output'
New-Item -ItemType Directory -Path $inputDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceFixture -Destination $fixture
$testStartUtc = [datetime]::UtcNow
$processIdsBefore = Get-DrawioProcessIds

try {
    $result = & $exporter -InputPath $fixture -OutputDirectory $outputDirectory -DrawioExecutable $drawio -BaseName 'formal-output'

    Assert-True ($null -ne $result) 'Exporter did not report a result object.'
    Assert-True ($result.DrawioVersion -match '^31\.') "Expected a Draw.io 31.x version, got '$($result.DrawioVersion)'."
    Assert-True ($fixture -match ' ' -and $outputDirectory -match ' ') 'Real integration must use input and output paths containing spaces.'

    $expectedPaths = @(
        (Join-Path $outputDirectory 'formal-output.png'),
        (Join-Path $outputDirectory 'formal-output.drawio.png'),
        (Join-Path $outputDirectory 'formal-output.drawio.svg')
    )
    $reportedPaths = @($result.PreviewPath, $result.EmbeddedPngPath, $result.EmbeddedSvgPath)
    Assert-True ($reportedPaths.Count -eq 3) 'Exporter did not report all three output paths.'

    for ($index = 0; $index -lt $expectedPaths.Count; $index++) {
        $expectedPath = [System.IO.Path]::GetFullPath($expectedPaths[$index])
        $reportedPath = $reportedPaths[$index]
        Assert-True ([System.IO.Path]::IsPathRooted($reportedPath) -and $reportedPath -eq [System.IO.Path]::GetFullPath($reportedPath)) "Reported path is not absolute: $reportedPath"
        Assert-True ($reportedPath -eq $expectedPath) "Reported path differs from expected output: $reportedPath"
        Assert-True (Test-Path -LiteralPath $expectedPath -PathType Leaf) "Missing output: $expectedPath"
        $output = Get-Item -LiteralPath $expectedPath
        Assert-True ($output.Length -gt 0) "Empty output: $expectedPath"
        Assert-True ($output.LastWriteTimeUtc -ge $testStartUtc.AddSeconds(-2)) "Output timestamp predates this test: $expectedPath"
    }

    $preview = Get-PngDimensions -Path $result.PreviewPath
    $embeddedPng = Get-PngDimensions -Path $result.EmbeddedPngPath
    Write-Host "DIMENSIONS preview=$($preview.Width)x$($preview.Height) embedded=$($embeddedPng.Width)x$($embeddedPng.Height)"
    Assert-True ($preview.Width -eq 3000) "Preview width must be exactly 3000 px, got $($preview.Width)."
    Assert-True ($embeddedPng.Width -gt 1000 -and $embeddedPng.Height -gt 1000) 'Embedded PNG must retain a high-resolution 2x export.'

    $svgText = [System.IO.File]::ReadAllText($result.EmbeddedSvgPath)
    [xml] $svg = $svgText
    Assert-True ($svg.DocumentElement.LocalName -eq 'svg') 'Embedded SVG is not an SVG XML document.'
    Assert-True ($svgText -match '(?is)(mxfile|mxGraphModel|data-mxgraph)') 'Embedded SVG lacks Draw.io diagram metadata.'

    Assert-True ($result.PreviewArguments -contains '--width') 'Preview job did not use an explicit width.'
    Assert-True ($result.PreviewArguments -contains '3000') 'Preview job did not request width 3000.'
    Assert-True (-not ($result.PreviewArguments -contains '-e')) 'Preview job must not embed Draw.io data.'
    Assert-True ($result.PreviewArguments -contains $fixture -and $result.PreviewArguments -contains $result.PreviewPath) 'Preview logical arguments did not preserve spaced input/output paths.'
    Assert-True ($result.EmbeddedPngArguments -contains '-e' -and $result.EmbeddedPngArguments -contains '-s' -and $result.EmbeddedPngArguments -contains '2') 'Embedded PNG job does not use -e -s 2.'
    foreach ($arguments in @($result.PreviewArguments, $result.EmbeddedPngArguments, $result.EmbeddedSvgArguments)) {
        $borderIndex = [array]::IndexOf([string[]] $arguments, '-b')
        Assert-True ($borderIndex -ge 0 -and $arguments[$borderIndex + 1] -eq '0' -and @($arguments | Where-Object { $_ -eq '-b' }).Count -eq 1) 'Every export must contain exactly one -b 0 for cross-format bounds parity.'
    }
    Assert-True ($result.EmbeddedPngArguments -contains $fixture -and $result.EmbeddedPngArguments -contains $result.EmbeddedPngPath) 'Embedded PNG logical arguments did not preserve spaced input/output paths.'
    Assert-True ($result.EmbeddedSvgArguments -contains '-e') 'Embedded SVG job does not use -e.'
    Assert-True ($result.EmbeddedSvgArguments -contains $fixture -and $result.EmbeddedSvgArguments -contains $result.EmbeddedSvgPath) 'Embedded SVG logical arguments did not preserve spaced input/output paths.'

    $defaultOutputDirectory = Join-Path $testRoot 'default base output'
    $defaultResult = & $exporter -InputPath $fixture -OutputDirectory $defaultOutputDirectory -DrawioExecutable $drawio
    Assert-True ($defaultResult.PreviewPath -eq (Join-Path $defaultOutputDirectory 'valid formal flow.png')) 'Omitted BaseName did not derive the input stem.'
    Assert-True ((Get-Item -LiteralPath $defaultResult.EmbeddedPngPath).Length -gt 0) 'Default-base embedded PNG is missing or empty.'
    Assert-True ((Get-Item -LiteralPath $defaultResult.EmbeddedSvgPath).Length -gt 0) 'Default-base embedded SVG is missing or empty.'

    $profiles = @(Get-ChildItem -LiteralPath $outputDirectory -Directory -Filter '.export-drawio-profile-*' -ErrorAction SilentlyContinue)
    Assert-True ($profiles.Count -eq 0) 'Exporter-created Draw.io profile was not cleaned up.'

    $invalidBaseError = $null
    try {
        & $exporter -InputPath $fixture -OutputDirectory $outputDirectory -DrawioExecutable (Join-Path $outputDirectory 'must-not-be-launched.exe') -BaseName 'invalid/name' | Out-Null
    }
    catch {
        $invalidBaseError = $_
    }
    Assert-True ($null -ne $invalidBaseError) 'Invalid base name did not fail before export.'
    Assert-True ($invalidBaseError.Exception.Message -match 'BaseName') 'Invalid base name was not rejected before Draw.io executable resolution.'

    $fakeDirectory = Join-Path $testRoot 'fake executable'
    $fakeExecutable = Join-Path $fakeDirectory 'fake drawio.cmd'
    $staleOutputDirectory = Join-Path $testRoot 'stale output'
    $stalePath = Join-Path $staleOutputDirectory 'stale-output.png'
    New-Item -ItemType Directory -Path $fakeDirectory, $staleOutputDirectory -Force | Out-Null
    @('@echo off', 'exit /b 0') | Set-Content -LiteralPath $fakeExecutable -Encoding ascii
    [System.IO.File]::WriteAllText($stalePath, 'stale preview must remain intact')
    $staleBefore = Get-FileSnapshot -Path $stalePath
    $staleError = $null
    try {
        & $exporter -InputPath $fixture -OutputDirectory $staleOutputDirectory -DrawioExecutable $fakeExecutable -BaseName 'stale-output' -SimulateProfileCleanupFailure | Out-Null
    }
    catch {
        $staleError = $_
    }
    Assert-True ($null -ne $staleError -and $staleError.Exception.Message -match 'output is stale') 'Cleanup failure masked the primary stale-output error.'
    Assert-True ($staleError.Exception.Message -match 'Simulated profile cleanup failure') 'Combined stale/cleanup failure lacks cleanup context.'
    $staleAfter = Get-FileSnapshot -Path $stalePath
    Assert-True ($staleAfter.Exists -and $staleAfter.Length -eq $staleBefore.Length -and $staleAfter.LastWriteTicks -eq $staleBefore.LastWriteTicks -and $staleAfter.Hash -eq $staleBefore.Hash) 'Stale output changed while validating a failed export.'
    $staleProfiles = @(Get-ChildItem -LiteralPath $staleOutputDirectory -Directory -Filter '.export-drawio-profile-*' -ErrorAction SilentlyContinue)
    Assert-True ($staleProfiles.Count -eq 0) 'Failed fake export left an exporter profile directory.'

    $cleanupFailureError = $null
    try {
        & $exporter -InputPath $fixture -OutputDirectory $outputDirectory -DrawioExecutable $drawio -BaseName 'cleanup-failure' -SimulateProfileCleanupFailure | Out-Null
    }
    catch {
        $cleanupFailureError = $_
    }
    Assert-True ($null -ne $cleanupFailureError -and $cleanupFailureError.Exception.Message -match 'Simulated profile cleanup failure') 'Successful export with cleanup failure did not report the cleanup error.'
    Assert-True ($cleanupFailureError.Exception.Message -notmatch 'stale') 'Successful export incorrectly reported a body failure instead of cleanup failure.'
    foreach ($cleanupOutput in @('cleanup-failure.png', 'cleanup-failure.drawio.png', 'cleanup-failure.drawio.svg')) {
        Assert-True ((Get-Item -LiteralPath (Join-Path $outputDirectory $cleanupOutput)).Length -gt 0) "Cleanup-failure run did not complete export output: $cleanupOutput"
    }
    $cleanupProfiles = @(Get-ChildItem -LiteralPath $outputDirectory -Directory -Filter '.export-drawio-profile-*' -ErrorAction SilentlyContinue)
    Assert-True ($cleanupProfiles.Count -eq 0) 'Simulated cleanup failure broadened cleanup or left a profile directory.'

    Start-Sleep -Milliseconds 500
    $processIdsAfter = Get-DrawioProcessIds
    $newProcessIds = @($processIdsAfter | Where-Object { $_ -notin $processIdsBefore })
    Assert-True ($newProcessIds.Count -eq 0) "Exporter left new Draw.io processes: $($newProcessIds -join ', ')"

    Write-Host "PASS preview=$($preview.Width)x$($preview.Height) embedded=$($embeddedPng.Width)x$($embeddedPng.Height) version=$($result.DrawioVersion)"
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
