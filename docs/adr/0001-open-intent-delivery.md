# ADR 0001: Deliver operating-system open requests by stable ID and acknowledgment

- Status: accepted
- Date: 2026-07-29
- Decision owners: open.md maintainers
- Related work: ARC-04

## Context

Files can enter the reader through cold launch arguments, Windows/Linux
single-instance delivery, macOS opened-file events, the picker, drag and drop,
or document links. Native events can arrive before the webview is ready, and
the same operating-system request can be observed once as a live event and
again through pending-request replay.

Destructively taking pending items loses work if the frontend has not finished.
Treating event and replay as separate opens can create duplicate windows.
Platform adapters must not each invent ordering, support, or window policy.

## Decision

Native single-instance and macOS paths are stored as an `OpenFileRequest`
with a stable numeric ID in an in-process queue. The native queue:

1. appends a request before attempting event emission;
2. lists pending requests non-destructively;
3. removes a request only after explicit acknowledgment.

The frontend translates event and replay payloads into the same association
intent. It uses the native ID as the delivery key, returns the same promise for
a duplicate key, merges listener events with the pending snapshot in ID order,
preserves pre-ready FIFO order, and acknowledges only after the operation
reaches a terminal result. Acknowledgment means “consumed by open policy,” not
“every file opened successfully”; unsupported paths and reported partial
failures are terminal results. Disposal or an unexpected rejected operation is
not terminal and is not acknowledged. A later duplicate retries a failed
acknowledgment without reopening the document.

Exactly one live webview coordinates native requests: `main` when present,
otherwise a reader window. Native emission targets that webview. If it is
destroyed with unacknowledged work, the same pending IDs are re-emitted to the
next coordinator.

Cold-launch arguments use the same policy but do not need queue acknowledgment.
Picker, drop, and document-link intents are local: the first supported item
replaces the current document. Launch or association intents use the current
window only when its session is idle; otherwise they open new windows.

## Consequences

- Event plus pending-list replay opens a request once in an active frontend
  session.
- A webview failure, reload, or coordinator-window close before acknowledgment
  leaves the request available while the native process remains alive.
- A full native process crash loses the in-memory queue. This decision closes
  event/readiness and live-webview handoff races; it does not provide durable
  replay or exactly-once recovery across process restarts.
- The frontend is the single authority for supported-file feedback and window
  policy; Rust remains responsible for in-process handoff and window
  construction.
- The frontend keeps at most 512 acknowledged, completed delivery promises.
  Active and unacknowledged entries are retained until they settle so cache
  pressure cannot break in-flight idempotency.

## Rejected alternatives

- **Destructive native take:** simpler API, but a webview failure after take can
  lose the request.
- **Event only:** cannot recover requests emitted before listener readiness.
- **Pending polling only:** adds latency and needless polling while the app is
  active.
- **Policy in Rust and JavaScript:** duplicates supported-type and window
  decisions across runtimes.
- **Durable or exactly-once transaction:** requires persistent queue/outcome
  state and cross-runtime commit semantics disproportionate to a local viewer.

## Verification

- Rust tests prove stable unique IDs, non-destructive listing, empty-request
  rejection, serialization, acknowledgment, and coordinator selection.
- Frontend tests prove event/replay order and deduplication, acknowledgment
  retry, no acknowledgment on disposal, in-flight cache safety, pre-ready FIFO,
  platform-aware path deduplication, superseded-association preservation,
  window policy, unsupported feedback, and partial new-window failure.
- Packaged macOS/Linux runtime timing remains a platform smoke gate.
