# Changelog

All notable changes to `open.md` are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/) once a
stable release is cut.

## [Unreleased]

### Added

- Find in Read and Edit with Ctrl/Cmd+F, match navigation and screen-reader counts.
- JSON property key rename, scalar type changes, undo and redo.
- Copy and save actions for local images inside Markdown documents.

- Editor cursor motion slides between lines with a gradient trail. Disable it
  in Advanced options → Motion → **Editor cursor motion**. The setting is
  saved and respects **Reduce motion**.
- Classic scene `.nfo` companions open when the file is IBM Code Page 437.
  Read and Source use a VGA cell grid (PxPlus IBM VGA8). There is no editor.
  UTF-8 Kodi/Windows XML `.nfo` files stay ordinary text.
- `.log` companions are Read and Source only. There is no editor.


- Advanced options → **System**: **Allow multiple instances** (default on;
  native `settings.json`, applies on next launch) and **Set as default for
  Markdown…** (OS default-app UI / user-scoped MIME defaults; see
  `docs/FILE_ASSOCIATIONS.md`). System controls hydrate from native state
  before accepting clicks; association status feeds the action tooltip;
  settings writes use temp+replace.
- Empty-state logo shimmer: plays once ~2s after a new window boots, and
  again on logo or Open file hover (alpha-masked, exit fade, no hover restart loop;
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
  options under View options (motion, edge fade, theme memory, image defaults,
  and CSV row cap).
- Implicit plain-text companion open support (for example JSON, INI, NFO, and
  other sidecar config formats) via drop, CLI, and document links. OS
  associations and the file picker remain Markdown- and `.txt`-focused.
- Implicit raster image companion open support (PNG, JPEG, GIF, WebP, BMP,
  AVIF) with a centered fit-to-window view, wheel zoom, and drag pan.
- Source provenance and the applicable MIT notice for the bundled Gogh theme
  catalogue.
- Minimal issue and pull-request templates for welcoming contributions.
- Separate pnpm and Cargo dependency-audit gates in CI.
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

- Opening an additional window no longer blocks WebView2 on Windows.
- JSON undo and redo retain focus and pending edits through auto-save.
- Find scrolls to the matched text in long Source views. Zoom reuses the
  minimap snapshot, whose invisible line anchors now preserve document spacing.

- Opening image-heavy documents reveals the text before background enrichment.
  Images and diagrams load as they approach the viewport.
- Entering Edit preserves source bytes, line endings and Markdown markers.
  Unsafe JSON uses plain-text editing. Saves detect external file changes and
  keep the draft until the user reloads or confirms an overwrite.
- Edit image previews use document-relative resources. Theme labels appear
  before opening the catalog, and first-run appearance follows the OS.
- macOS shortcuts accept Cmd, native browser menus are suppressed, and
  single-instance launches restore and focus the existing window.
- Long Windows file names save without exceeding the temporary-name limit.
- Image and CSV preferences apply to the open document; structured Read
  preserves YAML indentation and TOML sections.

- Reduced motion no longer distorts Mermaid layout through near-zero SVG transitions.
- Updated indirect DOMPurify, Undici, and source-map-js dependencies to address security advisories.
- Settings use unique temporary files and replace the saved file without deleting it first.
- Document saves replace files directly on Windows, while keeping recovery for backups from older versions.
- Removed the unused port cleanup utility and its test, which could terminate other processes on Unix.
- The first document is editable when it opens before the editor finishes loading.
- Work from a closed or replaced document no longer applies late syntax, diagram,
  or clipboard feedback.
- Store validation reports a missing updater as a submission blocker instead
  of failing with a PowerShell property error.
- Full-document NFO and log Read no longer grow a Copy code overlay.
- Native save rejects scene `.nfo` and `.log` files so UTF-8 cannot overwrite them.
- Advanced **Reduce motion** now also stops JS/WAAPI chrome motion (toasts,
  tooltips, menus, theme wipe, status zoom), not only CSS and
  Classic trail/band.


- Minimap click/drag navigates to the correct document offset when the scaled
  preview is shorter than the rail.
- Classic edit keeps list markers and structural prefixes outside the editable
  text host so continuous selection cannot corrupt chrome.


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

- Mermaid diagrams render with Pele; colors follow the theme without re-rendering.
- Syntax colors use Shiki with real TOML and dotenv grammars; large files highlight in chunks.
- Editor updates avoid whole-document typography and navigation work per key.
  Source highlighting is deferred, large structured previews are bounded,
  native file commands run off the UI thread, and unused editor CSS is removed.
- Auto-save remains on by default; privacy text names automatic edits and
  immediate Read-mode task writes.
- pnpm selects Node 24.19.0 for contributors. Pages uploads only site files
  and assets, and code-map-only changes no longer trigger deployment.

- CI shares setup with dependency audits and no longer repeats the Windows gate in Store validation.
- CI action pins use setup-node 7.1.0, pnpm/action-setup 6.1.0,
  upload-artifact 7.0.2, and deploy-pages 5.0.1. The pnpm setup action now
  supports the project's pnpm 12 runtime.
- The full verification gate omits `cargo check`, which is covered by `cargo test`.
- JSON previews stop generating rows at the existing value limit. Source stays complete.
- Editing reuses the serialized document, and companion documents use one syntax pass.
- Frontend packages: `vite` 8.3.5, `vitest` 5.0.5, `jsdom` 30.1.3,
  `@chenglou/pretext` 1.0.0, `pele` 1.9.0, `shiki` 4.5.0, and Tauri JS
  API/CLI 2.12.4, dialog 2.8.3, and opener 2.7.2. The Cargo lockfile includes
  Tauri 2.12.5 and Tokio 1.54.1. Updated `undici` resolves three security
  advisories in the development dependencies, including one high-severity issue.
  The application includes Pretext's complete upstream license notices.
  The pnpm overrides are gone: they forced `picomatch` below the range Vite needs,
  and the dependents' own ranges now cover the earlier advisories.
  CI and docs now match `pnpm@12.0.0`.
- Markdown fences are language-tagged escaped HTML. Shiki is the
  display highlighter; native Syntect HTML is gone. Editor and diagram
  adapter chunks stay off the empty-window boot graph. Theme option nodes
  fill when the theme control is opened. JSON Read trees cap at 2,000
  values. Minimap uses diagram placeholders instead of cloning Mermaid SVG.
- Markdown Edit is Classic only (Obsidian-style source-line live preview).
  The Block surface, Block editor preference, slash menu, floating block
  toolbar, and inline format toolbar are removed. JSON properties stay a
  separate exclusive surface.
- Classic live preview uses the document heading scale, list indent, fenced
  code interiors, tables, and images instead of leaving most lines as body
  text.
- 2026-08-11 maintenance: `highlight.js` updated to 11.11.2, the Mermaid
  `dompurify` override moved to 3.4.13 to clear GHSA-55q2-fjhq-7xh7, and the
  Rust lockfile refreshed with the latest compatible crates (`html-escape`
  0.2.15 included). The responsive typography adapter now lazy-loads
  `@chenglou/pretext`, reducing initial boot JavaScript from 317,189 B to
  275,650 B while keeping its CSS fallback and tests.
- Maintenance: frontend packages updated to latest (`vite` 8.2, `jsdom` 30,
  `@tauri-apps/plugin-dialog` 2.7.2); Rust lockfile refreshed to latest
  compatible crates (`serde`/`serde_json`, dialog plugin, transitive tokio and
  related). README, development guide, contributing notes, and GitHub Pages
  landing copy now describe local edit/save and companion formats instead of a
  pure viewer. `.gitignore` covers accidental other package-manager lockfiles and common
  editor/Windows build noise. Removed unused `.ti-file-search` CSS mask rule.
- Edit mode defaults to **Classic** continuous source-line live preview
  (`editor-classic-surface.js`): only the active hard line is raw Markdown
  (with type-scaled typography), other lines are rendered, no block islands.
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
  side gutters are removed so text no longer shifts horizontally.
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
  runs a pnpm audit and a pinned `cargo-audit` gate.
- Extracted pure reader contracts from the UI composition root, deferred
  diagram rendering until a document contains a diagram, and reduced the initial
  JavaScript payload without removing diagram or theme support.
- Replaced base64 image IPC with validated raw bytes and bounded Blob URLs;
  document image resources now share a 64 MiB retained-byte budget.

### Security

- Raw HTML in Markdown is escaped instead of injected into the webview.
- Diagrams do not load remote images. Link schemes are limited to http, https,
  and mailto.
- Embedded images are blocked, and document-relative images have explicit
  count, concurrency, per-file size, type, and directory boundaries.
- Removed the unused broad Tauri file-system plugin permission in favour of a
  narrow Rust command for document-relative images.
- Disabled the unused global Tauri browser object; the frontend uses explicit
  ESM APIs and the narrow command bridge.

### Removed

- Diagram re-render before theme changes.

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
