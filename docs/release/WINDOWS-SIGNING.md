# Windows release signing

This document defines the production Authenticode contract for the direct-download channel and the Microsoft Store EXE/MSI submission channel.

## Current decision

The release owner is an individual developer in Argentina. As of August 2026, Microsoft documents Azure Artifact Signing Public Trust as available to individual developers only in the United States and Canada. Unless eligibility changes or the publisher becomes an eligible organization, use a publicly trusted **OV code-signing certificate** from a CA whose chain is trusted by Windows.

Microsoft's MSI/EXE Store requirements state that the installer and all PE files it contains must be digitally signed by a certificate chaining to a CA in the Microsoft Trusted Root Program.

## Signing contract

Every release candidate must use:

- SHA-256 file digest (`/fd SHA256`)
- RFC 3161 timestamping (`/tr` + `/td SHA256`)
- a publicly trusted code-signing certificate
- a stable publisher identity across releases
- signature verification after signing
- SHA-256 hashes captured before publication

Do not use a self-signed certificate for public distribution or Store submission.

## Secret handling

For an exportable PFX-based CA delivery, GitHub Actions may use:

```text
WINDOWS_SIGNING_PFX_BASE64
WINDOWS_SIGNING_PFX_PASSWORD
WINDOWS_SIGNING_TIMESTAMP_URL
WINDOWS_SIGNING_SUBJECT
```

The PFX must never be committed, uploaded as an artifact, printed, or copied into the repository. If the selected CA provides a non-exportable/cloud/HSM signing integration, replace the PFX adapter with that provider's GitHub Actions integration instead of weakening the key-storage model.

## Files that must be signed

For this Tauri app, the release gate covers:

1. the final installer (`.exe` or `.msi` when that channel is used);
2. every shipped `.exe`, `.dll`, `.ocx`, or other PE payload inside the installer;
3. any separately distributed native helper executable.

A signed outer installer does not compensate for unsigned PE payloads.

## Verification

Use Authenticode verification with the default authentication policy and require a timestamp:

```powershell
signtool verify /pa /all /tw .\artifact.exe
```

The release pipeline must fail if any required PE is unsigned, untrusted, or lacks the expected timestamp.

## Direct distribution vs Store

The same trusted signing identity may be used for both channels, but the artifacts remain separate:

```text
GitHub/direct download
    -> signed installer / portable PE
    -> immutable release URL

Microsoft Store EXE/MSI
    -> signed installer / PE
    -> versioned HTTPS URL submitted to Partner Center
```

Do not mutate a Store-submitted object in place.

## Certificate rotation

Certificate renewal must not change the product publisher identity. Keep the previous certificate available until all previously released signatures have passed verification on supported clean machines and the new certificate has been validated.
