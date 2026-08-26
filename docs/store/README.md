# Microsoft Store submission runbook for open.md

Status: **implementation prepared; submission blocked**

This directory contains the repository-side contracts for publishing open.md through Microsoft Partner Center. It does not claim that the product has already passed certification.

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

The Store package is not an MSIX and Microsoft does not manage its updates. See [ADR 0002](../adr/0002-microsoft-store-exe-submission.md).

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

Run the structural gate at any time:

```powershell
pnpm run store:validate
```

Run the strict gate only when reservation, hosting, signing, and updater work are complete:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\store\Test-StoreReadiness.ps1 `
  -RequireSubmissionReady
```

## 1. Product reservation

In Partner Center create a new product using:

```text
EXE or MSI app
```

Do not reserve it as an MSIX product unless the packaging strategy is deliberately changed and requalified.

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

## 2. Pricing and availability

Recommended first submission:

- Price: Free.
- Markets: all markets where the listing and support policy are acceptable.
- Discoverability: available in Store search.
- Organizational licensing: decide explicitly in Partner Center.
- Release timing: use **publish manually** or a hold after certification for the first submission.
- Trial: not applicable for the free edition.

Record the actual choices in release evidence.

## 3. Properties

Recommended values:

- Category: Productivity.
- Subcategory: choose the closest current document/editor category shown by Partner Center.
- Privacy policy: `https://gvastethecreator.github.io/open.md/privacy.html`
- Support: `https://github.com/gvastethecreator/open.md/issues`
- Website: `https://gvastethecreator.github.io/open.md/`
- System requirements: Windows x64; WebView2 is included through the offline installer mode.
- Account requirement: none.

Do not claim cloud synchronization, remote collaboration, AI features, or Store-managed updates.

## 4. Age ratings

open.md is a general-purpose local document utility. The app itself contains no violence, sexual content, gambling, social networking, unrestricted web browser, or user-generated-content service.

The rating questionnaire must still be completed in Partner Center. Documents opened by a user are local user-selected files; the application does not provide or distribute that content.

Save the final rating result with the release evidence.

## 5. Package preparation

### Store-specific Tauri config

`src-tauri/tauri.microsoftstore.conf.json` limits the bundle to NSIS and requires:

- current-user installation;
- offline WebView2 installer;
- publisher display metadata;
- downgrade blocking;
- no web downloader.

### Signing inputs

Set these locally or as protected GitHub Actions secrets:

```powershell
$env:OPENMD_WINDOWS_CERTIFICATE_PATH = 'C:\secure\openmd-code-signing.pfx'
$env:OPENMD_WINDOWS_CERTIFICATE_PASSWORD = '<secret>'
$env:OPENMD_WINDOWS_TIMESTAMP_URL = 'https://<rfc3161-service>'
```

In GitHub Actions use:

```text
OPENMD_WINDOWS_CERTIFICATE_BASE64
OPENMD_WINDOWS_CERTIFICATE_PASSWORD
OPENMD_WINDOWS_TIMESTAMP_URL
```

Never commit private signing material.

The included helper supports a PFX that can be imported into the current user's certificate store. Modern hardware-backed or cloud signing services may expose the private key differently. In that case, keep the same package/evidence gates but adapt the workflow to Tauri's `signCommand` or a certificate already available by thumbprint; do not export a protected key merely to satisfy this helper.

### Build

```powershell
.\scripts\store\Build-StoreInstaller.ps1 `
  -RequireSubmissionReady
```

The build:

1. runs the readiness gate;
2. verifies the repository;
3. imports the signing identity temporarily;
4. gives Tauri the certificate thumbprint, SHA-256 digest and RFC 3161 timestamp configuration;
5. builds and signs the application and offline NSIS payload through Tauri;
6. verifies Authenticode on the application and final installer;
7. writes SHA-256 and provenance evidence;
8. removes temporary signing configuration and imported certificate material;
9. rejects private-key files in the output directory.

Output:

```text
artifacts/store/<version>/
  open-md-<version>-windows-x64-store.exe
  SHA256SUMS.txt
  partner-center-package.json
  store-build-manifest.json
```

### Partner Center package fields

Use the generated `partner-center-package.json` as a transcription aid:

- Package URL: immutable versioned HTTPS URL.
- Architecture: x64.
- Installer type: EXE.
- Silent install parameter: `/S`.
- Language: English (United States).
- Package version: the exact application version.
- Support URL and privacy URL: as documented above.

Do not use a URL containing `/latest/`, a mutable object key, authentication, an expiring signature, or a landing page.

## 6. Hosting

Read [HOSTING.md](HOSTING.md).

The certified URL must continue serving exactly the certified bytes. A new release uses a new URL. Retain old certified objects for rollback, reinstall, and certification traceability.

Before entering the URL:

```powershell
Invoke-WebRequest -Method Head '<versioned-url>'
Invoke-WebRequest -OutFile installer.exe '<versioned-url>'
Get-FileHash .\installer.exe -Algorithm SHA256
Get-AuthenticodeSignature .\installer.exe
```

The downloaded hash must match the build evidence.

## 7. Updates

Read [UPDATE-STRATEGY.md](UPDATE-STRATEGY.md).

Because this is an EXE submission, Microsoft Store does not update the installed app. Public submission remains blocked until the signed updater is implemented and tested.

The updater must:

- verify Tauri update signatures;
- use HTTPS;
- present release/version information;
- preserve unsaved-work safety;
- never upload documents or paths;
- support a rollback/recovery procedure;
- have its endpoint and public-key fingerprint recorded in `store-product.json`.

## 8. Store listing

Use [LISTING.md](LISTING.md) as the source of truth. The first listing is `en-US`.

Screenshots must show real application surfaces without private documents, usernames, project paths, tokens, or third-party content without permission.

## 9. Certification notes

Use [CERTIFICATION-NOTES.md](CERTIFICATION-NOTES.md). Update version numbers and updater details before submission.

The notes explain:

- no account or login;
- local file access;
- read versus edit behavior;
- file associations;
- silent install;
- offline installation;
- how to create a safe sample document;
- where settings are stored;
- how updates work.

## 10. Lifecycle qualification

Use:

```powershell
.\scripts\store\Test-StoreInstallerLifecycle.ps1 `
  -InstallerPath .\artifacts\store\<version>\open-md-<version>-windows-x64-store.exe
```

Run the full matrix from [RELEASE-EVIDENCE-TEMPLATE.md](RELEASE-EVIDENCE-TEMPLATE.md) on a clean Windows 11 x64 VM and, before broad release, a supported Windows 10 x64 machine if Windows 10 remains advertised.

The lifecycle test changes the current user's installed applications and file-association registration. Use a disposable VM or dedicated test profile.

## 11. First submission sequence

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

The repository cannot truthfully complete:

- identity verification by the certificate authority;
- purchase or custody of the signing certificate;
- Partner Center commercial selections;
- age-rating answers on behalf of the publisher;
- final screenshot approval;
- hosting ownership and retention guarantees;
- clean-machine interactive evidence;
- final submission or publication approval.

Those remain release-owner responsibilities and must be recorded rather than inferred.

## Primary references

- Tauri Microsoft Store distribution: <https://v2.tauri.app/distribute/microsoft-store/>
- Tauri Windows code signing: <https://v2.tauri.app/distribute/sign/windows/>
- Microsoft MSI/EXE submission checklist: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/create-app-submission>
- Microsoft MSI/EXE package requirements: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements>
- Microsoft MSI/EXE package page: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/upload-app-packages>
- Microsoft manual package validation: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/manual-package-validation>
