# Windows artifact hosting

The production download origin is intended to be a Cloudflare R2 bucket exposed through a dedicated custom domain.

## URL contract

Every public artifact uses an immutable versioned key:

```text
https://downloads.example.com/open-md/0.1.0/open-md-0.1.0-windows-x64.exe
```

Never submit or publish these as the canonical package URL:

```text
/latest.exe
/download.exe
/releases/latest/...
```

Microsoft requires a versioned HTTPS URL for MSI/EXE submissions and the binary at that URL must not change after submission.

## R2 layout

Recommended bucket layout:

```text
open-md/
  0.1.0/
    open-md-0.1.0-windows-x64.exe
    SHA256SUMS.txt
    release-evidence.json
```

Use a custom domain, not the `r2.dev` development URL, for production distribution.

## Upload safety

The upload helper uses an S3-compatible R2 endpoint and an `If-None-Match: *` conditional write. If the object key already exists, publication fails instead of replacing the bytes.

Required CI secrets:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
```

The R2 token should have the minimum object permissions required for the release bucket.

## Post-upload verification

The release pipeline must download the object from its final HTTPS URL and compare its SHA-256 hash with the local release evidence. The URL, hash, version, artifact filename and signing subject are then recorded in the release evidence.

## Cloudflare configuration

Connect the R2 bucket to a dedicated custom domain and enable HTTPS. Production downloads should be publicly readable but write access must remain restricted to CI/release credentials.
