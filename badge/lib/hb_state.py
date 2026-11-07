"""Shared state for the hack.build apps and the remote link. Nothing here can stop the badge
booting: missing or broken files fall back to defaults."""
import asyncio as aio
import deflate
import json
import sys
import time

from lib import hb_fast
from lib.epd import display

CONFIG_PATH = "/data/hb/config.json"
STATE_PATH = "/data/hb/state.json"
SENT_PATH = "/data/hb/sent.z"
PLANE = 960 * 672 // 8
CLEAN_EVERY = 30

config = {"networks": [], "key": "", "relay": "relay.clasp.to", "hold": 8, "quality": "fast"}
status = {"app": "logo", "slide": 0, "slides": 0, "ip": "", "rssi": 0, "err": "", "color": True, "paused": False,
          "fast_ms": 0, "color_ms": 0, "load_ms": 0, "wifi": ""}
_force_color = False
_fast_running = False
_since_color = 0
_dirty = True


def _load():
    for path in (CONFIG_PATH, STATE_PATH):
        try:
            with open(path) as f:
                config.update(json.load(f))
        except (OSError, ValueError) as ex:
            print("hb_state: no", path, ex)


_load()


def save():
    """Persists only what the badge changes itself; wifi and the key stay in config.json."""
    try:
        with open(STATE_PATH, "w") as f:
            json.dump({"hold": config["hold"], "quality": config["quality"]}, f)
    except OSError as ex:
        print("hb_state: save failed", ex)


def changed():
    global _dirty
    _dirty = True


def take_dirty():
    global _dirty
    was = _dirty
    _dirty = False
    return was


def remember(app):
    status["app"] = app
    changed()


def panel_idle():
    # The driver drops an update asked for during a refresh, so nothing draws until it is idle.
    return not _fast_running and display.is_done_updating() and not display._framebuffer_ready.is_set()


def want_color_once():
    """The next screen gets the panel's own waveform, in full color."""
    global _force_color
    _force_color = True


async def _fast_then_report(t0):
    global _fast_running
    try:
        ms = await hb_fast.show()
    except Exception as ex:
        sys.print_exception(ex)
        ms = None
    if ms is None:
        # Fast mode is unavailable, and a color update always works.
        status["color"] = True
        display.update()
    else:
        status["fast_ms"] = time.ticks_diff(time.ticks_ms(), t0)
        print("hb: fast screen in", status["fast_ms"], "ms")
    _fast_running = False
    changed()


def show(path):
    """Loads a compressed screen into the framebuffers and starts the refresh. False if it is unreadable."""
    global _force_color, _fast_running, _since_color
    t0 = time.ticks_ms()
    try:
        with open(path, "rb") as f:
            z = deflate.DeflateIO(f, deflate.ZLIB)
            black = z.readinto(memoryview(display._framebuffer_black))
            red = z.readinto(memoryview(display._framebuffer_red))
    except (OSError, ValueError) as ex:
        print("hb_state: cannot load", path, ex)
        return False
    if black != PLANE or red != PLANE:
        print("hb_state: bad screen file", path, black, red)
        display.clear()
        return False
    status["load_ms"] = time.ticks_diff(time.ticks_ms(), t0)
    # Fast updates wear the image down over time, so a color one runs now and then.
    color = _force_color or config.get("quality") == "color" or _since_color >= CLEAN_EVERY
    _force_color = False
    status["color"] = color
    if color:
        _since_color = 0
        status["color_started"] = time.ticks_ms()
        display.update()
    else:
        _since_color += 1
        _fast_running = True
        aio.create_task(_fast_then_report(t0))
    changed()
    return True
