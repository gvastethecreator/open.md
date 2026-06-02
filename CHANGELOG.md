# Changelog

All notable changes to OpenMD are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/) once a
stable release is cut.

## [Unreleased]

### Added
- Public release metadata: `LICENSE` (MIT), `SECURITY.md`,
  `CONTRIBUTING.md`, and this `CHANGELOG.md`.
- Repository fields in `package.json` and `src-tauri/Cargo.toml`.
- Tauri identifier updated to `com.gvastethecreator.openmd`.
- `docs/THEMES.md` documenting the origin and licence of every bundled
  theme.

### Removed
- Unused Tauri scaffold assets `src/assets/javascript.svg` and
  `src/assets/tauri.svg`.
- Empty `src/themes/` directory.
- Internal product brief `PRD.md` (out of scope for the public repo).

### Changed
- `README.md` rewritten with a public-facing overview, install steps,
  development workflow, and licence section.
- `.gitignore` extended with common editor, OS, environment, and
  coverage artefacts.
- `.vscode/tasks.json` switched from `npm` to `bun` to match the actual
  package manager used by the project.

## [0.1.0] - 2026-02-06

### Added
- Initial public release of OpenMD: a Tauri v2 desktop viewer for
  `.md`, `.markdown` and `.txt` files.
- Markdown rendering via `pulldown-cmark` with `syntect` syntax
  highlighting, including a special case for `mermaid` fenced blocks.
- Mermaid diagram rendering in the frontend (`mermaid` package).
- Theme catalogue loaded from `src/themes.json` with persisted user
  choice (`localStorage`).
- Drag & drop support, multi-window opening via the Tauri single
  instance plugin, keyboard shortcuts, and zoom controls.
- Frontend test suite with Vitest and a Rust test module covering the
  core rendering helpers.

[Unreleased]: https://github.com/gvastethecreator/open-md/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gvastethecreator/open-md/releases/tag/v0.1.0
