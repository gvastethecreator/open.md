# Architecture workplan

Date: 2026-07-29; updated 2026-07-30
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

### Independent-review hardening

This is closure work for ARC-06..15, not an eleventh ticket.

- `8e4a539` makes confirmed theme state transactional with prepared diagrams,
  blocks stale mode-morph markers after async cancellation, preserves true
  toast opacity during rapid replacement, and makes native resize observation
  fail soft.
- `98ce8eb` disables mode changes while a document is loading/failed, invalidates
  cross-document editor saves, and reuses the editor's structural snapshot for
  cursor-only updates.
- `50f5231` keeps same-path reload completion current while retaining stale
  invalidation for a different path or disposal.
- The 20,000-block cursor pressure check completed 25 cursor changes in 0.24 ms
  total and reused the frozen block/stat projections.
- Final local gate: 364 themes, four public-shell scenarios, 155/155 frontend
  tests in 21 files, production build/bundle budgets, Rust fmt/check, and
  15/15 Rust tests.
- Existing-Chrome post-refactor smoke remains unclaimed because `mcporter` is
  unavailable on this host; no isolated browser was substituted.

## Batch 2026-07-30 — Composition-root policy seams

This execution batch tracks exactly ten distinct improvements left after
ARC-01..15. Work the frontier in the order below; each ticket keeps
`main.js` as the composition root while moving one invariant set behind a
tested module interface.

### ARC-16 — Own reader controls and preference projection

**Type:** AFK
**Status:** Implemented
**Blocked by:** None — can start immediately.

**What to build:** One Reader Controls module owns reading-tools and typography
panels, preference-to-DOM projection, focus return, source scroll memory, and
always-on-top/auto-save actions while `reader-preferences.js` remains the
persisted model owner.

- [x] Load and apply a preference snapshot without leaking panel/ARIA policy to the root.
- [x] Toggle controls preserve document availability, focus return, scroll memory, and volatile feedback.
- [x] Focused DOM tests and the existing preference/shell suites pass.

### ARC-17 — Own status presentation

**Type:** AFK
**Status:** Implemented
**Blocked by:** None — can start immediately.

**What to build:** One Status Presenter renders identity, Read metrics, Edit
metrics, accessible labels, reusable metric nodes, zoom motion, and clear
state behind a small render interface.

- [x] Metric order and DOM identity remain stable across Read/Edit updates.
- [x] Reduced-motion and missing-animation paths leave no stale animations.
- [x] Focused presenter tests cover empty, document, cursor, and clear states.

### ARC-18 — Own reader viewport and help projection

**Type:** AFK
**Status:** Planned
**Blocked by:** ARC-17.

**What to build:** One Reader Viewport Controller owns empty/content/help stage
visibility, inertness, page state, help focus capture/return, body classes, and
scroll reset without owning document loading.

- [ ] Empty, content, and help states project correct visibility and ARIA/inert state.
- [ ] F1/Escape and replacement return focus deterministically without scroll jumps.
- [ ] Narrow DOM tests cover repeated open/close and disposal.

### ARC-19 — Own editor save feedback presentation

**Type:** AFK
**Status:** Planned
**Blocked by:** ARC-17 and ARC-18.

**What to build:** One Editor Feedback Presenter maps editor snapshots to save
button state, icon, label, tooltip, ARIA, body state classes, and mode/metric
hooks while save scheduling remains in `document-save-coordinator.js`.

- [ ] Saved, dirty, saving, error, and recovered states render complete feedback.
- [ ] Mode changes close transient context UI and refresh the correct navigation/status hooks.
- [ ] Focused presenter tests cover every state and repeated transitions.

### ARC-20 — Own document content actions

**Type:** AFK
**Status:** Planned
**Blocked by:** ARC-16 and ARC-18.

**What to build:** One Document Content Actions module resolves Read/Source/Edit
context actions and owns selection capture, clipboard fallback, paste, task
mutation, and editor action adapters behind a small context interface.

- [ ] Links, code, tasks, images, tables, diagrams, selections, source, and blocks keep their action sets.
- [ ] Clipboard failure restores selection/focus and reports a user-facing error.
- [ ] Focused action tests execute representative actions in all three modes.

### ARC-21 — Own document ingress adapters

**Type:** AFK
**Status:** Planned
**Blocked by:** ARC-23 and ARC-25.

**What to build:** One Document Ingress Controller owns picker, association
event replay/acknowledgment, global drag safety, native drag-drop, and
document-change guards while the Open Intent controller owns request policy.

- [ ] Preview/no-native mode remains usable and native association replay stays FIFO/idempotent.
- [ ] Drag/drop and picker refuse document replacement while a dirty edit is blocked.
- [ ] Listener teardown and failure fallback are tested.

### ARC-22 — Own document view-state projection

**Type:** AFK
**Status:** Planned
**Blocked by:** ARC-17, ARC-18, and ARC-19.

**What to build:** One Document View State module owns the current identity
snapshot and loading/ready/failed/idle fan-out to title, URL, editor, save,
navigation, viewport, and status adapters.

- [ ] Loading a different path clears stale editor content and save state.
- [ ] Ready, failed, idle, and replacement transitions publish one coherent snapshot.
- [ ] Tests prove stale consumer state cannot survive replacement.

### ARC-23 — Own application runtime adapters

**Type:** AFK
**Status:** Planned
**Blocked by:** None — can start immediately.

**What to build:** One Application Runtime Adapters module owns native/preview
document open/save, native command guards, lazy syntax highlighting, diagram
adapters, and window adapters behind the existing Reader shell adapter shape.

- [ ] DEV preview open/save delay/failure behavior remains deterministic.
- [ ] Browser preview reports the stable native-access error and does not call Tauri.
- [ ] Adapter tests cover both environment branches and lazy syntax loading.

### ARC-24 — Own reader keyboard shortcuts

**Type:** AFK
**Status:** Planned
**Blocked by:** ARC-16, ARC-17, ARC-18, and ARC-21.

**What to build:** One Reader Keyboard Controller owns shortcut precedence,
editable-target guards, Escape/focus behavior, open/save, zoom, theme, help,
and mode commands behind injected callbacks.

- [ ] F1, Escape, open, save, zoom, theme, and Edit shortcuts preserve precedence.
- [ ] Inputs, selects, textareas, and contenteditable surfaces keep their text-editing behavior.
- [ ] Keyboard tests cover reduced/error/unavailable states and disposal.

### ARC-25 — Own application lifecycle and teardown

**Type:** AFK
**Status:** Planned
**Blocked by:** ARC-16 through ARC-24.

**What to build:** One Application Lifecycle module owns event registration,
startup ordering, beforeunload cleanup, partial-start failure isolation, and
idempotent disposal while `main.js` supplies concrete mounts and adapters.

- [ ] Startup order is explicit and a failed optional adapter does not strand the shell.
- [ ] Beforeunload and disposal release every listener/controller exactly once.
- [ ] Fake-mount lifecycle tests cover success, partial failure, and repeated dispose.

### Batch closure rule

This is not a generic extraction exercise. A ticket closes only when its
module owns behavior behind a smaller interface, its focused tests cross that
interface, the old root policy is removed, and the relevant integration gate
remains green. Do not add an event bus, settings framework, or new public
runtime contract as part of this batch.
