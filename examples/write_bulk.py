"""Generate the bulky companion samples: CSV, log, and Windows MsInfo XML."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"


def csv_escape(value: object) -> str:
    text = "" if value is None else str(value)
    if any(ch in text for ch in ',\"\n'):
        return '"' + text.replace('"', '""') + '"'
    return text


def write_tide_log() -> None:
    header = [
        "logged_at",
        "watch",
        "keeper",
        "tide_cm",
        "phase",
        "flood_delta_cm",
        "fog_m",
        "wind_kt",
        "wind_from",
        "moths",
        "lamp_id",
        "wick_mm",
        "fuel_ml",
        "radio",
        "chair_occupied",
        "note",
    ]
    start = datetime(2026, 8, 25, 0, 5, tzinfo=timezone.utc)
    phases = ["flood", "flood", "slack", "ebb", "ebb", "slack"]
    winds = ["WSW", "SW", "W", "WNW", "NW", "W"]
    keepers = {
        "first": "Glass-Eater's friend",
        "middle": "the unnamed",
        "last": "the unnamed still",
    }
    rows = [",".join(header)]
    for hour in range(48):
        at = start + timedelta(hours=hour)
        local_hour = (at.hour + 1) % 24
        if 6 <= local_hour < 14:
            watch = "first"
        elif 14 <= local_hour < 22:
            watch = "middle"
        else:
            watch = "last"
        phase = phases[hour % len(phases)]
        tide = 120 + int(32 * (1 if phase == "flood" else -0.4) + 18 * ((hour % 7) - 3))
        fog = 8 + (hour * 3) % 70
        moths = 2 + (hour // 3) % 13
        radio = "number" if fog > 50 else ("static" if fog > 35 else "clear")
        note = (
            f"Hour {hour}: {phase} water, {fog} m fog, radio {radio}, café on the sill"
            if hour % 5 == 0
            else f"{phase}; counted moths twice"
        )
        if hour == 46:
            note = "Last digit of the radio number erased by rain, Tokyo, naïve"
        row = [
            at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            watch,
            keepers[watch],
            tide,
            phase,
            tide - 142,
            fog,
            6 + hour % 17,
            winds[hour % len(winds)],
            moths,
            4,
            6 + (hour % 4),
            510 - hour * 3,
            radio,
            "false",
            note,
        ]
        rows.append(",".join(csv_escape(item) for item in row))
    ROOT.joinpath("tide-log.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")


def write_overnight_log() -> None:
    start = datetime(2026, 8, 26, 21, 58, 0, tzinfo=timezone.utc)
    lines = []

    def emit(offset_s: float, level: str, logger: str, message: str) -> None:
        at = start + timedelta(seconds=offset_s)
        lines.append(
            f"{at.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3]}Z {level:<5} {logger} {message}"
        )

    emit(0, "INFO", "harbor.boot", "pier daemon 1.4.7 wet-wick cloud=false")
    emit(0.4, "DEBUG", "harbor.config", "loaded station.ini radio.cfg harbor.conf harbor.env")
    emit(1.1, "INFO", "harbor.lamp", "lantern id=4 fuel=kerosene wick_mm=7 fuel_ml=390 trimmed=true")
    emit(2.0, "INFO", "harbor.census", "moths=14 named=Ida,Percival,Little Noise,Glass-Eater")
    emit(3.2, "DEBUG", "harbor.radio", "listen 2182 kHz call_sign=LH-00")
    emit(8.0, "INFO", "harbor.watch", "last watch standing keeper=the unnamed still")
    emit(21.0, "WARN", "harbor.radio", "voice swallowed; last_heard=number fog_m=41")
    emit(21.4, "DEBUG", "harbor.radio", "retry scheduled retry_seconds=11")
    emit(32.6, "INFO", "harbor.radio", "number written to blotter; last digit wet")
    emit(40.0, "TRACE", "harbor.chair", "occupied=false kind=reflection")
    emit(55.0, "INFO", "harbor.tide", "flood 184 cm at pier chart=assets/harbor-chart.jpeg")
    emit(70.0, "DEBUG", "harbor.fs", "opened a-quiet-place.md bytes=ok images=8")
    emit(71.2, "DEBUG", "harbor.fs", "opened lumen-station.nfo encoding=utf-8 format=nfo")
    emit(72.0, "DEBUG", "harbor.fs", "opened kodi-the-quiet-place.nfo encoding=utf-8 format=text")
    emit(73.0, "DEBUG", "harbor.fs", "opened windows-msinfo.nfo encoding=utf-8 format=text")
    emit(90.0, "WARN", "harbor.moth", "Percival on the halo again; union clause cited")
    emit(120.0, "INFO", "harbor.letter", "night-watch.txt drafted posted=false")
    emit(140.0, "ERROR", "harbor.radio", "call sign LH-00 not acknowledged after 3 retries")
    lines.append("    at harbor.radio.handshake(radio.cfg:44)")
    lines.append("    at harbor.radio.retry(radio.rs:218)")
    lines.append("    at harbor.watch.last(overnight.log:1)")
    lines.append("Caused by: fog.SwallowError: channel ch-4 ate the voice")
    lines.append("    at fog.bank.twelve(weather.yaml:18)")
    emit(141.0, "WARN", "harbor.radio", "continuing watch; do not invent the last digit")
    emit(180.0, "INFO", "harbor.lamp", "wick still 7 mm halo=bored")
    emit(240.0, "DEBUG", "harbor.unicode", "café naïve 東京 π — intact")
    emit(300.0, "INFO", "harbor.census", "recount moths=14 chair still empty")
    emit(360.0, "DEBUG", "harbor.tide", "flood holding 184 cm; do not invent centimetres")
    emit(420.0, "TRACE", "harbor.minimap", "optional=true rendered=false")
    for minute in range(10, 46, 5):
        emit(
            420.0 + minute * 12,
            "DEBUG",
            "harbor.heartbeat",
            f"watch=last fog_m={50 + minute} moths=14 radio=number chair=empty",
        )
    emit(900.0, "WARN", "harbor.moth", "Glass-Eater declined the photograph again")
    emit(960.0, "INFO", "harbor.fs", "relative image ok path=assets/quiet-desk.webp")
    emit(961.0, "INFO", "harbor.fs", "relative image ok path=assets/harbor-night.png")
    emit(962.0, "INFO", "harbor.fs", "relative image ok path=assets/lantern.jpg")
    emit(963.0, "INFO", "harbor.fs", "relative image ok path=assets/lantern.gif")
    emit(964.0, "INFO", "harbor.fs", "relative image ok path=assets/paper-moth.webp")
    emit(965.0, "INFO", "harbor.fs", "relative image ok path=assets/harbor-chart.jpeg")
    emit(966.0, "INFO", "harbor.fs", "relative image ok path=assets/pigments.bmp")
    emit(967.0, "INFO", "harbor.fs", "relative image ok path=assets/rain-glass.avif")
    emit(1020.0, "INFO", "harbor.letter", "postscript 3 inventory written")
    emit(1100.0, "INFO", "harbor.watch", "23:47 local fog; letter unposted; daemon idle")
    emit(1101.0, "DEBUG", "harbor.boot", "no cloud session, as requested")
    FIXTURES.joinpath("sample-app.log").write_text(
        "\n".join(lines[:8]) + "\n", encoding="utf-8"
    )
    ROOT.joinpath("overnight.log").write_text("\n".join(lines) + "\n", encoding="utf-8")


def data_pair(item: str, value: str) -> str:
    return (
        "<Data>"
        f"<Item><![CDATA[{item}]]></Item>"
        f"<Value><![CDATA[{value}]]></Value>"
        "</Data>"
    )


def data_row(fields: dict[str, str]) -> str:
    inner = "".join(
        f"<{key}><![CDATA[{value}]]></{key}>" for key, value in fields.items()
    )
    return f"<Data>{inner}</Data>"


def write_msinfo() -> None:
    created = "08/26/26 23:47:00"
    parts: list[str] = [
        '<?xml version="1.0"?>',
        "<MsInfo>",
        "<Metadata>",
        "<Version>8.0</Version>",
        f"<CreationUTC>{created}</CreationUTC>",
        "</Metadata>",
        '<Category name="System Summary">',
        data_pair("OS Name", "Lumen Harbor Keeper OS"),
        data_pair("Version", "10.0.26200 Build 26200"),
        data_pair("Other OS Description", "Night-shift edition, café-aware"),
        data_pair("OS Manufacturer", "Lumen Harbor Workshop"),
        data_pair("System Name", "LUMEN-HARBOR"),
        data_pair("System Manufacturer", "Pier Desk Assemblies"),
        data_pair("System Model", "Quiet Place 14"),
        data_pair("System Type", "x64-based PC"),
        data_pair("System SKU", "LH-00-UTF8"),
        data_pair("Processor", "Lantern Core 7 @ 2.10 GHz, 8 cores, 16 logical"),
        data_pair("BIOS Version/Date", "Wet Wick 1.4.7, 26/08/2026"),
        data_pair("SMBIOS Version", "3.6"),
        data_pair("Embedded Controller Version", "4.07"),
        data_pair("BIOS Mode", "UEFI"),
        data_pair("BaseBoard Manufacturer", "Harbor Plankworks"),
        data_pair("BaseBoard Product", "PIER-DESK-4"),
        data_pair("Platform Role", "Desktop"),
        data_pair("Secure Boot State", "On"),
        data_pair("PCR7 Configuration", "Elevation Required to View"),
        data_pair("Windows Directory", "C:\\Keeper\\Windows"),
        data_pair("System Directory", "C:\\Keeper\\Windows\\System32"),
        data_pair("Boot Device", "\\Device\\HarddiskVolume4"),
        data_pair("Locale", "United Kingdom"),
        data_pair("Hardware Abstraction Layer", "10.0.26200.1000"),
        data_pair("User Name", "LUMEN-HARBOR\\keeper"),
        data_pair("Time Zone", "(UTC+00:00) Dublin, Edinburgh, Lisbon, London"),
        data_pair("Installed Physical Memory (RAM)", "32.00 GB"),
        data_pair("Total Physical Memory", "31.7 GB"),
        data_pair("Available Physical Memory", "18.4 GB"),
        data_pair("Total Virtual Memory", "36.7 GB"),
        data_pair("Available Virtual Memory", "22.1 GB"),
        data_pair("Page File Space", "5.00 GB"),
        data_pair("Page File", "C:\\pagefile.sys"),
        data_pair("Kernel DMA Protection", "On"),
        data_pair("Virtualization-based security", "Running"),
        data_pair("Hyper-V - VM Monitor Mode Extensions", "Yes"),
        "</Category>",
        '<Category name="Hardware Resources">',
        '<Category name="Conflicts/Sharing">',
        data_row(
            {
                "Resource_Type": "I/O Port",
                "Device": "Lantern #4 kerosene controller",
                "Status": "Shared with moth census UART",
            }
        ),
        data_row(
            {
                "Resource_Type": "IRQ",
                "Device": "Fog bank twelve",
                "Status": "No conflict. Voice optional.",
            }
        ),
        "</Category>",
        '<Category name="DMA">',
        data_row({"Channel": "4", "Device": "Direct lamp access", "Status": "OK"}),
        "</Category>",
        '<Category name="Forced Hardware">',
        data_row(
            {
                "Device": "Empty chair reflection",
                "PNP_Device_ID": "CHAIR\\REFLECTION\\GLASS",
                "Error_Code": "This device is working properly. Do not sit.",
            }
        ),
        "</Category>",
        '<Category name="I/O">',
        data_row({"Address_Range": "0x03F8-0x03FF", "Device": "Harbor radio COM1"}),
        data_row({"Address_Range": "0x0378-0x037A", "Device": "Blotter parallel (unused)"}),
        "</Category>",
        '<Category name="IRQs">',
        data_row({"IRQ_Channel": "IRQ 5", "Device": "Radio 2182 kHz"}),
        data_row({"IRQ_Channel": "IRQ 11", "Device": "Moth union GPIO"}),
        data_row({"IRQ_Channel": "IRQ 12", "Device": "Rain on glass HID"}),
        "</Category>",
        '<Category name="Memory">',
        data_row(
            {
                "Address_Range": "0xA0000-0xBFFFF",
                "Device": "VGA cell grid (fixtures only)",
            }
        ),
        data_row(
            {
                "Address_Range": "0xF0000000-0xF1FFFFFF",
                "Device": "Lantern display adapter",
            }
        ),
        "</Category>",
        "</Category>",
        '<Category name="Components">',
        '<Category name="Display">',
        data_row(
            {
                "Name": "Lantern Display Adapter",
                "PNP_Device_ID": "PCI\\VEN_0E4D&DEV_1987",
                "Adapter_Type": "Internal",
                "Adapter_Description": "Wet Wick GPU 4",
                "Adapter_RAM": "8.00 GB",
                "Driver_Version": "1.4.7.2347",
                "Inf_File": "lumen.inf",
                "Color_Planes": "1",
                "Color_Table_Entries": "4294967296",
                "Resolution": "1920 x 1080 x 60 hertz",
                "Bits_Per_Pixel": "32",
            }
        ),
        "</Category>",
        '<Category name="Sound Device">',
        data_row(
            {
                "Name": "Fog Bank Audio",
                "PNP_Device_ID": "HDAUDIO\\FUNC_01&VEN_8086",
                "Manufacturer": "Lumen Harbor Workshop",
                "Status": "OK",
            }
        ),
        "</Category>",
        '<Category name="Storage">',
        '<Category name="Drives">',
        data_row(
            {
                "Description": "Local Fixed Disk",
                "Drive": "C:",
                "Volume_Name": "KEEPER",
                "File_System": "NTFS",
                "Size": "952.00 GB",
                "Free_Space": "611.12 GB",
                "Compressed": "No",
            }
        ),
        "</Category>",
        '<Category name="Disks">',
        data_row(
            {
                "Description": "Disk drive",
                "Manufacturer": "Pier Desk Assemblies",
                "Model": "QUIET-PLACE-1TB",
                "Bytes_Per_Sector": "4096",
                "Media_Type": "Fixed hard disk media",
                "Partitions": "3",
                "SCSI_Bus": "0",
                "SATA_Port": "0",
                "Size": "1024.20 GB",
            }
        ),
        "</Category>",
        "</Category>",
        '<Category name="Network">',
        '<Category name="Adapter">',
        data_row(
            {
                "Name": "Harbor Radio 2182",
                "Adapter_Type": "Ethernet 802.3",
                "Connection_Name": "ch-4",
                "MAC_Address": "00-LH-00-CA-FE-14",
                "DHCP_Enabled": "No",
                "IP_Address": "0.0.0.0 (cloud forbidden)",
                "Default_IP_Gateway": "fog",
            }
        ),
        "</Category>",
        "</Category>",
        '<Category name="Ports">',
        '<Category name="Serial">',
        data_row(
            {
                "Name": "Communications Port (COM1)",
                "Status": "OK",
                "PNP_Device_ID": "ACPI\\PNP0501\\1",
            }
        ),
        "</Category>",
        "</Category>",
        "</Category>",
        '<Category name="Software Environment">',
        '<Category name="System Drivers">',
        data_row(
            {
                "Name": "lamp.sys",
                "Description": "Kerosene lantern #4",
                "File": "C:\\Keeper\\Windows\\System32\\drivers\\lamp.sys",
                "Started": "Yes",
                "Start_Mode": "Auto",
                "State": "Running",
                "Status": "OK",
                "Error_Control": "Normal",
                "Accept_Pause": "FALSE",
                "Accept_Stop": "TRUE",
            }
        ),
        data_row(
            {
                "Name": "fog.sys",
                "Description": "Fog bank twelve",
                "File": "C:\\Keeper\\Windows\\System32\\drivers\\fog.sys",
                "Started": "Yes",
                "Start_Mode": "Auto",
                "State": "Running",
                "Status": "OK",
                "Error_Control": "Ignore",
                "Accept_Pause": "FALSE",
                "Accept_Stop": "FALSE",
            }
        ),
        "</Category>",
        '<Category name="Services">',
        data_row(
            {
                "Display_Name": "Lumen Harbor Pier Daemon",
                "Name": "HarborConf",
                "State": "Running",
                "Start_Mode": "Auto",
                "Service_Type": "Own Process",
                "Path": "C:\\Keeper\\lumen-station.exe --conf harbor.conf",
                "Error_Control": "Normal",
                "Start_Name": "LocalSystem",
                "Tag_ID": "0",
            }
        ),
        data_row(
            {
                "Display_Name": "Moth Census",
                "Name": "MothUnion",
                "State": "Running",
                "Start_Mode": "Auto",
                "Service_Type": "Own Process",
                "Path": "C:\\Keeper\\census.exe --named Ida,Percival",
                "Error_Control": "Normal",
                "Start_Name": "NT AUTHORITY\\LocalService",
                "Tag_ID": "0",
            }
        ),
        data_row(
            {
                "Display_Name": "Cloud Phone-Home",
                "Name": "NoCloud",
                "State": "Stopped",
                "Start_Mode": "Disabled",
                "Service_Type": "Own Process",
                "Path": "C:\\Keeper\\do-not-run.exe",
                "Error_Control": "Critical",
                "Start_Name": "LocalSystem",
                "Tag_ID": "0",
            }
        ),
        "</Category>",
        '<Category name="Startup Programs">',
        data_row(
            {
                "Name": "Lumen Harbor Station Tools",
                "Command": '"C:\\Keeper\\lumen-station.exe"',
                "Location": "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                "User": "keeper",
            }
        ),
        data_row(
            {
                "Name": "Trim wick reminder",
                "Command": "C:\\Keeper\\trim-lamp.cmd",
                "Location": "Startup",
                "User": "keeper",
            }
        ),
        "</Category>",
        '<Category name="Environment Variables">',
        data_row(
            {
                "Variable": "HARBOR_NAME",
                "Value": "Lumen Harbor",
                "User_Name": "LUMEN-HARBOR\\keeper",
            }
        ),
        data_row(
            {
                "Variable": "HARBOR_CLOUD",
                "Value": "false",
                "User_Name": "LUMEN-HARBOR\\keeper",
            }
        ),
        data_row(
            {
                "Variable": "HARBOR_COFFEE",
                "Value": "café, naïve, 東京",
                "User_Name": "LUMEN-HARBOR\\keeper",
            }
        ),
        data_row(
            {
                "Variable": "Path",
                "Value": "C:\\Keeper;C:\\Keeper\\Windows\\System32",
                "User_Name": "<SYSTEM>",
            }
        ),
        "</Category>",
        '<Category name="Running Tasks">',
        data_row(
            {
                "Name": "lumen-station.exe",
                "PID": "1987",
                "Session": "1",
                "Mem_Usage": "84,212 K",
                "Status": "Running",
                "User_Name": "LUMEN-HARBOR\\keeper",
                "CPU_Time": "0:11:14",
                "Window_Title": "a-quiet-place.md — open.md",
            }
        ),
        data_row(
            {
                "Name": "msinfo32.exe",
                "PID": "437",
                "Session": "1",
                "Mem_Usage": "22,400 K",
                "Status": "Running",
                "User_Name": "LUMEN-HARBOR\\keeper",
                "CPU_Time": "0:00:09",
                "Window_Title": "System Information",
            }
        ),
        "</Category>",
        "</Category>",
        "</MsInfo>",
        "",
    ]
    # Keep CDATA unicode; escape() not used because CDATA holds the values.
    xml = "\n".join(parts)
    ROOT.joinpath("windows-msinfo.nfo").write_text(xml, encoding="utf-8")
    _ = escape  # imported for accidental raw XML; values stay in CDATA


def write_fixture_companions() -> None:
    FIXTURES.joinpath("sample-config.json").write_text(
        ROOT.joinpath("lumen-harbor.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    FIXTURES.joinpath("sample-table.csv").write_text(
        ROOT.joinpath("tide-log.csv").read_text(encoding="utf-8"),
        encoding="utf-8",
    )


def main() -> None:
    write_tide_log()
    write_overnight_log()
    write_msinfo()
    write_fixture_companions()
    for path in (
        ROOT / "tide-log.csv",
        ROOT / "overnight.log",
        ROOT / "windows-msinfo.nfo",
        FIXTURES / "sample-config.json",
        FIXTURES / "sample-table.csv",
        FIXTURES / "sample-app.log",
    ):
        print(f"{path.name:24} {path.stat().st_size:7d} bytes")


if __name__ == "__main__":
    main()
