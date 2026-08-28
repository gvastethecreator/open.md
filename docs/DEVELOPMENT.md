# Development guide

Maintainer path behind the short [README](../README.md). Domain vocabulary lives in [CONTEXT.md](../CONTEXT.md). Runtime owners live in [architecture/CURRENT.md](architecture/CURRENT.md).

## Repository layout

- `src/` — Vite composition root, reader, editor, tests, and theme data.
- `src-tauri/` — native document access, open-request, settings, file associations, and thin Tauri adapters.
- `scripts/` — static validation and Store helpers.
- `docs/` — public developer and provenance docs. Private notes belong under ignored `.local/` and `.scratch/`.

The frontend and native layers talk through the Tauri command and event bridge. Opening a document is read-only until the user enters **Edit** and saves. Relative images resolve inside the opened document's directory. The app never fetches remote images. OS associations register as a viewer. See [Editing](EDITING.md) and [File associations](FILE_ASSOCIATIONS.md).

## Local setup

Install Rust stable, **Node.js 24.19.0 and pnpm 12.0.0** (see `.node-version`, `packageManager` in `package.json`, and CI), plus the [Tauri](https://v2.tauri.app/start/prerequisites/) platform prerequisites. pnpm is required.

```bash
pnpm install
pnpm run tauri dev
```

| Command | Purpose |
| --- | --- |
| `pnpm run dev` | Start Vite without a native window. |
| `pnpm run build` | Build the frontend and enforce the initial-load budget. |
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

`check:frontend` keeps static asset, config, and theme invariants separate from reader-shell scenarios over real `index.html` with fake adapters. `pnpm run verify` runs those checks, all frontend tests, the production build and bundle budget, plus Rust format, type-check, and unit tests. CI runs the same gates on Linux, Windows, and macOS, then runs pnpm and Cargo dependency audits.

Reproduce the Rust audit locally with the pinned tool version used in CI:

```bash
cargo install cargo-audit --version 0.22.2 --locked
cargo audit --file src-tauri/Cargo.lock
```

## Native file associations

Packaged builds register `.md`, `.markdown`, and `.txt` as viewer associations. Advanced options → System can open the OS default-app flow and toggle multi-instance process policy. See [File associations](FILE_ASSOCIATIONS.md).

## Themes and third-party material

The theme catalogue is a line-ending-normalized copy of the Gogh dataset at a fixed upstream commit. Read [Bundled themes](THEMES.md) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before you change theme data. After changing `src/themes.json`, run `pnpm run generate:themes`. Frontend validation rejects a stale or incomplete runtime projection.

Theme changes prepare Mermaid output before the visual commit so diagrams do not reflow mid-transition. The root wipe keeps the outgoing snapshot above the incoming snapshot while its clip path closes. Toast copy crossfades in one shared grid cell and must not use vertical transforms.

## Release scope

Local builds are unsigned. A release process, signing identity, and hosted binary distribution are not part of the current repository contract. Do not describe a local build as signed or as an official release.
