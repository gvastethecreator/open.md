# open.md

A quiet desktop viewer for Markdown and plain-text files.

`open.md` is a small Tauri desktop application for reading `.md`, `.markdown`,
and `.txt` files. Drop a file onto the window, open it from the file picker, or
use the operating system's **Open with** menu. The app renders local documents
without fetching remote images or modifying the files it opens.

> Status: early development (`0.1.0` development milestone). The reading path
> is usable, but behaviour may still change before a tagged release.

## Features

- Markdown, Markdown-with-extension, and plain-text viewing.
- Drag and drop, native file associations, and one-window-per-file launches.
- Syntax-highlighted code blocks and Mermaid diagrams.
- Relative document links and bounded local images from the opened document's
  directory.
- Persistent themes, keyboard shortcuts, zoom controls, and reduced-motion
  support.

## Quick start

Install [Rust](https://www.rust-lang.org/), [Bun](https://bun.sh/), and the
platform dependencies required by
[Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
bun install
bun run tauri dev
```

To run the frontend without a native window:

```bash
bun run dev
```

## Build locally

```bash
bun run tauri build
```

This creates a local bundle under `src-tauri/target/release/bundle/`. The
repository does not currently publish installers or hosted release binaries.

## Documentation

- [Development and checks](docs/DEVELOPMENT.md) — project layout, local
  commands, and CI expectations.
- [File associations](docs/FILE_ASSOCIATIONS.md) — how packaged builds
  integrate with the operating system's **Open with** flow.
- [Bundled themes](docs/THEMES.md) — source provenance and licensing for the
  theme catalogue.
- [Contributing](CONTRIBUTING.md) — setup, pull requests, and contribution
  expectations.
- [Security policy](SECURITY.md).

## License

`open.md` is distributed under the [MIT License](LICENSE). Bundled third-party
material has its own notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
