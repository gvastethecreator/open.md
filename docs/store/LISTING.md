# Microsoft Store listing source — open.md

Listing language for the first submission: **English (United States)**

Do not publish localized listings until the application UI and support policy for those languages are reviewed.

## Product name

```text
open.md
```

Use the exact reserved Partner Center name.

## Short description

```text
A quiet, local-first Markdown and text reader with focused editing.
```

## Description

```text
Read and edit local Markdown and plain-text files in a calm, focused Windows app.

open.md keeps documents on your computer. Open a file with the native picker, drag it into the window, or choose open.md from Windows Open with. Switch between a rendered reading view and the original source, then enter Edit only when you want to change the document.

Highlights

• Rendered Markdown and full source views
• Focused editing with explicit read-only and edit modes
• Local .md, .markdown, and .txt file associations
• Syntax-highlighted code blocks and Mermaid diagrams
• Relative local images without remote-image fetching
• JSON, CSV, common configuration text, and raster-image companion views
• Multiple windows or optional single-instance behavior
• Themes, font choices, zoom, keyboard shortcuts, and reduced motion
• Local settings with no open.md account, advertising, or telemetry

Opening a document does not modify it. Changes are written only when you edit and save, or while you have explicitly enabled autosave.

open.md is an early release. Keep backups of important documents and review changes before saving.
```

## Search terms

Use only terms allowed by the current Partner Center interface and avoid competitor names.

Suggested concepts:

```text
markdown
text reader
markdown editor
md viewer
local notes
document reader
plain text
```

## Feature bullets

```text
Local-first document reading and editing
Rendered Markdown and source modes
Windows Open with integration
Code highlighting and Mermaid diagrams
Themes, fonts, zoom, and accessibility preferences
No account, ads, or telemetry
```

## What's new template

```text
Version <VERSION>

• <PRIMARY CHANGE>
• <SECONDARY CHANGE>
• Reliability and accessibility improvements
```

Never claim a feature that is not present in the submitted binary.

## System requirements

```text
Windows x64
Current-user installation
No account required
```

The Store installer includes the offline WebView2 installation mode selected by the Tauri Store configuration.

## Support and privacy

```text
Support:
https://github.com/gvastethecreator/open.md/issues

Privacy:
https://gvastethecreator.github.io/open.md/privacy.html

Website:
https://gvastethecreator.github.io/open.md/
```

## Screenshot plan

Use real application captures at a consistent Windows scale. Remove private paths, usernames, recent-file history, and third-party material.

Recommended set:

1. **Rendered Markdown**
   - synthetic Markdown document;
   - headings, list, quote, code block;
   - dark theme;
   - no personal path visible.

2. **Source editing**
   - the same synthetic file;
   - Source + Edit clearly visible;
   - save state legible.

3. **Reading controls**
   - theme/font/reading options;
   - reduced-motion and word-wrap controls.

4. **Narrow window**
   - demonstrate responsive hierarchy and readable layout.

5. **Companion format**
   - synthetic JSON or CSV;
   - no credentials or real account data.

6. **Local image**
   - publisher-owned/generated raster image;
   - demonstrate fit/actual-size controls.

7. **Open with / system settings**
   - optional;
   - do not show unrelated installed applications or account names.

Existing project-tour images under `docs/assets/landing/` are useful references, but each must be reviewed against the submitted binary and Store image requirements before upload.

## Caption ideas

```text
Read Markdown in a clean rendered view.
Edit the original source only when you choose.
Keep local documents local.
Adapt themes, typography, and reading tools.
Open Markdown and text files directly from Windows.
```

## Claims to avoid

Do not claim:

- Microsoft Store-managed updates;
- cloud sync;
- end-to-end encryption;
- collaboration;
- AI assistance;
- full support for every Markdown extension;
- complete image-editing support;
- automatic safe backup of edited files;
- Windows ARM64 support until a qualified ARM64 installer exists.
