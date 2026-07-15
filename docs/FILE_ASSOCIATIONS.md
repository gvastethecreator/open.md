# open.md file associations

Packaged `open.md` builds register `.md`, `.markdown`, and `.txt` as viewer
associations. Registration makes `open.md` available in the operating system's
**Open with** UI; it does not silently replace the user's default application.

## Runtime behavior

| Platform | Cold launch | App already running |
| --- | --- | --- |
| Windows | The installer registers the extensions and the selected path arrives as a command-line argument. | The single-instance handler opens each supported path in its own window. |
| macOS | Launch Services sends file URLs through Tauri's `RunEvent::Opened`; `open.md` queues them until the webview is ready. | The same event path opens each document without replacing the current window. |
| Linux | The bundle exposes MIME associations and the selected path arrives as a command-line argument. | The single-instance handler opens each supported path in its own window. |

The association metadata lives in `src-tauri/tauri.conf.json`. Runtime handoff lives in `src-tauri/src/lib.rs` and `src/main.js`.

## Choosing open.md as the default

Default-app ownership stays with the operating system and the user:

- **Windows:** Settings → Apps → Default apps, or right-click a Markdown file → Open with → Choose another app.
- **macOS:** Finder → Get Info → Open with → open.md → Change All.
- **Linux:** use the desktop environment's Default Applications or Open With settings. Advanced users can use `xdg-mime`; the desktop package supplies the MIME registration.

Associations are installed by packaged `.msi`/`.exe`, `.dmg`/`.app`, `.deb`, or AppImage artifacts. `cargo tauri dev` does not install or change OS defaults.

## Policy

- Keep the bundle role as `Viewer`: `open.md` reads documents and never claims to edit them.
- Never change the default application without an explicit OS-owned user confirmation.
- Treat unsupported paths as no-ops with user feedback.
- Preserve the current document when another file is opened from the OS; use a new window instead.
