# ADR 0002: Publish the Windows Store edition through an EXE submission

- Status: Accepted for implementation
- Date: 2026-08-18
- Decision owners: open.md maintainers

## Context

open.md is a Tauri v2 desktop application. The existing project builds native Tauri bundles but does not publish installers.

Microsoft Store supports both packaged MSIX submissions and Win32 installer submissions. The current official Tauri Microsoft Store guidance uses the Store's **EXE or MSI app** path because Tauri generates EXE/MSI installers rather than a first-class Store-associated MSIX project.

The EXE/MSI path changes several responsibilities:

- the submitted installer must be available at an immutable HTTPS URL;
- the installer and every installed PE file must be signed by a publicly trusted code-signing certificate;
- installation must work silently;
- the installer must be complete and offline;
- Store-delivered updates are not available for this path, so open.md must own a safe update mechanism.

## Decision

The first Windows Store edition of open.md will use:

- Partner Center product type: **EXE or MSI app**;
- installer: Tauri v2 NSIS `.exe`;
- architecture: x64;
- silent argument: `/S`;
- install scope: current user;
- WebView2 mode: `offlineInstaller`;
- hosting: immutable, versioned HTTPS object;
- signing: Authenticode SHA-256 plus RFC 3161 timestamp;
- updates: Tauri's signed updater before public submission.

The direct GitHub/project-site channel and Store channel may share the same application binary only when their update policy and release provenance are explicit. The Store package URL must never point to a mutable `latest.exe`.

## Consequences

### Positive

- follows the toolchain's supported packaging route;
- preserves Tauri file associations and current-user NSIS installation;
- avoids maintaining a custom MSIX manifest and packaging implementation;
- keeps the Store submission understandable to reviewers.

### Costs

- requires a publicly trusted code-signing certificate before a candidate can be built;
- requires durable hosting for every submitted installer version;
- requires a signed updater and update service;
- requires lifecycle validation of silent install, upgrade, uninstall, file associations, and installed PE signatures;
- Microsoft Store will not host or manage application updates for the EXE/MSI route.

## Rejected alternatives

### Custom MSIX immediately

Rejected for the first release because the project does not currently have an MSIX packaging project or a tested Tauri-to-MSIX lifecycle. A custom MSIX could be evaluated later, but it must not be introduced merely to avoid the signing, hosting, and updater work required by the supported EXE route.

### Mutable latest-download URL

Rejected because Partner Center package URLs must identify an immutable installer. Replacing bytes behind an already-certified URL breaks reproducibility and can invalidate certification assumptions.

### Development or self-signed certificate

Rejected for public Store submission. A local certificate remains useful only for local package experiments; the submitted Win32 installer requires a trust chain accepted by Windows and Microsoft policy.

## Review triggers

Revisit this ADR when:

- Tauri ships and documents a first-class Store-associated MSIX workflow;
- Microsoft changes EXE/MSI submission or update requirements;
- open.md adds ARM64;
- hosting or code-signing infrastructure changes materially.

## References

- <https://v2.tauri.app/distribute/microsoft-store/>
- <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/create-app-submission>
- <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements>
