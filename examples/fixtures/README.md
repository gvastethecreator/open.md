# Format chrome dogfood fixtures

Local samples for exercising format-aware chrome without OS associations:

| File | Expect |
| --- | --- |
| `sample-config.json` | Rich JSON Read; Edit opens property rows; status shows keys |
| `sample-table.csv` | Table Read; status shows rows×cols |
| `sample-swatch.png` | Image Read; context menu Copy/Download/Fit/Actual size; status W×H |
| `sample-scene.nfo` | CP437 scene art. Status NFO. Read/Source only. No Edit. Boxes join. |
| `sample-nfo-utf8.nfo` | UTF-8 art. Same NFO surface. |
| `sample-nfo-xml.nfo` | Kodi-like XML. Ordinary Text. Edit available. |
| `sample-nfo-lt-art.nfo` | Starts with `<` but is not XML. Stays NFO. |
| `sample-app.log` | Log Read/Source. No Edit. |

Open via drop, CLI path, or Open with (not the Markdown picker filter).
