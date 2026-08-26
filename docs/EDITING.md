# Editing files

`open.md` edits an open Markdown or text companion without changing its file
format. Images are view-only: Source and Edit are unavailable for them.
Classic scene `.nfo` files and `.log` files are Read and Source only. They
have no editor.

Two independent controls create four states:

| Presentation | Read only | Edit |
| --- | --- | --- |
| **Rendered** | Rendered document | Live-preview editor |
| **Source** | Full file source | Continuous full-file editor |

The Rendered/Source control changes presentation. The Read only/Edit control
changes whether the current presentation can be edited. Open a supported file,
then use either control in the status bar. <kbd>Ctrl</kbd> + <kbd>Shift</kbd> +
<kbd>E</kbd> toggles Read only and Edit. On macOS, use <kbd>Cmd</kbd> instead of
<kbd>Ctrl</kbd>.

Mode changes keep the same document frame and reader scroll position while the
window chrome stays fixed. Reduced-motion preferences switch the surface
immediately. The source file remains Markdown or text; there is no private
document format.

Non-Markdown companions that stay editable (CSV, YAML, TOML, INI, ENV, and
similar) use a plain text surface so saves do not rewrite their syntax. Valid JSON objects and
arrays use a property editor in Rendered Edit; nested values edit as JSON text.
Invalid or very large JSON falls back to the plain editor. Source Edit always
shows the exact full JSON text. Markdown block tools stay Markdown-only.

## Rendered Edit

Markdown Rendered Edit uses per-block live preview:

- The active block shows its editable source and structural marker.
- Other blocks stay rendered until activated. Click a rendered block to edit it at the click offset.
- Enter splits a block. Backspace at the start and Delete at the end merge
  neighboring blocks.
- Arrow keys move between blocks at their boundaries. Undo and redo use the
  platform shortcuts.
- Selection and inline formatting stay inside the active block. Use Source Edit
  for continuous selection or replacement across several lines.
- Heading markers `#` through `######` and quote markers remain visible inside
  the document frame, including at the 440 px minimum window width.

Select text to show the inline toolbar for bold, italic, strikethrough, code,
and links. While the caret is in the editor, the status bar shows its source
line and visible column. View options can show source-line numbers and the
minimap in Read, Rendered Edit, and Source Edit. Word wrap applies to every text
surface.

Advanced options → **Reduce motion** disables non-essential editor and chrome
animation (toasts, menus, theme wipe, trail, line band). The operating
system's `prefers-reduced-motion` setting is always honored.

## Source Edit

Source Edit is one continuous, line-based host for the complete file. It keeps
raw syntax visible, supports selection and replacement across lines, and uses
these navigation rules:

- Click a preview line to edit it at the click offset.
- ↑/↓ move visual lines when word wrap is on, then hard lines at the visual edges, with a preferred column.
- ←/→ cross line edges.
- Home/End move to line bounds.
- Ctrl/Cmd+Home and Ctrl/Cmd+End move to document bounds.
- Page Up/Page Down keep the caret column when possible.

Use Source Edit for tables, embedded HTML, footnotes, nested rich blocks,
Mermaid source, image syntax, or any exact syntax not exposed by Rendered Edit.

## Block editor tools (optional)

Turn on **Block editor** under View options → Editing to add Notion-style tools
to Rendered Edit. While it is on:

Type `/` in an empty block to choose:

- text or headings 1–3;
- bulleted or numbered lists;
- a to-do item;
- a quote;
- fenced code;
- a divider.

Block actions live on a **floating toolbar at the bottom** of the window while
Block editor, Rendered, and Edit are active:

- add a block;
- drag handle (drag to reorder, or click for move / duplicate / delete);
- move up / down, duplicate, delete;
- change block type.

There are no buttons in the left margin, so typing never shifts the text
horizontally.

## Formatting and structure

Select text to show the **inline format toolbar** near the selection for bold,
italic, strikethrough, code and links. <kbd>Ctrl</kbd> + <kbd>Alt</kbd> +
<kbd>1</kbd> through <kbd>3</kbd> changes the current block to a heading.

In Block editor, press <kbd>Tab</kbd> or <kbd>Shift</kbd> + <kbd>Tab</kbd> to
change list indentation. <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>↑</kbd> or
<kbd>↓</kbd> moves the current block without leaving the keyboard. Use
<kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> to open its move, duplicate
and delete actions. For selected text, <kbd>Ctrl</kbd> + <kbd>Shift</kbd> +
<kbd>X</kbd> toggles strikethrough and <kbd>Ctrl</kbd> + <kbd>E</kbd> toggles
inline code.

## Save and recover

Auto-save is on by default and runs after you pause typing. Turn it off from the
gear in the title bar when you want manual control. Press <kbd>Ctrl</kbd> +
<kbd>S</kbd> or select the save badge beside the file name to save immediately.
The badge shows unsaved, saving, saved and failed states. A failed save leaves
the draft in the editor so you can retry or copy it elsewhere.

Undo and redo stay available through the platform shortcuts. They confirm the
action with a short toast instead of occupying permanent toolbar space.

## Reading tasks

Task checkboxes can be changed directly in Read mode. Each change is saved back
to the matching Markdown source line. If saving fails, the checkbox returns to
its previous state and the document remains unchanged.

Opening another file or returning to reading with unsaved work asks for
confirmation. Closing the window also triggers the platform's unsaved-work
warning.

## Example document

Open `examples/a-quiet-place.md` to exercise the main reading and source
features in one file. It includes headings, inline formatting, task and nested
lists, a wide table, a local image, a Mermaid diagram, code, a footnote and
Unicode text.

## About and Help

Press <kbd>F1</kbd> or use the question-mark icon to open About + Help. It
contains the local-file and format guarantees, a four-step quick start and the
essential shortcuts. Press <kbd>Esc</kbd> to return to the document.

## Current limits

Editing covers the common Markdown blocks above. Existing heading levels 4–6
remain editable. Complex tables, embedded HTML, footnotes, nested rich blocks,
Mermaid diagrams and image authoring do not have dedicated visual controls; use
Source Edit for exact syntax edits. New-file creation, Save As, collaboration,
comments and cloud sync are outside this mode. To keep the app responsive,
documents over 2 MiB or 20,000 lines remain available in Read and Source views
but Edit remains unavailable.
