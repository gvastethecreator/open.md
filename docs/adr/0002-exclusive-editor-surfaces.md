# ADR 0002: Exclusive editor surfaces

- Status: accepted (Block surface superseded by
  [ADR 0004](0004-classic-only-markdown-edit.md))
- Date: 2026-08-26
- Decision owners: open.md maintainers

## Context

The reader had three edit surfaces: Block (Rendered Markdown), Classic
(Source Edit and plain companions), and JSON properties. They shared one
canvas listener set in `editor-session.js`. Overlay, selection, and
block-drag controllers started for the whole session.

Two `selectionchange` listeners ran at once. The Block selection controller
cleared the cursor when Classic had no `[data-block-id]`. Classic then set
the cursor again. The inline format toolbar and custom caret echo also ran
on Source Edit. Markdown Source Edit menus offered Bold through
`document.execCommand`, which is not the Classic source model.

Those mixed owners produced erratic caret, status, and formatting behavior
that was hard to measure as a single failing value.

## Decision

Exactly one edit surface is mounted. That surface owns input. ADR 0004 later
removed the Block surface; the isolation rule still applies to Classic and
JSON.

Historical Block wiring:

1. Block binds canvas `input`, `keydown`, `click`, `focusin`, and `change`.
   The selection controller listens to `selectionchange` only then.
2. Classic binds its own canvas and `selectionchange` listeners in
   `editor-classic-surface.js` mount, and removes them on unmount.
3. JSON uses per-cell listeners. Session and selection listeners stay off.

Block tools (slash, floating toolbar, drag) are chrome on Block. They start
only while Block is mounted and the Block editor preference is on.

Context menus follow `session.current().presentation`, not file format.
Source Edit of a Markdown file uses plain copy and paste, not inline
`execCommand` formats.

The session still owns enter, exit, save, dirty, drafts, and presentation
switch. It unmounts the current surface before it mounts the next. If JSON
flush fails, JSON stays mounted.

## Consequences

- `CONTEXT.md` no longer says the session owns canvas listeners for every
  mode.
- Click-offset, wrap arrows, IME, and history coalescing stay later work.
  Isolation removes mixed owners. It does not repair Classic rebuilds.
- Overlay, selection, and block-drag expose `start` and `stop`. `start`
  while already started is a no-op.
- [ADR 0004](0004-classic-only-markdown-edit.md) removes the Block surface.
  Exclusive isolation remains for Classic and JSON.
