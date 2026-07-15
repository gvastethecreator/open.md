# Development guide

This document keeps the maintainer path behind the short [README](../README.md).
It describes the repository layout, the local checks, and the CI gates for
`open.md`.

## Repository layout

- `src/` — the Vite composition root, pure reader contracts, deferred Mermaid
  renderer, bounded image resources, styles, tests, and theme data.
- `src-tauri/` — the Rust rendering and file-access layer, Tauri configuration,
  capabilities, and native file-association metadata.
- `scripts/` — focused static validation used by the frontend check.
- `docs/` — developer and provenance documentation; private audit notes belong
  under the ignored `.local/` directory.

The frontend and native layers communicate through the Tauri command/event
bridge. The app is a viewer: opening a document does not write to it, and
relative images are resolved within the opened document's directory.

## Local setup

Install Rust stable, Bun 1.1 or newer, and the platform prerequisites listed by
[Tauri](https://v2.tauri.app/start/prerequisites/). Bun is required by the
repository's Tauri development and build configuration.

```bash
bun install
bun run tauri dev
```

Useful development-only commands:

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start Vite without a native window. |
| `bun run build` | Build the frontend and enforce its initial-load budget. |
| `bun run check:bundle` | Recheck an existing `dist/` bundle and print raw/gzip sizes. |
| `bun run generate:themes` | Regenerate the nine-field runtime theme projection. |
| `bun run tauri build` | Build a local native bundle. |

## Checks

Run the focused checks that match the files you changed:

```bash
bun run check:frontend
bun run test:frontend
bun run build
bun run fmt:rust
bun run check:rust
bun run test:rust
```

`bun run verify` runs frontend validation/tests, the production build and
bundle budget, plus the Rust formatting, type-check, and unit-test gates. CI
runs the same gates on Linux, Windows, and macOS, then runs separate Bun and
Cargo dependency audits.

The Bun audit uses the lockfile and reports known package advisories. The Rust
audit uses `cargo-audit` against `src-tauri/Cargo.lock`; install a pinned tool
version locally when reproducing the CI gate:

```bash
cargo install cargo-audit --version 0.22.2 --locked
cargo audit --file src-tauri/Cargo.lock
```

## Native file associations

Packaged builds register `.md`, `.markdown`, and `.txt` as viewer
associations. See [File associations](FILE_ASSOCIATIONS.md) for the platform
handoff and default-app policy.

## Runtime boundaries

- `src/core/reader.js` owns pure reader policy and can be tested without
  loading Tauri or the browser composition root.
- `src/mermaid-renderer.js` loads Mermaid only when a document contains a
  diagram and serializes operations on Mermaid's singleton renderer.
- `src/image-resources.js` owns the 64 MiB per-document Blob URL budget and
  revocation lifecycle; Rust returns validated local image bytes directly.
- `src-tauri/src/images.rs` owns image path containment, type validation, and
  the 12 MiB per-image boundary.

## Themes and third-party material

The theme catalogue is a line-ending-normalized copy of the Gogh dataset at a
fixed upstream commit. Read [Bundled themes](THEMES.md) and
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before changing or adding
theme data. After changing `src/themes.json`, run `bun run generate:themes`;
frontend validation rejects a stale or incomplete runtime projection.

## Release scope

Local builds are unsigned. A release process, signing identity, and hosted
binary distribution are not part of the current repository contract; do not
describe a local build as signed or as an official release.
