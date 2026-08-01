# Changelog

All notable changes to `open.md` are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/) once a
stable release is cut.

## [Unreleased]

### Changed

- Edit mode defaults to **Classic** continuous source-line live preview
  (`editor-classic-surface.js`): only the active hard line is raw Markdown
  (with type-scaled typography), other lines are rendered, no block islands.
  **Block editor** remains optional under View options → Editing.
- Classic keyboard navigation crosses hard lines with a sticky preferred
  column (retained across shorter lines), edge ArrowLeft/Right, Home/End,
  PageUp/Down, Enter split, and Backspace merge at column 0.
- Classic active-line highlight is full-bleed (0–100% editor width) and
  animates top+height between lines (FLIP; interrupted on retarget); snaps
  under reduced motion.
- Caret trail is optional Neovide/qwreey-inspired motion from caret geometry
  (idle stop, no runaway rAF under sync mocks).
- Advanced options include **Reduce motion** (OR with OS preference); kills
  trail and band travel.
- Read mode code blocks: top-right copy control with check success feedback
  (`is-copied`), error retry, and aria/tooltip restore after timeout.
- Minimap pointer mapping uses scaled document height so short documents end
  where the mini-document ends instead of stretching across empty rail space.
- Architecture batch ARC-26..35: format-detect is the frontend path/support
  authority; mode availability uses format-registry capabilities; document
  session and view-state share `resolveFormatId`; image MIME maps and status
  labels consolidate behind format owners; status metrics composition, zoom
  lifecycle, task-save projection, and remaining native surfaces leave the
  composition root; `startOpenMdApplication` is the executable composition
  seam. Initial boot JS budget is 380 KiB raw (Classic motion + copy polish).
- Default process policy is **multiple instances on**. When Advanced options →
  System → **Allow multiple instances** is off (and the app is restarted),
  single-instance path forwarding matches the previous always-on behavior.

### Added

- Advanced options → **System**: **Allow multiple instances** (default on;
  native `settings.json`, applies on next launch) and **Set as default for
  Markdown…** (OS default-app UI / user-scoped MIME defaults; see
  `docs/FILE_ASSOCIATIONS.md`). System controls hydrate from native state
  before accepting clicks; association status feeds the action tooltip;
  settings writes use temp+replace.
- Empty-state logo shimmer: plays once ~2s after a new window boots, and
  again on Open file hover only (alpha-masked, exit fade, no hover restart loop;
  respects reduce-motion).
- Format-aware chrome: status bar profiles per format (image dimensions/zoom,
  JSON key counts, CSV rows×cols, companion metrics without reading-time),
  context menus that match the open kind, image document actions (Copy image,
  Download image…, Fit, Actual size), and a minimal JSON property editor for
  valid object/array documents (plain fallback when invalid or oversized).
  Save/exit flushes in-progress property cells; string values stay literal;
  image export writes bytes without multi-MiB Array.from copies. Edit-mode
  presentation refresh no longer wipes the JSON property surface. Pending
  property cells flush into drafts on document switch; invalid cells stop
  autosave with an error state; image copy prefers PNG for clipboard;
  companion edit menus stay scoped to the editor surface.
- Format experience layer: extension + magic-byte resolution on open, explicit
  payload `format`/`kind`, rich Read for JSON/CSV/INI-family companions, full-
  document Source highlighting, plain monospace Edit for non-Markdown, image
  view-only mode with animated zoom (respects reduced motion), and Advanced
  options under View options (detection status, image defaults, text defaults,
  CSV row cap).
- Implicit plain-text companion open support (for example JSON, INI, NFO, and
  other sidecar config formats) via drop, CLI, and document links. OS
  associations and the file picker remain Markdown- and `.txt`-focused.
- Implicit raster image companion open support (PNG, JPEG, GIF, WebP, BMP,
  AVIF) with a centered fit-to-window view, wheel zoom, and drag pan.
- Source provenance and the applicable MIT notice for the bundled Gogh theme
  catalogue.
- Minimal issue and pull-request templates for welcoming contributions.
- Separate Bun and Cargo dependency-audit gates in CI.
- Accessible Open, Help, theme, status, recovery, code-copy, and back-to-top
  controls across the empty, reading, loading, and error states.
- Bounded local-image loading for supported raster formats stored under the
  open document's directory.
- Theme contrast and link-policy regression tests across the full bundled
  theme catalogue.
- Reproducible runtime-theme generation and a production bundle budget gate.
- Persisted always-on-top and typography controls, with independent sans and
  monospace font cycles.
- Conditional top and bottom reading-edge cues with a soft fade and blur for
  long, scrollable content.

### Fixed

- Minimap click/drag navigates to the correct document offset when the scaled
  preview is shorter than the rail.
- Classic edit keeps list markers and structural prefixes outside the editable
  text host so continuous selection cannot corrupt chrome.
- Flipping Classic ↔ Block from View options updates context chrome and keeps
  unsaved drafts.


- Unsupported-file feedback now mentions Markdown, text, and image companions
  instead of implying images are unsupported.
- Mislabeled image bytes under a text companion extension open as the image
  viewer; damaged image extensions fail closed instead of decoding as text.
- Mode morph no longer double-paints edge scrims (old + new snapshots), which
  darkened the gradient mid-transition and popped on tear-down. Tooltips and the
  minimap stay on named View Transition layers above the scrims instead of
  dropping under them.
- Status metrics no longer show a redundant tooltip that repeated the same line
  count / zoom text already visible in the status bar.
- The document minimap no longer shows a hover tooltip.
- Ctrl+F4 reliably closes the open file (matched by key or code) and returns to
  the empty shell, with the same dirty-document confirmation as open/replace.

### Changed

- Tooltips keep a short open delay, use trigger safe-zones against hover flicker,
  and update label text in place when the active control’s copy changes (for
  example during mode cycling) without closing or reopening the shell.
- Mode tooltips use a short label plus styled shortcut chips; mode morph no longer
  thrash-updates the open tooltip mid-transition.
- Toast and tooltip surfaces use a slightly darker solid fill.
- Mode changes announce `Edit mode`, `Read mode`, or `Source mode` via the
  existing toast morph pipeline.
- Ctrl+click (and Ctrl+Shift+click) on the theme/appearance control cycles
  themes the same way as `T` / `Shift+T`.
- Ctrl+F4 closes the current file and returns to the empty shell, reusing the
  dirty-document confirmation.

- Redesigned Edit mode as an Obsidian-style live preview: the active line shows
  source markup, other lines render as preview, the active line is highlighted,
  side gutters are removed so text no longer shifts horizontally, and block
  actions move to a floating bottom toolbar (inline format toolbar stays
  selection-based).
- Stabilized Edit-mode block dragging: blank Markdown separators keep their
  layout, blocks make room in real time while dragging, and edge drag
  auto-scroll supports long documents.
- Moved toast feedback to one interruptible WAAPI pipeline with a stable
  container, persistent text layers, and shape motion that avoids animated
  layout properties.
- Reworked the reading shell, help screen, responsive toolbar, tables, code
  blocks, focus lifecycle, zoom, and reduced-motion behaviour.
- Reworked the public README and developer documentation around the exact
  `open.md` brand; local builds are documented as unsigned.
- Restored direct file-association and command-line launches through an
  explicit native-to-frontend path handoff.
- Updated frontend dependencies and pinned patched transitive versions; CI now
  runs a Bun audit and a pinned `cargo-audit` gate.
- Extracted pure reader contracts from the UI composition root, deferred
  Mermaid until a document contains a diagram, and reduced the initial
  JavaScript payload without removing diagram or theme support.
- Replaced base64 image IPC with validated raw bytes and bounded Blob URLs;
  document image resources now share a 64 MiB retained-byte budget.

### Security

- Raw HTML in Markdown is escaped instead of injected into the webview.
- Mermaid uses strict security mode; unsafe link schemes and remote images are
  blocked with visible feedback.
- Embedded images are blocked, and document-relative images have explicit
  count, concurrency, per-file size, type, and directory boundaries.
- Removed the unused broad Tauri file-system plugin permission in favour of a
  narrow Rust command for document-relative images.
- Disabled the unused global Tauri browser object; the frontend uses explicit
  ESM APIs and the narrow command bridge.

## 0.1.0 development milestone - 2026-06-02

This was a development milestone, not a Git tag or GitHub release. Compared
with the initial commit on 2026-02-06, the milestone added repository metadata,
a hardened content security policy, English in-app copy, a vendored code of
conduct, and a CI workflow.

### Added

- Initial `open.md` desktop viewer baseline for
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
- Repository metadata: `LICENSE` (MIT), `SECURITY.md`,
  `CONTRIBUTING.md`, `CHANGELOG.md`, and `CODE_OF_CONDUCT.md`
  (Contributor Covenant v2.1).
- Repository fields in `package.json` and `src-tauri/Cargo.toml`.
- Tauri identifier set to `com.gvastethecreator.openmd`.
- `docs/THEMES.md` documenting the Gogh source commit and license for the
  bundled theme catalogue.
- `.github/workflows/ci.yml` running `bun run verify` (frontend
  validation, frontend tests, Rust format check, `cargo check`, Rust
  unit tests) on Linux, Windows, and macOS for every push to `main`
  and every pull request.

### Changed

- `README.md` rewritten as a short public-facing overview with install steps,
  local unsigned-build wording, and links to developer documentation.
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
- Tracked internal quality-audit notes (kept in the local, ignored archive).

[Unreleased]: https://github.com/gvastethecreator/open.md/commits/main
