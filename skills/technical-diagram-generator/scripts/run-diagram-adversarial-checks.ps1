[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $SkillRoot,
    [string] $RealDiagramPath,
    [string] $DrawioExecutable
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

function Get-RequiredFile {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Description,
        [string] $Extension
    )

    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    if (-not ($item -is [System.IO.FileInfo])) {
        throw "$Description must be a file: $Path"
    }
    if ($Extension -and -not $item.Extension.Equals($Extension, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Description must have a $Extension extension: $Path"
    }
    return $item.FullName
}

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory)] [string] $FilePath,
        [Parameter(Mandatory)] [string[]] $Arguments,
        [switch] $NodeChild
    )

    if ($NodeChild -and -not [string]::IsNullOrWhiteSpace($script:NodePathForChildren)) {
        $quoteLiteral = {
            param([string] $Value)
            return "'" + $Value.Replace("'", "''") + "'"
        }
        $nodeCommand = @(
            "`$env:NODE_PATH = $(& $quoteLiteral $script:NodePathForChildren)",
            "& $(& $quoteLiteral $FilePath) @($((@($Arguments | ForEach-Object { & $quoteLiteral $_ }) -join ', ')))",
            'exit $LASTEXITCODE'
        ) -join "`n"
        $encodedCommand = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($nodeCommand))
        return Invoke-CapturedProcess -FilePath (Join-Path $PSHOME 'powershell.exe') -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encodedCommand)
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = (@($Arguments | ForEach-Object { ConvertTo-WindowsNativeArgument -Argument $_ }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void] $process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]] @($stdoutTask, $stderrTask))
    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout = $stdoutTask.Result
        Stderr = $stderrTask.Result
    }
}

function Get-ErrorCodes {
    param([string] $Text)

    return @([regex]::Matches($Text, '\bE_[A-Z_]+\b') |
        ForEach-Object { $_.Value } |
        Sort-Object -Unique)
}

function Assert-TempRoot {
    param([Parameter(Mandatory)] [string] $Path)

    $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $candidate = [System.IO.Path]::GetFullPath($Path)
    if (-not $temporaryRoot.EndsWith([System.IO.Path]::DirectorySeparatorChar.ToString())) {
        $temporaryRoot += [System.IO.Path]::DirectorySeparatorChar
    }
    $leaf = [System.IO.Path]::GetFileName($candidate)
    if (-not $candidate.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not $leaf.StartsWith('diagram-adversarial-', [System.StringComparison]::Ordinal)) {
        throw "Refusing to remove a non-runner temporary directory: $candidate"
    }
    return $candidate
}

function Test-Artifacts {
    param(
        [Parameter(Mandatory)] [string] $OutputDirectory,
        [Parameter(Mandatory)] [string] $BaseName
    )

    $paths = @(
        (Join-Path $OutputDirectory "$BaseName.png"),
        (Join-Path $OutputDirectory "$BaseName.drawio.png"),
        (Join-Path $OutputDirectory "$BaseName.drawio.svg")
    )
    $missing = @($paths | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) -or (Get-Item -LiteralPath $_).Length -eq 0 })
    if ($missing.Count -gt 0) {
        return "missing or empty artifacts: $($missing -join ', ')"
    }
    return $null
}

function Add-Case {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [string] $Expected,
        [Parameter(Mandatory)] [scriptblock] $Run,
        [Parameter(Mandatory)] [scriptblock] $Pass,
        [string] $Details
    )

    try {
        $result = & $Run
        if ($null -eq $result -or $null -eq $result.PSObject.Properties['ExitCode']) {
            throw 'Runner case did not return a captured process result.'
        }
    }
    catch {
        $result = [pscustomobject]@{
            ExitCode = -1
            Stdout = ''
            Stderr = $_ | Out-String
        }
    }

    $combinedOutput = "$($result.Stdout)$($result.Stderr)"
    $codes = @(Get-ErrorCodes -Text $combinedOutput)
    $passed = $false
    $validation = $null
    try {
        $passed = [bool] (& $Pass $result $codes)
    }
    catch {
        $validation = $_ | Out-String
    }
    $actual = "exit=$($result.ExitCode); codes=$(if ($codes.Count) { $codes -join ',' } else { '-' })"
    if ($Details) {
        $actual += "; $Details"
    }
    if ($validation) {
        $actual += '; validation error'
        $result.Stderr += $validation
        $passed = $false
    }
    $script:Cases += [pscustomobject]@{
        Name = $Name
        Expected = $Expected
        Actual = $actual
        Passed = $passed
        Stdout = $result.Stdout
        Stderr = $result.Stderr
    }
}

$skillItem = Get-Item -LiteralPath $SkillRoot -ErrorAction Stop
if (-not ($skillItem -is [System.IO.DirectoryInfo])) {
    throw "SkillRoot must be a directory: $SkillRoot"
}
$skillRootPath = $skillItem.FullName
$scriptsDirectory = Join-Path $skillRootPath 'scripts'
$testsDirectory = Join-Path $skillRootPath 'tests\drawio'
$linter = Get-RequiredFile -Path (Join-Path $scriptsDirectory 'lint-drawio-layout.py') -Description 'Draw.io linter'
$exporter = Get-RequiredFile -Path (Join-Path $scriptsDirectory 'export-drawio.ps1') -Description 'Draw.io exporter'
$svgLinter = Get-RequiredFile -Path (Join-Path $scriptsDirectory 'lint-svg-text-overlap.cjs') -Description 'SVG text-overlap linter'
$comparator = Get-RequiredFile -Path (Join-Path $scriptsDirectory 'compare-render-parity.cjs') -Description 'Render parity comparator'
$validFixture = Get-RequiredFile -Path (Join-Path $testsDirectory 'valid-formal-flow.drawio') -Description 'Valid Draw.io fixture' -Extension '.drawio'
$linterTest = Get-RequiredFile -Path (Join-Path $testsDirectory 'test_lint_drawio_layout.py') -Description 'Draw.io linter unittest'
$exporterTest = Get-RequiredFile -Path (Join-Path $testsDirectory 'test-export-drawio.ps1') -Description 'Draw.io exporter integration test'
$parityTest = Get-RequiredFile -Path (Join-Path $testsDirectory 'test-compare-render-parity.cjs') -Description 'Render parity regression test'
$realDiagram = $null
if (-not [string]::IsNullOrWhiteSpace($RealDiagramPath)) {
    $realDiagram = Get-RequiredFile -Path $RealDiagramPath -Description 'RealDiagramPath' -Extension '.drawio'
}
if (-not [string]::IsNullOrWhiteSpace($DrawioExecutable)) {
    $DrawioExecutable = Get-RequiredFile -Path $DrawioExecutable -Description 'DrawioExecutable'
}

$pythonCommand = @(Get-Command python -CommandType Application -ErrorAction Stop | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Path) } | Select-Object -First 1)
$nodeCommand = @(Get-Command node -CommandType Application -ErrorAction Stop | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Path) } | Select-Object -First 1)
if ($pythonCommand.Count -ne 1 -or $nodeCommand.Count -ne 1) {
    throw 'Python and Node must each resolve to one application executable.'
}
$python = [string] $pythonCommand[0].Path
$node = [string] $nodeCommand[0].Path
$powershell = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $powershell -PathType Leaf)) {
    throw "PowerShell executable was not found: $powershell"
}

$script:NodePathForChildren = $null
$sharpResolution = Invoke-CapturedProcess -FilePath $node -Arguments @('-e', "require.resolve('sharp')")
if ($sharpResolution.ExitCode -ne 0) {
    $installedNodeModules = 'C:\Users\18355\.codex\skills\technical-diagram-generator\node_modules'
    if (Test-Path -LiteralPath $installedNodeModules -PathType Container) {
        $existingNodePath = [Environment]::GetEnvironmentVariable('NODE_PATH', 'Process')
        $script:NodePathForChildren = if ([string]::IsNullOrWhiteSpace($existingNodePath)) {
            $installedNodeModules
        }
        else {
            "$installedNodeModules$([System.IO.Path]::PathSeparator)$existingNodePath"
        }
    }
}

$orderedInvalidFixtures = @(
    [pscustomobject]@{ Fixture = 'invalid-page-boundary.drawio'; Code = 'E_PAGE_BOUNDS' },
    [pscustomobject]@{ Fixture = 'invalid-parent-boundary.drawio'; Code = 'E_PARENT_BOUNDS' },
    [pscustomobject]@{ Fixture = 'invalid-gap-small.drawio'; Code = 'E_GAP_SMALL' },
    [pscustomobject]@{ Fixture = 'invalid-gap-large.drawio'; Code = 'E_GAP_LARGE' },
    [pscustomobject]@{ Fixture = 'invalid-font-small.drawio'; Code = 'E_FONT_SMALL' },
    [pscustomobject]@{ Fixture = 'invalid-status-order.drawio'; Code = 'E_STATUS_ORDER' },
    [pscustomobject]@{ Fixture = 'invalid-overlap.drawio'; Code = 'E_OVERLAP' },
    [pscustomobject]@{ Fixture = 'invalid-edge-through.drawio'; Code = 'E_EDGE_THROUGH' },
    [pscustomobject]@{ Fixture = 'invalid-canvas-whitespace.drawio'; Code = 'E_CANVAS_WHITESPACE' }
)
foreach ($entry in $orderedInvalidFixtures) {
    [void] (Get-RequiredFile -Path (Join-Path $testsDirectory $entry.Fixture) -Description "Invalid Draw.io fixture $($entry.Fixture)" -Extension '.drawio')
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("diagram-adversarial-" + [guid]::NewGuid().ToString('N'))
$temporaryRoot = Assert-TempRoot -Path $temporaryRoot
New-Item -ItemType Directory -Path $temporaryRoot -ErrorAction Stop | Out-Null
$script:Cases = @()
$keepTemporaryOutput = $false

try {
    Add-Case -Name '1. Python linter unittest' -Expected 'exit 0' -Run {
        Invoke-CapturedProcess -FilePath $python -Arguments @(
            '-m', 'unittest', 'discover',
            '-s', (Split-Path -Parent $linterTest),
            '-p', (Split-Path -Leaf $linterTest),
            '-v'
        )
    } -Pass { param($result, $codes) $result.ExitCode -eq 0 }

    Add-Case -Name '2. Valid fixture strict lint' -Expected 'exit 0; no ERROR/WARNING' -Run {
        Invoke-CapturedProcess -FilePath $python -Arguments @($linter, $validFixture, '--strict')
    } -Pass { param($result, $codes) $result.ExitCode -eq 0 -and "$($result.Stdout)$($result.Stderr)" -notmatch '(?m)^(ERROR|WARNING)\b' }

    foreach ($entry in $orderedInvalidFixtures) {
        $fixturePath = Join-Path $testsDirectory $entry.Fixture
        $expectedCode = $entry.Code
        Add-Case -Name "3. Invalid fixture $($entry.Fixture)" -Expected "non-zero; only $expectedCode" -Run {
            Invoke-CapturedProcess -FilePath $python -Arguments @($linter, $fixturePath, '--strict')
        } -Pass { param($result, $codes) $result.ExitCode -ne 0 -and $codes.Count -eq 1 -and $codes[0] -eq $expectedCode }
    }

    $case4Expected = if ($DrawioExecutable) { 'exit 0; override acknowledged' } else { 'exit 0' }
    $case4Details = if ($DrawioExecutable) { "drawio-executable=$DrawioExecutable" } else { $null }
    Add-Case -Name '4. Exporter PowerShell integration test' -Expected $case4Expected -Run {
        $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $exporterTest)
        if ($DrawioExecutable) { $arguments += @('-DrawioExecutable', $DrawioExecutable) }
        Invoke-CapturedProcess -FilePath $powershell -Arguments $arguments
    } -Pass {
        param($result, $codes)
        if ($result.ExitCode -ne 0) { return $false }
        if ($DrawioExecutable) {
            return $result.Stdout -match [regex]::Escape("DRAWIO_EXECUTABLE=$DrawioExecutable")
        }
        return $true
    } -Details $case4Details

    $validOutputDirectory = Join-Path $temporaryRoot 'valid-fixture'
    $validBaseName = 'valid-formal-flow'
    $validExportResult = $null
    Add-Case -Name '5. Export valid fixture and verify artifacts' -Expected 'exit 0; 3 non-empty artifacts' -Run {
        $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $exporter, '-InputPath', $validFixture, '-OutputDirectory', $validOutputDirectory, '-BaseName', $validBaseName)
        if ($DrawioExecutable) { $arguments += @('-DrawioExecutable', $DrawioExecutable) }
        $validExportResult = Invoke-CapturedProcess -FilePath $powershell -Arguments $arguments
        return $validExportResult
    } -Pass {
        param($result, $codes)
        $artifactError = Test-Artifacts -OutputDirectory $validOutputDirectory -BaseName $validBaseName
        if ($artifactError) { throw $artifactError }
        return $result.ExitCode -eq 0
    } -Details 'artifacts=preview,embedded-png,embedded-svg'

    $validSvg = Join-Path $validOutputDirectory "$validBaseName.drawio.svg"
    $validPng = Join-Path $validOutputDirectory "$validBaseName.drawio.png"
    Add-Case -Name '6. SVG text-overlap lint on exported SVG' -Expected 'exit 0' -Run {
        Invoke-CapturedProcess -FilePath $node -Arguments @($svgLinter, $validSvg) -NodeChild
    } -Pass { param($result, $codes) $result.ExitCode -eq 0 }

    Add-Case -Name '7. Parity Node regression test' -Expected 'exit 0' -Run {
        Invoke-CapturedProcess -FilePath $node -Arguments @($parityTest) -NodeChild
    } -Pass { param($result, $codes) $result.ExitCode -eq 0 }

    $validParityReport = Join-Path $validOutputDirectory 'valid-formal-flow.parity.json'
    Add-Case -Name '8. Direct comparator on runner export' -Expected 'exit 0; JSON report' -Run {
        Invoke-CapturedProcess -FilePath $node -Arguments @($comparator, $validSvg, $validPng, '--json', $validParityReport) -NodeChild
    } -Pass {
        param($result, $codes)
        if (-not (Test-Path -LiteralPath $validParityReport -PathType Leaf) -or (Get-Item -LiteralPath $validParityReport).Length -eq 0) {
            throw "missing parity JSON report: $validParityReport"
        }
        return $result.ExitCode -eq 0
    } -Details 'report=valid-formal-flow.parity.json'

    if ($realDiagram) {
        $realContent = [System.IO.File]::ReadAllText($realDiagram)
        $realRoleMetadata = $realContent -match '(?i)(data-role\s*=|(?:^|[;\s])role\s*=)'
        $roleBoundary = if ($realRoleMetadata) {
            'role-metadata=present'
        }
        else {
            'role-metadata=absent; strict lint cannot apply role-specific font/status/group rules'
        }

        Add-Case -Name '9a. Real diagram strict lint' -Expected 'exit 0' -Run {
            Invoke-CapturedProcess -FilePath $python -Arguments @($linter, $realDiagram, '--strict')
        } -Pass { param($result, $codes) $result.ExitCode -eq 0 } -Details $roleBoundary

        $realOutputDirectory = Join-Path $temporaryRoot 'real-diagram'
        $realBaseName = 'real-diagram'
        Add-Case -Name '9b. Export real diagram and verify artifacts' -Expected 'exit 0; 3 non-empty artifacts' -Run {
            $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $exporter, '-InputPath', $realDiagram, '-OutputDirectory', $realOutputDirectory, '-BaseName', $realBaseName)
            if ($DrawioExecutable) { $arguments += @('-DrawioExecutable', $DrawioExecutable) }
            Invoke-CapturedProcess -FilePath $powershell -Arguments $arguments
        } -Pass {
            param($result, $codes)
            $artifactError = Test-Artifacts -OutputDirectory $realOutputDirectory -BaseName $realBaseName
            if ($artifactError) { throw $artifactError }
            return $result.ExitCode -eq 0
        } -Details 'artifacts=preview,embedded-png,embedded-svg'

        $realSvg = Join-Path $realOutputDirectory "$realBaseName.drawio.svg"
        $realPng = Join-Path $realOutputDirectory "$realBaseName.drawio.png"
        Add-Case -Name '9c. SVG text-overlap lint on real SVG' -Expected 'exit 0' -Run {
            Invoke-CapturedProcess -FilePath $node -Arguments @($svgLinter, $realSvg) -NodeChild
        } -Pass { param($result, $codes) $result.ExitCode -eq 0 }

        $realParityReport = Join-Path $realOutputDirectory 'real-diagram.parity.json'
        Add-Case -Name '9d. Direct comparator on real export' -Expected 'exit 0; JSON report' -Run {
            Invoke-CapturedProcess -FilePath $node -Arguments @($comparator, $realSvg, $realPng, '--json', $realParityReport) -NodeChild
        } -Pass {
            param($result, $codes)
            if (-not (Test-Path -LiteralPath $realParityReport -PathType Leaf) -or (Get-Item -LiteralPath $realParityReport).Length -eq 0) {
                throw "missing parity JSON report: $realParityReport"
            }
            return $result.ExitCode -eq 0
        } -Details 'report=real-diagram.parity.json'
    }

    $nameWidth = [Math]::Max(4, (@($script:Cases | ForEach-Object { $_.Name.Length } | Measure-Object -Maximum).Maximum))
    $expectedWidth = [Math]::Max(8, (@($script:Cases | ForEach-Object { $_.Expected.Length } | Measure-Object -Maximum).Maximum))
    $rowFormat = "{0,-$nameWidth}  {1,-$expectedWidth}  {2,-32}  {3}"
    Write-Output ($rowFormat -f 'CASE', 'EXPECTED', 'ACTUAL', 'RESULT')
    Write-Output ('-' * ($nameWidth + $expectedWidth + 46))
    foreach ($case in $script:Cases) {
        Write-Output ($rowFormat -f $case.Name, $case.Expected, $case.Actual, $(if ($case.Passed) { 'PASS' } else { 'FAIL' }))
    }

    $passedCount = @($script:Cases | Where-Object { $_.Passed }).Count
    $failedCases = @($script:Cases | Where-Object { -not $_.Passed })
    Write-Output "SUMMARY pass=$passedCount/$($script:Cases.Count)"
    if ($failedCases.Count -gt 0) {
        $keepTemporaryOutput = $true
        foreach ($case in $failedCases) {
            Write-Output "`nFAILED CASE: $($case.Name)"
            if ($case.Stdout) { Write-Output 'stdout:'; Write-Output $case.Stdout }
            if ($case.Stderr) { Write-Output 'stderr:'; Write-Output $case.Stderr }
        }
        Write-Output "Temporary output retained for diagnosis: $temporaryRoot"
        exit 1
    }

    Write-Output 'Temporary output cleaned after successful suite.'
}
finally {
    if (-not $keepTemporaryOutput -and (Test-Path -LiteralPath $temporaryRoot -PathType Container)) {
        Remove-Item -LiteralPath (Assert-TempRoot -Path $temporaryRoot) -Recurse -Force -ErrorAction Stop
    }
}
