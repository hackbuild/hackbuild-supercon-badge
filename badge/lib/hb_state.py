"""Shared state for the hack.build apps and the remote link. Nothing here can stop the badge
booting: missing or broken files fall back to defaults."""
import deflate
import json

from lib.epd import display

CONFIG_PATH = "/data/hb/config.json"
STATE_PATH = "/data/hb/state.json"
SENT_PATH = "/data/hb/sent.z"
PLANE = 960 * 672 // 8

config = {"ssid": "", "password": "", "key": "", "relay": "relay.clasp.to", "hold": 15}
status = {"app": "logo", "slide": 0, "slides": 0, "ip": "", "rssi": 0, "err": ""}
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
            json.dump({"hold": config["hold"]}, f)
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
    return display.is_done_updating() and not display._framebuffer_ready.is_set()


def show_png(path):
    display.clear()
    display.draw_png(path)
    display.update()
    changed()


def show_sent():
    """Inflates a sent image straight into the two framebuffers."""
    try:
        with open(SENT_PATH, "rb") as f:
            z = deflate.DeflateIO(f, deflate.ZLIB)
            black = z.readinto(memoryview(display._framebuffer_black))
            red = z.readinto(memoryview(display._framebuffer_red))
    except (OSError, ValueError) as ex:
        print("hb_state: no sent image", ex)
        return False
    if black != PLANE or red != PLANE:
        print("hb_state: bad sent image", black, red)
        display.clear()
        return False
    display.update()
    changed()
    return True
