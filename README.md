# OpenMD

Minimalist Markdown/TXT viewer built with **Tauri v2**, **Rust**, **Vite**
and vanilla **JavaScript**. Open a `.md`, `.markdown` or `.txt` file from
your file manager, drag it into the window, or pick it from the in-app
dialog and you are reading it instantly.

> Status: **early development** (v0.1.0). The core reading experience is
> stable, but breaking changes between minor versions are still
> possible until a 1.0.0 release is cut.

## Features

- Open `.md`, `.markdown` and `.txt` files (double-click, drag & drop,
  or the in-app picker).
- Multi-window support: dropping several files opens one window per file.
- Markdown rendering via `pulldown-cmark` with `syntect` syntax
  highlighting and a dedicated `mermaid` fenced-block code path.
- Large theme catalogue (light, dark, and tinted) loaded from
  `src/themes.json`; the chosen theme persists across sessions.
- Relative `.md`/`.txt` links open in the same flow of reading.
- Keyboard shortcuts and zoom controls (Ctrl + scroll, Ctrl + 0/+/-).
- Single-instance behaviour: launching the app again with a file routes
  the file into a new window of the running instance.

## Tech Stack

| Layer    | Technology                                                        |
| -------- | ----------------------------------------------------------------- |
| Backend  | Rust (edition 2021) + Tauri v2                                    |
| Frontend | Vite, vanilla JS, `mermaid` for diagrams                          |
| Markdown | `pulldown-cmark` (Rust)                                           |
| Highlighting | `syntect` (Rust) — HTML emitted with colour tokens applied    |
| Plugins  | `tauri-plugin-fs`, `tauri-plugin-dialog`, `tauri-plugin-opener`, `tauri-plugin-single-instance` |

## Repository Layout

```
.
├── index.html              # Vite entrypoint
├── vite.config.js
├── package.json
├── bun.lock
├── scripts/
│   └── validate-frontend.mjs
├── src/                    # Frontend source
│   ├── main.js
│   ├── main.test.js
│   ├── styles.css
│   ├── themes.json
│   └── assets/
│       └── favicon.svg
├── src-tauri/              # Rust backend + Tauri config
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── icons/
│   └── src/
└── docs/
    └── THEMES.md
```

## Requirements

- [Rust](https://www.rust-lang.org/) (stable)
- [Bun](https://bun.sh/) ≥ 1.1 (or [Node.js](https://nodejs.org/) ≥ 18)
- The platform dependencies required by
  [Tauri v2](https://v2.tauri.app/start/prerequisites/) (WebView2 on
  Windows, WebKit on Linux/macOS, Xcode CLT on macOS, etc.)

## Install

```bash
bun install
```

## Development

Run the Vite dev server (frontend only):

```bash
bun run dev
```

Run the full Tauri app in development mode (frontend + native window):

```bash
bun run tauri dev
```

## Build a Release

```bash
bun run tauri build
```

The signed installer / bundle for your platform is written under
`src-tauri/target/release/bundle/`.

## Tests and Quality Gates

| Command                  | What it does                                          |
| ------------------------ | ----------------------------------------------------- |
| `bun run check:frontend` | Validate the frontend integration (HTML, CSS, JS, themes). |
| `bun run test:frontend`  | Run Vitest frontend tests.                            |
| `bun run fmt:rust`       | Verify Rust formatting with `cargo fmt --check`.      |
| `bun run check:rust`     | Type-check the Rust backend.                          |
| `bun run test:rust`      | Run the Rust unit tests.                              |
| `bun run verify`         | Run the full pre-package validation pipeline.         |

Run `bun run verify` before tagging a release or sending a pull request.

## Configuration

OpenMD does not currently require any environment variables, API keys or
external services. Optional configuration is read from
`src-tauri/tauri.conf.json` (window dimensions, identifier, file
associations, bundle targets).

## Themes

The bundled theme catalogue is curated in `src/themes.json`. See
[`docs/THEMES.md`](docs/THEMES.md) for the full list of authors,
sources, and licence notes.

## Contributing

Bug reports and pull requests are welcome. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup, the
contribution workflow, and the code of conduct. Security issues should
be reported privately following [`SECURITY.md`](SECURITY.md).

## Licence

OpenMD is released under the **MIT License** — see
[`LICENSE`](LICENSE) for the full text.

Copyright © 2026 gvastethecreator
