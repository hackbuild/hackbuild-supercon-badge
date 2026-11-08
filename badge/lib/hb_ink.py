"""Live ink: strokes from the crowd drawn straight into the framebuffer and shown as fast as the
panel allows.

A stroke batch is text: strokes split by ";", each "size,color,x0,y0,x1,y1,..." in panel pixels.
The panel takes one pass, about 1.2 s, whenever something new arrived. One pass leaves faint
ghosts, so a three pass refresh runs after a run of quick ones and whenever the drawing goes quiet.
"""
import asyncio as aio
import time

import framebuf

from lib import hb_fast, hb_state
from lib.epd import display

W, H = 960, 672
SIZES = (3, 6, 12)
# Strokes arrive from phones through the host. A point far off the page would otherwise keep the
# only event loop in a drawing loop for minutes.
LIMIT = 1024
QUICK_BEFORE_CLEAN = 12
QUIET_CLEAN_MS = 4000

_fb = framebuf.FrameBuffer(display._framebuffer_black, W, H, framebuf.MONO_HLSB)
_fb_red = framebuf.FrameBuffer(display._framebuffer_red, W, H, framebuf.MONO_HLSB)
active = False
_dirty = False
_quick = 0
_changed_at = 0
_task = None


def start(clear_page=True):
    """Takes over the panel for live drawing, from a blank page or the screen already loaded."""
    global active, _task, _dirty, _quick
    active = True
    if clear_page:
        clear()
    else:
        _dirty = True
        _quick = QUICK_BEFORE_CLEAN
    if _task is None:
        _task = aio.create_task(_loop())


def stop():
    global active
    active = False


def stopping():
    """True from stop() until the loop has powered the booster down. A screen started before then
    would run its refresh against that power down."""
    return _task is not None and not active


def clear():
    global _dirty, _quick
    _fb.fill(0)
    _fb_red.fill(0)
    _dirty = True
    # A wiped page gets the clean refresh, so the old drawing leaves no ghost.
    _quick = QUICK_BEFORE_CLEAN


def apply(batch):
    """Draws one batch of strokes. Malformed strokes are skipped, never fatal."""
    global _dirty, _changed_at
    if not active:
        return
    for stroke in batch.split(";"):
        try:
            v = [int(n) for n in stroke.split(",")]
        except ValueError:
            continue
        if len(v) < 4:
            continue
        size = SIZES[max(0, min(2, v[0]))]
        color = 1 if v[1] else 0
        pts = v[2:]
        if len(pts) == 2:
            pts = pts + pts
        for i in range(0, len(pts) - 2, 2):
            _segment(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], size, color)
    _dirty = True
    _changed_at = time.ticks_ms()


def _segment(x0, y0, x1, y1, size, color):
    x0, y0, x1, y1 = (max(-LIMIT, min(LIMIT, n)) for n in (x0, y0, x1, y1))
    half = size // 2
    dx, dy = x1 - x0, y1 - y0
    steps = max(abs(dx), abs(dy)) // max(1, half) + 1
    for s in range(steps + 1):
        x = x0 + dx * s // steps
        y = y0 + dy * s // steps
        _fb.fill_rect(x - half, y - half, size, size, color)


async def _loop():
    global active, _dirty, _quick, _task
    try:
        # Leaving the Play app from the menu hands the panel back to whatever app is now showing.
        while active and hb_state.status["app"] == "play":
            if not hb_state.panel_idle():
                await aio.sleep_ms(50)
                continue
            quiet = time.ticks_diff(time.ticks_ms(), _changed_at) > QUIET_CLEAN_MS
            if _dirty:
                _dirty = False
                clean = _quick >= QUICK_BEFORE_CLEAN
                # Quick passes keep the booster running while strokes keep coming.
                await hb_state.refresh(3 if clean else 1, stay_on=not clean)
                _quick = 0 if clean else _quick + 1
            elif _quick and quiet:
                _quick = 0
                await hb_state.refresh(3)
            else:
                if time.ticks_diff(time.ticks_ms(), _changed_at) > 600:
                    await hb_fast.cool()
                await aio.sleep_ms(30)
    finally:
        active = False
        try:
            await hb_fast.cool()
        finally:
            _task = None
