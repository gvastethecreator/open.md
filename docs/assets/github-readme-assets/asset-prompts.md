# GitHub README Assets Prompt Pack

repo: D:\DEV\open-md
title: open.md
subtitle: A quiet desktop viewer for Markdown
template: creative-workbench
icon_style: macos-front
tags: Local-first, Tauri, Markdown, JavaScript, Rust, HTML

Use `$imagegen` built-in mode for each prompt. Save accepted raw images to the listed `raw_path`, then run compose commands from this output folder.

## readme-hero

kind: banner
size: 2100x900
raw_path: raw/readme-hero.png
final_path: final/readme-hero.svg

```text
Use case: stylized-concept
Asset type: README hero banner textless image layer, 2100x900.
Primary request: Create a polished GitHub project visual for open.md.
Project context: A quiet desktop viewer for Markdown
Project tags: Local-first, Tauri, Markdown, JavaScript, Rust, HTML
Visual template: Creative Workbench.
Scene/backdrop: production workbench with render passes, asset tiles, material swatches, light rigs, crafted project-specific objects, and cinematic polish.
Composition/framing: dynamic studio arrangement with title-safe margin, strong foreground/background separation, and visible making energy; 21:9 ultrawide banner; left text block, right visual detail, readable at README width.
Color palette: near-black, pearl, acid yellow, violet, cyan, soft coral.
Text: none. Do not render any readable title, subtitle, code, labels, captions, UI copy, watermark, signature, or logo.
Constraints: high-polish README/GitHub-ready bitmap background, crisp detail, strong contrast under a deterministic SVG text overlay.
Avoid: readable posters, camera brand logos, generic art gallery, flat app mockups, tiny UI text, unrequested fantasy/game objects, gemstones, coins, keys, potion bottles.
```

compose:

```bash
python <skill-dir>/scripts/compose_svg_asset.py --brief asset-brief.json --asset readme-hero --image raw/readme-hero.png --out final/readme-hero.svg
```

## social-preview

kind: banner
size: 1280x640
raw_path: raw/social-preview.png
final_path: final/social-preview.svg

```text
Use case: stylized-concept
Asset type: GitHub social preview textless image layer, 1280x640.
Primary request: Create a polished GitHub project visual for open.md.
Project context: A quiet desktop viewer for Markdown
Project tags: Local-first, Tauri, Markdown, JavaScript, Rust, HTML
Visual template: Creative Workbench.
Scene/backdrop: production workbench with render passes, asset tiles, material swatches, light rigs, crafted project-specific objects, and cinematic polish.
Composition/framing: dynamic studio arrangement with title-safe margin, strong foreground/background separation, and visible making energy; center-safe card, no critical content near edges.
Color palette: near-black, pearl, acid yellow, violet, cyan, soft coral.
Text: none. Do not render any readable title, subtitle, code, labels, captions, UI copy, watermark, signature, or logo.
Constraints: high-polish README/GitHub-ready bitmap background, crisp detail, strong contrast under a deterministic SVG text overlay.
Avoid: readable posters, camera brand logos, generic art gallery, flat app mockups, tiny UI text, unrequested fantasy/game objects, gemstones, coins, keys, potion bottles.
```

compose:

```bash
python <skill-dir>/scripts/compose_svg_asset.py --brief asset-brief.json --asset social-preview --image raw/social-preview.png --out final/social-preview.svg
```
