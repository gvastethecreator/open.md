# Changelog

All notable changes to OpenMD are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/) once a
stable release is cut.

## [Unreleased]

### Added

- Accessible Open, Help, theme, status, recovery, code-copy, and back-to-top
  controls across the empty, reading, loading, and error states.
- Bounded local-image loading for supported raster formats stored under the
  open document's directory.
- Theme contrast and link-policy regression tests across the full bundled
  theme catalogue.

### Changed

- Reworked the reading shell, help screen, responsive toolbar, tables, code
  blocks, focus lifecycle, zoom, and reduced-motion behaviour.
- Restored direct file-association and command-line launches through an
  explicit native-to-frontend path handoff.
- Updated frontend dependencies and pinned patched transitive versions; the
  production and full npm audits now report zero known vulnerabilities.
- Raised the documented Node.js fallback requirement to match Vite 8.

### Security

- Raw HTML in Markdown is escaped instead of injected into the webview.
- Mermaid uses strict security mode; unsafe link schemes and remote images are
  blocked with visible feedback.
- Embedded images are blocked, and document-relative images have explicit
  count, concurrency, per-file size, type, and directory boundaries.
- Removed the unused broad Tauri file-system plugin permission in favour of a
  narrow Rust command for document-relative images.

## [0.1.0] - 2026-06-02

The first tagged public release of OpenMD. Compared with the initial
commit on 2026-02-06, this release adds the public-release metadata
set, a hardened content security policy, English in-app copy, a
vendored code of conduct, and a CI workflow.

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
- Public-release metadata: `LICENSE` (MIT), `SECURITY.md`,
  `CONTRIBUTING.md`, `CHANGELOG.md`, and `CODE_OF_CONDUCT.md`
  (Contributor Covenant v2.1).
- Repository fields in `package.json` and `src-tauri/Cargo.toml`.
- Tauri identifier set to `com.gvastethecreator.openmd`.
- `docs/THEMES.md` documenting the origin and licence of every bundled
  theme.
- `.github/workflows/ci.yml` running `bun run verify` (frontend
  validation, frontend tests, Rust format check, `cargo check`, Rust
  unit tests) on Linux, Windows, and macOS for every push to `main`
  and every pull request.

### Changed

- `README.md` rewritten with a public-facing overview, install steps,
  development workflow, and licence section.
- `.gitignore` extended with common editor, OS, environment, and
  coverage artefacts.
- `.vscode/tasks.json` switched from `npm` to `bun` to match the
  actual package manager used by the project.
- In-app user-facing strings translated to clear professional English
  across `index.html`, `src/main.js`, and `src-tauri/src/lib.rs`
  (welcome banner, help screen, keyboard shortcut hints, file-picker
  filters, error messages, and the status pill). The frontend test
  fixture `getDisplayName('')` and the Rust render fixture were
  updated to match.
- Tauri `app.security.csp` tightened from `null` to a strict
  default-src / img-src / style-src / script-src / connect-src /
  font-src policy that allows the asset protocol, blob images, and
  the Tauri IPC bridge.

### Removed

- Unused Tauri scaffold assets `src/assets/javascript.svg` and
  `src/assets/tauri.svg`.
- Empty `src/themes/` directory.
- Internal product brief `PRD.md` (out of scope for the public repo).

[Unreleased]: https://github.com/gvastethecreator/open-md/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gvastethecreator/open-md/releases/tag/v0.1.0
