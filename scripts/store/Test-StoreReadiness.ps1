#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter()]
    [switch] $RequireSubmissionReady,

    [Parameter()]
    [string] $EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))

$paths = [ordered]@{
    PackageJson = Join-Path $repoRoot 'package.json'
    CargoToml = Join-Path $repoRoot 'src-tauri\Cargo.toml'
    TauriConfig = Join-Path $repoRoot 'src-tauri\tauri.conf.json'
    StoreConfig = Join-Path $repoRoot 'src-tauri\tauri.microsoftstore.conf.json'
    Capabilities = Join-Path $repoRoot 'src-tauri\capabilities\default.json'
    AppLib = Join-Path $repoRoot 'src-tauri\src\lib.rs'
    FileAssociations = Join-Path $repoRoot 'src-tauri\src\file_associations.rs'
    Product = Join-Path $repoRoot 'docs\store\store-product.json'
    Privacy = Join-Path $repoRoot 'PRIVACY.md'
    PrivacyPage = Join-Path $repoRoot 'docs\privacy.html'
    StoreRunbook = Join-Path $repoRoot 'docs\store\README.md'
    Listing = Join-Path $repoRoot 'docs\store\LISTING.md'
    Certification = Join-Path $repoRoot 'docs\store\CERTIFICATION-NOTES.md'
    Hosting = Join-Path $repoRoot 'docs\store\HOSTING.md'
    Updates = Join-Path $repoRoot 'docs\store\UPDATE-STRATEGY.md'
    EvidenceTemplate = Join-Path $repoRoot 'docs\store\RELEASE-EVIDENCE-TEMPLATE.md'
    Adr = Join-Path $repoRoot 'docs\adr\0002-microsoft-store-exe-submission.md'
    Builder = Join-Path $repoRoot 'scripts\store\Build-StoreInstaller.ps1'
    Lifecycle = Join-Path $repoRoot 'scripts\store\Test-StoreInstallerLifecycle.ps1'
    SetProduct = Join-Path $repoRoot 'scripts\store\Set-StoreProduct.ps1'
    GitIgnore = Join-Path $repoRoot '.gitignore'
    Readme = Join-Path $repoRoot 'README.md'
}

$checks = [System.Collections.Generic.List[object]]::new()
$errors = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Get-RelativePath {
    param([Parameter(Mandatory)] [string] $Path)

    $root = $repoRoot.TrimEnd('\') + '\'
    $full = [System.IO.Path]::GetFullPath($Path)
    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        return $full.Substring($root.Length)
    }
    return $full
}

function Add-Check {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [bool] $Passed,
        [Parameter(Mandatory)] [string] $Details
    )

    $checks.Add([ordered]@{
        name = $Name
        passed = $Passed
        details = $Details
    })
    if (-not $Passed) {
        $errors.Add("$Name`: $Details")
    }
}

function Add-Warning {
    param([Parameter(Mandatory)] [string] $Message)
    $warnings.Add($Message)
}

function Get-TomlPackageVersion {
    param([Parameter(Mandatory)] [string] $Text)

    $packageMatch = [regex]::Match(
        $Text,
        '(?ms)^\[package\]\s*(?<body>.*?)(?=^\[|\z)'
    )
    if (-not $packageMatch.Success) {
        return $null
    }
    $versionMatch = [regex]::Match(
        $packageMatch.Groups['body'].Value,
        '(?m)^\s*version\s*=\s*"(?<version>[^"]+)"\s*$'
    )
    if ($versionMatch.Success) {
        return $versionMatch.Groups['version'].Value
    }
    return $null
}

foreach ($entry in $paths.GetEnumerator()) {
    Add-Check `
        -Name "Required file: $(Get-RelativePath -Path $entry.Value)" `
        -Passed (Test-Path -LiteralPath $entry.Value -PathType Leaf) `
        -Details 'file must exist'
}

if ($errors.Count -gt 0) {
    throw "Store readiness prerequisites are missing:`n - $($errors -join "`n - ")"
}

$package = Get-Content -LiteralPath $paths.PackageJson -Raw | ConvertFrom-Json
$cargoText = Get-Content -LiteralPath $paths.CargoToml -Raw
$tauri = Get-Content -LiteralPath $paths.TauriConfig -Raw | ConvertFrom-Json
$store = Get-Content -LiteralPath $paths.StoreConfig -Raw | ConvertFrom-Json
$product = Get-Content -LiteralPath $paths.Product -Raw | ConvertFrom-Json
$capabilitiesText = Get-Content -LiteralPath $paths.Capabilities -Raw
$appLibText = Get-Content -LiteralPath $paths.AppLib -Raw
$associationText = Get-Content -LiteralPath $paths.FileAssociations -Raw
$gitIgnoreText = Get-Content -LiteralPath $paths.GitIgnore -Raw
$readmeText = Get-Content -LiteralPath $paths.Readme -Raw
$builderText = Get-Content -LiteralPath $paths.Builder -Raw

$cargoVersion = Get-TomlPackageVersion -Text $cargoText
$packageVersion = [string] $package.version
$tauriVersion = [string] $tauri.version

Add-Check -Name 'Package name' -Passed ([string] $package.name -eq 'open-md') -Details "actual: $($package.name)"
Add-Check -Name 'Product name' -Passed ([string] $tauri.productName -eq 'open.md') -Details "actual: $($tauri.productName)"
Add-Check -Name 'Stable Tauri identifier' -Passed ([string] $tauri.identifier -eq 'com.gvastethecreator.openmd') -Details "actual: $($tauri.identifier)"
Add-Check -Name 'Version agreement: package.json and Cargo.toml' -Passed ($packageVersion -eq $cargoVersion) -Details "package.json=$packageVersion Cargo.toml=$cargoVersion"
Add-Check -Name 'Version agreement: package.json and Tauri' -Passed ($packageVersion -eq $tauriVersion) -Details "package.json=$packageVersion tauri=$tauriVersion"

$targets = @($store.bundle.targets)
Add-Check -Name 'Store bundle target is NSIS only' -Passed ($targets.Count -eq 1 -and [string] $targets[0] -eq 'nsis') -Details "targets: $($targets -join ', ')"
Add-Check -Name 'Store publisher is explicit' -Passed (-not [string]::IsNullOrWhiteSpace([string] $store.bundle.publisher)) -Details "publisher: $($store.bundle.publisher)"
Add-Check -Name 'Publisher differs from product name' -Passed (-not [string]::Equals([string] $store.bundle.publisher, [string] $tauri.productName, [StringComparison]::OrdinalIgnoreCase)) -Details "publisher=$($store.bundle.publisher), product=$($tauri.productName)"
Add-Check -Name 'Store bundle blocks downgrades' -Passed (-not [bool] $store.bundle.windows.allowDowngrades) -Details "allowDowngrades=$($store.bundle.windows.allowDowngrades)"
Add-Check -Name 'Store install scope is current user' -Passed ([string] $store.bundle.windows.nsis.installMode -eq 'currentUser') -Details "actual: $($store.bundle.windows.nsis.installMode)"
Add-Check -Name 'Store WebView2 payload is offline' -Passed ([string] $store.bundle.windows.webviewInstallMode.type -eq 'offlineInstaller') -Details "actual: $($store.bundle.windows.webviewInstallMode.type)"

$associations = @($tauri.bundle.fileAssociations)
$extensions = @()
foreach ($association in $associations) {
    $extensions += @($association.ext | ForEach-Object { ([string] $_).ToLowerInvariant() })
    Add-Check -Name "File association role: $($association.name)" -Passed ([string] $association.role -eq 'Viewer') -Details "actual: $($association.role)"
}
$extensions = @($extensions | Sort-Object -Unique)
$expectedExtensions = @('markdown', 'md', 'txt')
Add-Check -Name 'Registered file associations' -Passed (($extensions -join ',') -eq ($expectedExtensions -join ',')) -Details "actual: $($extensions -join ', ')"

$csp = [string] $tauri.app.security.csp
Add-Check -Name 'CSP blocks arbitrary HTTPS connections' -Passed ($csp.IndexOf('https:', [StringComparison]::OrdinalIgnoreCase) -lt 0 -and $csp.IndexOf('wss:', [StringComparison]::OrdinalIgnoreCase) -lt 0) -Details $csp
Add-Check -Name 'Capability set is desktop-local' -Passed ($capabilitiesText.IndexOf('http:', [StringComparison]::OrdinalIgnoreCase) -lt 0 -and $capabilitiesText.IndexOf('shell:allow-execute', [StringComparison]::OrdinalIgnoreCase) -lt 0) -Details 'capability file must not grant arbitrary network or process execution'

Add-Check -Name 'Store submission type' -Passed ([string] $product.submissionType -eq 'exe') -Details "actual: $($product.submissionType)"
Add-Check -Name 'Store installer technology' -Passed ([string] $product.package.technology -eq 'Tauri v2 / NSIS') -Details "actual: $($product.package.technology)"
Add-Check -Name 'Store architecture' -Passed ([string] $product.package.architecture -eq 'x64') -Details "actual: $($product.package.architecture)"
Add-Check -Name 'Store installer type' -Passed ([string] $product.package.installerType -eq 'exe') -Details "actual: $($product.package.installerType)"
Add-Check -Name 'Silent install parameter' -Passed ([string] $product.package.silentInstallParameter -ceq '/S') -Details "actual: $($product.package.silentInstallParameter)"
Add-Check -Name 'Store package language' -Passed ([string] $product.package.language -eq 'en-US') -Details "actual: $($product.package.language)"
Add-Check -Name 'Store package is offline' -Passed ([bool] $product.package.offline) -Details "actual: $($product.package.offline)"
Add-Check -Name 'Store updates are application-managed' -Passed (-not [bool] $product.updates.storeManaged) -Details 'EXE submission must not claim Store-managed application updates'
Add-Check -Name 'Planned first Store version is valid' -Passed ([string] $product.firstStoreVersion -match '^\d+\.\d+\.\d+(?:\.\d+)?$') -Details "metadata=$($product.firstStoreVersion)"
if ([string] $product.reservationStatus -eq 'pending' -and [string] $product.firstStoreVersion -ne $packageVersion) {
    Add-Warning "The planned first Store version '$($product.firstStoreVersion)' differs from the current project version '$packageVersion'. Review before reservation."
}

foreach ($requiredPattern in @('/artifacts/', '*.pfx', '*.p12', '*.pvk', '*.cer')) {
    Add-Check -Name "Ignored sensitive/generated pattern: $requiredPattern" -Passed ($gitIgnoreText.IndexOf($requiredPattern, [StringComparison]::OrdinalIgnoreCase) -ge 0) -Details 'pattern must be present in .gitignore'
}

Add-Check -Name 'README links Store runbook' -Passed ($readmeText.IndexOf('docs/store/README.md', [StringComparison]::OrdinalIgnoreCase) -ge 0) -Details 'root README must expose Store status'
Add-Check -Name 'README links privacy policy' -Passed ($readmeText.IndexOf('PRIVACY.md', [StringComparison]::OrdinalIgnoreCase) -ge 0) -Details 'root README must expose privacy policy'
Add-Check -Name 'Builder requires Authenticode input' -Passed ($builderText.IndexOf('OPENMD_WINDOWS_CERTIFICATE_PATH', [StringComparison]::Ordinal) -ge 0 -and $builderText.IndexOf('Import-PfxCertificate', [StringComparison]::OrdinalIgnoreCase) -ge 0) -Details 'builder must import an explicit protected code-signing identity'
Add-Check -Name 'Builder delegates signing to Tauri' -Passed ($builderText.IndexOf('certificateThumbprint', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $builderText.IndexOf('digestAlgorithm', [StringComparison]::OrdinalIgnoreCase) -ge 0) -Details 'Tauri must sign application and NSIS payloads during bundling'
Add-Check -Name 'Builder uses RFC 3161 timestamping' -Passed ($builderText.IndexOf('timestampUrl', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $builderText.IndexOf('-Name ''tsp'' -Value $true', [StringComparison]::OrdinalIgnoreCase) -ge 0) -Details 'runtime Tauri config must enable TSP/RFC 3161'
Add-Check -Name 'Builder verifies signatures' -Passed ($builderText.IndexOf('signtool.exe', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $builderText.IndexOf('verify /pa /all /v', [StringComparison]::OrdinalIgnoreCase) -ge 0) -Details 'built application and installer must be verified'
Add-Check -Name 'Builder uses no-bundle then bundle' -Passed ($builderText.IndexOf('--no-bundle', [StringComparison]::Ordinal) -ge 0 -and $builderText.IndexOf('tauri bundle', [StringComparison]::OrdinalIgnoreCase) -ge 0) -Details 'Store configuration must be applied during the supported Tauri build/bundle sequence'

$frontendUpdater = $false
if ($null -ne $package.dependencies) {
    $frontendUpdater = $null -ne $package.dependencies.'@tauri-apps/plugin-updater'
}
if (-not $frontendUpdater -and $null -ne $package.devDependencies) {
    $frontendUpdater = $null -ne $package.devDependencies.'@tauri-apps/plugin-updater'
}
$rustUpdater = $cargoText.IndexOf('tauri-plugin-updater', [StringComparison]::OrdinalIgnoreCase) -ge 0
$registeredUpdater = $appLibText.IndexOf('tauri_plugin_updater', [StringComparison]::OrdinalIgnoreCase) -ge 0
$updaterConfigured = $store.PSObject.Properties.Name -contains 'plugins' -and
    $null -ne $store.plugins -and
    $store.plugins.PSObject.Properties.Name -contains 'updater'

if (-not $frontendUpdater -or -not $rustUpdater -or -not $registeredUpdater -or -not $updaterConfigured) {
    Add-Warning 'The signed Tauri updater is not implemented yet. This is a P0 blocker for the EXE Store path.'
}
if ([string] $product.updates.status -ne 'ready') {
    Add-Warning "Updater metadata status is '$($product.updates.status)'; strict submission readiness must remain blocked."
}

if ($RequireSubmissionReady) {
    Add-Check -Name 'Partner Center product reserved' -Passed ([string] $product.reservationStatus -eq 'reserved' -and [string] $product.product.storeId -match '^[A-Z0-9]{12}$') -Details "reservation=$($product.reservationStatus), Store ID=$($product.product.storeId)"
    Add-Check -Name 'Installer hosting ready' -Passed ([string] $product.package.urlStatus -eq 'ready' -and [string] $product.package.urlTemplate -match '^https://') -Details "status=$($product.package.urlStatus), URL=$($product.package.urlTemplate)"
    Add-Check -Name 'Installer URL is versioned' -Passed ([string] $product.package.urlTemplate -like '*{version}*' -and [string] $product.package.urlTemplate -notmatch '(?i)/latest(?:/|\.|$)') -Details "URL=$($product.package.urlTemplate)"
    Add-Check -Name 'Code signing ready' -Passed ([string] $product.signing.status -eq 'ready' -and -not [string]::IsNullOrWhiteSpace([string] $product.signing.expectedSubject) -and [string] $product.signing.timestampUrl -match '^https://') -Details "status=$($product.signing.status)"
    Add-Check -Name 'Updater dependencies present' -Passed ($frontendUpdater -and $rustUpdater) -Details "frontend=$frontendUpdater rust=$rustUpdater"
    Add-Check -Name 'Updater registered natively' -Passed $registeredUpdater -Details 'src-tauri/src/lib.rs must register tauri-plugin-updater'
    Add-Check -Name 'Updater configured' -Passed $updaterConfigured -Details 'Store config must contain real updater endpoint and public key'
    Add-Check -Name 'Updater metadata ready' -Passed ([string] $product.updates.status -eq 'ready' -and [string] $product.updates.endpoint -match '^https://' -and -not [string]::IsNullOrWhiteSpace([string] $product.updates.publicKeyFingerprint)) -Details "status=$($product.updates.status)"
}

$result = [ordered]@{
    schema = 'openmd.store-readiness.v1'
    generatedAt = [DateTimeOffset]::UtcNow.ToString('O')
    repository = 'gvastethecreator/open.md'
    version = $packageVersion
    submissionType = $product.submissionType
    requireSubmissionReady = [bool] $RequireSubmissionReady
    passed = $errors.Count -eq 0
    checks = $checks
    warnings = $warnings
}

if ($EvidencePath) {
    $resolvedEvidence = if ([System.IO.Path]::IsPathRooted($EvidencePath)) {
        $EvidencePath
    }
    else {
        Join-Path $repoRoot $EvidencePath
    }
    $evidenceDirectory = Split-Path -Parent $resolvedEvidence
    if ($evidenceDirectory) {
        New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
    }
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedEvidence -Encoding utf8
    Write-Host "Evidence: $resolvedEvidence" -ForegroundColor DarkGray
}

Write-Host ''
foreach ($warning in $warnings) {
    Write-Host "WARNING: $warning" -ForegroundColor Yellow
}

if ($errors.Count -gt 0) {
    Write-Host ''
    Write-Host 'STORE READINESS FAILED' -ForegroundColor Red
    foreach ($errorMessage in $errors) {
        Write-Host " - $errorMessage" -ForegroundColor Red
    }
    exit 1
}

Write-Host ''
Write-Host "STORE READINESS PASSED ($($checks.Count) checks)" -ForegroundColor Green
Write-Host "Version: $packageVersion"
Write-Host "Submission type: $($product.submissionType)"
if (-not $RequireSubmissionReady) {
    Write-Host 'Structural readiness passed. Run with -RequireSubmissionReady before public submission.' -ForegroundColor Yellow
}
