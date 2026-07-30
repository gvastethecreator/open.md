# Architecture workplan

Date: 2026-07-29
Status: ARC-01..15 implemented and locally verified

This ledger tracks the five accepted recommendations from the
[architecture review](architecture-review-2026-07-29.md). Each slice used
expand-contract: add the new owner, migrate callers, prove parity, then remove
the compatibility path.

| Order | Story | Result | Commit | Primary evidence |
|---:|---|---|---|---|
| 1 | ARC-01 — executable reader shell | Implemented | `bc1977a` | Real `index.html` under jsdom; stale load and dependency failure through the public shell |
| 2 | ARC-03 — native document access | Implemented | `bb8f4b1` | Rust document/resource safety matrix; thin Tauri adapters |
| 3 | ARC-02 — document session | Implemented | `4a91146` | Session success, failure, stale, image, Mermaid, replacement, and cleanup paths |
| 4 | ARC-04 — open intent | Implemented | `311e953`, `4abf14b` | Controller policy/race scenarios and non-destructive Rust delivery/coordinator tests |
| 5 | ARC-05 — reader preferences | Implemented | `4d16a30`, `4abf14b` | Load/apply/save/restore, corrupt storage, concurrency, native rollback, and memory fallback |

Closure fix `d778b9f` gives the browser preview a stable native-access error
instead of exposing an internal bridge exception. It does not change packaged
Tauri behavior. Independent-review hardening `4abf14b` closes delivery ordering,
cancellation, acknowledgment, coordinator, path-case, pin-race, and blocked
storage acquisition gaps.

## Acceptance ledger

### ARC-01

- `check:frontend` combines deterministic static checks with executable shell
  scenarios.
- Behavior-preserving source moves no longer depend on validator spelling.
- The pre-existing 47 frontend tests remain covered by the expanded suite.

### ARC-03

- `document_access.rs` owns document/resource policy, rendering, metadata,
  validation, and filesystem errors.
- `lib.rs` composes runtime and commands; `images.rs` has no upward helper
  dependency.
- Dead welcome and legacy payload paths are removed.

### ARC-02

- `DocumentSession` privately owns generation cancellation and Blob cleanup.
- Stale work cannot commit DOM, focus, document state, or retained resources.
- The composition root wires hooks and adapters without reimplementing the
  lifecycle.

### ARC-04

- All six ingress paths map to one open-intent model.
- Pre-ready requests preserve FIFO order; duplicate event/list delivery shares
  one operation and acknowledgment.
- Event/list replay is merged by native ID; case-distinct POSIX paths remain
  distinct; disposal cannot acknowledge unfinished work; a failed ack retries
  without reopening.
- Superseded operating-system requests move to a new window, and one live
  webview coordinates delivery even after `main` closes.
- Local and operating-system window policies, unsupported input, and partial
  window failure are executable.

### ARC-05

- One preferences owner handles all four current persisted settings.
- Existing keys and formats remain compatible.
- Storage corruption/unavailability and native always-on-top failure have
  deterministic fallbacks.
- Native pin changes serialize without blocking theme/tools/fonts, and failure
  to acquire Web Storage falls back to the in-memory adapter.

## Verification contract

The release-independent gate is `bun run verify`: frontend static and
behavior checks, all Vitest tests, production build and bundle budgets, Rust
formatting, type-checking, and unit tests. The stabilized checkpoint passed 2/2
public-shell checks, 72/72 frontend tests, and 11/11 Rust tests. Browser proof
covers the Vite shell at desktop and narrow widths, explicit keyboard
activation/dismissal and focus return, a semantic accessibility scan,
preference reload, and a real dependency-error state. Full sequential physical
Tab traversal is not claimed because the in-app browser backend could not
reproduce it reliably.

The independent implementation review passed after its material race and
contract findings were repaired with regression tests. No P1/P2 blocker
remains. The final residuals are packaged platform timing, the pre-existing
filesystem check/read TOCTOU window, and rare case-sensitive NTFS directories.

Native file-association timing on macOS and Linux remains a platform CI/smoke
gate because this implementation host is Windows. The queue and controller
semantics are covered deterministically, but that does not substitute for a
packaged platform launch.

## Follow-up rule

Do not add a generic event bus, dependency-injection container, settings
framework, or versioned wire protocol without a new concrete caller or
compatibility need. Extend the existing deep owner when the new behavior shares
its invariants; create another seam only when the deletion test proves it.

## Batch 2026-07-30 — UI and editor ownership

This execution batch tracks exactly ten implementation-ready improvements.
Work the frontier top to bottom; the linear blocking edges keep repeated edits
to the two current composition modules independently green.

### ARC-06 — Own native window chrome lifecycle

**Type:** AFK
**Status:** Implemented
**Blocked by:** None — can start immediately.

**What to build:** One Window Chrome module sets up native controls, reflects
maximize state and disposes every native listener without exposing event
ordering to the composition root.

- [x] Fake-window behavior covers maximize, unmaximize, native actions and dispose.
- [x] `main.js` no longer stores native-window listener cleanup.
- [x] Shell checks and the focused module test pass.

### ARC-07 — Own toast presentation lifecycle

**Type:** AFK
**Status:** Implemented
**Blocked by:** ARC-06.

**What to build:** One Toast Presenter owns message replacement, shape morph,
timeouts, rapid interruption, fallback and cleanup.

- [x] First show and visible replacement preserve one live accessible message.
- [x] Reduced motion and missing Web Animations degrade cleanly.
- [x] Rapid replacement/dispose leaves no stale node, timer or animation.

### ARC-08 — Coordinate theme preparation and commit

**Type:** AFK
**Status:** Implemented
**Blocked by:** ARC-07.

**What to build:** One Theme Coordinator coalesces rapid requests, prepares
diagrams/highlighting, commits tokens under the available transition and
reports persistence/feedback through injected hooks.

- [x] Latest request wins without committing stale prepared diagrams.
- [x] Preparation failure leaves the current theme usable and the queue drainable.
- [x] Reduced-motion, fallback, interruption and dispose paths are tested.

### ARC-09 — Coordinate document mode transitions

**Type:** AFK
**Status:** Implemented
**Blocked by:** ARC-08.

**What to build:** One Document Mode Coordinator owns Read/Edit/Source order,
toggle semantics, rendered transition milestones and cancellation cleanup.

- [x] Read -> Edit -> Source -> Read and Read/Edit toggle preserve behavior.
- [x] Canceled dirty exit does not advance mode.
- [x] View Transition, fallback, interruption, reduced motion and dispose are green.

### ARC-10 — Coordinate document mutations and save scheduling

**Type:** AFK
**Status:** Implemented
**Blocked by:** ARC-09.

**What to build:** One Document Save Coordinator owns editor debounce and the
serialized read-task mutation path with deterministic rollback and feedback.

- [x] Autosave replaces stale timers and respects disabled/error/saving states.
- [x] Read-task saves serialize and roll back the exact failed checkbox/source.
- [x] Document replacement and disposal cannot commit stale follow-up work.

### ARC-11 — Own reading navigation chrome

**Type:** AFK
**Status:** Implemented
**Blocked by:** ARC-10.

**What to build:** One Reading Navigation controller owns the active view,
line guide, minimap document/viewport, scroll progress, pointer/keyboard input,
resize observation, scheduling and disposal.

- [x] Read/Edit/Source line guides and minimap snapshots use the active view.
- [x] Pointer and keyboard navigation map to the real reader scroll owner.
- [x] Observer/RAF/listeners dispose cleanly and focused DOM tests pass.

### ARC-12 — Deepen the editor document model

**Type:** AFK
**Status:** Implemented
**Blocked by:** ARC-11.

**What to build:** Extend the Editor Document module so canonical blocks,
history, cursor, CRUD, split/merge and serialization live behind one model
interface rather than inside the DOM session closure.

- [x] Model behavior covers Markdown/TXT mutation and independent undo/redo.
- [x] Editor session observes model snapshots instead of owning history arrays.
- [x] Existing editor user paths remain green.

### ARC-13 — Own editor overlay lifecycle

**Type:** AFK
**Status:** Implemented
**Blocked by:** ARC-12.

**What to build:** One Editor Overlay controller owns command/block menus,
filtering, viewport-aware position, keyboard/outside dismissal and focus return.

- [x] Commands and disabled states remain derived from current block context.
- [x] Edge placement, Escape, keyboard activation and outside dismissal are tested.
- [x] Disposal removes document listeners and temporary overlay state.

### ARC-14 — Own editor selection and inline formatting

**Type:** AFK
**Status:** Implemented
**Blocked by:** ARC-13.

**What to build:** One Editor Selection controller owns captured range, cursor
projection, inline toolbar state/actions, links and the animated caret echo.

- [x] Capture/restore and cursor reporting survive formatting actions.
- [x] Link apply/cancel and toolbar states keep focus and selection coherent.
- [x] Caret/reduced-motion/dispose paths leave no stale overlay or animation.

### ARC-15 — Own block drag and layout motion

**Type:** AFK
**Status:** Implemented
**Blocked by:** ARC-12 and ARC-14.

**What to build:** One Editor Block Interaction controller owns FLIP layout
motion and drag/drop identity, target geometry, reordering and cleanup.

- [x] Before/after targets and self-drop produce deterministic model operations.
- [x] Repeated drag/animation interruption leaves no stale class or animation.
- [x] Reduced motion, disposal and the complete editor suite pass.
