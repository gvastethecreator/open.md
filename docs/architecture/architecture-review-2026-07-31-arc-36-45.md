# Architecture improvement report — open.md

Date: 2026-07-31
Mode: Execution
Status: Completed

## Summary

- Requested and completed improvement count: **10** (ARC-36..45).
- Strongest before/after result: residual composition policy left in `main.js`
  (links, status identity, companion soft-defaults, close gate, diagram tokens,
  ingress Tauri defaults) moved behind tested owners, and the multi-concern
  `core/reader.js` bag drained into domain modules with a thin re-export facade.
- Final integration gate: frontend suite **272/272**, shell + static + Pages,
  production build with **324,703 B** initial JS (budget 325,000 B), Rust
  fmt/check, and **20/20** Rust tests.

Canonical tracker: [WORKPLAN.md](WORKPLAN.md).  
Visual companion: [`.scratch/reports/architecture-open-md-arc-36-45/index.html`](../../.scratch/reports/architecture-open-md-arc-36-45/index.html).

## Ticket outcomes

### ARC-36. Own document link activation

**Ticket:** WORKPLAN ARC-36  
**Status:** Completed

**Initial evidence**

- `handleLinkClick` in `main.js` owned external/file/blocked policy and edit-surface suppression.

**Implemented**

- `createDocumentLinkController` owns click interception behind adapters for
  path, open document, and open external URL.

**Before / After**

- Before: link policy lived in the composition root.
- After: one module interface; root only mounts and binds.

**Verification**

- `document-link-controller.test.js` green.

**Documentation / decisions**

- CONTEXT: Content and keyboard actions.

**Residual risk**

- None observed for current link action set.

### ARC-37. Own status identity projection

**Ticket:** WORKPLAN ARC-37  
**Status:** Completed

**Initial evidence**

- `updateStatus` / `updateStatusMetrics` composed display names, format labels,
  source/edit identity, and metrics in the root.

**Implemented**

- Status Presenter `project` owns help/ready/edit/source/document projection.

**Verification**

- `status-presenter.test.js` projection cases green.

**Residual risk**

- Root still gathers the snapshot inputs (zoom, nav line, tools); that is wiring, not label policy.

### ARC-38. Companion soft-defaults via format registry

**Ticket:** WORKPLAN ARC-38  
**Status:** Completed

**Initial evidence**

- Root hard-coded image format arrays and inline soft-default patches.

**Implemented**

- `isCompanionTextFormat` and `softReadingToolPatchForFormat` in format-registry.

**Verification**

- `format-registry.test.js` soft-patch cases green.

**Residual risk**

- Soft defaults only apply when tools still match global defaults (intentional).

### ARC-39. Own document close policy

**Ticket:** WORKPLAN ARC-39  
**Status:** Completed

**Initial evidence**

- `closeCurrentFile` duplicated identity + dirty gate next to view-state.

**Implemented**

- `documentViewState.requestClose({ canChangeDocument })` with `closeShell` hook.

**Verification**

- `document-view-state.test.js` empty/blocked/closed cases green.

**Residual risk**

- None observed.

### ARC-40. Ingress native surface via runtime adapters

**Ticket:** WORKPLAN ARC-40  
**Status:** Completed

**Initial evidence**

- Document ingress defaulted to `@tauri-apps/*` imports despite runtime adapters.

**Implemented**

- Runtime adapters expose `ingress` (listen, dialog, webview, list-pending).
- Ingress requires injected adapters; composition wires them from runtime adapters.

**Verification**

- Adapter tests + composition source audit forbid Tauri imports in ingress and main.

**Residual risk**

- Browser preview without adapters cannot open native pickers (same product intent).

### ARC-41. Theme coordinator owns diagram tokens

**Ticket:** WORKPLAN ARC-41  
**Status:** Completed

**Initial evidence**

- Root imported `getThemeTokens` only for diagram preparation.

**Implemented**

- `themeCoordinator.diagramTokens()` mirrors confirmed theme tokens.

**Verification**

- Theme coordinator token test green; main drops `getThemeTokens` import.

**Residual risk**

- Theme token derivation still lives in `core/reader` as pure helpers for the coordinator.

### ARC-42. Document payload authority module

**Ticket:** WORKPLAN ARC-42  
**Status:** Completed

**Initial evidence**

- `normalizeDocumentPayload` lived in the multi-concern helper bag.

**Implemented**

- `document-payload.js` owns validation and kind/format normalization;
  session/save import it; facade re-exports for tests.

**Verification**

- Session/save suites and `main.test.js` payload cases green.

**Residual risk**

- None observed.

### ARC-43. Markdown source operations module

**Ticket:** WORKPLAN ARC-43  
**Status:** Completed

**Initial evidence**

- Token ranges and task mutation shared a bag with unrelated helpers.

**Implemented**

- `markdown-source.js` owns both operations; session/save import it.

**Verification**

- Session/save suites and source token tests green.

**Residual risk**

- None observed.

### ARC-44. Document path and link policy module

**Ticket:** WORKPLAN ARC-44  
**Status:** Completed

**Initial evidence**

- Display name, relative resolution, link action, and image source policy were bag residents.

**Implemented**

- `document-path.js` owns the path/link policy; link controller, session,
  open-intent, and view-state import it.

**Verification**

- Path/link tests via facade and link controller green.

**Residual risk**

- Frontend support table remains a mirror of native acceptance.

### ARC-45. Reading geometry module

**Ticket:** WORKPLAN ARC-45  
**Status:** Completed

**Initial evidence**

- Navigation geometry pure helpers lived in the bag while only navigation used them.

**Implemented**

- `reading-geometry.js` owns scroll/line/minimap pure helpers; navigation imports it.

**Verification**

- Reading navigation suite and geometry facade tests green.

**Residual risk**

- None observed.

## Integration verification

| Gate | Result |
|---|---|
| `bun run check:frontend` | Passed (static, 5 shell tests, Pages) |
| `bun run test:frontend` | Passed: 40 files, 272 tests |
| `bun run build` | Passed: initial JS 324,703 B / budget 325,000 B |
| `bun run fmt:rust` | Passed |
| `bun run check:rust` | Passed (known Windows incremental-cache warning) |
| `bun run test:rust` | Passed: 20 tests |

Skipped: packaged Tauri smoke and existing-Chrome profile proof (host gates).

## Decisions and trade-offs

- Accepted: expand-contract drain of `core/reader.js` into domain modules with
  a compatibility facade so tests and residual pure helpers stay stable.
- Accepted: ingress native defaults move into runtime adapters rather than a
  third environment policy owner.
- Rejected: padding by line-count splits of editor-session or CSS extraction.
- Deferred: moving theme contrast/token pure helpers out of the facade until a
  second production owner appears.

## Residual risks

- Initial JS budget headroom is ~300 B; further owners may need budget review.
- Live browser and packaged multi-window proof remain unclaimed on this host.
- Theme pure helpers still share the facade file with status-metric presentation.
