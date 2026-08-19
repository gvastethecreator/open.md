#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $InstallerPath,

    [Parameter()]
    [string] $EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'Installer lifecycle validation must run on Windows.'
}

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
if (-not $EvidencePath) {
    $EvidencePath = Join-Path (Split-Path -Parent $installer) 'lifecycle-evidence.json'
}
elseif (-not [System.IO.Path]::IsPathRooted($EvidencePath)) {
    $EvidencePath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $EvidencePath))
}

$steps = [System.Collections.Generic.List[object]]::new()
$samplePath = Join-Path $env:TEMP "openmd-store-lifecycle-$([Guid]::NewGuid().ToString('N')).md"
$sampleContent = "# open.md lifecycle`r`n`r`nSynthetic Store qualification document.`r`n"
$launchedProcess = $null

function Add-Step {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [bool] $Passed,
        [Parameter(Mandatory)] [string] $Details
    )

    $steps.Add([ordered]@{
        name = $Name
        passed = $Passed
        details = $Details
    })

    if (-not $Passed) {
        throw "$Name failed: $Details"
    }
}

function Get-UninstallEntry {
    $roots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )

    foreach ($root in $roots) {
        $matches = @(Get-ItemProperty $root -ErrorAction SilentlyContinue | Where-Object {
            ([string] $_.DisplayName -eq 'open.md') -or
            ([string] $_.DisplayName -like 'open.md*')
        })
        if ($matches.Count -gt 0) {
            return $matches | Sort-Object InstallDate -Descending | Select-Object -First 1
        }
    }
    return $null
}

function Resolve-Uninstaller {
    param([Parameter(Mandatory)] $Entry)

    $command = [string] $Entry.QuietUninstallString
    if ([string]::IsNullOrWhiteSpace($command)) {
        $command = [string] $Entry.UninstallString
    }
    if ([string]::IsNullOrWhiteSpace($command)) {
        return $null
    }

    if ($command -match '^\s*"(?<path>[^"]+)"') {
        return $Matches['path']
    }
    if ($command -match '^\s*(?<path>\S+\.exe)') {
        return $Matches['path']
    }
    return $null
}

try {
    $installerSignature = Get-AuthenticodeSignature -LiteralPath $installer
    Add-Step `
        -Name 'Installer signature' `
        -Passed ($installerSignature.Status -eq [System.Management.Automation.SignatureStatus]::Valid) `
        -Details "status=$($installerSignature.Status), signer=$($installerSignature.SignerCertificate.Subject)"

    Set-Content -LiteralPath $samplePath -Value $sampleContent -Encoding utf8
    $beforeHash = (Get-FileHash -LiteralPath $samplePath -Algorithm SHA256).Hash

    $install = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
    Add-Step -Name 'Silent install exit code' -Passed ($install.ExitCode -eq 0) -Details "exit=$($install.ExitCode)"

    Start-Sleep -Seconds 2
    $entry = Get-UninstallEntry
    Add-Step -Name 'Uninstall registration' -Passed ($null -ne $entry) -Details "display=$($entry.DisplayName)"

    $installLocation = [string] $entry.InstallLocation
    if ([string]::IsNullOrWhiteSpace($installLocation) -or -not (Test-Path -LiteralPath $installLocation -PathType Container)) {
        $uninstallerCandidate = Resolve-Uninstaller -Entry $entry
        if ($uninstallerCandidate) {
            $installLocation = Split-Path -Parent $uninstallerCandidate
        }
    }
    Add-Step -Name 'Install location' -Passed (-not [string]::IsNullOrWhiteSpace($installLocation) -and (Test-Path -LiteralPath $installLocation -PathType Container)) -Details "path=$installLocation"

    $appExecutable = Get-ChildItem -LiteralPath $installLocation -Filter 'open-md.exe' -File -Recurse |
        Select-Object -First 1
    Add-Step -Name 'Installed application executable' -Passed ($null -ne $appExecutable) -Details "path=$($appExecutable.FullName)"

    $peFiles = @(Get-ChildItem -LiteralPath $installLocation -File -Recurse | Where-Object {
        $_.Extension -in @('.exe', '.dll')
    })
    $invalidPe = @()
    foreach ($pe in $peFiles) {
        $signature = Get-AuthenticodeSignature -LiteralPath $pe.FullName
        if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
            $invalidPe += "$($pe.FullName) [$($signature.Status)]"
        }
    }
    Add-Step -Name 'Installed PE signatures' -Passed ($invalidPe.Count -eq 0) -Details $(if ($invalidPe.Count -eq 0) { "$($peFiles.Count) PE files valid" } else { $invalidPe -join '; ' })

    $launchedProcess = Start-Process -FilePath $appExecutable.FullName -ArgumentList ('"{0}"' -f $samplePath) -PassThru
    Start-Sleep -Seconds 5
    $running = -not $launchedProcess.HasExited
    Add-Step -Name 'Launch with Markdown path' -Passed $running -Details "pid=$($launchedProcess.Id)"
    if ($running) {
        Stop-Process -Id $launchedProcess.Id -Force -ErrorAction SilentlyContinue
        $launchedProcess.WaitForExit()
    }

    $afterLaunchHash = (Get-FileHash -LiteralPath $samplePath -Algorithm SHA256).Hash
    Add-Step -Name 'Opening did not modify document' -Passed ($beforeHash -eq $afterLaunchHash) -Details "before=$beforeHash after=$afterLaunchHash"

    $associationKeys = @(
        'Registry::HKEY_CLASSES_ROOT\.md\OpenWithProgids',
        'HKCU:\Software\Classes\.md\OpenWithProgids'
    )
    $associationFound = $false
    foreach ($key in $associationKeys) {
        if (Test-Path -LiteralPath $key) {
            $associationFound = $true
        }
    }
    $steps.Add([ordered]@{
        name = 'Markdown association registration'
        passed = $associationFound
        details = if ($associationFound) { 'OpenWith registration detected' } else { 'Not detected; inspect installer logs and Windows association policy' }
    })

    $uninstaller = Resolve-Uninstaller -Entry $entry
    Add-Step -Name 'Uninstaller path' -Passed ($uninstaller -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) -Details "path=$uninstaller"

    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
    Add-Step -Name 'Silent uninstall exit code' -Passed ($uninstall.ExitCode -eq 0) -Details "exit=$($uninstall.ExitCode)"
    Start-Sleep -Seconds 2

    Add-Step -Name 'Application files removed' -Passed (-not (Test-Path -LiteralPath $appExecutable.FullName -PathType Leaf)) -Details "path=$($appExecutable.FullName)"
    Add-Step -Name 'User document preserved' -Passed (Test-Path -LiteralPath $samplePath -PathType Leaf) -Details "path=$samplePath"
    $afterUninstallHash = (Get-FileHash -LiteralPath $samplePath -Algorithm SHA256).Hash
    Add-Step -Name 'User document unchanged after uninstall' -Passed ($beforeHash -eq $afterUninstallHash) -Details "before=$beforeHash after=$afterUninstallHash"

    $result = [ordered]@{
        schema = 'openmd.store-lifecycle.v1'
        generatedAt = [DateTimeOffset]::UtcNow.ToString('O')
        installer = $installer
        installerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
        passed = $true
        steps = $steps
    }

    $directory = Split-Path -Parent $EvidencePath
    if ($directory) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $EvidencePath -Encoding utf8

    Write-Host ''
    Write-Host 'STORE INSTALLER LIFECYCLE PASSED' -ForegroundColor Green
    Write-Host "Evidence: $EvidencePath"
}
catch {
    $result = [ordered]@{
        schema = 'openmd.store-lifecycle.v1'
        generatedAt = [DateTimeOffset]::UtcNow.ToString('O')
        installer = $installer
        passed = $false
        error = $_.Exception.Message
        steps = $steps
    }
    $directory = Split-Path -Parent $EvidencePath
    if ($directory) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $EvidencePath -Encoding utf8
    throw
}
finally {
    if ($launchedProcess -and -not $launchedProcess.HasExited) {
        Stop-Process -Id $launchedProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $samplePath -Force -ErrorAction SilentlyContinue
}
