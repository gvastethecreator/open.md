from pathlib import Path

root = Path(__file__).resolve().parent


def cp437(text: str) -> bytes:
    table = {
        "░": 0xB0,
        "▒": 0xB1,
        "▓": 0xB2,
        "█": 0xDB,
        "╔": 0xC9,
        "╗": 0xBB,
        "╚": 0xC8,
        "╝": 0xBC,
        "╠": 0xCC,
        "╣": 0xB9,
        "═": 0xCD,
        "║": 0xBA,
        "☺": 0x01,
    }
    out = bytearray()
    for char in text:
        if char == "\n":
            out.extend(b"\r\n")
        elif char in table:
            out.append(table[char])
        else:
            out.append(ord(char) & 0xFF)
    return bytes(out)


scene = cp437(
    "╔════════════════════════════╗\n"
    "║  open.md sample NFO  ☺     ║\n"
    "╠════════════════════════════╣\n"
    "║  ░▒▓█ box art fixture      ║\n"
    "╚════════════════════════════╝\n"
) + b"\x1a"
root.joinpath("sample-scene.nfo").write_bytes(scene)

root.joinpath("sample-nfo-utf8.nfo").write_text(
    "╔════════════════════════════╗\n"
    "║  UTF-8 sample NFO          ║\n"
    "╚════════════════════════════╝\n",
    encoding="utf-8",
    newline="\n",
)

root.joinpath("sample-nfo-xml.nfo").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    "<movie>\n"
    "  <title>Sample</title>\n"
    "</movie>\n",
    encoding="utf-8",
    newline="\n",
)

root.joinpath("sample-nfo-lt-art.nfo").write_bytes(
    cp437("<not-xml banner\n░▒▓█\n")
)

print("wrote nfo fixtures")
