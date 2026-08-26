#Requires -Version 5.1

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [Parameter()]
    [string] $StoreId,

    [Parameter()]
    [string] $PublisherDisplayName,

    [Parameter()]
    [string] $InstallerUrlTemplate,

    [Parameter()]
    [string] $SignerSubject,

    [Parameter()]
    [string] $TimestampUrl,

    [Parameter()]
    [string] $UpdateEndpoint,

    [Parameter()]
    [string] $UpdatePublicKeyFingerprint,

    [Parameter()]
    [switch] $MarkUpdaterReady
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$productPath = Join-Path $repoRoot 'docs\store\store-product.json'
$readinessPath = Join-Path $PSScriptRoot 'Test-StoreReadiness.ps1'

function Assert-CleanText {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [AllowEmptyString()] [string] $Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name must not be empty."
    }

    if (-not [string]::Equals($Value, $Value.Trim(), [StringComparison]::Ordinal) -or
        $Value.IndexOf([char] 0x00A0) -ge 0) {
        throw "$Name contains leading, trailing, or non-breaking whitespace."
    }
}

function Assert-HttpsUrl {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [string] $Value
    )

    Assert-CleanText -Name $Name -Value $Value
    $uri = $null
    if (-not [Uri]::TryCreate($Value.Replace('{version}', '0.0.0').Replace('{filename}', 'file.exe'), [UriKind]::Absolute, [ref] $uri) -or
        $uri.Scheme -ne [Uri]::UriSchemeHttps) {
        throw "$Name must be an absolute HTTPS URL."
    }
}

if (-not (Test-Path -LiteralPath $productPath -PathType Leaf)) {
    throw "Store product metadata is missing: $productPath"
}

$product = Get-Content -LiteralPath $productPath -Raw | ConvertFrom-Json

if ($PSBoundParameters.ContainsKey('StoreId')) {
    Assert-CleanText -Name 'Store ID' -Value $StoreId
    if ($StoreId -notmatch '^[A-Z0-9]{12}$') {
        throw 'Store ID must contain exactly 12 uppercase letters or digits.'
    }
    $product.product.storeId = $StoreId
    $product.reservationStatus = 'reserved'
}

if ($PSBoundParameters.ContainsKey('PublisherDisplayName')) {
    Assert-CleanText -Name 'Publisher display name' -Value $PublisherDisplayName
    $product.product.publisherDisplayName = $PublisherDisplayName
}

if ($PSBoundParameters.ContainsKey('InstallerUrlTemplate')) {
    Assert-HttpsUrl -Name 'Installer URL template' -Value $InstallerUrlTemplate
    if ($InstallerUrlTemplate.IndexOf('{version}', [StringComparison]::Ordinal) -lt 0) {
        throw 'Installer URL template must contain {version}.'
    }
    if ($InstallerUrlTemplate -notmatch '\.exe(?:$|[?#])') {
        throw 'Installer URL template must resolve directly to an .exe asset.'
    }
    if ($InstallerUrlTemplate -match '(?i)/latest(?:/|\.|$)') {
        throw 'Installer URL template must not use a mutable latest path.'
    }
    $product.package.urlTemplate = $InstallerUrlTemplate
    $product.package.urlStatus = 'ready'
}

$signingTouched = $false
if ($PSBoundParameters.ContainsKey('SignerSubject')) {
    Assert-CleanText -Name 'Signer subject' -Value $SignerSubject
    $product.signing.expectedSubject = $SignerSubject
    $signingTouched = $true
}
if ($PSBoundParameters.ContainsKey('TimestampUrl')) {
    Assert-HttpsUrl -Name 'Timestamp URL' -Value $TimestampUrl
    $product.signing.timestampUrl = $TimestampUrl
    $signingTouched = $true
}
if ($signingTouched) {
    if (-not [string]::IsNullOrWhiteSpace([string] $product.signing.expectedSubject) -and
        -not [string]::IsNullOrWhiteSpace([string] $product.signing.timestampUrl)) {
        $product.signing.status = 'ready'
    }
    else {
        $product.signing.status = 'pending'
    }
}

$updatesTouched = $false
if ($PSBoundParameters.ContainsKey('UpdateEndpoint')) {
    Assert-HttpsUrl -Name 'Update endpoint' -Value $UpdateEndpoint
    $product.updates.endpoint = $UpdateEndpoint
    $updatesTouched = $true
}
if ($PSBoundParameters.ContainsKey('UpdatePublicKeyFingerprint')) {
    Assert-CleanText -Name 'Update public-key fingerprint' -Value $UpdatePublicKeyFingerprint
    $product.updates.publicKeyFingerprint = $UpdatePublicKeyFingerprint
    $updatesTouched = $true
}
if ($updatesTouched) {
    if (-not [string]::IsNullOrWhiteSpace([string] $product.updates.endpoint) -and
        -not [string]::IsNullOrWhiteSpace([string] $product.updates.publicKeyFingerprint)) {
        $product.updates.status = 'configured'
    }
    else {
        $product.updates.status = 'pending'
    }
}

if ($MarkUpdaterReady) {
    if ([string]::IsNullOrWhiteSpace([string] $product.updates.endpoint) -or
        [string]::IsNullOrWhiteSpace([string] $product.updates.publicKeyFingerprint)) {
        throw 'Updater endpoint and public-key fingerprint are required before marking the updater ready.'
    }

    $packageText = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw
    $cargoText = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\Cargo.toml') -Raw
    $appText = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\src\lib.rs') -Raw
    $storeConfigText = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\tauri.microsoftstore.conf.json') -Raw

    $implementationChecks = @(
        $packageText.IndexOf('@tauri-apps/plugin-updater', [StringComparison]::OrdinalIgnoreCase) -ge 0,
        $cargoText.IndexOf('tauri-plugin-updater', [StringComparison]::OrdinalIgnoreCase) -ge 0,
        $appText.IndexOf('tauri_plugin_updater', [StringComparison]::OrdinalIgnoreCase) -ge 0,
        $storeConfigText.IndexOf('"updater"', [StringComparison]::OrdinalIgnoreCase) -ge 0
    )
    if ($implementationChecks -contains $false) {
        throw 'Updater implementation is incomplete. Dependencies, native registration, and Store configuration must exist before marking it ready.'
    }
    $product.updates.status = 'ready'
}

$product.lastReviewed = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-dd')

if (-not $PSCmdlet.ShouldProcess($productPath, 'Update public Microsoft Store product metadata')) {
    return
}

$tempPath = "$productPath.tmp"
try {
    $product | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tempPath -Encoding utf8
    Move-Item -LiteralPath $tempPath -Destination $productPath -Force
}
finally {
    if (Test-Path -LiteralPath $tempPath) {
        Remove-Item -LiteralPath $tempPath -Force
    }
}

Write-Host 'Store product metadata updated.' -ForegroundColor Green
Write-Host "Reservation: $($product.reservationStatus)"
Write-Host "Store ID: $($product.product.storeId)"
Write-Host "Installer URL status: $($product.package.urlStatus)"
Write-Host "Signing status: $($product.signing.status)"
Write-Host "Updater status: $($product.updates.status)"
Write-Host ''
Write-Host 'No certificate, password, or updater private key was stored.' -ForegroundColor DarkGray

& $readinessPath
if ($LASTEXITCODE -ne 0) {
    throw 'Metadata was written, but structural Store readiness failed.'
}
