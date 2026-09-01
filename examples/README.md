# Lumen Harbor example pack

Local documents for exercising every format `open.md` will actually open.
They share one fictional night station so the files are complete instead of
`foo/bar` stubs.

The reading test that the native suite already knows is still
[a-quiet-place.md](a-quiet-place.md). It keeps the quiet desk picture, the
strikethrough `completed ideas`, the original Mermaid flowchart, and then
keeps going.

## Open these

| File | Format | Why it exists |
| --- | --- | --- |
| [a-quiet-place.md](a-quiet-place.md) | Markdown | Headings, tasks, table, image, Mermaid, footnotes, every highlight language |
| [lumen-harbor.markdown](lumen-harbor.markdown) | Markdown (`.markdown`) | Second extension, station bible, more fences |
| [night-watch.txt](night-watch.txt) | Text | A letter. No outline. Sentences. |
| [lumen-harbor.json](lumen-harbor.json) | JSON | Nested telemetry for the tree reader and property editor |
| [lumen-harbor.yaml](lumen-harbor.yaml) | YAML | Comments, anchors, multiline |
| [station-roster.yml](station-roster.yml) | YAML (`.yml`) | Second extension, roster |
| [lumen-harbor.toml](lumen-harbor.toml) | TOML | Tables, arrays of tables, dates |
| [station.ini](station.ini) | INI | Sections and comments |
| [radio.cfg](radio.cfg) | INI (`.cfg`) | Frequencies |
| [harbor.conf](harbor.conf) | INI (`.conf`) | Pier daemon |
| [harbor.env](harbor.env) | Env | `KEY=value` for the properties highlighter |
| [tide-log.csv](tide-log.csv) | CSV | Quoted cells, unicode, a table wide enough to scroll |
| [overnight.log](overnight.log) | Log | Levels, stack-shaped noise, Read/Source only |
| [lumen-station.nfo](lumen-station.nfo) | NFO | UTF-8 program readme with decoration. Not XML. Not CP437. |
| [kodi-the-quiet-place.nfo](kodi-the-quiet-place.nfo) | Text (Kodi XML) | Movie metadata a media center would write |
| [kodi-harbor-nights.nfo](kodi-harbor-nights.nfo) | Text (Kodi XML) | Tvshow metadata |
| [windows-msinfo.nfo](windows-msinfo.nfo) | Text (MsInfo XML) | System Information export |

## Images

View-only. One file per raster the reader accepts.

| File | Format |
| --- | --- |
| [assets/harbor-night.png](assets/harbor-night.png) | PNG |
| [assets/lantern.jpg](assets/lantern.jpg) | JPEG |
| [assets/harbor-chart.jpeg](assets/harbor-chart.jpeg) | JPEG (`.jpeg`) |
| [assets/lantern.gif](assets/lantern.gif) | GIF (flicker) |
| [assets/paper-moth.webp](assets/paper-moth.webp) | WebP |
| [assets/quiet-desk.webp](assets/quiet-desk.webp) | WebP (original quiet place) |
| [assets/pigments.bmp](assets/pigments.bmp) | BMP |
| [assets/rain-glass.avif](assets/rain-glass.avif) | AVIF |

## About the `.nfo` files

Programs still write Unicode `.nfo`:

- **Installer / program readme** — [lumen-station.nfo](lumen-station.nfo). UTF-8 text with boxes. Opens as NFO. Read and Source only.
- **Kodi / Plex** — the two `kodi-*.nfo` files. UTF-8 XML. Open as ordinary text. Edit stays available.
- **Windows System Information** — [windows-msinfo.nfo](windows-msinfo.nfo). UTF-8 `MsInfo` XML from `msinfo32 /nfo`. Opens as text.

Classic CP437 scene art lives under [fixtures/](fixtures/) for the decoder tests. It is not the showcase.

Drop a file on the window, pass a path on the CLI, or use **Open with**. Companion formats are not in the Markdown picker filter.
