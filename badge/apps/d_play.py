"""Play: the crowd games screen.

With no game running it shows how to join. A host page then sends it game screens, live ink or a
reel of frames. The remote link sets the mode. User A and user B are sent to the host, which turns
them into the running game's two main controls, so the wearer can run a game without a phone.
"""
import asyncio as aio
import struct
import time

import micropython

from apps.base_app import BaseApp
from lib import hb_fast, hb_ink, hb_lights, hb_state
from lib.button import UserA, UserB

JOIN_PATH = "/data/hb/join.z"
FRAME_PATH = "/data/hb/play.z"
REEL_PATH = "/data/hb/reel.bin"
# A one pass frame leaves faint ghosts, so an endless reel cleans one frame in this many.
CLEAN_EVERY = 12
# Live screens draw in one quick pass. Once they stop coming, the last one gets a clean refresh.
LIVE_SETTLE_MS = 4000
# A streamed frame is 240 by 168, a quarter of the panel each way.
_FW, _FH = 240, 168


def _expand_table():
    # Each source byte becomes four bytes: every pixel four pixels wide.
    t = bytearray(1024)
    for b in range(256):
        v = 0
        for i in range(8):
            if b & (0x80 >> i):
                v |= 0xF << (28 - 4 * i)
        t[b * 4:b * 4 + 4] = v.to_bytes(4, "big")
    return t


_EXPAND = None


@micropython.viper
def _expand(dst, src, tab):
    d = ptr8(dst)
    s = ptr8(src)
    t = ptr8(tab)
    y = 0
    while y < 168:
        o = y * 480
        i = 0
        while i < 30:
            b = s[y * 30 + i] * 4
            j = o + i * 4
            d[j] = t[b]
            d[j + 1] = t[b + 1]
            d[j + 2] = t[b + 2]
            d[j + 3] = t[b + 3]
            i += 1
        k = 120
        while k < 480:
            d[o + k] = d[o + k - 120]
            k += 1
        y += 1


class PlayApp(BaseApp):
    _instance = None

    def __init__(self, name=None):
        super().__init__("Play")
        self.sleep_ms = 50
        self.request = False
        self.mode = "join"
        self.pending = False
        self.loops = 2
        self.gen = 0
        self.reel_task = None
        self.quick = 0
        self.live_at = 0
        self.frame_bits = None
        self.red_left = True
        self.on_press = None
        PlayApp._instance = self

    def set_mode(self, mode, loops=2):
        """Called by the remote link. Takes effect once the panel is idle; a running reel stops at
        its next frame."""
        self.mode = mode
        self.loops = loops
        self.gen += 1
        self.pending = True
        hb_state.status["play"] = mode
        hb_state.changed()

    def stream(self, bits):
        """The newest frame of a live game. Frames that arrive while the panel draws replace each
        other, so the badge always shows what was on screen when it was ready."""
        self.frame_bits = bits
        if self.mode != "stream":
            self.red_left = True
            self.set_mode("stream")
        else:
            self.pending = True

    def run(self):
        if self.launched or self.request:
            self.request = False
            self.pending = True
            hb_state.remember("play")
            hb_lights.resume()
        if UserA.pressed() and self.on_press:
            self.on_press("a")
        if UserB.pressed() and self.on_press:
            self.on_press("b")
        if self.mode not in ("ink", "inkframe") and hb_ink.active:
            hb_ink.stop()
        if (self.mode in ("live", "stream") and self.quick and not self.pending and self.reel_task is None
                and time.ticks_diff(time.ticks_ms(), self.live_at) > LIVE_SETTLE_MS):
            self.quick = CLEAN_EVERY
            self.pending = True
        if not self.pending or self.reel_task is not None or hb_ink.stopping() or not hb_state.panel_idle():
            return
        self.pending = False
        if self.mode == "ink":
            if not hb_ink.active:
                hb_ink.start()
        elif self.mode == "inkframe":
            self.mode = "ink"
            hb_state.load(FRAME_PATH)
            hb_ink.start(clear_page=False)
        elif self.mode == "reel":
            self.reel_task = aio.create_task(self._play_reel(self.gen, self.loops))
        elif self.mode in ("live", "stream"):
            self.reel_task = aio.create_task(self._live_frame())
        elif self.mode == "frame":
            if not hb_state.show(FRAME_PATH):
                hb_state.show(JOIN_PATH)
        else:
            hb_state.show(JOIN_PATH)

    async def _live_frame(self):
        """One game screen in a single quick pass, the booster left on for the next one."""
        try:
            if self.mode == "stream":
                global _EXPAND
                if self.frame_bits is None:
                    return
                if _EXPAND is None:
                    _EXPAND = _expand_table()
                from lib.epd import display
                _expand(display._framebuffer_black, self.frame_bits, _EXPAND)
                if self.red_left:
                    # Once per stream: an 80 KB buffer a frame would fragment the heap.
                    display._framebuffer_red[:] = bytes(len(display._framebuffer_red))
                    self.red_left = False
            elif not hb_state.load(FRAME_PATH):
                return
            self.quick += 1
            clean = self.quick >= CLEAN_EVERY
            if not await hb_state.refresh(3 if clean else 1, stay_on=not clean):
                hb_state.show(FRAME_PATH)
                await aio.sleep_ms(1000)
            if clean:
                self.quick = 0
            self.live_at = time.ticks_ms()
        except (OSError, ValueError) as ex:
            print("play: live frame failed", ex)
        finally:
            self.reel_task = None

    async def _play_reel(self, gen, loops):
        """Plays the frames with one quick pass each, the booster left on between them. loops 0
        plays until something else arrives. The last frame of a finite reel gets a clean refresh."""
        hb_state.holding = True
        hb_state.status["loop"] = loops == 0
        hb_state.changed()
        shown = 0
        try:
            with open(REEL_PATH, "rb") as f:
                count = struct.unpack("<H", f.read(2))[0]
                offsets = struct.unpack("<%dI" % count, f.read(4 * count))
            if not offsets:
                # An endless reel of no frames would never reach an await and freeze the badge.
                return
            loop = 0
            while loops == 0 or loop < loops:
                for i, at in enumerate(offsets):
                    # Leaving Play from the menu ends the reel, whose holding flag would lock out the next app.
                    if self.gen != gen or hb_state.status["app"] != "play":
                        return
                    if not hb_state.load(REEL_PATH, at):
                        return
                    shown += 1
                    last = loops and loop == loops - 1 and i == count - 1
                    clean = last or (loops == 0 and shown % CLEAN_EVERY == 0)
                    hb_state.status["frame"] = i
                    if not await hb_state.refresh(3 if clean else 1, stay_on=not clean):
                        # With fast mode unavailable for the boot, refresh returns without awaiting,
                        # so an endless reel would hold the only event loop.
                        await aio.sleep_ms(1000)
                loop += 1
        except (OSError, ValueError) as ex:
            print("play: reel failed", ex)
        finally:
            await hb_fast.cool()
            hb_state.holding = False
            hb_state.status["loop"] = False
            hb_state.changed()
            self.reel_task = None
            # Whatever arrived during the reel, a new reel or a screen, runs next.
            if self.gen != gen:
                self.pending = True
