# Format chrome dogfood fixtures

Local samples for exercising format-aware chrome without OS associations.
The Lumen Harbor files in the parent folder are the complete showcase.
These fixtures stay here because native tests open `sample-scene.nfo` by path.

| File | Expect |
| --- | --- |
| `sample-config.json` | Rich JSON Read; Edit opens property rows; status shows keys |
| `sample-table.csv` | Table Read; status shows rows×cols |
| `sample-swatch.png` | Image Read; context menu Copy/Download/Fit/Actual size; status W×H |
| `sample-scene.nfo` | CP437 scene art for the decoder. Status NFO. Read/Source only. Boxes join. |
| `sample-nfo-utf8.nfo` | Unicode program readme (copy of `../lumen-station.nfo`). Same NFO surface. |
| `sample-nfo-xml.nfo` | Kodi movie XML. Ordinary Text. Edit available. |
| `sample-nfo-lt-art.nfo` | Starts with `<` but is not XML. Stays NFO. |
| `sample-app.log` | Log Read/Source. No Edit. |

Showcase Unicode program NFO, Kodi XML, and Windows MsInfo XML live one
directory up: `lumen-station.nfo`, `kodi-the-quiet-place.nfo`,
`kodi-harbor-nights.nfo`, `windows-msinfo.nfo`.

Open via drop, CLI path, or Open with (not the Markdown picker filter).
