# Development guide

This document keeps the maintainer path behind the short [README](../README.md).
It describes the repository layout, the local checks, and the CI gates for
`open.md`.

## Repository layout

- `src/` — the Vite composition root, reader shell, document/open/preference
  owners, editor surface and session modules, deferred Mermaid renderer,
  bounded image resources, styles, tests, and theme data.
- `src-tauri/` — native document access, open-request, settings, and
  file-association modules, thin Tauri adapters, configuration, and
  capabilities.
- `scripts/` — focused static validation used by the frontend check.
- `docs/` — developer and provenance documentation; private audit notes belong
  under the ignored `.local/` directory. Architecture ARC-01..45 are closed in
  [architecture/WORKPLAN.md](architecture/WORKPLAN.md); reviews there are
  historical completion records, not an open ticket queue.

The frontend and native layers communicate through the Tauri command/event
bridge. Opening a document is read-only until the user enters **Edit** and
saves; relative images resolve within the opened document's directory and the
app never fetches remote images. OS associations still register as a viewer
role; in-app edit does not change that bundle policy. See
[Editing](EDITING.md) and [File associations](FILE_ASSOCIATIONS.md).

## Local setup

Install Rust stable, **Node.js 24 and pnpm 11.20** (see `packageManager` in
`package.json` and CI), plus the platform prerequisites listed by
[Tauri](https://v2.tauri.app/start/prerequisites/). pnpm is required by the
repository's Tauri development and build configuration.

```bash
pnpm install
pnpm run tauri dev
```

Useful development-only commands:

| Command | Purpose |
| --- | --- |
| `pnpm run dev` | Start Vite without a native window. |
| `pnpm run build` | Build the frontend and enforce its initial-load budget. |
| `pnpm run check:bundle` | Recheck an existing `dist/` bundle and print raw/gzip sizes. |
| `pnpm run generate:themes` | Regenerate the nine-field runtime theme projection. |
| `pnpm run tauri build` | Build a local native bundle. |

## Checks

Run the focused checks that match the files you changed:

```bash
pnpm run check:frontend
pnpm run test:frontend
pnpm run build
pnpm run fmt:rust
pnpm run check:rust
pnpm run test:rust
```

`check:frontend` keeps static asset/config/theme invariants separate from
executable reader-shell scenarios over the real `index.html` with fake
adapters. `pnpm run verify` runs those checks, all frontend tests, the
production build and
bundle budget, plus the Rust formatting, type-check, and unit-test gates. CI
runs the same gates on Linux, Windows, and macOS, then runs separate pnpm and
Cargo dependency audits.

The pnpm audit uses the lockfile and reports known package advisories. The Rust
audit uses `cargo-audit` against `src-tauri/Cargo.lock`; install a pinned tool
version locally when reproducing the CI gate:

```bash
cargo install cargo-audit --version 0.22.2 --locked
cargo audit --file src-tauri/Cargo.lock
```

## Native file associations

Packaged builds register `.md`, `.markdown`, and `.txt` as viewer
associations. Advanced options → System can open the OS default-app flow and
toggle multi-instance process policy (native `settings.json` at boot). See
[File associations](FILE_ASSOCIATIONS.md) for the platform handoff and
default-app policy.

## Runtime boundaries

- `src/reader-shell.js` is the public composition seam. Production and shell
  tests mount the same document, open-intent, and preference owners.
- `src/document-session.js` owns open/cancel/render/enrich/focus/cleanup for
  one document, including stale generations and relative-image resources.
- `src/open-intent-controller.js` owns path normalization, readiness, order,
  duplicate native delivery, supported-file feedback, and current/new-window
  policy for every ingress.
- `src/reader-preferences.js` owns the four current preference schemas,
  defaults, storage fallback, notifications, and native pin rollback.
- `src/window-chrome.js`, `src/theme-coordinator.js`,
  `src/document-mode-coordinator.js`, `src/document-save-coordinator.js`, and
  `src/reading-navigation-controller.js` own UI/native lifecycles that the
  composition root connects through adapters and hooks. Theme state commits
  only after diagram preparation; save generations distinguish a same-path
  reload from a replacement document.
- `src/editor-document.js` owns canonical block state and history.
  `src/editor-session.js` projects an Obsidian-style live preview (active line
  as source Markdown, other lines as rendered preview). Classic (default) uses a
  continuous multiline host; Block editor (View options) enables the floating
  block toolbar, slash menu, and drag reorder. It composes the overlay,
  selection, and block-interaction controllers. Cursor snapshots reuse the
  frozen document projection instead of rebuilding the document.
- `src/core/reader.js` retains pure reader calculations that can be tested
  without Tauri or the browser composition root.
- `src/mermaid-renderer.js` loads Mermaid only when a document contains a
  diagram and serializes operations on Mermaid's singleton renderer.
- `src/image-resources.js` owns the 64 MiB per-document Blob URL budget and
  revocation lifecycle; Rust returns validated local image bytes directly.
- `src/status-metrics.js` owns format-aware status metric builders (profiles
  from `format-registry`).
- `src/json-property-model.js` and `src/json-property-editor.js` own minimal
  JSON property editing; the editor session mounts them when
  `editorKind` is `json-props`.
- `src-tauri/src/document_access.rs` owns canonical document/image access,
  supported types, rendering, metadata, containment, native byte limits, and
  user-chosen binary export (`save_bytes`).
- `src-tauri/src/images.rs` is the binary-response adapter for validated
  image bytes. `src-tauri/src/open_requests.rs` owns stable native delivery
  IDs, in-process pending replay, acknowledgment, and live coordinator-window
  handoff.

See [Architecture context](../CONTEXT.md), the
[architecture workplan](architecture/WORKPLAN.md), and
[ADR 0001](adr/0001-open-intent-delivery.md) for invariants and accepted
trade-offs.

## Themes and third-party material

The theme catalogue is a line-ending-normalized copy of the Gogh dataset at a
fixed upstream commit. Read [Bundled themes](THEMES.md) and
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before changing or adding
theme data. After changing `src/themes.json`, run `pnpm run generate:themes`;
frontend validation rejects a stale or incomplete runtime projection.

Theme changes prepare Mermaid output before the visual commit so diagrams do
not reflow mid-transition. The root wipe keeps the outgoing snapshot above the
incoming snapshot while its clip path closes; changing that stacking order
makes the wipe invisible. Toast copy crossfades in one shared grid cell and
must not use vertical transforms, so rapid feedback stays on a fixed baseline.

## Release scope

Local builds are unsigned. A release process, signing identity, and hosted
binary distribution are not part of the current repository contract; do not
describe a local build as signed or as an official release.
