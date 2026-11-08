"""Copies the hack.build apps to the badge and hooks them into its stock main.py.

Needs badge/secret.local.json with networks and key, and backup-stock/main.py.
Run: uv run --no-project --with mpremote --with qrcode --with pillow python tools/deploy.py /dev/cu.usbmodem101
"""
import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = sys.argv[1] if len(sys.argv) > 1 else "/dev/cu.usbmodem101"
HOOK = '''    _apps_task = aio.create_task(switcher.arun())
    try:
        import lib.hb_link as hb_link
        hb_link.start(switcher)
    except Exception as ex:
        import sys
        sys.print_exception(ex)
'''


def mp(*args):
    subprocess.run([sys.executable, "-m", "mpremote", "connect", PORT, *args], check=True, timeout=240)


def main():
    stock = (ROOT / "backup-stock" / "main.py").read_text()
    if "    _apps_task = aio.create_task(switcher.arun())\n" not in stock:
        raise SystemExit("stock main.py does not have the expected line, not patching")
    # The stock file names never-epd.png, the file is never_epd.png, and boot 42 crashes on it.
    patched = stock.replace("    _apps_task = aio.create_task(switcher.arun())\n", HOOK).replace(
        "never-epd.png", "never_epd.png")
    secret = json.loads((ROOT / "badge" / "secret.local.json").read_text())
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        (tmp / "main.py").write_text(patched)
        (tmp / "config.json").write_text(json.dumps(secret))
        subprocess.run([sys.executable, str(ROOT / "tools" / "join_screen.py"), str(tmp / "join.z")], check=True)
        mp("exec", "import os\ntry:\n    os.mkdir('/data/hb')\nexcept OSError:\n    pass\n"
           "for f in os.listdir('/data/hb'):\n    if f.endswith('.png') or f == 'state.json':\n        os.remove('/data/hb/' + f)")
        args = []
        for f in sorted((ROOT / "badge" / "screens").glob("*.z")):
            args += ["fs", "cp", str(f), f":/data/hb/{f.name}", "+"]
        for sub in ("apps", "lib"):
            for f in sorted((ROOT / "badge" / sub).glob("*.py")):
                args += ["fs", "cp", str(f), f":/{sub}/{f.name}", "+"]
        args += ["fs", "cp", str(tmp / "join.z"), ":/data/hb/join.z", "+",
                 "fs", "cp", str(tmp / "config.json"), ":/data/hb/config.json", "+",
                 "fs", "cp", str(tmp / "main.py"), ":/main.py"]
        mp(*args)
    print("copied. press reset on the badge or run: mpremote reset")


if __name__ == "__main__":
    main()
