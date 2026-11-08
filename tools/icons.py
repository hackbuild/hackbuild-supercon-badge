"""Renders the install icons in docs/icons from art/mark.json, the one source of the mark.

The arc is paper and the wrench is pink on ink, the web tokens of docs/lib/ui.css.
Shapes are drawn at 4x and scaled down so edges stay smooth.

Run: uv run --quiet --no-project --with pillow python tools/icons.py
"""
import json
import math
import pathlib
import re

from PIL import Image, ImageChops, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "icons"
INK, PAPER, PINK = (0x1A, 0x1A, 0x1A), (0xF5, 0xF0, 0xE6), (0xFE, 0x03, 0x86)
SUPERSAMPLE = 4
MARK = json.loads((ROOT / "art" / "mark.json").read_text())


def offset(transform):
    """The x, y of a translate(x,y) transform, the only kind mark.json uses."""
    x, y = re.fullmatch(r"translate\(([-\d.]+),([-\d.]+)\)", transform).groups()
    return float(x), float(y)


def subpaths(d, dx, dy):
    """Closed polygons of an SVG path made of relative m, l, h, v and z, shifted by dx, dy."""
    polys, poly, x, y, start = [], [], 0.0, 0.0, (0.0, 0.0)
    for cmd, args in re.findall(r"([a-zA-Z])([^a-zA-Z]*)", d):
        nums = [float(n) for n in re.findall(r"-?\d*\.?\d+", args)]
        if cmd not in "mlhvz":
            raise ValueError(f"path command {cmd!r} is not relative m, l, h, v or z")
        if cmd == "z":
            if poly:
                polys.append(poly)
            poly, x, y = [], *start
        elif cmd in "ml":
            for i in range(0, len(nums), 2):
                x, y = x + nums[i], y + nums[i + 1]
                if cmd == "m" and i == 0:
                    if poly:
                        polys.append(poly)
                    poly, start = [], (x, y)
                poly.append((x + dx, y + dy))
        else:
            for n in nums:
                x, y = (x + n, y) if cmd == "h" else (x, y + n)
                poly.append((x + dx, y + dy))
    if poly:
        polys.append(poly)
    return polys


ARC = subpaths(MARK["ARC_D"], *offset(MARK["ARC_TRANSFORM"]))
WRENCH = subpaths(MARK["WRENCH_D"], *offset(MARK["WRENCH_TRANSFORM"]))
POINTS = [p for poly in ARC + WRENCH for p in poly]
CX = (min(p[0] for p in POINTS) + max(p[0] for p in POINTS)) / 2
CY = (min(p[1] for p in POINTS) + max(p[1] for p in POINTS)) / 2
REACH = max(math.hypot(p[0] - CX, p[1] - CY) for p in POINTS)


def render(size, reach):
    """A square icon with the mark centred, its farthest point `reach` of the side from the centre."""
    n = size * SUPERSAMPLE
    scale = reach * n / REACH
    img = Image.new("RGB", (n, n), INK)
    for polys, color in ((ARC, PAPER), (WRENCH, PINK)):
        mask = Image.new("1", (n, n), 0)
        for poly in polys:
            part = Image.new("1", (n, n), 0)
            ImageDraw.Draw(part).polygon([((x - CX) * scale + n / 2, (y - CY) * scale + n / 2) for x, y in poly], fill=1)
            mask = ImageChops.logical_xor(mask, part)
        img.paste(color, mask=mask)
    return img.resize((size, size), Image.LANCZOS)


# A maskable icon keeps the mark inside the central 80 percent circle that every launcher mask spares.
ICONS = {
    "icon-512.png": (512, 0.44),
    "icon-192.png": (192, 0.44),
    "icon-maskable-512.png": (512, 0.36),
    "apple-touch-icon.png": (180, 0.40),
    "icon-32.png": (32, 0.46),
}

OUT.mkdir(parents=True, exist_ok=True)
for name, (size, reach) in ICONS.items():
    render(size, reach).save(OUT / name, optimize=True)
    print(f"docs/icons/{name}")
