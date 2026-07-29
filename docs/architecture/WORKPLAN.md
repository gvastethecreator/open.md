# Architecture workplan

Date: 2026-07-29
Status: implemented and verified; packaged platform smoke limits recorded

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
