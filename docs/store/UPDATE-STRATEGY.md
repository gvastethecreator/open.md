# Signed update strategy for the EXE Store edition

Status: **P0 release blocker**

Microsoft Store does not manage application updates for an EXE/MSI submission. open.md must implement, sign, document, and qualify its own updater before public submission.

## Security goals

The updater must:

- use Tauri's signed updater artifacts;
- verify a public key embedded in the application;
- retrieve metadata over HTTPS;
- never execute an unsigned or mismatched artifact;
- never send document content, file paths, reading history, or preferences;
- avoid interrupting an edit with unsaved changes;
- provide clear version and failure states;
- retain a recovery path if an update cannot complete.

## Planned implementation

### Dependencies

Resolve versions compatible with the repository's Tauri 2.x release:

```powershell
pnpm add @tauri-apps/plugin-updater
cargo add tauri-plugin-updater --manifest-path src-tauri/Cargo.toml
```

A process/relaunch plugin may also be needed depending on the chosen user experience.

Do not copy arbitrary versions from this document; use versions compatible with the pinned Tauri core/CLI and commit the resulting lockfiles.

### Native registration

Register the updater plugin in `src-tauri/src/lib.rs` during builder construction.

The Store readiness gate expects the Rust dependency, frontend dependency, native registration, and a tested update coordinator before `updates.status` can become `ready`.

### Configuration

The final Store config must contain a real HTTPS endpoint and the Tauri updater public key, for example:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://updates.example.com/open-md/latest.json"
      ],
      "pubkey": "<TAURI_PUBLIC_KEY>"
    }
  }
}
```

The private updater key must not be committed.

Release automation uses protected secrets:

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

The public key is not secret, but its expected fingerprint must be recorded in `docs/store/store-product.json` and release evidence.

### Frontend coordinator

Add one update service responsible for:

- manual check from About/Settings;
- optional low-frequency background check;
- states: idle, checking, available, downloading, ready, failed;
- release notes and version display;
- explicit install/restart action;
- blocking install while a document has unsaved changes;
- cancellation before installation when supported;
- no repeated prompts for the same dismissed version;
- accessible status announcements.

Do not scatter updater calls across view code.

## Metadata and artifacts

The update endpoint should return the metadata format generated for the selected Tauri updater version.

Every release must publish:

- versioned installer submitted to Partner Center;
- Tauri updater artifact(s);
- updater signature file(s);
- `latest.json` or equivalent signed-release metadata;
- SHA-256 and release evidence;
- source commit and release notes.

The immutable Partner Center installer URL and the mutable updater metadata endpoint serve different purposes. Never replace the certified installer bytes when updating `latest.json`.

## Update policy

Recommended first policy:

- manual update check available at all times;
- optional background check no more than once per day;
- no silent installation;
- download/install only after a clear user action;
- show current and target versions;
- defer while unsaved edits exist;
- restart only after user confirmation;
- treat network failure as non-fatal.

## Qualification matrix

Test at least:

1. no update available;
2. valid update available;
3. metadata unavailable;
4. malformed metadata;
5. wrong updater signature;
6. artifact hash/download corruption;
7. network interruption;
8. update while a document is open but unchanged;
9. update while unsaved changes exist;
10. update from the previous public Store version;
11. downgrade/replay attempt;
12. restart after update;
13. settings preserved;
14. file associations preserved;
15. opened document is not deleted or modified;
16. rollback/reinstall of the previous installer.

Capture endpoint, public-key fingerprint, source/target versions, logs, and results.

## Release gate

Set:

```json
"updates": {
  "status": "ready"
}
```

only after:

- dependencies are committed;
- native and frontend integration are implemented;
- endpoint is deployed;
- private key custody is defined;
- public key fingerprint is recorded;
- successful and negative-path tests have evidence;
- privacy and certification notes reflect actual behavior.

After implementation and evidence are complete, mark the public metadata deliberately:

```powershell
.\scripts\store\Set-StoreProduct.ps1 -MarkUpdaterReady
```

The command refuses to mark the updater ready unless dependencies, native registration, and Store updater configuration exist.

Until then, `Test-StoreReadiness.ps1 -RequireSubmissionReady` must fail.
