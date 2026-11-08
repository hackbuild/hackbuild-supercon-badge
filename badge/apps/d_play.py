"""Play: the crowd games screen.

With no game running it shows how to join. A host page then sends it game screens, live ink or a
reel of frames. The remote link sets the mode. User A and user B are sent to the host, which turns
them into the running game's two main controls, so the wearer can run a game without a phone.
"""
import asyncio as aio
import struct

from apps.base_app import BaseApp
from lib import hb_fast, hb_ink, hb_lights, hb_state
from lib.button import UserA, UserB

JOIN_PATH = "/data/hb/join.z"
FRAME_PATH = "/data/hb/play.z"
REEL_PATH = "/data/hb/reel.bin"
# A one pass frame leaves faint ghosts, so an endless reel cleans one frame in this many.
CLEAN_EVERY = 12


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
        elif self.mode == "frame":
            if not hb_state.show(FRAME_PATH):
                hb_state.show(JOIN_PATH)
        else:
            hb_state.show(JOIN_PATH)

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
