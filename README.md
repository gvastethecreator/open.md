# open.md

A quiet desktop reader and editor for local Markdown and plain-text files.

[Project site](https://gvastethecreator.github.io/open.md/) · [Source and issues](https://github.com/gvastethecreator/open.md)

`open.md` is a small Tauri desktop application for reading and editing `.md`,
`.markdown`, and `.txt` files, plus companion formats opened in-app (JSON, CSV,
common config/text sidecars, and local raster images). Drop a file onto the
window, open it from the file picker, or use the operating system's **Open
with** menu. Documents stay local: the app does not fetch remote images.
Opening a file never writes to it; **Edit** and save change only the document
you choose to modify.

> Status: early development (`0.1.0` development milestone). The reading and
> editing paths are usable, but behaviour may still change before a tagged
> release.

## Features

- Markdown and plain-text reading, plus in-app companions (JSON, CSV, config-
  style text, and local raster images).
- Independent **Rendered/Source** and **Read only/Edit** controls. Markdown
  Rendered Edit uses per-block live preview; Source Edit is one continuous
  full-file surface. Optional block tools live under View options. See
  [Editing](docs/EDITING.md).
- Drag and drop, native file associations, and multi-window document opens.
  Optional single-instance mode (Advanced → System) reuses one process for
  Open with / second launches; multiple instances are allowed by default.
- Syntax-highlighted code blocks and Mermaid diagrams.
- Relative document links and bounded local images from the opened document's
  directory.
- Persistent themes, keyboard shortcuts, zoom controls, and reduced-motion
  support.

## Quick start

Install [Rust](https://www.rust-lang.org/), [Node.js](https://nodejs.org/), [pnpm](https://pnpm.io/), and the
platform dependencies required by
[Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm run tauri dev
```

To run the frontend without a native window:

```bash
pnpm run dev
```

## Build locally

```bash
pnpm run tauri build
```

This creates a local bundle under `src-tauri/target/release/bundle/`. The
repository does not currently publish installers or hosted release binaries.

## Documentation

- [Development and checks](docs/DEVELOPMENT.md) — project layout, local
  commands, and CI expectations.
- [Editing](docs/EDITING.md) — the four mode combinations, block tools, and save.
- [GitHub Pages landing](docs/PAGES.md) — local preview, deployment, and media
  provenance.
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
