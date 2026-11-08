"""The screen the badge's Play app shows when no game is running: a big QR code and the room code.

The room code comes from the badge key exactly as the host page works it out (docs/host.html), so
the QR on the badge and the one on the host page always lead to the same room.

    uv run --no-project --with qrcode --with pillow python tools/join_screen.py out.z
"""
import hashlib
import json
import pathlib
import sys
import zlib

import qrcode
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
W, H = 960, 672
PLAY_URL = "https://supercon.hack.build/play"
ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def fnv1a(text):
    h = 0x811C9DC5
    for ch in text:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def room_code(key):
    h = fnv1a(hashlib.sha256(f"{key}.room".encode()).hexdigest())
    return "".join(ALPHA[(h >> s) & 31] for s in (0, 5, 10, 15))


def font(name, size):
    return ImageFont.truetype(str(ROOT / "art" / "fonts" / name), size)


def render(code):
    img = Image.new("1", (W, H), 1)
    d = ImageDraw.Draw(img)
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2)
    qr.add_data(f"{PLAY_URL}#{code}")
    qr.make(fit=True)
    m = qr.get_matrix()
    cell = 600 // len(m)
    ox, oy = 36, (H - cell * len(m)) // 2
    for y, row in enumerate(m):
        for x, dark in enumerate(row):
            if dark:
                d.rectangle([ox + x * cell, oy + y * cell, ox + (x + 1) * cell - 1, oy + (y + 1) * cell - 1], fill=0)
    rx = ox + cell * len(m) + 36
    d.text((rx, 60), "play", font=font("PermanentMarker-Regular.ttf", 96), fill=0)
    d.text((rx, 170), "with your", font=font("PermanentMarker-Regular.ttf", 52), fill=0)
    d.text((rx, 232), "phone", font=font("PermanentMarker-Regular.ttf", 52), fill=0)
    d.rectangle([rx, 360, W - 30, 470], fill=0)
    d.text((rx + 14, 372), code, font=font("IBMPlexMono-SemiBold.ttf", 84), fill=1)
    mono = font("IBMPlexMono-SemiBold.ttf", 26)
    d.text((rx, 500), "scan the code,", font=mono, fill=0)
    d.text((rx, 534), "or type the room", font=mono, fill=0)
    d.text((rx, 568), "at supercon.hack.build", font=font("IBMPlexMono-SemiBold.ttf", 20), fill=0)
    return img


def to_planes(img):
    px = img.load()
    black = bytearray(120 * H)
    for y in range(H):
        for x in range(W):
            if px[x, y] == 0:
                black[y * 120 + (x >> 3)] |= 0x80 >> (x & 7)
    return zlib.compress(bytes(black) + bytes(120 * H), 9)


def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "join.z")
    key = json.loads((ROOT / "badge" / "secret.local.json").read_text())["key"]
    code = room_code(key)
    img = render(code)
    out.write_bytes(to_planes(img))
    if len(sys.argv) > 2:
        img.save(sys.argv[2])
    print("room", code, "->", out)


if __name__ == "__main__":
    main()
