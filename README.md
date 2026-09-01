<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/document.svg?title=open.md&subtitle=A+quiet%2C+local-first+Markdown+reader+and+editor&logo=tauri&theme=blue&align=center&mode=dark" />
    <img alt="open.md" src="https://shieldcn.dev/header/document.svg?title=open.md&subtitle=A+quiet%2C+local-first+Markdown+reader+and+editor&logo=tauri&theme=blue&align=center&mode=light" />
  </picture>
</p>

<p align="center">
  <a href="https://github.com/gvastethecreator/open.md/actions/workflows/ci.yml"><img alt="CI status" src="https://shieldcn.dev/github/ci/gvastethecreator/open.md.svg?workflow=ci&branch=main&variant=secondary&size=xs" /></a>
  <a href="https://gvastethecreator.github.io/open.md/"><img alt="Project site" src="https://shieldcn.dev/badge/site-live-2563eb.svg?logo=githubpages&variant=branded&size=xs" /></a>
  <a href="https://github.com/gvastethecreator/open.md/stargazers"><img alt="GitHub stars" src="https://shieldcn.dev/github/stars/gvastethecreator/open.md.svg?variant=secondary&size=xs" /></a>
  <a href="https://github.com/gvastethecreator/open.md/commits/main"><img alt="Last commit" src="https://shieldcn.dev/github/last-commit/gvastethecreator/open.md.svg?variant=secondary&size=xs" /></a>
  <a href="LICENSE"><img alt="MIT license" src="https://shieldcn.dev/github/license/gvastethecreator/open.md.svg?variant=secondary&size=xs" /></a>
</p>

A quiet desktop reader and editor for local Markdown and plain-text files.

[Project site](https://gvastethecreator.github.io/open.md/) · [Source and issues](https://github.com/gvastethecreator/open.md)

`open.md` is a small Tauri desktop app for `.md`, `.markdown`, and `.txt` files,
plus companion formats opened in-app (JSON, CSV, common config and text
sidecars, and local raster images). Scene `.nfo` art and `.log` files open for
Read and Source only. Drop a file onto the window, use the file picker, or use
the operating system's **Open with** menu. Documents stay local. The app does
not fetch remote images. Opening a file never writes to it. **Edit** and save
change only the document you choose to modify.

> Status: early development (`0.1.0` development milestone). The reading and
> editing paths are usable. Behavior can still change before a tagged release.

## Product tour

| Rendered reading                                                                                                                         | Source editing                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| <img src="docs/assets/landing/reader-desktop-dark.png" alt="open.md rendering a local Markdown document in a dark desktop window" /> | <img src="docs/assets/landing/source-edit-dark.png" alt="open.md editing the complete Markdown source in a dark desktop window" /> |
| **Keyboard guide**                                                                                                                       | **Narrow window**                                                                                                                  |
| <img src="docs/assets/landing/reader-help-light.png" alt="open.md keyboard and workflow guide in a light desktop window" />          | <img src="docs/assets/landing/reader-narrow-dark.png" alt="open.md preserving document hierarchy in a narrow dark window" />   |

## Features

- Markdown and plain-text reading, plus in-app companions (JSON, CSV, config-style text, and local raster images).
- Independent **Rendered/Source** and **Read only/Edit** controls. Markdown Rendered Edit uses Classic live preview (the active line is source; other lines are rendered). Source Edit is the same host with raw syntax. Scene `.nfo` and `.log` keep Edit unavailable. See [Editing](docs/EDITING.md).
- Drag and drop, native file associations, and multi-window opens. Optional single-instance mode (Advanced → System) reuses one process for Open with and second launches. Multiple instances are the default.
- Syntax-highlighted code blocks and Mermaid diagrams.
- Relative document links and bounded local images from the opened document's directory.
- Persistent themes, keyboard shortcuts, zoom, and reduced-motion support.

## Quick start

Install [Rust](https://www.rust-lang.org/), [Node.js](https://nodejs.org/), [pnpm](https://pnpm.io/), and the
platform dependencies required by [Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm run tauri dev
```

Frontend without a native window:

```bash
pnpm run dev
```

## Build locally

```bash
pnpm run tauri build
```

This creates a local bundle under `src-tauri/target/release/bundle/`. The
repository does not publish installers or hosted release binaries.

## Microsoft Store

The planned Windows Store edition uses Partner Center's **EXE or MSI app**
route with a signed, offline, current-user NSIS installer. Contracts live in
[the Store runbook](docs/store/README.md).

```powershell
pnpm run store:validate
```

The application is **not submission-ready**. Public submission stays blocked
until the product is reserved, a trusted code-signing certificate and immutable
versioned HTTPS hosting exist, the signed Tauri updater is implemented, and the
install, update, and uninstall matrix has evidence.

Privacy: [PRIVACY.md](PRIVACY.md). The Store-facing page is `docs/privacy.html`.

## Documentation

- [Development](docs/DEVELOPMENT.md) — layout, commands, and CI.
- [Dependency updates](docs/DEPENDENCY_UPDATES.md) — pnpm, Cargo, and audits.
- [Editing](docs/EDITING.md) — the four mode combinations and save.
- [GitHub Pages](docs/PAGES.md) — local preview, deploy, and media provenance.
- [File associations](docs/FILE_ASSOCIATIONS.md) — packaged **Open with** behavior.
- [Microsoft Store runbook](docs/store/README.md) — EXE submission and release evidence.
- [Privacy policy](PRIVACY.md) — English and Spanish.
- [Bundled themes](docs/THEMES.md) — Gogh provenance and licensing.
- [Contributing](CONTRIBUTING.md).
- [Security policy](SECURITY.md).

## Support

Support continued development through [GitHub Sponsors](https://github.com/sponsors/gvastethecreator) or [Ko-fi](https://ko-fi.com/gvaste).

## License

`open.md` is distributed under the [MIT License](LICENSE). Bundled third-party
material has its own notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
