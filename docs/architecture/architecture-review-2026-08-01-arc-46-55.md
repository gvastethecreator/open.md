# Architecture improvement report — open.md

Date: 2026-08-01  
Mode: Execution  
Status: Completed

## Executive summary

- Requested and completed improvement count: **10** (ARC-46..55).
- Six residual production policies moved out of the `core/reader.js`
  compatibility facade and into the modules that consume them.
- Four composition-root policy clusters moved behind focused owners: status
  projection, path-theme preferences, empty-state motion, and editor-state
  application.
- `main.js` changed by +69/-253 lines; its status branching and mutable edit-mode
  fan-out were deleted. `core/reader.js` changed by +8/-60 lines and remains a
  compatibility export surface rather than the owner of those six policies.
- Final gate: static + shell + Pages, **48 frontend files / 345 tests**, Vite
  production build, Rust fmt/check, and **26 Rust tests** all passed.

Canonical tracker: [WORKPLAN.md](WORKPLAN.md).  
Visual companion:
[`architecture-open-md-arc-46-55/index.html`](../../.scratch/reports/architecture-open-md-arc-46-55/index.html).

## Scope and method

The review reconciled `CONTEXT.md`, the ARC-01..45 ledger, call sites, focused
tests, the production bundle boundary, and the clean baseline at
`73f436e5eb954504a5590a7f7f40cae2141c3d03`. Candidates had to pass the deletion
test: removing the old policy from its broad owner had to leave a smaller and
more coherent interface. Line-count splits, generic infrastructure, new
features, and product redesign were excluded.

No external content or network source was used.

## Evidence ledger

| ID | Initial evidence | Implemented owner | Observable proof |
|---|---|---|---|
| ARC-46 | Mode labels/icons/order lived in the compatibility bag | `document-mode-coordinator.js` | owner + facade cases for Read/Edit/Source/fallback |
| ARC-47 | Empty/content/help precedence lived in the bag | `reader-viewport-controller.js` | viewport projection and focus suite |
| ARC-48 | Wheel direction and zoom clamping lived in the bag | `reader-zoom-controller.js` | wheel, clamp, controls, disposal suite |
| ARC-49 | Maximize/Restore presentation lived in the bag | `window-chrome.js` | native state, actions, failure, disposal suite |
| ARC-50 | Zoom and remaining-time metrics were duplicated | `status-metrics.js` | default/custom zoom and reading-progress output |
| ARC-51 | Editor line offsets guessed format from path only | `reading-navigation-controller.js` + format registry | conflicting `.txt` path / Markdown payload regression |
| ARC-52 | `main.js` assembled format identity and every metric branch | `status-presenter.js` | Ready/Help/Read/Source/Edit plus all profiles |
| ARC-53 | Root knew path-theme enablement and storage schema | Path Theme Preference coordinator | disabled/global/remembered/unchanged/volatile paths |
| ARC-54 | Root owned shimmer timer, busy flag, listeners and cleanup | `empty-state-motion.js` | delay, hover, busy, event filter and disposal |
| ARC-55 | Root held mutable edit state and an eight-consumer fan-out | `editor-state-coordinator.js` | transitions, FIFO reentrancy, failures and disposal |

## Ticket outcomes

### ARC-46 — Document mode presentation locality

**Initial evidence:** the coordinator imported mode presentation from the broad
facade that did not own the mode lifecycle.  
**Implemented:** mode labels, icons, ordering, ARIA label and title now live
beside `createDocumentModeCoordinator`; the facade only re-exports compatibility.  
**Verification:** focused mode tests and the full suite passed.  
**Residual risk:** none observed for the current three-mode cycle.

### ARC-47 — Reader viewport mode locality

**Initial evidence:** help precedence and empty/content selection were detached
from the DOM projection that consumes them.  
**Implemented:** `getViewportMode` is local to Reader Viewport.  
**Verification:** empty, content, help, focus and disposal paths passed.  
**Residual risk:** none observed.

### ARC-48 — Reader zoom gesture policy locality

**Initial evidence:** the controller delegated its core wheel/clamp rule to the
compatibility bag.  
**Implemented:** Reader Zoom owns direction, step and bounds together.  
**Verification:** direct controls, wheel policy, clamp and disposal passed.  
**Residual risk:** none observed.

### ARC-49 — Native window presentation locality

**Initial evidence:** Window Chrome acquired native state but a broad helper
chose its accessible label and icon.  
**Implemented:** maximize/restore presentation is local to Window Chrome.  
**Verification:** native action, state, error and teardown paths passed.  
**Residual risk:** packaged OS-window interaction was not run in this batch.

### ARC-50 — Status metric policy locality

**Initial evidence:** zoom and remaining-time calculations had duplicate
implementations across `core/reader.js` and Status Metrics.  
**Implemented:** `status-metrics.js` is the sole authority; compatibility callers
receive re-exports.  
**Verification:** visible and accessible metric cases passed.  
**Residual risk:** none observed.

### ARC-51 — Format-aware editor line mapping

**Initial evidence:** code-block line offsets used only the filename extension,
despite document payload format being authoritative elsewhere.  
**Implemented:** Reading Navigation resolves path + payload through the format
registry once per projection.  
**Verification:** a Markdown payload on `notes.txt` produces Markdown code-line
offsets; the navigation suite passed.  
**Residual risk:** malformed payloads still fall back to registry policy by design.

### ARC-52 — Application status projection

**Initial evidence:** `updateStatus` in `main.js` owned JSON/CSV summarization,
format/profile choice, identity copy, and every document/editor/image branch.  
**Implemented:** the root now gathers one raw application snapshot; Status
Presenter owns all projection and exposes only `setIdentity`, `project`, and
`dispose`.  
**Verification:** Ready, Help, Read, Source, Edit, Markdown, text, JSON, CSV and
image cases passed, including quoted CSV fields.  
**Residual risk:** CSV status shape remains a bounded display estimate, not a
full parser contract.

### ARC-53 — Path-theme preference coordination

**Initial evidence:** composition knew the `pathThemes` schema, enablement,
longest-prefix recall, and global-versus-path persistence.  
**Implemented:** a coordinator owns that policy over injected preference/theme
adapters.  
**Verification:** remembered, unchanged, disabled, global, path and volatile
results passed.  
**Residual risk:** theme application failures remain reported by Theme
Coordinator, the existing error authority.

### ARC-54 — Empty-state logo motion lifecycle

**Initial evidence:** composition owned a private timer, busy flag, animation
filter and manual listener cleanup.  
**Implemented:** Empty State Motion exposes only `start`/`dispose`; playback is
private and lifecycle-owned.  
**Verification:** boot delay, hover replay, busy suppression, animation-name
filter and disposal passed.  
**Residual risk:** live animation frames were not treated as a product visual
regression baseline.

### ARC-55 — Editor state application coordination

**Initial evidence:** `main.js` held mutable `isEditMode` and sequenced feedback,
transient UI, mode, save, navigation, typography, tools and status.  
**Implemented:** Editor State Coordinator owns canonical editing state, fixed
fan-out, transition branches, FIFO reentrancy, failure isolation and disposal;
Editor Feedback Presenter is visual-only.  
**Verification:** Read→Edit, Edit update, Edit→Read, reentrancy, adapter failure
and disposal passed. Independent review also removed two residual direct reads
of `editorSession.isEditing()`.  
**Residual risk:** adapter ordering is intentionally centralized and must remain
part of this coordinator's contract when a new editor consumer is added.

## Independent review

Three independent passes reviewed Standards, Spec, and simplification against
the pinned baseline. Confirmed fixes were:

- route every application-level edit-mode read through the canonical coordinator;
- cover disabled path-theme recall, not only disabled persistence;
- remove coordinator return values and motion playback entry points used only by tests;
- hoist invariant format resolution and collapse status-field forwarding.

The post-review focused matrix passed: **7 files / 27 tests**.

## Integration verification

| Gate | Result |
|---|---|
| `git diff --check HEAD` + untracked whitespace scan | Passed |
| `bun run check:frontend` | Passed: static, 5 shell tests, 11 Pages references |
| `bun run test:frontend` | Passed: 48 files, 345 tests |
| `bun run build` | Passed: initial JS 378,713 B / 380,000 B limit; Mermaid remains deferred |
| `bun run fmt:rust` | Passed |
| `bun run check:rust` | Passed; Windows could not finalize an incremental cache directory |
| `bun run test:rust` | Passed: 26 tests; linker/incremental-cache warnings only |
| HTML Lab validator | Passed: `HTML_LAB_VALID` |
| Chrome report inspection | Passed: `file://`, 1440×1000 and 390×844; no console/page/network errors or external requests |
| Responsive seams | Passed: 519/520/521 and 849/850/851 px; no document overflow |

The known jsdom `HTMLCanvasElement.getContext` warning and Vite's large deferred
chunk warning were emitted; neither failed its gate.

The report filter showed 4 coordination tickets, keyboard traversal reached the
expected filters, native `<details>` toggled from the keyboard, and the Chrome
accessibility tree exposed all three filter button names. Final captures are
stored beside the HTML as `desktop-full.png` and `narrow-full.png`.

## Decisions and trade-offs

- Accepted: policy moves to the owner that consumes it; compatibility re-exports
  preserve current tests without retaining production authority.
- Accepted: ARC-55 uses `apply`, `isEditing`, `dispose` and one internal frozen
  application object. A public state bag, snapshot feed, and event bus were rejected.
- Accepted: application snapshots remain assembled in `main.js`; gathering
  adapters is composition, while status meaning belongs to the presenter.
- Deferred: moving cohesive theme contrast/token helpers out of `core/reader.js`
  until a clear production owner exists.
- Rejected: CSS splitting, editor-session line-count extraction, new frameworks,
  and speculative abstractions.

No ADR was added: these changes strengthen ownership already declared in
`CONTEXT.md` and do not introduce a surprising or hard-to-reverse cross-boundary
decision.

## Residual risks and unclaimed gates

- Initial JavaScript has **1,287 B** of headroom under the current 380,000 B
  guard; future eager owners need bundle review.
- Packaged Tauri window behavior and a live end-user app session were not run.
- The HTML companion is browser-inspected evidence for this report, not a
  committed visual-regression baseline for the product.
- No commit, push, release, or remote tracker mutation was performed.
