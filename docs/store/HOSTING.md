# Store installer hosting contract

The Microsoft Store EXE submission points to an installer hosted outside Microsoft Store. Hosting is therefore part of the release's security and reproducibility boundary.

## Required URL properties

The installer URL must be:

- HTTPS;
- directly downloadable without login, cookies, or interactive consent;
- stable and globally reachable;
- version-specific;
- immutable after submission;
- backed by an object whose bytes do not change;
- available for as long as the certified version may need to be installed or reviewed.

Recommended shape:

```text
https://downloads.example.com/open-md/0.1.0/open-md-0.1.0-windows-x64-store.exe
```

Rejected shapes:

```text
https://downloads.example.com/open-md/latest.exe
https://downloads.example.com/open-md/download
https://example.com/download-page
https://storage.example.com/file.exe?<expiring-signature>
```

## Publishing procedure

1. Build the signed installer.
2. Record its SHA-256 and Authenticode signer.
3. Upload using a create-only or object-lock operation.
4. Download it through the final public URL.
5. Compare the downloaded SHA-256 to the build evidence.
6. Verify the downloaded Authenticode signature.
7. Enter that exact URL in Partner Center.
8. Prevent overwrite and deletion through storage policy.

A new version always receives a new directory/object key.

## CDN behavior

CDN redirects are acceptable only when Partner Center can reach the final object without authentication and the URL remains durable. Avoid redirects to short-lived signed URLs.

Recommended response behavior:

- `200 OK`;
- binary response;
- correct `Content-Length`;
- stable `ETag` or object version;
- `Content-Disposition` with the versioned filename;
- no HTML interstitial;
- no JavaScript challenge;
- no geo-blocking in selected Store markets.

## GitHub Releases

A versioned GitHub Release asset can be useful for testing and may be viable when it is public and immutable in practice. It is not the preferred production contract because repository or release changes can affect availability and download URLs can redirect.

Never use GitHub's `releases/latest/download/...` path for the Partner Center package URL.

For production, prefer an owned domain and immutable object storage/CDN with retention controls.

## Verification commands

```powershell
$url = 'https://downloads.example.com/open-md/0.1.0/open-md-0.1.0-windows-x64-store.exe'
$out = '.\downloaded-store-installer.exe'

Invoke-WebRequest -Method Head $url
Invoke-WebRequest -Uri $url -OutFile $out

Get-FileHash $out -Algorithm SHA256
Get-AuthenticodeSignature $out | Format-List Status, StatusMessage, SignerCertificate
```

Compare the hash with `artifacts/store/<version>/SHA256SUMS.txt`.

## Retention and rollback

Keep:

- every certified installer;
- its build manifest;
- checksum file;
- source commit;
- listing/release evidence;
- update metadata associated with that version.

Do not reuse the Store URL for a hotfix. Publish a new version, new object, and new URL.
