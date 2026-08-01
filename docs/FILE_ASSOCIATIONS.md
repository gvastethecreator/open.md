# open.md file associations

Packaged `open.md` builds register `.md`, `.markdown`, and `.txt` as viewer
associations. Registration makes `open.md` available in the operating system's
**Open with** UI; it does not silently replace the user's default application.

Runtime may also open a small set of plain-text companion files (for example
JSON, INI, YAML, TOML, CSV, or NFO) and common raster images (PNG, JPEG, WebP,
and similar) via drag-and-drop, CLI paths, or forced Open with. Those formats
are not registered as associations and do not appear in the file picker filter;
the product surface stays Markdown-focused.

Format resolution uses the file extension first, then content magic bytes on
accepted paths: a text companion that is actually a PNG (or other known raster)
opens as an image viewer; an image extension whose content is not a valid image
fails closed. Unknown extensions are rejected with feedback and never opened as
text. Payloads carry an explicit `format` / `kind` so the UI prefers that over
path re-guess alone.

Companions get richer Read when possible (JSON tree, CSV table, structured
INI/YAML-family views), full-document Source highlighting where languages are
available, and format-aware Edit (JSON property rows when valid; plain
monospace otherwise). Images are view-only (no Edit/Source) with context
actions to copy or download the image and fit/actual-size zoom. The status bar
adapts metrics to the open format (for example dimensions for images, key
counts for JSON).

## In-app controls

Advanced options → **System** exposes two desktop-only actions:

| Control | Default | Effect |
| --- | --- | --- |
| **Allow multiple instances** | On | When **on**, each OS launch may start a new process. When **off**, the single-instance plugin reuses the running process and forwards paths. The disk value is read at native boot; changing the toggle applies on **next launch**. |
| **Set as default for Markdown…** | Action | Opens or updates the OS default-app path for the packaged Markdown/text types. Never changes the default without this explicit gesture. |

Native settings live in the app config directory as `settings.json`
(`allowMultipleInstances`), written with a same-directory temp file + replace.
Frontend `localStorage` is not the source of truth for multi-instance mode
because the decision happens before the webview loads. Advanced → System
controls stay disabled until the first successful native hydrate so the switch
cannot write against a stale default.

### Platform association action

| Platform | What the button does | Notes |
| --- | --- | --- |
| Windows | Opens **Settings → Default apps** (`ms-settings:defaultapps`) | Silent default changes are blocked by the OS. Packaged installers still register Open With. |
| macOS | Opens System Settings (default apps when available) | Bundle types come from the packaged app. Users can also use Finder → Get Info → Open with → Change All. |
| Linux | Prefers `xdg-mime default` for `text/markdown` and `text/plain` with known `.desktop` names; falls back to DE settings | Requires a packaged install that publishes a desktop entry. |

`cargo tauri dev` does not install OS associations. The action may open settings
or report that a packaged install is required.

## Runtime behavior

| Platform | Cold launch | App already running |
| --- | --- | --- |
| Windows | The installer registers the extensions and selected paths arrive as command-line arguments. The first supported path uses the idle main window; additional paths use new windows **within that process**. | If multiple instances are **off**, the single-instance adapter stores and emits one acknowledged request. An idle window may take the first supported path; an occupied window is preserved and each path opens separately. If multiple instances are **on**, the OS may start another process. |
| macOS | Launch Services sends file URLs through Tauri's `RunEvent::Opened`. Requests remain pending until the webview consumes and acknowledges them. | Same acknowledged delivery path when a single process is running. Multiple instances (when allowed) are separate processes. |
| Linux | The bundle exposes MIME associations and selected paths arrive as command-line arguments. The first supported path uses the idle main window; additional paths use new windows **within that process**. | Single-instance mode matches Windows; multi-instance allows separate processes. |

The association metadata lives in `src-tauri/tauri.conf.json`. Platform
adapters live in `src-tauri/src/lib.rs` and `src-tauri/src/file_associations.rs`;
boot settings in `src-tauri/src/app_settings.rs`; stable native delivery and
replay live in `src-tauri/src/open_requests.rs`; the canonical support,
ordering, deduplication, readiness, feedback, and window policy lives in
`src/open-intent-controller.js`.

Exactly one live webview coordinates requests **inside a process**: `main` when
present, otherwise an existing reader window. Closing that coordinator
re-emits unacknowledged in-process requests to the next window. The queue is
not persisted across a full application-process crash. Separate processes do
not share that queue.

An event and pending-list replay can expose the same native request. Its stable
ID makes that delivery one frontend operation and one acknowledgment. See
[ADR 0001](adr/0001-open-intent-delivery.md) for crash and replay trade-offs.

## Choosing open.md as the default

Default-app ownership stays with the operating system and the user:

- **In app:** Advanced options → System → **Set as default for Markdown…**
- **Windows:** Settings → Apps → Default apps, or right-click a Markdown file → Open with → Choose another app.
- **macOS:** Finder → Get Info → Open with → open.md → Change All.
- **Linux:** use the desktop environment's Default Applications or Open With settings. Advanced users can use `xdg-mime`; the desktop package supplies the MIME registration.

Associations are installed by packaged `.msi`/`.exe`, `.dmg`/`.app`, `.deb`, or AppImage artifacts. `cargo tauri dev` does not install or change OS defaults.

## Policy

- Keep the bundle role as `Viewer`: `open.md` reads documents and never claims to edit them.
- Never change the default application without an explicit OS-owned user confirmation (or an explicit in-app button that only opens OS UI / user-scoped `xdg-mime`).
- Send unsupported paths through the canonical open policy so every origin
  produces the same no-op and user feedback.
- Preserve the current document when another file is opened from the OS **within
  the same process**; use a new window instead.
- Multiple processes (when allowed) are independent readers; they do not share
  the open-request queue.
