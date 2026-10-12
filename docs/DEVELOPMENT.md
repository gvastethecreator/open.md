# Development guide

Layout, commands, and CI for working in this repository. Start from the [README](../README.md) for a shorter path.

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

Vite uses `127.0.0.1:33223`. If the port is occupied, reuse the existing server or stop its process before starting another. Startup does not terminate the process that owns the port.

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

`check:frontend` validates static assets, config, themes, and Pages. `test:frontend` runs all frontend tests, including reader-shell scenarios over real `index.html` with fake adapters. Use `check:shell` to run only those scenarios.

For the full gate, run `pnpm run verify` instead of repeating the commands above. Rust tests compile the backend, so this gate omits a separate `check:rust` pass. Keep `check:rust` for a quick compile check during development. CI runs `verify` on Linux, Windows, and macOS to cover their native branches. The Linux job also runs the pnpm and Cargo dependency audits.

Store validation reads repository files without installing dependencies or repeating `verify`. A manually requested signed candidate still runs `verify` before loading the signing certificate.

VS Code tasks mirror these commands. **Build** runs `pnpm run tauri build`, whose Tauri hook builds and checks the frontend bundle. **Verify** runs the full gate separately; Build does not run it automatically.

Use the [code map](codemap/codemap.md) to find module relationships and related tests. The [interactive map](codemap/codemap.html) includes source evidence and analysis limits.

`src/status-metrics.js` derives format-specific status values. `src/status-presenter.js` displays them. `src/json-property-model.js` validates and updates JSON properties; `src/json-property-editor.js` owns their controls. `src/editor-session.js` connects that surface to document history and saving.

Reproduce the Rust audit locally with the pinned tool version used in CI:

```bash
cargo install cargo-audit --version 0.22.2 --locked
cargo audit --file src-tauri/Cargo.lock
```

## Native file associations

Packaged builds register `.md`, `.markdown`, and `.txt` as viewer associations. Advanced options → System can open the OS default-app flow and toggle multi-instance process policy. See [File associations](FILE_ASSOCIATIONS.md).

## Themes and third-party material

The theme catalog is a line-ending-normalized copy of the Gogh dataset at a fixed upstream commit. Read [Bundled themes](THEMES.md) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before you change theme data. After changing `src/themes.json`, run `pnpm run generate:themes`. Frontend validation rejects a stale or incomplete runtime projection.

Theme changes prepare Mermaid output before the visual commit so diagrams do not reflow mid-transition. The root wipe keeps the outgoing snapshot above the incoming snapshot while its clip path closes. Toast copy crossfades in one shared grid cell and must not use vertical transforms.

## Release scope

Local builds are unsigned. A release process, signing identity, and hosted binary distribution are not part of the current repository contract. Do not describe a local build as signed or as an official release.
