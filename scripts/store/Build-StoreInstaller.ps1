#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter()]
    [string] $CertificatePath = $env:OPENMD_WINDOWS_CERTIFICATE_PATH,

    [Parameter()]
    [string] $CertificatePassword = $env:OPENMD_WINDOWS_CERTIFICATE_PASSWORD,

    [Parameter()]
    [string] $TimestampUrl = $env:OPENMD_WINDOWS_TIMESTAMP_URL,

    [Parameter()]
    [string] $OutputDirectory,

    [Parameter()]
    [switch] $SkipTests,

    [Parameter()]
    [switch] $RequireSubmissionReady,

    [Parameter()]
    [switch] $RunLifecycleSmoke
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'The Microsoft Store installer must be built on Windows.'
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$checkedInStoreConfig = Join-Path $repoRoot 'src-tauri\tauri.microsoftstore.conf.json'
$productPath = Join-Path $repoRoot 'docs\store\store-product.json'
$readinessPath = Join-Path $PSScriptRoot 'Test-StoreReadiness.ps1'
$lifecyclePath = Join-Path $PSScriptRoot 'Test-StoreInstallerLifecycle.ps1'
$targetTriple = 'x86_64-pc-windows-msvc'

$runtimeStoreConfig = $null
$importedCertificatePath = $null
$removeImportedCertificate = $false

function Invoke-Step {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [scriptblock] $Command
    )

    Write-Host ''
    Write-Host "==> $Name" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    & $Command
    if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

function Resolve-SignTool {
    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if (-not (Test-Path -LiteralPath $kitsRoot -PathType Container)) {
        throw 'Windows SDK SignTool was not found. Install the Windows SDK.'
    }

    $candidate = Get-ChildItem -LiteralPath $kitsRoot -Directory |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1

    if (-not $candidate) {
        throw "No x64 signtool.exe was found under $kitsRoot."
    }
    return $candidate
}

function Assert-PathInside {
    param(
        [Parameter(Mandatory)] [string] $Candidate,
        [Parameter(Mandatory)] [string] $Parent
    )

    $candidatePath = [System.IO.Path]::GetFullPath($Candidate)
    $parentPath = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (-not $candidatePath.StartsWith($parentPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside $Parent`: $Candidate"
    }
}

function Verify-Authenticode {
    param(
        [Parameter(Mandatory)] [string] $FilePath,
        [Parameter(Mandatory)] [string] $SignToolPath
    )

    & $SignToolPath verify /pa /all /v $FilePath | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Authenticode verification failed for $FilePath."
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        -not $signature.SignerCertificate) {
        throw "PowerShell signature verification failed for $FilePath`: $($signature.Status)"
    }
    return $signature
}

function Add-OrReplaceProperty {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)] [string] $Name,
        [Parameter()] $Value
    )

    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

foreach ($required in @(
    @{ Name = 'Certificate path'; Value = $CertificatePath },
    @{ Name = 'Certificate password'; Value = $CertificatePassword },
    @{ Name = 'RFC 3161 timestamp URL'; Value = $TimestampUrl }
)) {
    if ([string]::IsNullOrWhiteSpace([string] $required.Value)) {
        throw "$($required.Name) is required. Use parameters or OPENMD_WINDOWS_* environment variables."
    }
}
if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) {
    throw "Code-signing certificate not found: $CertificatePath"
}
$timestampUri = $null
if (-not [Uri]::TryCreate($TimestampUrl, [UriKind]::Absolute, [ref] $timestampUri) -or
    $timestampUri.Scheme -ne [Uri]::UriSchemeHttps) {
    throw 'TimestampUrl must be an absolute HTTPS RFC 3161 endpoint.'
}

$readinessArgs = @{}
if ($RequireSubmissionReady) {
    $readinessArgs.RequireSubmissionReady = $true
}
& $readinessPath @readinessArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Store readiness validation failed.'
}

$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$product = Get-Content -LiteralPath $productPath -Raw | ConvertFrom-Json
$version = [string] $package.version
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot "artifacts\store\$version"
}
elseif (-not [System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot $OutputDirectory
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
Assert-PathInside -Candidate $OutputDirectory -Parent (Join-Path $repoRoot 'artifacts')

if (Test-Path -LiteralPath $OutputDirectory) {
    Remove-Item -LiteralPath $OutputDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$signTool = Resolve-SignTool
$resolvedCertificatePath = (Resolve-Path -LiteralPath $CertificatePath).Path

# Read and validate the PFX before importing it into the Windows certificate store.
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $resolvedCertificatePath,
    $CertificatePassword
)
try {
    if (-not $certificate.HasPrivateKey) {
        throw 'The supplied certificate does not contain a private key.'
    }
    $now = [DateTime]::UtcNow
    if ($certificate.NotBefore.ToUniversalTime() -gt $now -or
        $certificate.NotAfter.ToUniversalTime() -le $now) {
        throw "The code-signing certificate is not currently valid: $($certificate.NotBefore) - $($certificate.NotAfter)"
    }

    $hasCodeSigningEku = $false
    foreach ($extension in $certificate.Extensions) {
        if ($extension -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]) {
            foreach ($oid in $extension.EnhancedKeyUsages) {
                if ($oid.Value -eq '1.3.6.1.5.5.7.3.3') {
                    $hasCodeSigningEku = $true
                }
            }
        }
    }
    if (-not $hasCodeSigningEku) {
        throw 'The certificate does not include the Code Signing EKU.'
    }

    $expectedSubject = [string] $product.signing.expectedSubject
    if (-not [string]::IsNullOrWhiteSpace($expectedSubject) -and
        -not [string]::Equals($certificate.Subject, $expectedSubject, [StringComparison]::Ordinal)) {
        throw "Certificate subject '$($certificate.Subject)' does not match Store metadata '$expectedSubject'."
    }

    $certificateThumbprint = $certificate.Thumbprint.Replace(' ', '').ToUpperInvariant()
    $certificateSubject = $certificate.Subject
    $certificateNotAfter = $certificate.NotAfter.ToUniversalTime().ToString('O')
}
finally {
    $certificate.Dispose()
}

$importedCertificatePath = "Cert:\CurrentUser\My\$certificateThumbprint"
$removeImportedCertificate = -not (Test-Path -LiteralPath $importedCertificatePath)
if ($removeImportedCertificate) {
    $securePassword = ConvertTo-SecureString -String $CertificatePassword -AsPlainText -Force
    $imported = Import-PfxCertificate `
        -FilePath $resolvedCertificatePath `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -Password $securePassword `
        -Exportable:$false
    if (-not $imported -or
        -not [string]::Equals($imported.Thumbprint.Replace(' ', ''), $certificateThumbprint, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The code-signing certificate could not be imported into CurrentUser\My.'
    }
}

# Tauri signs the application, NSIS installer, and generated installer payloads
# through its Windows bundler. Keeping signing inside Tauri is important because
# post-signing only the outer setup EXE would leave embedded/generated PE files
# outside the intended signing pipeline.
$storeConfig = Get-Content -LiteralPath $checkedInStoreConfig -Raw | ConvertFrom-Json
$windowsConfig = $storeConfig.bundle.windows
Add-OrReplaceProperty -Object $windowsConfig -Name 'certificateThumbprint' -Value $certificateThumbprint
Add-OrReplaceProperty -Object $windowsConfig -Name 'digestAlgorithm' -Value 'sha256'
Add-OrReplaceProperty -Object $windowsConfig -Name 'timestampUrl' -Value $TimestampUrl
Add-OrReplaceProperty -Object $windowsConfig -Name 'tsp' -Value $true

$locationPushed = $false
try {
    $tempRoot = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
        [System.IO.Path]::GetTempPath()
    }
    else {
        $env:RUNNER_TEMP
    }
    $runtimeStoreConfig = Join-Path $tempRoot "openmd-store-$([Guid]::NewGuid().ToString('N')).json"
    $storeConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $runtimeStoreConfig -Encoding utf8

    Push-Location $repoRoot
    $locationPushed = $true

    if (-not $SkipTests) {
        Invoke-Step 'Install locked dependencies' { pnpm install --frozen-lockfile }
        Invoke-Step 'Verify frontend and Rust application' { pnpm run verify }
    }

    $env:OPENMD_DISTRIBUTION_CHANNEL = 'store'
    Invoke-Step 'Build Store application executable' {
        pnpm tauri build `
            --no-bundle `
            --config $runtimeStoreConfig `
            --target $targetTriple
    }

    Invoke-Step 'Bundle and sign offline NSIS installer' {
        pnpm tauri bundle `
            --config $runtimeStoreConfig `
            --target $targetTriple
    }

    $releaseRoot = Join-Path $repoRoot "src-tauri\target\$targetTriple\release"
    $appExecutable = Join-Path $releaseRoot 'open-md.exe'
    if (-not (Test-Path -LiteralPath $appExecutable -PathType Leaf)) {
        throw "Tauri release executable was not found: $appExecutable"
    }
    $appSignature = Verify-Authenticode -FilePath $appExecutable -SignToolPath $signTool

    $nsisRoot = Join-Path $releaseRoot 'bundle\nsis'
    $installers = @(Get-ChildItem -LiteralPath $nsisRoot -File -Filter '*.exe' |
        Sort-Object LastWriteTimeUtc -Descending)
    if ($installers.Count -ne 1) {
        throw "Expected exactly one NSIS installer under $nsisRoot; found $($installers.Count)."
    }
    $installerSignature = Verify-Authenticode -FilePath $installers[0].FullName -SignToolPath $signTool

    $finalName = "open-md-$version-windows-x64-store.exe"
    $finalInstaller = Join-Path $OutputDirectory $finalName
    Copy-Item -LiteralPath $installers[0].FullName -Destination $finalInstaller -Force
    $copiedSignature = Verify-Authenticode -FilePath $finalInstaller -SignToolPath $signTool

    $installerHash = (Get-FileHash -LiteralPath $finalInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    $appHash = (Get-FileHash -LiteralPath $appExecutable -Algorithm SHA256).Hash.ToLowerInvariant()

    $url = $null
    if (-not [string]::IsNullOrWhiteSpace([string] $product.package.urlTemplate)) {
        $url = ([string] $product.package.urlTemplate).
            Replace('{version}', $version).
            Replace('{filename}', $finalName)
    }

    $partnerCenter = [ordered]@{
        schema = 'openmd.partner-center-package.v1'
        productName = $product.product.displayName
        storeId = $product.product.storeId
        packageUrl = $url
        architecture = 'x64'
        installerType = 'exe'
        silentInstallParameter = '/S'
        language = 'en-US'
        version = $version
        filename = $finalName
        sha256 = $installerHash
    }
    $partnerCenterPath = Join-Path $OutputDirectory 'partner-center-package.json'
    $partnerCenter | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $partnerCenterPath -Encoding utf8

    $buildManifest = [ordered]@{
        schema = 'openmd.store-build.v1'
        generatedAt = [DateTimeOffset]::UtcNow.ToString('O')
        sourceCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
        version = $version
        target = $targetTriple
        configuration = 'release'
        distributionChannel = 'store'
        tauriConfig = 'src-tauri/tauri.microsoftstore.conf.json'
        installer = [ordered]@{
            path = $finalInstaller
            filename = $finalName
            bytes = (Get-Item -LiteralPath $finalInstaller).Length
            sha256 = $installerHash
            signerSubject = $copiedSignature.SignerCertificate.Subject
            signerThumbprint = $copiedSignature.SignerCertificate.Thumbprint
            signatureStatus = $copiedSignature.Status.ToString()
            timestampUrl = $TimestampUrl
            packageUrl = $url
        }
        applicationExecutable = [ordered]@{
            path = $appExecutable
            sha256 = $appHash
            signerSubject = $appSignature.SignerCertificate.Subject
            signerThumbprint = $appSignature.SignerCertificate.Thumbprint
            signatureStatus = $appSignature.Status.ToString()
        }
        certificate = [ordered]@{
            expectedSubject = $certificateSubject
            thumbprint = $certificateThumbprint
            notAfter = $certificateNotAfter
            importedTemporarily = $removeImportedCertificate
        }
        policy = [ordered]@{
            offlineInstaller = $true
            installScope = 'currentUser'
            silentInstallParameter = '/S'
            updaterStatus = $product.updates.status
            tauriTsp = $true
        }
    }
    $manifestPath = Join-Path $OutputDirectory 'store-build-manifest.json'
    $buildManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8

    "$installerHash  $finalName" |
        Set-Content -LiteralPath (Join-Path $OutputDirectory 'SHA256SUMS.txt') -Encoding ascii

    $forbidden = @(Get-ChildItem -LiteralPath $OutputDirectory -Recurse -File | Where-Object {
        $_.Extension -in @('.pfx', '.p12', '.pvk', '.key', '.snk')
    })
    if ($forbidden.Count -gt 0) {
        throw "Private signing material entered the output directory: $($forbidden.FullName -join ', ')"
    }

    if ($RunLifecycleSmoke) {
        & $lifecyclePath -InstallerPath $finalInstaller -EvidencePath (Join-Path $OutputDirectory 'lifecycle-evidence.json')
        if ($LASTEXITCODE -ne 0) {
            throw 'Store installer lifecycle smoke failed.'
        }
    }

    Write-Host ''
    Write-Host 'SIGNED STORE INSTALLER READY FOR QUALIFICATION' -ForegroundColor Green
    Write-Host "Installer: $finalInstaller"
    Write-Host "SHA-256: $installerHash"
    Write-Host "Evidence: $manifestPath"
    if (-not $url) {
        Write-Host 'Hosting URL is still pending. Do not submit this build to Partner Center.' -ForegroundColor Yellow
    }
    if ([string] $product.updates.status -ne 'ready') {
        Write-Host 'Signed updater is still pending. Do not publish this EXE Store edition.' -ForegroundColor Yellow
    }
}
finally {
    if ($locationPushed) {
        Pop-Location
    }
    Remove-Item Env:\OPENMD_DISTRIBUTION_CHANNEL -ErrorAction SilentlyContinue
    if ($runtimeStoreConfig -and (Test-Path -LiteralPath $runtimeStoreConfig)) {
        Remove-Item -LiteralPath $runtimeStoreConfig -Force -ErrorAction SilentlyContinue
    }
    if ($removeImportedCertificate -and $importedCertificatePath -and
        (Test-Path -LiteralPath $importedCertificatePath)) {
        Remove-Item -LiteralPath $importedCertificatePath -Force -ErrorAction SilentlyContinue
    }
}
