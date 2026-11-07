"""Renders the badge art to 960x672 white, black and red palette PNGs.

Each screen is an SVG drawn by this file and rasterised by headless Chrome, so the
Google Fonts render for real. Pixels then go through the badge firmware's own colour
rule, so docs/slides shows exactly what the panel can show.

Run: uv run --no-project --with pillow python art/build.py
"""
import json
import math
import pathlib
import subprocess
import tempfile
import time
import zlib

from PIL import Image, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "slides"
BADGE_OUT = ROOT / "badge" / "screens"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H = 960, 672
INK, RED, PAPER = "#000000", "#ff0000", "#ffffff"
MARKER = "'Permanent Marker'"
MONO = "'IBM Plex Mono'"
FONT_DIR = ROOT / "art" / "fonts"
FONTS = "".join(
    f"@font-face{{font-family:'{fam}';font-weight:{wt};font-style:{sty};"
    f"src:url('{(FONT_DIR / file).as_uri()}')}}"
    for fam, wt, sty, file in (
        ("Permanent Marker", 400, "normal", "PermanentMarker-Regular.ttf"),
        ("IBM Plex Mono", 600, "normal", "IBMPlexMono-SemiBold.ttf"),
        ("Libre Baskerville", 400, "italic", "LibreBaskerville-Italic.ttf"),
    ))
MARK = json.loads((ROOT / "art" / "mark.json").read_text())


def width(s, size, font="PermanentMarker-Regular.ttf"):
    """Measured width of a string, from the same font file the render uses."""
    return ImageFont.truetype(str(FONT_DIR / font), 200).getlength(s) * size / 200


def fit(s, max_w, size):
    """Largest size up to `size` that keeps the string inside max_w."""
    return min(size, size * max_w / width(s, size))


def text(x, y, s, size, fill=INK, font=MARKER, anchor="start", extra=""):
    return (f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" fill="{fill}" '
            f'text-anchor="{anchor}" {extra}>{s}</text>')


def mark(x, y, size, arc=INK, wrench=RED):
    """The canonical two path mark, placed only through its own viewBox."""
    return (f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="{MARK["MARK_VIEWBOX"]}">'
            f'<path transform="{MARK["ARC_TRANSFORM"]}" fill="{arc}" d="{MARK["ARC_D"]}"/>'
            f'<path transform="{MARK["WRENCH_TRANSFORM"]}" fill="{wrench}" d="{MARK["WRENCH_D"]}"/></svg>')


def lockup(x, y, cap, hack=INK, block=RED, knock=PAPER):
    """HACK. in marker, BUILD knocked out of a tilted block, with the mark in front."""
    size = cap * 1.36
    m = cap * 1.95
    out = [mark(x, y - m * 0.5 - cap * 0.42, m, arc=hack, wrench=block)]
    tx = x + m + cap * 0.2
    out.append(text(tx, y, "HACK.", size, fill=hack))
    bx = tx + width("HACK.", size) + cap * 0.18
    pad = cap * 0.2
    bw = width("BUILD", size) + 2 * pad
    bh, by = cap * 1.4, y - cap * 1.12
    out.append(f'<g transform="rotate(-3 {bx + bw / 2} {by + bh / 2})">'
               f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" fill="{block}"/>'
               + text(bx + pad, y, "BUILD", size, fill=knock) + "</g>")
    return "".join(out)


def lockup_w(cap):
    size = cap * 1.36
    return cap * 1.95 + cap * 0.2 + width("HACK.", size) + cap * 0.18 + width("BUILD", size) + cap * 0.4


def capsule(cx, cy, r, tilt=-15):
    """A capsule: red dome over a white cup, split on a tilted seam."""
    return (f'<g transform="rotate({tilt} {cx} {cy})">'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{PAPER}" stroke="{INK}" stroke-width="4"/>'
            f'<path d="M{cx - r} {cy} A{r} {r} 0 0 1 {cx + r} {cy} Z" fill="{RED}" stroke="{INK}" stroke-width="4"/>'
            f'<path d="M{cx - r * 0.55} {cy - r * 0.5} A{r * 0.7} {r * 0.7} 0 0 1 {cx - r * 0.05} {cy - r * 0.72}" '
            f'fill="none" stroke="{PAPER}" stroke-width="5"/></g>')


def machine(cx, top, s=1.0, rotor=0.0, fallen=None, full=True):
    """TRIP: bar cage and grille lid over a red rotor, on a round black base with a door."""
    rx, ry = 150 * s, 34 * s
    cage_h, base_h = 300 * s, 150 * s
    y0, y1 = top + ry, top + ry + cage_h
    base_rx = rx * 1.09
    o = []
    # Back of the cage, so the capsules sit in front of it.
    for a in range(0, 360, 15):
        t = math.radians(a)
        if math.sin(t) < 0:
            x = cx + rx * math.cos(t)
            o.append(f'<line x1="{x}" y1="{y0 + ry * math.sin(t)}" x2="{x}" y2="{y1 + ry * math.sin(t)}" '
                     f'stroke="{INK}" stroke-width="{2 * s}"/>')
    # Rotor disc with its three pockets, turned by the rotor angle.
    rtop = y1 - 26 * s
    o.append(f'<path d="M{cx - rx * 0.94} {rtop} A{rx * 0.94} {ry * 0.94} 0 0 1 {cx + rx * 0.94} {rtop} '
             f'V{rtop + 34 * s} A{rx * 0.94} {ry * 0.94} 0 0 1 {cx - rx * 0.94} {rtop + 34 * s} Z" '
             f'fill="{RED}" stroke="{INK}" stroke-width="{3 * s}"/>')
    o.append(f'<ellipse cx="{cx}" cy="{rtop}" rx="{rx * 0.94}" ry="{ry * 0.94}" fill="{RED}" '
             f'stroke="{INK}" stroke-width="{3 * s}"/>')
    for k in range(3):
        t = math.radians(rotor + k * 120 + 90)
        hx = cx + rx * 0.56 * math.cos(t)
        hy = rtop + ry * 0.56 * math.sin(t)
        o.append(f'<ellipse cx="{hx}" cy="{hy}" rx="{36 * s}" ry="{11 * s}" fill="{INK}"/>')
    # Loaded capsules resting on the rotor, then a pile above them.
    if full:
        r = 39 * s
        pile = [(-80, 226, -14), (0, 232, 10), (80, 226, 22), (-42, 152, 18), (44, 154, -20)]
        for dx, dy, tilt in pile:
            o.append(capsule(cx + dx * s, y0 + dy * s, r, tilt))
    # Base: a solid black drum with the door flap.
    by1 = y1 + base_h
    o.append(f'<path d="M{cx - base_rx} {y1} A{base_rx} {ry * 1.09} 0 0 0 {cx + base_rx} {y1} '
             f'V{by1} A{base_rx} {ry * 1.09} 0 0 1 {cx - base_rx} {by1} Z" fill="{INK}"/>')
    dw, dh = 104 * s, 84 * s
    dx0, dy0 = cx - dw / 2, y1 + 54 * s
    o.append(f'<rect x="{dx0}" y="{dy0}" width="{dw}" height="{dh}" fill="{PAPER}" '
             f'stroke="{PAPER}" stroke-width="{3 * s}"/>')
    o.append(f'<rect x="{dx0 + 7 * s}" y="{dy0 + 7 * s}" width="{dw - 14 * s}" height="{dh - 14 * s}" '
             f'fill="{RED}"/>')
    if fallen == "door":
        o.append(capsule(cx, dy0 + dh * 0.52, 36 * s, 20))
    # Front bars, rings and the grille lid.
    for a in range(0, 360, 15):
        t = math.radians(a)
        if math.sin(t) >= 0:
            x = cx + rx * math.cos(t)
            o.append(f'<line x1="{x}" y1="{y0 + ry * math.sin(t)}" x2="{x}" y2="{y1 + ry * math.sin(t)}" '
                     f'stroke="{INK}" stroke-width="{5 * s}"/>')
    for yy, w in ((y0 + cage_h * 0.47, 7), (y1, 8)):
        o.append(f'<path d="M{cx - rx} {yy} A{rx} {ry} 0 0 0 {cx + rx} {yy}" fill="none" '
                 f'stroke="{INK}" stroke-width="{w * s}"/>')
    o.append(f'<ellipse cx="{cx}" cy="{y0}" rx="{rx}" ry="{ry}" fill="{PAPER}" stroke="{INK}" stroke-width="{8 * s}"/>')
    for f in (0.36, 0.68):
        o.append(f'<ellipse cx="{cx}" cy="{y0}" rx="{rx * f}" ry="{ry * f}" fill="none" stroke="{INK}" stroke-width="{3 * s}"/>')
    for a in range(0, 180, 30):
        t = math.radians(a)
        dx_, dy_ = rx * math.cos(t), ry * math.sin(t)
        o.append(f'<line x1="{cx - dx_}" y1="{y0 - dy_}" x2="{cx + dx_}" y2="{y0 + dy_}" stroke="{INK}" stroke-width="{3 * s}"/>')
    return "".join(o)


def coin(cx, cy, r):
    """The hack.build NFC coin."""
    m = r * 1.32
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{PAPER}" stroke="{INK}" stroke-width="{r * 0.09}"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r * 0.84}" fill="none" stroke="{RED}" stroke-width="{r * 0.05}"/>'
            + mark(cx - m / 2, cy - m / 2, m))


def waves(cx, cy, n=3, size=30, flip=False):
    """NFC tap arcs."""
    a = -1 if flip else 1
    o = []
    for i in range(1, n + 1):
        r = size * i
        o.append(f'<path d="M{cx - r * 0.7} {cy - a * r * 0.7} A{r} {r} 0 0 {1 if a > 0 else 0} {cx + r * 0.7} {cy - a * r * 0.7}" '
                 f'fill="none" stroke="{RED}" stroke-width="9" stroke-linecap="butt"/>')
    return "".join(o)


def lectern(cx, base, s=1.0):
    """The LECTERN reader stand, seen from the side and tilted toward you."""
    w, h = 340 * s, 240 * s
    x0, x1 = cx - w / 2, cx + w / 2
    o = [f'<path d="M{x0} {base} L{x1 - 30 * s} {base - h} L{x1 + 12 * s} {base - h} L{x1 + 12 * s} {base} Z" fill="{INK}"/>']
    mx, my = (x0 + x1) / 2 + 6 * s, base - h / 2 + 8 * s
    o.append(f'<g transform="rotate(-36 {mx} {my})">'
             f'<ellipse cx="{mx}" cy="{my}" rx="{86 * s}" ry="{64 * s}" fill="{PAPER}"/>'
             + text(mx, my - 6 * s, "TAP", 50 * s, anchor="middle")
             + text(mx, my + 40 * s, "HERE", 46 * s, anchor="middle") + "</g>")
    return "".join(o)


COL_X, COL_W = 448, 492


def banner(s="ASK ME FOR A COIN"):
    """The one call to action, in the same place on every step."""
    size = fit(s, W - 48, 112)
    return (f'<rect x="0" y="{H - 150}" width="{W}" height="150" fill="{RED}"/>'
            + text(W / 2, H - 75 + size * 0.34, s, size, fill=PAPER, anchor="middle"))


def small(y, s):
    return text(COL_X, y, s, fit(s, COL_W, 34), font=MONO, extra='font-weight="600"')


def step(n, head1, head2, sub1, sub2=""):
    """Right hand column of a step screen: step number, two headline lines, two small lines."""
    size = min(fit(head1, COL_W, 86), fit(head2, COL_W, 86))
    return (f'<circle cx="{COL_X + 42}" cy="74" r="44" fill="{INK}"/>'
            + text(COL_X + 42, 100, n, 70, fill=PAPER, anchor="middle")
            + text(COL_X, 212, head1, size) + text(COL_X, 212 + size * 1.08, head2, size)
            + small(396, sub1) + (small(442, sub2) if sub2 else ""))


def turn_arrow(cx, cy, rx, ry):
    """A thick arc with a head, sweeping across the front of the rotor."""
    x0, y0 = cx - rx * 0.86, cy + ry * 0.5
    x1, y1 = cx + rx * 0.86, cy + ry * 0.5
    return (f'<path d="M{x0} {y0} A{rx} {ry} 0 0 0 {x1} {y1}" fill="none" stroke="{PAPER}" stroke-width="26"/>'
            f'<path d="M{x0} {y0} A{rx} {ry} 0 0 0 {x1} {y1}" fill="none" stroke="{INK}" stroke-width="14"/>'
            f'<path d="M{x1 + 26} {y1 + 2} L{x1 - 30} {y1 - 18} L{x1 - 8} {y1 + 34} Z" fill="{INK}" stroke="{PAPER}" stroke-width="5"/>')


def centred_lockup(y, cap):
    return lockup((W - lockup_w(cap)) / 2, y, cap)


def logo_screen():
    cap = 88 * min(1, (W - 90) / lockup_w(88))
    return (centred_lockup(320, cap)
            + f'<rect x="60" y="404" width="840" height="10" fill="{INK}"/>'
            + text(W / 2, 484, "make things. break things. repeat.", fit("make things. break things. repeat.", 780, 42),
                   font="'Libre Baskerville'", anchor="middle", extra='font-style="italic"')
            + text(W / 2, 594, "@hack.build", 74, fill=RED, anchor="middle"))


def slide_machine():
    return (machine(215, 8, 0.93)
            + text(COL_X, 118, "THIS IS", 76)
            + text(COL_X, 212, "A CAPSULE", 76)
            + text(COL_X, 306, "MACHINE", 76)
            + small(396, "one coin.") + small(442, "one capsule.")
            + banner())


def slide_get():
    return (coin(215, 256, 182)
            + step("1", "GET A COIN", "FROM ME", "just ask.", "i have a pocket full.")
            + banner())


def slide_tap():
    return (lectern(208, 490, 1.0)
            + coin(222, 112, 92)
            + waves(222, 244, n=2, size=26, flip=True)
            + step("2", "TAP IT ON", "THE READER", "hold it flat on", "the tap here spot.")
            + banner())


def slide_turn(angle):
    return (machine(215, 8, 0.93, rotor=angle)
            + turn_arrow(215, 322, 150, 58)
            + step("3", "THE ROTOR", "TURNS", "one coin buys", "one pocket.")
            + banner())


def slide_grab():
    return (machine(215, 8, 0.93, rotor=120, fallen="door")
            + step("4", "GRAB YOUR", "CAPSULE", "push the door in", "and take it.")
            + banner())


def slide_cta():
    t2 = fit("FOR A COIN", W - 50, 170)
    cap = 56
    return (f'<rect width="{W}" height="{H}" fill="{RED}"/>'
            + text(W / 2, 214, "ASK ME", fit("ASK ME", W - 120, 216), fill=PAPER, anchor="middle")
            + text(W / 2, 394, "FOR A COIN", t2, fill=PAPER, anchor="middle")
            + f'<rect x="0" y="456" width="{W}" height="216" fill="{PAPER}"/>'
            + centred_lockup(566, cap)
            + text(W / 2, 642, "tap it with your phone for @hack.build", 30, font=MONO, anchor="middle",
                   extra='font-weight="600"'))


SCREENS = {
    "logo": logo_screen(),
    "s1": slide_machine(),
    "s2": slide_get(),
    "s3": slide_tap(),
    "s4": slide_turn(35),
    "s5": slide_grab(),
    "s6": slide_cta(),
}


def to_panel(path):
    """Applies the firmware's colour rule to a screenshot and saves a palette PNG."""
    src = Image.open(path).convert("RGB")
    if src.size != (W, H):
        raise SystemExit(f"{path} is {src.size}, expected {(W, H)}")
    px = src.load()
    out = Image.new("P", (W, H), 0)
    out.putpalette([255, 255, 255, 0, 0, 0, 255, 0, 0])
    q = out.load()
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            if r > 127 and g < 128 and b < 128:
                q[x, y] = 2
            elif r < 128 and g < 128 and b < 128:
                q[x, y] = 1
    return out


def to_planes(img):
    """The framebuffer format compressed: black plane then red plane, 120 bytes a row, top bit leftmost."""
    px = img.load()
    black, red = bytearray(120 * H), bytearray(120 * H)
    for y in range(H):
        for x in range(W):
            if px[x, y] == 1:
                black[y * 120 + (x >> 3)] |= 0x80 >> (x & 7)
            elif px[x, y] == 2:
                red[y * 120 + (x >> 3)] |= 0x80 >> (x & 7)
    return zlib.compress(bytes(black + red), 9)


def shoot(page, shot, tmp):
    """Chrome writes the screenshot but on this Mac never exits, so it is stopped once the file lands."""
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                             "--force-device-scale-factor=1", f"--window-size={W},{H}",
                             f"--user-data-dir={tmp}/profile", "--allow-file-access-from-files",
                             "--virtual-time-budget=3000", f"--screenshot={shot}", page.as_uri()],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 40
    try:
        while time.time() < deadline:
            if shot.exists() and shot.stat().st_size > 0:
                time.sleep(0.5)
                return
            time.sleep(0.2)
        raise SystemExit(f"no screenshot for {page}")
    finally:
        proc.kill()
        proc.wait()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    BADGE_OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        for name, body in SCREENS.items():
            page = tmp / f"{name}.html"
            shot = tmp / f"{name}.png"
            page.write_text(
                f'<!doctype html><style>{FONTS}html,body{{margin:0;background:#fff;overflow:hidden}}'
                f'svg{{display:block}}</style>'
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">{body}</svg>')
            shoot(page, shot, tmp)
            panel = to_panel(shot)
            panel.save(OUT / f"{name}.png", optimize=True)
            (BADGE_OUT / f"{name}.z").write_bytes(to_planes(panel))
            print(name, (OUT / f"{name}.png").stat().st_size, "bytes")


if __name__ == "__main__":
    main()
