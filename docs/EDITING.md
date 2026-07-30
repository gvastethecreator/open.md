# Editing files

`open.md` can edit an open Markdown or plain-text file without changing its format.

## Enter edit mode

Open a supported file, then select the mode icon in the status bar or press
<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>E</kbd>. The icon moves through Read,
Edit and Source; its tooltip names the current mode and the next one. On macOS,
use <kbd>Cmd</kbd> instead of <kbd>Ctrl</kbd>.

Mode changes morph the document surface between its Read, Edit and Source
geometry while the window chrome stays fixed. Reduced-motion preferences switch
the surface immediately.

The document becomes a block canvas. The source file remains Markdown or text;
there is no private document format. While the caret is in the editor, the
status bar shows its source line and visible column. The gear in the title bar
can show source-line numbers and the minimap in Edit as well as Read. Word wrap
is on by default and can be changed there for Read, Edit and Source.

## Work with blocks

Type `/` in an empty block to choose:

- text or headings 1–3;
- bulleted or numbered lists;
- a to-do item;
- a quote;
- fenced code;
- a divider.

Use the controls left of a block to insert, drag, move, duplicate or delete it.
Select text to show the inline toolbar for bold, italic, strikethrough, code and
links. <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>1</kbd> through <kbd>3</kbd>
changes the current block to a heading.

Press <kbd>Tab</kbd> or <kbd>Shift</kbd> + <kbd>Tab</kbd> to change list
indentation. <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>↑</kbd> or <kbd>↓</kbd>
moves the current block without leaving the keyboard. Use <kbd>Alt</kbd> +
<kbd>Shift</kbd> + <kbd>M</kbd> to open its move, duplicate and delete actions.
For selected text, <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>X</kbd> toggles
strikethrough and <kbd>Ctrl</kbd> + <kbd>E</kbd> toggles inline code.

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
are preserved. Complex tables, embedded HTML, footnotes, nested rich blocks,
Mermaid diagrams and image authoring do not have dedicated visual controls; use
Source view for exact syntax edits. New-file creation, Save As, collaboration,
comments and cloud sync are outside this mode. To keep the app responsive,
documents over 2 MiB or 20,000 lines remain available in Read and Source views
but do not open in the block editor.
