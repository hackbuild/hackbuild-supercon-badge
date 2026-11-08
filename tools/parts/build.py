"""Builds docs/parts/parts.json, the parts Name That Package asks about.

Footprints come from the KiCad library mirror on GitHub (frozen 2020, fine for classic packages),
Espressif's own KiCad library, and the hbf catalog in hackbuild-fab. Pin names come from the
current KiCad symbol library on GitLab, so the pinout shown on a reveal is the one KiCad ships.
Every file is cached in tools/parts/.cache, so a rebuild works offline.

    python3 -I tools/parts/build.py [path to hackbuild-fab]
"""
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = pathlib.Path(__file__).resolve().parent / ".cache"
OUT = ROOT / "docs" / "parts" / "parts.json"
FAB = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "hackbuild-fab"

KICAD_FP = "https://raw.githubusercontent.com/KiCad/kicad-footprints/master/"
KICAD_SYM = "https://gitlab.com/kicad/libraries/kicad-symbols/-/raw/master/"
KICAD_FP_NEW = "https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/"
ESPRESSIF = "https://raw.githubusercontent.com/espressif/kicad-libraries/main/"

# id, answer, other accepted answers, footprint, symbol (or None), chip shown on the reveal, fact.
# A symbol is "lib/Name" in the KiCad library, "espressif:Name", or "fab:<catalog dir>".
PARTS = [
    ("dip8", "DIP-8", ["dip8", "pdip8", "dip 8"], KICAD_FP + "Package_DIP.pretty/DIP-8_W7.62mm.kicad_mod",
     "Timer/NE555P", "NE555", "Hans Camenzind designed the 555 at Signetics in 1971."),
    ("dip14", "DIP-14", ["dip14", "pdip14"], KICAD_FP + "Package_DIP.pretty/DIP-14_W7.62mm.kicad_mod",
     "74xx/74HC00", "74HC00", "Four NAND gates. Enough to build any logic, slowly."),
    ("dip16", "DIP-16", ["dip16", "pdip16"], KICAD_FP + "Package_DIP.pretty/DIP-16_W7.62mm.kicad_mod",
     "74xx/74HC595", "74HC595", "Eight outputs from three pins, chained as far as you like."),
    ("dip28", "DIP-28", ["dip28", "pdip28", "narrow dip28"], KICAD_FP + "Package_DIP.pretty/DIP-28_W7.62mm.kicad_mod",
     "MCU_Microchip_ATmega/ATmega328P-P", "ATmega328P", "The socketed chip on an Arduino Uno."),
    ("dip40", "DIP-40", ["dip40", "pdip40", "wide dip40"], KICAD_FP + "Package_DIP.pretty/DIP-40_W15.24mm.kicad_mod",
     "CPU/Z84C00xxP", "Z80", "Zilog shipped the Z80 in 1976 and still sold it until 2024."),
    ("cdp1802", "CDP1802", ["1802", "cosmac", "rca 1802"], KICAD_FP + "Package_DIP.pretty/DIP-40_W15.24mm.kicad_mod",
     "CPU/CDP1802ACE", "CDP1802", "RCA's COSMAC. The Galileo probe flew 1802s to Jupiter."),
    ("to220", "TO-220", ["to220"], KICAD_FP + "Package_TO_SOT_THT.pretty/TO-220-3_Vertical.kicad_mod",
     "Regulator_Linear/L7805", "L7805", "A fixed 5 V linear regulator. The tab is ground."),
    ("to92", "TO-92", ["to92"], KICAD_FP + "Package_TO_SOT_THT.pretty/TO-92_Inline.kicad_mod",
     "Transistor_BJT/2N3904", "2N3904", "A general purpose NPN transistor. E, B, C, flat side facing you."),
    ("to3", "TO-3", ["to3", "metal can"], KICAD_FP + "Package_TO_SOT_THT.pretty/TO-3.kicad_mod",
     None, "2N3055", "The metal can is the collector. Two pins and two mounting holes."),
    ("sot23", "SOT-23", ["sot23", "sot23-3"], KICAD_FP + "Package_TO_SOT_SMD.pretty/SOT-23.kicad_mod",
     "Transistor_FET/2N7002", "2N7002", "Small N channel MOSFET. Three pins, about 3 mm long."),
    ("sot23_5", "SOT-23-5", ["sot23-5", "sot235", "sot-25", "sot25"], KICAD_FP + "Package_TO_SOT_SMD.pretty/SOT-23-5.kicad_mod",
     "Regulator_Linear/AP2112K-3.3", "AP2112K-3.3", "A 3.3 V LDO, the one on a lot of ESP32 boards."),
    ("sot223", "SOT-223", ["sot223"], KICAD_FP + "Package_TO_SOT_SMD.pretty/SOT-223-3_TabPin2.kicad_mod",
     "Regulator_Linear/AMS1117-3.3", "AMS1117-3.3", "The 3.3 V regulator on countless cheap dev boards."),
    ("sot89", "SOT-89", ["sot89", "sot89-3"], KICAD_FP + "Package_TO_SOT_SMD.pretty/SOT-89-3.kicad_mod",
     None, "", "The big middle pad doubles as a heat spreader."),
    ("dpak", "DPAK", ["to-252", "to252", "d-pak"], KICAD_FP + "Package_TO_SOT_SMD.pretty/TO-252-2.kicad_mod",
     None, "", "TO-252, a surface mount power package with a big tab."),
    ("soic8", "SOIC-8", ["soic8", "so-8", "so8", "sop8"], KICAD_FP + "Package_SO.pretty/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod",
     "Timer/NE555D", "NE555", "Same 555, same pinout, 1.27 mm pitch."),
    ("tssop20", "TSSOP-20", ["tssop20"], KICAD_FP + "Package_SO.pretty/TSSOP-20_4.4x6.5mm_P0.65mm.kicad_mod",
     "MCU_WCH_RiscV/CH32V003FxPx", "CH32V003", "The ten cent RISC-V microcontroller."),
    ("msop10", "MSOP-10", ["msop10", "msop"], KICAD_FP + "Package_SO.pretty/MSOP-10_3x3mm_P0.5mm.kicad_mod",
     None, "", "Ten pins at 0.5 mm pitch on a 3 mm body."),
    ("tqfp32", "TQFP-32", ["tqfp32", "qfp32"], KICAD_FP + "Package_QFP.pretty/TQFP-32_7x7mm_P0.8mm.kicad_mod",
     "MCU_Microchip_ATmega/ATmega328P-A", "ATmega328P-AU", "The surface mount 328P on an Arduino Nano."),
    ("lqfp48", "LQFP-48", ["lqfp48", "qfp48", "tqfp48"], KICAD_FP + "Package_QFP.pretty/LQFP-48_7x7mm_P0.5mm.kicad_mod",
     "MCU_ST_STM32F1/STM32F103C8Tx", "STM32F103C8", "The Blue Pill chip."),
    ("qfn56", "QFN-56", ["qfn56"], KICAD_FP + "Package_DFN_QFN.pretty/QFN-56-1EP_7x7mm_P0.4mm_EP5.6x5.6mm.kicad_mod",
     "MCU_RaspberryPi/RP2040", "RP2040", "Raspberry Pi's first chip, the one in the Pico."),
    ("plcc44", "PLCC-44", ["plcc44", "plcc"], KICAD_FP + "Package_LCC.pretty/PLCC-44_16.6x16.6mm_P1.27mm.kicad_mod",
     None, "", "J leads tucked under the body, made to sit in a socket."),
    ("ws2812b", "WS2812B", ["ws2812", "neopixel", "5050", "ws2812b 5050"], KICAD_FP + "LED_SMD.pretty/LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm.kicad_mod",
     "LED/WS2812B", "WS2812B", "An RGB LED with its own driver. Data in, data out."),
    ("r0805", "0805", ["r0805", "0805 resistor", "2012 metric", "2012"], KICAD_FP + "Resistor_SMD.pretty/R_0805_2012Metric.kicad_mod",
     None, "", "0.08 by 0.05 inches. 2.0 by 1.25 mm in metric."),
    ("sma", "SMA", ["do-214ac", "d sma", "sma diode"], KICAD_FP + "Diode_SMD.pretty/D_SMA.kicad_mod",
     None, "", "DO-214AC. The stripe end is the cathode."),
    ("hc49", "HC-49", ["hc49", "hc49u", "crystal"], KICAD_FP + "Crystal.pretty/Crystal_HC49-U_Vertical.kicad_mod",
     None, "", "The classic through hole crystal can."),
    ("sw6mm", "6 mm tactile switch", ["tact switch", "tactile switch", "push button", "button", "sw push 6mm"], KICAD_FP + "Button_Switch_THT.pretty/SW_PUSH_6mm.kicad_mod",
     None, "", "Four legs, two pairs tied together inside."),
    ("cr2032", "CR2032 holder", ["cr2032", "coin cell", "coin cell holder", "2032"], KICAD_FP + "Battery.pretty/BatteryHolder_Keystone_3034_1x20mm.kicad_mod",
     None, "", "A Keystone 3034 holder for a 20 mm coin cell."),
    ("jstph2", "JST PH", ["jst", "jst ph 2", "ph 2.0", "jst-ph"], KICAD_FP + "Connector_JST.pretty/JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical.kicad_mod",
     None, "", "2.0 mm pitch. The LiPo connector, check the polarity."),
    ("usbc", "USB-C", ["usb c", "usbc", "type c", "usb type c"], KICAD_FP + "Connector_USB.pretty/USB_C_Receptacle_Amphenol_12401610E4-2A.kicad_mod",
     "Connector/USB_C_Receptacle", "USB-C receptacle", "Two rows of 12 contacts, and it still goes in both ways."),
    ("microusb", "Micro USB", ["micro b", "micro usb", "usb micro b", "microusb"], KICAD_FP + "Connector_USB.pretty/USB_Micro-B_Molex_47346-0001.kicad_mod",
     "Connector/USB_B_Micro", "Micro-B", "Five pins and a lot of torn off pads."),
    ("microsd", "microSD socket", ["microsd", "micro sd", "sd card", "tf card"], KICAD_FP + "Connector_Card.pretty/microSD_HC_Hirose_DM3AT-SF-PEJM5.kicad_mod",
     "Connector/Micro_SD_Card_Det_Hirose_DM3AT", "microSD", "Eight contacts plus a card detect switch."),
    ("pi40", "Raspberry Pi header", ["2x20 header", "40 pin header", "gpio header", "pi header", "raspberry pi gpio"], KICAD_FP + "Connector_PinHeader_2.54mm.pretty/PinHeader_2x20_P2.54mm_Vertical.kicad_mod",
     "Connector/Raspberry_Pi_2_3", "Raspberry Pi GPIO", "Pin 1 is 3V3, pin 2 is 5V, and pin 6 is the first ground."),
    ("esp12e", "ESP-12E", ["esp12", "esp12e", "esp8266", "esp-12f", "esp12f"], KICAD_FP + "RF_Module.pretty/ESP-12E.kicad_mod",
     "RF_Module/ESP-12E", "ESP8266", "The module that put WiFi on everything in 2015."),
    ("wroom32", "ESP32-WROOM-32", ["esp32 wroom", "wroom32", "esp32", "esp32-wroom", "wroom"], KICAD_FP + "RF_Module.pretty/ESP32-WROOM-32.kicad_mod",
     "RF_Module/ESP32-WROOM-32", "ESP32", "The keepout at the top is for the antenna."),
    ("s3wroom1", "ESP32-S3-WROOM-1", ["esp32 s3", "esp32s3", "s3 wroom", "esp32-s3", "wroom-1", "esp32 s3 wroom"], ESPRESSIF + "footprints/Espressif.pretty/ESP32-S3-WROOM-1.kicad_mod",
     "espressif:ESP32-S3-WROOM-1", "ESP32-S3", "An ESP32-S3 module, the same chip family as this badge."),
    ("nano", "Arduino Nano", ["nano", "arduino nano v3"], KICAD_FP + "Module.pretty/Arduino_Nano.kicad_mod",
     "MCU_Module/Arduino_Nano_v3.x", "Arduino Nano", "Breadboard friendly, 15 pins a side."),
    ("pico", "Raspberry Pi Pico", ["pico", "rpi pico", "raspberry pico"], KICAD_FP_NEW + "Module.pretty/RaspberryPi_Pico_Common_THT.kicad_mod",
     "MCU_Module/RaspberryPi_Pico", "Raspberry Pi Pico", "Castellated edges, so it solders flat onto a board."),
    ("supermini", "ESP32-C3 SuperMini", ["supermini", "c3 supermini", "esp32c3 supermini", "esp32-c3"], "fab:esp32c3-supermini",
     "fab:esp32c3-supermini", "ESP32-C3", "Smaller than a postage stamp, with USB-C and WiFi."),
]

LICENCE_NOTE = (
    "Footprints and pin names from the KiCad libraries (kicad.org/libraries/license) and Espressif's "
    "KiCad libraries, CC-BY-SA 4.0 with the KiCad design exception. The ESP32-C3 SuperMini footprint "
    "is drawn by hackbuild-fab."
)


def fetch(url):
    """One cached download. The cache key is the URL path, so reruns never hit the network."""
    path = CACHE / re.sub(r"[^A-Za-z0-9._-]+", "_", url.split("://", 1)[1])
    if not path.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "hackbuild-parts-build"})
        with urllib.request.urlopen(req, timeout=30) as r:
            path.write_bytes(r.read())
    return path.read_text(encoding="utf-8")


def sexpr(text):
    """A KiCad s-expression as nested lists of strings."""
    tokens = re.findall(r'\(|\)|"(?:[^"\\]|\\.)*"|[^\s()]+', text)
    stack, cur = [], []
    for t in tokens:
        if t == "(":
            stack.append(cur)
            cur = []
        elif t == ")":
            done, cur = cur, stack.pop()
            cur.append(done)
        else:
            cur.append(t[1:-1] if t.startswith('"') else t)
    return cur[0]


def child(node, name):
    return next((c for c in node if isinstance(c, list) and c and c[0] == name), None)


def children(node, name):
    return [c for c in node if isinstance(c, list) and c and c[0] == name]


def num(v):
    return round(float(v), 3)


def layer_of(node):
    lay = child(node, "layer")
    return lay[1] if lay else ""


def footprint(text):
    """Pads and a body outline in mm, KiCad frame (y down)."""
    root = sexpr(text)
    pads = []
    for p in children(root, "pad"):
        number, kind, shape = p[1], p[2], p[3]
        at = child(p, "at")
        size = child(p, "size")
        if not at or not size:
            continue
        x, y = num(at[1]), num(at[2])
        rot = num(at[3]) if len(at) > 3 else 0
        w, h = num(size[1]), num(size[2])
        if round(rot) % 180 == 90:
            w, h = h, w
        hole = kind == "np_thru_hole"
        pads.append([number, x, y, w, h, {"circle": "c", "oval": "o"}.get(shape, "r"), 1 if kind == "thru_hole" else 2 if hole else 0])
    lines = []
    for want in ("F.Fab", "F.SilkS", "F.Silkscreen"):
        lines = outline(root, want)
        if lines:
            break
    return pads, lines


def outline(root, layer):
    segs = []
    for n in root:
        if not isinstance(n, list) or not n or layer_of(n) != layer:
            continue
        kind = n[0]
        if kind == "fp_line":
            s, e = child(n, "start"), child(n, "end")
            segs.append([num(s[1]), num(s[2]), num(e[1]), num(e[2])])
        elif kind == "fp_rect":
            s, e = child(n, "start"), child(n, "end")
            x0, y0, x1, y1 = num(s[1]), num(s[2]), num(e[1]), num(e[2])
            segs += [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]
        elif kind == "fp_circle":
            c, e = child(n, "center"), child(n, "end")
            r = ((num(e[1]) - num(c[1])) ** 2 + (num(e[2]) - num(c[2])) ** 2) ** 0.5
            segs.append(["c", num(c[1]), num(c[2]), round(r, 3)])
        elif kind == "fp_poly":
            pts = [(num(p[1]), num(p[2])) for p in children(child(n, "pts") or [], "xy")]
            segs += [[*pts[i], *pts[(i + 1) % len(pts)]] for i in range(len(pts))] if len(pts) > 1 else []
    return segs


def symbol_pins(spec):
    """Pin number to name, following a derived symbol to the one it extends."""
    if spec.startswith("espressif:"):
        name = spec.split(":", 1)[1]
        return pins_of(find_symbol(sexpr(fetch(ESPRESSIF + "symbols/Espressif.kicad_sym")), name), None)
    lib, name = spec.split("/", 1)
    root = sexpr(fetch(f"{KICAD_SYM}{lib}.kicad_symdir/{name}.kicad_sym"))
    sym = find_symbol(root, name)
    parent = child(sym, "extends")
    if parent:
        return symbol_pins(f"{lib}/{parent[1]}")
    return pins_of(sym, None)


def find_symbol(root, name):
    for s in children(root, "symbol"):
        if s[1] == name:
            return s
    raise KeyError(name)


def pins_of(sym, out):
    out = {} if out is None else out
    for c in sym:
        if not isinstance(c, list):
            continue
        if c[0] == "symbol":
            pins_of(c, out)
        elif c[0] == "pin":
            name, number = child(c, "name"), child(c, "number")
            if name and number and number[1] not in out:
                out[number[1]] = re.sub(r"~\{([^}]*)\}", r"\1", name[1]).replace("~", "")
    return out


def fab_part(dirname):
    base = FAB / "packages" / "catalog" / "data" / "modules" / dirname
    mod = next(base.glob("*.kicad_mod"))
    pins = json.loads((base / "pins.json").read_text())["pins"]
    return mod.read_text(encoding="utf-8"), {str(p["n"]): p["name"] for p in pins}


def build():
    CACHE.mkdir(parents=True, exist_ok=True)
    out = []
    for pid, answer, accept, fp, sym, chip, fact in PARTS:
        try:
            if fp.startswith("fab:"):
                text, pins = fab_part(fp[4:])
                src = f"hackbuild-fab catalog {fp[4:]}"
            else:
                text = fetch(fp)
                pins = symbol_pins(sym) if sym else {}
                src = fp.replace("https://", "")
            pads, lines = footprint(text)
        except Exception as ex:
            print(f"skip {pid}: {ex}")
            continue
        if not pads:
            print(f"skip {pid}: no pads")
            continue
        named = {k: v for k, v in pins.items() if any(p[0] == k for p in pads)}
        out.append({
            "id": pid, "answer": answer, "accept": accept, "chip": chip, "fact": fact,
            "pads": pads, "lines": lines, "pins": named,
            "src": src, "sym": sym or "",
        })
        print(f"{pid:10} {len(pads):3} pads, {len(lines):3} lines, {len(named):3} pin names")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"licence": LICENCE_NOTE, "parts": out}, separators=(",", ":")))
    print(f"wrote {OUT.relative_to(ROOT)}, {len(out)} parts, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    build()
