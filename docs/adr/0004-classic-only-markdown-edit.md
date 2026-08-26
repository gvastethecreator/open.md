# ADR 0004: Classic-only Markdown edit

- Status: accepted
- Date: 2026-08-26
- Decision owners: open.md maintainers

## Context

[ADR 0002](0002-exclusive-editor-surfaces.md) kept three exclusive edit
surfaces: Block (Rendered Markdown islands), Classic (source lines), and JSON
properties. Block also had optional Notion-style tools (slash menu, floating
toolbar, drag).

Classic already matches the Obsidian live-preview model: the active hard line
is raw Markdown, and the other lines are rendered. Block islands duplicated
that work and mixed caret, selection, and format owners.

## Decision

Markdown Edit uses only Classic.

1. Rendered Edit mounts Classic with Markdown preview on inactive lines.
2. Source Edit mounts the same Classic host with highlighted source.
3. JSON properties stay a separate exclusive surface.
4. The Block surface, Block editor preference, slash menu, floating block
   toolbar, inline format toolbar, and block-drag controllers are removed.

## Consequences

- Context menus for Markdown Edit use plain copy and paste, not block
  commands or `document.execCommand` formats.
- Stored `blockEditor` reading-tool values are ignored.
- Exclusive-surface isolation from ADR 0002 still applies to Classic and JSON.
