# Editing files

`open.md` edits an open Markdown or text companion without changing its file format. Images are view-only. Classic scene `.nfo` files and `.log` files are Read and Source only.

Two independent controls create four states:

| Presentation | Read only | Edit |
| --- | --- | --- |
| **Rendered** | Rendered document | Live-preview editor |
| **Source** | Full file source | Continuous full-file editor |

Open a supported file, then use either control in the status bar. <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>E</kbd> toggles Read only and Edit. On macOS, use <kbd>Cmd</kbd> instead of <kbd>Ctrl</kbd>.

Mode changes keep the same document frame and reader scroll position. Reduced-motion preferences switch the surface immediately. There is no private document format.

Non-Markdown companions that stay editable (CSV, YAML, TOML, INI, ENV, and similar) use a plain text surface so saves do not rewrite their syntax. Valid JSON objects and arrays use a property editor in Rendered Edit. Nested values edit as JSON text. Invalid or very large JSON falls back to the plain editor. Source Edit always shows the exact full JSON text.

## Rendered Edit

Markdown Rendered Edit uses Classic live preview:

- The active line shows its editable Markdown source.
- Other lines stay rendered until activated. Click a rendered line to edit it at the click offset.
- Enter splits a line. Backspace at the start of a line merges with the previous line.
- Arrow keys move between visual lines, then hard lines at the edges, with a preferred column.
- Type Markdown markers in the active line. Preview appears when you leave the line.
- Heading markers `#` through `######` and quote markers remain visible inside the document frame, including at the 440 px minimum window width.

While the caret is in the editor, the status bar shows its source line and visible column. View options can show source-line numbers and the minimap in Read, Rendered Edit, and Source Edit. Word wrap applies to every text surface.

Advanced options → **Reduce motion** disables non-essential editor and chrome animation. The operating system's `prefers-reduced-motion` setting is always honored.

## Source Edit

Source Edit is the same line-based host with raw syntax on every line. It supports selection and replacement across lines.

- Click a line to edit it at the click offset.
- ↑/↓ move visual lines when word wrap is on, then hard lines at the visual edges, with a preferred column.
- ←/→ cross line edges. Home/End move to line bounds.
- Ctrl/Cmd+Home and Ctrl/Cmd+End move to document bounds.
- Page Up/Page Down keep the caret column when possible.

Use Source Edit for tables, embedded HTML, footnotes, nested rich blocks, Mermaid source, image syntax, or any exact syntax check. There is no inline format toolbar and no block slash menu.

## Save and recover

Auto-save is on by default and runs after you pause typing. Turn it off from the gear in the title bar for manual control. Press <kbd>Ctrl</kbd> + <kbd>S</kbd> or select the save badge beside the file name to save immediately. The badge shows unsaved, saving, saved, and failed states. A failed save leaves the draft in the editor.

Undo and redo use the platform shortcuts. They confirm with a short toast.

## Reading tasks

Task checkboxes can be changed in Read mode. Each change is saved back to the matching Markdown source line. If saving fails, the checkbox returns to its previous state.

Opening another file or returning to reading with unsaved work asks for confirmation. Closing the window also triggers the platform unsaved-work warning.

## Example document

Open `examples/a-quiet-place.md` to exercise the main reading and source features in one file.

## About and Help

Press <kbd>F1</kbd> or use the question-mark icon. Press <kbd>Esc</kbd> to return to the document.

## Current limits

Editing covers common Markdown line kinds (headings, lists, quotes, code, dividers). Existing heading levels 4–6 remain editable. Complex tables, embedded HTML, footnotes, nested rich blocks, Mermaid diagrams, and image authoring have no dedicated visual controls. Use Source Edit for exact syntax. New-file creation, Save As, collaboration, comments, and cloud sync are outside this mode. Documents over 2 MiB or 20,000 lines stay available in Read and Source. Edit stays unavailable.
