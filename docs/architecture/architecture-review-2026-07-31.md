# Architecture improvement report — open.md

Date: 2026-07-31
Mode: Execution
Status: Completed

## Summary

- Requested and completed improvement count: **10** (ARC-26..35).
- Strongest before/after result: the half-landed format layer became a real
  frontend format authority, and residual composition leaks (Tauri imports,
  zoom/status policy, task-save fan-out, non-importable boot) moved behind
  tested modules without changing public Open Intent or shell contracts.
- Final integration gate: frontend suite 265/265, shell + static + Pages,
  production build with 322,936 B initial JS (budget 325,000 B), Rust
  fmt/check, and 20/20 Rust tests.

Canonical tracker: [WORKPLAN.md](WORKPLAN.md).  
Visual companion: [`.scratch/reports/architecture-open-md-arc-26-35/index.html`](../../.scratch/reports/architecture-open-md-arc-26-35/index.html).

## Ticket outcomes

### ARC-26. Frontend path/support authority via format-detect

**Ticket:** WORKPLAN ARC-26  
**Status:** Completed

**Initial evidence**

- `format-detect.js` existed with tests but no production imports.
- `core/reader.js` owned a parallel extension table used by Open Intent and links.

**Implemented**

- `core/reader.js` delegates `isSupportedFilePath` / family helpers to
  `format-detect.js` and drops local extension sets.

**Before / After**

- Before: two frontend extension tables; detect module was dead weight.
- After: one path/support module; readers re-export thin adapters.

**Verification**

- `format-detect.test.js`, `main.test.js` path cases green.

**Documentation / decisions**

- CONTEXT: Document format authority.

**Residual risk**

- Rust still owns native acceptance; frontend detect is a mirror for tests and
  pre-open policy, not filesystem authority.

### ARC-27. Mode availability via allowsDocumentMode

**Ticket:** WORKPLAN ARC-27  
**Status:** Completed

**Initial evidence**

- `allowsDocumentMode` was tested but `main.js` hard-coded image format arrays
  and `getFileKind` for edit availability.

**Implemented**

- Mode coordinator `isAvailable` and keyboard edit guard use
  `allowsDocumentMode` + `resolveFormatId`.

**Before / After**

- Before: capability policy leaked as root format lists.
- After: registry capabilities are the mode interface.

**Verification**

- Composition boots; focused registry mode tests green.

**Residual risk**

- None observed for current format set.

### ARC-28. Shared format resolution helper

**Ticket:** WORKPLAN ARC-28  
**Status:** Completed

**Initial evidence**

- Document session and view-state each re-implemented format/kind ladders.

**Implemented**

- `resolveFormatId` in `format-registry.js` is shared by both owners.

**Verification**

- Registry tests for payload-before-path; session + view-state suites green.

**Residual risk**

- Path fallback without payload remains coarse until native open returns format.

### ARC-29. Single frontend image MIME map

**Ticket:** WORKPLAN ARC-29  
**Status:** Completed

**Initial evidence**

- MIME maps lived in session, format-detect, and image-resources.

**Implemented**

- Session and image-resources consume `imageMimeForFormat` from format-detect
  (session via registry re-export).

**Verification**

- `image-resources.test.js`, `document-session.test.js` green.

**Residual risk**

- Native MIME policy remains authoritative for filesystem reads.

### ARC-30. Format display labels

**Ticket:** WORKPLAN ARC-30  
**Status:** Completed

**Initial evidence**

- Status labels used coarse `getFileKind` while payloads carried fine formats.

**Implemented**

- `getFormatLabel` drives status context labels in the composition root.

**Verification**

- Registry label tests green.

**Residual risk**

- `getFileKind` remains as a thin compatibility adapter for a few helpers.

### ARC-31. Status metrics composition ownership

**Ticket:** WORKPLAN ARC-31  
**Status:** Completed

**Initial evidence**

- Root built document/editor metric item arrays and accessible strings.

**Implemented**

- Status Presenter owns `renderDocumentMetrics` / `renderEditorMetrics`.

**Verification**

- `status-presenter.test.js` composition cases green.

**Residual risk**

- Pure helpers still live in `core/reader.js` as implementation details.

### ARC-32. Complete runtime adapter native surface

**Ticket:** WORKPLAN ARC-32  
**Status:** Completed

**Initial evidence**

- `main.js` imported `invoke`, `getCurrentWindow`, and `openUrl` directly.

**Implemented**

- Runtime adapters own acknowledge, initial paths, external URL (lazy opener),
  and native window access. Main has zero `@tauri-apps/*` imports.

**Verification**

- Adapter tests + composition source audit green.

**Residual risk**

- Document ingress still may use injectable Tauri defaults for dialog/listen;
  those remain adapter-local, not root policy.

### ARC-33. Task-save projection in document view-state

**Ticket:** WORKPLAN ARC-33  
**Status:** Completed

**Initial evidence**

- Save completion fanned editor/source/nav/status from root.

**Implemented**

- `applySavedDocument` updates identity + editor; root wires chrome side effects
  only via `onSavedDocument`.

**Verification**

- View-state save-projection test green.

**Residual risk**

- Source text + nav dirty still hook-driven from root (presentation, not policy).

### ARC-34. Zoom lifecycle owner

**Ticket:** WORKPLAN ARC-34  
**Status:** Completed

**Initial evidence**

- Zoom scale, wheel, CSS variable, and toast lived in main.

**Implemented**

- `createReaderZoomController` owns clamp, wheel, publish, toast.

**Verification**

- `reader-zoom-controller.test.js` green.

**Residual risk**

- None observed.

### ARC-35. Executable application composition seam

**Ticket:** WORKPLAN ARC-35  
**Status:** Completed

**Initial evidence**

- Application assembly was auto-started only; no importable composition seam.

**Implemented**

- Export `startOpenMdApplication` returning dispose/current/zoom accessors;
  auto-start gated by `!window.__VITEST__`.

**Verification**

- `application-composition.test.js` boots real `index.html` under jsdom.

**Residual risk**

- Boot test does not exercise native Tauri bridges or packaged windows.

## Integration verification

| Gate | Result |
|---|---|
| `bun run check:frontend` | Passed (static, 5 shell tests, Pages) |
| `bun run test:frontend` | Passed: 39 files, 265 tests |
| `bun run build` | Passed: initial JS 322,936 B / budget 325,000 B |
| `bun run fmt:rust` | Passed |
| `bun run check:rust` | Passed (known Windows incremental-cache warning) |
| `bun run test:rust` | Passed: 20 tests |

Skipped: packaged Tauri smoke and existing-Chrome profile proof (host gates).

## Decisions and trade-offs

- Accepted: format-detect as frontend path authority; native open remains FS authority.
- Accepted: raise initial JS budget 320→325 KiB for format + composition owners.
- Rejected: padding with CSS splits, event bus, or multi-file utility bags for count.
- Deferred: full ingress Tauri default consolidation beyond injected adapters.

## Residual risks

- Live browser and packaged multi-window proof remain unclaimed on this host.
- Frontend/native format heuristics can still drift if one side changes alone;
  Rust tests and format-detect tests should move together.
- `core/reader.js` remains a multi-concern helper bag; only file-path ownership
  was deepened in this batch.
