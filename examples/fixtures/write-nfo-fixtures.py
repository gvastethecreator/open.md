"""Regenerate classic CP437 and UTF-8 NFO fixtures plus the harbor showcase."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXAMPLES = ROOT.parent
WIDTH = 80

# IBMGRAPH for 0x01-0x1F / 0x7F. TAB (0x09), LF (0x0A), CR (0x0D),
# and trailing SUB (0x1A) stay structural, so they are not used as art.
GRAPH = {
    "☺": 0x01,
    "☻": 0x02,
    "♥": 0x03,
    "♦": 0x04,
    "♣": 0x05,
    "♠": 0x06,
    "•": 0x07,
    "◘": 0x08,
    "♂": 0x0B,
    "♀": 0x0C,
    "♫": 0x0E,
    "☼": 0x0F,
    "►": 0x10,
    "◄": 0x11,
    "↕": 0x12,
    "‼": 0x13,
    "¶": 0x14,
    "§": 0x15,
    "▬": 0x16,
    "↨": 0x17,
    "↑": 0x18,
    "↓": 0x19,
    "←": 0x1B,
    "∟": 0x1C,
    "↔": 0x1D,
    "▲": 0x1E,
    "▼": 0x1F,
    "⌂": 0x7F,
}


def encode_cp437(text: str) -> bytes:
    out = bytearray()
    for char in text:
        if char == "\n":
            out.extend(b"\r\n")
        elif char in GRAPH:
            out.append(GRAPH[char])
        else:
            out.extend(char.encode("cp437"))
    return bytes(out)


def fit(text: str, width: int = WIDTH) -> str:
    if len(text) == width:
        return text
    if len(text) > width:
        return text[:width]
    return text + (" " * (width - len(text)))


def bar(left: str, fill: str, right: str, width: int = WIDTH) -> str:
    return left + (fill * (width - 2)) + right


def inner(text: str, left: str = "║", right: str = "║", width: int = WIDTH) -> str:
    room = width - 2
    if len(text) > room:
        text = text[:room]
    return left + text.ljust(room) + right


def center(text: str, width: int) -> str:
    if len(text) >= width:
        return text[:width]
    pad = width - len(text)
    left = pad // 2
    return (" " * left) + text + (" " * (pad - left))


def scene_nfo() -> str:
    w = WIDTH
    lines = [
        bar("░", "░", "░"),
        bar("▒", "▒", "▒"),
        bar("▓", "▓", "▓"),
        bar("█", "█", "█"),
        inner(center("☺  LUMEN HARBOR  ·  SCENE RELEASE  ·  OPEN.MD  ☻", w - 2)),
        inner(center("♫  carried across 14 BBSes and one wet pier  ♫", w - 2)),
        bar("█", "█", "█"),
        "",
        inner("          ██▓     █    ██  ███▄ ▄███▓ ▓█████  ███▄    █           ", " ", " "),
        inner("         ▓██▒     █    ▓██▒▓██▒▀█▀ ██▒▓█   ▀  ██ ▀█   █           ", " ", " "),
        inner("         ▒██░     █    ▒██▒▓██    ▓██░▒███    ▓██  ▀█ ██▒         ", " ", " "),
        inner("         ▒██░     █    ░██░▒██    ▒██ ▒▓█  ▄  ▓██▒  ▐▌██▒         ", " ", " "),
        inner("         ░██████▒ ███  ░██░▒██▒   ░██▒░▒████▒ ▒██░   ▓██░         ", " ", " "),
        inner("         ░ ▒░▓  ░ ░▒   ░▓ ░ ▒░   ░  ░░ ░▒░ ░ ░ ▒░   ▒ ▒          ", " ", " "),
        inner("          ░ ░  ░  ░     ▒ ░ ░   ░    ░ ░░  ░ ░ ░░   ░ ▒░         ", " ", " "),
        "",
        inner("     ██░ ██  ▄▄▄       ██▀███   ▄▄▄▄    ▒█████   ██▀███          ", " ", " "),
        inner("    ▓██░ ██▒▒████▄    ▓██ ▒ ██▒▓█████▄ ▒██▒  ██▒▓██ ▒ ██▒        ", " ", " "),
        inner("    ▒██▀▀██░▒██  ▀█▄  ▓██ ░▄█ ▒▒██▒ ▄██▒██░  ██▒▓██ ░▄█ ▒        ", " ", " "),
        inner("    ░▓█ ░██ ░██▄▄▄▄██ ▒██▀▀█▄  ▒██░█▀  ▒██   ██░▒██▀▀█▄          ", " ", " "),
        inner("    ░▓█▒░██▓ ▓█   ▓██▒░██▓ ▒██▒░▓█  ▀█▓░ ████▓▒░░██▓ ▒██▒        ", " ", " "),
        inner("     ▒ ░░▒░▒ ▒▒   ▓▒█░░ ▒▓ ░▒▓░░▒▓███▀▒░ ▒░▒░▒░ ░ ▒▓ ░▒▓░        ", " ", " "),
        "",
        bar("╔", "═", "╗"),
        inner(center("▲  STATION MERIDIAN  ·  NFO/1987  ·  CP437 VGA GRID  ▲", w - 2)),
        bar("╠", "═", "╣"),
        inner("  Supplier......: THE KEEPER"),
        inner("  Packager......: OPEN.MD / LUMEN CREW"),
        inner("  Release date..: 2026-08-26  23:47 local fog"),
        inner("  Protection....: none. the lantern is the lock."),
        inner("  OS / Video....: IBM PC  ·  80x25  ·  VGA cell  ·  code page 437"),
        inner("  Contents......: field notes, tide tables, moth census, rain"),
        inner("  Cracker.......: nobody. we left the wax seal intact."),
        inner("  Serial........: LH-00-437-☺☻♥♦"),
        inner("  Checksum......: ∞  (the tide ate the last nibble)"),
        bar("╠", "═", "╣"),
        inner(center("a document should feel present when you need it", w - 2)),
        inner(center("and quiet when you do not", w - 2)),
        bar("╚", "═", "╝"),
        "",
        "                         ▲",
        "                        █▓█",
        "                       █▒░▒█",
        "                      █▓   ▓█          fog bank 12 fm",
        "                     █▒  ☼  ▒█         lamp:  kerosene #4",
        "                    █▓   │   ▓█        wick:  trimmed 02:10",
        "                   █▒    │    ▒█       moths: 14 on the glass",
        "                  █▓     │     ▓█      rain:  vertical, sincere",
        "                 █▒  ┌───┴───┐  ▒█",
        "                █▓   │ HARBOR │   ▓█",
        "               █▒    │ LIGHT  │    ▒█",
        "              █▓     └───┬───┘     ▓█",
        "             █▒          │          ▒█",
        "            █▓           │           ▓█",
        "           █▒            │            ▒█",
        "     ▄▄▄▄▄█▓▄▄▄▄▄▄▄▄▄▄▄▄▄█▄▄▄▄▄▄▄▄▄▄▄▄▓█▄▄▄▄▄",
        "    ▀████████████████████████████████████████▀",
        "  ~~~≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈~~~",
        " ~ ≈  the water keeps the minutes we drop   ≈  ~",
        "",
        bar("┌", "─", "┐"),
        inner("  FILE LISTING                                                    ", "│", "│"),
        bar("├", "─", "┤"),
        inner("  FILE_ID.DIZ ............  this shout, folded small              ", "│", "│"),
        inner("  LUMEN.NFO ..............  you are here, obviously               ", "│", "│"),
        inner("  A-QUIET-PLACE.MD .......  the keeper's working notebook         ", "│", "│"),
        inner("  LUMEN-HARBOR.MARKDOWN ..  station bible, every fence            ", "│", "│"),
        inner("  NIGHT-WATCH.TXT ........  the letter we never posted            ", "│", "│"),
        inner("  LUMEN-HARBOR.JSON ......  telemetry that pretends to be sober   ", "│", "│"),
        inner("  LUMEN-HARBOR.YAML ......  watches, tides, and a moth named Ida  ", "│", "│"),
        inner("  STATION-ROSTER.YML .....  who holds the lamp tonight            ", "│", "│"),
        inner("  LUMEN-HARBOR.TOML ......  cargo of silence                      ", "│", "│"),
        inner("  STATION.INI ............  windows that still remember VGA       ", "│", "│"),
        inner("  RADIO.CFG ..............  frequencies the fog answers           ", "│", "│"),
        inner("  HARBOR.CONF ............  daemon of the pier                    ", "│", "│"),
        inner("  HARBOR.ENV .............  secrets the rain already knows        ", "│", "│"),
        inner("  TIDE-LOG.CSV ...........  numbers with salt on them             ", "│", "│"),
        inner("  OVERNIGHT.LOG ..........  what the station whispered            ", "│", "│"),
        inner("  ASSETS\\*.PNG/JPG/GIF ..  lantern, moth, chart, rain-glass      ", "│", "│"),
        bar("└", "─", "┘"),
        "",
        bar("╔", "═", "╗"),
        inner("  GREETZ & RESPECTS  ♥ ♦ ♣ ♠                                     "),
        bar("╠", "═", "╣"),
        inner("  ►  the keepers who still trim wicks by hand"),
        inner("  ►  Fairlight, Razor, THG, and every 80-column liar"),
        inner("  ►  the moths (Ida, Percival, Little Noise, Glass-Eater)"),
        inner("  ►  CP437 for giving ░▒▓█ a job in 2026"),
        inner("  ►  the empty chair by the rain window"),
        inner("  ►  anyone who opens a document and does not flinch"),
        inner("  ►  Tokyo, cafe, naive -- Unicode later. this file is older."),
        inner("  ►  you. yes, you, with the minimap off."),
        bar("╚", "═", "╝"),
        "",
        bar("┌", "─", "┐"),
        inner("  GROUP NEWS  /  rumours we printed because the fog asked         ", "│", "│"),
        bar("├", "─", "┤"),
        inner("  *  The pier is not haunted. The lantern is bored.               ", "│", "│"),
        inner("  *  A cyanotype of the chart washed ashore. North is a rumour.   ", "│", "│"),
        inner("  *  Do not edit this NFO. The boxes will unjoin. We warned you.  ", "│", "│"),
        inner("  *  XML files that also wear .nfo are a different animal.        ", "│", "│"),
        inner("  *  If your viewer wraps these lines, it is not a VGA cell.      ", "│", "│"),
        inner("  *  Hidden payload:  4E 4F 20 43 4C 4F 55 44                     ", "│", "│"),
        inner("  *  The quiet place is a desk, a rain window, and one notebook.  ", "│", "│"),
        inner("  *  Buy the original. Steal only the weather.                    ", "│", "│"),
        bar("└", "─", "┘"),
        "",
        "        ♠         ♥         ♦         ♣         ♠         ♥",
        "       ╔══╗      ╔══╗      ╔══╗      ╔══╗      ╔══╗      ╔══╗",
        "       ║A ♠      ║K ♥      ║Q ♦      ║J ♣      ║10♠      ║9 ♥",
        "       ║  ♠      ║  ♥      ║  ♦      ║  ♣      ║  ♠      ║  ♥",
        "       ║♠ A      ║♥ K      ║♦ Q      ║♣ J      ║♠10      ║♥ 9",
        "       ╚══╝      ╚══╝      ╚══╝      ╚══╝      ╚══╝      ╚══╝",
        "        the night shift plays with a wet deck and no stakes",
        "",
        bar("╔", "═", "╗"),
        inner("  TIDE SCRATCH  (ASCII, because the printer is from 1989)        "),
        bar("╠", "═", "╣"),
        inner("   03:00  ._-=*#█#*=-__-=*#  flood, cold"),
        inner("   09:12  .._-=*#█#*=-.      slack, gulls"),
        inner("   15:40  _-=*#█#*=-__-=     ebb, rust"),
        inner("   22:05  ._-=*#████#*=-.    flood, moths"),
        inner("   23:47  ■■■■■■■■■■■■■■■■■  lamp trimmed, file saved"),
        bar("╚", "═", "╝"),
        "",
        "   ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐",
        "   │L│ │U│ │M│ │E│ │N│ │ │ │H│ │A│ │R│ │B│ │O│ │R│ │ │ │☺│ │‼│",
        "   └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘",
        "",
        bar("░", "░", "░"),
        inner("  MAZE OF THE UNREAD  --  find the chair. do not wrap.           ", "░", "░"),
        "  ░████████████████████████████████████████████████████████████░",
        "  ░█  ☺ █     █     █     █        █     █     █     █      █░",
        "  ░█ ███ ███ ███ █ ███ ███ ███████ ███ █ ███ █ ███ ███ ██ █░",
        "  ░█ █     █   █ █ █   █         █   █ █   █ █   █     █  █░",
        "  ░█ █ █████ █ █ █ █████████ █ █████ █ █████ █ ███████ █ █░",
        "  ░█ █     █ █   █         █ █     █ █     █ █         █ █░",
        "  ░█ █████ █ █████████ ███ █ █████ █ █████ █ ██████████ █░",
        "  ░█     █ █         █   █ █     █     █ █     █      ☼ █░",
        "  ░███████ █████████ ███ ███████ ███████ █████ █████████░",
        bar("░", "░", "░"),
        "",
        inner("     α  ß  Γ  π  Σ  σ  µ  τ  Φ  Θ  Ω  δ  ∞  φ  ε  ∩  ≡  ±  ≤  ≥", " ", " "),
        inner("     the Greeks also kept lamps. we just have better umlauts: äöü", " ", " "),
        "",
        bar("╔", "═", "╗"),
        inner(center("DISCLAIMER / ANTI-VIRUS / PROSE", w - 2)),
        bar("╠", "═", "╣"),
        inner("  This is not a virus. This is a lantern with opinions."),
        inner("  If your resident scanner screams, show it the rain."),
        inner("  We do not phone home. The fog already knows the number."),
        inner("  No BBS fees were harmed. The 2400 baud handshake is a memory."),
        inner("  If you paid for this pack you were robbed by a seagull."),
        inner("  If you did not pay, buy the original documents anyway."),
        inner("  Classic .nfo is Read and Source only. Do not ask the boxes to"),
        inner("  survive a Markdown editor. They will become spaghetti. ‼"),
        inner("  EOF is a polite SUB. We leave it at the door like wet boots."),
        bar("╚", "═", "╝"),
        "",
        inner(center("⌂  home is an 80-column cell and a quiet desk  ⌂", w)),
        inner(center("OPEN.MD  ·  LUMEN CREW  ·  2026  ·  ♥", w)),
        "",
        bar("▓", "▓", "▓"),
        bar("▒", "▒", "▒"),
        bar("░", "░", "░"),
        "          ► PRESS ANY KEY TO CONTINUE ◄   (there is no key)",
        "",
    ]
    return "\n".join(fit(line) if line != "" else "" for line in lines) + "\n"


def utf8_nfo() -> str:
    return """╔══════════════════════════════════════════════════════════════════════════════╗
║  UTF-8 SCENE COMPANION  ·  same grid, softer alphabet                        ║
║  This file is Unicode on purpose. Boxes still join. No XML lives here.       ║
╚══════════════════════════════════════════════════════════════════════════════╝

        ╭──────────────────────────────────────────────────────────╮
        │  ╭─╮  ╭─╮  ╭────╮  ╭───╮  ╭──╮                           │
        │  │ │  │ │  │    │  │    │  │  ╰─╮  L U M E N              │
        │  │ ╰──╯ │  │    │  │───╯  │     │                         │
        │  ╰──────╯  ╰────╯  ╰────╯  ╰────╯  H A R B O R            │
        ╰──────────────────────────────────────────────────────────╯

   ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
   ⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣦⡀⠀⠀⠀⠀⠀⠀
   ⠀⠀⠀⠀⠀⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⠀⠀⠀⠀⠀     braille fog
   ⠀⠀⠀⠀⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⠀⠀⠀⠀     (the moths prefer it)
   ⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀
   ⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀
   ⠀⠀⠀⠀⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠀⠀⠀⠀
   ⠀⠀⠀⠀⠀⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠀⠀⠀⠀⠀
   ⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀⠀
   ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠛⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀

   café  ·  naïve  ·  東京  ·  π ≈ 3.14159  ·  em dash — still here
   keepers: Ida (moth), Percival (moth), Glass-Eater (moth), you

   ┌──────────────┬──────────────┬──────────────┐
   │  lamp        │  trimmed     │  02:10       │
   │  tide        │  flood       │  22:05       │
   │  unread      │  14 letters  │  one chair   │
   └──────────────┴──────────────┴──────────────┘

   If a viewer treats this as XML it has failed a very old test:
   this banner starts with a box, not a bracket.
"""


def lt_art_nfo() -> str:
    return (
        "<not-xml banner of Lumen Harbor -- starts with '<' and still is art\n"
        "░▒▓█░▒▓█░▒▓█  the parser must not call this a movie  ░▒▓█░▒▓█░▒▓█\n"
        "╔══════════════════════════════════════════════════════════════════╗\n"
        "║  This .nfo begins with an angle bracket. It is not Kodi XML.     ║\n"
        "║  It is not Windows msinfo. It is a lantern drawn with CP437.     ║\n"
        "║  Keep format=nfo. Keep the VGA grid. Do not offer Edit.          ║\n"
        "╚══════════════════════════════════════════════════════════════════╝\n"
        "          ▲\n"
        "         █▓█     <lamp/> is a joke, not a tag\n"
        "        █▒░▒█    <fog>never closes</fog> is still not XML here\n"
        "       █▓ ☼ ▓█   because the first bytes are '<not-xml'\n"
        "      ▄▄███▄▄\n"
        "  ~~~≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈~~~\n"
    )


def kodi_xml() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>The Quiet Place at Lumen Harbor</title>
  <originaltitle>A Quiet Place to Think</originaltitle>
  <sorttitle>Quiet Place at Lumen Harbor, The</sorttitle>
  <year>2026</year>
  <premiered>2026-08-26</premiered>
  <runtime>97</runtime>
  <mpaa>Not Rated</mpaa>
  <id>lh-quiet-001</id>
  <uniqueid type="lumen" default="true">lh-quiet-001</uniqueid>
  <plot>A night-shift keeper tends a lantern on a rain-soaked pier while
    unfinished letters stack beside a brass kerosene lamp. The harbor
    is fictional. The moths are unionized. No cloud accounts are
    opened. The document remains the interface.</plot>
  <tagline>The chrome keeps your place. The weather keeps the rest.</tagline>
  <genre>Drama</genre>
  <genre>Documentary</genre>
  <genre>Weather</genre>
  <country>Nowhere in particular</country>
  <studio>Lumen Harbor Station</studio>
  <credits>The Keeper</credits>
  <director>Rain on Glass</director>
  <actor>
    <name>Ida the Paper Moth</name>
    <role>Census of the lantern glass</role>
    <order>0</order>
  </actor>
  <actor>
    <name>Empty Chair</name>
    <role>Reflection</role>
    <order>1</order>
  </actor>
  <actor>
    <name>Brass Lantern #4</name>
    <role>Light</role>
    <order>2</order>
  </actor>
  <fileinfo>
    <streamdetails>
      <video>
        <codec>av1</codec>
        <aspect>16:9</aspect>
        <width>1920</width>
        <height>1080</height>
        <durationinseconds>5820</durationinseconds>
      </video>
      <audio>
        <codec>flac</codec>
        <language>und</language>
        <channels>2</channels>
      </audio>
    </streamdetails>
  </fileinfo>
  <set>
    <name>Lumen Harbor Field Notes</name>
    <overview>Companion documents for exercising open.md formats.</overview>
  </set>
  <thumb aspect="poster">assets/harbor-night.png</thumb>
  <fanart>
    <thumb>assets/rain-glass.avif</thumb>
  </fanart>
</movie>
'''


def main() -> None:
    # CP437 fixtures exist for the decoder tests. Showcase examples are UTF-8.
    scene = encode_cp437(scene_nfo()) + b"\x1a"
    ROOT.joinpath("sample-scene.nfo").write_bytes(scene)
    ROOT.joinpath("sample-nfo-lt-art.nfo").write_bytes(encode_cp437(lt_art_nfo()))

    program_nfo = EXAMPLES.joinpath("lumen-station.nfo")
    if program_nfo.is_file():
        ROOT.joinpath("sample-nfo-utf8.nfo").write_bytes(program_nfo.read_bytes())
    else:
        ROOT.joinpath("sample-nfo-utf8.nfo").write_text(
            utf8_nfo(), encoding="utf-8", newline="\n"
        )

    kodi = EXAMPLES.joinpath("kodi-the-quiet-place.nfo")
    if kodi.is_file():
        ROOT.joinpath("sample-nfo-xml.nfo").write_bytes(kodi.read_bytes())
    else:
        ROOT.joinpath("sample-nfo-xml.nfo").write_text(
            kodi_xml(), encoding="utf-8", newline="\n"
        )

    print("wrote nfo fixtures")
    for path in (
        ROOT / "sample-scene.nfo",
        ROOT / "sample-nfo-utf8.nfo",
        ROOT / "sample-nfo-xml.nfo",
        ROOT / "sample-nfo-lt-art.nfo",
    ):
        print(f"  {path.name:28} {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
