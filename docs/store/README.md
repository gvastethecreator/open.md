# Microsoft Store submission runbook for open.md

Status: **implementation prepared; submission blocked**

This directory holds repository-side contracts for publishing open.md through Microsoft Partner Center. It does not claim that the product has passed certification.

## Chosen distribution path

open.md uses Tauri v2. The first Store edition follows the official Tauri route for a Microsoft Store **EXE or MSI app**:

```text
source
  ↓
frontend + Rust verification
  ↓
Tauri release binary
  ↓
Tauri Authenticode signing
  ↓
Tauri NSIS offline installer
  ↓
immutable versioned HTTPS hosting
  ↓
Partner Center EXE submission
```

The Store package is not an MSIX. Microsoft does not manage its updates. See [ADR 0002](../adr/0002-microsoft-store-exe-submission.md).

## Current hard gates

A public submission must not proceed until all of these are complete:

- [ ] Reserve open.md in Partner Center as an **EXE or MSI app**.
- [ ] Record the Store ID using `scripts/store/Set-StoreProduct.ps1`.
- [ ] Obtain a publicly trusted Windows code-signing certificate.
- [ ] Configure an RFC 3161 timestamp service.
- [ ] Configure an immutable versioned HTTPS installer URL.
- [ ] Implement and qualify the signed Tauri updater.
- [ ] Run silent install, launch, upgrade, uninstall, and file-association qualification.
- [ ] Verify every installed `.exe` and `.dll` has a valid trusted signature.
- [ ] Publish and review the privacy page.
- [ ] Review listing text and screenshots.
- [ ] Complete the age-rating questionnaire.
- [ ] Submit with a publishing hold for the first certification.

```powershell
pnpm run store:validate
```

Run the strict gate only when reservation, hosting, signing, and updater work are complete:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\store\Test-StoreReadiness.ps1 `
  -RequireSubmissionReady
```

## Product reservation

In Partner Center create a new product using `EXE or MSI app`. Do not reserve it as an MSIX product unless the packaging strategy is deliberately changed and requalified.

After reservation, record the exact values without surrounding spaces:

```powershell
.\scripts\store\Set-StoreProduct.ps1 `
  -StoreId '<12-character Store ID>' `
  -InstallerUrlTemplate 'https://downloads.example.com/open-md/{version}/open-md-{version}-windows-x64-store.exe' `
  -SignerSubject 'CN=<verified publisher subject>' `
  -TimestampUrl 'https://<rfc3161-timestamp-service>' `
  -UpdateEndpoint 'https://updates.example.com/open-md/latest.json' `
  -UpdatePublicKeyFingerprint '<public updater key fingerprint>'
```

This command stores public release metadata only. It never stores a certificate, private key, password, or updater signing key.

## Listing defaults

Recommended first submission: free; all acceptable markets; Store search on; first release held for manual publish. Record actual choices in release evidence.

Recommended properties:

- Category: Productivity.
- Privacy policy: `https://gvastethecreator.github.io/open.md/privacy.html`
- Support: `https://github.com/gvastethecreator/open.md/issues`
- Website: `https://gvastethecreator.github.io/open.md/`
- System requirements: Windows x64. WebView2 is included through the offline installer mode.
- Account requirement: none.

Do not claim cloud synchronization, remote collaboration, AI features, or Store-managed updates.

open.md is a general-purpose local document utility. The app itself contains no violence, sexual content, gambling, social networking, unrestricted web browser, or user-generated-content service. Complete the Partner Center questionnaire and save the rating with release evidence.

Listing copy, screenshots, hosting, updater, certification answers, and the evidence template live in:

- [LISTING.md](LISTING.md)
- [HOSTING.md](HOSTING.md)
- [UPDATE-STRATEGY.md](UPDATE-STRATEGY.md)
- [CERTIFICATION-NOTES.md](CERTIFICATION-NOTES.md)
- [RELEASE-EVIDENCE-TEMPLATE.md](RELEASE-EVIDENCE-TEMPLATE.md)

Screenshots must show real application surfaces without private documents, usernames, project paths, tokens, or third-party content without permission.

## Package preparation

`src-tauri/tauri.microsoftstore.conf.json` limits the bundle to NSIS and requires current-user installation, an offline WebView2 installer, publisher display metadata, downgrade blocking, and no web downloader.

Set these locally or as protected GitHub Actions secrets:

```powershell
$env:OPENMD_WINDOWS_CERTIFICATE_PATH = 'C:\secure\openmd-code-signing.pfx'
$env:OPENMD_WINDOWS_CERTIFICATE_PASSWORD = '<secret>'
$env:OPENMD_WINDOWS_TIMESTAMP_URL = 'https://<rfc3161-service>'
```

In GitHub Actions use `OPENMD_WINDOWS_CERTIFICATE_BASE64`, `OPENMD_WINDOWS_CERTIFICATE_PASSWORD`, and `OPENMD_WINDOWS_TIMESTAMP_URL`. Never commit private signing material.

The included helper supports a PFX that can be imported into the current user's certificate store. Hardware-backed or cloud signing may expose the private key differently. In that case keep the same package and evidence gates, but adapt the workflow to Tauri's `signCommand` or a certificate already available by thumbprint. Do not export a protected key merely to satisfy this helper.

```powershell
.\scripts\store\Build-StoreInstaller.ps1 `
  -RequireSubmissionReady
```

The build runs the readiness gate, signs through Tauri, verifies Authenticode, writes SHA-256 evidence, and rejects private-key files in the output directory.

```text
artifacts/store/<version>/
  open-md-<version>-windows-x64-store.exe
  SHA256SUMS.txt
  partner-center-package.json
  store-build-manifest.json
```

Use `partner-center-package.json` as a transcription aid. Package URL must be an immutable versioned HTTPS URL. Architecture: x64. Installer type: EXE. Silent install parameter: `/S`. Language: English (United States). Do not use a URL containing `/latest/`, a mutable object key, authentication, an expiring signature, or a landing page.

Before entering the URL:

```powershell
Invoke-WebRequest -Method Head '<versioned-url>'
Invoke-WebRequest -OutFile installer.exe '<versioned-url>'
Get-FileHash .\installer.exe -Algorithm SHA256
Get-AuthenticodeSignature .\installer.exe
```

The downloaded hash must match the build evidence. The certified URL must keep serving exactly the certified bytes. A new release uses a new URL.

## Lifecycle qualification

```powershell
.\scripts\store\Test-StoreInstallerLifecycle.ps1 `
  -InstallerPath .\artifacts\store\<version>\open-md-<version>-windows-x64-store.exe
```

Run the full matrix from [RELEASE-EVIDENCE-TEMPLATE.md](RELEASE-EVIDENCE-TEMPLATE.md) on a clean Windows 11 x64 VM and, before broad release, a supported Windows 10 x64 machine if Windows 10 remains advertised.

The lifecycle test changes the current user's installed applications and file-association registration. Use a disposable VM or dedicated test profile.

Because this is an EXE submission, Microsoft Store does not update the installed app. Public submission remains blocked until the signed updater is implemented and tested.

## First submission sequence

```text
merge reviewed Store PR
  ↓
reserve EXE/MSI product
  ↓
configure signing + hosting + updater
  ↓
strict readiness passes
  ↓
build signed installer
  ↓
lifecycle qualification
  ↓
upload immutable installer
  ↓
verify downloaded hash/signature
  ↓
complete Partner Center sections
  ↓
submit with publishing hold
  ↓
review certification result and delivered listing
  ↓
publish manually
```

## What this repository cannot automate

The repository cannot complete identity verification by the certificate authority, purchase or custody of the signing certificate, Partner Center commercial selections, age-rating answers, final screenshot approval, hosting ownership and retention guarantees, clean-machine interactive evidence, or final submission approval. Those remain release-owner responsibilities.

## Primary references

- Tauri Microsoft Store distribution: <https://v2.tauri.app/distribute/microsoft-store/>
- Tauri Windows code signing: <https://v2.tauri.app/distribute/sign/windows/>
- Microsoft MSI/EXE submission checklist: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/create-app-submission>
- Microsoft MSI/EXE package requirements: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements>
- Microsoft MSI/EXE package page: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/upload-app-packages>
- Microsoft manual package validation: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/manual-package-validation>
