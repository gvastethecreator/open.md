# Certification notes — open.md

Copy and adapt this text for the Partner Center submission. Replace bracketed values before use.

## Product overview

open.md is a local-first Markdown and plain-text reader/editor built with Tauri v2.

- No account or login is required.
- The app does not provide cloud storage, collaboration, advertising, or telemetry.
- Documents are opened from the local machine.
- Remote images referenced by Markdown are not downloaded.
- The first Store package is a current-user x64 NSIS EXE.
- Silent install parameter: `/S`.
- The installer includes the offline WebView2 bootstrap payload required by the selected Tauri configuration.

## Safe test procedure

Create a local sample file:

```powershell
$sample = Join-Path $env:TEMP 'openmd-store-review.md'
@'
# open.md certification sample

This is a local Markdown document.

- Opened files are read-only until Edit is selected.
- Saving changes writes only to this chosen file.

```text
local code block
```
'@ | Set-Content -LiteralPath $sample -Encoding utf8
```

Then:

1. Install the submitted EXE using `/S`, or install it normally.
2. Launch **open.md** from Start.
3. Use the file picker to open `%TEMP%\openmd-store-review.md`, or right-click the file and use **Open with → open.md**.
4. Confirm the rendered Markdown view appears.
5. Switch to Source to view the original text.
6. Enter Edit, change one line, and save.
7. Reopen the file and confirm the saved line.
8. Open Advanced options → System.
9. Use **Set as default for Markdown…** and confirm the app opens Windows Default apps rather than silently replacing the current default.
10. Test drag and drop with the same sample.

No special account, server, device, or credential is required.

## File access behavior

open.md reads only files selected through:

- the file picker;
- drag and drop;
- command-line/file-association launch;
- a path explicitly sent to a new application window.

Opening a file never writes to it. Edit/save and optional autosave can write to the selected document. The app does not enumerate document libraries or upload content.

Supported registered associations are:

```text
.md
.markdown
.txt
```

Other bounded local companion formats can be opened manually but are not claimed as default associations.

## Local images and active content

Relative local raster images can be shown from the opened document directory under bounded path and size checks. Remote images are blocked.

Markdown is rendered inside the application's local webview. The app uses a restrictive Content Security Policy and does not execute scripts from opened documents.

Mermaid diagrams are rendered by the bundled application code; document content is not sent to an external Mermaid service.

## Settings and data

Native settings:

```text
%APPDATA%\com.gvastethecreator.openmd\settings.json
```

Reader preferences are stored in the application's local WebView data.

Uninstall does not delete the user's documents. Settings may remain until removed by the user or Windows application-data cleanup.

## Network and updates

Current production behavior: [replace with the final behavior before submission].

For the EXE/MSI Store path, updates are application-managed. The final release will use Tauri signed updater artifacts from:

```text
[HTTPS UPDATE ENDPOINT]
```

The embedded updater public-key fingerprint is:

```text
[PUBLIC KEY FINGERPRINT]
```

The updater requests release metadata and signed artifacts only. It does not transmit documents, paths, or preferences.

Do not submit these notes while the placeholders remain.

## Installer and signatures

Installer URL:

```text
[IMMUTABLE VERSIONED HTTPS URL]
```

Installer SHA-256:

```text
[SHA-256]
```

Signer:

```text
[AUTHENTICODE SIGNER SUBJECT]
```

Timestamp service:

```text
[RFC 3161 TIMESTAMP URL]
```

The installer and installed PE files are signed. The lifecycle evidence verifies silent install, launch, installed signatures, file associations, upgrade, and silent uninstall.

## Reviewer caveats

- The app intentionally does not take over default file associations without an OS-owned user action.
- Multiple application instances are allowed by default. The user can enable a single-instance mode that applies on the next launch.
- User-selected documents can contain arbitrary personal content; screenshots and test documents supplied by the publisher use synthetic content only.
