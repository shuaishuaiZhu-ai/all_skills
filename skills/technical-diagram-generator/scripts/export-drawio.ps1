[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $InputPath,
    [string] $OutputDirectory,
    [string] $DrawioExecutable,
    [string] $BaseName,
    [switch] $SimulateProfileCleanupFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-DrawioExecutable {
    param([string] $RequestedExecutable)

    if (-not [string]::IsNullOrWhiteSpace($RequestedExecutable)) {
        $item = Get-Item -LiteralPath $RequestedExecutable -ErrorAction Stop
        if (-not ($item -is [System.IO.FileInfo])) {
            throw "Draw.io executable must be a file: $RequestedExecutable"
        }
        return $item.FullName
    }

    $installedExecutable = 'C:\Program Files\draw.io\draw.io.exe'
    if (Test-Path -LiteralPath $installedExecutable -PathType Leaf) {
        return (Get-Item -LiteralPath $installedExecutable).FullName
    }

    foreach ($commandName in @('drawio', 'draw.io')) {
        $command = Get-Command -Name $commandName -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $command -and -not [string]::IsNullOrWhiteSpace($command.Path)) {
            return (Get-Item -LiteralPath $command.Path -ErrorAction Stop).FullName
        }
    }

    throw 'Draw.io executable was not found. Specify -DrawioExecutable or install draw.io.'
}

function Assert-OutputChildPath {
    param(
        [Parameter(Mandatory)] [string] $OutputDirectoryPath,
        [Parameter(Mandatory)] [string] $CandidatePath
    )

    $normalizedOutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectoryPath)
    $separator = [System.IO.Path]::DirectorySeparatorChar.ToString()
    if (-not $normalizedOutputDirectory.EndsWith($separator)) {
        $normalizedOutputDirectory += $separator
    }

    $normalizedCandidate = [System.IO.Path]::GetFullPath($CandidatePath)
    if (-not $normalizedCandidate.StartsWith($normalizedOutputDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Output path escapes the output directory: $normalizedCandidate"
    }
    return $normalizedCandidate
}

function Get-ValidatedBaseName {
    param(
        [AllowEmptyString()] [string] $RequestedBaseName,
        [Parameter(Mandatory)] [string] $InputFileName
    )

    $candidate = if ([string]::IsNullOrWhiteSpace($RequestedBaseName)) {
        [System.IO.Path]::GetFileNameWithoutExtension($InputFileName)
    }
    else {
        $RequestedBaseName
    }

    $invalidCharacters = [System.IO.Path]::GetInvalidFileNameChars() + [char]'/' + [char]'\'
    if ($candidate -in @('.', '..') -or $candidate.EndsWith('.') -or $candidate.EndsWith(' ') -or
        $candidate.IndexOfAny($invalidCharacters) -ge 0) {
        throw "BaseName must be a single valid file name: $candidate"
    }
    return $candidate
}

function ConvertTo-WindowsNativeArgument {
    param([Parameter(Mandatory)] [string] $Argument)

    if ($Argument.Length -eq 0) {
        return '""'
    }
    if ($Argument -notmatch '[\s"]') {
        return $Argument
    }

    $builder = New-Object System.Text.StringBuilder
    [void] $builder.Append('"')
    $backslashCount = 0
    foreach ($character in $Argument.ToCharArray()) {
        if ($character -eq [char]'\') {
            $backslashCount++
            continue
        }

        if ($character -eq [char]'"') {
            for ($index = 0; $index -lt (($backslashCount * 2) + 1); $index++) {
                [void] $builder.Append('\')
            }
            [void] $builder.Append('"')
            $backslashCount = 0
            continue
        }

        for ($index = 0; $index -lt $backslashCount; $index++) {
            [void] $builder.Append('\')
        }
        [void] $builder.Append($character)
        $backslashCount = 0
    }

    for ($index = 0; $index -lt ($backslashCount * 2); $index++) {
        [void] $builder.Append('\')
    }
    [void] $builder.Append('"')
    return $builder.ToString()
}

function Get-OutputSnapshot {
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

function Remove-ExporterProfile {
    param(
        [Parameter(Mandatory)] [string] $ProfilePath,
        [switch] $SimulateFailure
    )

    Remove-Item -LiteralPath $ProfilePath -Recurse -Force -ErrorAction Stop
    if ($SimulateFailure) {
        throw 'Simulated profile cleanup failure.'
    }
}

function Invoke-DrawioExport {
    param(
        [Parameter(Mandatory)] [string] $Executable,
        [Parameter(Mandatory)] [string[]] $Arguments,
        [Parameter(Mandatory)] [string] $OutputPath,
        [Parameter(Mandatory)] [string] $JobName
    )

    $before = Get-OutputSnapshot -Path $OutputPath
    $invocationStartedUtc = [datetime]::UtcNow
    $quotedArguments = @($Arguments | ForEach-Object { ConvertTo-WindowsNativeArgument -Argument $_ })
    $process = Start-Process -FilePath $Executable -ArgumentList $quotedArguments -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0) {
        throw "Draw.io $JobName export failed with exit code $($process.ExitCode)."
    }
    if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf) -or (Get-Item -LiteralPath $OutputPath).Length -eq 0) {
        throw "Draw.io $JobName export exited successfully but did not produce a non-empty output: $OutputPath"
    }

    $after = Get-OutputSnapshot -Path $OutputPath
    if ($before.Exists) {
        $wasRefreshed = $before.Length -ne $after.Length -or $before.LastWriteTicks -ne $after.LastWriteTicks -or $before.Hash -ne $after.Hash
        if (-not $wasRefreshed) {
            throw "Draw.io $JobName export exited successfully but output is stale: $OutputPath"
        }
    }
    elseif ((Get-Item -LiteralPath $OutputPath).LastWriteTimeUtc -lt $invocationStartedUtc.AddSeconds(-2)) {
        throw "Draw.io $JobName export produced an output older than its invocation: $OutputPath"
    }
}

$inputItem = Get-Item -LiteralPath $InputPath -ErrorAction Stop
if (-not ($inputItem -is [System.IO.FileInfo])) {
    throw "InputPath must be a file: $InputPath"
}
if (-not $inputItem.Extension.Equals('.drawio', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "InputPath must have a .drawio extension: $InputPath"
}

$resolvedOutputDirectory = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $inputItem.Directory.FullName
}
else {
    [System.IO.Path]::GetFullPath($OutputDirectory)
}
if (Test-Path -LiteralPath $resolvedOutputDirectory -PathType Leaf) {
    throw "OutputDirectory must be a directory: $resolvedOutputDirectory"
}
if (-not (Test-Path -LiteralPath $resolvedOutputDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $resolvedOutputDirectory -Force | Out-Null
}
$resolvedOutputDirectory = (Get-Item -LiteralPath $resolvedOutputDirectory).FullName

$resolvedBaseName = Get-ValidatedBaseName -RequestedBaseName $BaseName -InputFileName $inputItem.Name
$resolvedExecutable = Resolve-DrawioExecutable -RequestedExecutable $DrawioExecutable
$previewPath = Assert-OutputChildPath -OutputDirectoryPath $resolvedOutputDirectory -CandidatePath (Join-Path $resolvedOutputDirectory "$resolvedBaseName.png")
$embeddedPngPath = Assert-OutputChildPath -OutputDirectoryPath $resolvedOutputDirectory -CandidatePath (Join-Path $resolvedOutputDirectory "$resolvedBaseName.drawio.png")
$embeddedSvgPath = Assert-OutputChildPath -OutputDirectoryPath $resolvedOutputDirectory -CandidatePath (Join-Path $resolvedOutputDirectory "$resolvedBaseName.drawio.svg")
$profilePath = Assert-OutputChildPath -OutputDirectoryPath $resolvedOutputDirectory -CandidatePath (Join-Path $resolvedOutputDirectory ('.export-drawio-profile-' + [guid]::NewGuid().ToString('N')))
$profileCreated = $false

$commonArguments = @(
    '--disable-gpu',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--disable-update',
    "--user-data-dir=$profilePath",
    '-b',
    '0'
)
$previewArguments = @($commonArguments + @('-x', '-f', 'png', '--width', '3000', '-o', $previewPath, $inputItem.FullName))
$embeddedPngArguments = @($commonArguments + @('-x', '-f', 'png', '-e', '-s', '2', '-o', $embeddedPngPath, $inputItem.FullName))
$embeddedSvgArguments = @($commonArguments + @('-x', '-f', 'svg', '-e', '-o', $embeddedSvgPath, $inputItem.FullName))
$bodyError = $null
$cleanupError = $null
$result = $null

try {
    New-Item -ItemType Directory -Path $profilePath -ErrorAction Stop | Out-Null
    $profileCreated = $true

    Invoke-DrawioExport -Executable $resolvedExecutable -Arguments $previewArguments -OutputPath $previewPath -JobName 'preview PNG'
    Invoke-DrawioExport -Executable $resolvedExecutable -Arguments $embeddedPngArguments -OutputPath $embeddedPngPath -JobName 'embedded PNG'
    Invoke-DrawioExport -Executable $resolvedExecutable -Arguments $embeddedSvgArguments -OutputPath $embeddedSvgPath -JobName 'embedded SVG'

    $version = (Get-Item -LiteralPath $resolvedExecutable).VersionInfo.ProductVersion
    if ([string]::IsNullOrWhiteSpace($version)) {
        $version = (Get-Item -LiteralPath $resolvedExecutable).VersionInfo.FileVersion
    }
    $result = [pscustomobject]@{
        DrawioVersion = $version
        PreviewPath = $previewPath
        EmbeddedPngPath = $embeddedPngPath
        EmbeddedSvgPath = $embeddedSvgPath
        PreviewArguments = $previewArguments
        EmbeddedPngArguments = $embeddedPngArguments
        EmbeddedSvgArguments = $embeddedSvgArguments
    }
}
catch {
    $bodyError = $_
}
finally {
    if ($profileCreated -and (Test-Path -LiteralPath $profilePath -PathType Container)) {
        try {
            Remove-ExporterProfile -ProfilePath $profilePath -SimulateFailure:$SimulateProfileCleanupFailure
        }
        catch {
            $cleanupError = $_
        }
    }
}

if ($null -ne $bodyError) {
    if ($null -ne $cleanupError) {
        $combinedException = New-Object System.Exception(
            "$($bodyError.Exception.Message)`nProfile cleanup also failed: $($cleanupError.Exception.Message)",
            $bodyError.Exception
        )
        $bodyError = New-Object System.Management.Automation.ErrorRecord(
            $combinedException,
            $bodyError.FullyQualifiedErrorId,
            $bodyError.CategoryInfo.Category,
            $bodyError.TargetObject
        )
    }
    throw $bodyError
}
if ($null -ne $cleanupError) {
    throw $cleanupError
}

return $result
