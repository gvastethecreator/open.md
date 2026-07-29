# open.md file associations

Packaged `open.md` builds register `.md`, `.markdown`, and `.txt` as viewer
associations. Registration makes `open.md` available in the operating system's
**Open with** UI; it does not silently replace the user's default application.

## Runtime behavior

| Platform | Cold launch | App already running |
| --- | --- | --- |
| Windows | The installer registers the extensions and selected paths arrive as command-line arguments. The first supported path uses the idle main window; additional paths use new windows. | The single-instance adapter stores and emits one acknowledged request. An idle window may take the first supported path; an occupied window is preserved and each path opens separately. |
| macOS | Launch Services sends file URLs through Tauri's `RunEvent::Opened`. Requests remain pending until the webview consumes and acknowledges them. | The same acknowledged delivery path preserves an occupied document and opens associated paths in new windows. |
| Linux | The bundle exposes MIME associations and selected paths arrive as command-line arguments. The first supported path uses the idle main window; additional paths use new windows. | The single-instance adapter uses the same request and window policy as Windows. |

The association metadata lives in `src-tauri/tauri.conf.json`. Platform
adapters live in `src-tauri/src/lib.rs`; stable native delivery and replay
live in `src-tauri/src/open_requests.rs`; the canonical support, ordering,
deduplication, readiness, feedback, and window policy lives in
`src/open-intent-controller.js`.

Exactly one live webview coordinates requests: `main` when present, otherwise
an existing reader window. Closing that coordinator re-emits unacknowledged
in-process requests to the next window. The queue is not persisted across a
full application-process crash.

An event and pending-list replay can expose the same native request. Its stable
ID makes that delivery one frontend operation and one acknowledgment. See
[ADR 0001](adr/0001-open-intent-delivery.md) for crash and replay trade-offs.

## Choosing open.md as the default

Default-app ownership stays with the operating system and the user:

- **Windows:** Settings → Apps → Default apps, or right-click a Markdown file → Open with → Choose another app.
- **macOS:** Finder → Get Info → Open with → open.md → Change All.
- **Linux:** use the desktop environment's Default Applications or Open With settings. Advanced users can use `xdg-mime`; the desktop package supplies the MIME registration.

Associations are installed by packaged `.msi`/`.exe`, `.dmg`/`.app`, `.deb`, or AppImage artifacts. `cargo tauri dev` does not install or change OS defaults.

## Policy

- Keep the bundle role as `Viewer`: `open.md` reads documents and never claims to edit them.
- Never change the default application without an explicit OS-owned user confirmation.
- Send unsupported paths through the canonical open policy so every origin
  produces the same no-op and user feedback.
- Preserve the current document when another file is opened from the OS; use a new window instead.
