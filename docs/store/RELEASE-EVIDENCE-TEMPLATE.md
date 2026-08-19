# open.md Microsoft Store release evidence

Release version: `<VERSION>`  
Source commit: `<SHA>`  
Candidate date: `<UTC DATE>`  
Tester: `<NAME>`  
Test machine/VM: `<IDENTIFIER>`  
Windows version/build: `<VERSION>`  
Architecture: `x64`

## Identity and submission

| Check | Result | Evidence |
|---|---|---|
| Product reserved as EXE/MSI app | Pending | Store ID |
| Store ID matches `store-product.json` | Pending | Screenshot/export |
| Listing name matches reservation | Pending | |
| Privacy URL is publicly reachable | Pending | |
| Support URL is reachable | Pending | |
| Age rating completed | Pending | |
| Publishing hold selected for first submission | Pending | |

## Build provenance

| Field | Value |
|---|---|
| Product version | |
| Installer filename | |
| Installer SHA-256 | |
| Installer URL | |
| Installer URL SHA-256 after download | |
| Signer subject | |
| Certificate thumbprint | |
| Certificate expiry | |
| Timestamp | |
| Tauri CLI version | |
| Rust toolchain | |
| Node version | |
| pnpm version | |

Attach:

- `store-build-manifest.json`
- `partner-center-package.json`
- `SHA256SUMS.txt`
- dependency lockfiles
- release notes

## Installer requirements

| Scenario | Result | Notes/evidence |
|---|---|---|
| Installer downloads without login | Pending | |
| URL is versioned and immutable | Pending | |
| Offline during install | Pending | Disconnect network |
| Silent install with `/S` | Pending | |
| Normal interactive install | Pending | |
| Current-user install without elevation | Pending | |
| Installer Authenticode valid | Pending | |
| Installed app EXE signature valid | Pending | |
| Every installed EXE/DLL signature valid | Pending | |
| No unrelated software installed | Pending | |
| Install directory recorded | Pending | |
| Start-menu entry works | Pending | |

## First launch and documents

Use synthetic test documents only.

| Scenario | Result | Notes/evidence |
|---|---|---|
| Launch from Start | Pending | |
| Empty state is usable | Pending | |
| File picker opens `.md` | Pending | |
| Drag/drop opens `.md` | Pending | |
| Command-line path opens `.md` | Pending | |
| Open with opens `.md` | Pending | |
| `.markdown` opens | Pending | |
| `.txt` opens | Pending | |
| Multiple paths create correct windows | Pending | |
| Unsupported extension fails closed | Pending | |
| Non-UTF-8 input gives clear error | Pending | |
| Text file over 20 MiB rejected clearly | Pending | |
| Image over 12 MiB rejected clearly | Pending | |

## Reading and rendering

| Scenario | Result | Notes/evidence |
|---|---|---|
| Rendered Markdown headings/lists/quotes | Pending | |
| Code highlighting | Pending | |
| Mermaid diagram | Pending | Confirm no remote service |
| Relative local image | Pending | |
| Remote image is not fetched | Pending | Network trace |
| JSON companion view | Pending | |
| CSV row cap | Pending | |
| Plain companion text | Pending | |
| Raster image viewer | Pending | |
| External link opens OS handler | Pending | |

## Editing and data safety

| Scenario | Result | Notes/evidence |
|---|---|---|
| Opening never changes file hash | Pending | |
| Read-only controls prevent edits | Pending | |
| Source Edit saves expected UTF-8 | Pending | |
| Rendered Edit saves expected source | Pending | |
| Atomic-save temp files cleaned | Pending | |
| Existing file permissions preserved where supported | Pending | |
| Autosave enabled behavior | Pending | |
| Autosave disabled behavior | Pending | |
| Unsaved-changes warning/behavior | Pending | |
| User document survives app uninstall | Pending | |
| Save failure gives clear feedback | Pending | |

## Settings and windows

| Scenario | Result | Notes/evidence |
|---|---|---|
| Theme persists | Pending | |
| Font preference persists | Pending | |
| Reading tools persist | Pending | |
| Reduced motion works | Pending | |
| Always-on-top works | Pending | |
| Path-theme preference remains local | Pending | |
| Multiple instances default | Pending | |
| Single-instance mode after restart | Pending | |
| Pending open requests delivered once | Pending | |
| Closing coordinator redelivers pending request | Pending | |

## File associations

| Scenario | Result | Notes/evidence |
|---|---|---|
| `.md` appears in Open with | Pending | |
| `.markdown` appears in Open with | Pending | |
| `.txt` appears in Open with | Pending | |
| App does not silently become default | Pending | |
| Set-default action opens Windows settings | Pending | |
| Associations survive update | Pending | |
| Associations removed/clean after uninstall | Pending | |

## Updates

Source version: `<OLD>`  
Target version: `<NEW>`  
Endpoint: `<HTTPS URL>`  
Public-key fingerprint: `<FINGERPRINT>`

| Scenario | Result | Notes/evidence |
|---|---|---|
| No-update state | Pending | |
| Valid signed update detected | Pending | |
| Update metadata unavailable | Pending | |
| Invalid signature rejected | Pending | |
| Corrupt artifact rejected | Pending | |
| Interrupted download recovers | Pending | |
| Unsaved edits prevent unsafe install | Pending | |
| User confirms install/restart | Pending | |
| Version changes after update | Pending | |
| Preferences preserved | Pending | |
| File associations preserved | Pending | |
| Documents preserved | Pending | |
| No document/path sent to endpoint | Pending | Network trace |

## Upgrade and uninstall

| Scenario | Result | Notes/evidence |
|---|---|---|
| Previous public version installs | Pending | |
| New version upgrades silently | Pending | |
| New version upgrades interactively | Pending | |
| Settings preserved | Pending | |
| App launches after upgrade | Pending | |
| Silent uninstall | Pending | |
| Interactive uninstall | Pending | |
| App files removed | Pending | |
| User documents remain | Pending | |
| Remaining settings documented | Pending | |
| Reinstall succeeds | Pending | |

## Accessibility and presentation

| Scenario | Result | Notes/evidence |
|---|---|---|
| Keyboard-only primary workflow | Pending | |
| Visible focus | Pending | |
| Screen-reader labels on primary controls | Pending | |
| 200% Windows scaling | Pending | |
| Narrow minimum window | Pending | |
| Light/dark contrast | Pending | |
| Reduced-motion behavior | Pending | |
| Store screenshots match submitted build | Pending | |

## Final sign-off

- [ ] No `Pending` items remain for required release gates.
- [ ] All failures are resolved or explicitly accepted by the release owner.
- [ ] Hosted bytes match the qualified installer.
- [ ] Certification notes contain no placeholders.
- [ ] Privacy policy matches actual updater/network behavior.
- [ ] Submission is held for manual publication after certification.

Release owner: `<NAME>`  
Decision: `APPROVE / REJECT`  
Date: `<UTC DATE>`  
Notes:
