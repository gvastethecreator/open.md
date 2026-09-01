# open.md file associations

Packaged builds register `.md`, `.markdown`, and `.txt` as viewer associations. That makes `open.md` available in **Open with**. It does not silently replace the user's default application.

Runtime may also open a small set of plain-text companions (JSON, INI, YAML, TOML, CSV, NFO) and common raster images through drag-and-drop, CLI paths, or a forced Open with. Those formats are not registered associations and do not appear in the file picker filter.

Format resolution uses the file extension first, then content magic bytes on accepted paths. A text companion that is actually a PNG opens as an image. An image extension whose content is not a valid image fails closed. Unknown extensions are rejected. Payload `format` / `kind` win over path re-guess.

Companions get richer Read when possible, full-document Source highlighting where languages exist, and format-aware Edit (JSON property rows when valid; plain monospace otherwise). Images are view-only. Classic scene `.nfo` files (CP437 box art) open as Read/Source only on a VGA cell grid. UTF-8 Kodi/Plex or Windows System Information XML that also uses `.nfo` stays ordinary editable text. `.log` companions are Read/Source only.

## In-app controls

Advanced options → **System**:

| Control | Default | Effect |
| --- | --- | --- |
| **Allow multiple instances** | On | When **on**, each OS launch may start a new process. When **off**, the single-instance plugin reuses the running process and forwards paths. The disk value is read at native boot. Changing the toggle applies on **next launch**. |
| **Set as default for Markdown…** | Action | Opens or updates the OS default-app path for the packaged Markdown and text types. Never changes the default without this gesture. |

Native settings live in the app config directory as `settings.json` (`allowMultipleInstances`). Frontend `localStorage` is not the source of truth for multi-instance mode. Advanced → System controls stay disabled until the first successful native hydrate.

### Platform association action

| Platform | What the button does | Notes |
| --- | --- | --- |
| Windows | Opens **Settings → Default apps** (`ms-settings:defaultapps`) | Silent default changes are blocked by the OS. Packaged installers still register Open With. |
| macOS | Opens System Settings (default apps when available) | Bundle types come from the packaged app. Users can also use Finder → Get Info → Open with → Change All. |
| Linux | Prefers `xdg-mime default` for `text/markdown` and `text/plain` with known `.desktop` names; falls back to DE settings | Requires a packaged install that publishes a desktop entry. |

`cargo tauri dev` does not install OS associations. The action may open settings or report that a packaged install is required.

## Runtime behavior

| Platform | Cold launch | App already running |
| --- | --- | --- |
| Windows | Installer registers the extensions. Selected paths arrive as command-line arguments. The first supported path uses the idle main window. Additional paths use new windows **within that process**. | If multiple instances are **off**, the single-instance adapter stores and emits one acknowledged request. An occupied window is preserved. If multiple instances are **on**, the OS may start another process. |
| macOS | Launch Services sends file URLs through Tauri's `RunEvent::Opened`. Requests remain pending until the webview consumes and acknowledges them. | Same acknowledged delivery path when a single process is running. |
| Linux | The bundle exposes MIME associations. Selected paths arrive as command-line arguments. First supported path uses the idle main window. Additional paths use new windows **within that process**. | Single-instance mode matches Windows. |

Association metadata lives in `src-tauri/tauri.conf.json`. Platform adapters live in `src-tauri/src/lib.rs` and `src-tauri/src/file_associations.rs`. Boot settings live in `src-tauri/src/app_settings.rs`. Stable native delivery lives in `src-tauri/src/open_requests.rs`. Canonical support, order, deduplication, readiness, feedback, and window policy live in `src/open-intent-controller.js`.

Exactly one live webview coordinates requests **inside a process**: `main` when present, otherwise an existing reader window. Closing that coordinator re-emits unacknowledged in-process requests to the next window. The queue is not persisted across a process crash. Separate processes do not share that queue.

An event and pending-list replay can expose the same native request. Its stable ID makes that delivery one frontend operation and one acknowledgment.

## Choosing open.md as the default

Default-app ownership stays with the operating system and the user:

- **In app:** Advanced options → System → **Set as default for Markdown…**
- **Windows:** Settings → Apps → Default apps, or right-click a Markdown file → Open with → Choose another app.
- **macOS:** Finder → Get Info → Open with → open.md → Change All.
- **Linux:** the desktop environment's Default Applications or Open With settings.

Associations are installed by packaged `.msi`/`.exe`, `.dmg`/`.app`, `.deb`, or AppImage artifacts.

## Policy

- Keep the bundle role as `Viewer`.
- Never change the default application without an explicit OS-owned confirmation, or an in-app button that only opens OS UI / user-scoped `xdg-mime`.
- Send unsupported paths through the canonical open policy.
- Preserve the current document when another file is opened from the OS **within the same process**. Use a new window instead.
- Multiple processes (when allowed) are independent readers. They do not share the open-request queue.
